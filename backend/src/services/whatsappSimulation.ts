import { createHash } from 'node:crypto';
import { ErroOperacao } from '../config/database.js';
import { calcularHorarioTermino, obterNomeDiaSemana } from '../utils/validation.js';
import {
  ConversationStep,
  InMemoryWhatsAppClinicRepository,
  Intent,
  WhatsAppAgendamentoResumo,
  WhatsAppClinicRepository,
  WhatsAppConversationSession
} from './whatsappClinicRepository.js';

export const MENU =
  'Olá! Bem-vindo à Clínica IKIGAI.\n\nComo podemos ajudar?\n\n' +
  '1 - Agendar consulta\n' +
  '2 - Consultar agendamento\n' +
  '3 - Confirmar presença\n' +
  '4 - Reagendar consulta\n' +
  '5 - Avaliar atendimento (NPS)\n' +
  '6 - Falar com a recepção / atendente';

export function ehSolicitacaoTransbordoHumano(raw: string, etapa: ConversationStep): boolean {
  const normalizado = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalizado) return false;

  // Em etapas de texto livre (nome ou comentário NPS), aceita apenas comandos diretos
  if (etapa === 'AGUARDANDO_NOME_CADASTRO' || etapa === 'AGUARDANDO_COMENTARIO_NPS') {
    return /^(atendente|humano|secretaria|recepcao|falar com (o |a |um |uma )?(atendente|humano|recepcao|secretaria))$/.test(normalizado);
  }

  if (normalizado === '6' && (etapa === 'MENU_PRINCIPAL' || etapa === 'AGUARDANDO_CPF')) {
    return true;
  }

  if (/\b(atendente|atendimento humano|suporte humano|ajuda humana|pessoa real|recepcao|recepcionista|secretaria)\b/.test(normalizado)) {
    return true;
  }

  if (/^(humano|suporte|ajuda|preciso de ajuda|quero ajuda)$/.test(normalizado)) {
    return true;
  }

  if (/(falar|conversar|transferir|chamar|passar)\s+(com\s+|para\s+)?(um\s+|uma\s+|o\s+|a\s+)?(atendente|humano|alguem|pessoa|recepcao|recepcionista|secretaria|equipe|clinica|suporte)/.test(normalizado)) {
    return true;
  }

  return false;
}

export type { Intent, ConversationStep };
export type MessageOrigin = 'n8n-local-simulation' | 'baileys-local';

export interface IncomingMessage {
  messageId: string;
  phone: string;
  text: string;
  origin: MessageOrigin;
}

export interface OutgoingMessage {
  messageId: string;
  conversationId: string;
  intent: Intent;
  reply: string;
  simulated: true;
  duplicate: boolean;
  step?: ConversationStep;
  authenticated?: boolean;
  agendamentoId?: number;
}

export interface MessageProvider {
  send(phone: string, text: string): Promise<void>;
}

export interface WhatsAppServiceOptions {
  repository?: WhatsAppClinicRepository;
  now?: () => Date;
}

export class SimulatedMessageProvider implements MessageProvider {
  readonly outbox: Array<{ phone: string; text: string }> = [];
  async send(phone: string, text: string): Promise<void> {
    this.outbox.push({ phone, text });
  }
}

function isClinicRepository(obj: unknown): obj is WhatsAppClinicRepository {
  return Boolean(obj && typeof obj === 'object' && 'iniciarProcessamentoEvento' in obj);
}

export function formatarDataIsoLocal(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatarDataBr(dataIso: string): string {
  const [y, m, d] = dataIso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatarDataBrComDiaSemana(dataIso: string): string {
  const dt = new Date(`${dataIso}T12:00:00Z`);
  const diaNome = obterNomeDiaSemana(dt.getUTCDay());
  return `${formatarDataBr(dataIso)} (${diaNome})`;
}

export function formatarMoedaBr(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

export function converterEntradaDataParaIso(raw: string): string | null {
  const texto = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }
  const matchBr = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (matchBr) {
    return `${matchBr[3]}-${matchBr[2]}-${matchBr[1]}`;
  }
  return null;
}

export class WhatsAppSimulationService {
  readonly repository: WhatsAppClinicRepository;
  private readonly now: () => Date;

  constructor(
    private readonly provider: MessageProvider,
    private readonly log: (entry: string) => void = console.info,
    repositoryOrOptions?: WhatsAppClinicRepository | WhatsAppServiceOptions
  ) {
    if (isClinicRepository(repositoryOrOptions)) {
      this.repository = repositoryOrOptions;
      this.now = () => new Date();
    } else {
      this.repository = repositoryOrOptions?.repository ?? new InMemoryWhatsAppClinicRepository();
      this.now = repositoryOrOptions?.now ?? (() => new Date());
    }
  }

  async process(event: IncomingMessage): Promise<OutgoingMessage> {
    const nowDate = this.now();
    const nowMs = nowDate.getTime();
    const dataHoje = formatarDataIsoLocal(nowDate);
    const conversationId = createHash('sha256').update(event.phone).digest('hex').slice(0, 24);

    const idempotencia = await this.repository.iniciarProcessamentoEvento(
      event.messageId,
      conversationId,
      event.origin,
      nowMs
    );

    if (idempotencia.status === 'DUPLICADO') {
      const reg = idempotencia.registro;
      return {
        messageId: event.messageId,
        conversationId,
        intent: reg.intent,
        reply: reg.reply,
        simulated: true,
        duplicate: true,
        step: reg.step,
        agendamentoId: reg.agendamentoId
      };
    }

    if (idempotencia.status === 'EM_ANDAMENTO') {
      throw new Error('EVENT_IN_PROGRESS');
    }

    let sessao: WhatsAppConversationSession;
    try {
      sessao = await this.repository.obterOuCriarSessao(conversationId, conversationId, nowMs);
    } catch (error) {
      await this.repository.cancelarProcessamentoEvento(event.messageId);
      throw error;
    }

    let resultadoFluxo: {
      intent: Intent;
      reply: string;
      agendamentoId?: number;
      opcoesSessao?: {
        statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
        escalonadoHumano?: boolean;
      };
    };

    try {
      resultadoFluxo = await this.executarPassoConversacional(sessao, event, dataHoje);
    } catch (error) {
      await this.repository.cancelarProcessamentoEvento(event.messageId);
      throw error;
    }

    try {
      await this.provider.send(event.phone, resultadoFluxo.reply);
    } catch {
      await this.repository.cancelarProcessamentoEvento(event.messageId);
      this.log(`[WhatsApp simulation] id=${event.messageId} phone=***${event.phone.slice(-4)} result=provider_error`);
      throw new Error('PROVIDER_FAILURE');
    }

    await this.repository.salvarSessao(sessao, resultadoFluxo.opcoesSessao, nowMs);
    await this.repository.concluirProcessamentoEvento(
      {
        messageId: event.messageId,
        conversationId,
        origin: event.origin,
        intent: resultadoFluxo.intent,
        reply: resultadoFluxo.reply,
        step: sessao.etapa,
        agendamentoId: resultadoFluxo.agendamentoId,
        statusEnvio: 'ENVIADO'
      },
      nowMs
    );

    this.log(
      `[WhatsApp simulation] id=${event.messageId} phone=***${event.phone.slice(-4)} intent=${resultadoFluxo.intent} step=${sessao.etapa} result=simulated`
    );

    return {
      messageId: event.messageId,
      conversationId,
      intent: resultadoFluxo.intent,
      reply: resultadoFluxo.reply,
      simulated: true,
      duplicate: false,
      step: sessao.etapa,
      authenticated: Boolean(sessao.pacienteUuid),
      agendamentoId: resultadoFluxo.agendamentoId
    };
  }

  private async executarPassoConversacional(
    sessao: WhatsAppConversationSession,
    event: IncomingMessage,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
      escalonadoHumano?: boolean;
    };
  }> {
    const value = event.text.trim();
    const contatoFinal = event.phone.replace(/\D/g, '').slice(-4) || undefined;
    if (contatoFinal) {
      sessao.contexto.contatoFinal = contatoFinal;
    }

    const preservarBloqueio = (novo: Record<string, unknown>) => {
      const bloqueioAte = Number((sessao.contexto as Record<string, unknown>).bloqueioAuthAte || 0);
      const tentativasAtuais = !sessao.pacienteUuid ? Number(sessao.contexto.tentativasAuth || 0) : 0;
      const base: Record<string, unknown> = {
        ...(contatoFinal ? { contatoFinal } : {}),
        ...(bloqueioAte > this.now().getTime() ? { bloqueioAuthAte: bloqueioAte } : {}),
        ...(tentativasAtuais > 0 ? { tentativasAuth: tentativasAtuais } : {}),
        ...(sessao.contexto.escalonadoEm ? { escalonadoEm: sessao.contexto.escalonadoEm } : {}),
        ...(sessao.contexto.escalonadoMotivo ? { escalonadoMotivo: sessao.contexto.escalonadoMotivo } : {}),
        ...novo,
      };
      return base as typeof sessao.contexto;
    };

    // 1. Comandos globais de saudação, menu ou retorno ao menu principal
    // Observação: na etapa AGUARDANDO_NOTA_NPS, '0' é uma nota válida (0 a 10).
    if (
      value === '' ||
      /^(menu|oi|ol[aá]|bom dia|boa tarde|boa noite|in[ií]cio|voltar|cancelar|sair)$/i.test(value) ||
      (value === '0' && sessao.etapa !== 'MENU_PRINCIPAL' && sessao.etapa !== 'AGUARDANDO_NOTA_NPS')
    ) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'menu';
      sessao.contexto = preservarBloqueio({});
      return { intent: 'menu', reply: MENU };
    }

    // 2. Solicitação explícita ou em linguagem natural de transbordo humano (inclusive opção 6 do menu)
    if (ehSolicitacaoTransbordoHumano(value, sessao.etapa)) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'menu';
      sessao.contexto = preservarBloqueio({
        escalonadoEm: this.now().toISOString(),
        escalonadoMotivo: 'Solicitação de atendimento humano via WhatsApp'
      });
      return {
        intent: 'menu',
        reply:
          'Solicitação de atendimento humano registrada! Nossa equipe de recepção da Clínica IKIGAI dará continuidade ao seu atendimento.\n\nCaso deseje retornar ao autoatendimento, digite *menu* a qualquer momento.',
        opcoesSessao: { statusSessaoChatbot: 'Em_Andamento', escalonadoHumano: true }
      };
    }

    // 2.1. Resposta rápida a lembretes/confirmações ativas ou palavras-chave no menu principal
    if (sessao.etapa === 'MENU_PRINCIPAL') {
      if (/^(sim|confirmo|confirmar|confirmado|ok|positivo|vou sim|estarei l[aá])$/i.test(value)) {
        return this.processarRespostaConfirmacaoAtiva(sessao, event.phone, dataHoje);
      }
      if (/^(reagendar|remarcar|alterar hor[aá]rio|trocar hor[aá]rio)$/i.test(value)) {
        return this.processarOpcaoMenuPrincipal(sessao, '4', dataHoje);
      }
      if (/^(avaliar|nps|pesquisa|avalia[cç][aã]o)$/i.test(value)) {
        return this.processarOpcaoMenuPrincipal(sessao, '5', dataHoje);
      }
    }

    // 3. Menu principal ou troca rápida de opção de 1 dígito ainda na etapa AGUARDANDO_CPF
    if (sessao.etapa === 'MENU_PRINCIPAL' || (sessao.etapa === 'AGUARDANDO_CPF' && /^\d$/.test(value))) {
      return this.processarOpcaoMenuPrincipal(sessao, value, dataHoje);
    }

    switch (sessao.etapa) {
      case 'AGUARDANDO_CPF':
        return this.processarEtapaCpf(sessao, event.phone, value, dataHoje);
      case 'AGUARDANDO_NOME_CADASTRO':
        return this.processarEtapaNomeCadastro(sessao, event.phone, value);
      case 'AGUARDANDO_PROCEDIMENTO':
        return this.processarEtapaProcedimento(sessao, value);
      case 'AGUARDANDO_PROFISSIONAL':
        return this.processarEtapaProfissional(sessao, value, dataHoje);
      case 'AGUARDANDO_DATA':
        return this.processarEtapaData(sessao, value, dataHoje);
      case 'AGUARDANDO_HORARIO':
        return this.processarEtapaHorario(sessao, value);
      case 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO':
        return this.processarEtapaConfirmacaoAgendamento(sessao, value, dataHoje);
      case 'AGUARDANDO_SELECAO_CONFIRMACAO':
        return this.processarEtapaSelecaoConfirmacaoPresenca(sessao, value);
      case 'AGUARDANDO_SELECAO_REAGENDAMENTO':
        return this.processarEtapaSelecaoReagendamento(sessao, value, dataHoje);
      case 'AGUARDANDO_DATA_REAGENDAMENTO':
        return this.processarEtapaDataReagendamento(sessao, value, dataHoje);
      case 'AGUARDANDO_HORARIO_REAGENDAMENTO':
        return this.processarEtapaHorarioReagendamento(sessao, value);
      case 'AGUARDANDO_CONFIRMACAO_REAGENDAMENTO':
        return this.processarEtapaConfirmacaoReagendamento(sessao, value, dataHoje);
      case 'AGUARDANDO_SELECAO_AVALIACAO':
        return this.processarEtapaSelecaoAvaliacao(sessao, value);
      case 'AGUARDANDO_NOTA_NPS':
        return this.processarEtapaNotaNps(sessao, value);
      case 'AGUARDANDO_COMENTARIO_NPS':
        return this.processarEtapaComentarioNps(sessao, value);
      default:
        sessao.etapa = 'MENU_PRINCIPAL';
        sessao.intencaoAtual = 'menu';
        sessao.contexto = contatoFinal ? { contatoFinal } : {};
        return { intent: 'menu', reply: MENU };
    }
  }

  private async processarOpcaoMenuPrincipal(
    sessao: WhatsAppConversationSession,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
      escalonadoHumano?: boolean;
    };
  }> {
    const bloqueioAtivo = Number((sessao.contexto as Record<string, unknown>).bloqueioAuthAte || 0);
    const tentativasAtuais = !sessao.pacienteUuid ? Number(sessao.contexto.tentativasAuth || 0) : 0;
    const manterSeguranca = (extra: Record<string, unknown>) => ({
      ...(sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {}),
      ...(bloqueioAtivo > this.now().getTime() ? { bloqueioAuthAte: bloqueioAtivo } : {}),
      ...(tentativasAtuais > 0 ? { tentativasAuth: tentativasAtuais } : {}),
      ...extra,
    } as typeof sessao.contexto);

    if (['1', '2', '3', '4', '5'].includes(value) && !sessao.pacienteUuid && bloqueioAtivo > this.now().getTime()) {
      const mapaIntencao: Record<string, Intent> = {
        '1': 'agendar',
        '2': 'consultar',
        '3': 'confirmar',
        '4': 'reagendar',
        '5': 'avaliar',
      };
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = mapaIntencao[value];
      return {
        intent: mapaIntencao[value],
        reply: 'Muitas tentativas inválidas de validação. Por segurança, aguarde alguns minutos antes de tentar novamente ou digite *atendente* para falar com a recepção.'
      };
    }

    if (value === '1') {
      sessao.intencaoAtual = 'agendar';
      if (sessao.pacienteUuid) {
        return this.iniciarFluxoAgendamento(sessao);
      }
      sessao.etapa = 'AGUARDANDO_CPF';
      sessao.contexto = manterSeguranca({ intencaoPendente: 'agendar' });
      return {
        intent: 'agendar',
        reply:
          'Você escolheu *1 - Agendar consulta*.\n\nPara sua segurança, informe seu *CPF* (11 dígitos) ou os *4 últimos dígitos do CPF* cadastrado neste WhatsApp (ou digite *0* para voltar ao menu):'
      };
    }

    if (value === '2') {
      sessao.intencaoAtual = 'consultar';
      if (sessao.pacienteUuid) {
        return this.executarConsultaAgendamentos(sessao, dataHoje);
      }
      sessao.etapa = 'AGUARDANDO_CPF';
      sessao.contexto = manterSeguranca({ intencaoPendente: 'consultar' });
      return {
        intent: 'consultar',
        reply:
          'Você escolheu *2 - Consultar agendamento*.\n\nPara sua segurança e proteção dos seus dados, informe seu *CPF* (11 dígitos) ou os *4 últimos dígitos do CPF* vinculado a este WhatsApp (ou digite *0* para voltar ao menu):'
      };
    }

    if (value === '3') {
      sessao.intencaoAtual = 'confirmar';
      if (sessao.pacienteUuid) {
        return this.iniciarFluxoConfirmacaoPresenca(sessao, dataHoje);
      }
      sessao.etapa = 'AGUARDANDO_CPF';
      sessao.contexto = manterSeguranca({ intencaoPendente: 'confirmar' });
      return {
        intent: 'confirmar',
        reply:
          'Você escolheu *3 - Confirmar presença*.\n\nPara sua segurança, informe seu *CPF* (11 dígitos) ou os *4 últimos dígitos do CPF* vinculado a este WhatsApp (ou digite *0* para voltar ao menu):'
      };
    }

    if (value === '4') {
      sessao.intencaoAtual = 'reagendar';
      if (sessao.pacienteUuid) {
        return this.iniciarFluxoReagendamento(sessao, dataHoje);
      }
      sessao.etapa = 'AGUARDANDO_CPF';
      sessao.contexto = manterSeguranca({ intencaoPendente: 'reagendar' });
      return {
        intent: 'reagendar',
        reply:
          'Você escolheu *4 - Reagendar consulta*.\n\nPara sua segurança, informe seu *CPF* (11 dígitos) ou os *4 últimos dígitos do CPF* vinculado a este WhatsApp (ou digite *0* para voltar ao menu):'
      };
    }

    if (value === '5') {
      sessao.intencaoAtual = 'avaliar';
      if (sessao.pacienteUuid) {
        return this.iniciarFluxoAvaliacaoNps(sessao);
      }
      sessao.etapa = 'AGUARDANDO_CPF';
      sessao.contexto = manterSeguranca({ intencaoPendente: 'avaliar' });
      return {
        intent: 'avaliar',
        reply:
          'Você escolheu *5 - Avaliar atendimento (NPS)*.\n\nPara sua segurança, informe seu *CPF* (11 dígitos) ou os *4 últimos dígitos do CPF* vinculado a este WhatsApp (ou digite *0* para voltar ao menu):'
      };
    }

    sessao.etapa = 'MENU_PRINCIPAL';
    sessao.intencaoAtual = 'invalida';
    sessao.contexto = manterSeguranca({});
    return {
      intent: 'invalida',
      reply: `Opção inválida.\n\n${MENU}`
    };
  }

  private async processarEtapaCpf(
    sessao: WhatsAppConversationSession,
    phone: string,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
      escalonadoHumano?: boolean;
    };
  }> {
    const intencaoAlvo: Intent = sessao.contexto.intencaoPendente || 'agendar';
    sessao.intencaoAtual = intencaoAlvo;

    // Bloqueio anti-força-bruta / anti-enumeração verificado ANTES de qualquer consulta ao banco
    const bloqueioAte = Number((sessao.contexto as Record<string, unknown>).bloqueioAuthAte || 0);
    if (bloqueioAte > this.now().getTime()) {
      sessao.etapa = 'MENU_PRINCIPAL';
      return {
        intent: intencaoAlvo,
        reply: 'Muitas tentativas inválidas de validação. Por segurança, aguarde alguns minutos antes de tentar novamente ou digite *atendente* para falar com a recepção.'
      };
    }

    const auth = await this.repository.autenticarPacientePorTelefoneECpf(phone, value);

    if (auth.status === 'AUTENTICADO') {
      sessao.pacienteUuid = auth.paciente.uuid;
      sessao.pacienteNome = auth.paciente.nome_completo;
      sessao.contexto.tentativasAuth = 0;

      if (intencaoAlvo === 'agendar') {
        return this.iniciarFluxoAgendamento(sessao);
      }
      if (intencaoAlvo === 'consultar') {
        return this.executarConsultaAgendamentos(sessao, dataHoje);
      }
      if (intencaoAlvo === 'reagendar') {
        return this.iniciarFluxoReagendamento(sessao, dataHoje);
      }
      if (intencaoAlvo === 'avaliar') {
        return this.iniciarFluxoAvaliacaoNps(sessao);
      }
      return this.iniciarFluxoConfirmacaoPresenca(sessao, dataHoje);
    }

    if (auth.status === 'NOVO_PACIENTE_CPF_VALIDO' && intencaoAlvo === 'agendar') {
      sessao.etapa = 'AGUARDANDO_NOME_CADASTRO';
      sessao.contexto.cpfValidadoParaCadastro = auth.cpfLimpo;
      return {
        intent: 'agendar',
        reply:
          'CPF validado! Como ainda não localizamos seu cadastro neste número, digite seu *Nome Completo* para realizarmos seu pré-cadastro e continuar o agendamento (ou digite *0* para cancelar):'
      };
    }

    if (auth.status === 'CPF_AMBIGUO_EXIGE_COMPLETO') {
      return {
        intent: intencaoAlvo,
        reply:
          'Identificamos mais de um paciente vinculado a este telefone com esses dígitos finais. Por favor, informe o *CPF completo (11 dígitos)* do paciente:'
      };
    }

    // Nas opções de consulta/confirmação/reagendamento/avaliação, NOVO_PACIENTE_CPF_VALIDO
    // recebe exatamente o mesmo tratamento de falha e contagem de lockout que CPF_VINCULADO_OUTRO_TELEFONE
    // para eliminar qualquer oráculo de existência de CPF (LGPD).
    const tentativas = (sessao.contexto.tentativasAuth || 0) + 1;
    sessao.contexto.tentativasAuth = tentativas;

    if (tentativas >= 3) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.contexto = {
        ...(sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {}),
        bloqueioAuthAte: this.now().getTime() + 15 * 60_000,
      } as typeof sessao.contexto;
      return {
        intent: intencaoAlvo,
        reply: `Não foi possível validar o CPF após 3 tentativas. Por segurança, a sessão foi reiniciada e novas tentativas foram temporariamente bloqueadas.\n\n${MENU}`
      };
    }

    // Resposta unificada para não expor se o CPF pertence a outro paciente da clínica (anti-enumeração LGPD)
    return {
      intent: intencaoAlvo,
      reply:
        'Não foi possível validar o CPF para este número de WhatsApp. Informe os *11 dígitos do CPF* válido do titular (ou os *4 últimos dígitos* do CPF já cadastrado neste número), fale com a recepção ou digite *0* para voltar ao menu:'
    };
  }

  private async processarEtapaNomeCadastro(
    sessao: WhatsAppConversationSession,
    phone: string,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const nomeLimpo = value.trim();
    if (nomeLimpo.length < 3 || /^\d+$/.test(nomeLimpo)) {
      return {
        intent: 'agendar',
        reply: 'Por favor, digite seu *Nome Completo* válido (mínimo de 3 caracteres) ou digite *0* para cancelar:'
      };
    }

    try {
      const paciente = await this.repository.cadastrarPacienteRapidoWhatsApp({
        nomeCompleto: nomeLimpo,
        cpf: sessao.contexto.cpfValidadoParaCadastro!,
        whatsapp: phone
      });
      sessao.pacienteUuid = paciente.uuid;
      sessao.pacienteNome = paciente.nome_completo;
      return this.iniciarFluxoAgendamento(
        sessao,
        `Pré-cadastro realizado com sucesso, *${paciente.nome_completo}*!\n\n`
      );
    } catch (error) {
      const msg = error instanceof ErroOperacao ? error.message : 'Não foi possível concluir o pré-cadastro.';
      return {
        intent: 'agendar',
        reply: `${msg} Tente informar o nome novamente ou digite *0* para voltar ao menu:`
      };
    }
  }

  private async iniciarFluxoAgendamento(
    sessao: WhatsAppConversationSession,
    prefixo = ''
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const procedimentos = await this.repository.listarProcedimentosAtivosComProfissionais();
    if (procedimentos.length === 0) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.contexto = {};
      return {
        intent: 'agendar',
        reply:
          'No momento não há procedimentos disponíveis para autoagendamento pelo WhatsApp. Por favor, digite *atendente* para falar com nossa recepção.'
      };
    }

    sessao.etapa = 'AGUARDANDO_PROCEDIMENTO';
    sessao.intencaoAtual = 'agendar';
    sessao.contexto = {
      opcoesProcedimentos: procedimentos
    };

    const saudacaoPaciente =
      !prefixo && sessao.pacienteNome ? `Olá, *${sessao.pacienteNome}*!\n\n` : prefixo;
    const lista = procedimentos
      .map(
        (p, idx) =>
          `*${idx + 1}* - ${p.nome} (${p.duracao_minutos} min - R$ ${formatarMoedaBr(p.preco)})`
      )
      .join('\n');

    return {
      intent: 'agendar',
      reply: `${saudacaoPaciente}Escolha o *procedimento* que deseja agendar:\n\n${lista}\n\nDigite o número da opção desejada (ou *0* para voltar ao menu):`
    };
  }

  private async processarEtapaProcedimento(
    sessao: WhatsAppConversationSession,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const opcoes = sessao.contexto.opcoesProcedimentos || [];
    const indice = /^\d+$/.test(value) ? Number(value) - 1 : -1;
    const escolhido = indice >= 0 && indice < opcoes.length ? opcoes[indice] : null;

    if (!escolhido) {
      const lista = opcoes
        .map((p, idx) => `*${idx + 1}* - ${p.nome} (${p.duracao_minutos} min - R$ ${formatarMoedaBr(p.preco)})`)
        .join('\n');
      return {
        intent: 'agendar',
        reply: `Opção de procedimento inválida. Escolha um número de *1* a *${opcoes.length}* (ou *0* para cancelar):\n\n${lista}`
      };
    }

    const profissionais = await this.repository.listarProfissionaisAtivosPorProcedimento(escolhido.id);
    if (profissionais.length === 0) {
      return {
        intent: 'agendar',
        reply:
          'Não há profissionais habilitados e ativos para este procedimento no momento. Escolha outro procedimento ou digite *0* para voltar ao menu:'
      };
    }

    sessao.etapa = 'AGUARDANDO_PROFISSIONAL';
    sessao.contexto.procedimentoId = escolhido.id;
    sessao.contexto.procedimentoNome = escolhido.nome;
    sessao.contexto.duracaoMinutos = escolhido.duracao_minutos;
    sessao.contexto.preco = escolhido.preco;
    sessao.contexto.opcoesProfissionais = profissionais;

    const listaProfs = profissionais
      .map((pr, idx) => `*${idx + 1}* - ${pr.nome} (${pr.especialidade})`)
      .join('\n');

    return {
      intent: 'agendar',
      reply: `Procedimento selecionado: *${escolhido.nome}* (${escolhido.duracao_minutos} min - R$ ${formatarMoedaBr(escolhido.preco)}).\n\nEscolha o *profissional* habilitado:\n\n${listaProfs}\n\nDigite o número do profissional (ou *0* para cancelar):`
    };
  }

  private async processarEtapaProfissional(
    sessao: WhatsAppConversationSession,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const opcoes = sessao.contexto.opcoesProfissionais || [];
    const indice = /^\d+$/.test(value) ? Number(value) - 1 : -1;
    const escolhido = indice >= 0 && indice < opcoes.length ? opcoes[indice] : null;

    if (!escolhido) {
      const listaProfs = opcoes.map((pr, idx) => `*${idx + 1}* - ${pr.nome} (${pr.especialidade})`).join('\n');
      return {
        intent: 'agendar',
        reply: `Opção de profissional inválida. Escolha um número de *1* a *${opcoes.length}* (ou *0* para cancelar):\n\n${listaProfs}`
      };
    }

    const datas = await this.repository.listarDatasDisponiveis(
      escolhido.id,
      sessao.contexto.procedimentoId!,
      dataHoje,
      14,
      5,
      sessao.pacienteUuid
    );

    if (datas.length === 0) {
      return {
        intent: 'agendar',
        reply: `O profissional *${escolhido.nome}* não possui horários livres nos próximos 14 dias para este procedimento. Escolha outro profissional ou digite *0* para voltar ao menu.`
      };
    }

    sessao.etapa = 'AGUARDANDO_DATA';
    sessao.contexto.profissionalId = escolhido.id;
    sessao.contexto.profissionalNome = escolhido.nome;
    sessao.contexto.opcoesDatas = datas;

    const listaDatas = datas
      .map((d, idx) => `*${idx + 1}* - ${formatarDataBrComDiaSemana(d)}`)
      .join('\n');

    return {
      intent: 'agendar',
      reply: `Profissional selecionado: *${escolhido.nome}*.\n\nEscolha uma das próximas *datas disponíveis* (ou digite uma data no formato DD/MM/AAAA):\n\n${listaDatas}\n\nDigite o número da opção ou a data desejada (ou *0* para cancelar):`
    };
  }

  private async processarEtapaData(
    sessao: WhatsAppConversationSession,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const opcoes = sessao.contexto.opcoesDatas || [];
    let dataEscolhida: string | null = null;

    if (/^\d+$/.test(value)) {
      const idx = Number(value) - 1;
      if (idx >= 0 && idx < opcoes.length) {
        dataEscolhida = opcoes[idx];
      }
    } else {
      dataEscolhida = converterEntradaDataParaIso(value);
    }

    const listaDatas = opcoes
      .map((d, idx) => `*${idx + 1}* - ${formatarDataBrComDiaSemana(d)}`)
      .join('\n');

    if (!dataEscolhida) {
      return {
        intent: 'agendar',
        reply: `Data ou opção inválida. Escolha um número de *1* a *${opcoes.length}* ou informe uma data válida no formato DD/MM/AAAA (ou *0* para cancelar):\n\n${listaDatas}`
      };
    }

    if (dataEscolhida < dataHoje) {
      return {
        intent: 'agendar',
        reply: `Não é possível agendar em uma data passada (${formatarDataBr(dataEscolhida)}). Escolha uma das datas disponíveis:\n\n${listaDatas}`
      };
    }

    try {
      const { horarios, duracaoMinutos, preco } = await this.repository.listarHorariosDisponiveis(
        sessao.contexto.profissionalId!,
        sessao.contexto.procedimentoId!,
        dataEscolhida,
        sessao.pacienteUuid
      );

      if (horarios.length === 0) {
        return {
          intent: 'agendar',
          reply: `Não há horários disponíveis na data *${formatarDataBrComDiaSemana(dataEscolhida)}* (dia sem expediente, feriado/exceção ou agenda completa). Escolha outra data:\n\n${listaDatas}`
        };
      }

      sessao.etapa = 'AGUARDANDO_HORARIO';
      sessao.contexto.dataSelecionada = dataEscolhida;
      sessao.contexto.duracaoMinutos = duracaoMinutos;
      sessao.contexto.preco = preco;
      sessao.contexto.opcoesHorarios = horarios;

      const listaHorarios = horarios.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
      return {
        intent: 'agendar',
        reply: `Data selecionada: *${formatarDataBrComDiaSemana(dataEscolhida)}*.\n\nEscolha um dos *horários disponíveis*:\n\n${listaHorarios}\n\nDigite o número da opção ou o horário no formato HH:MM (ou *0* para cancelar):`
      };
    } catch {
      return {
        intent: 'agendar',
        reply: `Data inválida. Escolha uma opção de *1* a *${opcoes.length}* ou digite DD/MM/AAAA:\n\n${listaDatas}`
      };
    }
  }

  private async processarEtapaHorario(
    sessao: WhatsAppConversationSession,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const opcoes = sessao.contexto.opcoesHorarios || [];
    let horarioEscolhido: string | null = null;

    if (/^\d+$/.test(value)) {
      const idx = Number(value) - 1;
      if (idx >= 0 && idx < opcoes.length) {
        horarioEscolhido = opcoes[idx];
      }
    } else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) && opcoes.includes(value)) {
      horarioEscolhido = value;
    }

    if (!horarioEscolhido) {
      const listaHorarios = opcoes.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
      return {
        intent: 'agendar',
        reply: `Horário inválido ou indisponível. Escolha uma opção de *1* a *${opcoes.length}* (ou digite *0* para cancelar):\n\n${listaHorarios}`
      };
    }

    const duracao = sessao.contexto.duracaoMinutos || 60;
    const preco = sessao.contexto.preco || 0;
    const horarioFim = calcularHorarioTermino(horarioEscolhido, duracao, 15).slice(0, 5);

    sessao.etapa = 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO';
    sessao.contexto.horarioSelecionado = horarioEscolhido;
    sessao.contexto.horarioFimCalculado = horarioFim;

    return {
      intent: 'agendar',
      reply:
        `Confira o resumo do seu agendamento:\n\n` +
        `• Paciente: *${sessao.pacienteNome || 'Paciente'}*\n` +
        `• Procedimento: *${sessao.contexto.procedimentoNome}* (${duracao} min)\n` +
        `• Profissional: *${sessao.contexto.profissionalNome}*\n` +
        `• Data: *${formatarDataBrComDiaSemana(sessao.contexto.dataSelecionada!)}*\n` +
        `• Horário: *${horarioEscolhido}*\n` +
        `• Valor: *R$ ${formatarMoedaBr(preco)}*\n\n` +
        `1 - Confirmar agendamento\n` +
        `2 - Escolher outro horário\n` +
        `0 - Cancelar e voltar ao menu`
    };
  }

  private async processarEtapaConfirmacaoAgendamento(
    sessao: WhatsAppConversationSession,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
      escalonadoHumano?: boolean;
    };
  }> {
    if (value === '2') {
      const { horarios } = await this.repository.listarHorariosDisponiveis(
        sessao.contexto.profissionalId!,
        sessao.contexto.procedimentoId!,
        sessao.contexto.dataSelecionada!,
        sessao.pacienteUuid
      );
      if (horarios.length === 0) {
        return this.processarEtapaProfissional(sessao, '1', dataHoje);
      }
      sessao.etapa = 'AGUARDANDO_HORARIO';
      sessao.contexto.opcoesHorarios = horarios;
      const listaHorarios = horarios.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
      return {
        intent: 'agendar',
        reply: `Escolha um novo *horário disponível* para *${formatarDataBrComDiaSemana(sessao.contexto.dataSelecionada!)}*:\n\n${listaHorarios}\n\nDigite o número da opção (ou *0* para cancelar):`
      };
    }

    if (value !== '1' && !/^(sim|confirmar|confirmo)$/i.test(value)) {
      return {
        intent: 'agendar',
        reply:
          'Opção inválida. Digite *1* para confirmar o agendamento, *2* para escolher outro horário ou *0* para cancelar e voltar ao menu:'
      };
    }

    try {
      const criado = await this.repository.criarAgendamentoWhatsApp({
        pacienteUuid: sessao.pacienteUuid!,
        profissionalId: sessao.contexto.profissionalId!,
        procedimentoId: sessao.contexto.procedimentoId!,
        data: sessao.contexto.dataSelecionada!,
        horarioInicio: sessao.contexto.horarioSelecionado!,
        idSessaoChatbot: sessao.idSessaoChatbot
      });

      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'agendar';
      sessao.contexto = {};

      return {
        intent: 'agendar',
        agendamentoId: criado.id,
        opcoesSessao: { statusSessaoChatbot: 'Agendamento_Concluido' },
        reply:
          `Agendamento realizado com sucesso! ✅\n\n` +
          `• Protocolo: *#${criado.id}*\n` +
          `• Paciente: *${criado.paciente_nome}*\n` +
          `• Procedimento: *${criado.servico_nome}*\n` +
          `• Profissional: *${criado.profissional_nome}*\n` +
          `• Data: *${formatarDataBrComDiaSemana(criado.data)}*\n` +
          `• Horário: *${criado.horario_inicio}*\n` +
          `• Status: *${criado.status}*\n\n` +
          `Envie *menu* a qualquer momento para consultar seus agendamentos ou confirmar presença.`
      };
    } catch (error) {
      if (error instanceof ErroOperacao && error.status === 409) {
        const { horarios } = await this.repository.listarHorariosDisponiveis(
          sessao.contexto.profissionalId!,
          sessao.contexto.procedimentoId!,
          sessao.contexto.dataSelecionada!,
          sessao.pacienteUuid
        );
        if (horarios.length > 0) {
          sessao.etapa = 'AGUARDANDO_HORARIO';
          sessao.contexto.opcoesHorarios = horarios;
          const listaHorarios = horarios.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
          return {
            intent: 'agendar',
            reply: `Não foi possível reservar este horário (${error.message}). Escolha outro horário disponível:\n\n${listaHorarios}`
          };
        }
      }
      throw error;
    }
  }

  private async executarConsultaAgendamentos(
    sessao: WhatsAppConversationSession,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const agendamentos = await this.repository.listarAgendamentosFuturosPaciente(
      sessao.pacienteUuid!,
      dataHoje
    );

    sessao.etapa = 'MENU_PRINCIPAL';
    sessao.intencaoAtual = 'consultar';
    sessao.contexto = {};

    if (agendamentos.length === 0) {
      return {
        intent: 'consultar',
        opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
        reply:
          `Olá, *${sessao.pacienteNome || 'Paciente'}*! Você não possui agendamentos futuros ativos no momento.\n\n` +
          `Digite *1* para agendar uma consulta ou *menu* para ver todas as opções.`
      };
    }

    const itens = agendamentos
      .map(
        a =>
          `• Protocolo *#${a.id}* — *${formatarDataBrComDiaSemana(a.data)}* às *${a.horario_inicio}*\n` +
          `  Procedimento: ${a.servico_nome}\n` +
          `  Profissional: ${a.profissional_nome}\n` +
          `  Status: *${a.status}*`
      )
      .join('\n\n');

    return {
      intent: 'consultar',
      opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
      reply:
        `Olá, *${sessao.pacienteNome || 'Paciente'}*! Encontramos ${agendamentos.length} agendamento(s) ativo(s):\n\n` +
        `${itens}\n\n` +
        `Digite *3* caso deseje confirmar presença ou *menu* para outras opções.`
    };
  }

  private async iniciarFluxoConfirmacaoPresenca(
    sessao: WhatsAppConversationSession,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const agendamentos = await this.repository.listarAgendamentosFuturosPaciente(
      sessao.pacienteUuid!,
      dataHoje
    );

    if (agendamentos.length === 0) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'confirmar';
      sessao.contexto = {};
      return {
        intent: 'confirmar',
        opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
        reply:
          `Olá, *${sessao.pacienteNome || 'Paciente'}*! Não encontramos agendamentos futuros para confirmar presença.\n\n` +
          `Digite *1* para agendar uma consulta ou *menu* para voltar ao início.`
      };
    }

    const pendentes = agendamentos.filter(a => ['Agendado', 'Reagendado'].includes(a.status));

    if (pendentes.length === 0) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'confirmar';
      sessao.contexto = {};
      const confirmados = agendamentos
        .map(a => `• *#${a.id}* — ${formatarDataBrComDiaSemana(a.data)} às ${a.horario_inicio} (${a.servico_nome}) — Status: *${a.status}*`)
        .join('\n');
      return {
        intent: 'confirmar',
        opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
        reply:
          `Olá, *${sessao.pacienteNome || 'Paciente'}*! Sua presença já consta como *Confirmada* para seus próximos atendimentos:\n\n` +
          `${confirmados}\n\n` +
          `Envie *menu* caso precise de outra opção.`
      };
    }

    sessao.etapa = 'AGUARDANDO_SELECAO_CONFIRMACAO';
    sessao.intencaoAtual = 'confirmar';
    sessao.contexto = {
      opcoesConfirmacao: pendentes
    };

    const listaPendentes = pendentes
      .map(
        (a, idx) =>
          `*${idx + 1}* - Confirmar presença no protocolo *#${a.id}*: ${formatarDataBrComDiaSemana(a.data)} às *${a.horario_inicio}* — ${a.servico_nome} (${a.profissional_nome}) [Status atual: ${a.status}]`
      )
      .join('\n\n');

    return {
      intent: 'confirmar',
      reply:
        `Olá, *${sessao.pacienteNome || 'Paciente'}*! Selecione o atendimento para confirmar sua presença:\n\n` +
        `${listaPendentes}\n\n` +
        `Digite o número da opção para confirmar presença (ou *0* para voltar ao menu sem alterar):`
    };
  }

  private async processarEtapaSelecaoConfirmacaoPresenca(
    sessao: WhatsAppConversationSession,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const opcoes = sessao.contexto.opcoesConfirmacao || [];
    let escolhido: WhatsAppAgendamentoResumo | null = null;

    if (/^\d+$/.test(value)) {
      const idx = Number(value) - 1;
      if (idx >= 0 && idx < opcoes.length) {
        escolhido = opcoes[idx];
      }
    } else if (/^#\d+$/.test(value)) {
      const id = Number(value.slice(1));
      escolhido = opcoes.find(a => a.id === id) ?? null;
    } else if (opcoes.length === 1 && /^(sim|confirmar|confirmo)$/i.test(value)) {
      escolhido = opcoes[0];
    }

    if (!escolhido) {
      const listaPendentes = opcoes
        .map(
          (a, idx) =>
            `*${idx + 1}* - Protocolo *#${a.id}*: ${formatarDataBrComDiaSemana(a.data)} às *${a.horario_inicio}* — ${a.servico_nome} (${a.profissional_nome})`
        )
        .join('\n');
      return {
        intent: 'confirmar',
        reply: `Opção inválida. Digite um número de *1* a *${opcoes.length}* para confirmar presença (ou *0* para voltar ao menu):\n\n${listaPendentes}`
      };
    }

    const resultado = await this.repository.confirmarPresencaWhatsApp({
      agendamentoId: escolhido.id,
      pacienteUuid: sessao.pacienteUuid!,
      idSessaoChatbot: sessao.idSessaoChatbot
    });

    sessao.etapa = 'MENU_PRINCIPAL';
    sessao.intencaoAtual = 'confirmar';
    sessao.contexto = {};

    const ag = resultado.agendamento;
    return {
      intent: 'confirmar',
      agendamentoId: ag.id,
      opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
      reply:
        `Presença confirmada com sucesso! ✅\n\n` +
        `• Protocolo: *#${ag.id}*\n` +
        `• Paciente: *${ag.paciente_nome}*\n` +
        `• Procedimento: *${ag.servico_nome}*\n` +
        `• Profissional: *${ag.profissional_nome}*\n` +
        `• Data: *${formatarDataBrComDiaSemana(ag.data)}* às *${ag.horario_inicio}*\n` +
        `• Status: *${resultado.statusNovo}*\n\n` +
        `A Clínica IKIGAI aguarda você! Envie *menu* caso precise de mais alguma informação.`
    };
  }

  private async processarRespostaConfirmacaoAtiva(
    sessao: WhatsAppConversationSession,
    phone: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const pendentes = await this.repository.buscarAgendamentosPendentesConfirmacaoAtiva(phone, dataHoje);

    if (pendentes.length === 1) {
      const alvo = pendentes[0];
      const resultado = await this.repository.confirmarPresencaWhatsApp({
        agendamentoId: alvo.id,
        pacienteUuid: alvo.paciente_id,
        idSessaoChatbot: sessao.idSessaoChatbot,
        origemConfirmacao: 'lembrete_ativo'
      });

      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'confirmar';
      sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};

      const ag = resultado.agendamento;
      return {
        intent: 'confirmar',
        agendamentoId: ag.id,
        opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
        reply:
          `Obrigado! Sua presença foi confirmada com sucesso! ✅\n\n` +
          `• Protocolo: *#${ag.id}*\n` +
          `• Paciente: *${ag.paciente_nome}*\n` +
          `• Procedimento: *${ag.servico_nome}*\n` +
          `• Profissional: *${ag.profissional_nome}*\n` +
          `• Data: *${formatarDataBrComDiaSemana(ag.data)}* às *${ag.horario_inicio}*\n` +
          `• Status: *${resultado.statusNovo}*\n\n` +
          `Caso precise reagendar ou consultar outras opções, envie *menu* a qualquer momento.`
      };
    }

    if (pendentes.length > 1) {
      return this.processarOpcaoMenuPrincipal(sessao, '3', dataHoje);
    }

    sessao.etapa = 'MENU_PRINCIPAL';
    sessao.intencaoAtual = 'menu';
    return {
      intent: 'menu',
      reply: `Não localizamos um lembrete pendente de confirmação para este número.\n\nSe desejar confirmar uma consulta manualmente, digite *3*.\n\n${MENU}`
    };
  }

  private async iniciarFluxoReagendamento(
    sessao: WhatsAppConversationSession,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const agendamentos = await this.repository.listarAgendamentosFuturosPaciente(
      sessao.pacienteUuid!,
      dataHoje
    );
    const reagendaveis = agendamentos.filter(
      a => !['Cancelado', 'No_Show', 'Concluído', 'Realizado', 'Em Atendimento'].includes(a.status)
    );

    if (reagendaveis.length === 0) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'reagendar';
      sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};
      return {
        intent: 'reagendar',
        opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
        reply:
          `Olá, *${sessao.pacienteNome || 'Paciente'}*! Não encontramos agendamentos futuros disponíveis para reagendamento.\n\n` +
          `Digite *1* para agendar uma nova consulta ou *menu* para ver todas as opções.`
      };
    }

    sessao.etapa = 'AGUARDANDO_SELECAO_REAGENDAMENTO';
    sessao.intencaoAtual = 'reagendar';
    sessao.contexto = {
      contatoFinal: sessao.contexto.contatoFinal,
      opcoesReagendamento: reagendaveis
    };

    const lista = reagendaveis
      .map(
        (a, idx) =>
          `*${idx + 1}* - Protocolo *#${a.id}*: ${formatarDataBrComDiaSemana(a.data)} às *${a.horario_inicio}* — ${a.servico_nome} (${a.profissional_nome}) [Status: ${a.status}]`
      )
      .join('\n\n');

    return {
      intent: 'reagendar',
      reply:
        `Olá, *${sessao.pacienteNome || 'Paciente'}*! Escolha qual atendimento deseja *reagendar*:\n\n` +
        `${lista}\n\n` +
        `Digite o número da opção desejada (ou *0* para voltar ao menu sem alterar):`
    };
  }

  private async processarEtapaSelecaoReagendamento(
    sessao: WhatsAppConversationSession,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const opcoes = sessao.contexto.opcoesReagendamento || [];
    let escolhido: WhatsAppAgendamentoResumo | null = null;

    if (/^\d+$/.test(value)) {
      const idx = Number(value) - 1;
      if (idx >= 0 && idx < opcoes.length) escolhido = opcoes[idx];
    } else if (/^#\d+$/.test(value)) {
      const id = Number(value.slice(1));
      escolhido = opcoes.find(a => a.id === id) ?? null;
    }

    if (!escolhido) {
      const lista = opcoes
        .map(
          (a, idx) =>
            `*${idx + 1}* - Protocolo *#${a.id}*: ${formatarDataBrComDiaSemana(a.data)} às *${a.horario_inicio}* — ${a.servico_nome}`
        )
        .join('\n');
      return {
        intent: 'reagendar',
        reply: `Opção inválida. Digite um número de *1* a *${opcoes.length}* para escolher o atendimento a reagendar (ou *0* para cancelar):\n\n${lista}`
      };
    }

    const datas = await this.repository.listarDatasDisponiveis(
      escolhido.profissional_id,
      escolhido.servico_id,
      dataHoje,
      14,
      5,
      sessao.pacienteUuid,
      escolhido.id
    );

    if (datas.length === 0) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};
      return {
        intent: 'reagendar',
        reply:
          `Não encontramos datas disponíveis para *${escolhido.profissional_nome}* nos próximos 14 dias. Digite *atendente* para reagendar diretamente com nossa recepção ou *menu* para voltar.`
      };
    }

    sessao.etapa = 'AGUARDANDO_DATA_REAGENDAMENTO';
    sessao.contexto.agendamentoReagendamento = escolhido;
    sessao.contexto.opcoesDatas = datas;

    const listaDatas = datas
      .map((d, idx) => `*${idx + 1}* - ${formatarDataBrComDiaSemana(d)}`)
      .join('\n');

    return {
      intent: 'reagendar',
      reply:
        `Reagendando protocolo *#${escolhido.id}* (${escolhido.servico_nome} com *${escolhido.profissional_nome}*).\n` +
        `Horário atual: ${formatarDataBrComDiaSemana(escolhido.data)} às *${escolhido.horario_inicio}*.\n\n` +
        `Escolha a *nova data* disponível (ou digite no formato DD/MM/AAAA):\n\n${listaDatas}\n\n` +
        `Digite o número da opção ou a data desejada (ou *0* para cancelar):`
    };
  }

  private async processarEtapaDataReagendamento(
    sessao: WhatsAppConversationSession,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const ag = sessao.contexto.agendamentoReagendamento;
    const opcoes = sessao.contexto.opcoesDatas || [];
    if (!ag) {
      sessao.etapa = 'MENU_PRINCIPAL';
      return { intent: 'menu', reply: MENU };
    }

    let dataEscolhida: string | null = null;
    if (/^\d+$/.test(value)) {
      const idx = Number(value) - 1;
      if (idx >= 0 && idx < opcoes.length) dataEscolhida = opcoes[idx];
    } else {
      dataEscolhida = converterEntradaDataParaIso(value);
    }

    const listaDatas = opcoes
      .map((d, idx) => `*${idx + 1}* - ${formatarDataBrComDiaSemana(d)}`)
      .join('\n');

    if (!dataEscolhida) {
      return {
        intent: 'reagendar',
        reply: `Data ou opção inválida. Escolha de *1* a *${opcoes.length}* ou informe DD/MM/AAAA (ou *0* para cancelar):\n\n${listaDatas}`
      };
    }

    if (dataEscolhida < dataHoje) {
      return {
        intent: 'reagendar',
        reply: `Não é possível reagendar para uma data passada (${formatarDataBr(dataEscolhida)}). Escolha outra data:\n\n${listaDatas}`
      };
    }

    try {
      const { horarios } = await this.repository.listarHorariosDisponiveis(
        ag.profissional_id,
        ag.servico_id,
        dataEscolhida,
        sessao.pacienteUuid,
        ag.id
      );

      if (horarios.length === 0) {
        return {
          intent: 'reagendar',
          reply: `Não há horários livres em *${formatarDataBrComDiaSemana(dataEscolhida)}*. Escolha outra data:\n\n${listaDatas}`
        };
      }

      sessao.etapa = 'AGUARDANDO_HORARIO_REAGENDAMENTO';
      sessao.contexto.dataSelecionada = dataEscolhida;
      sessao.contexto.opcoesHorarios = horarios;

      const listaHorarios = horarios.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
      return {
        intent: 'reagendar',
        reply: `Nova data selecionada: *${formatarDataBrComDiaSemana(dataEscolhida)}*.\n\nEscolha o *novo horário*:\n\n${listaHorarios}\n\nDigite o número da opção ou HH:MM (ou *0* para cancelar):`
      };
    } catch {
      return {
        intent: 'reagendar',
        reply: `Data inválida. Escolha de *1* a *${opcoes.length}* ou informe DD/MM/AAAA:\n\n${listaDatas}`
      };
    }
  }

  private async processarEtapaHorarioReagendamento(
    sessao: WhatsAppConversationSession,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const ag = sessao.contexto.agendamentoReagendamento;
    const opcoes = sessao.contexto.opcoesHorarios || [];
    if (!ag || !sessao.contexto.dataSelecionada) {
      sessao.etapa = 'MENU_PRINCIPAL';
      return { intent: 'menu', reply: MENU };
    }

    let horarioEscolhido: string | null = null;
    if (/^\d+$/.test(value)) {
      const idx = Number(value) - 1;
      if (idx >= 0 && idx < opcoes.length) horarioEscolhido = opcoes[idx];
    } else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) && opcoes.includes(value)) {
      horarioEscolhido = value;
    }

    if (!horarioEscolhido) {
      const listaHorarios = opcoes.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
      return {
        intent: 'reagendar',
        reply: `Horário inválido ou indisponível. Escolha de *1* a *${opcoes.length}* (ou *0* para cancelar):\n\n${listaHorarios}`
      };
    }

    sessao.etapa = 'AGUARDANDO_CONFIRMACAO_REAGENDAMENTO';
    sessao.contexto.horarioSelecionado = horarioEscolhido;

    return {
      intent: 'reagendar',
      reply:
        `Confira o resumo do *reagendamento*:\n\n` +
        `• Protocolo: *#${ag.id}*\n` +
        `• Procedimento: *${ag.servico_nome}*\n` +
        `• Profissional: *${ag.profissional_nome}*\n` +
        `• De: ${formatarDataBrComDiaSemana(ag.data)} às ${ag.horario_inicio}\n` +
        `• Para: *${formatarDataBrComDiaSemana(sessao.contexto.dataSelecionada)}* às *${horarioEscolhido}*\n\n` +
        `1 - Confirmar reagendamento\n` +
        `2 - Escolher outro horário\n` +
        `0 - Cancelar e voltar ao menu`
    };
  }

  private async processarEtapaConfirmacaoReagendamento(
    sessao: WhatsAppConversationSession,
    value: string,
    dataHoje: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const ag = sessao.contexto.agendamentoReagendamento;
    const dataSelecionada = sessao.contexto.dataSelecionada;
    const horarioSelecionado = sessao.contexto.horarioSelecionado;
    if (!ag || !dataSelecionada || !horarioSelecionado) {
      sessao.etapa = 'MENU_PRINCIPAL';
      return { intent: 'menu', reply: MENU };
    }

    if (value === '2') {
      const { horarios } = await this.repository.listarHorariosDisponiveis(
        ag.profissional_id,
        ag.servico_id,
        dataSelecionada,
        sessao.pacienteUuid,
        ag.id
      );
      if (horarios.length === 0) {
        return this.iniciarFluxoReagendamento(sessao, dataHoje);
      }
      sessao.etapa = 'AGUARDANDO_HORARIO_REAGENDAMENTO';
      sessao.contexto.opcoesHorarios = horarios;
      const listaHorarios = horarios.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
      return {
        intent: 'reagendar',
        reply: `Escolha outro *horário disponível* para *${formatarDataBrComDiaSemana(dataSelecionada)}*:\n\n${listaHorarios}\n\nDigite o número da opção (ou *0* para cancelar):`
      };
    }

    if (value !== '1' && !/^(sim|confirmar|confirmo)$/i.test(value)) {
      return {
        intent: 'reagendar',
        reply: 'Opção inválida. Digite *1* para confirmar o reagendamento, *2* para escolher outro horário ou *0* para cancelar:'
      };
    }

    try {
      const resultado = await this.repository.reagendarAgendamentoWhatsApp({
        agendamentoId: ag.id,
        pacienteUuid: sessao.pacienteUuid!,
        novaData: dataSelecionada,
        novoHorarioInicio: horarioSelecionado
      });

      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'reagendar';
      sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};

      const novo = resultado.agendamento;
      return {
        intent: 'reagendar',
        agendamentoId: novo.id,
        opcoesSessao: { statusSessaoChatbot: 'Agendamento_Concluido' },
        reply:
          `Consulta reagendada com sucesso! ✅\n\n` +
          `• Protocolo: *#${novo.id}*\n` +
          `• Procedimento: *${novo.servico_nome}*\n` +
          `• Profissional: *${novo.profissional_nome}*\n` +
          `• Nova data: *${formatarDataBrComDiaSemana(novo.data)}* às *${novo.horario_inicio}*\n` +
          `• Status: *${novo.status}*\n\n` +
          `Envie *menu* caso precise de mais alguma informação.`
      };
    } catch (error) {
      if (error instanceof ErroOperacao && error.status === 409) {
        const { horarios } = await this.repository.listarHorariosDisponiveis(
          ag.profissional_id,
          ag.servico_id,
          dataSelecionada,
          sessao.pacienteUuid,
          ag.id
        );
        if (horarios.length > 0) {
          sessao.etapa = 'AGUARDANDO_HORARIO_REAGENDAMENTO';
          sessao.contexto.opcoesHorarios = horarios;
          const listaHorarios = horarios.map((h, idx) => `*${idx + 1}* - ${h}`).join('\n');
          return {
            intent: 'reagendar',
            reply: `Não foi possível concluir o reagendamento neste horário (${error.message}). Escolha outro horário disponível:\n\n${listaHorarios}`
          };
        }
        sessao.etapa = 'MENU_PRINCIPAL';
        sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};
        return {
          intent: 'reagendar',
          reply: `Não foi possível reagendar: ${error.message}\n\nEnvie *menu* para tentar novamente ou *atendente* para falar com nossa recepção.`
        };
      }
      throw error;
    }
  }

  private async iniciarFluxoAvaliacaoNps(
    sessao: WhatsAppConversationSession
  ): Promise<{
    intent: Intent;
    reply: string;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const elegiveis = await this.repository.listarAgendamentosElegiveisAvaliacao(sessao.pacienteUuid!);

    if (elegiveis.length === 0) {
      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'avaliar';
      sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};
      return {
        intent: 'avaliar',
        opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
        reply:
          `Olá, *${sessao.pacienteNome || 'Paciente'}*! Não encontramos atendimentos concluídos pendentes de avaliação no momento.\n\n` +
          `Envie *menu* para acessar outras opções.`
      };
    }

    if (elegiveis.length === 1) {
      const unico = elegiveis[0];
      sessao.etapa = 'AGUARDANDO_NOTA_NPS';
      sessao.intencaoAtual = 'avaliar';
      sessao.contexto = {
        contatoFinal: sessao.contexto.contatoFinal,
        agendamentoAvaliacao: unico
      };
      return {
        intent: 'avaliar',
        reply:
          `Olá, *${sessao.pacienteNome || 'Paciente'}*! Gostaríamos muito de ouvir sua opinião sobre seu atendimento:\n\n` +
          `• Protocolo: *#${unico.id}*\n` +
          `• Procedimento: *${unico.servico_nome}*\n` +
          `• Profissional: *${unico.profissional_nome}*\n` +
          `• Data: ${formatarDataBr(unico.data)} às ${unico.horario_inicio}\n\n` +
          `Em uma escala de *0 a 10*, o quanto você recomendaria a *Clínica IKIGAI* para amigos ou familiares?\n` +
          `(Digite um número de *0* a *10*, ou *cancelar* para voltar ao menu)`
      };
    }

    sessao.etapa = 'AGUARDANDO_SELECAO_AVALIACAO';
    sessao.intencaoAtual = 'avaliar';
    sessao.contexto = {
      contatoFinal: sessao.contexto.contatoFinal,
      opcoesAvaliacao: elegiveis
    };

    const lista = elegiveis
      .map(
        (a, idx) =>
          `*${idx + 1}* - Protocolo *#${a.id}*: ${formatarDataBr(a.data)} às ${a.horario_inicio} — ${a.servico_nome} (${a.profissional_nome})`
      )
      .join('\n');

    return {
      intent: 'avaliar',
      reply:
        `Olá, *${sessao.pacienteNome || 'Paciente'}*! Selecione qual atendimento concluído deseja avaliar:\n\n` +
        `${lista}\n\n` +
        `Digite o número da opção (ou *0* para voltar ao menu):`
    };
  }

  private async processarEtapaSelecaoAvaliacao(
    sessao: WhatsAppConversationSession,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    const opcoes = sessao.contexto.opcoesAvaliacao || [];
    let escolhido: WhatsAppAgendamentoResumo | null = null;

    if (/^\d+$/.test(value)) {
      const idx = Number(value) - 1;
      if (idx >= 0 && idx < opcoes.length) escolhido = opcoes[idx];
    } else if (/^#\d+$/.test(value)) {
      const id = Number(value.slice(1));
      escolhido = opcoes.find(a => a.id === id) ?? null;
    }

    if (!escolhido) {
      const lista = opcoes
        .map((a, idx) => `*${idx + 1}* - Protocolo *#${a.id}*: ${formatarDataBr(a.data)} — ${a.servico_nome}`)
        .join('\n');
      return {
        intent: 'avaliar',
        reply: `Opção inválida. Digite de *1* a *${opcoes.length}* para escolher o atendimento (ou *0* para cancelar):\n\n${lista}`
      };
    }

    sessao.etapa = 'AGUARDANDO_NOTA_NPS';
    sessao.contexto.agendamentoAvaliacao = escolhido;
    return {
      intent: 'avaliar',
      reply:
        `Avaliando atendimento *#${escolhido.id}* (${escolhido.servico_nome} com *${escolhido.profissional_nome}*).\n\n` +
        `Em uma escala de *0 a 10*, o quanto você recomendaria a *Clínica IKIGAI*?\n` +
        `(Digite um número de *0* a *10*, ou *cancelar* para sair)`
    };
  }

  private async processarEtapaNotaNps(
    sessao: WhatsAppConversationSession,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
  }> {
    if (!/^(10|[0-9])$/.test(value)) {
      return {
        intent: 'avaliar',
        reply: 'Nota inválida. Por favor, informe um número inteiro de *0* a *10* (ou digite *cancelar* para voltar ao menu):'
      };
    }

    const nota = Number(value);
    sessao.etapa = 'AGUARDANDO_COMENTARIO_NPS';
    sessao.contexto.notaNpsSelecionada = nota;

    return {
      intent: 'avaliar',
      reply:
        `Nota *${nota}/10* registrada!\n\n` +
        `Deseja deixar algum comentário ou sugestão sobre seu atendimento?\n` +
        `Digite sua mensagem agora ou envie *PULAR* para concluir sem comentário:`
    };
  }

  private async processarEtapaComentarioNps(
    sessao: WhatsAppConversationSession,
    value: string
  ): Promise<{
    intent: Intent;
    reply: string;
    agendamentoId?: number;
    opcoesSessao?: {
      statusSessaoChatbot?: 'Em_Andamento' | 'Agendamento_Concluido' | 'Duvida_Resolvida' | 'Abandonada' | 'Erro_Sistema';
    };
  }> {
    const ag = sessao.contexto.agendamentoAvaliacao;
    const nota = sessao.contexto.notaNpsSelecionada;
    if (!ag || nota === undefined) {
      sessao.etapa = 'MENU_PRINCIPAL';
      return { intent: 'menu', reply: MENU };
    }

    const pular = /^(pular|n[aã]o|sem coment[aá]rio|-|nenhum)$/i.test(value);
    const comentario = pular ? null : value.trim().slice(0, 500);

    try {
      const resultado = await this.repository.registrarAvaliacaoNpsWhatsApp({
        agendamentoId: ag.id,
        pacienteUuid: sessao.pacienteUuid!,
        notaNps: nota,
        comentario
      });

      sessao.etapa = 'MENU_PRINCIPAL';
      sessao.intencaoAtual = 'avaliar';
      sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};

      const mensagemExtra =
        nota >= 9
          ? 'Ficamos muito felizes com sua avaliação! 💚'
          : nota >= 7
            ? 'Obrigado pelo seu retorno! Vamos continuar evoluindo para oferecer uma experiência nota 10.'
            : 'Sentimos muito que sua experiência não tenha sido ideal. Sua avaliação é fundamental para melhorarmos continuamente.';

      return {
        intent: 'avaliar',
        agendamentoId: resultado.agendamento.id,
        opcoesSessao: { statusSessaoChatbot: 'Duvida_Resolvida' },
        reply:
          `Avaliação registrada com sucesso! ⭐\n\n` +
          `• Protocolo: *#${resultado.agendamento.id}*\n` +
          `• Nota NPS: *${resultado.avaliacao.nota_nps}/10*\n` +
          `${resultado.avaliacao.comentario ? `• Comentário: "${resultado.avaliacao.comentario}"\n` : ''}\n` +
          `${mensagemExtra}\n\n` +
          `Envie *menu* sempre que precisar da Clínica IKIGAI.`
      };
    } catch (error) {
      if (error instanceof ErroOperacao && error.status === 409) {
        sessao.etapa = 'MENU_PRINCIPAL';
        sessao.contexto = sessao.contexto.contatoFinal ? { contatoFinal: sessao.contexto.contatoFinal } : {};
        return {
          intent: 'avaliar',
          reply: `${error.message}\n\nEnvie *menu* para voltar às opções.`
        };
      }
      throw error;
    }
  }
}
