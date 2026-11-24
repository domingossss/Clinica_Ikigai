import type { RowDataPacket } from 'mysql2/promise';
import { executarTransacao } from '../config/database.js';
import { carregarJanelasAgenda } from './janelasAgenda.js';
import { converterHorarioParaMinutos, subtrairIntervalos } from '../utils/validation.js';

interface VinculoEspecialidade extends RowDataPacket {
  id_profissional: number;
  id_especialidade: number;
}

interface BloqueioCapacidade extends RowDataPacket {
  id_profissional: number;
  horario_inicio: string;
  horario_fim: string;
}

const TOTAL_CLINICA = -1;
let emCurso: Promise<void> | null = null;
let recalcular = false;

export function registrarCapacidadeHoje(): Promise<void> {
  recalcular = true;
  emCurso ??= processarAtualizacoes();
  return emCurso;
}

async function processarAtualizacoes(): Promise<void> {
  try {
    do {
      recalcular = false;
      await coletarCapacidadeHoje();
    } while (recalcular);
  } finally {
    emCurso = null;
  }
}

async function coletarCapacidadeHoje(): Promise<void> {
  await executarTransacao(async conexao => {
    const [datas] = await conexao.query<(RowDataPacket & { data: string })[]>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS data");
    const data = datas[0].data;
    const [profissionais] = await conexao.query<(RowDataPacket & { id_profissional: number })[]>('SELECT id_profissional FROM profissional WHERE ativo=1');
    const [especialidades] = await conexao.query<(RowDataPacket & { id_especialidade: number })[]>('SELECT id_especialidade FROM especialidade');
    const [vinculos] = await conexao.query<VinculoEspecialidade[]>(
      'SELECT DISTINCT pp.id_profissional,p.id_especialidade FROM profissional_procedimento pp JOIN procedimento p USING(id_procedimento) WHERE p.ativo=1'
    );
    const [bloqueios] = await conexao.query<BloqueioCapacidade[]>(
      'SELECT id_profissional, horario_inicio, horario_fim FROM bloqueio_agenda WHERE data=?', [data]
    );
    const totais = new Map<number, number>(especialidades.map(especialidade => [especialidade.id_especialidade, 0]));
    totais.set(TOTAL_CLINICA, 0);

    const especialidadesPorProfissional = new Map<number, number[]>();
    for (const vinculo of vinculos) {
      const especialidades = especialidadesPorProfissional.get(vinculo.id_profissional) ?? [];
      especialidades.push(vinculo.id_especialidade);
      especialidadesPorProfissional.set(vinculo.id_profissional, especialidades);
    }
    const bloqueiosPorProfissional = new Map<number, [number, number][]>();
    for (const bloqueio of bloqueios) {
      const intervalos = bloqueiosPorProfissional.get(bloqueio.id_profissional) ?? [];
      intervalos.push([converterHorarioParaMinutos(bloqueio.horario_inicio), converterHorarioParaMinutos(bloqueio.horario_fim)]);
      bloqueiosPorProfissional.set(bloqueio.id_profissional, intervalos);
    }
    const resolver = await carregarJanelasAgenda(conexao, profissionais.map(p => p.id_profissional), [data]);
    for (const { id_profissional: id } of profissionais) {
      const livres = subtrairIntervalos(resolver(id, data), bloqueiosPorProfissional.get(id) ?? []);
      const minutos = livres.reduce((total, [inicio, fim]) => total + fim - inicio, 0);
      totais.set(TOTAL_CLINICA, (totais.get(TOTAL_CLINICA) ?? 0) + minutos);
      for (const especialidade of especialidadesPorProfissional.get(id) ?? []) {
        totais.set(especialidade, (totais.get(especialidade) ?? 0) + minutos);
      }
    }

    const [linhas] = await conexao.query<(RowDataPacket & { especialidade: number; minutos: number })[]>(
      'SELECT especialidade, minutos FROM agenda_capacidade_snapshot WHERE data = ?', [data]);
    const anteriores = new Map(linhas.map(linha => [linha.especialidade, Number(linha.minutos)]));
    const removidas = [...anteriores.keys()].filter(especialidade => !totais.has(especialidade));
    const alteradas = [...totais].filter(([especialidade, minutos]) => anteriores.get(especialidade) !== minutos);
    if (removidas.length) {
      await conexao.query('DELETE FROM agenda_capacidade_snapshot WHERE data = ? AND especialidade IN (?)', [data, removidas]);
    }
    if (alteradas.length) {
      await conexao.query(`INSERT INTO agenda_capacidade_snapshot(data, especialidade, minutos) VALUES ?
        ON DUPLICATE KEY UPDATE minutos = VALUES(minutos)`, [alteradas.map(([especialidade, minutos]) => [data, especialidade, minutos])]);
    }
  });
}
