import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { useClinicUpdates } from '../services/clinicUpdates';

interface Atendimento {
  id: number;
  horario_inicio: string;
  paciente_nome: string;
  profissional_nome: string;
  servico_nome: string;
  status: string;
}
const fuso = 'America/Sao_Paulo';
const dataClinica = new Intl.DateTimeFormat('sv-SE', { timeZone: fuso });
const horaClinica = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export default function Inicio({ onAbrirAgenda }: { onAbrirAgenda?: () => void }) {
  const [agora, setAgora] = useState(() => new Date());
  const dia = dataClinica.format(agora);
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>([]);
  const [consulta, setConsulta] = useState<{ dia: string; estado: 'ok' | 'erro' } | null>(null);
  const estado = consulta?.dia === dia ? consulta.estado : 'carregando';
  const [revisao, setRevisao] = useState(0);
  const atualizar = useCallback(() => setRevisao(v => v + 1), []);
  useClinicUpdates(atualizar, ['agendamentos', 'pacientes', 'profissionais', 'servicos']);
  useEffect(() => {
    const timer = setInterval(() => setAgora(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      try {
        const res = await apiFetch('/api/agendamentos/dia?data=' + dia, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!controller.signal.aborted) {
          setAtendimentos(json.dados);
          setConsulta({ dia, estado: 'ok' });
        }
      } catch {
        if (!controller.signal.aborted) setConsulta({ dia, estado: 'erro' });
      }
    }
    void carregar();
    return () => controller.abort();
  }, [dia, revisao]);

  const proximos = atendimentos.filter(a => a.horario_inicio >= horaClinica.format(agora) &&
    ['Agendado', 'Reagendado', 'Confirmado', 'Na Recepção'].includes(a.status)).sort((a,b) => a.horario_inicio.localeCompare(b.horario_inicio) || a.id - b.id);
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border-t-4 border-secondary bg-primary px-6 py-7 text-white shadow-premium sm:px-8">
      <div><p className="mb-2 text-sm capitalize text-secondary-light">{agora.toLocaleDateString('pt-BR', { timeZone: fuso, dateStyle: 'full' })}</p>
      <h1 className="text-3xl font-bold tracking-tight">Resumo do dia</h1></div>
      {onAbrirAgenda ? (
        <button type="button" onClick={onAbrirAgenda} className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-primary hover:bg-secondary-light cursor-pointer">Abrir agenda <span aria-hidden="true">→</span></button>
      ) : (
        <a className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-primary hover:bg-secondary-light" href="/agendamentos">Abrir agenda <span aria-hidden="true">→</span></a>
      )}
    </header>
    {estado === 'carregando' ? <p className="rounded-2xl border border-gray/10 bg-white p-6 text-gray shadow-premium" role="status">Carregando atendimentos…</p>
      : estado === 'erro' ? <p className="rounded-2xl bg-red-50 p-6 text-red-800" role="alert">Falha ao consultar a agenda. <button onClick={atualizar}>Tentar novamente</button></p>
      : atendimentos.length === 0 ? <p className="rounded-2xl border border-gray/10 bg-white p-6 text-gray shadow-premium">Nenhum atendimento programado para hoje.</p>
      : <>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray/10 bg-white p-5 shadow-premium"><dt className="text-sm font-semibold text-gray">Atendimentos do dia</dt><dd className="mt-2 text-3xl font-bold text-primary">{atendimentos.length}</dd></div>
          <div className="rounded-2xl border border-gray/10 bg-white p-5 shadow-premium"><dt className="text-sm font-semibold text-gray">Aguardando confirmação</dt><dd className="mt-2 text-3xl font-bold text-primary">{atendimentos.filter(a => a.status === 'Agendado').length}</dd></div>
        </dl>
        <section className="rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6"><h2 className="mb-3 text-lg font-bold text-primary">Próximos atendimentos</h2>
        {proximos.length === 0 ? <p>Nenhum próximo atendimento hoje.</p> : <ul className="divide-y divide-gray/10">{proximos.map(a =>
          <li key={a.id} className="flex items-start gap-4 py-4"><time className="rounded-lg bg-secondary-light px-3 py-1 text-sm font-bold text-primary-dark">{a.horario_inicio}</time><div><strong>{a.paciente_nome}</strong><p className="mt-1 text-sm text-gray">{a.servico_nome} · {a.profissional_nome}</p></div></li>
        )}</ul>}</section>
      </>}
  </div>;
}
