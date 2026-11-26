import './config/webcrypto.js';
import { registrarCapacidadeHoje } from './services/capacidadeAgenda.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dashboardRoutes from './routes/dashboardRoutes.js';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import agendamentosRouter from './routes/agendamentos.js';
import authRouter from './routes/auth.js';
import usuariosRouter from './routes/usuarios.js';
import { controlarPermissoesApi } from './middleware/permissoes.js';
import comunicacoesRouter from './routes/comunicacoes.js';
import { iniciarLembretes, processarFila } from './services/comunicacoes.js';
import { createWhatsAppSimulationRouter } from './routes/whatsappSimulation.js';
import { SimulatedMessageProvider, WhatsAppSimulationService } from './services/whatsappSimulation.js';
import { WhatsAppBaileysConnector, loadWhatsAppBaileysConfigFromEnv } from './services/whatsappBaileys.js';
import { createWhatsAppClinicRepository } from './services/whatsappClinicRepository.js';
import { registrarConectorWhatsApp } from './services/whatsappRuntime.js';
import { exigirAutenticacao, exigirSenhaAtualizada, validarConfiguracaoSessao } from './middleware/auth.js';
import pool, { testarConexao } from './config/database.js';
import { acompanharAlteracoes, aguardarPublicacoesPendentes, encerrarTodasConexoesSse, notificarAlteracoes } from './services/alteracoesClinica.js';

// Carregar variáveis de ambiente do .env
dotenv.config();

export const app = express();
if (process.env.TRUST_PROXY_LOOPBACK === 'true') app.set('trust proxy', 'loopback');
const PORT = process.env.PORT || 3000;

// ============================================================================
// SECURITY MIDDLEWARE LAYER
// ============================================================================

// 1. Helmet: define headers de seguranca HTTP automaticamente
//    (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, CSP, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://viacep.com.br"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false // Necessario para APIs REST
}));

// 2. Rate Limiting: protecao contra brute force e DDoS na camada de aplicacao
const limiter = rateLimit({
  skip: req => req.path === '/eventos',
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // Janela de 1 minuto
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),              // Max 100 requisicoes por IP
  standardHeaders: true,  // Retorna headers RateLimit-* padrao
  legacyHeaders: false,   // Desabilita headers X-RateLimit-* antigos
  message: {
    sucesso: false,
    erro: 'Limite de requisicoes excedido. Tente novamente em alguns minutos.'
  }
});
const eventosLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    sucesso: false,
    erro: 'Limite de conexões de atualização excedido. Aguarde um momento.'
  }
});
const healthLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'limite_excedido' }
});
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', limiter);
app.use('/api/eventos', eventosLimiter);

// 3. Configuração do CORS com origens dinamicas do .env
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOriginsSet = new Set(allowedOrigins);

function extrairOrigemValida(urlOuOrigem?: string): string | null {
  if (!urlOuOrigem) return null;
  try {
    return new URL(urlOuOrigem).origin;
  } catch {
    return null;
  }
}

function isOrigemLocalEstrita(origem?: string): boolean {
  if (!origem) return true;
  try {
    const parsed = new URL(origem);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  const ownOrigin = req.protocol + '://' + req.get('host');
  if (origin && origin !== ownOrigin && !allowedOriginsSet.has(origin)) {
    res.status(403).json({ sucesso:false, erro:'Origem não permitida.' }); return;
  }
  next();
});

// 4. Body parser com limite adequado por rota (100kb no prontuário clínico; 10kb nas demais rotas)
const jsonProntuario = express.json({ limit: '100kb' });
const jsonPadrao = express.json({ limit: '10kb' });
app.use((req, res, next) => {
  if (/^\/api\/pacientes\/[A-Za-z0-9-]+\/prontuario\/?$/.test(req.path)) {
    return jsonProntuario(req, res, next);
  }
  return jsonPadrao(req, res, next);
});

// 5. Desabilitar header X-Powered-By (nao vazar tecnologia do servidor)
app.disable('x-powered-by');

// 6. Verificação estrita de Origem/Referer para métodos mutativos (proteção Anti-CSRF)
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const site = req.get('sec-fetch-site');
    const ownOrigin = `${req.protocol}://${req.get('host')}`;

    // Em desenvolvimento/teste, aceita apenas chamadas sem Origin ou estritamente de localhost/127.0.0.1
    if (process.env.NODE_ENV !== 'production' && isOrigemLocalEstrita(origin)) {
      return next();
    }

    if (site === 'same-origin') return next();
    const origemExata = extrairOrigemValida(origin);
    if (origemExata && (origemExata === ownOrigin || allowedOriginsSet.has(origemExata))) return next();
    const refererOrigin = extrairOrigemValida(referer);
    if (!origin && refererOrigin && (refererOrigin === ownOrigin || allowedOriginsSet.has(refererOrigin))) return next();

    res.status(403).json({ sucesso: false, erro: 'Origem ou site não autorizado para operação mutativa.' });
    return;
  }
  next();
});

// ============================================================================
// ROTAS DA API
// ============================================================================

// Registro de rotas da API
app.use('/api/auth', authRouter);

let ultimoHealthOkMs = 0;
let ultimoHealthStatus = false;
async function verificarSaude(_req: express.Request, res: express.Response) {
  const agora = Date.now();
  if (agora - ultimoHealthOkMs < 3000) {
    res.status(ultimoHealthStatus ? 200 : 503).json({ status: ultimoHealthStatus ? 'OK' : 'indisponivel' });
    return;
  }
  try {
    await pool.query('SELECT 1');
    ultimoHealthOkMs = agora;
    ultimoHealthStatus = true;
    res.json({ status: 'OK' });
  } catch {
    ultimoHealthOkMs = agora;
    ultimoHealthStatus = false;
    res.status(503).json({ status: 'indisponivel' });
  }
}
app.get('/api/health', healthLimiter, verificarSaude);
if (process.env.NODE_ENV !== 'production' && process.env.WHATSAPP_MODE === 'simulation') {
  app.use('/api/integracoes/whatsapp', createWhatsAppSimulationRouter(new WhatsAppSimulationService(new SimulatedMessageProvider())));
}
app.use('/api', exigirAutenticacao, exigirSenhaAtualizada, controlarPermissoesApi, notificarAlteracoes);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/dashboard', dashboardRoutes);
app.get('/api/eventos', acompanharAlteracoes);
app.use('/api/comunicacoes', comunicacoesRouter);
app.use('/api', agendamentosRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ sucesso: false, erro: 'Rota não encontrada.' });
});

// Rota de Healthcheck
app.get('/health', healthLimiter, verificarSaude);

// O mesmo servidor entrega o site compilado e a API.
const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
app.use(express.static(siteDirectory));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(siteDirectory, 'index.html'), err => { if (err) next(err); });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    res.status(413).json({
      sucesso: false,
      erro: 'Os dados enviados ultrapassam o tamanho máximo permitido. Reduza o texto e tente novamente.',
    });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ sucesso: false, erro: 'Formato JSON inválido na requisição.' });
    return;
  }
  console.error('[API]', { codigo: err?.code || err?.name || 'ERRO_INTERNO' });
  res.status(err?.status || 500).json({ sucesso: false, erro: 'Não foi possível processar a solicitação.' });
});

// ============================================================================
// INICIALIZACAO
// ============================================================================

async function bootstrap() {
  console.log('[Server] Iniciando servidor da Clinica Ikigai...');
  
  validarConfiguracaoSessao();
  // Testar conexão física com o MySQL
  const dbConnected = await testarConexao();
  
  if (!dbConnected) {
  console.warn('[Server] Banco indisponível. As operações retornarão erro até a conexão ser restabelecida.');
  }

  await registrarCapacidadeHoje().catch(() => console.error('[Capacidade] Não foi possível registrar a capacidade diária.'));
  const timerCapacidade = setInterval(() => {
    void registrarCapacidadeHoje().catch(() => console.error('[Capacidade] Falha ao registrar capacidade.'));
  }, 60000);
  timerCapacidade.unref();
  iniciarLembretes();

  let baileysConnector: WhatsAppBaileysConnector | null = null;
  const httpServer = app.listen(Number(PORT), process.env.HOST || '127.0.0.1', () => {
    console.log(`[Server] API REST ativa em http://localhost:${PORT}`);
    console.log(`[Server] Healthcheck: http://localhost:${PORT}/health`);
    console.log(`[Security] Helmet ativo | Rate limit: ${process.env.RATE_LIMIT_MAX || 100} req/min | Body limit: 10kb (100kb prontuário)`);
    console.log(`[Security] CORS origins: ${allowedOrigins.join(', ')}`);

    // Inicialização não bloqueante do conector Baileys (somente quando explicitamente habilitado)
    const baileysConfig = loadWhatsAppBaileysConfigFromEnv();
    if (baileysConfig.mode === 'baileys' && baileysConfig.enabled) {
      const dbModeEnv = (process.env.WHATSAPP_DB_MODE || 'auto').trim().toLowerCase();
      const repoMode: 'memory' | 'mysql' =
        dbModeEnv === 'mysql' ? 'mysql' : dbModeEnv === 'memory' ? 'memory' : dbConnected ? 'mysql' : 'memory';
      baileysConnector = new WhatsAppBaileysConnector(baileysConfig, {
        repository: createWhatsAppClinicRepository(repoMode),
        onConnected: () => {
          void processarFila().catch(() => {
            console.error('[Comunicação] Falha ao processar a fila ao conectar o WhatsApp.');
          });
        }
      });
      registrarConectorWhatsApp(baileysConnector);
      void baileysConnector.start().catch(() => {
        console.error('[WhatsApp Baileys] Falha controlada ao inicializar conector.');
      });
    } else {
      console.log(`[WhatsApp] Modo ativo: ${baileysConfig.mode} (conector Baileys desabilitado por padrao).`);
    }
  });

  let encerrando = false;
  const shutdown = () => {
    if (encerrando) return;
    encerrando = true;
    clearInterval(timerCapacidade);
    encerrarTodasConexoesSse();
    if (baileysConnector) {
      registrarConectorWhatsApp(null);
      void baileysConnector.stop();
    }
    httpServer.close(() => {
      void aguardarPublicacoesPendentes()
        .finally(() => pool.end().catch(() => {}))
        .finally(() => { process.exit(0); });
    });
    setTimeout(() => { void pool.end().catch(() => {}).finally(() => { process.exit(1); }); }, 10_000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void bootstrap().catch(err => { console.error('[Server]', err.message); process.exitCode = 1; });
}
