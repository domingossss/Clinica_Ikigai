import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createWhatsAppSimulationRouter } from '../routes/whatsappSimulation.js';
import { MessageProvider, SimulatedMessageProvider, WhatsAppSimulationService } from '../services/whatsappSimulation.js';
import { mockStore } from './mock-store.js';

const originalMode = process.env.WHATSAPP_MODE;
process.env.WHATSAPP_MODE = 'simulation';
const secret = 'test-secret-only';
const provider = new SimulatedMessageProvider();
const service = new WhatsAppSimulationService(provider, () => {});
const app = express();
app.use(express.json());
app.use('/api/integracoes/whatsapp', createWhatsAppSimulationRouter(service, secret));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = (server.address() as AddressInfo).port;
const url = `http://127.0.0.1:${port}/api/integracoes/whatsapp/simular`;
const event = (messageId: string, text: string) => ({ messageId, phone: '5511999999999', text, origin: 'n8n-local-simulation' });
async function post(body: unknown, auth = true) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'x-ikigai-simulation-key': secret } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}

test('recepção, menu, opções, invalidação, idempotência e isolamento da agenda', async () => {
  const before = JSON.stringify(mockStore.agendamentos);
  try {
    const menu = await post(event('m-menu', 'menu'));
    assert.equal(menu.status, 200);
    assert.match(menu.body.dados.reply, /1 - Agendar consulta/);
    assert.equal(menu.body.dados.intent, 'menu');
    for (const [option, intent] of [['1', 'agendar'], ['2', 'consultar'], ['3', 'confirmar']] as const) {
      const result = await post(event(`m-${option}`, option));
      assert.equal(result.status, 200);
      assert.equal(result.body.dados.intent, intent);
      assert.equal(result.body.dados.simulated, true);
    }
    const invalid = await post(event('m-invalid', '9'));
    assert.equal(invalid.body.dados.intent, 'invalida');
    assert.match(invalid.body.dados.reply, /Opção inválida/);
    const sent = provider.outbox.length;
    const duplicate = await post(event('m-1', '1'));
    assert.equal(duplicate.body.dados.duplicate, true);
    assert.equal(provider.outbox.length, sent);
    assert.equal((await post({ ...event('m-absent', '1'), messageId: undefined })).status, 400);
    assert.equal((await post({ ...event('m-phone', '1'), phone: '123' })).status, 400);
    assert.equal((await post(event('m-auth', '1'), false)).status, 401);
    assert.equal((await post({ ...event('m-origin', '1'), origin: 'meta' })).status, 400);
    assert.equal(JSON.stringify(mockStore.agendamentos), before);
    assert.equal(provider.outbox.length, 5);
    assert.ok(provider.outbox.every(item => item.phone === '5511999999999'));
  } finally {
    server.close();
    if (originalMode === undefined) delete process.env.WHATSAPP_MODE;
    else process.env.WHATSAPP_MODE = originalMode;
  }
});

test('falha do provedor não confirma processamento nem altera agenda', async () => {
  let attempts = 0;
  const failing: MessageProvider = { async send() { attempts++; throw new Error('simulated failure'); } };
  const isolated = new WhatsAppSimulationService(failing, () => {});
  const before = JSON.stringify(mockStore.agendamentos);
  await assert.rejects(isolated.process(event('m-fail', '1') as any), /PROVIDER_FAILURE/);
  await assert.rejects(isolated.process(event('m-fail', '1') as any), /PROVIDER_FAILURE/);
  assert.equal(attempts, 2);
  assert.equal(JSON.stringify(mockStore.agendamentos), before);
  assert.equal(provider.outbox.length, 5);
});

