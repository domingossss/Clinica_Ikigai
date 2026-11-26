import '../config/webcrypto.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { ConnectionState, DisconnectReason, MessageUpsertType, WAMessage } from '@whiskeysockets/baileys';
import {
  BaileysAuthStateBundle,
  BaileysSocketLike,
  WhatsAppBaileysConfig,
  WhatsAppBaileysConnector
} from '../services/whatsappBaileys.js';
import { MENU } from '../services/whatsappSimulation.js';
import { mockStore } from './mock-store.js';

class MockBaileysSocket implements BaileysSocketLike {
  private readonly emitter = new EventEmitter();
  readonly sentMessages: Array<{ jid: string; text: string }> = [];
  ended = false;
  shouldFailSend = false;
  private sentCounter = 0;

  readonly ev = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.emitter.on(event, listener);
    },
    removeAllListeners: (event?: string) => {
      this.emitter.removeAllListeners(event);
    }
  };

  async sendMessage(jid: string, content: { text: string }): Promise<WAMessage | undefined> {
    if (this.shouldFailSend) {
      throw new Error('simulated_baileys_send_error');
    }
    this.sentCounter += 1;
    this.sentMessages.push({ jid, text: content.text });
    return {
      key: {
        id: `bot-out-${this.sentCounter}`,
        remoteJid: jid,
        fromMe: true
      }
    } as WAMessage;
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  emitConnectionUpdate(update: Partial<ConnectionState>): void {
    this.emitter.emit('connection.update', update);
  }

  emitCredsUpdate(): void {
    this.emitter.emit('creds.update');
  }

  emitMessagesUpsert(messages: WAMessage[], type: MessageUpsertType = 'notify'): void {
    this.emitter.emit('messages.upsert', { messages, type });
  }
}

function createTestConfig(overrides: Partial<WhatsAppBaileysConfig> = {}): WhatsAppBaileysConfig {
  return {
    mode: 'baileys',
    enabled: true,
    sendEnabled: true,
    allowedNumbers: ['5511999999999'],
    sessionDir: 'C:\\temp\\non-existent-ikigai-test-session',
    maxReconnectAttempts: 2,
    reconnectIntervalMs: 20,
    maxMessageAgeSeconds: 120,
    maxMessagesPerMinute: 10,
    ...overrides
  };
}

function createFakeAuthState(registered = false): {
  bundle: BaileysAuthStateBundle;
  getSaveCalls: () => number;
} {
  let saveCalls = 0;
  return {
    bundle: {
      state: {
        creds: { registered } as any,
        keys: {} as any
      },
      saveCreds: async () => {
        saveCalls += 1;
      }
    },
    getSaveCalls: () => saveCalls
  };
}

function buildTextMessage(params: {
  id: string;
  remoteJid?: string;
  remoteJidAlt?: string;
  text?: string;
  fromMe?: boolean;
  participant?: string;
  timestampSeconds?: number;
}): WAMessage {
  return {
    key: {
      id: params.id,
      remoteJid: params.remoteJid ?? '5511999999999@s.whatsapp.net',
      remoteJidAlt: params.remoteJidAlt,
      fromMe: params.fromMe ?? false,
      participant: params.participant
    },
    messageTimestamp: params.timestampSeconds ?? Math.floor(Date.now() / 1000),
    message: params.text !== undefined ? { conversation: params.text } : undefined
  } as WAMessage;
}

test('conector inicializado, QR Code gerado, conectado e encerrado com segurança (e desabilitado por padrão)', async () => {
  const beforeAgendamentos = JSON.stringify(mockStore.agendamentos);
  const logs: string[] = [];
  const qrCodes: string[] = [];

  // 1. Modo simulado padrão permanece desabilitado
  const disabledConnector = new WhatsAppBaileysConnector(
    createTestConfig({ mode: 'simulation', enabled: false }),
    { log: entry => logs.push(entry) }
  );
  await disabledConnector.start();
  assert.equal(disabledConnector.getStatus().status, 'disabled');

  // 2. Inicialização explícita, geração de QR, abertura e encerramento
  const activeSocket = new MockBaileysSocket();
  const auth = createFakeAuthState(false);
  const connector = new WhatsAppBaileysConnector(createTestConfig(), {
    authStateFactory: async () => auth.bundle,
    socketFactory: () => activeSocket,
    renderQr: qr => qrCodes.push(qr),
    log: entry => logs.push(entry)
  });

  await connector.start();
  assert.equal(connector.getStatus().status, 'connecting');
  assert.equal(connector.getStatus().sessionRecovered, false);

  activeSocket.emitConnectionUpdate({ qr: 'fake-qr-payload' });
  assert.equal(connector.getStatus().status, 'awaiting_qr');
  assert.deepEqual(qrCodes, ['fake-qr-payload']);

  activeSocket.emitCredsUpdate();
  assert.equal(auth.getSaveCalls(), 1);

  activeSocket.emitConnectionUpdate({ connection: 'open' });
  assert.equal(connector.getStatus().status, 'connected');

  await connector.stop();
  assert.equal(connector.getStatus().status, 'stopped');
  assert.equal(activeSocket.ended, true);
  assert.equal(JSON.stringify(mockStore.agendamentos), beforeAgendamentos);
});

test('sessão existente recuperada sem exigir novo QR Code', async () => {
  const logs: string[] = [];
  const activeSocket = new MockBaileysSocket();
  const auth = createFakeAuthState(true);

  const connector = new WhatsAppBaileysConnector(createTestConfig(), {
    authStateFactory: async () => auth.bundle,
    socketFactory: () => activeSocket,
    log: entry => logs.push(entry)
  });

  await connector.start();
  assert.equal(connector.getStatus().sessionRecovered, true);
  assert.ok(logs.some(l => l.includes('state=session_recovered')));

  activeSocket.emitConnectionUpdate({ connection: 'open' });
  assert.equal(connector.getStatus().status, 'connected');
  await connector.stop();
});

test('recebimento de mensagem, opções 1, 2 e 3, mensagem inválida, duplicada e normalização LID (Baileys v7)', async () => {
  const beforeAgendamentos = JSON.stringify(mockStore.agendamentos);
  const logs: string[] = [];
  const activeSocket = new MockBaileysSocket();
  const auth = createFakeAuthState(true);

  const connector = new WhatsAppBaileysConnector(createTestConfig(), {
    authStateFactory: async () => auth.bundle,
    socketFactory: () => activeSocket,
    log: entry => logs.push(entry)
  });

  await connector.start();
  activeSocket.emitConnectionUpdate({ connection: 'open' });

  // Mensagem inicial recebida via LID com remoteJidAlt (padrão Baileys v7)
  const menuRes = await connector.processSingleWAMessage(
    buildTextMessage({
      id: 'msg-menu-1',
      remoteJid: '123456789012345@lid',
      remoteJidAlt: '5511999999999:12@s.whatsapp.net',
      text: 'oi'
    })
  );
  assert.ok(menuRes);
  assert.equal(menuRes.intent, 'menu');
  assert.equal(menuRes.duplicate, false);
  assert.equal(menuRes.reply, MENU);
  assert.equal(activeSocket.sentMessages.length, 1);
  assert.equal(activeSocket.sentMessages[0].jid, '5511999999999@s.whatsapp.net');

  // Mensagem duplicada (mesmo ID não reenvia no socket)
  const dupRes = await connector.processSingleWAMessage(
    buildTextMessage({
      id: 'msg-menu-1',
      text: 'oi'
    })
  );
  assert.ok(dupRes);
  assert.equal(dupRes.duplicate, true);
  assert.equal(activeSocket.sentMessages.length, 1);

  // Opção 1 - Agendar consulta
  const opt1 = await connector.processSingleWAMessage(
    buildTextMessage({ id: 'msg-opt-1', text: '1' })
  );
  assert.ok(opt1);
  assert.equal(opt1.intent, 'agendar');
  assert.match(opt1.reply, /Agendar consulta[\s\S]*CPF/i);

  // Opção 2 - Consultar agendamento
  const opt2 = await connector.processSingleWAMessage(
    buildTextMessage({ id: 'msg-opt-2', text: '2' })
  );
  assert.ok(opt2);
  assert.equal(opt2.intent, 'consultar');
  assert.match(opt2.reply, /Consultar agendamento[\s\S]*CPF/i);

  // Opção 3 - Confirmar presença
  const opt3 = await connector.processSingleWAMessage(
    buildTextMessage({ id: 'msg-opt-3', text: '3' })
  );
  assert.ok(opt3);
  assert.equal(opt3.intent, 'confirmar');
  assert.match(opt3.reply, /Confirmar presença[\s\S]*CPF/i);

  // Mensagem inválida
  const invalid = await connector.processSingleWAMessage(
    buildTextMessage({ id: 'msg-invalid-9', text: '9' })
  );
  assert.ok(invalid);
  assert.equal(invalid.intent, 'invalida');
  assert.match(invalid.reply, /Opção inválida/);
  assert.match(invalid.reply, /1 - Agendar consulta/);

  assert.equal(activeSocket.sentMessages.length, 5);
  assert.equal(JSON.stringify(mockStore.agendamentos), beforeAgendamentos);
  await connector.stop();
});

test('descarte de mensagem enviada pelo próprio bot, mensagem de grupo, mensagem antiga e número não autorizado', async () => {
  const beforeAgendamentos = JSON.stringify(mockStore.agendamentos);
  const logs: string[] = [];
  const activeSocket = new MockBaileysSocket();
  const nowMs = 1_700_000_000_000;

  const connector = new WhatsAppBaileysConnector(createTestConfig(), {
    authStateFactory: async () => createFakeAuthState(true).bundle,
    socketFactory: () => activeSocket,
    log: entry => logs.push(entry),
    now: () => nowMs
  });

  await connector.start();
  activeSocket.emitConnectionUpdate({ connection: 'open' });

  // 1. Mensagem enviada pelo próprio bot (fromMe = true)
  const fromMeRes = await connector.processSingleWAMessage(
    buildTextMessage({
      id: 'msg-from-me',
      fromMe: true,
      text: '1',
      timestampSeconds: Math.floor(nowMs / 1000)
    })
  );
  assert.equal(fromMeRes, null);

  // 2. Mensagem proveniente de grupo (@g.us)
  const groupRes = await connector.processSingleWAMessage(
    buildTextMessage({
      id: 'msg-group-1',
      remoteJid: '120363012345678901@g.us',
      participant: '5511999999999@s.whatsapp.net',
      text: '1',
      timestampSeconds: Math.floor(nowMs / 1000)
    })
  );
  assert.equal(groupRes, null);

  // 3. Mensagem antiga (anterior à janela permitida)
  const oldRes = await connector.processSingleWAMessage(
    buildTextMessage({
      id: 'msg-old-1',
      text: '1',
      timestampSeconds: Math.floor(nowMs / 1000) - 600
    })
  );
  assert.equal(oldRes, null);

  // 4. Número não autorizado
  const unauthorizedRes = await connector.processSingleWAMessage(
    buildTextMessage({
      id: 'msg-unauth-1',
      remoteJid: '5511988887777@s.whatsapp.net',
      text: '1',
      timestampSeconds: Math.floor(nowMs / 1000)
    })
  );
  assert.equal(unauthorizedRes, null);
  assert.ok(logs.some(l => l.includes('result=unauthorized_number') && l.includes('phone=***7777')));
  assert.ok(logs.every(l => !l.includes('5511988887777')));

  // 5. Tentativa direta de envio para número não autorizado é bloqueada
  await assert.rejects(
    connector.provider.send('5511988887777', 'teste bloqueado'),
    /UNAUTHORIZED_RECIPIENT/
  );

  assert.equal(activeSocket.sentMessages.length, 0);
  assert.equal(JSON.stringify(mockStore.agendamentos), beforeAgendamentos);
  await connector.stop();
});

test('desconexão temporária realiza reconexão controlada e logout não reconecta automaticamente', async () => {
  const logs: string[] = [];
  const sockets: MockBaileysSocket[] = [];

  const connector = new WhatsAppBaileysConnector(
    createTestConfig({ reconnectIntervalMs: 15, maxReconnectAttempts: 2 }),
    {
      authStateFactory: async () => createFakeAuthState(true).bundle,
      socketFactory: () => {
        const sock = new MockBaileysSocket();
        sockets.push(sock);
        return sock;
      },
      log: entry => logs.push(entry)
    }
  );

  await connector.start();
  assert.equal(sockets.length, 1);
  sockets[0].emitConnectionUpdate({ connection: 'open' });
  assert.equal(connector.getStatus().status, 'connected');

  // Simular desconexão temporária (connectionLost = 408)
  sockets[0].emitConnectionUpdate({
    connection: 'close',
    lastDisconnect: {
      error: { output: { statusCode: DisconnectReason.connectionLost } } as any,
      date: new Date()
    }
  });
  assert.equal(connector.getStatus().status, 'reconnecting');
  assert.equal(connector.getStatus().reconnectAttempts, 1);

  // Aguardar timer de reconexão controlada
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(sockets.length, 2);
  sockets[1].emitConnectionUpdate({ connection: 'open' });
  assert.equal(connector.getStatus().status, 'connected');
  assert.equal(connector.getStatus().reconnectAttempts, 0);

  // Simular evento de logout (loggedOut = 401) -> não pode reconectar
  sockets[1].emitConnectionUpdate({
    connection: 'close',
    lastDisconnect: {
      error: { output: { statusCode: DisconnectReason.loggedOut } } as any,
      date: new Date()
    }
  });
  assert.equal(connector.getStatus().status, 'logged_out');

  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(sockets.length, 2);
  await connector.stop();
});

test('envio bloqueado por configuração e falha ao enviar resposta não alteram agenda', async () => {
  const beforeAgendamentos = JSON.stringify(mockStore.agendamentos);
  const logs: string[] = [];
  const activeSocket = new MockBaileysSocket();

  // 1. Envio bloqueado por configuração (sendEnabled = false)
  const blockedConnector = new WhatsAppBaileysConnector(
    createTestConfig({ sendEnabled: false }),
    {
      authStateFactory: async () => createFakeAuthState(true).bundle,
      socketFactory: () => activeSocket,
      log: entry => logs.push(entry)
    }
  );

  await blockedConnector.start();
  activeSocket.emitConnectionUpdate({ connection: 'open' });

  const blockedRes = await blockedConnector.processSingleWAMessage(
    buildTextMessage({ id: 'msg-blocked-send', text: '1' })
  );
  assert.ok(blockedRes);
  assert.equal(blockedRes.intent, 'agendar');
  assert.equal(activeSocket.sentMessages.length, 0);
  assert.equal(blockedConnector.provider.blockedOutbox.length, 1);
  assert.equal(blockedConnector.provider.blockedOutbox[0].reason, 'send_disabled_by_config');
  await blockedConnector.stop();

  // 2. Falha ao enviar resposta (socket.sendMessage lança erro)
  const failingSocket = new MockBaileysSocket();
  failingSocket.shouldFailSend = true;
  const failingConnector = new WhatsAppBaileysConnector(
    createTestConfig({ sendEnabled: true }),
    {
      authStateFactory: async () => createFakeAuthState(true).bundle,
      socketFactory: () => failingSocket,
      log: entry => logs.push(entry)
    }
  );

  await failingConnector.start();
  failingSocket.emitConnectionUpdate({ connection: 'open' });

  const failedRes = await failingConnector.processSingleWAMessage(
    buildTextMessage({ id: 'msg-send-fail', text: '2' })
  );
  assert.equal(failedRes, null);
  assert.ok(logs.some(l => l.includes('result=processing_failed') && l.includes('reason=PROVIDER_FAILURE')));

  // Quando o socket volta a funcionar, a mesma mensagem pode ser processada (não foi confirmada na falha)
  failingSocket.shouldFailSend = false;
  const retriedRes = await failingConnector.processSingleWAMessage(
    buildTextMessage({ id: 'msg-send-fail', text: '2' })
  );
  assert.ok(retriedRes);
  assert.equal(retriedRes.intent, 'consultar');
  assert.equal(retriedRes.duplicate, false);
  assert.equal(failingSocket.sentMessages.length, 1);

  assert.equal(JSON.stringify(mockStore.agendamentos), beforeAgendamentos);
  await failingConnector.stop();
});

