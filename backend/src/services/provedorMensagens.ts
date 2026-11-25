import { obterConectorWhatsApp } from './whatsappRuntime.js';

export type PedidoMensagem = {
  id: number;
  whatsapp: string;
  tipo: 'CONFIRMACAO' | 'LEMBRETE';
  ocorrencia: string;
  agendamentoId?: number;
  pacienteNome?: string;
  profissionalNome?: string;
  procedimentoNome?: string;
};

export type ResultadoEnvio = {
  estado: 'SUBMETIDA' | 'ENTREGUE' | 'FALHA' | 'INCERTA';
  referencia?: string;
  erro?: string;
};

export interface ProvedorMensagens {
  nome: string;
  pronto?: () => boolean;
  enviar(pedido: PedidoMensagem): Promise<ResultadoEnvio>;
}

function normalizarWhatsAppBr(valor: string): string {
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }
  return digitos;
}

function formatarOcorrenciaBr(ocorrencia: string): { dataBr: string; horaBr: string } {
  const [data = '', hora = ''] = ocorrencia.split(' ');
  const [ano, mes, dia] = data.split('-');
  const dataBr = ano && mes && dia ? `${dia}/${mes}/${ano}` : data;
  const horaBr = hora.slice(0, 5);
  return { dataBr, horaBr };
}

export function formatarMensagemComunicacao(pedido: PedidoMensagem): string {
  const { dataBr, horaBr } = formatarOcorrenciaBr(pedido.ocorrencia);
  const saudacao = pedido.pacienteNome ? `Olá, *${pedido.pacienteNome}*!` : 'Olá!';
  const detalhes: string[] = [];
  if (pedido.procedimentoNome) detalhes.push(`• Procedimento: *${pedido.procedimentoNome}*`);
  if (pedido.profissionalNome) detalhes.push(`• Profissional: *${pedido.profissionalNome}*`);
  detalhes.push(`• Data: *${dataBr}* às *${horaBr}*`);
  if (pedido.agendamentoId) detalhes.push(`• Protocolo: *#${pedido.agendamentoId}*`);

  if (pedido.tipo === 'LEMBRETE') {
    return (
      `${saudacao}\n\n` +
      `Lembrete da *Clínica IKIGAI* sobre sua consulta agendada:\n` +
      `${detalhes.join('\n')}\n\n` +
      `Responda *SIM* para confirmar sua presença, *REAGENDAR* para escolher outra data/horário ou *ATENDENTE* para falar com nossa recepção.`
    );
  }

  return (
    `${saudacao}\n\n` +
    `A *Clínica IKIGAI* solicita a confirmação da sua presença para o atendimento:\n` +
    `${detalhes.join('\n')}\n\n` +
    `Responda *SIM* para confirmar sua presença, *REAGENDAR* para alterar o horário ou *ATENDENTE* para falar com nossa recepção.`
  );
}

export function obterProvedor(): ProvedorMensagens | null {
  const configurado = (process.env.COMUNICACAO_PROVEDOR || '').trim().toLowerCase();

  if (configurado === 'simulado') {
    return {
      nome: 'simulado',
      async enviar(pedido) {
        const referencia = 'simulado-' + pedido.id;
        switch (process.env.COMUNICACAO_SIMULAR_RESULTADO || 'submetida') {
          case 'submetida': return { estado: 'SUBMETIDA', referencia };
          case 'entregue': return { estado: 'ENTREGUE', referencia };
          case 'rejeitada': return { estado: 'FALHA', erro: 'Solicitação recusada pelo provedor simulado.' };
          case 'timeout': return { estado: 'INCERTA', erro: 'O provedor simulado não confirmou a submissão.' };
          default: return { estado: 'FALHA', erro: 'Resultado de simulação inválido.' };
        }
      },
    };
  }

  if (configurado === 'whatsapp' || configurado === 'baileys') {
    return {
      nome: 'whatsapp',
      pronto() {
        const conector = obterConectorWhatsApp();
        if (!conector) return false;
        const st = conector.getStatus();
        return st.status === 'connected' && st.sendEnabled;
      },
      async enviar(pedido) {
        const conector = obterConectorWhatsApp();
        if (!conector) {
          return { estado: 'FALHA', erro: 'Conector WhatsApp indisponível neste servidor.' };
        }
        const texto = formatarMensagemComunicacao(pedido);
        const numero = normalizarWhatsAppBr(pedido.whatsapp);
        const resultado = await conector.enviarMensagemAtiva(numero, texto);
        if (resultado.ok) {
          return {
            estado: 'SUBMETIDA',
            referencia: resultado.messageId || `whatsapp-${pedido.id}`
          };
        }
        if (resultado.motivo === 'send_error') {
          return { estado: 'INCERTA', erro: resultado.erro };
        }
        return { estado: 'FALHA', erro: resultado.erro };
      },
    };
  }

  return null;
}
