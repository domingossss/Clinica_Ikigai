import { apiFetch } from '../api';
import { useClinicUpdates } from '../services/clinicUpdates';
import { useState, useEffect, useCallback, useRef } from 'react';
import ModalHistoricoPaciente from './ModalHistoricoPaciente';
import ModalHistoricoAgendamento from './ModalHistoricoAgendamento';
import type { UsuarioSessao } from '../services/auth';


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

interface DiaJornada {
  dia_semana: number;
  dia_nome: string;
  ativo: number | boolean;
  horario_inicio: string;
  horario_fim: string;
  intervalo_inicio: string | null;
  intervalo_fim: string | null;
}

type StatusAgendamento =
  | 'Agendado'
  | 'Confirmado'
  | 'Na Recepção'
  | 'Em Atendimento'
  | 'Realizado'
  | 'No_Show'
  | 'Concluído'
  | 'Cancelado'
  | 'Reagendado';

interface Props {
  admin: boolean;
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
  profissionalInicialId?: number | null;
  onProfissionalChange?: (profissionalId: number | null) => void;
  usuarioLogado?: UsuarioSessao;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const HORA_INICIO_PADRAO = 8;   // 08:00
const HORA_FIM_PADRAO = 19;     // 19:00
const ALTURA_POR_MINUTO = 1.4; // px por minuto — define escala vertical

const STATUS_CONFIG: Record<StatusAgendamento, { label: string; cor: string; corTexto: string; corBorda: string }> = {
  Agendado:       { label: 'Agendado',       cor: 'bg-amber-50',   corTexto: 'text-amber-800',  corBorda: 'border-amber-400' },
  Confirmado:     { label: 'Confirmado',     cor: 'bg-blue-50',    corTexto: 'text-blue-800',   corBorda: 'border-blue-400' },
  'Na Recepção':  { label: 'Na Recepção',    cor: 'bg-green-50',   corTexto: 'text-green-800',  corBorda: 'border-green-400' },
  'Em Atendimento': { label: 'Em Atendimento', cor: 'bg-violet-50', corTexto: 'text-violet-800', corBorda: 'border-violet-400' },
  Realizado:     { label: 'Realizado', cor: 'bg-gray-100', corTexto: 'text-gray-500', corBorda: 'border-gray-300' },
  No_Show:       { label: 'Não compareceu', cor: 'bg-red-50', corTexto: 'text-red-700', corBorda: 'border-red-300' },
  Concluído:      { label: 'Concluído',      cor: 'bg-gray-100',   corTexto: 'text-gray-500',   corBorda: 'border-gray-300' },
  Cancelado:      { label: 'Cancelado',      cor: 'bg-red-50',     corTexto: 'text-red-700',    corBorda: 'border-red-300' },
  Reagendado:     { label: 'Reagendado',     cor: 'bg-orange-50',  corTexto: 'text-orange-800', corBorda: 'border-orange-400' },
};

const FLUXO_STATUS: Record<StatusAgendamento, StatusAgendamento[]> = {
  Agendado:         ['Confirmado', 'Na Recepção', 'Cancelado', 'No_Show'],
  Confirmado:       ['Na Recepção', 'Cancelado', 'No_Show'],
  'Na Recepção':    ['Em Atendimento', 'Cancelado'],
  'Em Atendimento': ['Concluído'],
  Realizado:        [],
  No_Show:          [],
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
  if (!dateStr) return '';
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

function obterIniciais(nome: string): string {
  if (!nome) return 'PR';
  const limpo = nome.trim();
  const partes = limpo.split(/\s+/).filter(p => !['dr.', 'dra.', 'drª', 'dr', 'dra'].includes(p.toLowerCase()));
  if (partes.length === 0) return limpo.substring(0, 2).toUpperCase();
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function obterDiasDaSemana(dateStr: string): Array<{ data: string; nomeDia: string; formatada: string; isHoje: boolean }> {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diffSegunda = day === 0 ? -6 : (day === 6 ? -5 : 1 - day);
  const segunda = new Date(d);
  segunda.setDate(d.getDate() + diffSegunda);

  const hoje = dataHoje();
  const dias = [];
  const nomes = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(segunda);
    cur.setDate(segunda.getDate() + i);
    const iso = cur.toISOString().split('T')[0];
    const [, m, dia] = iso.split('-');
    dias.push({
      data: iso,
      nomeDia: nomes[i],
      formatada: `${dia}/${m}`,
      isHoje: iso === hoje
    });
  }
  return dias;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function GradeAgenda({
  admin,
  profissionais,
  dataSelecionada: dataProp,
  onDataChange,
  refreshTrigger,
  onAbrirNovoAgendamento,
  onRefresh,
  profissionalInicialId,
  onProfissionalChange,
  usuarioLogado
}: Props) {
  const [dataLocal, setDataSelecionada] = useState(dataProp || dataHoje());
  const [profissionalLocalId, setProfissionalSelecionadoId] = useState<number | null>(
    profissionalInicialId !== undefined ? profissionalInicialId : null
  );
  const [modoVisualizacao, setModoVisualizacao] = useState<'dia' | 'semana'>('dia');
  const [filtroDropdownAberto, setFiltroDropdownAberto] = useState(false);
  const dataSelecionada = dataProp ?? dataLocal;
  const profissionalSelecionadoId = profissionalInicialId !== undefined ? profissionalInicialId : profissionalLocalId;
  const filtroDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickFora(event: MouseEvent) {
      if (filtroDropdownRef.current && !filtroDropdownRef.current.contains(event.target as Node)) {
        setFiltroDropdownAberto(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFiltroDropdownAberto(false);
      }
    }
    if (filtroDropdownAberto) {
      document.addEventListener('mousedown', handleClickFora);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickFora);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [filtroDropdownAberto]);
  const [resumoProfissional, setResumoProfissional] = useState<{
    total: number;
    confirmados: number;
    agendados: number;
    concluidos: number;
    em_atendimento: number;
    recepcao: number;
    reagendados: number;
    bloqueios_total?: number;
  } | null>(null);

  const [agendamentos, setAgendamentos] = useState<AgendamentoDia[]>([]);
  const [bloqueios, setBloqueios] = useState<BloqueioDia[]>([]);
  const [carregandoInicial, setCarregando] = useState(true);
  const [consultaConcluida, setConsultaConcluida] = useState('');
  const chaveConsulta = `${dataSelecionada}:${profissionalSelecionadoId}:${modoVisualizacao}`;
  const carregando = carregandoInicial || consultaConcluida !== chaveConsulta;
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
  const [isHistoricoAgendamentoOpen, setIsHistoricoAgendamentoOpen] = useState(false);

  // Modal de Minha Jornada (Perfil PROFISSIONAL)
  const [isJornadaModalOpen, setIsJornadaModalOpen] = useState(false);
  const [jornadaDias, setJornadaDias] = useState<DiaJornada[]>([]);
  const [carregandoJornada, setCarregandoJornada] = useState(false);
  const [salvandoJornada, setSalvandoJornada] = useState(false);
  const [jornadaErro, setJornadaErro] = useState<string | null>(null);

  const mudarData = (novaData: string) => {
    setDataSelecionada(novaData);
    onDataChange?.(novaData);
  };

  const selecionarProfissional = (id: number | null) => {
    setProfissionalSelecionadoId(id);
    onProfissionalChange?.(id);
    setAgendamentoSelecionado(null);
    setBloqueioSelecionado(null);
  };


  // ─── Busca agenda (Agendamentos e Bloqueios) ───────────────────────────────

  const [janelasAgenda, setJanelasAgenda] = useState<{profissional_id:number;data:string;janelas:[number,number][]}[]>([]);
  const limites = janelasAgenda.flatMap(d => d.janelas.flat());
  const HORA_INICIO_GRADE = Math.min(HORA_INICIO_PADRAO, ...limites.map(m => Math.floor(m / 60)), ...agendamentos.map(a => Math.floor(timeToMinutes(a.horario_inicio)/60)));
  const HORA_FIM_GRADE = Math.max(HORA_FIM_PADRAO, ...limites.map(m => Math.ceil(m / 60)), ...agendamentos.map(a => Math.ceil(timeToMinutes(a.horario_fim)/60)));
  const consultaAgenda = useRef<AbortController | null>(null);
  const buscarAgenda = useCallback((data: string, profId: number | null, modo: 'dia' | 'semana') => {
    consultaAgenda.current?.abort();
    const controller = new AbortController();
    consultaAgenda.current = controller;
    const agendaUrl = profId
      ? '/api/profissionais/' + profId + '/agenda?data=' + data + '&periodo=' + modo
      : '/api/agendamentos/dia?data=' + data;
    return Promise.all([agendaUrl, '/api/janelas?data=' + data + '&periodo=' + modo].map(async url => {
      const res = await apiFetch(url, {signal:controller.signal});
      const json = await res.json();
      if (!res.ok || !json.sucesso) throw new Error(json.erro || 'Não foi possível consultar a agenda.');
      return json;
    })).then(([agenda, janelas]) => {
      if (controller.signal.aborted) return;
      setErro(null);
      setJanelasAgenda(janelas.dados);
      setAgendamentos(agenda.dados || []);
      setBloqueios(agenda.bloqueios || []);
      setAgendamentoSelecionado(prev => prev ? (agenda.dados || []).find((item: AgendamentoDia) => item.id === prev.id) || null : null);
      setBloqueioSelecionado(prev => prev ? (agenda.bloqueios || []).find((item: BloqueioDia) => item.id === prev.id) || null : null);
      setResumoProfissional(profId ? agenda.resumo || null : null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setAgendamentos([]);
      setBloqueios([]);
      setJanelasAgenda([]);
      setResumoProfissional(null);
      setErro(error instanceof Error ? error.message : 'Erro ao carregar agenda.');
    }).finally(() => {
      if (!controller.signal.aborted) {
        setCarregando(false);
        setConsultaConcluida(data + ':' + profId + ':' + modo);
      }
    });
  }, []);

  useClinicUpdates(() => { void buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao); }, ['agendamentos', 'bloqueios', 'profissionais', 'pacientes', 'servicos', 'excecoes','expediente-clinica']);


  useEffect(() => {
    void buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao);
    return () => consultaAgenda.current?.abort();
  }, [dataSelecionada, profissionalSelecionadoId, modoVisualizacao, refreshTrigger, buscarAgenda]);


  // ─── Atualização de status ──────────────────────────────────────────────────

  const atualizarStatus = async (id: number, novoStatus: StatusAgendamento) => {
    setAtualizandoStatus(true);
    try {
      const res = await apiFetch(`/api/agendamentos/${id}/status`, {
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
    } catch (e: unknown) {
      alert('Erro ao atualizar status: ' + ((e instanceof Error ? e.message : '') || 'Tente novamente.'));
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
      const res = await apiFetch(`/api/agendamentos/${agendamentoSelecionado.id}/reagendar`, {
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
        buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao);
      }

      onRefresh?.();
    } catch (err: unknown) {
      setReagendarErro((err instanceof Error ? err.message : '') || 'Erro ao reagendar atendimento.');
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
      const res = await apiFetch(`/api/bloqueios`, {
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
        buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao);
      }

      onRefresh?.();
    } catch (err: unknown) {
      setBloqueioErro((err instanceof Error ? err.message : '') || 'Erro ao criar bloqueio.');
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
      const res = await apiFetch(`/api/bloqueios/${bloqueioId}`, {
        method: 'DELETE'
      });
      const json = await res.json();

      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Falha ao remover bloqueio.');
      }

      setMensagemSucesso('Bloqueio removido! O horário está novamente disponível.');
      setTimeout(() => setMensagemSucesso(null), 3000);

      setBloqueioSelecionado(null);
      buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao);
      onRefresh?.();
    } catch (err: unknown) {
      alert('Erro ao remover bloqueio: ' + ((err instanceof Error ? err.message : '') || 'Tente novamente.'));
    } finally {
      setRemovendoBloqueio(false);
    }
  };

  // ─── Ação de Configurar Minha Jornada (Perfil PROFISSIONAL) ─────────────────

  const abrirModalMinhaJornada = async () => {
    const profId = usuarioLogado?.profissional_id;
    if (!profId) return;

    setIsJornadaModalOpen(true);
    setCarregandoJornada(true);
    setJornadaErro(null);

    try {
      const res = await apiFetch(`/api/profissionais/${profId}/jornada`);
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Não foi possível carregar sua jornada.');
      }
      setJornadaDias(json.dados || []);
    } catch (err: unknown) {
      setJornadaErro((err instanceof Error ? err.message : '') || 'Erro ao carregar jornada.');
    } finally {
      setCarregandoJornada(false);
    }
  };

  const atualizarDiaJornada = <Campo extends keyof DiaJornada,>(diaSemana: number, campo: Campo, valor: DiaJornada[Campo]) => {
    setJornadaDias(prev =>
      prev.map(d => (d.dia_semana === diaSemana ? { ...d, [campo]: valor } : d))
    );
  };

  const handleSalvarMinhaJornada = async (e: React.FormEvent) => {
    e.preventDefault();
    const profId = usuarioLogado?.profissional_id;
    if (!profId) return;

    setSalvandoJornada(true);
    setJornadaErro(null);

    try {
      const res = await apiFetch(`/api/profissionais/${profId}/jornada`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dias: jornadaDias.map(d => ({
            dia_semana: d.dia_semana,
            ativo: d.ativo ? 1 : 0,
            horario_inicio: d.horario_inicio || '08:00',
            horario_fim: d.horario_fim || '18:00',
            intervalo_inicio: d.intervalo_inicio || null,
            intervalo_fim: d.intervalo_fim || null,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Falha ao salvar jornada de trabalho.');
      }

      setMensagemSucesso('Sua jornada de trabalho foi atualizada com sucesso!');
      setTimeout(() => setMensagemSucesso(null), 3500);
      setIsJornadaModalOpen(false);
      buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao);
      onRefresh?.();
    } catch (err: unknown) {
      setJornadaErro((err instanceof Error ? err.message : '') || 'Erro ao salvar jornada.');
    } finally {
      setSalvandoJornada(false);
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

  const profissionalAtivo = profissionais.find(p => p.id === profissionalSelecionadoId);
  const diasSemana = obterDiasDaSemana(dataSelecionada);
  const infoSemanaTexto = `Semana de ${formatarDataBR(diasSemana[0]?.data)} a ${formatarDataBR(diasSemana[6]?.data)} (Segunda a Domingo)`;

  const renderColunaGrade = (
    colKey: string | number,
    titulo: string,
    subtitulo: string | undefined,
    dataDoSlot: string,
    profIdDoSlot: number,
    ags: AgendamentoDia[],
    bls: BloqueioDia[],
    isHojeBadge?: boolean
  ) => {
    return (
      <div key={colKey} className="flex-1 min-w-52 border-r border-gray/10 last:border-r-0">
        {/* Header do profissional / dia */}
        <div className="h-12 px-3 flex flex-col justify-center border-b border-gray/10 bg-white sticky top-0 z-10">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-bold text-dark truncate">{titulo}</span>
            {isHojeBadge && (
              <span className="text-[9px] bg-primary text-white font-extrabold px-1.5 py-0.5 rounded-full">
                Hoje
              </span>
            )}
          </div>
          {subtitulo && (
            <span className="text-[9px] text-gray truncate">{subtitulo}</span>
          )}
        </div>

        {/* Área de slots */}
        <div className="relative bg-white" style={{ height: alturaTotal }}>
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
            const temBloqueio = bls.some(b => {
              const ini = timeToMinutes(b.horario_inicio);
              const fim = timeToMinutes(b.horario_fim);
              return slotMin >= ini && slotMin < fim;
            });

            const dentroJornada = janelasAgenda.find(j => j.profissional_id === profIdDoSlot && j.data === dataDoSlot)?.janelas.some(([i,f]) => slotMin >= i && slotMin < f);
            return (onAbrirNovoAgendamento && dentroJornada && !temAgendamento && !temBloqueio) ? (
              <div
                key={slot}
                onClick={() =>
                  onAbrirNovoAgendamento?.({
                    data: dataDoSlot,
                    horario_inicio: slot,
                    profissional_id: profIdDoSlot,
                  })
                }
                className="absolute left-0 right-0 hover:bg-primary/5 cursor-pointer transition-colors group"
                style={{
                  top: topParaHorario(slot),
                  height: 30 * ALTURA_POR_MINUTO,
                }}
                title={`Agendar às ${slot} em ${formatarDataBR(dataDoSlot)}`}
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
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl shadow-premium border border-gray/5 overflow-hidden">

      {/* Barra de Seleção de Profissional (IK-81 CA01) */}
      <div className="px-6 py-3 border-b border-gray/10 bg-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Filtrar Profissional:
          </span>

          {/* Botão de Dropdown que abre a lista com os profissionais empilhados */}
          <div className="relative" ref={filtroDropdownRef}>
            <button
              type="button"
              onClick={() => setFiltroDropdownAberto(prev => !prev)}
              aria-expanded={filtroDropdownAberto}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 border shadow-xs ${
                profissionalSelecionadoId === null
                  ? 'bg-primary text-white border-primary shadow-sm font-bold'
                  : 'bg-white border-gray/20 hover:bg-light-gray text-dark font-bold'
              }`}
            >
              {profissionalSelecionadoId === null ? (
                <>
                  <span className="text-sm">👥</span>
                  <span>Todos da Clínica</span>
                </>
              ) : (
                <>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-primary text-secondary notranslate" translate="no">
                    {obterIniciais(profissionalAtivo?.nome || '')}
                  </span>
                  <span>{profissionalAtivo?.nome || 'Profissional Selecionado'}</span>
                </>
              )}
              <svg
                className={`w-3.5 h-3.5 ml-1 transition-transform duration-200 ${
                  filtroDropdownAberto ? 'rotate-180' : ''
                } ${profissionalSelecionadoId === null ? 'text-white' : 'text-gray-500'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Menu suspenso com todos os profissionais um em baixo do outro */}
            {filtroDropdownAberto && (
              <div className="absolute left-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-gray/15 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3.5 py-1 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                  Selecione o profissional
                </div>

                <div className="max-h-72 overflow-y-auto flex flex-col gap-1 px-1.5 mt-1">
                  {/* Opção Todos da Clínica */}
                  <button
                    type="button"
                    onClick={() => {
                      selecionarProfissional(null);
                      setFiltroDropdownAberto(false);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-between text-left ${
                      profissionalSelecionadoId === null
                        ? 'bg-primary text-white font-bold shadow-xs'
                        : 'text-dark hover:bg-light-gray'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center bg-white/20 text-xs">👥</span>
                      <span>Todos da Clínica</span>
                    </span>
                    {profissionalSelecionadoId === null && (
                      <svg className="w-4 h-4 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  <div className="border-b border-gray/10 my-1"></div>

                  {/* Lista de profissionais um em baixo do outro */}
                  {profissionais.map(prof => {
                    const isAtivo = profissionalSelecionadoId === prof.id;
                    return (
                      <button
                        key={prof.id}
                        type="button"
                        onClick={() => {
                          selecionarProfissional(prof.id);
                          setFiltroDropdownAberto(false);
                        }}
                        className={`w-full px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-between text-left ${
                          isAtivo
                            ? 'bg-secondary/25 text-primary-dark font-extrabold ring-1 ring-secondary/50'
                            : 'text-dark hover:bg-light-gray'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span
                            className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold notranslate ${
                              isAtivo ? 'bg-primary text-secondary' : 'bg-gray-200 text-gray-700'
                            }`}
                            translate="no"
                          >
                            {obterIniciais(prof.nome)}
                          </span>
                          <div className="truncate">
                            <div className="truncate font-semibold">{prof.nome}</div>
                            {prof.especialidade && (
                              <div className="text-[10px] text-gray-500 truncate font-normal">
                                {prof.especialidade}
                              </div>
                            )}
                          </div>
                        </div>

                        {isAtivo && (
                          <svg className="w-4 h-4 text-primary flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {usuarioLogado?.perfil === 'PROFISSIONAL' && usuarioLogado.profissional_id && Number(profissionalSelecionadoId) !== Number(usuarioLogado.profissional_id) && (
            <button
              type="button"
              onClick={() => selecionarProfissional(Number(usuarioLogado.profissional_id))}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-secondary/25 text-primary-dark border border-secondary/40 hover:bg-secondary/35 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <span>🩺</span>
              <span>Minha Agenda</span>
            </button>
          )}
        </div>

        {/* Alternador de Modo de Visualização quando profissional específico está selecionado */}
        {profissionalSelecionadoId && (
          <div className="flex items-center gap-1 bg-light-gray p-1 rounded-xl border border-gray/10">
            <button
              type="button"
              onClick={() => setModoVisualizacao('dia')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                modoVisualizacao === 'dia'
                  ? 'bg-white text-primary shadow-xs'
                  : 'text-gray hover:text-dark'
              }`}
            >
              <span>📅 Visão Diária</span>
            </button>
            <button
              type="button"
              onClick={() => setModoVisualizacao('semana')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                modoVisualizacao === 'semana'
                  ? 'bg-white text-primary shadow-xs'
                  : 'text-gray hover:text-dark'
              }`}
            >
              <span>📆 Visão Semanal</span>
            </button>
          </div>
        )}
      </div>

      {/* Destaque da Agenda do Profissional Selecionado (IK-81 CA01 & CA02) */}
      {profissionalAtivo && (
        <div className="px-6 py-3.5 bg-gradient-to-r from-primary/5 via-secondary/10 to-transparent border-b border-primary/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-dark text-secondary font-extrabold flex items-center justify-center text-sm shadow-sm">
              {obterIniciais(profissionalAtivo.nome)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-extrabold text-dark">{profissionalAtivo.nome}</h4>
                <span className="text-[10px] bg-secondary/30 text-primary-dark font-bold px-2 py-0.5 rounded-full border border-secondary/40">
                  Agenda Individual
                </span>
              </div>
              <p className="text-xs text-gray mt-0.5 font-medium">
                {profissionalAtivo.especialidade || 'Especialista'} • {modoVisualizacao === 'semana' ? infoSemanaTexto : `${diaSemana(dataSelecionada)}, ${formatarDataBR(dataSelecionada)}`}
              </p>
            </div>
          </div>

          {/* Resumo consolidado do período (CA02) */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className="bg-white/80 border border-gray/15 rounded-xl px-3 py-1.5 shadow-xs">
              <span className="text-gray text-[10px] uppercase font-bold block">Compromissos</span>
              <span className="font-extrabold text-dark text-sm">{resumoProfissional?.total ?? agendamentos.length}</span>
            </div>
            <div className="bg-white/80 border border-blue-200 rounded-xl px-3 py-1.5 shadow-xs">
              <span className="text-blue-700 text-[10px] uppercase font-bold block">Confirmados</span>
              <span className="font-extrabold text-blue-800 text-sm">
                {resumoProfissional?.confirmados ?? agendamentos.filter(a => a.status === 'Confirmado').length}
              </span>
            </div>
            <div className="bg-white/80 border border-gray-300 rounded-xl px-3 py-1.5 shadow-xs">
              <span className="text-gray-600 text-[10px] uppercase font-bold block">Bloqueios</span>
              <span className="font-extrabold text-gray-800 text-sm">{resumoProfissional?.bloqueios_total ?? bloqueios.length}</span>
            </div>
            <button
              type="button"
              onClick={() => selecionarProfissional(null)}
              className="text-xs text-gray hover:text-dark px-2.5 py-1.5 rounded-lg hover:bg-white/60 transition-colors border border-dashed border-gray/30 cursor-pointer"
              title="Voltar para a visão geral de todos os profissionais"
            >
              ✕ Fechar filtro
            </button>
          </div>
        </div>
      )}

      {/* Cabeçalho da grade e Navegação de Período (IK-81 CA03) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-gray/10 bg-light-gray/30">
        <div>
          <h3 className="text-base font-bold text-dark">
            {profissionalAtivo
              ? `Agenda: ${profissionalAtivo.nome}`
              : 'Grade Geral de Horários'}
          </h3>
          <p className="text-xs text-gray mt-0.5">
            {profissionalAtivo && modoVisualizacao === 'semana'
              ? infoSemanaTexto
              : `${diaSemana(dataSelecionada)}, ${formatarDataBR(dataSelecionada)}`}
          </p>
        </div>

        {/* Ações e Navegação de datas (CA03) */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Botão Minha Jornada (exclusivo para PROFISSIONAL vinculado) */}
          {usuarioLogado?.perfil === 'PROFISSIONAL' && usuarioLogado.profissional_id && (
            <button
              onClick={abrirModalMinhaJornada}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary/15 text-primary border border-primary/30 hover:bg-primary hover:text-white active:scale-95 transition-all shadow-xs cursor-pointer"
              title="Configurar seus horários de expediente e intervalo de almoço"
            >
              <span>⏰</span>
              <span>Minha Jornada</span>
            </button>
          )}

          {/* Botão Bloquear Horário (IK-87) */}
          {(!usuarioLogado || usuarioLogado.perfil !== 'PROFISSIONAL' || usuarioLogado.profissional_id) && (
            <button
              onClick={() => {
                setBloqueioData(dataSelecionada);
                const profIdPadrao =
                  usuarioLogado?.perfil === 'PROFISSIONAL' && usuarioLogado.profissional_id
                    ? Number(usuarioLogado.profissional_id)
                    : profissionalAtivo?.id || profissionais[0]?.id || 1;
                setBloqueioProfissionalId(profIdPadrao);
                setBloqueioErro(null);
                setIsBloquearModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 text-white hover:bg-gray-700 active:scale-95 transition-all shadow-sm cursor-pointer"
              title="Bloquear Horário na Grade"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>Bloquear Horário</span>
            </button>
          )}

          {/* Navegação anterior (Dia ou Semana) */}
          <button
            onClick={() => mudarData(somarDias(dataSelecionada, modoVisualizacao === 'semana' && profissionalAtivo ? -7 : -1))}
            className="p-2 rounded-lg border border-gray/15 hover:bg-light-gray active:scale-95 transition-all text-gray hover:text-dark cursor-pointer"
            title={modoVisualizacao === 'semana' && profissionalAtivo ? 'Semana anterior' : 'Dia anterior'}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button
            onClick={() => mudarData(dataHoje())}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
              dataSelecionada === dataHoje()
                ? 'bg-primary text-white border-primary'
                : 'border-gray/15 hover:bg-light-gray text-dark'
            }`}
          >
            {modoVisualizacao === 'semana' && profissionalAtivo ? 'Semana Atual' : 'Hoje'}
          </button>

          <input
            type="date"
            value={dataSelecionada}
            onChange={e => mudarData(e.target.value)}
            className="text-xs border border-gray/15 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white text-dark cursor-pointer"
          />

          {/* Navegação próximo (Dia ou Semana) */}
          <button
            onClick={() => mudarData(somarDias(dataSelecionada, modoVisualizacao === 'semana' && profissionalAtivo ? 7 : 1))}
            className="p-2 rounded-lg border border-gray/15 hover:bg-light-gray active:scale-95 transition-all text-gray hover:text-dark cursor-pointer"
            title={modoVisualizacao === 'semana' && profissionalAtivo ? 'Próxima semana' : 'Próximo dia'}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao)}
            className="p-2 rounded-lg border border-gray/15 hover:bg-light-gray active:scale-95 transition-all text-gray hover:text-dark cursor-pointer"
            title="Atualizar agenda"
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
          <button onClick={() => buscarAgenda(dataSelecionada, profissionalSelecionadoId, modoVisualizacao)} className="font-bold underline cursor-pointer">
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

          {/* Renderização condicional por Modo de Visualização */}
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
          ) : profissionalAtivo && modoVisualizacao === 'semana' ? (
            // Visão Semanal do Profissional Selecionado (IK-81 CA02 & CA03)
            diasSemana.map(diaInfo => {
              const agsDia = agendamentos.filter(a => Number(a.profissional_id) === Number(profissionalAtivo.id) && a.data === diaInfo.data);
              const blsDia = bloqueios.filter(b => Number(b.profissional_id) === Number(profissionalAtivo.id) && b.data === diaInfo.data);
              return renderColunaGrade(
                `semana-${diaInfo.data}`,
                diaInfo.nomeDia,
                diaInfo.formatada,
                diaInfo.data,
                profissionalAtivo.id,
                agsDia,
                blsDia,
                diaInfo.isHoje
              );
            })
          ) : profissionalAtivo && modoVisualizacao === 'dia' ? (
            // Visão Diária do Profissional Selecionado (IK-81 CA01 & CA02)
            (() => {
              const agsProf = agendamentosParaProfissional(profissionalAtivo.id);
              const blsProf = bloqueiosParaProfissional(profissionalAtivo.id);
              return renderColunaGrade(
                `prof-dia-${profissionalAtivo.id}`,
                profissionalAtivo.nome,
                profissionalAtivo.especialidade || 'Agenda Individual',
                dataSelecionada,
                profissionalAtivo.id,
                agsProf,
                blsProf,
                dataSelecionada === dataHoje()
              );
            })()
          ) : (
            // Visão Geral de Todos os Profissionais da Clínica (Modo Padrão)
            profissionais.map(prof => {
              const ags = agendamentosParaProfissional(prof.id);
              const bls = bloqueiosParaProfissional(prof.id);
              return renderColunaGrade(
                prof.id,
                prof.nome,
                prof.especialidade,
                dataSelecionada,
                prof.id,
                ags,
                bls
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
            {usuarioLogado?.perfil !== 'PROFISSIONAL' && !['Cancelado', 'No_Show', 'Concluído', 'Realizado', 'Em Atendimento'].includes(agendamentoSelecionado.status) && (
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

            {admin && <a className="block text-center py-2 text-xs font-bold text-primary" href={`/comunicacao?agendamento=${agendamentoSelecionado.id}`}>Comunicações do atendimento</a>}
            {/* Botão Visualizar Histórico do Paciente (IK-77) */}
            {admin && <button
              onClick={() => setIsHistoricoModalOpen(true)}
              className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-secondary/40 bg-secondary/15 text-primary-dark hover:bg-secondary/25 transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Ver Histórico do Paciente</span>
            </button>}

            {/* Ações de status */}
            {/* Botão Visualizar Histórico de Alterações do Agendamento (IK-97) */}
            {admin && <button
              onClick={() => setIsHistoricoAgendamentoOpen(true)}
              className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-gray/25 bg-light-gray text-dark hover:bg-gray/15 transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4 text-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Ver Histórico do Agendamento</span>
            </button>}

            {usuarioLogado?.perfil === 'PROFISSIONAL' && (!usuarioLogado.profissional_id || Number(agendamentoSelecionado.profissional_id) !== Number(usuarioLogado.profissional_id)) ? (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 font-semibold text-center">
                Somente leitura: você só pode alterar o status dos atendimentos da sua própria agenda.
              </div>
            ) : FLUXO_STATUS[agendamentoSelecionado.status].length > 0 ? (
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
            ) : null}

            {/* Sem acoes disponiveis */}
            {admin && FLUXO_STATUS[agendamentoSelecionado.status].length === 0 && agendamentoSelecionado.status === 'Cancelado' && (
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

            {(!usuarioLogado ||
              usuarioLogado.perfil !== 'PROFISSIONAL' ||
              (usuarioLogado.profissional_id &&
                Number(bloqueioSelecionado.profissional_id) === Number(usuarioLogado.profissional_id))) ? (
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
            ) : (
              <p className="text-[11px] text-amber-800 text-center py-2 px-3 bg-amber-50 border border-amber-200 rounded-xl font-medium">
                🔒 Bloqueio pertencente a outro profissional (somente leitura).
              </p>
            )}
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
                <span className="text-[10px] text-gray mt-1 block">Conforme jornada e exceções cadastradas</span>
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
                <span className="text-[10px] text-gray mt-1 block">Conforme jornada e exceções cadastradas</span>
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
                  disabled={usuarioLogado?.perfil === 'PROFISSIONAL' && Boolean(usuarioLogado.profissional_id)}
                  value={bloqueioProfissionalId}
                  onChange={e => setBloqueioProfissionalId(Number(e.target.value))}
                  className="w-full text-xs border border-gray/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white disabled:bg-gray-100 disabled:text-gray-600"
                >
                  {profissionais.map(p => (
                    <option key={p.id} value={p.id}>{p.nome} {p.especialidade ? `(${p.especialidade})` : ''}</option>
                  ))}
                </select>
                {usuarioLogado?.perfil === 'PROFISSIONAL' && (
                  <span className="text-[10px] text-gray mt-1 block">
                    Vinculado automaticamente à sua própria agenda profissional.
                  </span>
                )}
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

      {/* Modal de Minha Jornada de Trabalho (Perfil PROFISSIONAL) */}
      {isJornadaModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-gray/10 overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="bg-primary text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">⏰</span>
                <div>
                  <h3 className="text-base font-bold">Minha Jornada de Trabalho</h3>
                  <p className="text-xs text-white/80 mt-0.5">
                    Configure seus dias de atendimento, expediente e intervalo de almoço
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsJornadaModalOpen(false)}
                className="text-white/80 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSalvarMinhaJornada} className="p-6 space-y-4 overflow-y-auto">
              {jornadaErro && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {jornadaErro}
                </div>
              )}

              {carregandoJornada ? (
                <div className="py-10 text-center text-xs text-gray">
                  Carregando sua jornada de trabalho...
                </div>
              ) : (
                <div className="space-y-2.5">
                  {jornadaDias.map(dia => {
                    const ativoBool = Boolean(dia.ativo);
                    return (
                      <div
                        key={dia.dia_semana}
                        className={`p-3 rounded-xl border text-xs transition-all ${
                          ativoBool
                            ? 'bg-white border-gray/20'
                            : 'bg-light-gray/60 border-gray/10 opacity-75'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <label className="flex items-center gap-2 font-bold text-dark min-w-[140px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ativoBool}
                              onChange={e =>
                                atualizarDiaJornada(dia.dia_semana, 'ativo', e.target.checked ? 1 : 0)
                              }
                              className="rounded border-gray/30 text-primary focus:ring-primary"
                            />
                            <span>{dia.dia_nome}</span>
                          </label>

                          {ativoBool ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-gray font-semibold">Expediente:</span>
                                <input
                                  type="time"
                                  value={dia.horario_inicio || '08:00'}
                                  onChange={e =>
                                    atualizarDiaJornada(dia.dia_semana, 'horario_inicio', e.target.value)
                                  }
                                  className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                                />
                                <span className="text-gray">às</span>
                                <input
                                  type="time"
                                  value={dia.horario_fim || '18:00'}
                                  onChange={e =>
                                    atualizarDiaJornada(dia.dia_semana, 'horario_fim', e.target.value)
                                  }
                                  className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                                />
                              </div>

                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-gray font-semibold">Intervalo:</span>
                                <input
                                  type="time"
                                  value={dia.intervalo_inicio || ''}
                                  onChange={e =>
                                    atualizarDiaJornada(
                                      dia.dia_semana,
                                      'intervalo_inicio',
                                      e.target.value || null
                                    )
                                  }
                                  className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                                />
                                <span className="text-gray">às</span>
                                <input
                                  type="time"
                                  value={dia.intervalo_fim || ''}
                                  onChange={e =>
                                    atualizarDiaJornada(
                                      dia.dia_semana,
                                      'intervalo_fim',
                                      e.target.value || null
                                    )
                                  }
                                  className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray italic">Sem expediente neste dia</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t border-gray/10">
                <button
                  type="button"
                  onClick={() => setIsJornadaModalOpen(false)}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-gray/20 text-xs font-bold text-gray hover:bg-light-gray cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoJornada || carregandoJornada}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all disabled:opacity-50 cursor-pointer"
                >
                  {salvandoJornada ? 'Salvando Jornada...' : 'Salvar Minha Jornada'}
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

      {agendamentoSelecionado && (
        <ModalHistoricoAgendamento
          isOpen={isHistoricoAgendamentoOpen}
          onClose={() => setIsHistoricoAgendamentoOpen(false)}
          agendamentoId={agendamentoSelecionado.id}
        />
      )}

    </div>
  );
}
