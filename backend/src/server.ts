import { registrarCapacidadeHoje } from './services/capacidadeAgenda.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dashboardRoutes from './routes/dashboardRoutes.js';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import agendamentosRouter from './routes/agendamentos.js';
import authRouter from './routes/auth.js';
import usuariosRouter from './routes/usuarios.js';
import { exigirAutenticacao, exigirPerfil, garantirAdminInicial } from './middleware/auth.js';
import pool, { testarConexao, acompanharAlteracoes, notificarAlteracoes } from './config/database.js';

// Carregar variáveis de ambiente do .env
dotenv.config();

const app = express();
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
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', limiter);

// 3. Configuração do CORS com origens dinamicas do .env
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  const ownOrigin = req.protocol + '://' + req.get('host');
  if (origin && origin !== ownOrigin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ sucesso:false, erro:'Origem não permitida.' }); return;
  }
  next();
});

// 4. Body parser com limite de tamanho (protecao contra payload DoS)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// 5. Desabilitar header X-Powered-By (nao vazar tecnologia do servidor)
app.disable('x-powered-by');

// ============================================================================
// ROTAS DA API
// ============================================================================

// Registro de rotas da API
app.use('/api/auth', authRouter);

function controlarPermissoesApi(req: express.Request, res: express.Response, next: express.NextFunction): any {
  const perfil = req.usuario?.perfil;
  if (!perfil) return res.status(401).json({ sucesso: false, erro: 'Autenticação necessária.' });
  if (perfil === 'ADMIN' || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const ehConfiguracaoCatalogo = /^\/(servicos|categorias|profissionais|excecoes)(\/|$)/.test(req.path);
  const ehJornadaPropria = perfil === 'PROFISSIONAL' && req.method === 'PUT' && /^\/profissionais\/\d+\/jornada$/.test(req.path);

  if (ehConfiguracaoCatalogo && !ehJornadaPropria) {
    return res.status(403).json({
      sucesso: false,
      erro: 'Apenas administradores podem alterar serviços, preços, categorias, profissionais e exceções gerais da clínica.'
    });
  }

  if (perfil === 'PROFISSIONAL') {
    const podeStatusAgendamento = req.method === 'PUT' && /^\/agendamentos\/\d+\/status$/.test(req.path);
    const podeBloqueioProprio =
      (req.method === 'POST' && req.path === '/bloqueios') ||
      (req.method === 'DELETE' && /^\/bloqueios\/\d+$/.test(req.path));
    const podeEvolucaoPaciente = (req.method === 'PUT' || req.method === 'PATCH') && /^\/pacientes\/[^/]+(\/evolucao)?$/.test(req.path);

    if (!podeStatusAgendamento && !podeBloqueioProprio && !ehJornadaPropria && !podeEvolucaoPaciente) {
      return res.status(403).json({
        sucesso: false,
        erro: 'Perfil profissional permite apenas atualizar status e bloqueios da própria agenda, ajustar a própria jornada e registrar evolução clínica do paciente.'
      });
    }
  }

  return next();
}

app.use('/api/usuarios', usuariosRouter);
app.use('/api/dashboard', exigirAutenticacao, exigirPerfil('ADMIN'), dashboardRoutes);
app.get('/api/eventos', exigirAutenticacao, acompanharAlteracoes);
app.use('/api', exigirAutenticacao, controlarPermissoesApi, notificarAlteracoes);
app.use('/api', exigirAutenticacao, controlarPermissoesApi, agendamentosRouter);

async function verificarSaude(_req: express.Request, res: express.Response) {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'OK', banco: 'disponivel', servico: 'Clínica Ikigai' });
  } catch {
    res.status(503).json({ status: 'indisponivel', banco: 'indisponivel', servico: 'Clínica Ikigai' });
  }
}
app.get('/api/health', verificarSaude);

app.use('/api', (_req, res) => {
  res.status(404).json({ sucesso: false, erro: 'Rota não encontrada.' });
});

// Rota de Healthcheck
app.get('/health', verificarSaude);

// O mesmo servidor entrega o site compilado e a API.
const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
app.use(express.static(siteDirectory));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(siteDirectory, 'index.html'), err => { if (err) next(err); });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API]', { codigo: err.code || 'ERRO_INTERNO' });
  res.status(err.status || 500).json({ sucesso: false, erro: 'Não foi possível processar a solicitação.' });
});

// ============================================================================
// INICIALIZACAO
// ============================================================================

async function bootstrap() {
  console.log('[Server] Iniciando servidor da Clinica Ikigai...');
  
  // Testar conexão física com o MySQL
  const dbConnected = await testarConexao();
  
  if (!dbConnected) {
  console.warn('[Server] Banco indisponível. As operações retornarão erro até a conexão ser restabelecida.');
  } else {
    await garantirAdminInicial().catch(() => console.error('[Auth] Não foi possível verificar o administrador inicial.'));
  }

  await registrarCapacidadeHoje().catch(() => console.error('[Capacidade] Não foi possível registrar a capacidade diária.'));
  setInterval(() => { void registrarCapacidadeHoje().catch(() => console.error('[Capacidade] Falha ao registrar capacidade.')); }, 60000).unref();
  app.listen(Number(PORT), process.env.HOST || '127.0.0.1', () => {
    console.log(`[Server] API REST ativa em http://localhost:${PORT}`);
    console.log(`[Server] Healthcheck: http://localhost:${PORT}/health`);
    console.log(`[Security] Helmet ativo | Rate limit: ${process.env.RATE_LIMIT_MAX || 100} req/min | Body limit: 10kb`);
    console.log(`[Security] CORS origins: ${allowedOrigins.join(', ')}`);
  });
}

bootstrap();
