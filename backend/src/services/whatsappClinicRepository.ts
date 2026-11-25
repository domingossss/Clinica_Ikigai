import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import poolPadrao, { ErroOperacao } from '../config/database.js';
import { obterJanelasAgenda } from './janelasAgenda.js';
import { transacaoAgenda } from './reservasAgenda.js';
import { sanitizarTexto, validarCPF, validarFormatoData } from '../middleware/security.js';
import {
  calcularHorarioTermino,
  converterHorarioParaMinutos,
  converterMinutosParaHorario,
  ExcecaoDia,
  horarioCabeNasJanelas,
  JanelaAgenda,
  JornadaDia,
  resolverJanelasAgenda,
  verificarSobreposicao
} from '../utils/validation.js';
import { mockStore } from '../utils/mock-store.js';

export type Intent = 'menu' | 'agendar' | 'consultar' | 'confirmar' | 'reagendar' | 'avaliar' | 'invalida';

export type ConversationStep =
  | 'MENU_PRINCIPAL'
  | 'AGUARDANDO_CPF'
  | 'AGUARDANDO_NOME_CADASTRO'
  | 'AGUARDANDO_PROCEDIMENTO'
  | 'AGUARDANDO_PROFISSIONAL'
  | 'AGUARDANDO_DATA'
  | 'AGUARDANDO_HORARIO'
  | 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO'
  | 'AGUARDANDO_SELECAO_CONFIRMACAO'
  | 'AGUARDANDO_SELECAO_REAGENDAMENTO'
  | 'AGUARDANDO_DATA_REAGENDAMENTO'
  | 'AGUARDANDO_HORARIO_REAGENDAMENTO'
  | 'AGUARDANDO_CONFIRMACAO_REAGENDAMENTO'
  | 'AGUARDANDO_SELECAO_AVALIACAO'
  | 'AGUARDANDO_NOTA_NPS'
  | 'AGUARDANDO_COMENTARIO_NPS';

export interface WhatsAppProcedimento {
  id: number;
  nome: string;
  duracao_minutos: number;
  preco: number;
  categoria_id: number;
  categoria_nome: string;
  ativo: number;
}

export interface WhatsAppProfissional {
  id: number;
  nome: string;
  especialidade: string;
  ativo: number;
}

export interface WhatsAppPaciente {
  id_paciente: number;
  uuid: string;
  nome_completo: string;
  cpf: string | null;
  telefone: string;
  whatsapp: string;
  etapa_tratamento: string;
  atendimento_status: 'IA' | 'Humano';
}

export interface WhatsAppAgendamentoResumo {
  id: number;
  data: string;
  horario_inicio: string;
  horario_fim: string;
  status: string;
  paciente_id: string;
  paciente_nome: string;
  profissional_id: number;
  profissional_nome: string;
  servico_id: number;
  servico_nome: string;
  duracao_minutos: number;
  valor_cobrado?: number;
  origem?: string;
}

export interface WhatsAppHistoricoStatus {
  id_agendamento: number;
  status_anterior: string | null;
  status_novo: string;
  tipo_evento: 'CRIACAO' | 'REAGENDAMENTO' | 'CANCELAMENTO' | 'STATUS';
  alterado_por: string;
  motivo: string;
}

export interface WhatsAppAvaliacaoNps {
  id_avaliacao: number;
  id_agendamento: number;
  nota_nps: number;
  comentario: string | null;
  data_resposta: string;
}

export interface ConversationContext {
  intencaoPendente?: 'agendar' | 'consultar' | 'confirmar' | 'reagendar' | 'avaliar';
  cpfValidadoParaCadastro?: string;
  tentativasAuth?: number;
  procedimentoId?: number;
  procedimentoNome?: string;
  duracaoMinutos?: number;
  preco?: number;
  profissionalId?: number;
  profissionalNome?: string;
  dataSelecionada?: string;
  horarioSelecionado?: string;
  horarioFimCalculado?: string;
  opcoesProcedimentos?: WhatsAppProcedimento[];
  opcoesProfissionais?: WhatsAppProfissional[];
  opcoesDatas?: string[];
  opcoesHorarios?: string[];
  opcoesConfirmacao?: WhatsAppAgendamentoResumo[];
  opcoesReagendamento?: WhatsAppAgendamentoResumo[];
  agendamentoReagendamento?: WhatsAppAgendamentoResumo;
  opcoesAvaliacao?: WhatsAppAgendamentoResumo[];
  agendamentoAvaliacao?: WhatsAppAgendamentoResumo;
  notaNpsSelecionada?: number;
  contatoFinal?: string;
  escalonadoEm?: string;
  escalonadoMotivo?: string;
}

export interface WhatsAppConversationSession {
  conversationId: string;
  telefoneHash: string;
  idSessaoChatbot: number | null;
  pacienteUuid: string | null;
  pacienteNome?: string | null;
  etapa: ConversationStep;
  intencaoAtual: Intent;
  contexto: ConversationContext;
  expiraEmMs: number;
}

export interface WhatsAppProcessedEventRecord {
  messageId: string;
  conversationId: string;
  origin: string;
  intent: Intent;
  reply: string;
  step: ConversationStep;
  agendamentoId?: number;
  statusEnvio: 'PROCESSANDO' | 'ENVIADO' | 'FALHA';
}

export type ResultadoAutenticacaoPaciente =
  | { status: 'AUTENTICADO'; paciente: WhatsAppPaciente }
  | { status: 'NOVO_PACIENTE_CPF_VALIDO'; cpfLimpo: string }
  | { status: 'CPF_VINCULADO_OUTRO_TELEFONE' }
  | { status: 'CPF_AMBIGUO_EXIGE_COMPLETO' }
  | { status: 'NAO_ENCONTRADO' }
  | { status: 'CPF_INVALIDO' };

export interface WhatsAppClinicRepository {
  iniciarProcessamentoEvento(
    messageId: string,
    conversationId: string,
    origin: string,
    nowMs?: number
  ): Promise<
    | { status: 'NOVO' }
    | { status: 'DUPLICADO'; registro: WhatsAppProcessedEventRecord }
    | { status: 'EM_ANDAMENTO' }
  >;
  concluirProcessamentoEvento(registro: WhatsAppProcessedEventRecord, nowMs?: number): Promise<void>;
  cancelarProcessamentoEvento(messageId: string): Promise<void>;

  obterOuCriarSessao(
    conversationId: string,
    telefoneHash: string,
    nowMs?: number
  ): Promise<WhatsAppConversationSession>;
  salvarSessao(
    sessao: WhatsAppConversationSession,
    opcoes?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
      escalonadoHumano?: boolean;
    },
    nowMs?: number
  ): Promise<void>;

  autenticarPacientePorTelefoneECpf(
    phone: string,
    cpfInput: string
  ): Promise<ResultadoAutenticacaoPaciente>;
  obterPacientePorUuid(uuid: string): Promise<WhatsAppPaciente | null>;
  cadastrarPacienteRapidoWhatsApp(params: {
    nomeCompleto: string;
    cpf: string;
    whatsapp: string;
  }): Promise<WhatsAppPaciente>;

  listarProcedimentosAtivosComProfissionais(): Promise<WhatsAppProcedimento[]>;
  listarProfissionaisAtivosPorProcedimento(procedimentoId: number): Promise<WhatsAppProfissional[]>;
  listarDatasDisponiveis(
    profissionalId: number,
    procedimentoId: number,
    dataInicial: string,
    diasBusca?: number,
    limiteDatas?: number,
    pacienteUuid?: string | null,
    ignorarAgendamentoId?: number
  ): Promise<string[]>;
  listarHorariosDisponiveis(
    profissionalId: number,
    procedimentoId: number,
    data: string,
    pacienteUuid?: string | null,
    ignorarAgendamentoId?: number
  ): Promise<{ horarios: string[]; duracaoMinutos: number; preco: number }>;

  criarAgendamentoWhatsApp(params: {
    pacienteUuid: string;
    profissionalId: number;
    procedimentoId: number;
    data: string;
    horarioInicio: string;
    idSessaoChatbot?: number | null;
  }): Promise<WhatsAppAgendamentoResumo>;

  listarAgendamentosFuturosPaciente(
    pacienteUuid: string,
    dataReferencia: string
  ): Promise<WhatsAppAgendamentoResumo[]>;

  buscarAgendamentosPendentesConfirmacaoAtiva(
    phone: string,
    dataReferencia: string
  ): Promise<WhatsAppAgendamentoResumo[]>;

  confirmarPresencaWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    idSessaoChatbot?: number | null;
    origemConfirmacao?: 'menu' | 'lembrete_ativo';
  }): Promise<{
    agendamento: WhatsAppAgendamentoResumo;
    statusAnterior: string;
    statusNovo: string;
    jaEstavaConfirmado: boolean;
  }>;

  reagendarAgendamentoWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    novaData: string;
    novoHorarioInicio: string;
    motivo?: string;
  }): Promise<{
    agendamento: WhatsAppAgendamentoResumo;
    dataAnterior: string;
    horarioAnterior: string;
    statusAnterior: string;
  }>;

  listarAgendamentosElegiveisAvaliacao(
    pacienteUuid: string
  ): Promise<WhatsAppAgendamentoResumo[]>;

  registrarAvaliacaoNpsWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    notaNps: number;
    comentario?: string | null;
  }): Promise<{
    avaliacao: WhatsAppAvaliacaoNps;
    agendamento: WhatsAppAgendamentoResumo;
  }>;
}

export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutos
export const DEFAULT_EVENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export function normalizarDigitosTelefoneComparacao(valor: string | null | undefined): string {
  if (!valor) return '';
  const digitos = valor.replace(/\D/g, '');
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    return digitos.slice(2);
  }
  return digitos;
}

export function telefonesEquivalentes(telefoneA: string | null | undefined, telefoneB: string | null | undefined): boolean {
  const normA = normalizarDigitosTelefoneComparacao(telefoneA);
  const normB = normalizarDigitosTelefoneComparacao(telefoneB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  // Suporte a variação do 9º dígito após DDD (10 vs 11 dígitos com mesmo DDD)
  if (normA.length === 11 && normB.length === 10 && normA.slice(0, 2) === normB.slice(0, 2) && normA[2] === '9') {
    return normA.slice(3) === normB.slice(2);
  }
  if (normB.length === 11 && normA.length === 10 && normA.slice(0, 2) === normB.slice(0, 2) && normB[2] === '9') {
    return normB.slice(3) === normA.slice(2);
  }
  return false;
}

export function extrairDigitosCpf(cpfInput: string): string | null {
  const trimmed = cpfInput.trim();
  // Aceita apenas dígitos, pontos, traços e espaços
  if (!/^[\d.\-\s]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 4 && digits.length !== 11) return null;
  return digits;
}

export function adicionarDiasDataIso(dataIso: string, dias: number): string {
  const dt = new Date(`${dataIso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

function formatarDataHoraMySql(ms: number): string {
  const dt = new Date(ms);
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Implementação em memória (compatível com mockStore para simulação, laboratório sem MySQL e testes unitários),
 * aplicando rigorosamente todas as regras reais de agendamento, disponibilidade, buffer de 15 min,
 * conflitos, bloqueios, jornada, exceções, autenticação por CPF e auditoria de confirmação.
 */
export class InMemoryWhatsAppClinicRepository implements WhatsAppClinicRepository {
  readonly eventosProcessados = new Map<string, WhatsAppProcessedEventRecord>();
  readonly eventosEmAndamento = new Set<string>();
  readonly sessoesConversa = new Map<string, WhatsAppConversationSession>();
  readonly sessoesChatbot: Array<{
    id_sessao: number;
    identificador_chat: string;
    data_hora_inicio: string;
    data_hora_fim: string | null;
    status_sessao: string;
    escalonado_humano: number;
  }> = [];
  readonly historicoStatus: WhatsAppHistoricoStatus[] = [];
  readonly comunicacoesRegistradas: Array<{
    id: number;
    id_agendamento: number;
    ocorrencia: string;
    tipo: 'CONFIRMACAO' | 'LEMBRETE';
    canal: 'WHATSAPP';
    estado: 'PENDENTE' | 'SUBMETIDA' | 'ENTREGUE' | 'FALHA' | 'INCERTA';
    provedor: string;
    referencia_externa?: string;
  }> = [];
  readonly avaliacoesNps: WhatsAppAvaliacaoNps[] = [];

  readonly jornadasProfissional = new Map<string, JornadaDia>(); // chave: `${profissionalId}:${diaSemana}`
  readonly excecoesDisponibilidade: Array<{
    id: number;
    data: string;
    id_profissional: number | null;
    tipo_excecao: 'Fechado' | 'Horario_Especial';
    horario_inicio?: string | null;
    horario_fim?: string | null;
    motivo: string;
  }> = [];
  readonly expedienteClinica = new Map<number, JornadaDia>();

  private nextSessaoChatbotId = 1;
  private nextComunicacaoId = 1;
  private nextAvaliacaoId = 1;

  constructor(
    private readonly store = mockStore,
    private readonly sessionTtlMs = DEFAULT_SESSION_TTL_MS
  ) {}

  async iniciarProcessamentoEvento(
    messageId: string,
    _conversationId: string,
    _origin: string,
    _nowMs = Date.now()
  ): Promise<
    | { status: 'NOVO' }
    | { status: 'DUPLICADO'; registro: WhatsAppProcessedEventRecord }
    | { status: 'EM_ANDAMENTO' }
  > {
    const existente = this.eventosProcessados.get(messageId);
    if (existente && existente.statusEnvio === 'ENVIADO') {
      return { status: 'DUPLICADO', registro: existente };
    }
    if (this.eventosEmAndamento.has(messageId)) {
      return { status: 'EM_ANDAMENTO' };
    }
    this.eventosEmAndamento.add(messageId);
    return { status: 'NOVO' };
  }

  async concluirProcessamentoEvento(registro: WhatsAppProcessedEventRecord): Promise<void> {
    this.eventosEmAndamento.delete(registro.messageId);
    this.eventosProcessados.set(registro.messageId, { ...registro, statusEnvio: 'ENVIADO' });
    if (this.eventosProcessados.size > 2000) {
      const oldest = this.eventosProcessados.keys().next().value;
      if (oldest) this.eventosProcessados.delete(oldest);
    }
  }

  async cancelarProcessamentoEvento(messageId: string): Promise<void> {
    this.eventosEmAndamento.delete(messageId);
  }

  async obterOuCriarSessao(
    conversationId: string,
    telefoneHash: string,
    nowMs = Date.now()
  ): Promise<WhatsAppConversationSession> {
    const atual = this.sessoesConversa.get(conversationId);
    if (atual && atual.expiraEmMs > nowMs) {
      return {
        ...atual,
        contexto: { ...atual.contexto },
        expiraEmMs: nowMs + this.sessionTtlMs
      };
    }

    if (atual && atual.idSessaoChatbot) {
      const sb = this.sessoesChatbot.find(s => s.id_sessao === atual.idSessaoChatbot);
      if (sb && sb.status_sessao === 'Em_Andamento') {
        sb.status_sessao = 'Abandonada';
        sb.data_hora_fim = formatarDataHoraMySql(nowMs);
      }
    }

    const idSessao = this.nextSessaoChatbotId++;
    this.sessoesChatbot.push({
      id_sessao: idSessao,
      identificador_chat: `WA-${conversationId.slice(0, 16)}-${idSessao}`,
      data_hora_inicio: formatarDataHoraMySql(nowMs),
      data_hora_fim: null,
      status_sessao: 'Em_Andamento',
      escalonado_humano: 0
    });

    const nova: WhatsAppConversationSession = {
      conversationId,
      telefoneHash,
      idSessaoChatbot: idSessao,
      pacienteUuid: null,
      pacienteNome: null,
      etapa: 'MENU_PRINCIPAL',
      intencaoAtual: 'menu',
      contexto: {},
      expiraEmMs: nowMs + this.sessionTtlMs
    };
    this.sessoesConversa.set(conversationId, nova);
    return { ...nova, contexto: {} };
  }

  async salvarSessao(
    sessao: WhatsAppConversationSession,
    opcoes?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
      escalonadoHumano?: boolean;
    },
    nowMs = Date.now()
  ): Promise<void> {
    const atualizada: WhatsAppConversationSession = {
      ...sessao,
      contexto: { ...sessao.contexto },
      expiraEmMs: nowMs + this.sessionTtlMs
    };
    this.sessoesConversa.set(sessao.conversationId, atualizada);

    if (sessao.idSessaoChatbot && opcoes) {
      const sb = this.sessoesChatbot.find(s => s.id_sessao === sessao.idSessaoChatbot);
      if (sb) {
        if (opcoes.statusSessaoChatbot) {
          sb.status_sessao = opcoes.statusSessaoChatbot;
          if (opcoes.statusSessaoChatbot !== 'Em_Andamento') {
            sb.data_hora_fim = formatarDataHoraMySql(nowMs);
          }
        }
        if (opcoes.escalonadoHumano !== undefined) {
          sb.escalonado_humano = opcoes.escalonadoHumano ? 1 : 0;
        }
      }
    }
  }

  private mapMockPaciente(p: typeof mockStore.pacientes[number], index: number): WhatsAppPaciente {
    return {
      id_paciente: index + 1,
      uuid: p.id,
      nome_completo: p.nome_completo,
      cpf: p.cpf ? p.cpf.replace(/\D/g, '') : null,
      telefone: p.telefone,
      whatsapp: p.whatsapp,
      etapa_tratamento: p.etapa_tratamento || 'Avaliação',
      atendimento_status: 'IA'
    };
  }

  async autenticarPacientePorTelefoneECpf(
    phone: string,
    cpfInput: string
  ): Promise<ResultadoAutenticacaoPaciente> {
    const cpfDigitos = extrairDigitosCpf(cpfInput);
    if (!cpfDigitos) {
      return { status: 'CPF_INVALIDO' };
    }

    const todosPacientes = this.store.pacientes.map((p, idx) => this.mapMockPaciente(p, idx));
    const vinculadosAoTelefone = todosPacientes.filter(
      p => telefonesEquivalentes(p.whatsapp, phone) || telefonesEquivalentes(p.telefone, phone)
    );

    if (cpfDigitos.length === 4) {
      const matches = vinculadosAoTelefone.filter(p => p.cpf && p.cpf.endsWith(cpfDigitos));
      if (matches.length === 1) {
        return { status: 'AUTENTICADO', paciente: matches[0] };
      }
      if (matches.length > 1) {
        return { status: 'CPF_AMBIGUO_EXIGE_COMPLETO' };
      }
      return { status: 'NAO_ENCONTRADO' };
    }

    // CPF completo (11 dígitos)
    const matchMesmoTelefone = vinculadosAoTelefone.find(p => p.cpf === cpfDigitos);
    if (matchMesmoTelefone) {
      return { status: 'AUTENTICADO', paciente: matchMesmoTelefone };
    }

    const matchOutroTelefone = todosPacientes.find(p => p.cpf === cpfDigitos);
    if (matchOutroTelefone) {
      return { status: 'CPF_VINCULADO_OUTRO_TELEFONE' };
    }

    // Não existe no cadastro: validar algoritmo oficial da Receita Federal para permitir novo pré-cadastro
    if (!validarCPF(cpfDigitos)) {
      return { status: 'CPF_INVALIDO' };
    }

    return { status: 'NOVO_PACIENTE_CPF_VALIDO', cpfLimpo: cpfDigitos };
  }

  async obterPacientePorUuid(uuid: string): Promise<WhatsAppPaciente | null> {
    const idx = this.store.pacientes.findIndex(p => p.id === uuid);
    if (idx === -1) return null;
    return this.mapMockPaciente(this.store.pacientes[idx], idx);
  }

  async cadastrarPacienteRapidoWhatsApp(params: {
    nomeCompleto: string;
    cpf: string;
    whatsapp: string;
  }): Promise<WhatsAppPaciente> {
    const nomeSanitizado = sanitizarTexto(params.nomeCompleto);
    if (!nomeSanitizado || nomeSanitizado.length < 3 || nomeSanitizado.length > 150) {
      throw new ErroOperacao(400, 'Informe um nome completo válido.');
    }
    const cpfLimpo = params.cpf.replace(/\D/g, '');
    if (!validarCPF(cpfLimpo)) {
      throw new ErroOperacao(400, 'CPF inválido.');
    }
    const telefoneLimpo = params.whatsapp.replace(/\D/g, '');
    const duplicado = this.store.pacientes.find(p => (p.cpf || '').replace(/\D/g, '') === cpfLimpo);
    if (duplicado) {
      throw new ErroOperacao(409, 'CPF já cadastrado.');
    }

    const id = randomUUID();
    const novo = {
      id,
      nome_completo: nomeSanitizado,
      cpf: cpfLimpo,
      telefone: telefoneLimpo,
      whatsapp: telefoneLimpo,
      etapa_tratamento: 'Avaliação'
    };
    this.store.pacientes.push(novo);
    return this.mapMockPaciente(novo, this.store.pacientes.length - 1);
  }

  async listarProcedimentosAtivosComProfissionais(): Promise<WhatsAppProcedimento[]> {
    const profsAtivos = new Set(this.store.profissionais.filter(p => p.ativo === 1).map(p => p.id));
    const procsComProfAtivo = new Set(
      this.store.profissionalProcedimentos
        .filter(v => profsAtivos.has(v.profissional_id))
        .map(v => v.procedimento_id)
    );

    return this.store.servicos
      .filter(s => ((s as { ativo?: number }).ativo ?? 1) === 1 && procsComProfAtivo.has(s.id))
      .map(s => ({
        id: s.id,
        nome: s.nome,
        duracao_minutos: s.duracao_minutos,
        preco: s.preco,
        categoria_id: s.categoria_id,
        categoria_nome: s.categoria_nome,
        ativo: (s as { ativo?: number }).ativo ?? 1
      }))
      .sort((a, b) => a.id - b.id);
  }

  async listarProfissionaisAtivosPorProcedimento(procedimentoId: number): Promise<WhatsAppProfissional[]> {
    const proc = this.store.servicos.find(
      s => s.id === Number(procedimentoId) && ((s as { ativo?: number }).ativo ?? 1) === 1
    );
    if (!proc) return [];

    const profIds = new Set(
      this.store.profissionalProcedimentos
        .filter(v => v.procedimento_id === Number(procedimentoId))
        .map(v => v.profissional_id)
    );

    return this.store.profissionais
      .filter(p => p.ativo === 1 && profIds.has(p.id))
      .map(p => ({
        id: p.id,
        nome: p.nome,
        especialidade: p.especialidade,
        ativo: p.ativo
      }))
      .sort((a, b) => a.id - b.id);
  }

  private obterJanelasMemoria(profissionalId: number, data: string): JanelaAgenda[] {
    const dia = new Date(`${data}T12:00:00Z`).getUTCDay();
    const jornada = this.jornadasProfissional.get(`${profissionalId}:${dia}`);
    const excecoesData = this.excecoesDisponibilidade
      .filter(e => e.data === data && (e.id_profissional === null || e.id_profissional === profissionalId))
      .sort((a, b) => b.id - a.id);
    const local = excecoesData.find(e => e.id_profissional === null);
    const individual = excecoesData.find(e => e.id_profissional !== null);
    const grade = this.expedienteClinica.get(dia);

    const janelasProf = resolverJanelasAgenda(data, jornada, individual);
    if (!grade && !local) return janelasProf;
    const janelasClinica = resolverJanelasAgenda(data, grade, local);
    return janelasProf.flatMap(([a, b]) =>
      janelasClinica
        .map(([c, d]): JanelaAgenda => [Math.max(a, c), Math.min(b, d)])
        .filter(([i, f]) => i < f)
    );
  }

  async listarHorariosDisponiveis(
    profissionalId: number,
    procedimentoId: number,
    data: string,
    pacienteUuid?: string | null,
    ignorarAgendamentoId = 0
  ): Promise<{ horarios: string[]; duracaoMinutos: number; preco: number }> {
    if (!validarFormatoData(data)) {
      throw new ErroOperacao(400, 'Data inválida. Use YYYY-MM-DD.');
    }

    const prof = this.store.profissionais.find(p => p.id === Number(profissionalId) && p.ativo === 1);
    if (!prof) throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');

    const servico = this.store.servicos.find(
      s => s.id === Number(procedimentoId) && ((s as { ativo?: number }).ativo ?? 1) === 1
    );
    if (!servico) throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');

    if (!this.store.verificarVinculo(prof.id, servico.id)) {
      throw new ErroOperacao(400, 'Profissional não habilitado para este procedimento.');
    }

    const duracaoComRespiro = Number(servico.duracao_minutos) + 15;
    const janelas = this.obterJanelasMemoria(prof.id, data);
    const agendamentosProf = this.store.agendamentos.filter(
      a =>
        a.profissional_id === prof.id &&
        a.data === data &&
        a.id !== ignorarAgendamentoId &&
        a.status !== 'Cancelado'
    );
    const agendamentosPaciente = pacienteUuid
      ? this.store.agendamentos.filter(
          a =>
            a.paciente_id === pacienteUuid &&
            a.data === data &&
            a.id !== ignorarAgendamentoId &&
            a.status !== 'Cancelado'
        )
      : [];
    const bloqueiosProf = this.store.bloqueios.filter(
      b => b.profissional_id === prof.id && b.data === data
    );

    const horarios: string[] = [];
    for (const [inicioJanela, fimJanela] of janelas) {
      for (let minuto = inicioJanela; minuto + duracaoComRespiro <= fimJanela; minuto += 30) {
        const slotInicio = converterMinutosParaHorario(minuto).slice(0, 5);
        const slotFim = converterMinutosParaHorario(minuto + duracaoComRespiro).slice(0, 5);

        const ocupado = [...agendamentosProf, ...agendamentosPaciente, ...bloqueiosProf].some(item =>
          verificarSobreposicao(slotInicio, slotFim, item.horario_inicio.slice(0, 5), item.horario_fim.slice(0, 5))
        );

        if (!ocupado) {
          horarios.push(slotInicio);
        }
      }
    }

    return {
      horarios,
      duracaoMinutos: Number(servico.duracao_minutos),
      preco: Number(servico.preco)
    };
  }

  async listarDatasDisponiveis(
    profissionalId: number,
    procedimentoId: number,
    dataInicial: string,
    diasBusca = 14,
    limiteDatas = 5,
    pacienteUuid?: string | null,
    ignorarAgendamentoId = 0
  ): Promise<string[]> {
    const datas: string[] = [];
    for (let i = 0; i < diasBusca && datas.length < limiteDatas; i++) {
      const dataCandidata = adicionarDiasDataIso(dataInicial, i);
      const { horarios } = await this.listarHorariosDisponiveis(
        profissionalId,
        procedimentoId,
        dataCandidata,
        pacienteUuid,
        ignorarAgendamentoId
      );
      if (horarios.length > 0) {
        datas.push(dataCandidata);
      }
    }
    return datas;
  }

  async criarAgendamentoWhatsApp(params: {
    pacienteUuid: string;
    profissionalId: number;
    procedimentoId: number;
    data: string;
    horarioInicio: string;
    idSessaoChatbot?: number | null;
  }): Promise<WhatsAppAgendamentoResumo> {
    const { pacienteUuid, profissionalId, procedimentoId, data, horarioInicio } = params;
    if (!validarFormatoData(data)) throw new ErroOperacao(400, 'Data inválida.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horarioInicio)) throw new ErroOperacao(400, 'Horário inválido.');

    const prof = this.store.profissionais.find(p => p.id === Number(profissionalId) && p.ativo === 1);
    if (!prof) throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');

    const servico = this.store.servicos.find(
      s => s.id === Number(procedimentoId) && ((s as { ativo?: number }).ativo ?? 1) === 1
    );
    if (!servico) throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');

    if (!this.store.verificarVinculo(prof.id, servico.id)) {
      throw new ErroOperacao(400, 'Profissional não habilitado para este procedimento.');
    }

    const paciente = this.store.pacientes.find(p => p.id === pacienteUuid);
    if (!paciente) throw new ErroOperacao(404, 'Paciente não cadastrado.');

    const fimComRespiro = calcularHorarioTermino(horarioInicio, servico.duracao_minutos, 15).slice(0, 5);
    const janelas = this.obterJanelasMemoria(prof.id, data);
    if (!horarioCabeNasJanelas(horarioInicio, fimComRespiro, janelas)) {
      throw new ErroOperacao(
        409,
        'Horário fora da jornada disponível, intervalo ou exceção da data (incluindo 15 minutos de respiro).'
      );
    }

    const conflitoProf = this.store.agendamentos.find(
      a =>
        a.profissional_id === prof.id &&
        a.data === data &&
        a.status !== 'Cancelado' &&
        verificarSobreposicao(horarioInicio, fimComRespiro, a.horario_inicio.slice(0, 5), a.horario_fim.slice(0, 5))
    );
    if (conflitoProf) {
      throw new ErroOperacao(409, 'Conflito de agenda. O horário já está reservado.');
    }

    const conflitoBloqueio = this.store.bloqueios.find(
      b =>
        b.profissional_id === prof.id &&
        b.data === data &&
        verificarSobreposicao(horarioInicio, fimComRespiro, b.horario_inicio.slice(0, 5), b.horario_fim.slice(0, 5))
    );
    if (conflitoBloqueio) {
      throw new ErroOperacao(409, 'Horário bloqueado na agenda.');
    }

    const conflitoPaciente = this.store.agendamentos.find(
      a =>
        a.paciente_id === pacienteUuid &&
        a.data === data &&
        a.status !== 'Cancelado' &&
        verificarSobreposicao(horarioInicio, fimComRespiro, a.horario_inicio.slice(0, 5), a.horario_fim.slice(0, 5))
    );
    if (conflitoPaciente) {
      throw new ErroOperacao(409, 'Paciente já possui atendimento neste horário.');
    }

    const novoId = ++this.store.nextAgendamentoId;
    const novoAgendamento = {
      id: novoId,
      data,
      horario_inicio: horarioInicio,
      horario_fim: fimComRespiro,
      status: 'Agendado',
      paciente_id: paciente.id,
      paciente_nome: paciente.nome_completo,
      paciente_whatsapp: paciente.whatsapp,
      profissional_id: prof.id,
      profissional_nome: prof.nome,
      servico_id: servico.id,
      servico_nome: servico.nome,
      duracao_minutos: servico.duracao_minutos
    };
    this.store.agendamentos.push(novoAgendamento);

    this.historicoStatus.push({
      id_agendamento: novoId,
      status_anterior: null,
      status_novo: 'Agendado',
      tipo_evento: 'CRIACAO',
      alterado_por: 'WhatsApp Bot',
      motivo: 'Autoagendamento concluído pelo paciente via WhatsApp'
    });

    return {
      ...novoAgendamento,
      valor_cobrado: servico.preco,
      origem: 'Chatbot'
    };
  }

  async listarAgendamentosFuturosPaciente(
    pacienteUuid: string,
    dataReferencia: string
  ): Promise<WhatsAppAgendamentoResumo[]> {
    return this.store.agendamentos
      .filter(
        a =>
          a.paciente_id === pacienteUuid &&
          a.data >= dataReferencia &&
          !['Cancelado', 'No_Show', 'Concluído', 'Realizado'].includes(a.status)
      )
      .sort((a, b) => `${a.data} ${a.horario_inicio}`.localeCompare(`${b.data} ${b.horario_inicio}`))
      .map(a => ({
        ...a,
        horario_inicio: a.horario_inicio.slice(0, 5),
        horario_fim: a.horario_fim.slice(0, 5)
      }));
  }

  async buscarAgendamentosPendentesConfirmacaoAtiva(
    phone: string,
    dataReferencia: string
  ): Promise<WhatsAppAgendamentoResumo[]> {
    const pacientesVinculados = new Set(
      this.store.pacientes
        .filter(p => telefonesEquivalentes(p.whatsapp, phone) || telefonesEquivalentes(p.telefone, phone))
        .map(p => p.id)
    );
    if (pacientesVinculados.size === 0) return [];

    return this.store.agendamentos
      .filter(a => {
        if (!pacientesVinculados.has(a.paciente_id)) return false;
        if (a.data < dataReferencia) return false;
        if (!['Agendado', 'Reagendado'].includes(a.status)) return false;
        const ocorrencia = `${a.data} ${a.horario_inicio.slice(0, 5)}:00`;
        return this.comunicacoesRegistradas.some(
          c =>
            c.id_agendamento === a.id &&
            c.ocorrencia === ocorrencia &&
            (c.tipo === 'LEMBRETE' || c.tipo === 'CONFIRMACAO') &&
            (c.estado === 'SUBMETIDA' || c.estado === 'ENTREGUE')
        );
      })
      .sort((a, b) => `${a.data} ${a.horario_inicio}`.localeCompare(`${b.data} ${b.horario_inicio}`))
      .map(a => ({
        ...a,
        horario_inicio: a.horario_inicio.slice(0, 5),
        horario_fim: a.horario_fim.slice(0, 5)
      }));
  }

  async confirmarPresencaWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    idSessaoChatbot?: number | null;
    origemConfirmacao?: 'menu' | 'lembrete_ativo';
  }): Promise<{
    agendamento: WhatsAppAgendamentoResumo;
    statusAnterior: string;
    statusNovo: string;
    jaEstavaConfirmado: boolean;
  }> {
    const ag = this.store.agendamentos.find(
      a => a.id === Number(params.agendamentoId) && a.paciente_id === params.pacienteUuid
    );
    if (!ag) {
      throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
    }

    if (ag.status === 'Confirmado') {
      return {
        agendamento: {
          ...ag,
          horario_inicio: ag.horario_inicio.slice(0, 5),
          horario_fim: ag.horario_fim.slice(0, 5)
        },
        statusAnterior: 'Confirmado',
        statusNovo: 'Confirmado',
        jaEstavaConfirmado: true
      };
    }

    if (!['Agendado', 'Reagendado'].includes(ag.status)) {
      throw new ErroOperacao(409, `Não é possível confirmar presença de um atendimento com status "${ag.status}".`);
    }

    const statusAnterior = ag.status;
    ag.status = 'Confirmado';

    const motivo =
      params.origemConfirmacao === 'lembrete_ativo'
        ? 'Presença confirmada pelo paciente em resposta ao lembrete via WhatsApp'
        : 'Presença confirmada pelo paciente via WhatsApp';

    this.historicoStatus.push({
      id_agendamento: ag.id,
      status_anterior: statusAnterior,
      status_novo: 'Confirmado',
      tipo_evento: 'STATUS',
      alterado_por: 'Paciente via WhatsApp',
      motivo
    });

    const ocorrencia = `${ag.data} ${ag.horario_inicio.slice(0, 5)}:00`;
    if (params.origemConfirmacao === 'lembrete_ativo') {
      for (const com of this.comunicacoesRegistradas) {
        if (com.id_agendamento === ag.id && com.ocorrencia === ocorrencia && com.estado === 'SUBMETIDA') {
          com.estado = 'ENTREGUE';
        }
      }
    }

    this.comunicacoesRegistradas.push({
      id: this.nextComunicacaoId++,
      id_agendamento: ag.id,
      ocorrencia,
      tipo: 'CONFIRMACAO',
      canal: 'WHATSAPP',
      estado: 'ENTREGUE',
      provedor: 'whatsapp-bot'
    });

    return {
      agendamento: {
        ...ag,
        horario_inicio: ag.horario_inicio.slice(0, 5),
        horario_fim: ag.horario_fim.slice(0, 5)
      },
      statusAnterior,
      statusNovo: 'Confirmado',
      jaEstavaConfirmado: false
    };
  }

  async reagendarAgendamentoWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    novaData: string;
    novoHorarioInicio: string;
    motivo?: string;
  }): Promise<{
    agendamento: WhatsAppAgendamentoResumo;
    dataAnterior: string;
    horarioAnterior: string;
    statusAnterior: string;
  }> {
    const { agendamentoId, pacienteUuid, novaData, novoHorarioInicio } = params;
    if (!validarFormatoData(novaData)) throw new ErroOperacao(400, 'Data inválida.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(novoHorarioInicio)) throw new ErroOperacao(400, 'Horário inválido.');

    const ag = this.store.agendamentos.find(
      a => a.id === Number(agendamentoId) && a.paciente_id === pacienteUuid
    );
    if (!ag) {
      throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
    }
    if (['Cancelado', 'No_Show', 'Concluído', 'Realizado', 'Em Atendimento'].includes(ag.status)) {
      throw new ErroOperacao(409, 'Este atendimento não pode ser reagendado no status atual.');
    }

    const prof = this.store.profissionais.find(p => p.id === ag.profissional_id && p.ativo === 1);
    if (!prof) throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');

    const servico = this.store.servicos.find(
      s => s.id === ag.servico_id && ((s as { ativo?: number }).ativo ?? 1) === 1
    );
    if (!servico) throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');

    if (!this.store.verificarVinculo(prof.id, servico.id)) {
      throw new ErroOperacao(400, 'Profissional não habilitado para este procedimento.');
    }

    const fimComRespiro = calcularHorarioTermino(novoHorarioInicio, servico.duracao_minutos, 15).slice(0, 5);
    const janelas = this.obterJanelasMemoria(prof.id, novaData);
    if (!horarioCabeNasJanelas(novoHorarioInicio, fimComRespiro, janelas)) {
      throw new ErroOperacao(
        409,
        'Horário fora da jornada disponível, intervalo ou exceção da data (incluindo 15 minutos de respiro).'
      );
    }

    const conflitoProf = this.store.agendamentos.find(
      a =>
        a.id !== ag.id &&
        a.profissional_id === prof.id &&
        a.data === novaData &&
        a.status !== 'Cancelado' &&
        verificarSobreposicao(novoHorarioInicio, fimComRespiro, a.horario_inicio.slice(0, 5), a.horario_fim.slice(0, 5))
    );
    if (conflitoProf) {
      throw new ErroOperacao(409, 'Conflito de agenda. O horário já está reservado.');
    }

    const conflitoBloqueio = this.store.bloqueios.find(
      b =>
        b.profissional_id === prof.id &&
        b.data === novaData &&
        verificarSobreposicao(novoHorarioInicio, fimComRespiro, b.horario_inicio.slice(0, 5), b.horario_fim.slice(0, 5))
    );
    if (conflitoBloqueio) {
      throw new ErroOperacao(409, 'Horário bloqueado na agenda.');
    }

    const conflitoPaciente = this.store.agendamentos.find(
      a =>
        a.id !== ag.id &&
        a.paciente_id === pacienteUuid &&
        a.data === novaData &&
        a.status !== 'Cancelado' &&
        verificarSobreposicao(novoHorarioInicio, fimComRespiro, a.horario_inicio.slice(0, 5), a.horario_fim.slice(0, 5))
    );
    if (conflitoPaciente) {
      throw new ErroOperacao(409, 'Paciente já possui atendimento neste horário.');
    }

    const dataAnterior = ag.data;
    const horarioAnterior = ag.horario_inicio.slice(0, 5);
    const statusAnterior = ag.status;

    ag.data = novaData;
    ag.horario_inicio = novoHorarioInicio;
    ag.horario_fim = fimComRespiro;
    ag.status = 'Reagendado';

    const motivoTexto =
      sanitizarTexto(params.motivo || '') ||
      `Reagendado pelo paciente via WhatsApp (de ${dataAnterior} ${horarioAnterior} para ${novaData} ${novoHorarioInicio})`;

    this.historicoStatus.push({
      id_agendamento: ag.id,
      status_anterior: statusAnterior,
      status_novo: 'Reagendado',
      tipo_evento: 'REAGENDAMENTO',
      alterado_por: 'Paciente via WhatsApp',
      motivo: motivoTexto
    });

    return {
      agendamento: {
        ...ag,
        horario_inicio: ag.horario_inicio.slice(0, 5),
        horario_fim: ag.horario_fim.slice(0, 5)
      },
      dataAnterior,
      horarioAnterior,
      statusAnterior
    };
  }

  async listarAgendamentosElegiveisAvaliacao(pacienteUuid: string): Promise<WhatsAppAgendamentoResumo[]> {
    const avaliados = new Set(this.avaliacoesNps.map(av => av.id_agendamento));
    return this.store.agendamentos
      .filter(
        a =>
          a.paciente_id === pacienteUuid &&
          ['Concluído', 'Realizado'].includes(a.status) &&
          !avaliados.has(a.id)
      )
      .sort((a, b) => `${b.data} ${b.horario_inicio}`.localeCompare(`${a.data} ${a.horario_inicio}`))
      .slice(0, 5)
      .map(a => ({
        ...a,
        horario_inicio: a.horario_inicio.slice(0, 5),
        horario_fim: a.horario_fim.slice(0, 5)
      }));
  }

  async registrarAvaliacaoNpsWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    notaNps: number;
    comentario?: string | null;
  }): Promise<{
    avaliacao: WhatsAppAvaliacaoNps;
    agendamento: WhatsAppAgendamentoResumo;
  }> {
    const { agendamentoId, pacienteUuid, notaNps } = params;
    if (!Number.isInteger(notaNps) || notaNps < 0 || notaNps > 10) {
      throw new ErroOperacao(400, 'Informe uma nota de 0 a 10.');
    }

    const ag = this.store.agendamentos.find(
      a => a.id === Number(agendamentoId) && a.paciente_id === pacienteUuid
    );
    if (!ag) {
      throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
    }
    if (!['Concluído', 'Realizado'].includes(ag.status)) {
      throw new ErroOperacao(409, 'Apenas atendimentos concluídos podem ser avaliados.');
    }
    if (this.avaliacoesNps.some(av => av.id_agendamento === ag.id)) {
      throw new ErroOperacao(409, 'Este atendimento já foi avaliado.');
    }

    const comentarioLimpo = params.comentario ? sanitizarTexto(params.comentario).slice(0, 500) || null : null;
    const avaliacao: WhatsAppAvaliacaoNps = {
      id_avaliacao: this.nextAvaliacaoId++,
      id_agendamento: ag.id,
      nota_nps: notaNps,
      comentario: comentarioLimpo,
      data_resposta: formatarDataHoraMySql(Date.now())
    };
    this.avaliacoesNps.push(avaliacao);

    return {
      avaliacao,
      agendamento: {
        ...ag,
        horario_inicio: ag.horario_inicio.slice(0, 5),
        horario_fim: ag.horario_fim.slice(0, 5)
      }
    };
  }
}

/**
 * Implementação MySQL real transacional, conectada diretamente às tabelas oficiais:
 * `agendamento`, `paciente`, `profissional`, `procedimento`, `profissional_procedimento`,
 * `bloqueio_agenda`, `jornada_profissional`, `excecao_disponibilidade`, `expediente_clinica`,
 * `historico_status_agendamento`, `comunicacao_agendamento`, `sessao_chatbot`,
 * `whatsapp_sessao_conversa` e `whatsapp_evento_processado`.
 */
export class MySqlWhatsAppClinicRepository implements WhatsAppClinicRepository {
  private tabelasVerificadas = false;

  constructor(
    private readonly dbPool: Pool = poolPadrao,
    private readonly sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    private readonly eventTtlMs = DEFAULT_EVENT_TTL_MS
  ) {}

  private async garantirTabelasConversacao(): Promise<void> {
    if (this.tabelasVerificadas) return;
    await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessao_conversa (
        conversation_id VARCHAR(64) PRIMARY KEY,
        telefone_hash VARCHAR(64) NOT NULL,
        id_sessao_chatbot INT NULL,
        paciente_uuid VARCHAR(36) NULL,
        etapa VARCHAR(60) NOT NULL DEFAULT 'MENU_PRINCIPAL',
        intencao_atual VARCHAR(30) NOT NULL DEFAULT 'menu',
        contexto_json TEXT NULL,
        expira_em DATETIME NOT NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_whatsapp_sessao_expira (expira_em),
        INDEX idx_whatsapp_sessao_paciente (paciente_uuid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_evento_processado (
        message_id VARCHAR(100) PRIMARY KEY,
        conversation_id VARCHAR(64) NOT NULL,
        origem VARCHAR(40) NOT NULL,
        intencao VARCHAR(30) NOT NULL DEFAULT 'menu',
        resposta TEXT NULL,
        estado_envio ENUM('PROCESSANDO', 'ENVIADO', 'FALHA') NOT NULL DEFAULT 'PROCESSANDO',
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expira_em DATETIME NOT NULL,
        INDEX idx_whatsapp_evento_expira (expira_em),
        INDEX idx_whatsapp_evento_conversa (conversation_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    this.tabelasVerificadas = true;
  }

  private async executarTransacaoAgenda<T>(
    ids: number[],
    executar: (conexao: PoolConnection) => Promise<T>
  ): Promise<T> {
    if (this.dbPool === poolPadrao) {
      return transacaoAgenda(ids, executar);
    }
    const conexao = await this.dbPool.getConnection();
    let descartar = false;
    try {
      await conexao.beginTransaction();
      for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        const [rows] = await conexao.query<RowDataPacket[]>(
          'SELECT id_profissional FROM profissional WHERE id_profissional = ? FOR UPDATE',
          [id]
        );
        if (!rows.length) throw new ErroOperacao(404, 'Profissional não encontrado.');
      }
      const resultado = await executar(conexao);
      await conexao.commit();
      return resultado;
    } catch (error) {
      try {
        await conexao.rollback();
      } catch {
        descartar = true;
        conexao.destroy();
      }
      throw error;
    } finally {
      if (!descartar) conexao.release();
    }
  }

  async iniciarProcessamentoEvento(
    messageId: string,
    conversationId: string,
    origin: string,
    nowMs = Date.now()
  ): Promise<
    | { status: 'NOVO' }
    | { status: 'DUPLICADO'; registro: WhatsAppProcessedEventRecord }
    | { status: 'EM_ANDAMENTO' }
  > {
    await this.garantirTabelasConversacao();
    const agoraSql = formatarDataHoraMySql(nowMs);
    const expiraSql = formatarDataHoraMySql(nowMs + this.eventTtlMs);

    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT message_id, conversation_id, origem, intencao, resposta, estado_envio,
              DATE_FORMAT(expira_em, '%Y-%m-%d %H:%i:%s') AS expira_em
       FROM whatsapp_evento_processado
       WHERE message_id = ? LIMIT 1`,
      [messageId]
    );

    if (rows.length > 0) {
      const atual = rows[0];
      if (atual.estado_envio === 'ENVIADO' && atual.expira_em > agoraSql) {
        return {
          status: 'DUPLICADO',
          registro: {
            messageId: atual.message_id,
            conversationId: atual.conversation_id,
            origin: atual.origem,
            intent: atual.intencao as Intent,
            reply: atual.resposta || '',
            step: 'MENU_PRINCIPAL',
            statusEnvio: 'ENVIADO'
          }
        };
      }
      if (atual.estado_envio === 'PROCESSANDO' && atual.expira_em > agoraSql) {
        return { status: 'EM_ANDAMENTO' };
      }
      await this.dbPool.query(
        `UPDATE whatsapp_evento_processado
         SET estado_envio = 'PROCESSANDO', conversation_id = ?, origem = ?, expira_em = ?
         WHERE message_id = ?`,
        [conversationId, origin, expiraSql, messageId]
      );
      return { status: 'NOVO' };
    }

    try {
      await this.dbPool.query(
        `INSERT INTO whatsapp_evento_processado
         (message_id, conversation_id, origem, intencao, resposta, estado_envio, expira_em)
         VALUES (?, ?, ?, 'menu', NULL, 'PROCESSANDO', ?)`,
        [messageId, conversationId, origin, expiraSql]
      );
      return { status: 'NOVO' };
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return { status: 'EM_ANDAMENTO' };
      }
      throw error;
    }
  }

  async concluirProcessamentoEvento(
    registro: WhatsAppProcessedEventRecord,
    nowMs = Date.now()
  ): Promise<void> {
    await this.garantirTabelasConversacao();
    const expiraSql = formatarDataHoraMySql(nowMs + this.eventTtlMs);
    await this.dbPool.query(
      `UPDATE whatsapp_evento_processado
       SET intencao = ?, resposta = ?, estado_envio = 'ENVIADO', expira_em = ?
       WHERE message_id = ?`,
      [registro.intent, registro.reply, expiraSql, registro.messageId]
    );
  }

  async cancelarProcessamentoEvento(messageId: string): Promise<void> {
    await this.garantirTabelasConversacao();
    await this.dbPool.query('DELETE FROM whatsapp_evento_processado WHERE message_id = ?', [messageId]);
  }

  async obterOuCriarSessao(
    conversationId: string,
    telefoneHash: string,
    nowMs = Date.now()
  ): Promise<WhatsAppConversationSession> {
    await this.garantirTabelasConversacao();
    const agoraSql = formatarDataHoraMySql(nowMs);
    const expiraEmMs = nowMs + this.sessionTtlMs;
    const expiraSql = formatarDataHoraMySql(expiraEmMs);

    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT s.conversation_id, s.telefone_hash, s.id_sessao_chatbot, s.paciente_uuid,
              s.etapa, s.intencao_atual, s.contexto_json,
              DATE_FORMAT(s.expira_em, '%Y-%m-%d %H:%i:%s') AS expira_em,
              p.nome AS paciente_nome
       FROM whatsapp_sessao_conversa s
       LEFT JOIN paciente p ON p.uuid = s.paciente_uuid
       WHERE s.conversation_id = ? LIMIT 1`,
      [conversationId]
    );

    if (rows.length > 0 && rows[0].expira_em > agoraSql) {
      const r = rows[0];
      let contexto: ConversationContext = {};
      if (r.contexto_json) {
        try {
          contexto = JSON.parse(r.contexto_json);
        } catch {
          contexto = {};
        }
      }
      return {
        conversationId: r.conversation_id,
        telefoneHash: r.telefone_hash,
        idSessaoChatbot: r.id_sessao_chatbot ? Number(r.id_sessao_chatbot) : null,
        pacienteUuid: r.paciente_uuid || null,
        pacienteNome: r.paciente_nome || null,
        etapa: (r.etapa as ConversationStep) || 'MENU_PRINCIPAL',
        intencaoAtual: (r.intencao_atual as Intent) || 'menu',
        contexto,
        expiraEmMs
      };
    }

    // Se havia sessão anterior expirada em andamento, marcar como Abandonada no funil
    if (rows.length > 0 && rows[0].id_sessao_chatbot) {
      await this.dbPool.query(
        `UPDATE sessao_chatbot
         SET status_sessao = 'Abandonada', data_hora_fim = COALESCE(data_hora_fim, ?)
         WHERE id_sessao = ? AND status_sessao = 'Em_Andamento'`,
        [agoraSql, rows[0].id_sessao_chatbot]
      );
    }

    const identificadorChat = `WA-${conversationId.slice(0, 18)}-${nowMs}`;
    const [chatInsert] = await this.dbPool.query<ResultSetHeader>(
      `INSERT INTO sessao_chatbot (identificador_chat, data_hora_inicio, status_sessao, escalonado_humano)
       VALUES (?, ?, 'Em_Andamento', 0)`,
      [identificadorChat, agoraSql]
    );
    const idSessaoChatbot = chatInsert.insertId || null;

    const novaSessao: WhatsAppConversationSession = {
      conversationId,
      telefoneHash,
      idSessaoChatbot,
      pacienteUuid: null,
      pacienteNome: null,
      etapa: 'MENU_PRINCIPAL',
      intencaoAtual: 'menu',
      contexto: {},
      expiraEmMs
    };

    await this.dbPool.query(
      `INSERT INTO whatsapp_sessao_conversa
       (conversation_id, telefone_hash, id_sessao_chatbot, paciente_uuid, etapa, intencao_atual, contexto_json, expira_em)
       VALUES (?, ?, ?, NULL, 'MENU_PRINCIPAL', 'menu', '{}', ?)
       ON DUPLICATE KEY UPDATE
         telefone_hash = VALUES(telefone_hash),
         id_sessao_chatbot = VALUES(id_sessao_chatbot),
         paciente_uuid = NULL,
         etapa = 'MENU_PRINCIPAL',
         intencao_atual = 'menu',
         contexto_json = '{}',
         expira_em = VALUES(expira_em)`,
      [conversationId, telefoneHash, idSessaoChatbot, expiraSql]
    );

    return novaSessao;
  }

  async salvarSessao(
    sessao: WhatsAppConversationSession,
    opcoes?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
      escalonadoHumano?: boolean;
    },
    nowMs = Date.now()
  ): Promise<void> {
    await this.garantirTabelasConversacao();
    const expiraSql = formatarDataHoraMySql(nowMs + this.sessionTtlMs);
    const agoraSql = formatarDataHoraMySql(nowMs);

    await this.dbPool.query(
      `INSERT INTO whatsapp_sessao_conversa
       (conversation_id, telefone_hash, id_sessao_chatbot, paciente_uuid, etapa, intencao_atual, contexto_json, expira_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id_sessao_chatbot = VALUES(id_sessao_chatbot),
         paciente_uuid = VALUES(paciente_uuid),
         etapa = VALUES(etapa),
         intencao_atual = VALUES(intencao_atual),
         contexto_json = VALUES(contexto_json),
         expira_em = VALUES(expira_em)`,
      [
        sessao.conversationId,
        sessao.telefoneHash,
        sessao.idSessaoChatbot,
        sessao.pacienteUuid,
        sessao.etapa,
        sessao.intencaoAtual,
        JSON.stringify(sessao.contexto || {}),
        expiraSql
      ]
    );

    if (sessao.idSessaoChatbot && opcoes) {
      if (opcoes.statusSessaoChatbot) {
        const finalizar = opcoes.statusSessaoChatbot !== 'Em_Andamento';
        await this.dbPool.query(
          `UPDATE sessao_chatbot
           SET status_sessao = ?,
               data_hora_fim = IF(?, ?, data_hora_fim),
               escalonado_humano = IF(? IS NOT NULL, ?, escalonado_humano)
           WHERE id_sessao = ?`,
          [
            opcoes.statusSessaoChatbot,
            finalizar,
            agoraSql,
            opcoes.escalonadoHumano !== undefined ? 1 : null,
            opcoes.escalonadoHumano ? 1 : 0,
            sessao.idSessaoChatbot
          ]
        );
      } else if (opcoes.escalonadoHumano !== undefined) {
        await this.dbPool.query(
          `UPDATE sessao_chatbot SET escalonado_humano = ? WHERE id_sessao = ?`,
          [opcoes.escalonadoHumano ? 1 : 0, sessao.idSessaoChatbot]
        );
      }
    }
  }

  private mapRowPaciente(row: RowDataPacket): WhatsAppPaciente {
    return {
      id_paciente: Number(row.id_paciente),
      uuid: String(row.uuid),
      nome_completo: String(row.nome),
      cpf: row.cpf ? String(row.cpf).replace(/\D/g, '') : null,
      telefone: String(row.telefone || ''),
      whatsapp: String(row.whatsapp || ''),
      etapa_tratamento: String(row.etapa_tratamento || 'Avaliação'),
      atendimento_status: row.atendimento_status === 'IA' ? 'IA' : 'Humano'
    };
  }

  async autenticarPacientePorTelefoneECpf(
    phone: string,
    cpfInput: string
  ): Promise<ResultadoAutenticacaoPaciente> {
    const cpfDigitos = extrairDigitosCpf(cpfInput);
    if (!cpfDigitos) {
      return { status: 'CPF_INVALIDO' };
    }

    const telSemDdi = normalizarDigitosTelefoneComparacao(phone);
    const telComDdi = `55${telSemDdi}`;

    const [rowsTelefone] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT id_paciente, uuid, nome, cpf, telefone, whatsapp, etapa_tratamento, atendimento_status
       FROM paciente
       WHERE REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '') IN (?, ?)
          OR REGEXP_REPLACE(COALESCE(telefone, ''), '[^0-9]', '') IN (?, ?)`,
      [telSemDdi, telComDdi, telSemDdi, telComDdi]
    );

    const vinculados = rowsTelefone.map(r => this.mapRowPaciente(r));

    if (cpfDigitos.length === 4) {
      const matches = vinculados.filter(p => p.cpf && p.cpf.endsWith(cpfDigitos));
      if (matches.length === 1) {
        return { status: 'AUTENTICADO', paciente: matches[0] };
      }
      if (matches.length > 1) {
        return { status: 'CPF_AMBIGUO_EXIGE_COMPLETO' };
      }
      return { status: 'NAO_ENCONTRADO' };
    }

    const matchMesmoTel = vinculados.find(p => p.cpf === cpfDigitos);
    if (matchMesmoTel) {
      return { status: 'AUTENTICADO', paciente: matchMesmoTel };
    }

    const [rowsCpf] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT id_paciente, uuid, nome, cpf, telefone, whatsapp, etapa_tratamento, atendimento_status
       FROM paciente
       WHERE REGEXP_REPLACE(COALESCE(cpf, ''), '[^0-9]', '') = ? LIMIT 1`,
      [cpfDigitos]
    );

    if (rowsCpf.length > 0) {
      const p = this.mapRowPaciente(rowsCpf[0]);
      if (telefonesEquivalentes(p.whatsapp, phone) || telefonesEquivalentes(p.telefone, phone)) {
        return { status: 'AUTENTICADO', paciente: p };
      }
      return { status: 'CPF_VINCULADO_OUTRO_TELEFONE' };
    }

    if (!validarCPF(cpfDigitos)) {
      return { status: 'CPF_INVALIDO' };
    }

    return { status: 'NOVO_PACIENTE_CPF_VALIDO', cpfLimpo: cpfDigitos };
  }

  async obterPacientePorUuid(uuid: string): Promise<WhatsAppPaciente | null> {
    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT id_paciente, uuid, nome, cpf, telefone, whatsapp, etapa_tratamento, atendimento_status
       FROM paciente WHERE uuid = ? LIMIT 1`,
      [uuid]
    );
    if (!rows.length) return null;
    return this.mapRowPaciente(rows[0]);
  }

  async cadastrarPacienteRapidoWhatsApp(params: {
    nomeCompleto: string;
    cpf: string;
    whatsapp: string;
  }): Promise<WhatsAppPaciente> {
    const nomeSanitizado = sanitizarTexto(params.nomeCompleto);
    if (!nomeSanitizado || nomeSanitizado.length < 3 || nomeSanitizado.length > 150) {
      throw new ErroOperacao(400, 'Informe um nome completo válido.');
    }
    const cpfLimpo = params.cpf.replace(/\D/g, '');
    if (!validarCPF(cpfLimpo)) {
      throw new ErroOperacao(400, 'CPF inválido.');
    }
    const whatsappLimpo = params.whatsapp.replace(/\D/g, '');
    const uuid = randomUUID();

    const [res] = await this.dbPool.query<ResultSetHeader>(
      `INSERT INTO paciente (uuid, nome, cpf, telefone, whatsapp, endereco, etapa_tratamento, atendimento_status)
       VALUES (?, ?, ?, ?, ?, 'Pré-cadastro via WhatsApp - Aguardando dados completos na recepção', 'Avaliação', 'IA')`,
      [uuid, nomeSanitizado, cpfLimpo, whatsappLimpo, whatsappLimpo]
    );

    return {
      id_paciente: res.insertId,
      uuid,
      nome_completo: nomeSanitizado,
      cpf: cpfLimpo,
      telefone: whatsappLimpo,
      whatsapp: whatsappLimpo,
      etapa_tratamento: 'Avaliação',
      atendimento_status: 'IA'
    };
  }

  async listarProcedimentosAtivosComProfissionais(): Promise<WhatsAppProcedimento[]> {
    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT DISTINCT
         p.id_procedimento AS id,
         p.nome,
         p.duracao_minutos,
         p.preco,
         p.id_especialidade AS categoria_id,
         COALESCE(e.nome, 'Geral') AS categoria_nome,
         p.ativo
       FROM procedimento p
       LEFT JOIN especialidade e ON e.id_especialidade = p.id_especialidade
       INNER JOIN profissional_procedimento pp ON pp.id_procedimento = p.id_procedimento
       INNER JOIN profissional pr ON pr.id_profissional = pp.id_profissional
       WHERE p.ativo = 1 AND pr.ativo = 1
       ORDER BY p.id_procedimento ASC`
    );

    return rows.map(r => ({
      id: Number(r.id),
      nome: String(r.nome),
      duracao_minutos: Number(r.duracao_minutos),
      preco: Number(r.preco),
      categoria_id: Number(r.categoria_id),
      categoria_nome: String(r.categoria_nome),
      ativo: Number(r.ativo)
    }));
  }

  async listarProfissionaisAtivosPorProcedimento(procedimentoId: number): Promise<WhatsAppProfissional[]> {
    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT pr.id_profissional AS id,
              pr.nome,
              COALESCE(pr.especialidade_principal, 'Especialista') AS especialidade,
              pr.ativo
       FROM profissional pr
       INNER JOIN profissional_procedimento pp ON pp.id_profissional = pr.id_profissional
       INNER JOIN procedimento p ON p.id_procedimento = pp.id_procedimento
       WHERE pp.id_procedimento = ? AND pr.ativo = 1 AND p.ativo = 1
       ORDER BY pr.id_profissional ASC`,
      [procedimentoId]
    );

    return rows.map(r => ({
      id: Number(r.id),
      nome: String(r.nome),
      especialidade: String(r.especialidade),
      ativo: Number(r.ativo)
    }));
  }

  async listarHorariosDisponiveis(
    profissionalId: number,
    procedimentoId: number,
    data: string,
    pacienteUuid?: string | null,
    ignorarAgendamentoId = 0
  ): Promise<{ horarios: string[]; duracaoMinutos: number; preco: number }> {
    if (!validarFormatoData(data)) {
      throw new ErroOperacao(400, 'Data inválida. Use YYYY-MM-DD.');
    }

    const [servicos] = await this.dbPool.query<RowDataPacket[]>(
      'SELECT duracao_minutos, preco, ativo FROM procedimento WHERE id_procedimento = ?',
      [procedimentoId]
    );
    if (!servicos.length || !servicos[0].ativo) {
      throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');
    }

    const [profs] = await this.dbPool.query<RowDataPacket[]>(
      'SELECT ativo FROM profissional WHERE id_profissional = ?',
      [profissionalId]
    );
    const [vinculos] = await this.dbPool.query<RowDataPacket[]>(
      'SELECT 1 FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?',
      [profissionalId, procedimentoId]
    );
    if (!profs.length || !profs[0].ativo || !vinculos.length) {
      throw new ErroOperacao(400, 'Profissional inativo ou não habilitado.');
    }

    const janelas = await obterJanelasAgenda(this.dbPool, profissionalId, data, false);
    const [agendamentos] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT TIME_FORMAT(horario_inicio, '%H:%i') AS horario_inicio,
              TIME_FORMAT(horario_fim, '%H:%i') AS horario_fim
       FROM agendamento
       WHERE id_profissional = ? AND data = ? AND id_agendamento <> ? AND status <> 'Cancelado'`,
      [profissionalId, data, ignorarAgendamentoId]
    );
    const [bloqueios] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT TIME_FORMAT(horario_inicio, '%H:%i') AS horario_inicio,
              TIME_FORMAT(horario_fim, '%H:%i') AS horario_fim
       FROM bloqueio_agenda
       WHERE id_profissional = ? AND data = ?`,
      [profissionalId, data]
    );

    let agendamentosPaciente: RowDataPacket[] = [];
    if (pacienteUuid) {
      const [agPac] = await this.dbPool.query<RowDataPacket[]>(
        `SELECT TIME_FORMAT(horario_inicio, '%H:%i') AS horario_inicio,
                TIME_FORMAT(horario_fim, '%H:%i') AS horario_fim
         FROM agendamento
         WHERE paciente_uuid = ? AND data = ? AND id_agendamento <> ? AND status <> 'Cancelado'`,
        [pacienteUuid, data, ignorarAgendamentoId]
      );
      agendamentosPaciente = agPac;
    }

    const duracaoMinutos = Number(servicos[0].duracao_minutos);
    const duracaoComRespiro = duracaoMinutos + 15;
    const ocupados = [...agendamentos, ...bloqueios, ...agendamentosPaciente];

    const horarios: string[] = [];
    for (const [inicio, fim] of janelas) {
      for (let minuto = inicio; minuto + duracaoComRespiro <= fim; minuto += 30) {
        const disponivel = !ocupados.some(
          a =>
            minuto < converterHorarioParaMinutos(a.horario_fim) &&
            converterHorarioParaMinutos(a.horario_inicio) < minuto + duracaoComRespiro
        );
        if (disponivel) {
          horarios.push(converterMinutosParaHorario(minuto).slice(0, 5));
        }
      }
    }

    return {
      horarios,
      duracaoMinutos,
      preco: Number(servicos[0].preco)
    };
  }

  async listarDatasDisponiveis(
    profissionalId: number,
    procedimentoId: number,
    dataInicial: string,
    diasBusca = 14,
    limiteDatas = 5,
    pacienteUuid?: string | null,
    ignorarAgendamentoId = 0
  ): Promise<string[]> {
    const datas: string[] = [];
    for (let i = 0; i < diasBusca && datas.length < limiteDatas; i++) {
      const dataCandidata = adicionarDiasDataIso(dataInicial, i);
      const { horarios } = await this.listarHorariosDisponiveis(
        profissionalId,
        procedimentoId,
        dataCandidata,
        pacienteUuid,
        ignorarAgendamentoId
      );
      if (horarios.length > 0) {
        datas.push(dataCandidata);
      }
    }
    return datas;
  }

  async criarAgendamentoWhatsApp(params: {
    pacienteUuid: string;
    profissionalId: number;
    procedimentoId: number;
    data: string;
    horarioInicio: string;
    idSessaoChatbot?: number | null;
  }): Promise<WhatsAppAgendamentoResumo> {
    const { pacienteUuid, profissionalId, procedimentoId, data, horarioInicio, idSessaoChatbot } = params;
    if (!validarFormatoData(data)) throw new ErroOperacao(400, 'Data inválida. Use YYYY-MM-DD.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horarioInicio)) throw new ErroOperacao(400, 'Horário inválido. Use HH:MM.');

    return this.executarTransacaoAgenda([profissionalId], async (conexao: PoolConnection) => {
      const [profissionais] = await conexao.query<RowDataPacket[]>(
        'SELECT nome, ativo FROM profissional WHERE id_profissional = ?',
        [profissionalId]
      );
      if (!profissionais.length || !profissionais[0].ativo) {
        throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');
      }

      const [servicos] = await conexao.query<RowDataPacket[]>(
        'SELECT nome, duracao_minutos, preco, ativo FROM procedimento WHERE id_procedimento = ? FOR SHARE',
        [procedimentoId]
      );
      if (!servicos.length || !servicos[0].ativo) {
        throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');
      }

      const [vinculos] = await conexao.query<RowDataPacket[]>(
        'SELECT 1 FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?',
        [profissionalId, procedimentoId]
      );
      if (!vinculos.length) {
        throw new ErroOperacao(400, 'Profissional não habilitado para este procedimento.');
      }

      const duracao = Number(servicos[0].duracao_minutos);
      const fim = converterMinutosParaHorario(converterHorarioParaMinutos(horarioInicio) + duracao + 15);
      const janelas = await obterJanelasAgenda(conexao, profissionalId, data, false);
      if (!horarioCabeNasJanelas(horarioInicio, fim, janelas)) {
        throw new ErroOperacao(
          409,
          'Horário fora da jornada disponível, intervalo ou exceção da data (incluindo 15 minutos de respiro).'
        );
      }

      const [conflitos] = await conexao.query<RowDataPacket[]>(
        `SELECT id_agendamento FROM agendamento
         WHERE id_profissional = ? AND data = ? AND status <> 'Cancelado'
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissionalId, data, horarioInicio, fim]
      );
      if (conflitos.length) {
        throw new ErroOperacao(409, 'Conflito de agenda. O horário já está reservado.');
      }

      const [bloqueios] = await conexao.query<RowDataPacket[]>(
        `SELECT id_bloqueio FROM bloqueio_agenda
         WHERE id_profissional = ? AND data = ?
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissionalId, data, horarioInicio, fim]
      );
      if (bloqueios.length) {
        throw new ErroOperacao(409, 'Horário bloqueado na agenda.');
      }

      const [pacientes] = await conexao.query<RowDataPacket[]>(
        'SELECT id_paciente, uuid, nome, etapa_tratamento FROM paciente WHERE uuid = ? FOR UPDATE',
        [pacienteUuid]
      );
      if (!pacientes.length) {
        throw new ErroOperacao(404, 'Paciente não cadastrado.');
      }

      const [ocupadoPaciente] = await conexao.query<RowDataPacket[]>(
        `SELECT id_agendamento FROM agendamento
         WHERE paciente_uuid = ? AND data = ? AND status <> 'Cancelado'
           AND ? < horario_fim AND horario_inicio < ? FOR UPDATE`,
        [pacienteUuid, data, horarioInicio, fim]
      );
      if (ocupadoPaciente.length) {
        throw new ErroOperacao(409, 'Paciente já possui atendimento neste horário.');
      }

      const tipoAtendimento = ['Retorno', 'Manutenção'].includes(String(pacientes[0].etapa_tratamento))
        ? 'Retorno'
        : 'Primeira_Consulta';
      const preco = Number(servicos[0].preco);

      const [resultado] = await conexao.query<ResultSetHeader>(
        `INSERT INTO agendamento
         (id_paciente, paciente_uuid, id_profissional, id_procedimento, id_sessao_chatbot,
          data, horario_inicio, horario_fim, data_hora_agendamento, valor_cobrado,
          observacoes, tipo_atendimento, origem, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TIMESTAMP(?, ?), ?, 'Autoagendamento via WhatsApp', ?, 'Chatbot', 'Agendado')`,
        [
          pacientes[0].id_paciente,
          pacienteUuid,
          profissionalId,
          procedimentoId,
          idSessaoChatbot ?? null,
          data,
          horarioInicio,
          fim,
          data,
          horarioInicio,
          preco,
          tipoAtendimento
        ]
      );

      await conexao.query(
        `INSERT INTO historico_status_agendamento
         (id_agendamento, status_novo, tipo_evento, alterado_por, id_usuario, motivo)
         VALUES (?, 'Agendado', 'CRIACAO', 'WhatsApp Bot', NULL, 'Autoagendamento concluído pelo paciente via WhatsApp')`,
        [resultado.insertId]
      );

      return {
        id: resultado.insertId,
        data,
        horario_inicio: horarioInicio.slice(0, 5),
        horario_fim: fim.slice(0, 5),
        status: 'Agendado',
        paciente_id: pacienteUuid,
        paciente_nome: String(pacientes[0].nome),
        profissional_id: profissionalId,
        profissional_nome: String(profissionais[0].nome),
        servico_id: procedimentoId,
        servico_nome: String(servicos[0].nome),
        duracao_minutos: duracao,
        valor_cobrado: preco,
        origem: 'Chatbot'
      };
    });
  }

  async listarAgendamentosFuturosPaciente(
    pacienteUuid: string,
    dataReferencia: string
  ): Promise<WhatsAppAgendamentoResumo[]> {
    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT a.id_agendamento AS id,
              DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
              TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
              TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
              a.status,
              a.paciente_uuid AS paciente_id,
              p.nome AS paciente_nome,
              a.id_profissional AS profissional_id,
              pr.nome AS profissional_nome,
              a.id_procedimento AS servico_id,
              s.nome AS servico_nome,
              s.duracao_minutos,
              a.valor_cobrado,
              a.origem
       FROM agendamento a
       INNER JOIN paciente p ON p.uuid = a.paciente_uuid
       INNER JOIN profissional pr ON pr.id_profissional = a.id_profissional
       INNER JOIN procedimento s ON s.id_procedimento = a.id_procedimento
       WHERE a.paciente_uuid = ?
         AND a.data >= ?
         AND a.status NOT IN ('Cancelado', 'No_Show', 'Concluído', 'Realizado')
       ORDER BY a.data ASC, a.horario_inicio ASC`,
      [pacienteUuid, dataReferencia]
    );

    return rows.map(r => ({
      id: Number(r.id),
      data: String(r.data),
      horario_inicio: String(r.horario_inicio),
      horario_fim: String(r.horario_fim),
      status: String(r.status),
      paciente_id: String(r.paciente_id),
      paciente_nome: String(r.paciente_nome),
      profissional_id: Number(r.profissional_id),
      profissional_nome: String(r.profissional_nome),
      servico_id: Number(r.servico_id),
      servico_nome: String(r.servico_nome),
      duracao_minutos: Number(r.duracao_minutos),
      valor_cobrado: Number(r.valor_cobrado),
      origem: String(r.origem)
    }));
  }

  async buscarAgendamentosPendentesConfirmacaoAtiva(
    phone: string,
    dataReferencia: string
  ): Promise<WhatsAppAgendamentoResumo[]> {
    const telSemDdi = normalizarDigitosTelefoneComparacao(phone);
    if (!telSemDdi) return [];
    const telComDdi = `55${telSemDdi}`;

    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT a.id_agendamento AS id,
              DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
              TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
              TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
              a.status,
              a.paciente_uuid AS paciente_id,
              p.nome AS paciente_nome,
              a.id_profissional AS profissional_id,
              pr.nome AS profissional_nome,
              a.id_procedimento AS servico_id,
              s.nome AS servico_nome,
              s.duracao_minutos,
              a.valor_cobrado,
              a.origem
       FROM agendamento a
       INNER JOIN paciente p ON p.uuid = a.paciente_uuid
       INNER JOIN profissional pr ON pr.id_profissional = a.id_profissional
       INNER JOIN procedimento s ON s.id_procedimento = a.id_procedimento
       WHERE a.data >= ?
         AND a.status IN ('Agendado', 'Reagendado')
         AND EXISTS (
           SELECT 1 FROM comunicacao_agendamento c
           WHERE c.id_agendamento = a.id_agendamento
             AND c.ocorrencia = a.data_hora_agendamento
             AND c.tipo IN ('LEMBRETE', 'CONFIRMACAO')
             AND c.estado IN ('SUBMETIDA', 'ENTREGUE')
         )
         AND (
           REGEXP_REPLACE(COALESCE(p.whatsapp, ''), '[^0-9]', '') IN (?, ?)
           OR REGEXP_REPLACE(COALESCE(p.telefone, ''), '[^0-9]', '') IN (?, ?)
         )
       ORDER BY a.data ASC, a.horario_inicio ASC`,
      [dataReferencia, telSemDdi, telComDdi, telSemDdi, telComDdi]
    );

    return rows.map(r => ({
      id: Number(r.id),
      data: String(r.data),
      horario_inicio: String(r.horario_inicio),
      horario_fim: String(r.horario_fim),
      status: String(r.status),
      paciente_id: String(r.paciente_id),
      paciente_nome: String(r.paciente_nome),
      profissional_id: Number(r.profissional_id),
      profissional_nome: String(r.profissional_nome),
      servico_id: Number(r.servico_id),
      servico_nome: String(r.servico_nome),
      duracao_minutos: Number(r.duracao_minutos),
      valor_cobrado: Number(r.valor_cobrado),
      origem: String(r.origem)
    }));
  }

  async confirmarPresencaWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    idSessaoChatbot?: number | null;
    origemConfirmacao?: 'menu' | 'lembrete_ativo';
  }): Promise<{
    agendamento: WhatsAppAgendamentoResumo;
    statusAnterior: string;
    statusNovo: string;
    jaEstavaConfirmado: boolean;
  }> {
    const { agendamentoId, pacienteUuid } = params;
    const [profRows] = await this.dbPool.query<RowDataPacket[]>(
      'SELECT id_profissional FROM agendamento WHERE id_agendamento = ? AND paciente_uuid = ?',
      [agendamentoId, pacienteUuid]
    );
    if (!profRows.length) {
      throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
    }
    const profissionalId = Number(profRows[0].id_profissional);

    return this.executarTransacaoAgenda([profissionalId], async (conexao: PoolConnection) => {
      const [rows] = await conexao.query<RowDataPacket[]>(
        `SELECT a.id_agendamento AS id,
                DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
                TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
                TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
                DATE_FORMAT(a.data_hora_agendamento, '%Y-%m-%d %H:%i:%s') AS ocorrencia,
                a.status,
                a.paciente_uuid AS paciente_id,
                p.nome AS paciente_nome,
                a.id_profissional AS profissional_id,
                pr.nome AS profissional_nome,
                a.id_procedimento AS servico_id,
                s.nome AS servico_nome,
                s.duracao_minutos
         FROM agendamento a
         INNER JOIN paciente p ON p.uuid = a.paciente_uuid
         INNER JOIN profissional pr ON pr.id_profissional = a.id_profissional
         INNER JOIN procedimento s ON s.id_procedimento = a.id_procedimento
         WHERE a.id_agendamento = ? AND a.paciente_uuid = ?
         FOR UPDATE`,
        [agendamentoId, pacienteUuid]
      );

      if (!rows.length) {
        throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
      }

      const atual = rows[0];
      const resumo: WhatsAppAgendamentoResumo = {
        id: Number(atual.id),
        data: String(atual.data),
        horario_inicio: String(atual.horario_inicio),
        horario_fim: String(atual.horario_fim),
        status: 'Confirmado',
        paciente_id: String(atual.paciente_id),
        paciente_nome: String(atual.paciente_nome),
        profissional_id: Number(atual.profissional_id),
        profissional_nome: String(atual.profissional_nome),
        servico_id: Number(atual.servico_id),
        servico_nome: String(atual.servico_nome),
        duracao_minutos: Number(atual.duracao_minutos)
      };

      if (atual.status === 'Confirmado') {
        return {
          agendamento: resumo,
          statusAnterior: 'Confirmado',
          statusNovo: 'Confirmado',
          jaEstavaConfirmado: true
        };
      }

      if (!['Agendado', 'Reagendado'].includes(atual.status)) {
        throw new ErroOperacao(
          409,
          `Mudança de status não permitida para atendimento em status "${atual.status}".`
        );
      }

      const statusAnterior = String(atual.status);
      const motivo =
        params.origemConfirmacao === 'lembrete_ativo'
          ? 'Presença confirmada pelo paciente em resposta ao lembrete via WhatsApp'
          : 'Presença confirmada pelo paciente via WhatsApp';
      const autor = 'Paciente via WhatsApp';

      const [anteriores] = await conexao.query<RowDataPacket[]>(
        'SELECT COALESCE(MAX(id_historico), 0) AS ultimo FROM historico_status_agendamento WHERE id_agendamento = ?',
        [agendamentoId]
      );

      await conexao.query(
        "UPDATE agendamento SET status = 'Confirmado' WHERE id_agendamento = ?",
        [agendamentoId]
      );

      const [novos] = await conexao.query<RowDataPacket[]>(
        `SELECT id_historico FROM historico_status_agendamento
         WHERE id_agendamento = ? AND id_historico > ?
         ORDER BY id_historico DESC LIMIT 1`,
        [agendamentoId, anteriores[0]?.ultimo ?? 0]
      );

      if (novos.length) {
        await conexao.query(
          `UPDATE historico_status_agendamento
           SET motivo = ?, tipo_evento = 'STATUS', alterado_por = ?, id_usuario = NULL
           WHERE id_historico = ?`,
          [motivo, autor, novos[0].id_historico]
        );
      } else {
        await conexao.query(
          `INSERT INTO historico_status_agendamento
           (id_agendamento, status_anterior, status_novo, motivo, tipo_evento, alterado_por, id_usuario)
           VALUES (?, ?, 'Confirmado', ?, 'STATUS', ?, NULL)`,
          [agendamentoId, statusAnterior, motivo, autor]
        );
      }

      if (atual.ocorrencia) {
        if (params.origemConfirmacao === 'lembrete_ativo') {
          await conexao.query(
            `UPDATE comunicacao_agendamento
             SET estado = 'ENTREGUE'
             WHERE id_agendamento = ? AND ocorrencia = ? AND estado = 'SUBMETIDA'`,
            [agendamentoId, atual.ocorrencia]
          );
        }

        const [ultimasCom] = await conexao.query<RowDataPacket[]>(
          `SELECT COALESCE(MAX(tentativa), 0) AS ultima
           FROM comunicacao_agendamento
           WHERE id_agendamento = ? AND ocorrencia = ? AND tipo = 'CONFIRMACAO'`,
          [agendamentoId, atual.ocorrencia]
        );
        const novaTentativa = Number(ultimasCom[0]?.ultima ?? 0) + 1;
        await conexao.query(
          `INSERT INTO comunicacao_agendamento
           (id_agendamento, ocorrencia, tipo, canal, provedor, tentativa, estado, referencia_externa)
           VALUES (?, ?, 'CONFIRMACAO', 'WHATSAPP', 'whatsapp-bot', ?, 'ENTREGUE', ?)`,
          [agendamentoId, atual.ocorrencia, novaTentativa, `whatsapp-confirm-${agendamentoId}-${novaTentativa}`]
        );
      }

      return {
        agendamento: resumo,
        statusAnterior,
        statusNovo: 'Confirmado',
        jaEstavaConfirmado: false
      };
    });
  }

  async reagendarAgendamentoWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    novaData: string;
    novoHorarioInicio: string;
    motivo?: string;
  }): Promise<{
    agendamento: WhatsAppAgendamentoResumo;
    dataAnterior: string;
    horarioAnterior: string;
    statusAnterior: string;
  }> {
    const { agendamentoId, pacienteUuid, novaData, novoHorarioInicio } = params;
    if (!validarFormatoData(novaData)) throw new ErroOperacao(400, 'Data inválida. Use YYYY-MM-DD.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(novoHorarioInicio)) throw new ErroOperacao(400, 'Horário inválido. Use HH:MM.');

    const [profRows] = await this.dbPool.query<RowDataPacket[]>(
      'SELECT id_profissional FROM agendamento WHERE id_agendamento = ? AND paciente_uuid = ?',
      [agendamentoId, pacienteUuid]
    );
    if (!profRows.length) {
      throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
    }
    const profissionalId = Number(profRows[0].id_profissional);

    return this.executarTransacaoAgenda([profissionalId], async (conexao: PoolConnection) => {
      const [rows] = await conexao.query<RowDataPacket[]>(
        `SELECT a.id_agendamento AS id,
                DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
                TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
                TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
                a.status,
                a.paciente_uuid AS paciente_id,
                p.nome AS paciente_nome,
                a.id_profissional AS profissional_id,
                pr.nome AS profissional_nome,
                pr.ativo AS profissional_ativo,
                a.id_procedimento AS servico_id,
                s.nome AS servico_nome,
                s.duracao_minutos,
                s.ativo AS procedimento_ativo
         FROM agendamento a
         INNER JOIN paciente p ON p.uuid = a.paciente_uuid
         INNER JOIN profissional pr ON pr.id_profissional = a.id_profissional
         INNER JOIN procedimento s ON s.id_procedimento = a.id_procedimento
         WHERE a.id_agendamento = ? AND a.paciente_uuid = ?
         FOR UPDATE`,
        [agendamentoId, pacienteUuid]
      );

      if (!rows.length) {
        throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
      }

      const atual = rows[0];
      if (['Cancelado', 'No_Show', 'Concluído', 'Realizado', 'Em Atendimento'].includes(String(atual.status))) {
        throw new ErroOperacao(409, 'Este atendimento não pode ser reagendado no status atual.');
      }
      if (!atual.profissional_ativo) {
        throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');
      }
      if (!atual.procedimento_ativo) {
        throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');
      }

      const [vinculos] = await conexao.query<RowDataPacket[]>(
        'SELECT 1 FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?',
        [profissionalId, Number(atual.servico_id)]
      );
      if (!vinculos.length) {
        throw new ErroOperacao(400, 'Profissional não habilitado para este procedimento.');
      }

      const duracao = Number(atual.duracao_minutos);
      const fim = converterMinutosParaHorario(converterHorarioParaMinutos(novoHorarioInicio) + duracao + 15);
      const janelas = await obterJanelasAgenda(conexao, profissionalId, novaData, false);
      if (!horarioCabeNasJanelas(novoHorarioInicio, fim, janelas)) {
        throw new ErroOperacao(
          409,
          'Horário fora da jornada disponível, intervalo ou exceção da data (incluindo 15 minutos de respiro).'
        );
      }

      const [conflitos] = await conexao.query<RowDataPacket[]>(
        `SELECT id_agendamento FROM agendamento
         WHERE id_profissional = ? AND data = ? AND id_agendamento <> ? AND status <> 'Cancelado'
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissionalId, novaData, agendamentoId, novoHorarioInicio, fim]
      );
      if (conflitos.length) {
        throw new ErroOperacao(409, 'Conflito de agenda. O horário já está reservado.');
      }

      const [bloqueios] = await conexao.query<RowDataPacket[]>(
        `SELECT id_bloqueio FROM bloqueio_agenda
         WHERE id_profissional = ? AND data = ?
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissionalId, novaData, novoHorarioInicio, fim]
      );
      if (bloqueios.length) {
        throw new ErroOperacao(409, 'Horário bloqueado na agenda.');
      }

      await conexao.query('SELECT id_paciente FROM paciente WHERE uuid = ? FOR UPDATE', [pacienteUuid]);
      const [ocupadoPaciente] = await conexao.query<RowDataPacket[]>(
        `SELECT id_agendamento FROM agendamento
         WHERE paciente_uuid = ? AND data = ? AND id_agendamento <> ? AND status <> 'Cancelado'
           AND ? < horario_fim AND horario_inicio < ? FOR UPDATE`,
        [pacienteUuid, novaData, agendamentoId, novoHorarioInicio, fim]
      );
      if (ocupadoPaciente.length) {
        throw new ErroOperacao(409, 'Paciente já possui atendimento neste horário.');
      }

      const dataAnterior = String(atual.data);
      const horarioAnterior = String(atual.horario_inicio);
      const statusAnterior = String(atual.status);
      const motivoTexto =
        sanitizarTexto(params.motivo || '') ||
        `Reagendado pelo paciente via WhatsApp (de ${dataAnterior} ${horarioAnterior} para ${novaData} ${novoHorarioInicio})`;
      const autor = 'Paciente via WhatsApp';

      const [anteriores] = await conexao.query<RowDataPacket[]>(
        'SELECT COALESCE(MAX(id_historico), 0) AS ultimo FROM historico_status_agendamento WHERE id_agendamento = ?',
        [agendamentoId]
      );

      await conexao.query(
        `UPDATE agendamento
         SET data = ?, horario_inicio = ?, horario_fim = ?,
             data_hora_agendamento = TIMESTAMP(?, ?), status = 'Reagendado'
         WHERE id_agendamento = ?`,
        [novaData, novoHorarioInicio, fim, novaData, novoHorarioInicio, agendamentoId]
      );

      const [novos] = await conexao.query<RowDataPacket[]>(
        `SELECT id_historico FROM historico_status_agendamento
         WHERE id_agendamento = ? AND id_historico > ?
         ORDER BY id_historico DESC LIMIT 1`,
        [agendamentoId, anteriores[0]?.ultimo ?? 0]
      );

      if (novos.length) {
        await conexao.query(
          `UPDATE historico_status_agendamento
           SET motivo = ?, tipo_evento = 'REAGENDAMENTO', alterado_por = ?, id_usuario = NULL
           WHERE id_historico = ?`,
          [motivoTexto, autor, novos[0].id_historico]
        );
      } else {
        await conexao.query(
          `INSERT INTO historico_status_agendamento
           (id_agendamento, status_anterior, status_novo, motivo, tipo_evento, alterado_por, id_usuario)
           VALUES (?, ?, 'Reagendado', ?, 'REAGENDAMENTO', ?, NULL)`,
          [agendamentoId, statusAnterior, motivoTexto, autor]
        );
      }

      return {
        agendamento: {
          id: agendamentoId,
          data: novaData,
          horario_inicio: novoHorarioInicio.slice(0, 5),
          horario_fim: fim.slice(0, 5),
          status: 'Reagendado',
          paciente_id: String(atual.paciente_id),
          paciente_nome: String(atual.paciente_nome),
          profissional_id: profissionalId,
          profissional_nome: String(atual.profissional_nome),
          servico_id: Number(atual.servico_id),
          servico_nome: String(atual.servico_nome),
          duracao_minutos: duracao
        },
        dataAnterior,
        horarioAnterior,
        statusAnterior
      };
    });
  }

  async listarAgendamentosElegiveisAvaliacao(pacienteUuid: string): Promise<WhatsAppAgendamentoResumo[]> {
    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT a.id_agendamento AS id,
              DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
              TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
              TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
              a.status,
              a.paciente_uuid AS paciente_id,
              p.nome AS paciente_nome,
              a.id_profissional AS profissional_id,
              pr.nome AS profissional_nome,
              a.id_procedimento AS servico_id,
              s.nome AS servico_nome,
              s.duracao_minutos,
              a.valor_cobrado,
              a.origem
       FROM agendamento a
       INNER JOIN paciente p ON p.uuid = a.paciente_uuid
       INNER JOIN profissional pr ON pr.id_profissional = a.id_profissional
       INNER JOIN procedimento s ON s.id_procedimento = a.id_procedimento
       LEFT JOIN avaliacao_atendimento av ON av.id_agendamento = a.id_agendamento
       WHERE a.paciente_uuid = ?
         AND a.status IN ('Concluído', 'Realizado')
         AND av.id_avaliacao IS NULL
       ORDER BY a.data DESC, a.horario_inicio DESC
       LIMIT 5`,
      [pacienteUuid]
    );

    return rows.map(r => ({
      id: Number(r.id),
      data: String(r.data),
      horario_inicio: String(r.horario_inicio),
      horario_fim: String(r.horario_fim),
      status: String(r.status),
      paciente_id: String(r.paciente_id),
      paciente_nome: String(r.paciente_nome),
      profissional_id: Number(r.profissional_id),
      profissional_nome: String(r.profissional_nome),
      servico_id: Number(r.servico_id),
      servico_nome: String(r.servico_nome),
      duracao_minutos: Number(r.duracao_minutos),
      valor_cobrado: Number(r.valor_cobrado),
      origem: String(r.origem)
    }));
  }

  async registrarAvaliacaoNpsWhatsApp(params: {
    agendamentoId: number;
    pacienteUuid: string;
    notaNps: number;
    comentario?: string | null;
  }): Promise<{
    avaliacao: WhatsAppAvaliacaoNps;
    agendamento: WhatsAppAgendamentoResumo;
  }> {
    const { agendamentoId, pacienteUuid, notaNps } = params;
    if (!Number.isInteger(notaNps) || notaNps < 0 || notaNps > 10) {
      throw new ErroOperacao(400, 'Informe uma nota de 0 a 10.');
    }

    const [rows] = await this.dbPool.query<RowDataPacket[]>(
      `SELECT a.id_agendamento AS id,
              DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
              TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
              TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
              a.status,
              a.paciente_uuid AS paciente_id,
              p.nome AS paciente_nome,
              a.id_profissional AS profissional_id,
              pr.nome AS profissional_nome,
              a.id_procedimento AS servico_id,
              s.nome AS servico_nome,
              s.duracao_minutos
       FROM agendamento a
       INNER JOIN paciente p ON p.uuid = a.paciente_uuid
       INNER JOIN profissional pr ON pr.id_profissional = a.id_profissional
       INNER JOIN procedimento s ON s.id_procedimento = a.id_procedimento
       WHERE a.id_agendamento = ? AND a.paciente_uuid = ?
       LIMIT 1`,
      [agendamentoId, pacienteUuid]
    );

    if (!rows.length) {
      throw new ErroOperacao(404, 'Agendamento não encontrado para este paciente.');
    }

    const ag = rows[0];
    if (!['Concluído', 'Realizado'].includes(String(ag.status))) {
      throw new ErroOperacao(409, 'Apenas atendimentos concluídos podem ser avaliados.');
    }

    const comentarioLimpo = params.comentario ? sanitizarTexto(params.comentario).slice(0, 500) || null : null;
    const dataResposta = formatarDataHoraMySql(Date.now());

    try {
      const [insert] = await this.dbPool.query<ResultSetHeader>(
        `INSERT INTO avaliacao_atendimento (id_agendamento, nota_nps, comentario, data_resposta)
         VALUES (?, ?, ?, ?)`,
        [agendamentoId, notaNps, comentarioLimpo, dataResposta]
      );

      return {
        avaliacao: {
          id_avaliacao: insert.insertId,
          id_agendamento: agendamentoId,
          nota_nps: notaNps,
          comentario: comentarioLimpo,
          data_resposta: dataResposta
        },
        agendamento: {
          id: Number(ag.id),
          data: String(ag.data),
          horario_inicio: String(ag.horario_inicio),
          horario_fim: String(ag.horario_fim),
          status: String(ag.status),
          paciente_id: String(ag.paciente_id),
          paciente_nome: String(ag.paciente_nome),
          profissional_id: Number(ag.profissional_id),
          profissional_nome: String(ag.profissional_nome),
          servico_id: Number(ag.servico_id),
          servico_nome: String(ag.servico_nome),
          duracao_minutos: Number(ag.duracao_minutos)
        }
      };
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new ErroOperacao(409, 'Este atendimento já foi avaliado.');
      }
      throw error;
    }
  }
}

export function createWhatsAppClinicRepository(
  mode: 'memory' | 'mysql' = 'memory',
  dbPool: Pool = poolPadrao
): WhatsAppClinicRepository {
  if (mode === 'mysql') {
    return new MySqlWhatsAppClinicRepository(dbPool);
  }
  return new InMemoryWhatsAppClinicRepository(mockStore);
}
