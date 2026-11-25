export type StatusConexaoWhatsApp = {
  status: 'disabled' | 'connecting' | 'awaiting_qr' | 'connected' | 'reconnecting' | 'logged_out' | 'stopped';
  mode: string;
  enabled: boolean;
  sendEnabled: boolean;
  allowAnyNumber: boolean;
  sessionRecovered: boolean;
  reconnectAttempts: number;
  allowedNumbersCount: number;
};

export type ResultadoEnvioAtivoWhatsApp =
  | { ok: true; messageId?: string }
  | {
      ok: false;
      motivo: 'unauthorized_recipient' | 'send_disabled_by_config' | 'socket_not_connected' | 'send_error';
      erro: string;
    };

export interface ConectorWhatsAppAtivo {
  getStatus(): StatusConexaoWhatsApp;
  enviarMensagemAtiva(phone: string, text: string): Promise<ResultadoEnvioAtivoWhatsApp>;
}

let conectorAtivo: ConectorWhatsAppAtivo | null = null;

export function registrarConectorWhatsApp(conector: ConectorWhatsAppAtivo | null): void {
  conectorAtivo = conector;
}

export function obterConectorWhatsApp(): ConectorWhatsAppAtivo | null {
  return conectorAtivo;
}

export function obterStatusConexaoWhatsApp(env: NodeJS.ProcessEnv = process.env): StatusConexaoWhatsApp {
  if (conectorAtivo) {
    return conectorAtivo.getStatus();
  }
  const allowedRaw = env.WHATSAPP_ALLOWED_NUMBERS || '';
  const allowedCount = allowedRaw
    .split(',')
    .map(p => p.replace(/\D/g, ''))
    .filter(p => /^55[1-9][0-9]{9,10}$/.test(p)).length;

  return {
    status: 'disabled',
    mode: (env.WHATSAPP_MODE || 'simulation').trim(),
    enabled: env.WHATSAPP_BAILEYS_ENABLED === 'true',
    sendEnabled: env.WHATSAPP_SEND_ENABLED === 'true',
    allowAnyNumber: env.WHATSAPP_ALLOW_ANY_NUMBER === 'true',
    sessionRecovered: false,
    reconnectAttempts: 0,
    allowedNumbersCount: allowedCount
  };
}

