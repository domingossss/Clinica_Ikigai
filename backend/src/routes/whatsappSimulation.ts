import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { IncomingMessage, WhatsAppSimulationService } from '../services/whatsappSimulation.js';

const isLocal = (address?: string) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
const authorized = (provided: unknown, expected: string) => {
  if (typeof provided !== 'string' || !expected) return false;
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createWhatsAppSimulationRouter(service: WhatsAppSimulationService, secret: string | undefined = process.env.WHATSAPP_SIMULATION_KEY) {
  const router = Router();
  router.post('/simular', async (req, res) => {
    if (process.env.WHATSAPP_MODE !== 'simulation' || !isLocal(req.socket.remoteAddress)) {
      return res.status(404).json({ sucesso: false, erro: 'Simulação indisponível.' });
    }
    if (!authorized(req.header('x-ikigai-simulation-key'), secret || '')) {
      return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
    }
    const body = req.body as Partial<IncomingMessage> | undefined;
    if (!body || body.origin !== 'n8n-local-simulation' || typeof body.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.messageId)
      || typeof body.phone !== 'string' || !/^55[1-9][0-9]{9,10}$/.test(body.phone)
      || typeof body.text !== 'string' || body.text.length > 1000) {
      return res.status(400).json({ sucesso: false, erro: 'Evento simulado inválido.' });
    }
    try {
      const result = await service.process(body as IncomingMessage);
      return res.status(200).json({ sucesso: true, dados: result });
    } catch (error) {
      const busy = error instanceof Error && error.message === 'EVENT_IN_PROGRESS';
      return res.status(busy ? 409 : 502).json({ sucesso: false, erro: busy ? 'Evento em processamento; tente novamente.' : 'Falha ao registrar resposta simulada.' });
    }
  });
  return router;
}

