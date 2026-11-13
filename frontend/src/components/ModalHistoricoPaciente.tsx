import { useClinicUpdates } from '../services/clinicUpdates';
import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export interface AtendimentoHistorico {
  id: number;
  data: string; // YYYY-MM-DD
  horario_inicio: string; // HH:MM
  horario_fim: string; // HH:MM
  status: string;
  tipo_atendimento?: string;
  observacoes?: string;
  origem?: string;
  valor_cobrado?: string | number;
  servico_id: number;
  servico_nome: string;
  duracao_minutos: number;
  servico_preco?: string | number;
  categoria_nome?: string;
  profissional_id: number;
  profissional_nome: string;
  profissional_especialidade?: string;
  criado_em: string;
}

export interface PacienteHistoricoInfo {
  id: string;
  id_paciente?: number;
  nome_completo: string;
  cpf?: string;
  telefone?: string;
  whatsapp?: string;
  endereco?: string;
  etapa_tratamento?: string;
  criado_em?: string;
}

interface ModalHistoricoPacienteProps {
  isOpen: boolean;
  onClose: () => void;
  pacienteId: string | null;
  pacienteNome?: string;
  onNovoAgendamento?: (pacienteId: string) => void;
}

const STATUS_BADGES: Record<string, { label: string; corFundo: string; corTexto: string; corBorda: string }> = {
  Realizado:       { label: 'Realizado',       corFundo: 'bg-emerald-50 text-emerald-800 border-emerald-300', corTexto: 'text-emerald-700', corBorda: 'border-emerald-500' },
  Concluído:      { label: 'Concluído',      corFundo: 'bg-emerald-50 text-emerald-800 border-emerald-300', corTexto: 'text-emerald-700', corBorda: 'border-emerald-500' },
  Agendado:       { label: 'Agendado',       corFundo: 'bg-amber-50 text-amber-800 border-amber-300',     corTexto: 'text-amber-700',   corBorda: 'border-amber-500' },
  Confirmado:     { label: 'Confirmado',     corFundo: 'bg-blue-50 text-blue-800 border-blue-300',       corTexto: 'text-blue-700',    corBorda: 'border-blue-500' },
  'Na Recepção':  { label: 'Na Recepção',    corFundo: 'bg-teal-50 text-teal-800 border-teal-300',       corTexto: 'text-teal-700',    corBorda: 'border-teal-500' },
  'Em Atendimento': { label: 'Em Atendimento', corFundo: 'bg-purple-50 text-purple-800 border-purple-300', corTexto: 'text-purple-700',  corBorda: 'border-purple-500' },
  Cancelado:      { label: 'Cancelado',      corFundo: 'bg-rose-50 text-rose-800 border-rose-300',       corTexto: 'text-rose-700',    corBorda: 'border-rose-500' },
  Reagendado:     { label: 'Reagendado',     corFundo: 'bg-orange-50 text-orange-800 border-orange-300', corTexto: 'text-orange-700',  corBorda: 'border-orange-500' },
  No_Show:        { label: 'Não Compareceu', corFundo: 'bg-zinc-100 text-zinc-700 border-zinc-300',     corTexto: 'text-zinc-600',    corBorda: 'border-zinc-400' },
};

function formatarDataBR(dataStr: string): string {
  if (!dataStr) return '';
  const [ano, mes, dia] = dataStr.split('-');
  return `${dia}/${mes}/${ano}`;
}

function obterDiaSemana(dataStr: string): string {
  if (!dataStr) return '';
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const d = new Date(dataStr + 'T12:00:00');
  return dias[d.getDay()] || '';
}

function formatarCPF(cpf?: string): string {
  if (!cpf) return '';
  const limpo = cpf.replace(/\D/g, '');
  if (limpo.length !== 11) return cpf;
  return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
}

export default function ModalHistoricoPaciente(props: ModalHistoricoPacienteProps) {
  return props.isOpen && props.pacienteId ? <HistoricoPaciente key={props.pacienteId} {...props} /> : null;
}

function HistoricoPaciente({
  isOpen,
  onClose,
  pacienteId,
  pacienteNome,
  onNovoAgendamento
}: ModalHistoricoPacienteProps) {
  const [carregando, setCarregando] = useState<boolean>(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pacienteInfo, setPacienteInfo] = useState<PacienteHistoricoInfo | null>(null);
  const [historico, setHistorico] = useState<AtendimentoHistorico[]>([]);
  const [ordem, setOrdem] = useState<'DESC' | 'ASC'>('DESC');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');

  // Carregar histórico da API
  const consultaHistorico = useRef<AbortController | null>(null);
  const carregarHistorico = useCallback(() => {
    if (!pacienteId) return;

    consultaHistorico.current?.abort();
    const controller = new AbortController();
    consultaHistorico.current = controller;

    return fetch(`${API_BASE_URL}/api/pacientes/${encodeURIComponent(pacienteId)}/historico?ordem=${ordem}`, { signal: controller.signal }).then(async res => {
      
      let data: { sucesso?: boolean; erro?: string; dados?: { paciente: PacienteHistoricoInfo; historico: AtendimentoHistorico[] } } | null = null;
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      }

      if (!res.ok) {
        throw new Error(data?.erro || `Erro HTTP ${res.status}: Não foi possível obter o histórico do paciente.`);
      }

      if (!data?.sucesso) {
        throw new Error(data?.erro || 'Falha ao buscar histórico do paciente.');
      }

      if (controller.signal.aborted) return;
      setErro(null);
      setPacienteInfo(data.dados?.paciente || null);
      setHistorico(Array.isArray(data.dados?.historico) ? data.dados.historico : []);
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      setPacienteInfo(null);
      setHistorico([]);
      console.error('Erro ao consultar histórico:', err);
      setErro((err instanceof Error ? err.message : '') || 'Erro de comunicação com o servidor.');
    }).finally(() => {
      if (!controller.signal.aborted) setCarregando(false);
    });
  }, [pacienteId, ordem]);

  useEffect(() => {
    void carregarHistorico();
    return () => consultaHistorico.current?.abort();
  }, [carregarHistorico]);

  useClinicUpdates(() => { if (isOpen && pacienteId) void carregarHistorico(); }, ['pacientes', 'agendamentos', 'servicos', 'categorias', 'profissionais']);

  if (!isOpen) return null;

  // Filtragem local por status se selecionado
  const historicoFiltrado = historico.filter(item => {
    if (filtroStatus === 'TODOS') return true;
    if (filtroStatus === 'REALIZADOS') {
      return item.status === 'Realizado' || item.status === 'Concluído';
    }
    if (filtroStatus === 'AGENDADOS') {
      return item.status === 'Agendado' || item.status === 'Confirmado' || item.status === 'Na Recepção' || item.status === 'Em Atendimento';
    }
    if (filtroStatus === 'CANCELADOS') {
      return item.status === 'Cancelado' || item.status === 'No_Show' || item.status === 'Reagendado';
    }
    return true;
  });

  const totalAtendimentos = historico.length;
  const totalRealizados = historico.filter(h => h.status === 'Realizado' || h.status === 'Concluído').length;
  const totalFuturos = historico.filter(h => h.status === 'Agendado' || h.status === 'Confirmado').length;
  const totalCancelados = historico.filter(h => h.status === 'Cancelado' || h.status === 'No_Show').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-gray/10 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* HEADER */}
        <div className="p-6 border-b border-gray/10 bg-gradient-to-r from-light-gray/60 via-white to-light-gray/30 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary-dark font-extrabold text-lg shadow-sm">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-extrabold text-dark tracking-tight">
                  {pacienteInfo?.nome_completo || pacienteNome || 'Paciente'}
                </h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary-dark border border-primary/20">
                  Histórico de Atendimentos
                </span>
              </div>

              {/* Detalhes do paciente */}
              <div className="flex items-center gap-3 mt-1 text-xs text-gray flex-wrap">
                {pacienteInfo?.cpf && (
                  <span className="font-mono bg-light-gray px-2 py-0.5 rounded-md border border-gray/10">
                    CPF: {formatarCPF(pacienteInfo.cpf)}
                  </span>
                )}
                {(pacienteInfo?.whatsapp || pacienteInfo?.telefone) && (
                  <span className="font-mono bg-light-gray px-2 py-0.5 rounded-md border border-gray/10 flex items-center gap-1">
                    <span>WhatsApp:</span>
                    <span className="font-bold text-dark">{pacienteInfo.whatsapp || pacienteInfo.telefone}</span>
                  </span>
                )}
                {pacienteInfo?.etapa_tratamento && (
                  <span className="bg-light-gray px-2 py-0.5 rounded-md border border-gray/10">
                    Etapa: <strong className="text-dark">{pacienteInfo.etapa_tratamento}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-gray hover:text-dark hover:bg-light-gray rounded-xl transition-all cursor-pointer"
            title="Fechar (Esc)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* SUB-HEADER / CONTROLES DE FILTRO E ORDENAÇÃO (CA01) */}
        {!carregando && !erro && historico.length > 0 && (
          <div className="px-6 py-3 bg-light-gray/40 border-b border-gray/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Filtros rápidos por status */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-gray font-bold text-[11px] mr-1">Filtrar:</span>
              <button
                onClick={() => setFiltroStatus('TODOS')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  filtroStatus === 'TODOS'
                    ? 'bg-dark text-white shadow-sm'
                    : 'bg-white text-gray hover:text-dark border border-gray/10'
                }`}
              >
                Todos ({totalAtendimentos})
              </button>
              <button
                onClick={() => setFiltroStatus('REALIZADOS')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  filtroStatus === 'REALIZADOS'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                Realizados ({totalRealizados})
              </button>
              <button
                onClick={() => setFiltroStatus('AGENDADOS')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  filtroStatus === 'AGENDADOS'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-blue-800 border border-blue-200 hover:bg-blue-50'
                }`}
              >
                Futuros ({totalFuturos})
              </button>
              <button
                onClick={() => setFiltroStatus('CANCELADOS')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  filtroStatus === 'CANCELADOS'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-white text-rose-800 border border-rose-200 hover:bg-rose-50'
                }`}
              >
                Cancelados ({totalCancelados})
              </button>
            </div>

            {/* Alternância de Ordenação Cronológica (CA01) */}
            <div className="flex items-center gap-2">
              <span className="text-gray text-[11px] font-bold">Ordem cronológica:</span>
              <button
                onClick={() => setOrdem(prev => (prev === 'DESC' ? 'ASC' : 'DESC'))}
                className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-light-gray rounded-lg border border-gray/15 font-bold text-dark transition-all shadow-sm cursor-pointer"
                title="Clique para alternar entre ordem mais recente ou mais antiga"
              >
                <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {ordem === 'DESC' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
                  )}
                </svg>
                <span>{ordem === 'DESC' ? 'Mais recentes primeiro' : 'Mais antigos primeiro'}</span>
              </button>
            </div>
          </div>
        )}

        {/* CORPO DO HISTÓRICO */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          
          {/* ESTADO: CARREGANDO */}
          {carregando && (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
              <p className="text-xs font-bold text-gray animate-pulse">
                Carregando histórico do paciente...
              </p>
            </div>
          )}

          {/* ESTADO: ERRO */}
          {!carregando && erro && (
            <div className="py-12 px-6 bg-rose-50 border border-rose-200 rounded-2xl flex flex-col items-center text-center gap-3">
              <div className="h-10 w-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold text-lg">
                !
              </div>
              <div>
                <h4 className="text-sm font-bold text-rose-800">Falha ao obter histórico</h4>
                <p className="text-xs text-rose-600 mt-1 max-w-md">{erro}</p>
              </div>
              <button
                onClick={() => { void carregarHistorico(); }}
                className="mt-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
              >
                Tentar Novamente
              </button>
            </div>
          )}

          {/* ESTADO: CA03 — SEM HISTÓRICO (Empty state informativo) */}
          {!carregando && !erro && historico.length === 0 && (
            <div className="py-16 px-6 text-center flex flex-col items-center justify-center gap-4 bg-light-gray/30 rounded-3xl border border-dashed border-gray/20">
              <div className="h-16 w-16 rounded-3xl bg-secondary/20 text-primary-dark flex items-center justify-center shadow-inner">
                <svg className="w-8 h-8 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="max-w-md">
                <h4 className="text-base font-extrabold text-dark">Nenhum atendimento registrado</h4>
                <p className="text-xs text-gray mt-1 leading-relaxed">
                  Este paciente ainda não possui atendimentos ou agendamentos registrados no histórico da clínica.
                </p>
              </div>

              {onNovoAgendamento && (
                <button
                  onClick={() => {
                    onClose();
                    onNovoAgendamento(pacienteId!);
                  }}
                  className="mt-2 bg-primary hover:bg-primary-dark text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md shadow-primary/20 hover:shadow-primary/30 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Agendar Primeiro Atendimento</span>
                </button>
              )}
            </div>
          )}

          {/* ESTADO: LISTA DE ATENDIMENTOS (CA01 e CA02) */}
          {!carregando && !erro && historico.length > 0 && historicoFiltrado.length === 0 && (
            <div className="py-12 text-center text-xs text-gray font-semibold">
              Nenhum atendimento com o filtro selecionado ({filtroStatus}).
            </div>
          )}

          {!carregando && !erro && historicoFiltrado.length > 0 && (
            <div className="space-y-3">
              {historicoFiltrado.map((atendimento, index) => {
                const statusBadge = STATUS_BADGES[atendimento.status] || {
                  label: atendimento.status,
                  corFundo: 'bg-gray/10 text-dark border-gray/20',
                  corTexto: 'text-dark',
                  corBorda: 'border-gray/30'
                };

                return (
                  <div
                    key={atendimento.id || index}
                    className={`bg-white rounded-2xl p-4 sm:p-5 border border-gray/10 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4 ${statusBadge.corBorda}`}
                  >
                    {/* COLUNA ESQUERDA: Data, Horário e Procedimento (CA02) */}
                    <div className="flex items-start gap-4 flex-1">
                      {/* Badge Data */}
                      <div
                        className="flex flex-col items-center justify-center bg-light-gray border border-gray/10 rounded-2xl p-2.5 min-w-[72px] text-center shadow-xs"
                        title={`Data: ${formatarDataBR(atendimento.data)} (${obterDiaSemana(atendimento.data)})`}
                      >
                        <span className="text-[10px] font-extrabold uppercase text-gray tracking-wider">
                          {obterDiaSemana(atendimento.data).slice(0, 3)}
                        </span>
                        <span className="text-base font-black text-dark font-mono leading-none my-0.5">
                          {atendimento.data.split('-')[2]}
                        </span>
                        <span className="text-[10px] font-bold text-gray font-mono">
                          {atendimento.data.split('-')[1]}/{atendimento.data.split('-')[0].slice(2)}
                        </span>
                      </div>

                      {/* Informações detalhadas do atendimento */}
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-extrabold text-dark leading-snug">
                            {atendimento.servico_nome}
                          </h4>
                          {atendimento.categoria_nome && (
                            <span className="text-[10px] font-bold bg-secondary/15 text-primary-dark px-2 py-0.5 rounded-full border border-secondary/25">
                              {atendimento.categoria_nome}
                            </span>
                          )}
                        </div>

                        {/* Profissional e Horário */}
                        <div className="flex items-center gap-3 text-xs text-gray flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-dark flex items-center gap-1">
                              <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              {atendimento.profissional_nome}
                            </span>
                            {atendimento.profissional_especialidade && (
                              <span className="text-[11px] text-gray/80 hidden sm:inline">
                                ({atendimento.profissional_especialidade})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 font-mono text-[11px] bg-light-gray/70 px-2 py-0.5 rounded-md border border-gray/10">
                            <svg className="w-3 h-3 text-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{atendimento.horario_inicio} às {atendimento.horario_fim}</span>
                            <span className="text-gray/50">({atendimento.duracao_minutos} min)</span>
                          </div>
                        </div>

                        {atendimento.observacoes && <p className="text-xs whitespace-pre-wrap">{atendimento.observacoes}</p>}
                        {/* Informações adicionais contextuais */}
                        <div className="flex items-center gap-2 pt-0.5 text-[10px] text-gray flex-wrap">
                          {atendimento.tipo_atendimento && (
                            <span className="bg-light-gray px-1.5 py-0.5 rounded border border-gray/10 font-semibold">
                              {atendimento.tipo_atendimento.replace('_', ' ')}
                            </span>
                          )}
                          {atendimento.origem && (
                            <span className="bg-light-gray px-1.5 py-0.5 rounded border border-gray/10 font-semibold">
                              Canal: {atendimento.origem.replace('_', ' ')}
                            </span>
                          )}
                          {atendimento.valor_cobrado && Number(atendimento.valor_cobrado) > 0 && (
                            <span className="font-mono font-bold text-dark bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200">
                              R$ {Number(atendimento.valor_cobrado).toFixed(2).replace('.', ',')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* COLUNA DIREITA: Situação / Status do Atendimento (CA02) */}
                    <div className="flex items-center md:flex-col md:items-end justify-between gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-gray/5">
                      <span className={`text-[11px] font-extrabold px-3 py-1 rounded-full border shadow-xs ${statusBadge.corFundo}`}>
                        {statusBadge.label}
                      </span>
                      <span className="text-[10px] text-gray font-mono">
                        Agendamento #{atendimento.id}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* FOOTER DO MODAL */}
        <div className="p-4 sm:p-5 border-t border-gray/10 bg-light-gray/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-gray text-[11px] flex items-center gap-3">
            <span>
              Total exibido: <strong className="text-dark">{historicoFiltrado.length}</strong> de <strong className="text-dark">{totalAtendimentos}</strong> registros
            </span>
            <span className="text-gray/30">•</span>
            <span className="text-gray/70">Ordem: {ordem === 'DESC' ? 'Cronológica decrescente' : 'Cronológica crescente'}</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {onNovoAgendamento && (
              <button
                onClick={() => {
                  onClose();
                  onNovoAgendamento(pacienteId!);
                }}
                className="bg-primary hover:bg-primary-dark text-white font-bold text-xs px-4 py-2 rounded-xl transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Novo Agendamento</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="bg-white hover:bg-light-gray text-dark font-bold text-xs px-4 py-2 rounded-xl border border-gray/15 transition-all shadow-xs cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
