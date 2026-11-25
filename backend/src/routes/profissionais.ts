import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool, { ErroOperacao } from '../config/database.js';
import { transacaoAgenda } from '../services/reservasAgenda.js';
import { registrarErro, sanitizarTexto } from '../middleware/security.js';
import { idPositivo, responderFalha } from './validacaoAgenda.js';

const router = Router();

router.get('/profissionais', async (req: Request, res: Response): Promise<any> => {
  try {
    const { procedimento_id, servico_id } = req.query;
    const procId = procedimento_id || servico_id;

    if (procId) {
      const [rows] = await pool.query(`
        SELECT p.id, p.nome, p.especialidade, p.ativo,
               COALESCE(pp.duracao_minutos_profissional, pr.duracao_minutos) AS duracao_minutos,
               COALESCE(pp.preco_profissional, pr.preco) AS preco
        FROM profissionais p
        INNER JOIN profissional_procedimento pp ON p.id = pp.id_profissional
        INNER JOIN procedimento pr ON pr.id_procedimento = pp.id_procedimento
        WHERE pp.id_procedimento = ? AND p.ativo = 1 AND pp.ativo_profissional = 1 AND pr.ativo = 1
        ORDER BY p.id ASC
      `, [procId]);
      return res.status(200).json({ sucesso: true, dados: rows });
    }

    if (req.query.incluir === 'procedimentos') {
      if (req.usuario?.perfil !== 'ADMIN') return res.status(403).json({ sucesso: false, erro: 'Acesso restrito.' });
      const [linhas] = await pool.query<(RowDataPacket & {
        id: number; nome: string; especialidade: string | null; ativo: number; id_procedimento: number | null;
      })[]>(`SELECT p.id, p.nome, p.especialidade, p.ativo, pp.id_procedimento
        FROM profissionais p LEFT JOIN profissional_procedimento pp ON pp.id_profissional = p.id
        ORDER BY p.id, pp.id_procedimento`);
      const profissionais = new Map<number, { id: number; nome: string; especialidade: string | null; ativo: number; procedimento_ids: number[] }>();
      for (const { id, nome, especialidade, ativo, id_procedimento } of linhas) {
        const profissional = profissionais.get(id) ?? { id, nome, especialidade, ativo, procedimento_ids: [] };
        if (id_procedimento !== null) profissional.procedimento_ids.push(id_procedimento);
        profissionais.set(id, profissional);
      }
      return res.json({ sucesso: true, dados: [...profissionais.values()] });
    }

    const [rows] = await pool.query('SELECT id, nome, especialidade, ativo FROM profissionais ORDER BY id ASC');
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar profissionais:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar profissionais.' });
  }
});

// ============================================================================
// ENDPOINT: PATCH & PUT /api/profissionais/:id/status (Alternar status ativo/inativo na grade)
// ============================================================================
const handleStatusProfissional = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { ativo } = req.body;

    const novoStatus = (ativo === 1 || ativo === true) ? 1 : 0;

    const result = await transacaoAgenda([idPositivo(id)], async conexao => {
      if (!novoStatus) {
        const [pendentes] = await conexao.query<any[]>("SELECT id_agendamento FROM agendamento WHERE id_profissional = ? AND data >= CURDATE() AND status IN ('Agendado','Confirmado','Reagendado','Na Recepção','Em Atendimento') LIMIT 1", [id]);
        if (pendentes.length) throw new ErroOperacao(409, 'Resolva os atendimentos pendentes antes de inativar o profissional.');
      }
      const [resultado]: any = await conexao.query('UPDATE profissional SET ativo = ? WHERE id_profissional = ?', [novoStatus,id]);
      return resultado;
    });

    if (result.affectedRows === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: novoStatus === 1 ? 'Profissional ativado na grade com sucesso!' : 'Profissional desativado da grade com sucesso!',
      dados: {
        id: Number(id),
        ativo: novoStatus
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao atualizar status do profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar status do profissional.' });
  }
};

router.patch('/profissionais/:id/status', handleStatusProfissional);
router.put('/profissionais/:id/status', handleStatusProfissional);

// ============================================================================
// ENDPOINT: POST /api/profissionais (Cadastrar novo profissional/terapeuta)
// ============================================================================
router.post('/profissionais', async (req: Request, res: Response): Promise<any> => {
  try {
    const { nome, especialidade } = req.body;

    if (!nome || typeof nome !== 'string' || !nome.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'O nome do profissional é obrigatório.' });
    }

    const nomeLimpo = sanitizarTexto(nome).trim();
    if (!nomeLimpo) {
      return res.status(400).json({ sucesso: false, erro: 'O nome do profissional é obrigatório.' });
    }
    const especialidadeLimpa = (especialidade && typeof especialidade === 'string' && sanitizarTexto(especialidade).trim())
      ? sanitizarTexto(especialidade).trim()
      : 'Especialista';

    const [result]: any = await pool.query(
      'INSERT INTO profissional (nome, especialidade_principal, ativo) VALUES (?, ?, 1)',
      [nomeLimpo, especialidadeLimpa]
    );

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Profissional cadastrado com sucesso!',
      dados: {
        id: result.insertId,
        nome: nomeLimpo,
        especialidade: especialidadeLimpa,
        ativo: 1
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao cadastrar profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao cadastrar profissional.' });
  }
});

// ============================================================================
// ENDPOINT: PUT /api/profissionais/:id (Editar profissional/terapeuta)
// ============================================================================
router.put('/profissionais/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { nome, especialidade } = req.body;

    if (!nome || typeof nome !== 'string' || !nome.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'O nome do profissional é obrigatório.' });
    }

    const nomeLimpo = sanitizarTexto(nome).trim();
    if (!nomeLimpo) {
      return res.status(400).json({ sucesso: false, erro: 'O nome do profissional é obrigatório.' });
    }
    const especialidadeLimpa = (especialidade && typeof especialidade === 'string' && sanitizarTexto(especialidade).trim())
      ? sanitizarTexto(especialidade).trim()
      : 'Especialista';

    const [result]: any = await pool.query(
      'UPDATE profissional SET nome = ?, especialidade_principal = ? WHERE id_profissional = ?',
      [nomeLimpo, especialidadeLimpa, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Profissional atualizado com sucesso!',
      dados: {
        id: Number(id),
        nome: nomeLimpo,
        especialidade: especialidadeLimpa
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao atualizar profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar profissional.' });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/profissionais/:id (Excluir profissional/terapeuta)
// ============================================================================
router.delete('/profissionais/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    // Verificar se existem agendamentos vinculados a este profissional
    const [agendamentos]: any = await pool.query(
      'SELECT COUNT(*) as total FROM agendamentos WHERE profissional_id = ?',
      [id]
    );

    if (agendamentos[0]?.total > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: `Não é possível excluir este profissional pois existem ${agendamentos[0].total} agendamento(s) vinculado(s) a ele.`
      });
    }

    const [result]: any = await pool.query('DELETE FROM profissionais WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Profissional excluído com sucesso!'
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao excluir profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao excluir profissional.' });
  }
});

// ============================================================================
// ENDPOINTS: VINCULAÇÃO DE PROCEDIMENTOS AO PROFISSIONAL (IK-80)
// ============================================================================

function validarEscopoProfissional(req: Request, idProfissional: number) {
  if (req.usuario?.perfil === 'PROFISSIONAL') {
    if (!req.usuario.profissional_id || Number(req.usuario.profissional_id) !== Number(idProfissional)) {
      throw new ErroOperacao(403, 'Você só pode gerenciar os procedimentos da sua própria agenda.');
    }
  }
}

async function resolverEspecialidadeProcedimento(
  conexao: any,
  idProfissional: number,
  categoriaIdRaw: unknown,
  novaCategoriaRaw: unknown
): Promise<number> {
  const novaCategoria = sanitizarTexto(typeof novaCategoriaRaw === 'string' ? novaCategoriaRaw : '').trim();
  if (novaCategoria) {
    await conexao.query('INSERT IGNORE INTO especialidade (nome, ativo) VALUES (?, 1)', [novaCategoria]);
    const [catRows]: any = await conexao.query('SELECT id_especialidade FROM especialidade WHERE nome = ? LIMIT 1', [novaCategoria]);
    if (catRows.length) return Number(catRows[0].id_especialidade);
  }
  if (categoriaIdRaw !== undefined && categoriaIdRaw !== null && categoriaIdRaw !== '') {
    const catId = idPositivo(categoriaIdRaw);
    const [catRows]: any = await conexao.query('SELECT id_especialidade FROM especialidade WHERE id_especialidade = ? LIMIT 1', [catId]);
    if (!catRows.length) throw new ErroOperacao(404, 'Especialidade/Categoria não encontrada.');
    return catId;
  }
  const [profs]: any = await conexao.query(
    'SELECT especialidade_principal FROM profissional WHERE id_profissional = ? LIMIT 1',
    [idProfissional]
  );
  const nomeEsp = sanitizarTexto(profs[0]?.especialidade_principal || 'Geral').trim() || 'Geral';
  await conexao.query('INSERT IGNORE INTO especialidade (nome, ativo) VALUES (?, 1)', [nomeEsp]);
  const [catRows]: any = await conexao.query('SELECT id_especialidade FROM especialidade WHERE nome = ? LIMIT 1', [nomeEsp]);
  return Number(catRows[0].id_especialidade);
}

/**
 * GET /api/profissionais/:id/procedimentos
 * CA01: Retorna todos os procedimentos cadastrados na clínica indicando quais estão vinculados ao profissional.
 */
router.get('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    validarEscopoProfissional(req, id);

    // Verificar se o profissional existe
    const [profs]: any = await pool.query('SELECT id, nome, especialidade FROM profissionais WHERE id = ?', [id]);
    if (profs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    const [rows]: any = await pool.query(`
      SELECT 
        p.id_procedimento AS id,
        p.nome,
        COALESCE(pp.duracao_minutos_profissional, p.duracao_minutos) AS duracao_minutos,
        COALESCE(pp.preco_profissional, p.preco) AS preco,
        p.duracao_minutos AS duracao_padrao,
        p.preco AS preco_padrao,
        p.id_especialidade AS categoria_id,
        COALESCE(e.nome, 'Geral') AS categoria_nome,
        p.ativo AS ativo_global,
        COALESCE(pp.ativo_profissional, 1) AS ativo_profissional,
        CASE WHEN pp.id_profissional IS NOT NULL
          THEN (CASE WHEN p.ativo = 1 AND pp.ativo_profissional = 1 THEN 1 ELSE 0 END)
          ELSE p.ativo
        END AS ativo,
        CASE WHEN pp.id_profissional IS NOT NULL THEN 1 ELSE 0 END AS vinculado
      FROM procedimento p
      LEFT JOIN especialidade e ON p.id_especialidade = e.id_especialidade
      LEFT JOIN profissional_procedimento pp 
        ON p.id_procedimento = pp.id_procedimento AND pp.id_profissional = ?
      WHERE p.ativo = 1 OR pp.id_profissional IS NOT NULL
      ORDER BY p.nome ASC
    `, [id]);

    const vinculados = rows.filter((r: any) => r.vinculado === 1);
    const procedimento_ids = vinculados.filter((r: any) => r.ativo === 1).map((r: any) => r.id);

    return res.status(200).json({
      sucesso: true,
      profissional: profs[0],
      dados: rows,
      vinculados,
      procedimento_ids
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar procedimentos do profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar procedimentos do profissional.' });
  }
});

/**
 * PUT /api/profissionais/:id/procedimentos
 * CA01 & CA02: Atualiza a lista completa de procedimentos vinculados ao profissional.
 */
router.put('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    validarEscopoProfissional(req, id);
    const lista = req.body.procedimentos ?? req.body.procedimento_ids;
    if (!Array.isArray(lista)) throw new ErroOperacao(400, 'Informe uma lista de procedimentos.');
    const procIds = [...new Set(lista.map(idPositivo))];
    await transacaoAgenda([id], async conexao => {
      const [atuais] = await conexao.query<RowDataPacket[]>('SELECT id_procedimento FROM profissional_procedimento WHERE id_profissional = ?', [id]);
      const vinculosAtuais = new Set(atuais.map(vinculo => Number(vinculo.id_procedimento)));
      const solicitados = new Set(procIds);
      const novos = procIds.filter(procId => !vinculosAtuais.has(procId));
      const removidos = [...vinculosAtuais].filter(procId => !solicitados.has(procId));
      if (novos.length) {
        const [validos] = await conexao.query<RowDataPacket[]>('SELECT id_procedimento FROM procedimento WHERE id_procedimento IN (?) AND ativo = 1 FOR SHARE', [novos]);
        if (validos.length !== novos.length) throw new ErroOperacao(400, 'Procedimento inválido ou inativo.');
      }
      if (removidos.length) await conexao.query('DELETE FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento IN (?)', [id, removidos]);
      if (novos.length) await conexao.query('INSERT INTO profissional_procedimento (id_profissional, id_procedimento) VALUES ?', [novos.map(procId => [id, procId])]);
    });
    return res.json({ sucesso: true, mensagem: 'Vínculos salvos com sucesso!', dados: { id_profissional: id, procedimentos: procIds } });
  } catch (erro) { return responderFalha(res, erro); }
});

/**
 * POST /api/profissionais/:id/procedimentos
 * Permite ao profissional criar um novo procedimento já vinculado automaticamente à sua agenda,
 * ou vincular um procedimento existente por procedimento_id/servico_id.
 */
router.post('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    validarEscopoProfissional(req, id);

    // Modo 1: Criação de novo procedimento global (restrito a ADMIN para evitar escalação de privilégio)
    if (typeof req.body?.nome === 'string' && req.body.nome.trim()) {
      if (req.usuario?.perfil === 'PROFISSIONAL') {
        throw new ErroOperacao(
          403,
          'Apenas administradores podem cadastrar novos procedimentos ou especialidades globais. Vincule um procedimento existente da clínica e personalize preço e duração para a sua agenda.'
        );
      }
      const nomeSanitizado = sanitizarTexto(req.body.nome).trim();
      if (!nomeSanitizado) throw new ErroOperacao(400, 'Informe um nome válido para o procedimento.');
      const duracaoVal = Number(req.body.duracao_minutos ?? 60);
      if (!Number.isSafeInteger(duracaoVal) || duracaoVal <= 0 || duracaoVal > 1440 || duracaoVal % 5 !== 0) {
        throw new ErroOperacao(400, 'A duração deve ser um múltiplo de 5 minutos (entre 5 e 1440).');
      }
      const precoVal = req.body.preco !== undefined && req.body.preco !== '' ? Number(req.body.preco) : 0;
      if (!Number.isFinite(precoVal) || precoVal < 0 || precoVal > 99999999.99) {
        throw new ErroOperacao(400, 'Informe um valor válido para o procedimento.');
      }

      const criado = await transacaoAgenda([id], async conexao => {
        const categoriaId = await resolverEspecialidadeProcedimento(
          conexao,
          id,
          req.body.categoria_id,
          req.body.nova_categoria
        );
        const [ins]: any = await conexao.query(
          'INSERT INTO procedimento (id_especialidade, nome, duracao_minutos, preco, ativo) VALUES (?, ?, ?, ?, 1)',
          [categoriaId, nomeSanitizado, duracaoVal, precoVal]
        );
        const novoId = Number(ins.insertId);
        await conexao.query(
          'INSERT IGNORE INTO profissional_procedimento (id_profissional, id_procedimento, ativo_profissional) VALUES (?, ?, 1)',
          [id, novoId]
        );
        return {
          id: novoId,
          nome: nomeSanitizado,
          categoria_id: categoriaId,
          duracao_minutos: duracaoVal,
          preco: precoVal,
          ativo: 1,
          vinculado: 1,
        };
      });

      return res.status(201).json({
        sucesso: true,
        mensagem: 'Procedimento criado e vinculado automaticamente à agenda!',
        dados: criado,
      });
    }

    // Modo 2: Vincular procedimento existente por ID (com overrides opcionais apenas para este profissional)
    const procedimento = idPositivo(req.body.procedimento_id ?? req.body.servico_id);
    let duracaoOverride: number | null = null;
    if (req.body.duracao_minutos !== undefined && req.body.duracao_minutos !== null && req.body.duracao_minutos !== '') {
      duracaoOverride = Number(req.body.duracao_minutos);
      if (!Number.isSafeInteger(duracaoOverride) || duracaoOverride <= 0 || duracaoOverride > 1440 || duracaoOverride % 5 !== 0) {
        throw new ErroOperacao(400, 'A duração deve ser um múltiplo de 5 minutos (entre 5 e 1440).');
      }
    }
    let precoOverride: number | null = null;
    if (req.body.preco !== undefined && req.body.preco !== null && req.body.preco !== '') {
      precoOverride = Number(req.body.preco);
      if (!Number.isFinite(precoOverride) || precoOverride < 0 || precoValInvalido(precoOverride)) {
        throw new ErroOperacao(400, 'O preço informado é inválido.');
      }
    }

    await transacaoAgenda([id], async conexao => {
      const [rows] = await conexao.query<any[]>('SELECT id_procedimento FROM procedimento WHERE id_procedimento = ? AND ativo = 1 FOR SHARE', [procedimento]);
      if (!rows.length) throw new ErroOperacao(400, 'Procedimento inválido ou inativo.');
      await conexao.query(
        `INSERT INTO profissional_procedimento
           (id_profissional, id_procedimento, duracao_minutos_profissional, preco_profissional, ativo_profissional)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           duracao_minutos_profissional = COALESCE(VALUES(duracao_minutos_profissional), duracao_minutos_profissional),
           preco_profissional = COALESCE(VALUES(preco_profissional), preco_profissional),
           ativo_profissional = 1`,
        [id, procedimento, duracaoOverride, precoOverride]
      );
    });
    return res.json({ sucesso: true, mensagem: 'Vínculo salvo com sucesso!' });
  } catch (erro) { return responderFalha(res, erro); }
});

/**
 * PUT & PATCH /api/profissionais/:id/procedimentos/:procedimentoId
 * Para PROFISSIONAL: personaliza preço, duração e status ativo/pausado APENAS na própria agenda
 * (nunca altera a tabela global procedimento nem cria especialidades globais).
 * Para ADMIN: pode atualizar o vínculo individual ou o catálogo conforme campos enviados.
 */
const atualizarProcedimentoDoProfissional = async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    const procedimentoId = idPositivo(req.params.procedimentoId);
    validarEscopoProfissional(req, id);

    const isProfissional = req.usuario?.perfil === 'PROFISSIONAL';

    const atualizado = await transacaoAgenda([id], async conexao => {
      const [vinculo]: any = await conexao.query(
        `SELECT duracao_minutos_profissional, preco_profissional, ativo_profissional
         FROM profissional_procedimento
         WHERE id_profissional = ? AND id_procedimento = ?
         FOR UPDATE`,
        [id, procedimentoId]
      );
      if (!vinculo.length) {
        throw new ErroOperacao(404, 'Este procedimento não está vinculado à sua agenda.');
      }

      const [atuais]: any = await conexao.query(
        'SELECT id_procedimento, id_especialidade, nome, duracao_minutos, preco, ativo FROM procedimento WHERE id_procedimento = ? FOR SHARE',
        [procedimentoId]
      );
      if (!atuais.length) throw new ErroOperacao(404, 'Procedimento não encontrado.');
      const atual = atuais[0];
      const vinculoAtual = vinculo[0];

      const duracaoFinal = req.body.duracao_minutos !== undefined
        ? Number(req.body.duracao_minutos)
        : Number(vinculoAtual.duracao_minutos_profissional ?? atual.duracao_minutos);
      if (!Number.isSafeInteger(duracaoFinal) || duracaoFinal <= 0 || duracaoFinal > 1440 || duracaoFinal % 5 !== 0) {
        throw new ErroOperacao(400, 'A duração deve ser um múltiplo de 5 minutos.');
      }

      const precoFinal = req.body.preco !== undefined
        ? Number(req.body.preco)
        : Number(vinculoAtual.preco_profissional ?? atual.preco);
      if (!Number.isFinite(precoFinal) || precoFinal < 0 || precoValInvalido(precoFinal)) {
        throw new ErroOperacao(400, 'O preço informado é inválido.');
      }

      const ativoFinal = req.body.ativo !== undefined
        ? (req.body.ativo === 1 || req.body.ativo === true ? 1 : 0)
        : Number(vinculoAtual.ativo_profissional ?? 1);

      if (isProfissional) {
        if (req.body.nova_categoria !== undefined && String(req.body.nova_categoria).trim()) {
          throw new ErroOperacao(403, 'Apenas administradores podem criar categorias globais.');
        }
        // Altera EXCLUSIVAMENTE as configurações individuais deste profissional
        await conexao.query(
          `UPDATE profissional_procedimento
           SET duracao_minutos_profissional = ?, preco_profissional = ?, ativo_profissional = ?
           WHERE id_profissional = ? AND id_procedimento = ?`,
          [duracaoFinal, precoFinal, ativoFinal, id, procedimentoId]
        );
        return {
          id: procedimentoId,
          categoria_id: Number(atual.id_especialidade),
          nome: atual.nome,
          duracao_minutos: duracaoFinal,
          preco: precoFinal,
          ativo: atual.ativo === 1 && ativoFinal === 1 ? 1 : 0,
          ativo_profissional: ativoFinal,
          ativo_global: Number(atual.ativo),
        };
      }

      // Fluxo administrativo explícito: atualiza também override individual do vínculo
      await conexao.query(
        `UPDATE profissional_procedimento
         SET duracao_minutos_profissional = ?, preco_profissional = ?, ativo_profissional = ?
         WHERE id_profissional = ? AND id_procedimento = ?`,
        [duracaoFinal, precoFinal, ativoFinal, id, procedimentoId]
      );

      return {
        id: procedimentoId,
        categoria_id: Number(atual.id_especialidade),
        nome: atual.nome,
        duracao_minutos: duracaoFinal,
        preco: precoFinal,
        ativo: atual.ativo === 1 && ativoFinal === 1 ? 1 : 0,
        ativo_profissional: ativoFinal,
        ativo_global: Number(atual.ativo),
      };
    });

    return res.json({
      sucesso: true,
      mensagem: 'Configuração do procedimento na sua agenda atualizada com sucesso!',
      dados: atualizado,
    });
  } catch (erro) { return responderFalha(res, erro); }
};

function precoValInvalido(v: number) {
  return v > 99999999.99;
}

router.put('/profissionais/:id/procedimentos/:procedimentoId', atualizarProcedimentoDoProfissional);
router.patch('/profissionais/:id/procedimentos/:procedimentoId', atualizarProcedimentoDoProfissional);

/**
 * DELETE /api/profissionais/:id/procedimentos/:procedimentoId
 * CA02: Remove vínculo pontual de um procedimento do profissional.
 */
router.delete('/profissionais/:id/procedimentos/:procedimentoId', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    validarEscopoProfissional(req, id);
    const procedimento = idPositivo(req.params.procedimentoId);
    await transacaoAgenda([id], async conexao => {
      const [resultado]: any = await conexao.query('DELETE FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?', [id, procedimento]);
      if (!resultado.affectedRows) throw new ErroOperacao(404, 'Vínculo não encontrado.');
    });
    return res.json({ sucesso: true, mensagem: 'Vínculo removido com sucesso!' });
  } catch (erro) { return responderFalha(res, erro); }
});
/**
 * GET /api/servicos/:id/profissionais e GET /api/procedimentos/:id/profissionais
 * CA03: Retorna somente profissionais habilitados para realizar o procedimento.
 */
const handleProfissionaisPorServico = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const [rows]: any = await pool.query(`
      SELECT 
        p.id, 
        p.nome, 
        p.especialidade, 
        p.ativo,
        COALESCE(pp.duracao_minutos_profissional, pr.duracao_minutos) AS duracao_minutos,
        COALESCE(pp.preco_profissional, pr.preco) AS preco
      FROM profissionais p
      INNER JOIN profissional_procedimento pp ON p.id = pp.id_profissional
      INNER JOIN procedimento pr ON pr.id_procedimento = pp.id_procedimento
      WHERE pp.id_procedimento = ? AND p.ativo = 1 AND pp.ativo_profissional = 1 AND pr.ativo = 1
      ORDER BY p.nome ASC
    `, [id]);

    return res.status(200).json({
      sucesso: true,
      procedimento_id: Number(id),
      dados: rows
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar profissionais vinculados ao procedimento:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar profissionais do procedimento.' });
  }
};

router.get('/servicos/:id/profissionais', handleProfissionaisPorServico);
router.get('/procedimentos/:id/profissionais', handleProfissionaisPorServico);

export default router;
