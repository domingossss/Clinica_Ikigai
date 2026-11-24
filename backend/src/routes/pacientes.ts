import type { ResultSetHeader } from 'mysql2/promise';
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import pool, { ErroOperacao, executarTransacao } from '../config/database.js';
import { sanitizarTexto, validarCPF, registrarErro } from '../middleware/security.js';
import { normalizarTelefone } from '../services/telefone.js';
import { reservaExcepcionalNaOcorrencia } from '../services/reservasAgenda.js';
const router = Router();

const camposCadastro = `p.uuid AS id, p.id_paciente, p.versao, p.nome AS nome_completo,
  p.cpf, p.telefone, p.whatsapp, p.endereco, p.etapa_tratamento, p.atendimento_status, p.criado_em`;
const atendimentoDoPaciente = (alias: string) =>
  `(${alias}.paciente_uuid = p.uuid OR (COALESCE(${alias}.paciente_uuid, '') = '' AND ${alias}.id_paciente = p.id_paciente))`;
const vinculoAssistencial = `EXISTS (
  SELECT 1 FROM agendamento AS atendimento
  WHERE atendimento.id_profissional = ? AND ${atendimentoDoPaciente('atendimento')}
    AND atendimento.status NOT IN ('Cancelado', 'No_Show')
    AND (atendimento.checkin_recepcao = 1 OR NOT ${reservaExcepcionalNaOcorrencia('atendimento')})
)`;

function escopoPaciente(req: Request) {
  if (req.usuario?.perfil !== 'PROFISSIONAL') return { clausula: '', parametros: [] };
  return { clausula: ` AND ${vinculoAssistencial}`, parametros: [req.usuario.profissional_id ?? null] };
}

function consultarPaciente(req: Request, id: string, campos = camposCadastro) {
  const chave = /^\d+$/.test(id) ? 'p.id_paciente' : 'p.uuid';
  const { clausula, parametros } = escopoPaciente(req);
  return pool.query<any[]>(`SELECT ${campos} FROM paciente AS p WHERE ${chave} = ?${clausula} LIMIT 1`, [id, ...parametros]);
}
type Evolucao = { etapa_tratamento: string; historico_clinico: string | null; observacoes: string | null };

function gravarEdicaoPaciente(req: Request, paciente: { id: string } & Evolucao,
  posterior: Evolucao, sql: string, parametros: unknown[]) {
  return executarTransacao(async db => {
    const [resultado] = await db.query<ResultSetHeader>(sql, parametros);
    if (!resultado.affectedRows || !req.usuario) return resultado;
    const { etapa_tratamento, historico_clinico, observacoes } = paciente;
    const anterior = { etapa_tratamento, historico_clinico, observacoes };
    if (JSON.stringify(anterior) !== JSON.stringify(posterior)) {
      await db.query(`INSERT INTO paciente_evolucao (paciente_uuid, versao, autor_id, autor_nome, anterior, posterior)
        VALUES (?, ?, ?, ?, ?, ?)`, [paciente.id, req.body.versao + 1, req.usuario.id, req.usuario.nome,
        JSON.stringify(anterior), JSON.stringify(posterior)]);
    }
    return resultado;
  });
}

router.get('/pacientes', async (req: Request, res: Response): Promise<any> => {
  try {
    const pagina = Math.max(1, Math.min(100000, Number(req.query.pagina) || 1));
    const limite = Math.max(1, Math.min(100, Number(req.query.limite) || 100));
    if (!Number.isInteger(pagina) || !Number.isInteger(limite)) return res.status(400).json({sucesso:false,erro:'Paginação inválida.'});
    const busca = String(req.query.busca || '').slice(0,150);
    const termo = '%' + busca + '%';
    const escopo = escopoPaciente(req);
    const filtro = '(p.nome LIKE ? OR p.cpf LIKE ? OR p.telefone LIKE ?)' + escopo.clausula;
    const filtros = [termo, termo, termo, ...escopo.parametros];
    const [total] = await pool.query<any[]>('SELECT COUNT(*) AS total FROM paciente AS p WHERE ' + filtro, filtros);
    const camposClinicos = req.usuario?.perfil === 'RECEPCAO' ? '' : ', p.observacoes, p.historico_clinico';
    const [rows] = await pool.query(`SELECT ${camposCadastro}${camposClinicos}
      FROM paciente AS p WHERE ${filtro} ORDER BY p.criado_em DESC, p.uuid LIMIT ? OFFSET ?`, [...filtros, limite, (pagina - 1) * limite]);
    return res.status(200).json({ sucesso:true, dados:rows, total:total[0].total, pagina, limite });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar pacientes:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar pacientes.' });
  }
});

// ============================================================================
// ENDPOINT: GET /api/pacientes/:id/historico (Histórico de atendimentos - IK-77)
// Critérios de Aceite:
// CA01 — Histórico em ordem cronológica
// CA02 — Informações mínimas: data, procedimento, profissional, situação (status)
// CA03 — Sem histórico: informa que não existem registros (total: 0, historico: [])
// ============================================================================
router.get('/pacientes/:id/historico', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { ordem = 'DESC' } = req.query;

    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'ID do paciente inválido ou não informado.' });
    }

    const sortDirection = String(ordem).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const [pacientes] = await consultarPaciente(req, id.trim());
    const profissionalId = req.usuario?.perfil === 'PROFISSIONAL' ? req.usuario.profissional_id : undefined;

    if (!pacientes || pacientes.length === 0) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Paciente não encontrado no sistema.'
      });
    }

    const paciente = pacientes[0];

    // 2. Buscar histórico de atendimentos em ordem cronológica (CA01 e CA02)
    const [historico]: any = await pool.query(
      `SELECT 
         a.id_agendamento AS id,
         DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
         a.status,
         a.tipo_atendimento,
         ${req.usuario?.perfil === 'RECEPCAO' ? 'NULL AS observacoes' : 'a.observacoes'},
         a.origem,
         a.valor_cobrado,
         p.id_procedimento AS servico_id,
         COALESCE(p.nome, 'Atendimento / Procedimento') AS servico_nome,
         COALESCE(p.duracao_minutos, 60) AS duracao_minutos,
         p.preco AS servico_preco,
         e.nome AS categoria_nome,
         pr.id_profissional AS profissional_id,
         COALESCE(pr.nome, 'Profissional da Clínica') AS profissional_nome,
         COALESCE(pr.especialidade_principal, 'Especialista') AS profissional_especialidade,
         a.criado_em
       FROM agendamento a
       LEFT JOIN procedimento p ON a.id_procedimento = p.id_procedimento
       LEFT JOIN especialidade e ON p.id_especialidade = e.id_especialidade
       LEFT JOIN profissional pr ON a.id_profissional = pr.id_profissional
       WHERE (a.paciente_uuid = ? OR (COALESCE(a.paciente_uuid, '') = '' AND a.id_paciente = ?))
         ${profissionalId === undefined ? '' : 'AND a.id_profissional = ?'}
       ORDER BY a.data ${sortDirection}, a.horario_inicio ${sortDirection}`,
      [paciente.id, paciente.id_paciente, ...(profissionalId === undefined ? [] : [profissionalId])]
    );

    // Resposta estruturada para atender CA01, CA02 e CA03
    return res.status(200).json({
      sucesso: true,
      mensagem: historico.length > 0 
        ? `${historico.length} atendimento(s) encontrado(s) no histórico.` 
        : 'Nenhum registro de atendimento encontrado para este paciente.',
      dados: {
        paciente: {
          id: paciente.id,
          id_paciente: paciente.id_paciente,
          nome_completo: paciente.nome_completo,
          cpf: paciente.cpf,
          telefone: paciente.telefone,
          whatsapp: paciente.whatsapp,
          endereco: paciente.endereco,
          etapa_tratamento: paciente.etapa_tratamento,
          criado_em: paciente.criado_em
        },
        historico,
        total: historico.length
      }
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar histórico do paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao consultar o histórico de atendimentos do paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/pacientes/:id (Detalhes de um paciente por ID ou UUID)
// ============================================================================
router.get('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'ID do paciente inválido.' });
    }

    const [rows] = await consultarPaciente(req, id.trim());

    if (!rows || rows.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente não encontrado.' });
    }

    return res.status(200).json({ sucesso: true, dados: rows[0] });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar paciente por ID:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar paciente.' });
  }
});

// ============================================================================
// ENDPOINT: POST /api/pacientes (Criar novo paciente sanitizado com UUID)
// ============================================================================
router.post('/pacientes', async (req: Request, res: Response): Promise<any> => {
  try {
    const { nome_completo, cpf, telefone, endereco } = req.body;

    if (!nome_completo || !cpf || !telefone || !endereco) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe nome_completo, cpf, telefone e endereco.'
      });
    }

    // Sanitizar numeros removendo tudo exceto digitos
    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanTelefone = normalizarTelefone(telefone);

    // Validacao algoritmica de CPF (digitos verificadores + rejeicao de CPFs com digitos iguais)
    if (!validarCPF(cleanCpf)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'CPF invalido. Verifique os digitos informados.'
      });
    }

    if (!cleanTelefone) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Telefone inválido. O número de telefone deve conter o DDD e de 10 a 15 dígitos.'
      });
    }

    // Validar CPF único
    const [existing] = await pool.query('SELECT id FROM pacientes WHERE cpf = ?', [cleanCpf]);
    if ((existing as any[]).length > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Este CPF já está cadastrado no sistema.'
      });
    }

    // Gerar ID UUID v4 nativamente no Node.js
    const id = randomUUID();

    // Sanitizar campos de texto (prevencao de XSS armazenado)
    const nomeSanitizado = sanitizarTexto(nome_completo);
    const enderecoSanitizado = sanitizarTexto(endereco);

    // Salvar paciente no MySQL (mapeando whatsapp para o telefone limpo)
    await pool.query(
      `INSERT INTO pacientes (id, nome_completo, cpf, telefone, whatsapp, endereco) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, nomeSanitizado, cleanCpf, cleanTelefone, cleanTelefone, enderecoSanitizado]
    );


    return res.status(201).json({
      sucesso: true,
      mensagem: 'Paciente cadastrado com sucesso!',
      dados: {
        id,
        nome_completo: nomeSanitizado,
        cpf: cleanCpf,
        telefone: cleanTelefone,
        endereco: enderecoSanitizado
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao cadastrar paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao processar o cadastro do paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: POST /api/pacientes/rapido (Pré-cadastro com apenas Nome e WhatsApp)
// ============================================================================
router.post('/pacientes/rapido', async (req: Request, res: Response): Promise<any> => {
  try {
    const { nome_completo, whatsapp, telefone, cpf } = req.body;

    if (!nome_completo || !nome_completo.trim()) {
      return res.status(400).json({
        sucesso: false,
        erro: 'O nome do paciente é obrigatório.'
      });
    }

    const cleanTelefone = normalizarTelefone(whatsapp || telefone);

    if (!cleanTelefone) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Telefone/WhatsApp inválido. Informe o DDD e o número (mínimo 10 dígitos).'
      });
    }

    const nomeSanitizado = sanitizarTexto(nome_completo);
    const finalCpf = cpf ? cpf.replace(/\D/g, '') : null;
    if (finalCpf !== null && !validarCPF(finalCpf)) return res.status(400).json({ sucesso:false, erro:'CPF inválido.' });
    if (finalCpf) {
      const [duplicados] = await pool.query<any[]>('SELECT id FROM pacientes WHERE cpf = ?', [finalCpf]);
      if (duplicados.length) return res.status(409).json({ sucesso:false, erro:'CPF já cadastrado. Selecione o paciente existente.' });
    }
    const id = randomUUID();

    await pool.query(
      `INSERT INTO pacientes (id, nome_completo, cpf, telefone, whatsapp, endereco, etapa_tratamento, atendimento_status) 
       VALUES (?, ?, ?, ?, ?, ?, 'Avaliação', 'Humano')`,
      [
        id, 
        nomeSanitizado, 
        finalCpf, 
        cleanTelefone, 
        cleanTelefone, 
        'Pré-cadastro rápido - Aguardando dados completos na recepção'
      ]
    );


    return res.status(201).json({
      sucesso: true,
      mensagem: 'Paciente pré-cadastrado com sucesso!',
      dados: {
        id,
        nome: nomeSanitizado,
        nome_completo: nomeSanitizado,
        whatsapp: cleanTelefone,
        telefone: cleanTelefone
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro no pré-cadastro rápido de paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao realizar pré-cadastro do paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/profissionais (Listar todos os profissionais/terapeutas)
// Permite filtrar por procedimento_id ou servico_id (IK-80 CA03)
// ============================================================================

router.put('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { nome_completo, cpf, telefone, endereco, etapa_tratamento, historico_clinico, observacoes, atendimento_status } = req.body;

    const [existing] = await consultarPaciente(req, id, `${camposCadastro}, p.historico_clinico, p.observacoes`);
    if (existing.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente nao cadastrado.' });
    }
    const pacienteAtual = existing[0];
    const pacienteUuid = pacienteAtual.id;
    if (!Number.isSafeInteger(req.body.versao) || req.body.versao < 0) return res.status(428).json({ sucesso:false, erro:'Atualize o cadastro antes de editar.' });

    if (Number(pacienteAtual.versao) !== req.body.versao) {
      return res.status(409).json({ sucesso: false, erro: 'Este cadastro foi alterado em outra tela. Recarregue os dados antes de salvar.' });
    }

    const camposClinicos = { etapa_tratamento, historico_clinico, observacoes };
    if (req.usuario?.perfil === 'RECEPCAO' && Object.values(camposClinicos).some(valor => valor !== undefined)) {
      return res.status(403).json({ sucesso: false, erro: 'A recepção pode atualizar somente os dados cadastrais.' });
    }
    if (Object.values(camposClinicos).some(valor => valor !== undefined && valor !== null && typeof valor !== 'string')) {
      return res.status(400).json({ sucesso: false, erro: 'Os campos clínicos devem ser textos.' });
    }
    const posterior: Evolucao = {
      etapa_tratamento: etapa_tratamento === undefined ? pacienteAtual.etapa_tratamento : sanitizarTexto(etapa_tratamento ?? '') || 'Avaliação',
      historico_clinico: historico_clinico === undefined ? pacienteAtual.historico_clinico : sanitizarTexto(historico_clinico ?? '') || null,
      observacoes: observacoes === undefined ? pacienteAtual.observacoes : sanitizarTexto(observacoes ?? '') || null,
    };

    // Se for PROFISSIONAL, permite editar apenas a evolução clínica (etapa_tratamento, historico_clinico, observacoes)
    if (req.usuario?.perfil === 'PROFISSIONAL') {
      const resultado = await gravarEdicaoPaciente(req, pacienteAtual, posterior,
        `UPDATE paciente AS p
         SET versao = versao + 1,
             etapa_tratamento = ?,
             historico_clinico = ?,
             observacoes = ?
         WHERE p.uuid = ? AND p.versao = ? AND ${vinculoAssistencial}`,
        [posterior.etapa_tratamento, posterior.historico_clinico, posterior.observacoes, pacienteAtual.id, req.body.versao, req.usuario.profissional_id]
      );

      if (!resultado.affectedRows) return res.status(409).json({ sucesso: false, erro: 'Este cadastro foi alterado em outra tela. Recarregue os dados antes de salvar.' });
      return res.status(200).json({
        sucesso: true,
        mensagem: 'Evolução clínica do paciente atualizada com sucesso!',
        dados: {
          ...pacienteAtual,
          versao: req.body.versao + 1,
          ...posterior
        }
      });
    }

    if (!nome_completo || !cpf || !telefone || !endereco) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe nome_completo, cpf, telefone e endereco.'
      });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanTelefone = normalizarTelefone(telefone);

    // Validacao algoritmica de CPF
    if (!validarCPF(cleanCpf)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'CPF invalido. Verifique os digitos informados.'
      });
    }

    if (!cleanTelefone) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Telefone invalido. O numero de telefone deve conter o DDD e de 10 a 15 digitos.'
      });
    }

    // Verificar se o novo CPF já está cadastrado em outro paciente
    const [dupCpf] = await pool.query('SELECT id FROM pacientes WHERE cpf = ? AND id != ?', [cleanCpf, pacienteUuid]);
    if ((dupCpf as any[]).length > 0) {
      return res.status(400).json({ sucesso: false, erro: 'Este CPF já está cadastrado em outro paciente.' });
    }

    // Sanitizar campos de texto
    const nomeSanitizado = sanitizarTexto(nome_completo);
    const enderecoSanitizado = sanitizarTexto(endereco);

    // Compare e grave na mesma instrução para não perder edições concorrentes.
    const atualizado = await gravarEdicaoPaciente(req, pacienteAtual, posterior,
      `UPDATE pacientes 
       SET versao = versao + 1, nome_completo = ?, cpf = ?, telefone = ?, whatsapp = ?, endereco = ?, 
           etapa_tratamento = ?, historico_clinico = ?, observacoes = ?,
           atendimento_status = COALESCE(?, atendimento_status)
       WHERE id = ? AND versao = ?`,
      [
        nomeSanitizado,
        cleanCpf,
        cleanTelefone,
        cleanTelefone,
        enderecoSanitizado,
        posterior.etapa_tratamento,
        posterior.historico_clinico,
        posterior.observacoes,
        atendimento_status ?? null,
        pacienteUuid, req.body.versao
      ]
    );


    if (!atualizado.affectedRows) return res.status(409).json({ sucesso:false, erro:'Este cadastro foi alterado em outra tela. Recarregue os dados antes de salvar.' });
    return res.status(200).json({
      sucesso: true,
      mensagem: 'Paciente atualizado com sucesso!',
      dados: {
        id,
        nome_completo: nomeSanitizado,
        cpf: cleanCpf,
        telefone: cleanTelefone,
        endereco: enderecoSanitizado,
        ...(req.usuario?.perfil === 'RECEPCAO' ? {} : posterior),
        atendimento_status
      }
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao atualizar paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao atualizar o paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/pacientes/:id (Excluir paciente sem vínculos de histórico)
// ============================================================================
router.delete('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    // Verificar se o paciente existe
    const [existing] = await pool.query('SELECT id FROM pacientes WHERE id = ?', [id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente nao cadastrado.' });
    }

    // A chave estrangeira impede excluir pacientes com histórico de agendamentos.
    await pool.query('DELETE FROM pacientes WHERE id = ?', [id]);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Paciente excluído com sucesso!'
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao excluir paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao excluir o paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/profissionais/:id/agenda (IK-81: Consultar agenda do profissional)
// CA01: Seleção do profissional e abertura de sua agenda
// CA02: Exibição dos compromissos e bloqueios do profissional no período
// CA03: Navegação entre períodos (dia, semana, mês ou intervalo personalizado)
// ============================================================================

export default router;
