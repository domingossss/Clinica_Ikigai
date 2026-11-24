import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import pool, { ErroOperacao, executarTransacao, type ConsultaBanco } from '../config/database.js';
import { carregarJanelasAgenda, obterJanelasAgenda } from './janelasAgenda.js';
import { calcularHorarioTermino, horarioCabeNasJanelas } from '../utils/validation.js';

// O bloqueio por profissional protege inclusive a primeira reserva do dia.
export async function transacaoAgenda<T>(ids: number[] | null, executar: (conexao: PoolConnection) => Promise<T>): Promise<T> {
  return executarTransacao(async conexao => {
    if (ids === null) {
      await conexao.query('SELECT id_profissional FROM profissional ORDER BY id_profissional FOR UPDATE');
    } else {
      for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        const [rows] = await conexao.query<RowDataPacket[]>('SELECT id_profissional FROM profissional WHERE id_profissional = ? FOR UPDATE', [id]);
        if (!rows.length) throw new ErroOperacao(404, 'Profissional não encontrado.');
      }
    }
    return executar(conexao);
  });
}

export async function validarReserva(banco: ConsultaBanco, profissionalId: number, servicoId: number, data: string, inicio: string, ignorarId = 0, excepcional = false) {
  const [profissionais] = await banco.query<any[]>('SELECT ativo FROM profissional WHERE id_profissional = ?', [profissionalId]);
  if (!profissionais.length || !profissionais[0].ativo) throw new ErroOperacao(400, 'Profissional inativo ou não cadastrado.');
  const [servicos] = await banco.query<any[]>('SELECT * FROM procedimento WHERE id_procedimento = ? FOR SHARE', [servicoId]);
  if (!servicos.length || !servicos[0].ativo) throw new ErroOperacao(400, 'Procedimento inativo ou não cadastrado.');
  const [vinculos] = await banco.query<any[]>('SELECT 1 FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?', [profissionalId, servicoId]);
  if (!vinculos.length) throw new ErroOperacao(400, 'Profissional não habilitado para este procedimento.');
  const duracao = Number(servicos[0].duracao_minutos);
  if (!Number.isInteger(duracao) || duracao <= 0) throw new ErroOperacao(400, 'Duração do procedimento inválida.');
  const fim = calcularHorarioTermino(inicio, duracao);
  const janelas = await obterJanelasAgenda(banco, profissionalId, data, excepcional);
  if (!horarioCabeNasJanelas(inicio, fim, janelas)) throw new ErroOperacao(409, 'Horário fora da jornada disponível, intervalo ou exceção da data (incluindo 15 minutos de respiro).');
  const [conflitos] = await banco.query<any[]>(
    "SELECT id_agendamento FROM agendamento WHERE id_profissional = ? AND data = ? AND id_agendamento <> ? AND status <> 'Cancelado' AND ? < horario_fim AND horario_inicio < ?",
    [profissionalId, data, ignorarId, inicio, fim]);
  if (conflitos.length) throw new ErroOperacao(409, 'Conflito de agenda. O horário já está reservado.');
  const [bloqueios] = await banco.query<any[]>(
    'SELECT id_bloqueio FROM bloqueio_agenda WHERE id_profissional = ? AND data = ? AND ? < horario_fim AND horario_inicio < ?', [profissionalId, data, inicio, fim]);
  if (bloqueios.length) throw new ErroOperacao(409, 'Horário bloqueado na agenda.');
  return { fim, preco: Number(servicos[0].preco) };
}
export async function gravarHistorico(conexao: PoolConnection, agendamento: { id_agendamento: number; status: string }, status: string, usuario: { id: number; nome: string } | undefined, atualizar: () => Promise<unknown>, motivo: string, horarios?: { anterior: string; novo: string }) {
  const tipo = status === 'Cancelado' ? 'CANCELAMENTO' : status === 'Reagendado' ? 'REAGENDAMENTO' : 'STATUS';
  const ocorrencias = [horarios?.anterior ?? null, horarios?.novo ?? null];
  const autor = usuario?.nome ?? 'Sistema';
  const [anteriores] = await conexao.query<any[]>('SELECT COALESCE(MAX(id_historico), 0) AS ultimo FROM historico_status_agendamento WHERE id_agendamento = ?', [agendamento.id_agendamento]);
  await atualizar();
  // Reaproveita o registro gerado pelo gatilho. Se o banco legado não tiver o gatilho,
  // registra na mesma transação, sem perder nem duplicar a auditoria.
  const [novos] = await conexao.query<any[]>('SELECT id_historico FROM historico_status_agendamento WHERE id_agendamento = ? AND id_historico > ? ORDER BY id_historico DESC LIMIT 1', [agendamento.id_agendamento, anteriores[0].ultimo]);
  if (novos.length) {
    await conexao.query('UPDATE historico_status_agendamento SET motivo = ?, tipo_evento = ?, alterado_por = ?, id_usuario = ?, ocorrencia_anterior = ?, ocorrencia_nova = ? WHERE id_historico = ?', [motivo, tipo, autor, usuario?.id ?? null, ...ocorrencias, novos[0].id_historico]);
  } else {
    await conexao.query('INSERT INTO historico_status_agendamento (id_agendamento, status_anterior, status_novo, motivo, tipo_evento, alterado_por, id_usuario, ocorrencia_anterior, ocorrencia_nova) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [agendamento.id_agendamento, agendamento.status, status, motivo, tipo, autor, usuario?.id ?? null, ...ocorrencias]);
  }
}
export const motivoReservaExcepcional = 'Reserva confirmada pelo profissional em dia fechado';

export function reservaExcepcionalNaOcorrencia(alias: string): string {
  return `EXISTS (
    SELECT 1 FROM historico_status_agendamento AS criacao
    WHERE criacao.id_agendamento = ${alias}.id_agendamento AND criacao.tipo_evento = 'CRIACAO'
      AND criacao.motivo = '${motivoReservaExcepcional}'
      AND NOT EXISTS (SELECT 1 FROM historico_status_agendamento AS mudanca
        WHERE mudanca.id_agendamento = criacao.id_agendamento AND mudanca.tipo_evento = 'REAGENDAMENTO')
  )`;
}

export async function verificarAgendaAposConfiguracao(conexao: PoolConnection, profissionalId: number | null, data?: string, diasDaSemana?: number[]) {
  const params: unknown[] = [];
  let filtro = "status IN ('Agendado', 'Confirmado', 'Reagendado', 'Na Recepção', 'Em Atendimento')";
  if (profissionalId !== null) { filtro += ' AND id_profissional = ?'; params.push(profissionalId); }
  if (data) { filtro += ' AND data = ?'; params.push(data); } else { filtro += ' AND data >= CURDATE()'; }
  if (diasDaSemana?.length) { filtro += ' AND DAYOFWEEK(data) - 1 IN (?)'; params.push(diasDaSemana); }
  const [agendamentos] = await conexao.query<any[]>(`SELECT id_agendamento, id_profissional, DATE_FORMAT(data, '%Y-%m-%d') AS data,
    horario_inicio, horario_fim, ${reservaExcepcionalNaOcorrencia('a')} AS excepcional FROM agendamento a WHERE ${filtro}`, params);
  const resolver = await carregarJanelasAgenda(conexao,
    [...new Set(agendamentos.map(ag => Number(ag.id_profissional)))],
    [...new Set(agendamentos.map(ag => String(ag.data)))]);
  for (const ag of agendamentos) {
    const janelas = resolver(ag.id_profissional, ag.data, ag.excepcional ? 'existente' : false);
    if (!horarioCabeNasJanelas(ag.horario_inicio, ag.horario_fim, janelas)) throw new ErroOperacao(409, 'A configuração conflita com o agendamento #' + ag.id_agendamento + '. Reagende ou cancele o atendimento primeiro.');
  }
}
export async function profissionalDoAgendamento(id: number) {
  const [rows] = await pool.query<any[]>('SELECT id_profissional FROM agendamento WHERE id_agendamento = ?', [id]);
  if (!rows.length) throw new ErroOperacao(404, 'Agendamento não encontrado.');
  return Number(rows[0].id_profissional);
}
