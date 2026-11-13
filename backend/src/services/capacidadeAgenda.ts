import pool, { obterJanelasAgenda } from '../config/database.js';
import { subtrairIntervalos, converterHorarioParaMinutos } from '../utils/validation.js';
let fila: Promise<void> = Promise.resolve();
export function registrarCapacidadeHoje(): Promise<void> {
  fila = fila.catch(() => {}).then(coletarCapacidadeHoje);
  return fila;
}
async function coletarCapacidadeHoje(): Promise<void> {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [datas] = await db.query<any[]>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS data");
    const data = datas[0].data;
    const [profs] = await db.query<any[]>('SELECT id_profissional FROM profissional WHERE ativo=1');
    const [especialidades] = await db.query<any[]>('SELECT id_especialidade FROM especialidade');
    const totais = new Map<number,number>([[-1,0],...especialidades.map(e => [e.id_especialidade,0] as [number,number])]);
    const [vinculos] = await db.query<any[]>('SELECT DISTINCT pp.id_profissional,p.id_especialidade FROM profissional_procedimento pp JOIN procedimento p USING(id_procedimento) WHERE p.ativo=1');
    const [bloqueios] = await db.query<any[]>('SELECT * FROM bloqueio_agenda WHERE data=?',[data]);
    for (const p of profs) {
      const janelas = await obterJanelasAgenda(db,p.id_profissional,data);
      const livres = subtrairIntervalos(janelas,bloqueios.filter(b => b.id_profissional===p.id_profissional).map(b => [converterHorarioParaMinutos(b.horario_inicio),converterHorarioParaMinutos(b.horario_fim)]));
      const minutos = livres.reduce((n,[i,f]) => n+f-i,0);
      totais.set(-1,totais.get(-1)!+minutos);
      for (const v of vinculos.filter(v => v.id_profissional===p.id_profissional)) totais.set(v.id_especialidade,(totais.get(v.id_especialidade)||0)+minutos);
    }
    await db.query('DELETE FROM agenda_capacidade_snapshot WHERE data=?',[data]);
    for (const [esp,minutos] of totais) await db.query('INSERT INTO agenda_capacidade_snapshot(data,especialidade,minutos) VALUES (?,?,?)',[data,esp,minutos]);
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
