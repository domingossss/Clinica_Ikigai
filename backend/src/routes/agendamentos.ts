import servicosRouter from './servicos.js';
import pacientesRouter from './pacientes.js';
import { Router, Request, Response } from 'express';
import {
  validarPeriodoAgenda,
  calcularIntervaloSemana,
  calcularResumoAgenda,
  validarJornadaProfissional,
  validarExcecaoDisponibilidade
} from '../utils/validation.js';
import pool, { ErroOperacao, obterJanelasAgenda, transacaoAgenda, type ConsultaBanco } from '../config/database.js';
import { horarioCabeNasJanelas } from '../utils/validation.js';
import { type PoolConnection } from 'mysql2/promise';
import {
  registrarErro,
  sanitizarTexto,
  validarFormatoData,
  validarIdNumerico
} from '../middleware/security.js';

const router = Router();
router.use((req, res, next) => {
  if (!['POST','PUT','PATCH'].includes(req.method)) return next();
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) { res.status(400).json({ sucesso:false, erro:'Corpo inválido.' }); return; }
  for (const campo of ['nome','nome_completo','cpf','telefone','whatsapp','endereco','historico_clinico','etapa_tratamento','observacoes','especialidade','atendimento_status']) {
    if (body[campo] != null && typeof body[campo] !== 'string') { res.status(400).json({ sucesso:false, erro:'Campo inválido: '+campo }); return; }
  }
  for (const campo of ['categoria_id','servico_id','profissional_id','id_profissional']) {
    if (body[campo] != null && (!['string','number'].includes(typeof body[campo]) || !Number.isSafeInteger(Number(body[campo])) || Number(body[campo]) < 1)) { res.status(400).json({sucesso:false,erro:'Identificador inválido: '+campo}); return; }
  }
  for (const campo of ['nome','nome_completo']) {
    if (body[campo] !== undefined && (!sanitizarTexto(body[campo]) || body[campo].length > 150)) { res.status(400).json({ sucesso:false, erro:'Informe um nome válido, até 150 caracteres.' }); return; }
  }
  if (req.path.endsWith('/status') && !req.path.startsWith('/agendamentos/') && ![0,1,true,false].includes(body.ativo)) { res.status(400).json({ sucesso:false, erro:'Informe ativo como 0 ou 1.' }); return; }
  if (body.atendimento_status !== undefined && !['IA','Humano'].includes(body.atendimento_status)) { res.status(400).json({sucesso:false,erro:'Status de atendimento inválido.'}); return; }
  if (body.tipo_atendimento !== undefined && !['Primeira_Consulta','Retorno'].includes(body.tipo_atendimento)) { res.status(400).json({sucesso:false,erro:'Tipo de atendimento inválido.'}); return; }
  next();
});

router.use(pacientesRouter);
router.use(servicosRouter);

function idPositivo(valor: unknown): number {
  if (!['string', 'number'].includes(typeof valor)) throw new ErroOperacao(400, 'Identificador inválido.');
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id < 1) throw new ErroOperacao(400, 'Identificador inválido.');
  return id;
}
function validarDataHora(data: unknown, inicio: unknown) {
  if (typeof data !== 'string' || !validarFormatoData(data)) throw new ErroOperacao(400, 'Data inválida. Use YYYY-MM-DD.');
  if (typeof inicio !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(inicio)) throw new ErroOperacao(400, 'Horário inválido. Use HH:MM.');
}
function responderFalha(res: Response, erro: unknown) {
  if (erro instanceof ErroOperacao) return res.status(erro.status).json({ sucesso: false, erro: erro.message });
  registrarErro('[Agenda]', erro);
  const codigo = (erro as { code?: string })?.code;
  const temporario = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(codigo || '');
  return res.status(temporario ? 503 : 500).json({ sucesso: false, erro: temporario ? 'Serviço temporariamente indisponível. Tente novamente.' : 'Não foi possível concluir a operação.' });
}
async function validarReserva(banco: ConsultaBanco, profissionalId: number, servicoId: number, data: string, inicio: string, ignorarId = 0) {
  const [profissionais] = await banco.query<any[]>('SELECT ativo FROM profissional WHERE id_profissional = ?', [profissionalId]);
  if (!profissionais.length || !profissionais[0].ativo) throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');
  const [servicos] = await banco.query<any[]>('SELECT * FROM procedimento WHERE id_procedimento = ? FOR SHARE', [servicoId]);
  if (!servicos.length || !servicos[0].ativo) throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');
  const [vinculos] = await banco.query<any[]>('SELECT 1 FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?', [profissionalId, servicoId]);
  if (!vinculos.length) throw new ErroOperacao(400, 'Profissional não habilitado para este procedimento.');
  const duracao = Number(servicos[0].duracao_minutos);
  if (!Number.isInteger(duracao) || duracao <= 0) throw new ErroOperacao(400, 'Duração do procedimento inválida.');
  const fim = formatMinsToTime(parseTimeToMins(inicio) + duracao + 15);
  const janelas = await obterJanelasAgenda(banco, profissionalId, data);
  if (!horarioCabeNasJanelas(inicio, fim, janelas)) throw new ErroOperacao(409, 'Horário fora da jornada disponível, intervalo ou exceção da data (incluindo 15 minutos de respiro).');
  const [conflitos] = await banco.query<any[]>(
    "SELECT id_agendamento FROM agendamento WHERE id_profissional = ? AND data = ? AND id_agendamento <> ? AND status <> 'Cancelado' AND ? < horario_fim AND horario_inicio < ?",
    [profissionalId, data, ignorarId, inicio, fim]);
  if (conflitos.length) throw new ErroOperacao(409, 'Conflito de agenda. O horário já está reservado.');
  const [bloqueios] = await banco.query<any[]>(
    'SELECT id_bloqueio FROM bloqueio_agenda WHERE id_profissional = ? AND data = ? AND ? < horario_fim AND horario_inicio < ?', [profissionalId, data, inicio, fim]);
  if (bloqueios.length) throw new ErroOperacao(409, 'Horário bloqueado na agenda.');
  return { fim, preco: Number(servicos[0].preco) };
}
async function gravarHistorico(conexao: PoolConnection, agendamento: any, status: string, atualizar: () => Promise<unknown>, motivo: string) {
  const [anteriores] = await conexao.query<any[]>('SELECT COALESCE(MAX(id_historico), 0) AS ultimo FROM historico_status_agendamento WHERE id_agendamento = ?', [agendamento.id_agendamento]);
  await atualizar();
  // Reaproveita o registro gerado pelo gatilho. Se o banco legado não tiver o gatilho,
  // registra na mesma transação, sem perder nem duplicar a auditoria.
  const [novos] = await conexao.query<any[]>('SELECT id_historico FROM historico_status_agendamento WHERE id_agendamento = ? AND id_historico > ? ORDER BY id_historico DESC LIMIT 1', [agendamento.id_agendamento, anteriores[0].ultimo]);
  if (novos.length) {
    await conexao.query('UPDATE historico_status_agendamento SET motivo = ?, alterado_por = ? WHERE id_historico = ?', [motivo, 'Recepção', novos[0].id_historico]);
  } else {
    await conexao.query('INSERT INTO historico_status_agendamento (id_agendamento, status_anterior, status_novo, motivo, alterado_por) VALUES (?, ?, ?, ?, ?)', [agendamento.id_agendamento, agendamento.status, status, motivo, 'Recepção']);
  }
}
async function verificarAgendaAposConfiguracao(conexao: PoolConnection, profissionalId: number | null, data?: string) {
  const params: unknown[] = [];
  let filtro = "status IN ('Agendado', 'Confirmado', 'Reagendado', 'Na Recepção', 'Em Atendimento')";
  if (profissionalId !== null) { filtro += ' AND id_profissional = ?'; params.push(profissionalId); }
  if (data) { filtro += ' AND data = ?'; params.push(data); } else { filtro += ' AND data >= CURDATE()'; }
  const [agendamentos] = await conexao.query<any[]>("SELECT id_agendamento, id_profissional, DATE_FORMAT(data, '%Y-%m-%d') AS data, horario_inicio, horario_fim FROM agendamento WHERE " + filtro, params);
  for (const ag of agendamentos) {
    const janelas = await obterJanelasAgenda(conexao, ag.id_profissional, ag.data);
    if (!horarioCabeNasJanelas(ag.horario_inicio, ag.horario_fim, janelas)) throw new ErroOperacao(409, 'A configuração conflita com o agendamento #' + ag.id_agendamento + '. Reagende ou cancele o atendimento primeiro.');
  }
}
async function profissionalDoAgendamento(id: number) {
  const [rows] = await pool.query<any[]>('SELECT id_profissional FROM agendamento WHERE id_agendamento = ?', [id]);
  if (!rows.length) throw new ErroOperacao(404, 'Agendamento não encontrado.');
  return Number(rows[0].id_profissional);
}


// ============================================================================
// AUXILIARY HELPER FUNCTIONS
// ============================================================================

function parseTimeToMins(timeStr: string): number {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return h * 60 + m;
}

function formatMinsToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}:00`;
}


// ============================================================================
// ENDPOINT: GET /api/janelas (Disponibilidade por data e profissional)
// ============================================================================
router.get('/janelas', async (req, res) => {
  try {
    validarDataHora(req.query.data, '08:00');
    const data = String(req.query.data);
    const inicio = req.query.periodo === 'semana' ? calcularIntervaloSemana(data).dataInicio : data;
    const [profs] = await pool.query<any[]>('SELECT id_profissional FROM profissional WHERE ativo = 1');
    const dados: { profissional_id: number; data: string; janelas: [number, number][] }[] = [];
    for (let i = 0; i < (req.query.periodo === 'semana' ? 7 : 1); i++) {
      const d = new Date(inicio + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
      const dia = d.toISOString().slice(0,10);
      for (const p of profs) dados.push({ profissional_id:p.id_profissional, data:dia, janelas:await obterJanelasAgenda(pool, p.id_profissional, dia) });
    }
    return res.json({ sucesso:true, dados });
  } catch (erro) { return responderFalha(res, erro); }
});
router.get('/disponibilidade', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, servico_id, profissional_id } = req.query;
    validarDataHora(data, '08:00');
    const profId = idPositivo(profissional_id || 1);
    const servId = idPositivo(servico_id);
    const dados = await transacaoAgenda([profId], async conexao => {
      const [servicos] = await conexao.query<any[]>('SELECT duracao_minutos, ativo FROM procedimento WHERE id_procedimento = ?', [servId]);
      if (!servicos.length || !servicos[0].ativo) throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');
      const [profs] = await conexao.query<any[]>('SELECT ativo FROM profissional WHERE id_profissional = ?', [profId]);
      const [vinculos] = await conexao.query<any[]>('SELECT 1 FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?', [profId, servId]);
      if (!profs[0].ativo || !vinculos.length) throw new ErroOperacao(400, 'Profissional inativo ou não habilitado.');
      const janelas = await obterJanelasAgenda(conexao, profId, data as string);
      const [agendamentos] = await conexao.query<any[]>(
        "SELECT a.id_agendamento AS id, TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio, TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim, p.nome AS paciente_nome, s.nome AS servico_nome FROM agendamento a JOIN paciente p ON p.uuid = a.paciente_uuid JOIN procedimento s ON s.id_procedimento = a.id_procedimento WHERE a.id_profissional = ? AND a.data = ? AND a.status <> 'Cancelado'", [profId, data]);
      const [bloqueios] = await conexao.query<any[]>("SELECT id_bloqueio AS id, TIME_FORMAT(horario_inicio, '%H:%i') AS horario_inicio, TIME_FORMAT(horario_fim, '%H:%i') AS horario_fim, motivo FROM bloqueio_agenda WHERE id_profissional = ? AND data = ?", [profId, data]);
      const slots: { horario: string; disponivel: boolean }[] = [];
      const duracao = Number(servicos[0].duracao_minutos) + 15;
      if (!Number.isInteger(duracao) || duracao <= 15) throw new ErroOperacao(400, 'Duração do procedimento inválida.');
      for (const [inicio, fim] of janelas) {
        for (let minuto = inicio; minuto + duracao <= fim; minuto += 30) {
          const disponivel = ![...agendamentos, ...bloqueios].some(a => minuto < parseTimeToMins(a.horario_fim) && parseTimeToMins(a.horario_inicio) < minuto + duracao);
          slots.push({ horario: formatMinsToTime(minuto).slice(0, 5), disponivel });
        }
      }
      return { dados: slots, ocupados: agendamentos, bloqueios };
    });
    return res.json({ sucesso: true, ...dados });
  } catch (erro) { return responderFalha(res, erro); }
});
// ============================================================================
// ENDPOINT: POST /api/agendamentos (Criar agendamento dinâmico)
// ============================================================================
router.post('/agendamentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { paciente_id, data, horario_inicio } = req.body;
    validarDataHora(data, horario_inicio);
    if (typeof paciente_id !== 'string' || !paciente_id.trim()) throw new ErroOperacao(400, 'Paciente é obrigatório.');
    const profissional_id = idPositivo(req.body.profissional_id);
    const servico_id = idPositivo(req.body.servico_id);
    const dados = await transacaoAgenda([profissional_id], async conexao => {
      const reserva = await validarReserva(conexao, profissional_id, servico_id, data, horario_inicio);
      const [pacientes] = await conexao.query<any[]>('SELECT id_paciente, uuid FROM paciente WHERE uuid = ? FOR UPDATE', [paciente_id]);
      if (!pacientes.length) throw new ErroOperacao(404, 'Paciente não cadastrado.');
      const [ocupado] = await conexao.query<any[]>("SELECT id_agendamento FROM agendamento WHERE paciente_uuid = ? AND data = ? AND status <> 'Cancelado' AND ? < horario_fim AND horario_inicio < ? FOR UPDATE", [paciente_id, data, horario_inicio, reserva.fim]);
      if (ocupado.length) throw new ErroOperacao(409, 'Paciente já possui atendimento neste horário.');
      const [resultado]: any = await conexao.query(
        "INSERT INTO agendamento (id_paciente, paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, data_hora_agendamento, valor_cobrado, observacoes, tipo_atendimento, origem, status) VALUES (?, ?, ?, ?, ?, ?, ?, TIMESTAMP(?, ?), ?, ?, ?, 'Humano_Recepcao', 'Agendado')",
        [pacientes[0].id_paciente, paciente_id, profissional_id, servico_id, data, horario_inicio, reserva.fim, data, horario_inicio, reserva.preco, sanitizarTexto(req.body.observacoes || ''), req.body.tipo_atendimento === 'Retorno' ? 'Retorno' : 'Primeira_Consulta']);
      if (resultado.affectedRows !== 1) throw new Error('Agendamento não gravado.');
      return { id: resultado.insertId, paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim: reserva.fim, status: 'Agendado' };
    });
    return res.status(201).json({ sucesso: true, mensagem: 'Agendamento cadastrado com sucesso!', dados });
  } catch (erro) { return responderFalha(res, erro); }
});

// ============================================================================
// ENDPOINT: GET /api/pacientes (Listar todos os pacientes registrados)
// ============================================================================
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
      if (procIds.length) {
        const [validos] = await conexao.query<any[]>('SELECT id_procedimento FROM procedimento WHERE id_procedimento IN (?) AND ativo = 1 FOR SHARE', [procIds]);
        if (validos.length !== procIds.length) throw new ErroOperacao(400, 'Procedimento inválido ou inativo.');
      }
      await conexao.query('DELETE FROM profissional_procedimento WHERE id_profissional = ?', [id]);
      if (procIds.length) await conexao.query('INSERT INTO profissional_procedimento (id_profissional, id_procedimento) VALUES ?', [procIds.map(procId => [id, procId])]);
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

// ============================================================================
// ENDPOINT: PUT /api/pacientes/:id (Editar paciente existente)
// ============================================================================
router.get('/profissionais/:id/agenda', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  const { data, data_inicio, data_fim, periodo } = req.query;

  if (!validarIdNumerico(id)) {
    return res.status(400).json({ sucesso: false, erro: 'ID do profissional inválido.' });
  }

  const profId = Number(id);

  // Determinar período de consulta (CA03)
  let dtInicio: string;
  let dtFim: string;
  let tipoPeriodo: string = (periodo as string) || 'dia';

  if (tipoPeriodo === 'semana') {
    const ref = (data as string) || (data_inicio as string) || new Date().toISOString().split('T')[0];
    if (!validarFormatoData(ref)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de data de referência inválido. Use YYYY-MM-DD.' });
    }
    const intervalo = calcularIntervaloSemana(ref);
    dtInicio = intervalo.dataInicio;
    dtFim = intervalo.dataFim;
  } else if (data_inicio && data_fim) {
    dtInicio = data_inicio as string;
    dtFim = data_fim as string;
    tipoPeriodo = 'personalizado';
  } else {
    const dataRef = (data as string) || (data_inicio as string) || new Date().toISOString().split('T')[0];
    dtInicio = dataRef;
    dtFim = dataRef;
    tipoPeriodo = 'dia';
  }

  // Validar intervalo de datas
  const validacao = validarPeriodoAgenda(dtInicio, dtFim);
  if (!validacao.valido) {
    return res.status(400).json({ sucesso: false, erro: validacao.motivo });
  }

  try {
    // 1. Verificar se o profissional existe (CA01)
    const [profs]: any = await pool.query(
      'SELECT id, nome, especialidade, ativo FROM profissionais WHERE id = ?',
      [profId]
    );

    if (profs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    const profissional = profs[0];

    // 2. Buscar agendamentos do profissional no período (CA02)
    const [agendamentos]: any = await pool.query(
      `SELECT 
         a.id,
         DATE_FORMAT(a.data, '%Y-%m-%d') as data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') as horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') as horario_fim,
         a.status,
         p.id as paciente_id,
         p.nome_completo as paciente_nome,
         p.whatsapp as paciente_whatsapp,
         pr.id as profissional_id,
         pr.nome as profissional_nome,
         s.id as servico_id,
         s.nome as servico_nome,
         s.duracao_minutos,
         s.preco
       FROM agendamentos a
       JOIN pacientes p ON a.paciente_id = p.id
       JOIN profissionais pr ON a.profissional_id = pr.id
       JOIN servicos s ON a.servico_id = s.id
       WHERE a.profissional_id = ?
         AND a.data >= ?
         AND a.data <= ?
         AND a.status != 'Cancelado'
       ORDER BY a.data ASC, a.horario_inicio ASC`,
      [profId, dtInicio, dtFim]
    );

    // 3. Buscar bloqueios do profissional no período (IK-87 & IK-81)
    let bloqueios: any[] = [];
    try {
      const [blRows]: any = await pool.query(
        `SELECT 
           id,
           profissional_id,
           DATE_FORMAT(data, '%Y-%m-%d') as data,
           TIME_FORMAT(horario_inicio, '%H:%i') as horario_inicio,
           TIME_FORMAT(horario_fim, '%H:%i') as horario_fim,
           motivo
         FROM bloqueios
         WHERE profissional_id = ?
           AND data >= ?
           AND data <= ?
         ORDER BY data ASC, horario_inicio ASC`,
        [profId, dtInicio, dtFim]
      );
      bloqueios = blRows;
    } catch (erro) { throw erro; }

    const resumo = calcularResumoAgenda(agendamentos, bloqueios.length);

    return res.status(200).json({
      sucesso: true,
      profissional,
      periodo: {
        data_inicio: dtInicio,
        data_fim: dtFim,
        tipo: tipoPeriodo
      },
      dados: agendamentos,
      bloqueios,
      resumo
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao consultar agenda do profissional:', error);
    return responderFalha(res, error);
  }
});

// ============================================================================
// ENDPOINT: GET /api/agendamentos/dia?data=YYYY-MM-DD (Grade de Agenda do Dia)
// Suporta filtro opcional por profissional_id (IK-81)
// ============================================================================
router.get('/agendamentos/dia', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, profissional_id } = req.query;

    if (!data) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Parâmetro data (YYYY-MM-DD) é obrigatório.'
      });
    }

    if (!validarFormatoData(data as string)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de data inválido. Use YYYY-MM-DD.' });
    }

    if (profissional_id && !validarIdNumerico(profissional_id as string)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do profissional inválido.' });
    }

    let queryAg = `
      SELECT 
         a.id,
         DATE_FORMAT(a.data, '%Y-%m-%d') as data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') as horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') as horario_fim,
         a.status,
         p.id as paciente_id,
         p.nome_completo as paciente_nome,
         p.whatsapp as paciente_whatsapp,
         pr.id as profissional_id,
         pr.nome as profissional_nome,
         s.nome as servico_nome,
         s.duracao_minutos
       FROM agendamentos a
       JOIN pacientes p ON a.paciente_id = p.id
       JOIN profissionais pr ON a.profissional_id = pr.id
       JOIN servicos s ON a.servico_id = s.id
       WHERE a.data = ? AND a.status != 'Cancelado'
    `;
    const paramsAg: any[] = [data as string];

    if (profissional_id) {
      queryAg += ` AND a.profissional_id = ?`;
      paramsAg.push(Number(profissional_id));
    }

    queryAg += ` ORDER BY pr.id, a.horario_inicio`;

    const [rows] = await pool.query(queryAg, paramsAg);

    // Buscar bloqueios de horários do dia (IK-87)
    let bloqueios: any[] = [];
    try {
      let queryBl = `
        SELECT 
           id,
           profissional_id,
           DATE_FORMAT(data, '%Y-%m-%d') as data,
           TIME_FORMAT(horario_inicio, '%H:%i') as horario_inicio,
           TIME_FORMAT(horario_fim, '%H:%i') as horario_fim,
           motivo
         FROM bloqueios
         WHERE data = ?
      `;
      const paramsBl: any[] = [data as string];
      if (profissional_id) {
        queryBl += ` AND profissional_id = ?`;
        paramsBl.push(Number(profissional_id));
      }
      queryBl += ` ORDER BY profissional_id, horario_inicio`;

      const [blRows] = await pool.query(queryBl, paramsBl);
      bloqueios = blRows as any[];
    } catch (erro) { throw erro; }

    return res.status(200).json({ sucesso: true, dados: rows, bloqueios });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar grade de agenda:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar agenda do dia.' });
  }
});

// ============================================================================
// ENDPOINT: PUT /api/agendamentos/:id/status (Atualizar status do agendamento)
// ============================================================================
router.put('/agendamentos/:id/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    const { status } = req.body;
    const transicoes: Record<string, string[]> = {
      Agendado: ['Confirmado', 'Na Recepção', 'Cancelado', 'No_Show'],
      Confirmado: ['Na Recepção', 'Cancelado', 'No_Show'],
      'Na Recepção': ['Em Atendimento', 'Cancelado'],
      'Em Atendimento': ['Concluído'],
      Reagendado: ['Confirmado', 'Na Recepção', 'Cancelado', 'No_Show']
    };
    const profissionalId = await profissionalDoAgendamento(id);
    if (req.usuario?.perfil === 'PROFISSIONAL') {
      if (!req.usuario.profissional_id || Number(req.usuario.profissional_id) !== Number(profissionalId)) {
        throw new ErroOperacao(403, 'Você só pode atualizar o status de atendimentos da sua própria agenda.');
      }
    }
    await transacaoAgenda([profissionalId], async conexao => {
      const [rows] = await conexao.query<any[]>('SELECT * FROM agendamento WHERE id_agendamento = ? FOR UPDATE', [id]);
      const atual = rows[0];
      if (!atual) throw new ErroOperacao(404, 'Agendamento não encontrado.');
      if (status === atual.status) return;
      if (typeof status !== 'string' || !transicoes[atual.status]?.includes(status)) throw new ErroOperacao(409, 'Mudança de status não permitida para este atendimento.');
      const motivo = sanitizarTexto(typeof req.body.motivo === 'string' ? req.body.motivo : '') || ('Status alterado para ' + status);
      await gravarHistorico(conexao, atual, status, () => conexao.query("UPDATE agendamento SET status = ?, data_hora_checkin = IF(? = 'Na Recepção', NOW(), data_hora_checkin), data_hora_inicio_atendimento = IF(? = 'Em Atendimento', NOW(), data_hora_inicio_atendimento), minutos_atraso = IF(? = 'Em Atendimento', GREATEST(0, TIMESTAMPDIFF(MINUTE, TIMESTAMP(data, horario_inicio), NOW())), minutos_atraso) WHERE id_agendamento = ?", [status, status, status, status, id]), motivo);
    });
    return res.json({ sucesso: true, mensagem: 'Status atualizado com sucesso!', dados: { id, status } });
  } catch (erro) { return responderFalha(res, erro); }
});
// ============================================================================
// ENDPOINT: PUT /api/agendamentos/:id/reagendar (Reagendar atendimento - IK-85)
// ============================================================================
router.put('/agendamentos/:id/reagendar', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    const { data, horario_inicio, motivo } = req.body;
    validarDataHora(data, horario_inicio);
    const profissionalId = await profissionalDoAgendamento(id);
    const dados = await transacaoAgenda([profissionalId], async conexao => {
      const [rows] = await conexao.query<any[]>("SELECT *, DATE_FORMAT(data, '%Y-%m-%d') AS data FROM agendamento WHERE id_agendamento = ? FOR UPDATE", [id]);
      const atual = rows[0];
      if (!atual) throw new ErroOperacao(404, 'Agendamento não encontrado.');
      if (['Cancelado', 'No_Show', 'Concluído', 'Realizado', 'Em Atendimento'].includes(atual.status)) throw new ErroOperacao(409, 'Este atendimento não pode ser reagendado no status atual.');
      const reserva = await validarReserva(conexao, profissionalId, atual.id_procedimento, data, horario_inicio, id);
      await conexao.query('SELECT id_paciente FROM paciente WHERE uuid = ? FOR UPDATE', [atual.paciente_uuid]);
      const [ocupado] = await conexao.query<any[]>("SELECT id_agendamento FROM agendamento WHERE paciente_uuid = ? AND data = ? AND id_agendamento <> ? AND status <> 'Cancelado' AND ? < horario_fim AND horario_inicio < ? FOR UPDATE", [atual.paciente_uuid, data, id, horario_inicio, reserva.fim]);
      if (ocupado.length) throw new ErroOperacao(409, 'Paciente já possui atendimento neste horário.');
      const texto = sanitizarTexto(typeof motivo === 'string' ? motivo : '') || ('Reagendado para ' + data + ' às ' + horario_inicio);
      await gravarHistorico(conexao, atual, 'Reagendado', () => conexao.query("UPDATE agendamento SET data = ?, horario_inicio = ?, horario_fim = ?, data_hora_agendamento = TIMESTAMP(?, ?), status = 'Reagendado' WHERE id_agendamento = ?", [data, horario_inicio, reserva.fim, data, horario_inicio, id]), texto);
      return { id, data, horario_inicio, horario_fim: reserva.fim, status: 'Reagendado' };
    });
    return res.json({ sucesso: true, mensagem: 'Atendimento reagendado com sucesso!', dados });
  } catch (erro) { return responderFalha(res, erro); }
});
// ============================================================================
// ENDPOINT: GET /api/agendamentos/:id/historico (Histórico de alterações - IK-97)
// ============================================================================
router.get('/agendamentos/:id/historico', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    const [agendamentoRows] = await pool.query<any[]>(
      `SELECT a.id_agendamento AS id,
              DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
              TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
              TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
              a.status,
              a.origem,
              DATE_FORMAT(a.data_hora_criacao, '%Y-%m-%dT%H:%i:%s') AS criado_em,
              p.nome AS paciente_nome,
              pr.nome AS profissional_nome,
              s.nome AS servico_nome
       FROM agendamento a
       JOIN paciente p ON p.uuid = a.paciente_uuid
       JOIN profissional pr ON pr.id_profissional = a.id_profissional
       JOIN procedimento s ON s.id_procedimento = a.id_procedimento
       WHERE a.id_agendamento = ?`,
      [id]
    );
    if (!agendamentoRows.length) throw new ErroOperacao(404, 'Agendamento não encontrado.');

    const [historico] = await pool.query<any[]>(
      `SELECT id_historico AS id,
              id_agendamento,
              status_anterior,
              status_novo,
              motivo,
              alterado_por,
              DATE_FORMAT(data_alteracao, '%Y-%m-%dT%H:%i:%s') AS data_alteracao
       FROM historico_status_agendamento
       WHERE id_agendamento = ?
       ORDER BY data_alteracao DESC, id_historico DESC`,
      [id]
    );

    return res.json({
      sucesso: true,
      dados: {
        agendamento: agendamentoRows[0],
        historico
      }
    });
  } catch (erro) { return responderFalha(res, erro); }
});
// ============================================================================
// ENDPOINT: POST /api/bloqueios (Criar bloqueio de horário na agenda - IK-87)
// ============================================================================
router.post('/bloqueios', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, horario_inicio, horario_fim } = req.body;
    validarDataHora(data, horario_inicio);
    validarDataHora(data, horario_fim);
    const profissional_id = idPositivo(req.body.profissional_id);
    if (req.usuario?.perfil === 'PROFISSIONAL') {
      if (!req.usuario.profissional_id || Number(req.usuario.profissional_id) !== Number(profissional_id)) {
        throw new ErroOperacao(403, 'Você só pode criar bloqueios de horário na sua própria agenda.');
      }
    }
    if (parseTimeToMins(horario_inicio) >= parseTimeToMins(horario_fim)) throw new ErroOperacao(400, 'Início deve ser anterior ao fim.');
    const motivo = sanitizarTexto(typeof req.body.motivo === 'string' ? req.body.motivo : '') || 'Horário Bloqueado';
    const id = await transacaoAgenda([profissional_id], async conexao => {
      const [ag] = await conexao.query<any[]>("SELECT id_agendamento FROM agendamento WHERE id_profissional = ? AND data = ? AND status <> 'Cancelado' AND ? < horario_fim AND horario_inicio < ?", [profissional_id, data, horario_inicio, horario_fim]);
      const [bl] = await conexao.query<any[]>('SELECT id_bloqueio FROM bloqueio_agenda WHERE id_profissional = ? AND data = ? AND ? < horario_fim AND horario_inicio < ?', [profissional_id, data, horario_inicio, horario_fim]);
      if (ag.length || bl.length) throw new ErroOperacao(409, 'O bloqueio conflita com um atendimento ou outro bloqueio.');
      const [resultado]: any = await conexao.query('INSERT INTO bloqueio_agenda (id_profissional, data, horario_inicio, horario_fim, motivo) VALUES (?, ?, ?, ?, ?)', [profissional_id, data, horario_inicio, horario_fim, motivo]);
      return resultado.insertId;
    });
    return res.status(201).json({ sucesso: true, mensagem: 'Horário bloqueado com sucesso!', dados: { id, profissional_id, data, horario_inicio, horario_fim, motivo } });
  } catch (erro) { return responderFalha(res, erro); }
});
// ============================================================================
// ENDPOINT: GET /api/bloqueios (Consultar bloqueios da agenda - IK-87)
// ============================================================================
router.get('/bloqueios', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, profissional_id } = req.query;

    let sql = `
      SELECT 
        b.id,
        b.profissional_id,
        pr.nome as profissional_nome,
        DATE_FORMAT(b.data, '%Y-%m-%d') as data,
        TIME_FORMAT(b.horario_inicio, '%H:%i') as horario_inicio,
        TIME_FORMAT(b.horario_fim, '%H:%i') as horario_fim,
        b.motivo,
        b.criado_em
      FROM bloqueios b
      JOIN profissionais pr ON b.profissional_id = pr.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (data) {
      sql += ' AND b.data = ?';
      params.push(data);
    }
    if (profissional_id) {
      sql += ' AND b.profissional_id = ?';
      params.push(profissional_id);
    }

    sql += ' ORDER BY b.data, b.horario_inicio';

    const [rows] = await pool.query(sql, params);
    return res.status(200).json({ sucesso: true, dados: rows });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar bloqueios:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao consultar bloqueios.' });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/bloqueios/:id (Remover bloqueio da agenda - IK-87)
// ============================================================================
router.delete('/bloqueios/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do bloqueio inválido.' });
    }

    const [existing]: any = await pool.query('SELECT id_bloqueio, id_profissional FROM bloqueio_agenda WHERE id_bloqueio = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Bloqueio não encontrado.' });
    }

    if (req.usuario?.perfil === 'PROFISSIONAL') {
      if (!req.usuario.profissional_id || Number(req.usuario.profissional_id) !== Number(existing[0].id_profissional)) {
        return res.status(403).json({
          sucesso: false,
          erro: 'Você só pode remover bloqueios de horário da sua própria agenda.'
        });
      }
    }

    await pool.query('DELETE FROM bloqueio_agenda WHERE id_bloqueio = ?', [id]);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Bloqueio removido com sucesso! O horário voltou a ficar disponível para novos atendimentos.'
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao remover bloqueio:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao remover bloqueio.' });
  }
});

// ============================================================================
// ENDPOINTS IK-14: JORNADA E INTERVALOS DOS PROFISSIONAIS
// ============================================================================
router.get('/profissionais/:id/jornada', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do profissional inválido.' });
    }

    const [rows]: any = await pool.query(
      `SELECT id_jornada, id_profissional, dia_semana, ativo, 
              TIME_FORMAT(horario_inicio, '%H:%i') as horario_inicio, 
              TIME_FORMAT(horario_fim, '%H:%i') as horario_fim, 
              TIME_FORMAT(intervalo_inicio, '%H:%i') as intervalo_inicio, 
              TIME_FORMAT(intervalo_fim, '%H:%i') as intervalo_fim 
       FROM jornada_profissional 
       WHERE id_profissional = ? 
       ORDER BY dia_semana`,
      [id]
    );

    const diasNomes = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const resultado = [0, 1, 2, 3, 4, 5, 6].map(dia => {
      const encontrada = rows.find((r: any) => r.dia_semana === dia);
      if (encontrada) {
        return { ...encontrada, dia_nome: diasNomes[dia] };
      }
      const ehDiaUtil = dia >= 1 && dia <= 5;
      return {
        id_profissional: Number(id),
        dia_semana: dia,
        dia_nome: diasNomes[dia],
        ativo: ehDiaUtil ? 1 : 0,
        horario_inicio: '08:00',
        horario_fim: '18:00',
        intervalo_inicio: ehDiaUtil ? '12:00' : null,
        intervalo_fim: ehDiaUtil ? '13:00' : null
      };
    });

    return res.status(200).json({ sucesso: true, dados: resultado });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar jornada do profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao consultar jornada do profissional.' });
  }
});

router.put('/profissionais/:id/jornada', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    if (req.usuario?.perfil === 'PROFISSIONAL') {
      if (!req.usuario.profissional_id || Number(req.usuario.profissional_id) !== Number(id)) {
        throw new ErroOperacao(403, 'Você só pode alterar a jornada de trabalho da sua própria agenda.');
      }
    }
    const { dias } = req.body;
    if (!Array.isArray(dias) || !dias.length || dias.length > 7) throw new ErroOperacao(400, 'Informe os dias da jornada (máximo de sete).');
    const vistos = new Set<number>();
    for (const dia of dias) {
      if (!dia || !Number.isInteger(dia.dia_semana) || dia.dia_semana < 0 || dia.dia_semana > 6 || vistos.has(dia.dia_semana)) throw new ErroOperacao(400, 'Dia da semana inválido ou duplicado.');
      vistos.add(dia.dia_semana);
      if (![0, 1, true, false].includes(dia.ativo)) throw new ErroOperacao(400, 'Status da jornada inválido.');
      if (dia.ativo) {
        const val = validarJornadaProfissional(dia.horario_inicio, dia.horario_fim, dia.intervalo_inicio || null, dia.intervalo_fim || null);
        if (!val.valido) throw new ErroOperacao(400, val.motivo || 'Jornada inválida.');
      }
    }
    await transacaoAgenda([id], async conexao => {
      for (const d of dias) {
        await conexao.query('INSERT INTO jornada_profissional (id_profissional, dia_semana, ativo, horario_inicio, horario_fim, intervalo_inicio, intervalo_fim) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ativo = VALUES(ativo), horario_inicio = VALUES(horario_inicio), horario_fim = VALUES(horario_fim), intervalo_inicio = VALUES(intervalo_inicio), intervalo_fim = VALUES(intervalo_fim)', [id, d.dia_semana, d.ativo ? 1 : 0, d.ativo ? d.horario_inicio : '08:00', d.ativo ? d.horario_fim : '18:00', d.ativo ? d.intervalo_inicio || null : null, d.ativo ? d.intervalo_fim || null : null]);
      }
      await verificarAgendaAposConfiguracao(conexao, id);
    });
    return res.json({ sucesso: true, mensagem: 'Jornada salva com sucesso!' });
  } catch (erro) { return responderFalha(res, erro); }
});
// ============================================================================
// ENDPOINTS IK-83: EXCEÇÕES DE DISPONIBILIDADE
// ============================================================================
router.get('/excecoes', async (req: Request, res: Response): Promise<any> => {
  try {
    const { profissional_id } = req.query;
    let sql = `
      SELECT e.id_excecao as id, DATE_FORMAT(e.data, '%Y-%m-%d') as data, e.id_profissional, 
             p.nome as profissional_nome, e.tipo_excecao, 
             TIME_FORMAT(e.horario_inicio, '%H:%i') as horario_inicio, 
             TIME_FORMAT(e.horario_fim, '%H:%i') as horario_fim, 
             e.motivo, e.criado_em 
      FROM excecao_disponibilidade e 
      LEFT JOIN profissional p ON e.id_profissional = p.id_profissional 
      WHERE 1=1
    `;
    const params: any[] = [];
    if (profissional_id) {
      sql += ' AND (e.id_profissional IS NULL OR e.id_profissional = ?)';
      params.push(profissional_id);
    }
    sql += ' ORDER BY e.data ASC';

    const [rows] = await pool.query(sql, params);
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return responderFalha(res, error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar exceções:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar exceções.' });
  }
});

router.post('/excecoes', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, tipo_excecao, horario_inicio, horario_fim } = req.body;
    validarDataHora(data, '08:00');
    const val = validarExcecaoDisponibilidade(data, tipo_excecao, horario_inicio, horario_fim);
    if (!val.valido) throw new ErroOperacao(400, val.motivo || 'Exceção inválida.');
    const profissional = req.body.id_profissional == null || req.body.id_profissional === '' ? null : idPositivo(req.body.id_profissional);
    const motivo = sanitizarTexto(typeof req.body.motivo === 'string' ? req.body.motivo : '');
    if (!motivo) throw new ErroOperacao(400, 'Informe o motivo da exceção.');
    const dados = await transacaoAgenda(profissional === null ? null : [profissional], async conexao => {
      const [existe] = await conexao.query<any[]>('SELECT id_excecao FROM excecao_disponibilidade WHERE data = ? AND id_profissional <=> ?', [data, profissional]);
      if (existe.length) throw new ErroOperacao(409, 'Já existe uma exceção para esta data e profissional.');
      const inicio = tipo_excecao === 'Horario_Especial' ? horario_inicio : null;
      const fim = tipo_excecao === 'Horario_Especial' ? horario_fim : null;
      const [resultado]: any = await conexao.query('INSERT INTO excecao_disponibilidade (data, id_profissional, tipo_excecao, horario_inicio, horario_fim, motivo) VALUES (?, ?, ?, ?, ?, ?)', [data, profissional, tipo_excecao, inicio, fim, motivo]);
      await verificarAgendaAposConfiguracao(conexao, profissional, data);
      return { id: resultado.insertId, data, id_profissional: profissional, tipo_excecao, horario_inicio: inicio, horario_fim: fim, motivo };
    });
    return res.status(201).json({ sucesso: true, mensagem: 'Exceção cadastrada com sucesso!', dados });
  } catch (erro) { return responderFalha(res, erro); }
});
router.delete('/excecoes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = idPositivo(req.params.id);
    await transacaoAgenda(null, async conexao => {
      const [rows] = await conexao.query<any[]>("SELECT *, DATE_FORMAT(data, '%Y-%m-%d') AS data FROM excecao_disponibilidade WHERE id_excecao = ? FOR UPDATE", [id]);
      if (!rows.length) throw new ErroOperacao(404, 'Exceção não encontrada.');
      await conexao.query('DELETE FROM excecao_disponibilidade WHERE id_excecao = ?', [id]);
      await verificarAgendaAposConfiguracao(conexao, rows[0].id_profissional, rows[0].data);
    });
    return res.json({ sucesso: true, mensagem: 'Exceção removida com sucesso!' });
  } catch (erro) { return responderFalha(res, erro); }
});
export default router;

