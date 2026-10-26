import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import agendamentosRouter from './routes/agendamentos.js';
import { testarConexao } from './config/database.js';

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
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false // Necessario para APIs REST
}));

// 2. Rate Limiting: protecao contra brute force e DDoS na camada de aplicacao
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // Janela de 1 minuto
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),              // Max 100 requisicoes por IP
  standardHeaders: true,  // Retorna headers RateLimit-* padrao
  legacyHeaders: false,   // Desabilita headers X-RateLimit-* antigos
  message: {
    sucesso: false,
    erro: 'Limite de requisicoes excedido. Tente novamente em alguns minutos.'
  }
});
app.use(limiter);

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

// 4. Body parser com limite de tamanho (protecao contra payload DoS)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// 5. Desabilitar header X-Powered-By (nao vazar tecnologia do servidor)
app.disable('x-powered-by');

// ============================================================================
// ROTAS DA API
// ============================================================================

// Registro de rotas da API
app.use('/api', agendamentosRouter);

// Rota de Healthcheck
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Servidor da Clinica Ikigai rodando perfeitamente!' });
});

// ============================================================================
// INICIALIZACAO
// ============================================================================

async function bootstrap() {
  console.log('[Server] Iniciando servidor da Clinica Ikigai...');
  
  // Testar conexão física com o MySQL
  const dbConnected = await testarConexao();
  
  if (!dbConnected) {
    console.warn('[Server] Iniciando em modo de contingencia. Verifique o banco MySQL local.');
  }

  app.listen(PORT, () => {
    console.log(`[Server] API REST ativa em http://localhost:${PORT}`);
    console.log(`[Server] Healthcheck: http://localhost:${PORT}/health`);
    console.log(`[Security] Helmet ativo | Rate limit: ${process.env.RATE_LIMIT_MAX || 100} req/min | Body limit: 10kb`);
    console.log(`[Security] CORS origins: ${allowedOrigins.join(', ')}`);
  });
}

bootstrap();
