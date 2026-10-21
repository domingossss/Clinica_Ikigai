/* =====================================================================
 * CLÍNICA IKIGAI - CONTROLLER DE DASHBOARDS (TYPESCRIPT)
 * Arquivo: backend/src/controllers/dashboardController.ts
 * ===================================================================== */

import { Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { DbAppointmentRow, DbChatbotAbandonedRow, DbSpecialty } from '../types';

export class DashboardController {
  /**
   * Retorna os dados completos (SP, D, AB) do MySQL para alimentar o frontend
   */
  public async getDadosPainel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // 1. Especialidades com preço médio de procedimentos
      const [espRows] = await pool.query<any[]>(`
        SELECT 
          e.id_especialidade,
          e.nome,
          COALESCE(AVG(p.preco_base), 200) AS preco_base
        FROM especialidade e
        LEFT JOIN procedimento p ON e.id_especialidade = p.id_especialidade
        WHERE e.ativo = 1
        GROUP BY e.id_especialidade, e.nome
        ORDER BY e.id_especialidade ASC
      `);

      const SP = espRows.map((e: any, idx: number) => [
        e.nome,
        parseFloat(e.preco_base) || 200,
        idx === 0 ? 25 : idx === 1 ? 20 : idx === 2 ? 18 : idx === 3 ? 17 : 10,
        0.10
      ]);

      // 2. Agendamentos com cálculo dinâmico de dia de deslocamento
      const [agendamentos] = await pool.query<any[]>(`
        SELECT 
          DATEDIFF(CURDATE(), DATE(a.data_hora_agendamento)) AS d,
          CASE 
            WHEN DAYOFWEEK(a.data_hora_agendamento) = 1 THEN 0 
            ELSE DAYOFWEEK(a.data_hora_agendamento) - 1 
          END AS w,
          HOUR(a.data_hora_agendamento) AS h,
          (pr.id_especialidade - 1) AS sp,
          CASE 
            WHEN a.status = 'Realizado' THEN 'R'
            WHEN a.status = 'Cancelado' THEN 'C'
            WHEN a.status = 'No_Show' THEN 'N'
            WHEN a.status = 'Reagendado' THEN 'M'
            ELSE 'R'
          END AS s,
          COALESCE(a.minutos_atraso, 0) AS dl,
          COALESCE(CAST(a.valor_cobrado AS FLOAT), 0) AS pr,
          av.nota_nps AS nt,
          CASE 
            WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data_hora_agendamento) < 18 THEN 0
            WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data_hora_agendamento) BETWEEN 18 AND 30 THEN 1
            WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data_hora_agendamento) BETWEEN 31 AND 45 THEN 2
            WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data_hora_agendamento) BETWEEN 46 AND 60 THEN 3
            ELSE 4
          END AS age,
          pac.sexo AS sx,
          CASE WHEN a.modalidade_pagamento = 'Convenio' THEN 'Convênio' ELSE 'Particular' END AS cv,
          CASE WHEN a.tipo_atendimento = 'Retorno' THEN true ELSE false END AS rt,
          CASE WHEN a.origem = 'Chatbot' THEN true ELSE false END AS bot,
          CASE WHEN a.escalonado_humano = 1 THEN true ELSE false END AS esc
        FROM agendamento a
        JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
        JOIN paciente pac ON a.id_paciente = pac.id_paciente
        LEFT JOIN avaliacao_atendimento av ON a.id_agendamento = av.id_agendamento
        ORDER BY a.data_hora_agendamento DESC
      `);

      // 3. Abandonos diários de conversas no chatbot
      const [abandonos] = await pool.query<any[]>(`
        SELECT 
          DATEDIFF(CURDATE(), DATE(data_hora_inicio)) AS d,
          COUNT(*) AS total_abandonos
        FROM sessao_chatbot
        WHERE status_sessao = 'Abandonada'
        GROUP BY d
      `);

      const AB = new Array(730).fill(0);
      abandonos.forEach((row: any) => {
        if (row.d >= 0 && row.d < 730) {
          AB[row.d] = row.total_abandonos;
        }
      });

      res.json({
        SP,
        D: agendamentos,
        AB
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retorna lista de especialidades ativas
   */
  public async getEspecialidades(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [rows] = await pool.query<any[]>(
        'SELECT id_especialidade, nome FROM especialidade WHERE ativo = 1 ORDER BY id_especialidade ASC'
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
}

export const dashboardController = new DashboardController();
