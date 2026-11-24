import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool, { ErroOperacao } from '../config/database.js';
import { transacaoAgenda } from '../services/reservasAgenda.js';
import { registrarErro, sanitizarTexto, validarIdNumerico } from '../middleware/security.js';
import { idPositivo, responderFalha } from './validacaoAgenda.js';

const router = Router();

router.get('/profissionais', async (req: Request, res: Response): Promise<any> => {
  try {
    const { procedimento_id, servico_id } = req.query;
    const procId = procedimento_id || servico_id;

    if (procId) {
      const [rows] = await pool.query(`
        SELECT p.id, p.nome, p.especialidade, p.ativo 
        FROM profissionais p
        INNER JOIN profissional_procedimento pp ON p.id = pp.id_profissional
        WHERE pp.id_procedimento = ? AND p.ativo = 1
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

    const nomeLimpo = nome.trim();
    const especialidadeLimpa = (especialidade && typeof especialidade === 'string' && especialidade.trim())
      ? especialidade.trim()
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

    const nomeLimpo = nome.trim();
    const especialidadeLimpa = (especialidade && typeof especialidade === 'string' && especialidade.trim())
      ? especialidade.trim()
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

/**
 * GET /api/profissionais/:id/procedimentos
 * CA01: Retorna todos os procedimentos cadastrados na clínica indicando quais estão vinculados ao profissional.
 */
router.get('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    // Verificar se o profissional existe
    const [profs]: any = await pool.query('SELECT id, nome, especialidade FROM profissionais WHERE id = ?', [id]);
    if (profs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    const [rows]: any = await pool.query(`
      SELECT 
        p.id_procedimento AS id,
        p.nome,
        p.duracao_minutos,
        p.preco,
        p.id_especialidade AS categoria_id,
        COALESCE(e.nome, 'Geral') AS categoria_nome,
        p.ativo,
        CASE WHEN pp.id_profissional IS NOT NULL THEN 1 ELSE 0 END AS vinculado
      FROM procedimento p
      LEFT JOIN especialidade e ON p.id_especialidade = e.id_especialidade
      LEFT JOIN profissional_procedimento pp 
        ON p.id_procedimento = pp.id_procedimento AND pp.id_profissional = ?
      WHERE p.ativo = 1
      ORDER BY p.nome ASC
    `, [id]);

    const vinculados = rows.filter((r: any) => r.vinculado === 1);
    const procedimento_ids = vinculados.map((r: any) => r.id);

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
 * Permite selecionar um ou mais procedimentos ativos e salvar, ou remover vínculos.
 */
router.put('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
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
 * CA01: Adiciona vínculo pontual de um procedimento ao profissional.
 */
router.post('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    const procedimento = idPositivo(req.body.procedimento_id ?? req.body.servico_id);
    await transacaoAgenda([id], async conexao => {
      const [rows] = await conexao.query<any[]>('SELECT id_procedimento FROM procedimento WHERE id_procedimento = ? AND ativo = 1 FOR SHARE', [procedimento]);
      if (!rows.length) throw new ErroOperacao(400, 'Procedimento inválido ou inativo.');
      await conexao.query('INSERT IGNORE INTO profissional_procedimento (id_profissional, id_procedimento) VALUES (?, ?)', [id, procedimento]);
    });
    return res.json({ sucesso: true, mensagem: 'Vínculo salvo com sucesso!' });
  } catch (erro) { return responderFalha(res, erro); }
});
/**
 * DELETE /api/profissionais/:id/procedimentos/:procedimentoId
 * CA02: Remove vínculo pontual de um procedimento do profissional.
 */
router.delete('/profissionais/:id/procedimentos/:procedimentoId', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
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
        p.ativo 
      FROM profissionais p
      INNER JOIN profissional_procedimento pp ON p.id = pp.id_profissional
      WHERE pp.id_procedimento = ? AND p.ativo = 1
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
