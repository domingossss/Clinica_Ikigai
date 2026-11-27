import { carregarJanelasAgenda, obterJanelasAgenda } from '../services/janelasAgenda.js';
import servicosRouter from './servicos.js';
import pacientesRouter from './pacientes.js';
import profissionaisRouter from './profissionais.js';
import { idPositivo, responderFalha, validarDataHora } from './validacaoAgenda.js';
import { gravarHistorico, motivoReservaExcepcional, profissionalDoAgendamento, reservaExcepcionalNaOcorrencia, transacaoAgenda, validarReserva, verificarAgendaAposConfiguracao } from '../services/reservasAgenda.js';
import { Router, Request, Response } from 'express';
import {
  validarPeriodoAgenda,
  calcularIntervaloSemana,
  calcularResumoAgenda,
  validarJornadaProfissional,
  validarExcecaoDisponibilidade,
  converterHorarioParaMinutos,
  converterMinutosParaHorario,
} from '../utils/validation.js';
import pool, { ErroOperacao } from '../config/database.js';
import {
  registrarErro,
  sanitizarTexto,
  validarFormatoData,
  validarIdNumerico
} from '../middleware/security.js';

const statusComChegada = ['Na Recepção', 'Em Atendimento', 'Concluído', 'Realizado'];
const chegadaPendente = `(a.checkin_recepcao = 0 AND ${reservaExcepcionalNaOcorrencia('a')})`;

function visualizaDetalhesAgenda(req: Request, profissionalId: number): boolean {
  return req.usuario?.perfil !== 'PROFISSIONAL' || req.usuario.profissional_id === Number(profissionalId);
}

function agendaComPrivacidade(req: Request, agendamentos: Array<{
  id: number; profissional_id: number; profissional_nome: string; data: string;
  horario_inicio: string; horario_fim: string; status: string;
}>) {
  return agendamentos.map(agendamento => {
    if (visualizaDetalhesAgenda(req, agendamento.profissional_id)) return agendamento;
    const { id, profissional_id, profissional_nome, data, horario_inicio, horario_fim } = agendamento;
    return { id, profissional_id, profissional_nome, data, horario_inicio, horario_fim,
      status: 'Agendado', paciente_id: null, paciente_nome: 'Horário ocupado', paciente_whatsapp: null,
      servico_id: null, servico_nome: '', duracao_minutos: null, preco: null };
  });
}

function bloqueiosComPrivacidade<T extends { profissional_id: number; motivo: string }>(req: Request, bloqueios: T[]): T[] {
  return bloqueios.map(bloqueio => visualizaDetalhesAgenda(req, bloqueio.profissional_id)
    ? bloqueio : { ...bloqueio, motivo: 'Horário bloqueado' });
}

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
router.use(profissionaisRouter);

// ============================================================================
// ENDPOINT: GET /api/janelas (Disponibilidade por data e profissional)
// ============================================================================
router.get('/expediente-clinica', async (_req,res,next) => {
  try { const [dados] = await pool.query('SELECT * FROM expediente_clinica ORDER BY dia_semana'); res.json({dados}); } catch(e) { next(e); }
});
router.put('/expediente-clinica', async (req,res,next) => {
  try {
    const {dia_semana, ativo, horario_inicio, horario_fim, intervalo_inicio, intervalo_fim} = req.body;
    if (!Number.isInteger(dia_semana) || dia_semana < 0 || dia_semana > 6 || typeof ativo !== 'boolean' ||
        (ativo && !validarJornadaProfissional(horario_inicio, horario_fim, intervalo_inicio, intervalo_fim).valido)) {
      res.status(400).json({erro:'Informe um dia e horários válidos.'}); return;
    }
    await transacaoAgenda(null, async conexao => {
      await conexao.query('REPLACE INTO expediente_clinica (dia_semana,ativo,horario_inicio,horario_fim,intervalo_inicio,intervalo_fim) VALUES (?,?,?,?,?,?)',
        [dia_semana,ativo,ativo ? horario_inicio : '00:00',ativo ? horario_fim : '00:00',ativo ? intervalo_inicio || null : null,ativo ? intervalo_fim || null : null]);
      await verificarAgendaAposConfiguracao(conexao, null, undefined, [dia_semana]);
    });
    res.json({sucesso:true});
  } catch(e) { if(e instanceof ErroOperacao) res.status(e.status).json({erro:e.message}); else next(e); }
});
router.get('/agenda/pacientes', async (req,res,next) => {
  try {
    const busca = String(req.query.busca || '').trim().slice(0,150);
    if (busca.length < 2) {res.json({dados:[]});return;}
    // Projeção estritamente mínima (id e nome) para reserva excepcional; prontuário permanece
    // bloqueado até validação da chegada pela recepção (vinculoAssistencial).
    const [dados] = await pool.query(
      'SELECT uuid AS id, nome FROM paciente WHERE LOCATE(?, nome) > 0 ORDER BY nome LIMIT 10',
      [busca]
    );
    res.json({dados});
  } catch(e) { next(e); }
});
router.get('/janelas', async (req, res) => {
  try {
    validarDataHora(req.query.data, '08:00');
    const data = String(req.query.data);
    const inicio = req.query.periodo === 'semana' ? calcularIntervaloSemana(data).dataInicio : data;
    const [profs] = await pool.query<any[]>('SELECT id_profissional FROM profissional WHERE ativo = 1');
    const ids = profs.map(p => Number(p.id_profissional));
    const quantidade = req.query.periodo === 'semana' ? 7 : 1;
    const datas = Array.from({ length: quantidade }, (_, deslocamento) => {
      const dia = new Date(inicio + 'T12:00:00Z');
      dia.setUTCDate(dia.getUTCDate() + deslocamento);
      return dia.toISOString().slice(0, 10);
    });
    const resolver = await carregarJanelasAgenda(pool, ids, datas);
    const dados = datas.flatMap(data => ids.map(id => ({ profissional_id: id, data, janelas: resolver(id, data) })));
    return res.json({ sucesso:true, dados });
  } catch (erro) { return responderFalha(res, erro); }
});
router.get('/disponibilidade', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, servico_id, profissional_id } = req.query;
    validarDataHora(data, '08:00');
    const profId = idPositivo(profissional_id || 1);
    const servId = idPositivo(servico_id);

    // Consulta somente leitura sem FOR UPDATE para evitar contenção de locks no MySQL
    const [servicos] = await pool.query<any[]>('SELECT duracao_minutos, ativo FROM procedimento WHERE id_procedimento = ?', [servId]);
    if (!servicos.length || !servicos[0].ativo) throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');
    const [profs] = await pool.query<any[]>('SELECT ativo FROM profissional WHERE id_profissional = ?', [profId]);
    if (!profs.length) throw new ErroOperacao(404, 'Profissional não encontrado.');
    const [vinculos] = await pool.query<any[]>(
      'SELECT duracao_minutos_profissional, ativo_profissional FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?',
      [profId, servId]
    );
    if (!profs[0].ativo || !vinculos.length || !vinculos[0].ativo_profissional) {
      throw new ErroOperacao(400, 'Profissional inativo ou não habilitado.');
    }
    const janelas = await obterJanelasAgenda(pool, profId, data as string, req.usuario?.perfil === 'PROFISSIONAL' && req.query.excepcional === '1');
    const [agendamentos] = await pool.query<any[]>(
      "SELECT a.id_agendamento AS id, TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio, TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim, p.nome AS paciente_nome, s.nome AS servico_nome FROM agendamento a JOIN paciente p ON p.uuid = a.paciente_uuid JOIN procedimento s ON s.id_procedimento = a.id_procedimento WHERE a.id_profissional = ? AND a.data = ? AND a.status <> 'Cancelado'", [profId, data]);
    const [bloqueios] = await pool.query<any[]>("SELECT id_bloqueio AS id, TIME_FORMAT(horario_inicio, '%H:%i') AS horario_inicio, TIME_FORMAT(horario_fim, '%H:%i') AS horario_fim, motivo FROM bloqueio_agenda WHERE id_profissional = ? AND data = ?", [profId, data]);
    const slots: { horario: string; disponivel: boolean }[] = [];
    const duracaoProcedimento = Number(vinculos[0].duracao_minutos_profissional ?? servicos[0].duracao_minutos);
    const duracao = duracaoProcedimento + 15;
    if (!Number.isInteger(duracao) || duracao <= 15) throw new ErroOperacao(400, 'Duração do procedimento inválida.');
    for (const [inicio, fim] of janelas) {
      for (let minuto = inicio; minuto + duracao <= fim; minuto += 30) {
        const disponivel = ![...agendamentos, ...bloqueios].some(a => minuto < converterHorarioParaMinutos(a.horario_fim) && converterHorarioParaMinutos(a.horario_inicio) < minuto + duracao);
        slots.push({ horario: converterMinutosParaHorario(minuto).slice(0, 5), disponivel });
      }
    }
    const dados = visualizaDetalhesAgenda(req, profId)
      ? { dados: slots, ocupados: agendamentos, bloqueios }
      : {
          dados: slots,
          ocupados: agendamentos.map(({ id, horario_inicio, horario_fim }) => ({ id, horario_inicio, horario_fim })),
          bloqueios: bloqueios.map(({ id, horario_inicio, horario_fim }) => ({ id, horario_inicio, horario_fim })),
        };
    return res.json({ sucesso: true, ...dados });
  } catch (erro) { return responderFalha(res, erro); }
});
// ============================================================================
// ENDPOINT: POST /api/agendamentos (Criar agendamento dinâmico)
// ============================================================================
router.post('/agendamentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const excepcional = req.usuario?.perfil === 'PROFISSIONAL';
    if (excepcional && req.body.confirmarFechamento !== true) throw new ErroOperacao(403, 'Confirme a reserva em dia fechado.');
    const { paciente_id, data, horario_inicio } = req.body;
    validarDataHora(data, horario_inicio);
    if (typeof paciente_id !== 'string' || !paciente_id.trim()) throw new ErroOperacao(400, 'Paciente é obrigatório.');
    const profissional_id = idPositivo(req.body.profissional_id);
    if (excepcional && req.usuario?.profissional_id !== profissional_id) {
      throw new ErroOperacao(403, 'Você só pode confirmar uma reserva excepcional na própria agenda.');
    }
    const servico_id = idPositivo(req.body.servico_id);
    const dados = await transacaoAgenda([profissional_id], async conexao => {
      const reserva = await validarReserva(conexao, profissional_id, servico_id, data, horario_inicio, 0, excepcional);
      const [pacientes] = await conexao.query<any[]>('SELECT id_paciente, uuid FROM paciente WHERE uuid = ? FOR UPDATE', [paciente_id]);
      if (!pacientes.length) throw new ErroOperacao(404, 'Paciente não cadastrado.');
      const [ocupado] = await conexao.query<any[]>("SELECT id_agendamento FROM agendamento WHERE paciente_uuid = ? AND data = ? AND status <> 'Cancelado' AND ? < horario_fim AND horario_inicio < ? FOR UPDATE", [paciente_id, data, horario_inicio, reserva.fim]);
      if (ocupado.length) throw new ErroOperacao(409, 'Paciente já possui atendimento neste horário.');
      const [resultado]: any = await conexao.query(
        "INSERT INTO agendamento (id_paciente, paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, data_hora_agendamento, valor_cobrado, observacoes, tipo_atendimento, origem, status) VALUES (?, ?, ?, ?, ?, ?, ?, TIMESTAMP(?, ?), ?, ?, ?, 'Humano_Recepcao', 'Agendado')",
        [pacientes[0].id_paciente, paciente_id, profissional_id, servico_id, data, horario_inicio, reserva.fim, data, horario_inicio, reserva.preco, sanitizarTexto(req.body.observacoes || ''), req.body.tipo_atendimento === 'Retorno' ? 'Retorno' : 'Primeira_Consulta']);
      if (resultado.affectedRows !== 1) throw new Error('Agendamento não gravado.');
      await conexao.query(
        "INSERT INTO historico_status_agendamento (id_agendamento, status_novo, tipo_evento, alterado_por, id_usuario, motivo) VALUES (?, 'Agendado', 'CRIACAO', ?, ?, ?)",
        [resultado.insertId, req.usuario?.nome ?? 'Sistema', req.usuario?.id ?? null, excepcional ? motivoReservaExcepcional : null]);
      return { id: resultado.insertId, paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim: reserva.fim, status: 'Agendado' };
    });
    return res.status(201).json({ sucesso: true, mensagem: 'Agendamento cadastrado com sucesso!', dados });
  } catch (erro) { return responderFalha(res, erro); }
});

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
      "SELECT id_profissional AS id, nome, COALESCE(especialidade_principal, 'Especialista') AS especialidade, ativo FROM profissional WHERE id_profissional = ?",
      [profId]
    );

    if (profs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    const profissional = profs[0];

    // 2. Buscar agendamentos do profissional no período (CA02)
    const [agendamentos]: any = await pool.query(
      `SELECT 
         a.id_agendamento AS id,
         DATE_FORMAT(a.data, '%Y-%m-%d') as data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') as horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') as horario_fim,
         a.status,
         ${chegadaPendente} AS exige_validacao_chegada,
         p.uuid as paciente_id,
         p.nome as paciente_nome,
         ${req.usuario?.perfil === 'PROFISSIONAL' ? 'NULL' : 'p.whatsapp'} as paciente_whatsapp,
         pr.id_profissional as profissional_id,
         pr.nome as profissional_nome,
         s.id_procedimento as servico_id,
         s.nome as servico_nome,
         s.duracao_minutos,
         s.preco
       FROM agendamento a
       JOIN paciente p ON a.paciente_uuid = p.uuid
       JOIN profissional pr ON a.id_profissional = pr.id_profissional
       JOIN procedimento s ON a.id_procedimento = s.id_procedimento
       WHERE a.id_profissional = ?
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
           id_bloqueio AS id,
           id_profissional AS profissional_id,
           DATE_FORMAT(data, '%Y-%m-%d') as data,
           TIME_FORMAT(horario_inicio, '%H:%i') as horario_inicio,
           TIME_FORMAT(horario_fim, '%H:%i') as horario_fim,
           motivo
         FROM bloqueio_agenda
         WHERE id_profissional = ?
           AND data >= ?
           AND data <= ?
         ORDER BY data ASC, horario_inicio ASC`,
        [profId, dtInicio, dtFim]
      );
      bloqueios = blRows;
    } catch (erro) { throw erro; }

    const agenda = agendaComPrivacidade(req, agendamentos);
    const resumo = calcularResumoAgenda(agenda, bloqueios.length);

    return res.status(200).json({
      sucesso: true,
      profissional,
      periodo: {
        data_inicio: dtInicio,
        data_fim: dtFim,
        tipo: tipoPeriodo
      },
      dados: agenda,
      bloqueios: bloqueiosComPrivacidade(req, bloqueios),
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
         a.id_agendamento AS id,
         DATE_FORMAT(a.data, '%Y-%m-%d') as data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') as horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') as horario_fim,
         a.status,
         ${chegadaPendente} AS exige_validacao_chegada,
         p.uuid as paciente_id,
         p.nome as paciente_nome,
         ${req.usuario?.perfil === 'PROFISSIONAL' ? 'NULL' : 'p.whatsapp'} as paciente_whatsapp,
         pr.id_profissional as profissional_id,
         pr.nome as profissional_nome,
         s.nome as servico_nome,
         s.duracao_minutos
       FROM agendamento a
       JOIN paciente p ON a.paciente_uuid = p.uuid
       JOIN profissional pr ON a.id_profissional = pr.id_profissional
       JOIN procedimento s ON a.id_procedimento = s.id_procedimento
       WHERE a.data = ? AND a.status != 'Cancelado'
    `;
    const paramsAg: any[] = [data as string];

    if (profissional_id) {
      queryAg += ` AND a.id_profissional = ?`;
      paramsAg.push(Number(profissional_id));
    }

    queryAg += ` ORDER BY pr.id_profissional, a.horario_inicio`;

    const [rows] = await pool.query<any[]>(queryAg, paramsAg);

    // Buscar bloqueios de horários do dia (IK-87)
    let bloqueios: any[] = [];
    try {
      let queryBl = `
        SELECT 
           id_bloqueio AS id,
           id_profissional AS profissional_id,
           DATE_FORMAT(data, '%Y-%m-%d') as data,
           TIME_FORMAT(horario_inicio, '%H:%i') as horario_inicio,
           TIME_FORMAT(horario_fim, '%H:%i') as horario_fim,
           motivo
         FROM bloqueio_agenda
         WHERE data = ?
      `;
      const paramsBl: any[] = [data as string];
      if (profissional_id) {
        queryBl += ` AND id_profissional = ?`;
        paramsBl.push(Number(profissional_id));
      }
      queryBl += ` ORDER BY id_profissional, horario_inicio`;

      const [blRows] = await pool.query(queryBl, paramsBl);
      bloqueios = blRows as any[];
    } catch (erro) { throw erro; }

    return res.status(200).json({ sucesso: true, dados: agendaComPrivacidade(req, rows),
      bloqueios: bloqueiosComPrivacidade(req, bloqueios) });

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
    const { status, validarChegada } = req.body;
    const perfil = req.usuario?.perfil;
    const podeValidarChegada = perfil === 'ADMIN' || perfil === 'RECEPCAO';
    if (validarChegada !== undefined && (validarChegada !== true || status !== undefined)) {
      throw new ErroOperacao(400, 'Envie a validação de chegada separadamente da mudança de status.');
    }
    if (validarChegada && !podeValidarChegada) {
      throw new ErroOperacao(403, 'A recepção deve validar a chegada dos pacientes em reservas excepcionais.');
    }
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
    const statusAtual = await transacaoAgenda([profissionalId], async conexao => {
      const [rows] = await conexao.query<any[]>(`SELECT a.*, ${reservaExcepcionalNaOcorrencia('a')} AS excepcional
        FROM agendamento a WHERE id_agendamento = ? FOR UPDATE`, [id]);
      const atual = rows[0];
      if (!atual) throw new ErroOperacao(404, 'Agendamento não encontrado.');
      if (req.usuario?.perfil === 'PROFISSIONAL' && Number(atual.id_profissional) !== req.usuario.profissional_id) {
        throw new ErroOperacao(403, 'Você só pode atualizar o status na própria agenda.');
      }
      if (validarChegada) {
        if (!atual.excepcional || !statusComChegada.includes(atual.status)) {
          throw new ErroOperacao(409, 'A validação exige uma reserva excepcional com chegada registrada no status do atendimento.');
        }
        if (atual.checkin_recepcao) return { status: atual.status, alterado: false };
        await gravarHistorico(conexao, atual, atual.status, req.usuario,
          () => conexao.query('UPDATE agendamento SET checkin_recepcao = 1 WHERE id_agendamento = ?', [id]),
          'Chegada validada pela recepção');
        return { status: atual.status, alterado: true };
      }
      if (status === atual.status) return { status, alterado: false };
      if (status === 'Na Recepção' && atual.excepcional && !podeValidarChegada) {
        throw new ErroOperacao(403, 'A recepção deve registrar a chegada de pacientes em reservas excepcionais.');
      }
      if (typeof status !== 'string' || !transicoes[atual.status]?.includes(status)) throw new ErroOperacao(409, 'Mudança de status não permitida para este atendimento.');
      const motivo = sanitizarTexto(typeof req.body.motivo === 'string' ? req.body.motivo : '') || ('Status alterado para ' + status);
      await gravarHistorico(conexao, atual, status, req.usuario, () => conexao.query("UPDATE agendamento SET status = ?, checkin_recepcao = IF(? = 'Na Recepção' AND ?, 1, checkin_recepcao), data_hora_checkin = IF(? = 'Na Recepção', NOW(), data_hora_checkin), data_hora_inicio_atendimento = IF(? = 'Em Atendimento', NOW(), data_hora_inicio_atendimento), minutos_atraso = IF(? = 'Em Atendimento', GREATEST(0, TIMESTAMPDIFF(MINUTE, TIMESTAMP(data, horario_inicio), NOW())), minutos_atraso) WHERE id_agendamento = ?", [status, status, podeValidarChegada, status, status, status, id]), motivo);
      return { status, alterado: true };
    });
    res.locals.semAlteracao = !statusAtual.alterado;
    return res.json({ sucesso: true, mensagem: validarChegada ? 'Chegada validada com sucesso!' : 'Status atualizado com sucesso!', dados: { id, status: statusAtual.status } });
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
      await gravarHistorico(conexao, atual, 'Reagendado', req.usuario, () => conexao.query(
        `UPDATE agendamento SET data = ?, horario_inicio = ?, horario_fim = ?, data_hora_agendamento = TIMESTAMP(?, ?),
         status = 'Reagendado', data_hora_checkin = NULL, checkin_recepcao = 0 WHERE id_agendamento = ?`,
        [data, horario_inicio, reserva.fim, data, horario_inicio, id]), texto,
      { anterior: `${atual.data} ${atual.horario_inicio}`, novo: `${data} ${horario_inicio}` });
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
              DATE_FORMAT(a.criado_em, '%Y-%m-%dT%H:%i:%s') AS criado_em,
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
              tipo_evento,
              id_usuario,
              DATE_FORMAT(ocorrencia_anterior, '%Y-%m-%dT%H:%i:%s') AS ocorrencia_anterior,
              DATE_FORMAT(ocorrencia_nova, '%Y-%m-%dT%H:%i:%s') AS ocorrencia_nova,
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
    if (converterHorarioParaMinutos(horario_inicio) >= converterHorarioParaMinutos(horario_fim)) throw new ErroOperacao(400, 'Início deve ser anterior ao fim.');
    const motivo = sanitizarTexto(typeof req.body.motivo === 'string' ? req.body.motivo : '') || 'Horário Bloqueado';
    const id = await transacaoAgenda([profissional_id], async conexao => {
      const [profs] = await conexao.query<any[]>('SELECT ativo FROM profissional WHERE id_profissional = ?', [profissional_id]);
      if (!profs.length || !profs[0].ativo) throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');
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
        b.id_bloqueio AS id,
        b.id_profissional AS profissional_id,
        pr.nome as profissional_nome,
        DATE_FORMAT(b.data, '%Y-%m-%d') as data,
        TIME_FORMAT(b.horario_inicio, '%H:%i') as horario_inicio,
        TIME_FORMAT(b.horario_fim, '%H:%i') as horario_fim,
        b.motivo,
        b.criado_em
      FROM bloqueio_agenda b
      JOIN profissional pr ON b.id_profissional = pr.id_profissional
      WHERE 1=1
    `;
    const params: any[] = [];

    if (data) {
      sql += ' AND b.data = ?';
      params.push(data);
    }
    if (profissional_id) {
      sql += ' AND b.id_profissional = ?';
      params.push(profissional_id);
    }

    sql += ' ORDER BY b.data, b.horario_inicio';

    const [rows] = await pool.query<any[]>(sql, params);
    return res.status(200).json({ sucesso: true, dados: bloqueiosComPrivacidade(req, rows) });

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

    if (req.usuario?.perfil === 'PROFISSIONAL' && req.usuario.profissional_id !== Number(id)) {
      throw new ErroOperacao(403, 'Você só pode consultar a jornada de trabalho da sua própria agenda.');
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
      await verificarAgendaAposConfiguracao(conexao, id, undefined, [...vistos]);
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

