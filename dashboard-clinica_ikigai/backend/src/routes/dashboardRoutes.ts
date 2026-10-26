/* =====================================================================
 * CLÍNICA IKIGAI - ROTAS DE DASHBOARD (TYPESCRIPT)
 * Arquivo: backend/src/routes/dashboardRoutes.ts
 * ===================================================================== */

import { Router } from 'express';
import { dashboardController } from '../controllers/dashboardController';

const router = Router();

// Rota para alimentação completa do painel (SP, D, AB vindos do MySQL)
router.get('/dados-painel', (req, res, next) => dashboardController.getDadosPainel(req, res, next));

// Rota de listagem de especialidades ativas
router.get('/especialidades', (req, res, next) => dashboardController.getEspecialidades(req, res, next));

export default router;
