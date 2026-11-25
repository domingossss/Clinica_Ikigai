import path from 'node:path';
import fs from 'node:fs';
import makeWASocket, {
  AuthenticationState,
  ConnectionState,
  DisconnectReason,
  MessageUpsertType,
  UserFacingSocketConfig,
  WAMessage,
  WAMessageKey,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { MessageProvider, OutgoingMessage, WhatsAppSimulationService } from './whatsappSimulation.js';
import { WhatsAppClinicRepository } from './whatsappClinicRepository.js';
import type { ConectorWhatsAppAtivo, ResultadoEnvioAtivoWhatsApp } from './whatsappRuntime.js';

export type BaileysLogger = NonNullable<UserFacingSocketConfig['logger']>;

export type BaileysConnectionStatus =
  | 'disabled'
  | 'connecting'
  | 'awaiting_qr'
  | 'connected'
  | 'reconnecting'
  | 'logged_out'
  | 'stopped';

export interface BaileysSocketLike {
  ev: {
    on(event: 'connection.update', listener: (update: Partial<ConnectionState>) => void): void;
    on(event: 'creds.update', listener: () => void): void;
    on(event: 'messages.upsert', listener: (payload: { messages: WAMessage[]; type: MessageUpsertType }) => void): void;
    removeAllListeners?(event?: string): void;
  };
  sendMessage(jid: string, content: { text: string }): Promise<WAMessage | undefined>;
  end(error: Error | undefined): Promise<void> | void;
}

export interface BaileysAuthStateBundle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export interface WhatsAppBaileysConfig {
  mode: string;
  enabled: boolean;
  sendEnabled: boolean;
  allowAnyNumber?: boolean;
  allowedNumbers: string[];
  sessionDir: string;
  maxReconnectAttempts: number;
  reconnectIntervalMs: number;
  maxMessageAgeSeconds: number;
  maxMessagesPerMinute: number;
}

export interface WhatsAppBaileysDependencies {
  authStateFactory?: (sessionDir: string) => Promise<BaileysAuthStateBundle>;
  socketFactory?: (auth: AuthenticationState, logger: BaileysLogger) => BaileysSocketLike;
  renderQr?: (qr: string) => void;
  onConnected?: () => void;
  log?: (entry: string) => void;
  now?: () => number;
  repository?: WhatsAppClinicRepository;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

export function normalizePhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!/^55[1-9][0-9]{9,10}$/.test(digits)) {
    return null;
  }
  return digits;
}

export function parseAllowedNumbers(raw: string | undefined): string[] {
  if (!raw) return [];
  const valid = new Set<string>();
  for (const part of raw.split(',')) {
    const normalized = normalizePhoneDigits(part.trim());
    if (normalized) {
      valid.add(normalized);
    }
  }
  return Array.from(valid);
}

export function loadWhatsAppBaileysConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppBaileysConfig {
  const sessionDirRaw = env.WHATSAPP_SESSION_DIR?.trim() || '.whatsapp-session';
  const sessionDir = path.isAbsolute(sessionDirRaw)
    ? sessionDirRaw
    : path.resolve(process.cwd(), sessionDirRaw);

  const maxReconnectAttempts = Math.max(0, Math.min(10, Number.parseInt(env.WHATSAPP_MAX_RECONNECT_ATTEMPTS || '3', 10) || 3));
  const reconnectIntervalMs = Math.max(100, Math.min(60000, Number.parseInt(env.WHATSAPP_RECONNECT_INTERVAL_MS || '5000', 10) || 5000));
  const maxMessagesPerMinute = Math.max(1, Math.min(60, Number.parseInt(env.WHATSAPP_RATE_LIMIT_PER_MINUTE || '10', 10) || 10));

  return {
    mode: (env.WHATSAPP_MODE || 'simulation').trim(),
    enabled: env.WHATSAPP_BAILEYS_ENABLED === 'true',
    sendEnabled: env.WHATSAPP_SEND_ENABLED === 'true',
    allowAnyNumber: env.WHATSAPP_ALLOW_ANY_NUMBER === 'true',
    allowedNumbers: parseAllowedNumbers(env.WHATSAPP_ALLOWED_NUMBERS),
    sessionDir,
    maxReconnectAttempts,
    reconnectIntervalMs,
    maxMessageAgeSeconds: 120,
    maxMessagesPerMinute
  };
}

let libsignalNoiseSuppressed = false;
export function suppressLibsignalConsoleNoise(): void {
  if (libsignalNoiseSuppressed) return;
  libsignalNoiseSuppressed = true;
  const shouldSuppress = (firstArg: unknown) =>
    typeof firstArg === 'string' &&
    (firstArg.startsWith('Closing session:') ||
      firstArg.startsWith('Opening session:') ||
      firstArg.startsWith('Removing old closed session:') ||
      firstArg.startsWith('Session already closed') ||
      firstArg.startsWith('Decrypted message with closed session.'));

  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origLog = console.log.bind(console);

  console.info = (...args: unknown[]) => {
    if (!shouldSuppress(args[0])) origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (!shouldSuppress(args[0])) origWarn(...args);
  };
  console.log = (...args: unknown[]) => {
    if (!shouldSuppress(args[0])) origLog(...args);
  };
}

export function createSilentLogger(): BaileysLogger {
  suppressLibsignalConsoleNoise();
  const noop = () => {};
  const logger: BaileysLogger = {
    level: 'silent',
    child: () => logger,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop
  };
  return logger;
}

export function extractNormalizedConversation(key: WAMessageKey | undefined): {
  phone: string;
  replyJid: string;
} | null {
  if (!key) return null;

  const remoteJid = key.remoteJid?.trim();
  const remoteJidAlt = key.remoteJidAlt?.trim();
  if (!remoteJid) return null;

  // Ignorar grupos, listas de transmissão, status e canais (newsletters)
  if (
    isJidGroup(remoteJid) ||
    isJidBroadcast(remoteJid) ||
    isJidStatusBroadcast(remoteJid) ||
    isJidNewsletter(remoteJid) ||
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('@broadcast') ||
    remoteJid.endsWith('@newsletter') ||
    Boolean(key.participant)
  ) {
    return null;
  }

  // Suporte à mudança da Baileys v7: sessões podem usar @lid com número real em remoteJidAlt
  const candidates = [remoteJid, remoteJidAlt].filter((item): item is string => typeof item === 'string' && item.length > 0);
  for (const candidate of candidates) {
    const normalizedJid = jidNormalizedUser(candidate);
    if (normalizedJid.endsWith('@s.whatsapp.net') || normalizedJid.endsWith('@c.us')) {
      const userPart = normalizedJid.split('@')[0] || '';
      const phone = normalizePhoneDigits(userPart);
      if (phone) {
        return {
          phone,
          replyJid: `${phone}@s.whatsapp.net`
        };
      }
    }
  }

  return null;
}

export function extractTextFromWAMessage(msg: WAMessage): string | null {
  const content = msg.message;
  if (!content) return null;

  if (typeof content.conversation === 'string' && content.conversation.trim().length > 0) {
    return content.conversation;
  }

  if (typeof content.extendedTextMessage?.text === 'string' && content.extendedTextMessage.text.trim().length > 0) {
    return content.extendedTextMessage.text;
  }

  return null;
}

/**
 * Provedor de mensagens integrado ao socket Baileys com bloqueio por padrão,
 * allowlist obrigatória e proibição de disparos em massa.
 */
const MAX_OUTBOX_BUFFER = 50;
const MAX_CACHE_ENTRIES = 1000;

export class BaileysMessageProvider implements MessageProvider {
  readonly sentOutbox: Array<{ phone: string; jid: string; text: string }> = [];
  readonly blockedOutbox: Array<{ phone: string; text: string; reason: string }> = [];

  private pushBounded<T>(arr: T[], item: T): void {
    // Em produção, não retém conteúdo de mensagens/PII em RAM; em dev/test mantém ring buffer pequeno.
    if (process.env.NODE_ENV === 'production') return;
    if (arr.length >= MAX_OUTBOX_BUFFER) arr.shift();
    arr.push(item);
  }

  constructor(
    private readonly getSocket: () => BaileysSocketLike | null,
    private readonly getState: () => BaileysConnectionStatus,
    private readonly isSendEnabled: () => boolean,
    private readonly isAllowedPhone: (phone: string) => boolean,
    private readonly resolveReplyJid: (phone: string) => string,
    private readonly onMessageSent: (messageId: string | undefined) => void,
    private readonly log: (entry: string) => void
  ) {}

  async send(phone: string, text: string): Promise<void> {
    const normalizedPhone = normalizePhoneDigits(phone);
    if (!normalizedPhone || !this.isAllowedPhone(normalizedPhone)) {
      this.pushBounded(this.blockedOutbox, { phone, text, reason: 'unauthorized_recipient' });
      this.log(`[WhatsApp Baileys] phone=${maskPhone(phone)} result=send_blocked_unauthorized`);
      throw new Error('UNAUTHORIZED_RECIPIENT');
    }

    if (!this.isSendEnabled()) {
      this.pushBounded(this.blockedOutbox, { phone: normalizedPhone, text, reason: 'send_disabled_by_config' });
      this.log(`[WhatsApp Baileys] phone=${maskPhone(normalizedPhone)} result=send_blocked_by_config`);
      return;
    }

    const socket = this.getSocket();
    if (!socket || this.getState() !== 'connected') {
      this.log(`[WhatsApp Baileys] phone=${maskPhone(normalizedPhone)} result=socket_not_connected`);
      throw new Error('SOCKET_NOT_CONNECTED');
    }

    const replyJid = this.resolveReplyJid(normalizedPhone);
    const sent = await socket.sendMessage(replyJid, { text });
    const sentId = sent?.key?.id ?? undefined;
    this.onMessageSent(sentId);
    this.pushBounded(this.sentOutbox, { phone: normalizedPhone, jid: replyJid, text });
    this.log(`[WhatsApp Baileys] phone=${maskPhone(normalizedPhone)} result=sent`);
  }

  async sendActive(phone: string, text: string): Promise<ResultadoEnvioAtivoWhatsApp> {
    const normalizedPhone = normalizePhoneDigits(phone);
    if (!normalizedPhone || !this.isAllowedPhone(normalizedPhone)) {
      this.pushBounded(this.blockedOutbox, { phone, text, reason: 'unauthorized_recipient' });
      this.log(`[WhatsApp Baileys] phone=${maskPhone(phone)} result=active_send_blocked_unauthorized`);
      return {
        ok: false,
        motivo: 'unauthorized_recipient',
        erro: 'Número não autorizado na lista de envio do WhatsApp.'
      };
    }

    if (!this.isSendEnabled()) {
      this.pushBounded(this.blockedOutbox, { phone: normalizedPhone, text, reason: 'send_disabled_by_config' });
      this.log(`[WhatsApp Baileys] phone=${maskPhone(normalizedPhone)} result=active_send_blocked_by_config`);
      return {
        ok: false,
        motivo: 'send_disabled_by_config',
        erro: 'Envio real de mensagens WhatsApp está desabilitado na configuração.'
      };
    }

    const socket = this.getSocket();
    if (!socket || this.getState() !== 'connected') {
      this.log(`[WhatsApp Baileys] phone=${maskPhone(normalizedPhone)} result=active_socket_not_connected`);
      return {
        ok: false,
        motivo: 'socket_not_connected',
        erro: 'WhatsApp desconectado no momento.'
      };
    }

    try {
      const replyJid = this.resolveReplyJid(normalizedPhone);
      const sent = await socket.sendMessage(replyJid, { text });
      const sentId = sent?.key?.id ?? undefined;
      this.onMessageSent(sentId);
      this.pushBounded(this.sentOutbox, { phone: normalizedPhone, jid: replyJid, text });
      this.log(`[WhatsApp Baileys] phone=${maskPhone(normalizedPhone)} result=active_sent`);
      return { ok: true, messageId: sentId };
    } catch {
      this.log(`[WhatsApp Baileys] phone=${maskPhone(normalizedPhone)} result=active_send_error`);
      return {
        ok: false,
        motivo: 'send_error',
        erro: 'Não foi possível confirmar o envio pelo WhatsApp.'
      };
    }
  }
}

export class WhatsAppBaileysConnector implements ConectorWhatsAppAtivo {
  private status: BaileysConnectionStatus = 'disabled';
  private socket: BaileysSocketLike | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private sessionRecovered = false;
  private readonly allowedNumbers: Set<string>;
  private readonly allowAnyNumber: boolean;
  private readonly replyJids = new Map<string, string>();
  private readonly sentMessageIds = new Set<string>();
  private readonly rateLimitWindows = new Map<string, number[]>();
  private readonly log: (entry: string) => void;
  private readonly now: () => number;
  private readonly authStateFactory: (sessionDir: string) => Promise<BaileysAuthStateBundle>;
  private readonly socketFactory: (auth: AuthenticationState, logger: BaileysLogger) => BaileysSocketLike;
  private readonly renderQr: (qr: string) => void;
  private readonly onConnected?: () => void;

  readonly provider: BaileysMessageProvider;
  readonly simulationService: WhatsAppSimulationService;

  constructor(
    private readonly config: WhatsAppBaileysConfig,
    deps: WhatsAppBaileysDependencies = {},
    simulationService?: WhatsAppSimulationService
  ) {
    this.allowedNumbers = new Set(config.allowedNumbers.map(n => normalizePhoneDigits(n)).filter((n): n is string => Boolean(n)));
    this.allowAnyNumber = Boolean(config.allowAnyNumber);
    this.log = deps.log ?? console.info;
    this.now = deps.now ?? (() => Date.now());
    this.onConnected = deps.onConnected;
    this.authStateFactory = deps.authStateFactory ?? ((dir: string) => useMultiFileAuthState(dir));
    this.socketFactory = deps.socketFactory ?? ((auth: AuthenticationState, logger: BaileysLogger) =>
      makeWASocket({
        auth,
        logger,
        browser: ['Clinica IKIGAI Lab', 'Desktop', '1.1.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false
      }));
    this.renderQr = deps.renderQr ?? ((qr: string) => {
      this.log('[WhatsApp Baileys] QR Code gerado para pareamento manual do numero de laboratorio:');
      qrcode.generate(qr, { small: true });
    });

    this.provider = new BaileysMessageProvider(
      () => this.socket,
      () => this.status,
      () => this.config.sendEnabled,
      (phone: string) => this.isNumberAuthorized(phone),
      (phone: string) => this.replyJids.get(phone) ?? `${phone}@s.whatsapp.net`,
      (sentId: string | undefined) => {
        if (sentId) {
          this.sentMessageIds.add(sentId);
          if (this.sentMessageIds.size > 1000) {
            const oldest = this.sentMessageIds.values().next().value;
            if (oldest) this.sentMessageIds.delete(oldest);
          }
        }
      },
      this.log
    );

    this.simulationService =
      simulationService ??
      new WhatsAppSimulationService(this.provider, this.log, {
        repository: deps.repository,
        now: () => new Date(this.now())
      });
  }

  isNumberAuthorized(phone: string): boolean {
    const normalized = normalizePhoneDigits(phone);
    if (!normalized) return false;
    if (this.allowAnyNumber) return true;
    return this.allowedNumbers.has(normalized);
  }

  getStatus() {
    return {
      status: this.status,
      mode: this.config.mode,
      enabled: this.config.enabled,
      sendEnabled: this.config.sendEnabled,
      allowAnyNumber: this.allowAnyNumber,
      sessionRecovered: this.sessionRecovered,
      reconnectAttempts: this.reconnectAttempts,
      allowedNumbersCount: this.allowedNumbers.size
    };
  }

  async enviarMensagemAtiva(phone: string, text: string): Promise<ResultadoEnvioAtivoWhatsApp> {
    return this.provider.sendActive(phone, text);
  }

  async start(): Promise<void> {
    if (this.config.mode !== 'baileys' || !this.config.enabled) {
      this.status = 'disabled';
      this.log('[WhatsApp Baileys] state=disabled reason=explicit_config_required');
      return;
    }

    this.stopping = false;
    await this.connectSocket();
  }

  private async connectSocket(): Promise<void> {
    this.clearReconnectTimer();
    this.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';

    const credsFile = path.join(this.config.sessionDir, 'creds.json');
    const hadSessionFile = fs.existsSync(credsFile);

    const { state, saveCreds } = await this.authStateFactory(this.config.sessionDir);
    const hasRegisteredCreds = Boolean(state?.creds?.registered) || hadSessionFile;
    this.sessionRecovered = hasRegisteredCreds;

    if (this.sessionRecovered) {
      this.log('[WhatsApp Baileys] state=session_recovered');
    } else {
      this.log('[WhatsApp Baileys] state=initializing_new_session');
    }

    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners?.('creds.update');
        this.socket.ev.removeAllListeners?.('connection.update');
        this.socket.ev.removeAllListeners?.('messages.upsert');
        void Promise.resolve(this.socket.end?.(undefined)).catch(() => {});
      } catch {
        // Ignora erro ao encerrar socket anterior antes da reconexão
      }
      this.socket = null;
    }

    const silentLogger = createSilentLogger();
    const sock = this.socketFactory(state, silentLogger);
    this.socket = sock;

    sock.ev.on('creds.update', () => {
      void Promise.resolve(saveCreds()).catch(() => {
        this.log('[WhatsApp Baileys] state=creds_save_error');
      });
    });

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      this.handleConnectionUpdate(update);
    });

    sock.ev.on('messages.upsert', (payload: { messages: WAMessage[]; type: MessageUpsertType }) => {
      void this.handleMessagesUpsert(payload);
    });
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update;

    if (typeof qr === 'string' && qr.length > 0 && !this.stopping) {
      this.status = 'awaiting_qr';
      this.log('[WhatsApp Baileys] state=awaiting_qr');
      this.renderQr(qr);
    }

    if (connection === 'open') {
      this.status = 'connected';
      this.reconnectAttempts = 0;
      this.log(`[WhatsApp Baileys] state=connected sendEnabled=${this.config.sendEnabled} allowAnyNumber=${this.allowAnyNumber} allowedNumbers=${this.allowedNumbers.size}`);
      this.onConnected?.();
      return;
    }

    if (connection === 'close') {
      if (this.stopping) {
        this.status = 'stopped';
        this.log('[WhatsApp Baileys] state=stopped');
        return;
      }

      const errorObj = lastDisconnect?.error as { output?: { statusCode?: number }; statusCode?: number } | undefined;
      const statusCode = errorObj?.output?.statusCode ?? errorObj?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        this.status = 'logged_out';
        this.clearReconnectTimer();
        this.socket = null;
        this.log('[WhatsApp Baileys] state=logged_out reconnect=disabled');
        return;
      }

      if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.reconnectAttempts += 1;
        this.status = 'reconnecting';
        this.log(
          `[WhatsApp Baileys] state=reconnecting attempt=${this.reconnectAttempts}/${this.config.maxReconnectAttempts} code=${statusCode ?? 'unknown'}`
        );
        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
          if (!this.stopping && this.status === 'reconnecting') {
            void this.connectSocket().catch(() => {
              this.status = 'stopped';
              this.log('[WhatsApp Baileys] state=reconnect_failed');
            });
          }
        }, this.config.reconnectIntervalMs);
        this.reconnectTimer.unref?.();
      } else {
        this.status = 'stopped';
        this.socket = null;
        this.log(`[WhatsApp Baileys] state=stopped reason=max_reconnect_attempts_reached code=${statusCode ?? 'unknown'}`);
      }
    }
  }

  private async handleMessagesUpsert(payload: { messages: WAMessage[]; type: MessageUpsertType }): Promise<void> {
    if (this.stopping || payload.type !== 'notify' || !Array.isArray(payload.messages)) {
      return;
    }

    for (const msg of payload.messages) {
      await this.processSingleWAMessage(msg);
    }
  }

  async processSingleWAMessage(msg: WAMessage): Promise<OutgoingMessage | null> {
    if (!msg || !msg.key) return null;

    const rawId = msg.key.id?.trim();
    if (!rawId) return null;

    // 1. Descartar mensagens enviadas pelo próprio bot
    if (msg.key.fromMe || this.sentMessageIds.has(rawId)) {
      this.log(`[WhatsApp Baileys] id=${rawId} result=ignored_from_me`);
      return null;
    }

    // 2. Ignorar grupos, canais, listas de transmissão e normalizar JID/LID
    const conversation = extractNormalizedConversation(msg.key);
    if (!conversation) {
      this.log(`[WhatsApp Baileys] id=${rawId} result=ignored_unsupported_jid`);
      return null;
    }

    const { phone, replyJid } = conversation;

    // 3. Ignorar mensagens antigas
    if (msg.messageTimestamp !== undefined && msg.messageTimestamp !== null) {
      const tsNumber = typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp
        : Number(msg.messageTimestamp.toString());
      if (Number.isFinite(tsNumber) && tsNumber > 0) {
        const ageSeconds = Math.floor(this.now() / 1000) - tsNumber;
        if (ageSeconds > this.config.maxMessageAgeSeconds) {
          this.log(`[WhatsApp Baileys] id=${rawId} phone=${maskPhone(phone)} result=ignored_old_message`);
          return null;
        }
      }
    }

    // 4. Ignorar eventos sem texto válido (mídia, figurinhas, reações, recibos)
    const text = extractTextFromWAMessage(msg);
    if (text === null || text.length > 1000) {
      this.log(`[WhatsApp Baileys] id=${rawId} phone=${maskPhone(phone)} result=ignored_non_text_or_oversized`);
      return null;
    }

    // 5. Processar apenas mensagens de números de teste autorizados
    if (!this.isNumberAuthorized(phone)) {
      this.log(`[WhatsApp Baileys] id=${rawId} phone=${maskPhone(phone)} result=unauthorized_number`);
      return null;
    }

    // 6. Limite de processamento por conversa e prevenção de loops
    if (!this.checkAndRecordRateLimit(phone)) {
      this.log(`[WhatsApp Baileys] id=${rawId} phone=${maskPhone(phone)} result=rate_limited`);
      return null;
    }

    // Registrar JID de resposta normalizado com teto LRU simples para evitar vazamento de memória
    if (this.replyJids.has(phone)) this.replyJids.delete(phone);
    else if (this.replyJids.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.replyJids.keys().next().value;
      if (oldestKey !== undefined) this.replyJids.delete(oldestKey);
    }
    this.replyJids.set(phone, replyJid);
    const sanitizedMessageId = rawId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);

    try {
      return await this.simulationService.process({
        messageId: sanitizedMessageId,
        phone,
        text,
        origin: 'baileys-local'
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.log(`[WhatsApp Baileys] id=${sanitizedMessageId} phone=${maskPhone(phone)} result=processing_failed reason=${reason}`);
      return null;
    }
  }

  private checkAndRecordRateLimit(phone: string): boolean {
    const currentMs = this.now();
    const windowStart = currentMs - 60_000;
    // Limpa janelas expiradas periodicamente quando o mapa cresce
    if (this.rateLimitWindows.size >= MAX_CACHE_ENTRIES) {
      for (const [key, timestamps] of this.rateLimitWindows.entries()) {
        const ativos = timestamps.filter(ts => ts > windowStart);
        if (ativos.length === 0) this.rateLimitWindows.delete(key);
        else this.rateLimitWindows.set(key, ativos);
      }
      if (this.rateLimitWindows.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = this.rateLimitWindows.keys().next().value;
        if (oldestKey !== undefined) this.rateLimitWindows.delete(oldestKey);
      }
    }
    const history = (this.rateLimitWindows.get(phone) ?? []).filter(ts => ts > windowStart);

    if (history.length >= this.config.maxMessagesPerMinute) {
      this.rateLimitWindows.set(phone, history);
      return false;
    }

    history.push(currentMs);
    this.rateLimitWindows.set(phone, history);
    return true;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearReconnectTimer();

    const activeSocket = this.socket;
    this.socket = null;

    if (activeSocket) {
      try {
        activeSocket.ev.removeAllListeners?.();
        await activeSocket.end(undefined);
      } catch {
        this.log('[WhatsApp Baileys] state=stop_cleanup_warning');
      }
    }

    this.status = 'stopped';
    this.log('[WhatsApp Baileys] state=stopped');
  }
}

