import type { RowDataPacket } from 'mysql2';
import { ErroOperacao, type ConsultaBanco } from '../config/database.js';
import { resolverJanelasAgenda, type ExcecaoDia, type JornadaDia } from '../utils/validation.js';

type ConfiguracaoAgenda = JornadaDia & RowDataPacket & { dia_semana: number };
type JornadaProfissional = ConfiguracaoAgenda & { id_profissional: number };
type ExcecaoAgenda = ExcecaoDia & RowDataPacket & { data: string; id_profissional: number | null };
type ReservaExcepcional = boolean | 'existente';
type ResolverJanelas = (profissionalId: number, data: string, excepcional?: ReservaExcepcional) => [number, number][];

export async function carregarJanelasAgenda(banco: ConsultaBanco, ids: number[], datas: string[]): Promise<ResolverJanelas> {
  if (!ids.length || !datas.length) return () => [];
  const dias = [...new Set(datas.map(diaDaSemana))];
  const [jornadas] = await banco.query<JornadaProfissional[]>(
    'SELECT * FROM jornada_profissional WHERE id_profissional IN (?) AND dia_semana IN (?)', [ids, dias]);
  const [excecoes] = await banco.query<ExcecaoAgenda[]>(
    `SELECT e.*, DATE_FORMAT(data, '%Y-%m-%d') AS data FROM excecao_disponibilidade e
     WHERE data IN (?) AND (id_profissional IS NULL OR id_profissional IN (?)) ORDER BY id_excecao`, [datas, ids]);
  const [grade] = await banco.query<ConfiguracaoAgenda[]>('SELECT * FROM expediente_clinica WHERE dia_semana IN (?)', [dias]);
  const jornadasPorDia = new Map(jornadas.map(j => [`${j.id_profissional}:${j.dia_semana}`, j]));
  const excecoesPorDia = new Map(excecoes.map(e => [`${e.id_profissional}:${e.data}`, e]));
  const gradePorDia = new Map(grade.map(g => [g.dia_semana, g]));

  return (profissionalId: number, data: string, excepcional: ReservaExcepcional = false) => {
    const dia = diaDaSemana(data);
    const jornada = jornadasPorDia.get(`${profissionalId}:${dia}`);
    const individual = excecoesPorDia.get(`${profissionalId}:${data}`);
    const local = excecoesPorDia.get(`null:${data}`);
    const expediente = gradePorDia.get(dia);
    const fimDeSemana = dia === 0 || dia === 6;
    const jornadaEfetiva = jornada ?? (excepcional && fimDeSemana
      ? { ativo: true, horario_inicio: '08:00', horario_fim: '18:00' }
      : undefined);
    const profissional = resolverJanelasAgenda(data, jornadaEfetiva, individual);
    const fechada = local ? local.tipo_excecao === 'Fechado' : expediente && !expediente.ativo;
    if (excepcional && fechada) return profissional;
    if (excepcional === true && !fimDeSemana) {
      throw new ErroOperacao(409, 'A reserva excepcional exige um fim de semana ou um dia fechado pela clínica.');
    }
    if (!expediente && !local) return profissional;
    const clinica = resolverJanelasAgenda(data, expediente, local);
    return profissional.flatMap(([a, b]) => clinica.map(([c, d]): [number, number] =>
      [Math.max(a, c), Math.min(b, d)]).filter(([inicio, fim]) => inicio < fim));
  };
}

function diaDaSemana(data: string) {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

export async function obterJanelasAgenda(banco: ConsultaBanco, profissionalId: number, data: string, excepcional: ReservaExcepcional = false) {
  const resolver = await carregarJanelasAgenda(banco, [profissionalId], [data]);
  return resolver(profissionalId, data, excepcional);
}

