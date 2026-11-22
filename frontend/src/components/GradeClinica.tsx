import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../api';

interface Dia { dia_semana: number; ativo: boolean | number; horario_inicio: string; horario_fim: string; intervalo_inicio: string | null; intervalo_fim: string | null }
const nomes = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
export default function GradeClinica() {
  const [dias, setDias] = useState<Dia[]>([]);
  const [aviso, setAviso] = useState('');
  const [dia, selecionar] = useState(1);
  const [pronto, setPronto] = useState(false);
  const [salvando, salvar] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    apiFetch('/api/expediente-clinica', {signal:abort.signal}).then(async res => {
      if (!res.ok) throw Error();
      setDias((await res.json()).dados);
      setPronto(true);
    }).catch(() => { if (!abort.signal.aborted) setAviso('Falha ao carregar o expediente.'); });
    return () => abort.abort();
  }, []);
  const atual = dias.find(d => d.dia_semana === dia);
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const campos = new FormData(e.currentTarget);
    const registro = { ...Object.fromEntries(campos), dia_semana:dia, ativo:campos.has('ativo'), intervalo_inicio:campos.get('intervalo_inicio') || null, intervalo_fim:campos.get('intervalo_fim') || null };
    salvar(true);
    try {
      const res = await apiFetch('/api/expediente-clinica',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(registro)});
      if (!res.ok) throw Error((await res.json()).erro);
      setDias(anterior => [...anterior.filter(d => d.dia_semana !== dia), registro as Dia]);
      setAviso('Expediente salvo.');
    } catch (err) { setAviso(err instanceof Error ? err.message : 'Falha ao salvar expediente.'); }
    finally { salvar(false); }
  }
  return <section className="bg-white p-5 rounded-xl my-4 space-y-3">
    <h2 className="font-bold">Expediente semanal da clínica</h2>
    <label>Dia da semana <select disabled={salvando} value={dia} onChange={e => selecionar(Number(e.target.value))}>{nomes.map((nome,i) => <option key={nome} value={i}>{nome}</option>)}</select></label>
    {pronto && <form key={dia} onSubmit={enviar} className="flex flex-wrap items-center gap-4">
      <label><input name="ativo" type="checkbox" defaultChecked={atual ? !!atual.ativo : true} /> Clínica aberta</label>
      {([['horario_inicio','Abertura'],['horario_fim','Fechamento'],['intervalo_inicio','Início da pausa'],['intervalo_fim','Fim da pausa']] as const).map(([campo,rotulo]) =>
        <label key={campo}>{rotulo} <input type="time" name={campo} defaultValue={atual?.[campo]?.slice(0,5) ?? (campo === 'horario_inicio' ? '08:00' : campo === 'horario_fim' ? '18:00' : '')} /></label>)}
      <button disabled={salvando}>Salvar dia</button></form>}
    {!atual && pronto && <p>Dia sem grade global configurada. Vale a jornada de cada profissional.</p>}
    <p role="status">{aviso}</p>
  </section>;
}
