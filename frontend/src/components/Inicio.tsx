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

  const proximos = atendimentos
    .filter(
      a =>
        a.horario_inicio >= horaClinica.format(agora) &&
        ['Agendado', 'Reagendado', 'Confirmado', 'Na Recepção'].includes(a.status)
    )
    .sort((a, b) => a.horario_inicio.localeCompare(b.horario_inicio) || a.id - b.id);

  return (
    <div className="space-y-6">
      {/* Cabeçalho padronizado da aba Início */}
      <div className="bg-white rounded-2xl shadow-premium border border-gray/10 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-gray/10 bg-light-gray/30">
          <div>
            <h1 className="text-base font-bold text-dark flex items-center gap-2">
              <span className="p-1.5 bg-primary/10 rounded-lg text-primary text-xs font-bold">
                Início
              </span>
              Resumo do dia
            </h1>
            <p className="text-xs text-gray mt-0.5 capitalize">
              {agora.toLocaleDateString('pt-BR', { timeZone: fuso, dateStyle: 'full' })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onAbrirAgenda ? (
              <button
                type="button"
                onClick={onAbrirAgenda}
                className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-primary text-white hover:bg-primary-dark transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <span>Abrir agenda</span>
                <span aria-hidden="true">→</span>
              </button>
            ) : (
              <a
                className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-primary text-white hover:bg-primary-dark transition-all shadow-sm flex items-center gap-1.5"
                href="/agendamentos"
              >
                <span>Abrir agenda</span>
                <span aria-hidden="true">→</span>
              </a>
            )}
          </div>
        </div>

        {estado === 'carregando' ? (
          <p className="p-8 text-center text-xs text-gray font-semibold" role="status">
            Carregando atendimentos…
          </p>
        ) : estado === 'erro' ? (
          <p className="p-6 bg-red-50 text-xs text-red-800 flex items-center justify-between" role="alert">
            <span className="font-semibold">Falha ao consultar a agenda.</span>
            <button
              type="button"
              onClick={atualizar}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 cursor-pointer"
            >
              Tentar novamente
            </button>
          </p>
        ) : atendimentos.length === 0 ? (
          <p className="p-6 text-xs text-gray text-center">
            Nenhum atendimento programado para hoje.
          </p>
        ) : (
          <div className="p-6 space-y-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray/15 bg-light-gray/30 p-4">
                <dt className="text-xs font-semibold text-gray">Atendimentos do dia</dt>
                <dd className="mt-1.5 text-2xl font-extrabold text-primary">{atendimentos.length}</dd>
              </div>
              <div className="rounded-xl border border-gray/15 bg-light-gray/30 p-4">
                <dt className="text-xs font-semibold text-gray">Aguardando confirmação</dt>
                <dd className="mt-1.5 text-2xl font-extrabold text-primary">
                  {atendimentos.filter(a => a.status === 'Agendado').length}
                </dd>
              </div>
            </dl>

            <section className="rounded-xl border border-gray/15 bg-white overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray/10 bg-light-gray/30">
                <h2 className="text-sm font-bold text-dark">Próximos atendimentos</h2>
              </div>

              {proximos.length === 0 ? (
                <p className="p-6 text-xs text-gray text-center">Nenhum próximo atendimento hoje.</p>
              ) : (
                <ul className="divide-y divide-gray/10">
                  {proximos.map(a => (
                    <li
                      key={a.id}
                      className="flex items-start gap-3.5 px-5 py-3.5 hover:bg-light-gray/30 transition-colors"
                    >
                      <time className="rounded-lg bg-secondary-light px-2.5 py-1 text-xs font-bold text-primary-dark">
                        {a.horario_inicio}
                      </time>
                      <div>
                        <strong className="text-xs font-bold text-dark block">
                          {a.paciente_nome}
                        </strong>
                        <p className="text-[11px] text-gray mt-0.5">
                          {a.servico_nome} · {a.profissional_nome}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
