import { useState, useEffect, useCallback } from 'react';
import ModalHistoricoPaciente from './ModalHistoricoPaciente';

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

interface BloqueioDia {
  id: number;
  profissional_id: number;
  data: string;
  horario_inicio: string; // "HH:MM"
  horario_fim: string;    // "HH:MM"
  motivo: string;
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
  | 'Cancelado'
  | 'Reagendado';

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
  Reagendado:     { label: 'Reagendado',     cor: 'bg-orange-50',  corTexto: 'text-orange-800', corBorda: 'border-orange-400' },
};

const FLUXO_STATUS: Record<StatusAgendamento, StatusAgendamento[]> = {
  Agendado:         ['Confirmado', 'Na Recepção', 'Cancelado'],
  Confirmado:       ['Na Recepção', 'Cancelado'],
  'Na Recepção':    ['Em Atendimento', 'Cancelado'],
  'Em Atendimento': ['Concluído'],
  Concluído:        [],
  Cancelado:        [],
  Reagendado:       ['Confirmado', 'Na Recepção', 'Cancelado'],
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
  const [bloqueios, setBloqueios] = useState<BloqueioDia[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Popup de detalhes/status do agendamento
  const [agendamentoSelecionado, setAgendamentoSelecionado] = useState<AgendamentoDia | null>(null);
  const [atualizandoStatus, setAtualizandoStatus] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);

  // Popup de detalhes do bloqueio
  const [bloqueioSelecionado, setBloqueioSelecionado] = useState<BloqueioDia | null>(null);
  const [removendoBloqueio, setRemovendoBloqueio] = useState(false);

  // Modal de Reagendamento (IK-85)
  const [isReagendarModalOpen, setIsReagendarModalOpen] = useState(false);
  const [reagendarData, setReagendarData] = useState(dataHoje());
  const [reagendarHorario, setReagendarHorario] = useState('08:00');
  const [reagendarMotivo, setReagendarMotivo] = useState('');
  const [reagendando, setReagendando] = useState(false);
  const [reagendarErro, setReagendarErro] = useState<string | null>(null);

  // Modal de Bloqueio de Horário (IK-87)
  const [isBloquearModalOpen, setIsBloquearModalOpen] = useState(false);
  const [bloqueioProfissionalId, setBloqueioProfissionalId] = useState<number>(profissionais[0]?.id || 1);
  const [bloqueioData, setBloqueioData] = useState(dataHoje());
  const [bloqueioInicio, setBloqueioInicio] = useState('12:00');
  const [bloqueioFim, setBloqueioFim] = useState('13:00');
  const [bloqueioMotivo, setBloqueioMotivo] = useState('Almoço / Intervalo');
  const [bloqueando, setBloqueando] = useState(false);
  const [bloqueioErro, setBloqueioErro] = useState<string | null>(null);

  // Modal de Histórico do Paciente (IK-77)
  const [isHistoricoModalOpen, setIsHistoricoModalOpen] = useState(false);

  const mudarData = (novaData: string) => {
    setDataSelecionada(novaData);
    onDataChange?.(novaData);
  };

  // ─── Busca agenda do dia (Agendamentos e Bloqueios) ─────────────────────────

  const buscarAgenda = useCallback(async (data: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/agendamentos/dia?data=${data}`);
      if (!res.ok) throw new Error('Falha ao buscar agenda.');
      const json = await res.json();
      if (json.sucesso) {
        setAgendamentos(json.dados || []);
        setBloqueios(json.bloqueios || []);
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

  // Atualiza default do profissional no modal de bloqueio se houver profissionais
  useEffect(() => {
    if (profissionais.length > 0 && !bloqueioProfissionalId) {
      setBloqueioProfissionalId(profissionais[0].id);
    }
  }, [profissionais, bloqueioProfissionalId]);

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

  // ─── Ação de Reagendamento (IK-85) ──────────────────────────────────────────

  const handleConfirmarReagendamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agendamentoSelecionado) return;

    setReagendando(true);
    setReagendarErro(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/agendamentos/${agendamentoSelecionado.id}/reagendar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: reagendarData,
          horario_inicio: reagendarHorario,
          motivo: reagendarMotivo || 'Reagendado via grade de horários'
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || json.detalhes || 'Falha ao reagendar atendimento.');
      }

      setMensagemSucesso(`Atendimento reagendado com sucesso para ${formatarDataBR(reagendarData)} às ${reagendarHorario}!`);
      setTimeout(() => setMensagemSucesso(null), 3500);

      setIsReagendarModalOpen(false);
      setAgendamentoSelecionado(null);

      // Se mudou de data, navega para a nova data
      if (reagendarData !== dataSelecionada) {
        mudarData(reagendarData);
      } else {
        buscarAgenda(dataSelecionada);
      }

      onRefresh?.();
    } catch (err: any) {
      setReagendarErro(err.message || 'Erro ao reagendar atendimento.');
    } finally {
      setReagendando(false);
    }
  };

  // ─── Ação de Criar Bloqueio (IK-87) ─────────────────────────────────────────

  const handleCriarBloqueio = async (e: React.FormEvent) => {
    e.preventDefault();
    setBloqueando(true);
    setBloqueioErro(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/bloqueios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profissional_id: bloqueioProfissionalId,
          data: bloqueioData,
          horario_inicio: bloqueioInicio,
          horario_fim: bloqueioFim,
          motivo: bloqueioMotivo
        })
      });

      const json = await res.json();

      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Falha ao bloquear horário.');
      }

      setMensagemSucesso(`Horário bloqueado com sucesso (${bloqueioInicio} às ${bloqueioFim})!`);
      setTimeout(() => setMensagemSucesso(null), 3000);

      setIsBloquearModalOpen(false);

      if (bloqueioData !== dataSelecionada) {
        mudarData(bloqueioData);
      } else {
        buscarAgenda(dataSelecionada);
      }

      onRefresh?.();
    } catch (err: any) {
      setBloqueioErro(err.message || 'Erro ao criar bloqueio.');
    } finally {
      setBloqueando(false);
    }
  };

  // ─── Ação de Remover Bloqueio (IK-87) ───────────────────────────────────────

  const handleRemoverBloqueio = async (bloqueioId: number) => {
    if (!confirm('Deseja realmente remover este bloqueio e liberar o horário para atendimentos?')) {
      return;
    }

    setRemovendoBloqueio(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/bloqueios/${bloqueioId}`, {
        method: 'DELETE'
      });
      const json = await res.json();

      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Falha ao remover bloqueio.');
      }

      setMensagemSucesso('Bloqueio removido! O horário está novamente disponível.');
      setTimeout(() => setMensagemSucesso(null), 3000);

      setBloqueioSelecionado(null);
      buscarAgenda(dataSelecionada);
      onRefresh?.();
    } catch (err: any) {
      alert('Erro ao remover bloqueio: ' + (err.message || 'Tente novamente.'));
    } finally {
      setRemovendoBloqueio(false);
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

  const bloqueiosParaProfissional = (profId: number) =>
    bloqueios.filter(b => Number(b.profissional_id) === Number(profId));

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

        {/* Ações e Navegação de datas */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Botão Bloquear Horário (IK-87) */}
          <button
            onClick={() => {
              setBloqueioData(dataSelecionada);
              setBloqueioProfissionalId(profissionais[0]?.id || 1);
              setBloqueioErro(null);
              setIsBloquearModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 text-white hover:bg-gray-700 active:scale-95 transition-all shadow-sm"
            title="Bloquear Horário na Grade"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Bloquear Horário</span>
          </button>

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
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-gray/10 bg-white items-center">
        {(Object.entries(STATUS_CONFIG) as [StatusAgendamento, typeof STATUS_CONFIG[StatusAgendamento]][]).map(([key, cfg]) => (
          <span
            key={key}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${cfg.cor} ${cfg.corTexto} ${cfg.corBorda}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.corBorda.replace('border-', 'bg-')}`} />
            {cfg.label}
          </span>
        ))}
        {/* Indicador de Bloqueio de Horário na Legenda */}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border bg-gray-100 text-gray-700 border-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
          🔒 Bloqueado (Indisponível)
        </span>
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
              const bls = bloqueiosParaProfissional(prof.id);

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

                  {/* Slots clicáveis para novo agendamento (apenas se livres de agendamentos e bloqueios) */}
                  {slots.map((slot) => {
                    const slotMin = timeToMinutes(slot);
                    const temAgendamento = ags.some(a => {
                      const ini = timeToMinutes(a.horario_inicio);
                      const fim = timeToMinutes(a.horario_fim);
                      return slotMin >= ini && slotMin < fim;
                    });
                    const temBloqueio = bls.some(b => {
                      const ini = timeToMinutes(b.horario_inicio);
                      const fim = timeToMinutes(b.horario_fim);
                      return slotMin >= ini && slotMin < fim;
                    });

                    return (!temAgendamento && !temBloqueio) ? (
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

                  {/* Blocos de Bloqueio de Horário (IK-87) */}
                  {bls.map(bl => {
                    const top = topParaHorario(bl.horario_inicio);
                    const height = alturaParaDuracao(bl.horario_inicio, bl.horario_fim);
                    const isSelecionado = bloqueioSelecionado?.id === bl.id;

                    return (
                      <div
                        key={`bloqueio-${bl.id}`}
                        onClick={() => {
                          setAgendamentoSelecionado(null);
                          setBloqueioSelecionado(isSelecionado ? null : bl);
                        }}
                        className={`absolute left-1 right-1 rounded-xl border-l-4 border-gray-600 bg-gray-100/95 px-2 py-1.5 cursor-pointer transition-all hover:shadow-md ${isSelecionado ? 'ring-2 ring-gray-600 shadow-md' : ''}`}
                        style={{ top, height: height - 2, zIndex: isSelecionado ? 25 : 15 }}
                        title={`Horário Bloqueado: ${bl.motivo} (${bl.horario_inicio} - ${bl.horario_fim})`}
                      >
                        <div className="text-[10px] font-bold text-gray-800 flex items-center gap-1 truncate">
                          <span>🔒</span>
                          <span className="truncate">{bl.motivo || 'Horário Bloqueado'}</span>
                        </div>
                        <div className="text-[9px] font-mono text-gray-600 mt-0.5">
                          {bl.horario_inicio} – {bl.horario_fim}
                        </div>
                        {height > 50 && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-gray-200 text-gray-700">
                            Indisponível
                          </span>
                        )}
                      </div>
                    );
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
                          onClick={() => {
                            setBloqueioSelecionado(null);
                            setAgendamentoSelecionado(isSelecionado ? null : ag);
                          }}
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

            {/* Botão de Reagendamento (IK-85) */}
            {agendamentoSelecionado.status !== 'Cancelado' && (
              <button
                onClick={() => {
                  setReagendarData(agendamentoSelecionado.data || dataSelecionada);
                  setReagendarHorario(agendamentoSelecionado.horario_inicio);
                  setReagendarMotivo('');
                  setReagendarErro(null);
                  setIsReagendarModalOpen(true);
                }}
                className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-primary/30 bg-primary/10 text-primary-dark hover:bg-primary/20 transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Reagendar Atendimento</span>
              </button>
            )}

            {/* Botão Visualizar Histórico do Paciente (IK-77) */}
            <button
              onClick={() => setIsHistoricoModalOpen(true)}
              className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-secondary/40 bg-secondary/15 text-primary-dark hover:bg-secondary/25 transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Ver Histórico do Paciente</span>
            </button>

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
            {FLUXO_STATUS[agendamentoSelecionado.status].length === 0 && agendamentoSelecionado.status === 'Cancelado' && (
              <p className="text-[11px] text-gray text-center py-2 bg-light-gray rounded-xl">
                Atendimento cancelado.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Painel de detalhes do bloqueio selecionado (IK-87) */}
      {bloqueioSelecionado && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-gray-300 overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          <div className="bg-gray-800 text-white px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">🔒</span>
              <div>
                <h4 className="text-sm font-bold">Horário Bloqueado</h4>
                <p className="text-[10px] text-white/60">#{bloqueioSelecionado.id}</p>
              </div>
            </div>
            <button
              onClick={() => setBloqueioSelecionado(null)}
              className="text-white/70 hover:text-white transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 text-xs">
              <div>
                <span className="block text-gray text-[9px] uppercase font-bold">Motivo do Bloqueio</span>
                <span className="font-bold text-dark text-sm">{bloqueioSelecionado.motivo}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200">
                <div>
                  <span className="block text-gray text-[9px] uppercase font-bold">Horário</span>
                  <span className="font-mono font-semibold text-dark">
                    {bloqueioSelecionado.horario_inicio} – {bloqueioSelecionado.horario_fim}
                  </span>
                </div>
                <div>
                  <span className="block text-gray text-[9px] uppercase font-bold">Data</span>
                  <span className="font-semibold text-dark">
                    {formatarDataBR(bloqueioSelecionado.data)}
                  </span>
                </div>
              </div>
            </div>

            <button
              disabled={removendoBloqueio}
              onClick={() => handleRemoverBloqueio(bloqueioSelecionado.id)}
              className="w-full py-2.5 px-3 rounded-xl text-xs font-bold border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>{removendoBloqueio ? 'Removendo...' : 'Desbloquear Horário (Liberar)'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal de Reagendamento (IK-85) */}
      {isReagendarModalOpen && agendamentoSelecionado && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray/10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-primary text-white px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Reagendar Atendimento</h3>
                <p className="text-xs text-white/80 mt-0.5">Selecione nova data e horário para a consulta</p>
              </div>
              <button
                onClick={() => setIsReagendarModalOpen(false)}
                className="text-white/80 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleConfirmarReagendamento} className="p-6 space-y-4">
              {reagendarErro && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {reagendarErro}
                </div>
              )}

              {/* Informações atuais do atendimento */}
              <div className="bg-light-gray rounded-xl p-3 text-xs space-y-1">
                <p><span className="text-gray">Paciente:</span> <strong>{agendamentoSelecionado.paciente_nome}</strong></p>
                <p><span className="text-gray">Profissional:</span> <strong>{agendamentoSelecionado.profissional_nome}</strong></p>
                <p><span className="text-gray">Serviço:</span> <strong>{agendamentoSelecionado.servico_nome}</strong> ({agendamentoSelecionado.duracao_minutos} min)</p>
                <p><span className="text-gray">Horário Atual:</span> <strong>{agendamentoSelecionado.horario_inicio} às {agendamentoSelecionado.horario_fim}</strong></p>
              </div>

              <div>
                <label className="block text-xs font-bold text-dark mb-1">Nova Data</label>
                <input
                  type="date"
                  required
                  value={reagendarData}
                  onChange={e => setReagendarData(e.target.value)}
                  className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white"
                />
                <span className="text-[10px] text-gray mt-1 block">Apenas de segunda a sexta-feira</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-dark mb-1">Novo Horário de Início</label>
                <select
                  value={reagendarHorario}
                  onChange={e => setReagendarHorario(e.target.value)}
                  className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white"
                >
                  {slots.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <span className="text-[10px] text-gray mt-1 block">Expediente: 08:00 às 18:00</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-dark mb-1">Motivo do Reagendamento (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Pedido do paciente, imprevisto..."
                  value={reagendarMotivo}
                  onChange={e => setReagendarMotivo(e.target.value)}
                  className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReagendarModalOpen(false)}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-gray/20 text-xs font-bold text-gray hover:bg-light-gray"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={reagendando}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all disabled:opacity-50"
                >
                  {reagendando ? 'Validando...' : 'Confirmar Reagendamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Criar Bloqueio de Horário (IK-87) */}
      {isBloquearModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray/10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gray-800 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔒</span>
                <div>
                  <h3 className="text-base font-bold">Bloquear Horário na Agenda</h3>
                  <p className="text-xs text-white/80 mt-0.5">Impede novos atendimentos no intervalo selecionado</p>
                </div>
              </div>
              <button
                onClick={() => setIsBloquearModalOpen(false)}
                className="text-white/80 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCriarBloqueio} className="p-6 space-y-4">
              {bloqueioErro && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {bloqueioErro}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-dark mb-1">Profissional</label>
                <select
                  required
                  value={bloqueioProfissionalId}
                  onChange={e => setBloqueioProfissionalId(Number(e.target.value))}
                  className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
                >
                  {profissionais.map(p => (
                    <option key={p.id} value={p.id}>{p.nome} {p.especialidade ? `(${p.especialidade})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-dark mb-1">Data</label>
                <input
                  type="date"
                  required
                  value={bloqueioData}
                  onChange={e => setBloqueioData(e.target.value)}
                  className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">Horário Início</label>
                  <select
                    value={bloqueioInicio}
                    onChange={e => setBloqueioInicio(e.target.value)}
                    className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
                  >
                    {slots.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">Horário Término</label>
                  <select
                    value={bloqueioFim}
                    onChange={e => setBloqueioFim(e.target.value)}
                    className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
                  >
                    {slots.concat(['18:00']).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-dark mb-1">Motivo do Bloqueio</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Almoço, Reunião de Equipe, Manutenção..."
                  value={bloqueioMotivo}
                  onChange={e => setBloqueioMotivo(e.target.value)}
                  className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBloquearModalOpen(false)}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-gray/20 text-xs font-bold text-gray hover:bg-light-gray"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={bloqueando}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gray-800 text-white text-xs font-bold hover:bg-gray-700 transition-all disabled:opacity-50"
                >
                  {bloqueando ? 'Criando Bloqueio...' : 'Confirmar Bloqueio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Histórico do Paciente (IK-77) */}
      {agendamentoSelecionado && (
        <ModalHistoricoPaciente
          isOpen={isHistoricoModalOpen}
          onClose={() => setIsHistoricoModalOpen(false)}
          pacienteId={agendamentoSelecionado.paciente_id}
          pacienteNome={agendamentoSelecionado.paciente_nome}
        />
      )}

    </div>
  );
}
