import type { Request, Response, NextFunction } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '../config/database.js';

interface EspecialidadeIndicadores extends RowDataPacket {
  id_especialidade: number;
  nome: string;
  preco_base: string;
}

interface AgendamentoIndicadores extends RowDataPacket {
  id_especialidade: number;
  pr: string;
  dl: number;
  minutos: string;
  rt: number;
  bot: number;
  esc: number;
}

interface CapacidadeIndicadores extends RowDataPacket {
  d: number;
  especialidade: number;
  minutos: number;
}

interface ConversaIndicadores extends RowDataPacket {
  d: number;
  iniciadas: number;
  agendadas: string;
  resolvidas: string;
  abandonadas: string;
}

export class DashboardController {
  public async getDadosPainel(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [hoje] = await pool.query<(RowDataPacket & { data: string })[]>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS data");
      const referencia = hoje[0].data;
      const [[especialidades], [agendamentos], [capacidade], [conversas]] = await Promise.all([
        pool.query<EspecialidadeIndicadores[]>(
          'SELECT e.id_especialidade, e.nome, COALESCE(AVG(p.preco), 0) AS preco_base FROM especialidade e LEFT JOIN procedimento p ON p.id_especialidade = e.id_especialidade GROUP BY e.id_especialidade, e.nome ORDER BY e.id_especialidade'
        ),
        pool.query<AgendamentoIndicadores[]>(
          `SELECT DATEDIFF(?, a.data) AS d, DAYOFWEEK(a.data) - 1 AS w,
            HOUR(a.horario_inicio) AS h, pr.id_especialidade,
            CASE WHEN a.status IN ('Realizado', 'Concluído') THEN 'R'
                 WHEN a.status = 'Cancelado' THEN 'C' WHEN a.status = 'No_Show' THEN 'N'
                 WHEN a.status = 'Reagendado' THEN 'M' ELSE 'A' END AS s,
            IF(reag.id_agendamento IS NOT NULL, 1, 0) AS reagendado,
            (a.data_hora_inicio_atendimento IS NOT NULL OR a.minutos_atraso > 0) AS atraso_registrado, a.minutos_atraso AS dl, a.valor_cobrado AS pr, av.nota_nps AS nt,
            CASE WHEN pac.data_nascimento IS NULL THEN -1
                 WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data) < 18 THEN 0
                 WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data) <= 30 THEN 1
                 WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data) <= 45 THEN 2
                 WHEN TIMESTAMPDIFF(YEAR, pac.data_nascimento, a.data) <= 60 THEN 3 ELSE 4 END AS age,
            pac.sexo AS sx, CASE WHEN a.modalidade_pagamento = 'Convenio' THEN 'Convênio' ELSE 'Particular' END AS cv,
            a.tipo_atendimento = 'Retorno' AS rt, a.origem = 'Chatbot' AS bot, a.escalonado_humano AS esc,
            GREATEST(0, TIME_TO_SEC(TIMEDIFF(a.horario_fim, a.horario_inicio)) / 60) AS minutos
           FROM agendamento a
           JOIN procedimento pr ON pr.id_procedimento = a.id_procedimento
           JOIN paciente pac ON pac.uuid = a.paciente_uuid
           LEFT JOIN avaliacao_atendimento av ON av.id_agendamento = a.id_agendamento
           LEFT JOIN (
             SELECT DISTINCT id_agendamento
             FROM historico_status_agendamento
             WHERE status_novo = 'Reagendado'
           ) reag ON reag.id_agendamento = a.id_agendamento
           WHERE a.data BETWEEN DATE_SUB(?, INTERVAL 729 DAY) AND ?
           ORDER BY a.data DESC, a.horario_inicio DESC`, [referencia, referencia, referencia]
        ),
        pool.query<CapacidadeIndicadores[]>(
          'SELECT DATEDIFF(?, data) AS d, especialidade, minutos FROM agenda_capacidade_snapshot WHERE data BETWEEN DATE_SUB(?, INTERVAL 729 DAY) AND ?',
          [referencia, referencia, referencia]
        ),
        pool.query<ConversaIndicadores[]>(
          `SELECT DATEDIFF(?, DATE(data_hora_inicio)) AS d, COUNT(*) AS iniciadas,
            SUM(status_sessao = 'Agendamento_Concluido') AS agendadas,
            SUM(status_sessao IN ('Agendamento_Concluido', 'Duvida_Resolvida') AND escalonado_humano = 0) AS resolvidas,
            SUM(status_sessao = 'Abandonada') AS abandonadas
           FROM sessao_chatbot
           WHERE data_hora_inicio >= DATE_SUB(?, INTERVAL 729 DAY)
             AND data_hora_inicio < DATE_ADD(?, INTERVAL 1 DAY)
           GROUP BY d`, [referencia, referencia, referencia]
        ),
      ]);
      const indices = new Map<number, number>(especialidades.map((e, i) => [e.id_especialidade, i]));
      const SP = especialidades.map(e => [e.nome, Number(e.preco_base), 0, 0, e.id_especialidade]);
      const D = agendamentos.map(row => ({ ...row, sp: indices.get(row.id_especialidade),
        pr: Number(row.pr), dl: Number(row.dl), minutos: Number(row.minutos),
        rt: Boolean(row.rt), bot: Boolean(row.bot), esc: Boolean(row.esc) }));
      const CA = capacidade.map(c => ({d:Number(c.d),sp:c.especialidade === -1 ? -1 : indices.get(c.especialidade),minutos:Number(c.minutos)})).filter(c => c.sp !== undefined);
      const AB = Array<number>(730).fill(0);
      const CHAT = conversas.map(conversa => {
        const d = Number(conversa.d);
        if (d >= 0 && d < AB.length) AB[d] = Number(conversa.abandonadas);
        return { d, iniciadas: Number(conversa.iniciadas), agendadas: Number(conversa.agendadas), resolvidas: Number(conversa.resolvidas) };
      });
      res.json({ SP, D, AB, CA, CHAT, referencia });
    } catch (erro) {
      next(erro);
    }
  }

  public async getEspecialidades(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [rows] = await pool.query('SELECT id_especialidade, nome FROM especialidade WHERE ativo = 1 ORDER BY id_especialidade');
      res.json(rows);
    } catch (erro) { next(erro); }
  }
}
export const dashboardController = new DashboardController();
