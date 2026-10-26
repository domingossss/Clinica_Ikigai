import { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AgendamentoDia {
  id: number;
  data: string;
  horario_inicio: string; // "HH:MM"
  horario_fim: string;    // "HH:MM"
  status: StatusAgendamento;
  paciente_id: string;
  paciente_nome: string;
  paciente_whatsapp: string;
  profissional_id: number;
  profissional_nome: string;
  servico_nome: string;
  duracao_minutos: number;
}

interface Profissional {
  id: number;
  nome: string;
  especialidade?: string;
}

type StatusAgendamento =
  | 'Agendado'
  | 'Confirmado'
  | 'Na Recepção'
  | 'Em Atendimento'
  | 'Concluído'
  | 'Cancelado';

interface Props {
  profissionais: Profissional[];
  dataSelecionada?: string;
  onDataChange?: (novaData: string) => void;
  refreshTrigger?: number;
  onAbrirNovoAgendamento?: (params: {
    data: string;
    horario_inicio: string;
    profissional_id: number;
  }) => void;
  onRefresh?: () => void;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const HORA_INICIO_GRADE = 8;   // 08:00
const HORA_FIM_GRADE = 19;     // 19:00
const ALTURA_POR_MINUTO = 1.4; // px por minuto — define escala vertical

const STATUS_CONFIG: Record<StatusAgendamento, { label: string; cor: string; corTexto: string; corBorda: string }> = {
  Agendado:       { label: 'Agendado',       cor: 'bg-amber-50',   corTexto: 'text-amber-800',  corBorda: 'border-amber-400' },
  Confirmado:     { label: 'Confirmado',     cor: 'bg-blue-50',    corTexto: 'text-blue-800',   corBorda: 'border-blue-400' },
  'Na Recepção':  { label: 'Na Recepção',    cor: 'bg-green-50',   corTexto: 'text-green-800',  corBorda: 'border-green-400' },
  'Em Atendimento': { label: 'Em Atendimento', cor: 'bg-violet-50', corTexto: 'text-violet-800', corBorda: 'border-violet-400' },
  Concluído:      { label: 'Concluído',      cor: 'bg-gray-100',   corTexto: 'text-gray-500',   corBorda: 'border-gray-300' },
  Cancelado:      { label: 'Cancelado',      cor: 'bg-red-50',     corTexto: 'text-red-700',    corBorda: 'border-red-300' },
};

const FLUXO_STATUS: Record<StatusAgendamento, StatusAgendamento[]> = {
  Agendado:         ['Confirmado', 'Na Recepção', 'Cancelado'],
  Confirmado:       ['Na Recepção', 'Cancelado'],
  'Na Recepção':    ['Em Atendimento', 'Cancelado'],
  'Em Atendimento': ['Concluído'],
  Concluído:        [],
  Cancelado:        [],
};

// ─── Funções auxiliares ───────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function formatarDataBR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function diaSemana(dateStr: string): string {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const d = new Date(dateStr + 'T12:00:00');
  return dias[d.getDay()];
}

function dataHoje(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function somarDias(dateStr: string, dias: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function GradeAgenda({
  profissionais,
  dataSelecionada: dataProp,
  onDataChange,
  refreshTrigger,
  onAbrirNovoAgendamento,
  onRefresh
}: Props) {
  const [dataSelecionada, setDataSelecionada] = useState(dataProp || dataHoje());
  const [agendamentos, setAgendamentos] = useState<AgendamentoDia[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Popup de detalhes/status
  const [agendamentoSelecionado, setAgendamentoSelecionado] = useState<AgendamentoDia | null>(null);
  const [atualizandoStatus, setAtualizandoStatus] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);

  const mudarData = (novaData: string) => {
    setDataSelecionada(novaData);
    onDataChange?.(novaData);
  };

  // ─── Busca agenda do dia ────────────────────────────────────────────────────

  const buscarAgenda = useCallback(async (data: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/agendamentos/dia?data=${data}`);
      if (!res.ok) throw new Error('Falha ao buscar agenda.');
      const json = await res.json();
      if (json.sucesso) {
        setAgendamentos(json.dados);
      } else {
        throw new Error(json.erro || 'Erro desconhecido.');
      }
    } catch (e: any) {
      setErro(e.message || 'Erro ao carregar agenda.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (dataProp && dataProp !== dataSelecionada) {
      setDataSelecionada(dataProp);
    }
  }, [dataProp]);

  useEffect(() => {
    buscarAgenda(dataSelecionada);
  }, [dataSelecionada, refreshTrigger, buscarAgenda]);

  // ─── Atualização de status ──────────────────────────────────────────────────

  const atualizarStatus = async (id: number, novoStatus: StatusAgendamento) => {
    setAtualizandoStatus(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/agendamentos/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus }),
      });
      const json = await res.json();
      if (!json.sucesso) throw new Error(json.erro || 'Falha ao atualizar.');

      // Atualiza estado local otimisticamente
      setAgendamentos(prev =>
        prev.map(a => a.id === id ? { ...a, status: novoStatus } : a)
      );
      if (agendamentoSelecionado?.id === id) {
        setAgendamentoSelecionado(prev => prev ? { ...prev, status: novoStatus } : null);
      }

      setMensagemSucesso(`Status alterado para "${novoStatus}"`);
      setTimeout(() => setMensagemSucesso(null), 2500);
      onRefresh?.();
    } catch (e: any) {
      alert('Erro ao atualizar status: ' + (e.message || 'Tente novamente.'));
    } finally {
      setAtualizandoStatus(false);
    }
  };

  // ─── Layout da grade ────────────────────────────────────────────────────────

  const totalMinutos = (HORA_FIM_GRADE - HORA_INICIO_GRADE) * 60;
  const alturaTotal = totalMinutos * ALTURA_POR_MINUTO;

  const slots: string[] = [];
  for (let h = HORA_INICIO_GRADE; h < HORA_FIM_GRADE; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }

  const agendamentosParaProfissional = (profId: number) =>
    agendamentos.filter(a => Number(a.profissional_id) === Number(profId));

  const topParaHorario = (horario: string): number => {
    const mins = timeToMinutes(horario) - HORA_INICIO_GRADE * 60;
    return Math.max(0, mins * ALTURA_POR_MINUTO);
  };

  const alturaParaDuracao = (inicio: string, fim: string): number => {
    const dur = timeToMinutes(fim) - timeToMinutes(inicio);
    return Math.max(30, dur * ALTURA_POR_MINUTO);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl shadow-premium border border-gray/5 overflow-hidden">

      {/* Cabeçalho da grade */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-gray/10 bg-light-gray/30">
        <div>
          <h3 className="text-base font-bold text-dark">Grade de Horários</h3>
          <p className="text-xs text-gray mt-0.5">
            {diaSemana(dataSelecionada)}, {formatarDataBR(dataSelecionada)}
          </p>
        </div>

        {/* Navegação de datas */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => mudarData(somarDias(dataSelecionada, -1))}
            className="p-2 rounded-lg border border-gray/15 hover:bg-light-gray active:scale-95 transition-all text-gray hover:text-dark"
            title="Dia anterior"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button
            onClick={() => mudarData(dataHoje())}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              dataSelecionada === dataHoje()
                ? 'bg-primary text-white border-primary'
                : 'border-gray/15 hover:bg-light-gray text-dark'
            }`}
          >
            Hoje
          </button>

          <input
            type="date"
            value={dataSelecionada}
            onChange={e => mudarData(e.target.value)}
            className="text-xs border border-gray/15 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white text-dark"
          />

          <button
            onClick={() => mudarData(somarDias(dataSelecionada, 1))}
            className="p-2 rounded-lg border border-gray/15 hover:bg-light-gray active:scale-95 transition-all text-gray hover:text-dark"
            title="Próximo dia"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => buscarAgenda(dataSelecionada)}
            className="p-2 rounded-lg border border-gray/15 hover:bg-light-gray active:scale-95 transition-all text-gray hover:text-dark"
            title="Atualizar"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6H16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Legenda de status */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-gray/10 bg-white">
        {(Object.entries(STATUS_CONFIG) as [StatusAgendamento, typeof STATUS_CONFIG[StatusAgendamento]][]).map(([key, cfg]) => (
          <span
            key={key}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${cfg.cor} ${cfg.corTexto} ${cfg.corBorda}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.corBorda.replace('border-', 'bg-')}`} />
            {cfg.label}
          </span>
        ))}
      </div>

      {/* Estado de erro */}
      {erro && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between">
          <span>{erro}</span>
          <button onClick={() => buscarAgenda(dataSelecionada)} className="font-bold underline">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Mensagem de sucesso flutuante */}
      {mensagemSucesso && (
        <div className="mx-6 mt-4 p-3 bg-primary/10 border border-primary/20 rounded-xl text-xs text-primary-dark font-semibold">
          {mensagemSucesso}
        </div>
      )}

      {/* Grade principal */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max">

          {/* Coluna de horas */}
          <div className="w-14 flex-shrink-0 border-r border-gray/10 bg-light-gray/20">
            <div className="h-12 border-b border-gray/10" /> {/* espaço do header */}
            <div className="relative" style={{ height: alturaTotal }}>
              {slots.map((slot, i) => (
                <div
                  key={slot}
                  className="absolute left-0 right-0 flex items-start justify-end pr-2"
                  style={{ top: i * 30 * ALTURA_POR_MINUTO }}
                >
                  <span className="text-[9px] text-gray font-mono -translate-y-2">{slot}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Colunas por profissional */}
          {profissionais.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-white min-h-[350px]">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-dark mb-1">Nenhum profissional cadastrado</h3>
              <p className="text-xs text-gray max-w-sm">
                Cadastre profissionais na aba <strong>Serviços e Configurações</strong> para exibir as colunas de atendimento aqui na grade.
              </p>
            </div>
          ) : (
            profissionais.map(prof => {
              const ags = agendamentosParaProfissional(prof.id);
              return (
              <div key={prof.id} className="flex-1 min-w-52 border-r border-gray/10 last:border-r-0">

                {/* Header do profissional */}
                <div className="h-12 px-3 flex flex-col justify-center border-b border-gray/10 bg-white sticky top-0 z-10">
                  <span className="text-xs font-bold text-dark truncate">{prof.nome}</span>
                  {prof.especialidade && (
                    <span className="text-[9px] text-gray truncate">{prof.especialidade}</span>
                  )}
                </div>

                {/* Área de slots */}
                <div
                  className="relative bg-white"
                  style={{ height: alturaTotal }}
                >
                  {/* Linhas de meia hora */}
                  {slots.map((slot, i) => (
                    <div
                      key={slot}
                      className={`absolute left-0 right-0 border-t ${
                        slot.endsWith(':00') ? 'border-gray/15' : 'border-gray/8 border-dashed'
                      }`}
                      style={{ top: i * 30 * ALTURA_POR_MINUTO }}
                    />
                  ))}

                  {/* Slots clicáveis para novo agendamento */}
                  {slots.map((slot) => {
                    const slotMin = timeToMinutes(slot);
                    const temAgendamento = ags.some(a => {
                      const ini = timeToMinutes(a.horario_inicio);
                      const fim = timeToMinutes(a.horario_fim);
                      return slotMin >= ini && slotMin < fim;
                    });

                    return !temAgendamento ? (
                      <div
                        key={slot}
                        onClick={() =>
                          onAbrirNovoAgendamento?.({
                            data: dataSelecionada,
                            horario_inicio: slot,
                            profissional_id: prof.id,
                          })
                        }
                        className="absolute left-0 right-0 hover:bg-primary/5 cursor-pointer transition-colors group"
                        style={{
                          top: topParaHorario(slot),
                          height: 30 * ALTURA_POR_MINUTO,
                        }}
                        title={`Agendar às ${slot} com ${prof.nome}`}
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] text-primary opacity-0 group-hover:opacity-100 font-semibold transition-opacity">
                          + Agendar {slot}
                        </span>
                      </div>
                    ) : null;
                  })}

                  {/* Blocos de agendamento */}
                  {carregando ? (
                    // Skeleton durante carregamento
                    <div className="absolute inset-x-1 top-4 h-16 bg-gray/10 animate-pulse rounded-xl" />
                  ) : (
                    ags.map(ag => {
                      const cfg = STATUS_CONFIG[ag.status] || STATUS_CONFIG['Agendado'];
                      const top = topParaHorario(ag.horario_inicio);
                      const height = alturaParaDuracao(ag.horario_inicio, ag.horario_fim);
                      const isSelecionado = agendamentoSelecionado?.id === ag.id;

                      return (
                        <div
                          key={ag.id}
                          onClick={() => setAgendamentoSelecionado(isSelecionado ? null : ag)}
                          className={`absolute left-1 right-1 rounded-xl border-l-4 px-2 py-1.5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-px ${cfg.cor} ${cfg.corBorda} ${isSelecionado ? 'ring-2 ring-offset-1 ring-primary/50 shadow-md' : ''}`}
                          style={{ top, height: height - 2, zIndex: isSelecionado ? 20 : 10 }}
                          title={`${ag.paciente_nome} — ${ag.servico_nome}`}
                        >
                          <div className={`text-[10px] font-bold truncate ${cfg.corTexto}`}>
                            {ag.paciente_nome}
                          </div>
                          <div className={`text-[9px] truncate mt-0.5 ${cfg.corTexto} opacity-75`}>
                            {ag.servico_nome}
                          </div>
                          {height > 40 && (
                            <div className={`text-[9px] font-mono mt-0.5 ${cfg.corTexto} opacity-60`}>
                              {ag.horario_inicio} – {ag.horario_fim}
                            </div>
                          )}
                          {height > 55 && (
                            <span className={`inline-block mt-1 px-1.5 py-0.5 rounded-full text-[8px] font-semibold border ${cfg.cor} ${cfg.corTexto} ${cfg.corBorda}`}>
                              {cfg.label}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })
        )}
        </div>
      </div>

      {/* Painel de detalhes do agendamento selecionado */}
      {agendamentoSelecionado && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-gray/15 overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          <div className="bg-dark text-white px-5 py-4 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold">Detalhes do Agendamento</h4>
              <p className="text-[10px] text-white/60 mt-0.5">#{agendamentoSelecionado.id}</p>
            </div>
            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="text-white/70 hover:text-white transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Informações principais */}
            <div className="space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-bold text-dark">{agendamentoSelecionado.paciente_nome}</p>
                  <p className="text-[11px] text-gray font-mono">{agendamentoSelecionado.paciente_whatsapp}</p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_CONFIG[agendamentoSelecionado.status]?.cor} ${STATUS_CONFIG[agendamentoSelecionado.status]?.corTexto} ${STATUS_CONFIG[agendamentoSelecionado.status]?.corBorda}`}>
                  {STATUS_CONFIG[agendamentoSelecionado.status]?.label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-light-gray rounded-lg p-2">
                  <span className="block text-gray text-[9px] uppercase font-bold mb-0.5">Servico</span>
                  <span className="font-semibold text-dark">{agendamentoSelecionado.servico_nome}</span>
                </div>
                <div className="bg-light-gray rounded-lg p-2">
                  <span className="block text-gray text-[9px] uppercase font-bold mb-0.5">Horario</span>
                  <span className="font-semibold text-dark font-mono">
                    {agendamentoSelecionado.horario_inicio} – {agendamentoSelecionado.horario_fim}
                  </span>
                </div>
              </div>

              <div className="bg-light-gray rounded-lg p-2 text-[11px]">
                <span className="block text-gray text-[9px] uppercase font-bold mb-0.5">Profissional</span>
                <span className="font-semibold text-dark">{agendamentoSelecionado.profissional_nome}</span>
              </div>
            </div>

            {/* Ações de status */}
            {FLUXO_STATUS[agendamentoSelecionado.status].length > 0 && (
              <div>
                <p className="text-[10px] uppercase font-bold text-gray mb-2">Avançar status para:</p>
                <div className="flex flex-col gap-1.5">
                  {FLUXO_STATUS[agendamentoSelecionado.status].map(novoStatus => {
                    const cfg = STATUS_CONFIG[novoStatus];
                    const isCancelar = novoStatus === 'Cancelado';
                    return (
                      <button
                        key={novoStatus}
                        disabled={atualizandoStatus}
                        onClick={() => atualizarStatus(agendamentoSelecionado.id, novoStatus)}
                        className={`w-full py-2 px-3 rounded-xl text-xs font-bold border transition-all active:scale-95 disabled:opacity-50 ${
                          isCancelar
                            ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                            : `${cfg.cor} ${cfg.corTexto} ${cfg.corBorda} hover:opacity-80`
                        }`}
                      >
                        {atualizandoStatus ? 'Atualizando...' : cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sem acoes disponiveis */}
            {FLUXO_STATUS[agendamentoSelecionado.status].length === 0 && (
              <p className="text-[11px] text-gray text-center py-2 bg-light-gray rounded-xl">
                Nenhuma ação disponível para este status.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
