/* =====================================================================
 * CLÍNICA IKIGAI - SERVIDOR EXPRESS PRINCIPAL (TYPESCRIPT)
 * Arquivo: backend/src/server.ts
 * ===================================================================== */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import dashboardRoutes from './routes/dashboardRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rota de Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    servico: 'API TypeScript - Clínica Ikigai'
  });
});

// Registro de Rotas
app.use('/api/dashboard', dashboardRoutes);

// Rota 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    erro: 'Rota não encontrada',
    caminho: req.originalUrl
  });
});

// Tratamento de Erros Centralizado
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[API Error]', err);
  res.status(err.status || 500).json({
    erro: 'Erro interno no servidor',
    mensagem: process.env.NODE_ENV === 'development' ? err.message : 'Ocorreu um erro ao processar a solicitação.'
  });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Servidor TypeScript rodando na porta ${PORT}`);
  console.log(`  - Health Check: http://localhost:${PORT}/api/health`);
  console.log(`  - Dados Painel: http://localhost:${PORT}/api/dashboard/dados-painel`);
  console.log(`====================================================`);
});
