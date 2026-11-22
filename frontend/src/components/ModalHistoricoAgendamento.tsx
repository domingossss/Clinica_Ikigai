import { apiFetch } from '../api';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useClinicUpdates } from '../services/clinicUpdates';


export interface AlteracaoAgendamento {
  id: number;
  id_agendamento: number;
  status_anterior: string | null;
  status_novo: string;
  tipo_evento: 'CRIACAO' | 'REAGENDAMENTO' | 'CANCELAMENTO' | 'STATUS' | null;
  motivo: string | null;
  alterado_por: string;
  data_alteracao: string;
}

interface AgendamentoResumo {
  id: number;
  data: string;
  horario_inicio: string;
  horario_fim: string;
  status: string;
  origem?: string;
  criado_em?: string;
  paciente_nome: string;
  profissional_nome: string;
  servico_nome: string;
}

interface ModalHistoricoAgendamentoProps {
  isOpen: boolean;
  onClose: () => void;
  agendamentoId: number | null;
}

const STATUS_BADGES: Record<string, string> = {
  Realizado:        'bg-emerald-50 text-emerald-800 border-emerald-300',
  Concluído:        'bg-emerald-50 text-emerald-800 border-emerald-300',
  Agendado:         'bg-amber-50 text-amber-800 border-amber-300',
  Confirmado:       'bg-blue-50 text-blue-800 border-blue-300',
  'Na Recepção':    'bg-teal-50 text-teal-800 border-teal-300',
  'Em Atendimento': 'bg-purple-50 text-purple-800 border-purple-300',
  Cancelado:        'bg-rose-50 text-rose-800 border-rose-300',
  Reagendado:       'bg-orange-50 text-orange-800 border-orange-300',
  No_Show:          'bg-zinc-100 text-zinc-700 border-zinc-300',
};

function formatarStatusLabel(status: string | null): string {
  if (!status) return 'Inicial';
  if (status === 'No_Show') return 'Não Compareceu';
  return status;
}

function formatarDataHoraBR(isoStr?: string): string {
  if (!isoStr) return '—';
  const [dataParte, horaParte] = isoStr.split('T');
  if (!dataParte) return isoStr;
  const [ano, mes, dia] = dataParte.split('-');
  const hora = horaParte ? horaParte.slice(0, 5) : '';
  return hora ? `${dia}/${mes}/${ano} às ${hora}` : `${dia}/${mes}/${ano}`;
}

function formatarDataBR(dataStr?: string): string {
  if (!dataStr) return '';
  const [ano, mes, dia] = dataStr.split('-');
  return `${dia}/${mes}/${ano}`;
}

export default function ModalHistoricoAgendamento(props: ModalHistoricoAgendamentoProps) {
  return props.isOpen && props.agendamentoId ? (
    <HistoricoAgendamentoConteudo key={props.agendamentoId} {...props} />
  ) : null;
}

function HistoricoAgendamentoConteudo({
  onClose,
  agendamentoId,
}: ModalHistoricoAgendamentoProps) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [agendamento, setAgendamento] = useState<AgendamentoResumo | null>(null);
  const [historico, setHistorico] = useState<AlteracaoAgendamento[]>([]);
  const consulta = useRef<AbortController | null>(null);

  const carregarHistorico = useCallback(async () => {
    if (!agendamentoId) return;
    consulta.current?.abort();
    const controller = new AbortController();
    consulta.current = controller;
    return apiFetch(`/api/agendamentos/${agendamentoId}/historico`, { signal: controller.signal }).then(async res => {
      const json = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Não foi possível carregar o histórico do agendamento.');
      }
      setAgendamento(json.dados.agendamento);
      setHistorico(json.dados.historico || []);
      setErro(null);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setErro(err instanceof Error ? err.message : 'Erro de comunicação ao buscar histórico.');
    }).finally(() => {
      if (!controller.signal.aborted) setCarregando(false);
    });
  }, [agendamentoId]);

  useEffect(() => {
    void carregarHistorico();
    return () => consulta.current?.abort();
  }, [carregarHistorico]);

  useClinicUpdates(carregarHistorico, ['agendamentos']);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-dark/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-historico-agendamento"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray/15 w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="bg-dark text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h3 id="titulo-historico-agendamento" className="text-base font-bold">
              Histórico de Alterações do Agendamento
            </h3>
            <p className="text-xs text-white/70 mt-0.5">
              Agendamento #{agendamentoId}
              {agendamento ? ` · ${agendamento.paciente_nome}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico do agendamento"
            className="text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Resumo do agendamento */}
        {agendamento && (
          <div className="px-6 py-3 bg-light-gray border-b border-gray/15 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div>
              <span className="block text-[10px] uppercase font-bold text-gray">Serviço</span>
              <span className="font-semibold text-dark">{agendamento.servico_nome}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-gray">Profissional</span>
              <span className="font-semibold text-dark">{agendamento.profissional_nome}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-gray">Data / Horário</span>
              <span className="font-semibold text-dark font-mono">
                {formatarDataBR(agendamento.data)} · {agendamento.horario_inicio}–{agendamento.horario_fim}
              </span>
            </div>
          </div>
        )}

        {/* Corpo */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {carregando && (
            <p className="text-sm text-gray text-center py-8" role="status">
              Carregando histórico de alterações...
            </p>
          )}

          {!carregando && erro && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-4 flex items-center justify-between gap-3">
              <span>{erro}</span>
              <button
                type="button"
                onClick={() => { setCarregando(true); void carregarHistorico(); }}
                className="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 font-bold transition-colors cursor-pointer"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {!carregando && !erro && historico.length === 0 && (
            <div className="bg-light-gray rounded-xl p-6 text-center space-y-1">
              <p className="text-sm font-semibold text-dark">Nenhuma alteração registrada ainda</p>
              <p className="text-xs text-gray">
                O histórico deste atendimento ainda não contém eventos.
              </p>
            </div>
          )}

          {!carregando && !erro && historico.length > 0 && (
            <ol className="relative border-l-2 border-primary/30 ml-3 space-y-4">
              {historico.map(item => (
                <li key={item.id} className="ml-5 relative">
                  <span className="absolute -left-[27px] top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-white shadow-xs" />
                  <div className="bg-light-gray rounded-xl p-3.5 border border-gray/15 space-y-2">
                    <strong className="text-xs">{item.tipo_evento ? ({ CRIACAO: 'Criação', REAGENDAMENTO: 'Reagendamento', CANCELAMENTO: 'Cancelamento', STATUS: 'Alteração de status' })[item.tipo_evento] : 'Registro de histórico'}</strong>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold">
                        <span className={`px-2 py-0.5 rounded-full border ${STATUS_BADGES[item.status_anterior || ''] || 'bg-white text-gray border-gray/30'}`}>
                          {formatarStatusLabel(item.status_anterior)}
                        </span>
                        <span className="text-gray">→</span>
                        <span className={`px-2 py-0.5 rounded-full border ${STATUS_BADGES[item.status_novo] || 'bg-white text-dark border-gray/30'}`}>
                          {formatarStatusLabel(item.status_novo)}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray font-mono">
                        {formatarDataHoraBR(item.data_alteracao)}
                      </span>
                    </div>

                    {item.motivo && (
                      <p className="text-xs text-dark">{item.motivo}</p>
                    )}

                    <p className="text-[11px] text-gray">
                      Alterado por: <span className="font-semibold text-dark">{item.alterado_por || 'Sistema'}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-6 py-3.5 border-t border-gray/15 bg-light-gray/60 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-dark text-white hover:opacity-90 transition-opacity cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
