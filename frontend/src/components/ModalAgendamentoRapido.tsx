import { apiFetch } from '../api';
import { useClinicUpdates } from '../services/clinicUpdates';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Swal from 'sweetalert2';
import ModalHistoricoPaciente from './ModalHistoricoPaciente';

export interface PacienteItem {
  id: string;
  nome: string;
  nome_completo?: string;
  whatsapp: string;
  telefone?: string;
  cpf?: string;
}

export interface ProfissionalItem {
  id: number;
  nome: string;
  especialidade?: string;
}

export interface ServicoItem {
  id: number;
  nome: string;
  duracao_minutos: number;
  preco?: number;
  categoria_nome?: string;
  ativo?: number | boolean;
}

interface ModalAgendamentoRapidoProps {
  excepcional?: boolean;
  admin: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (dadosAgendamento?: { data: string; profissionalId: number }) => void;
  initialDate?: string;
  initialTime?: string;
  initialProfissionalId?: number;
  initialPacienteId?: string;
  profissionais: ProfissionalItem[];
  servicos: ServicoItem[];
  pacientesExistentes?: PacienteItem[];
  onPacienteCadastrado?: (novoPaciente: PacienteItem) => void;
}

const AVISO_SERVICO_INDISPONIVEL = 'O serviço selecionado foi removido ou inativado. Escolha outro serviço.';


export default function ModalAgendamentoRapido(props: ModalAgendamentoRapidoProps) {
  return props.isOpen ? <FormularioAgendamento {...props} /> : null;
}

function FormularioAgendamento({
  excepcional = false,
  admin,
  isOpen,
  onClose,
  onSuccess,
  initialDate,
  initialTime,
  initialProfissionalId,
  initialPacienteId,
  profissionais,
  pacientesExistentes = [],
  onPacienteCadastrado
}: ModalAgendamentoRapidoProps) {
  const [servicos, setServicos] = useState<ServicoItem[]>([]);
  const [carregandoServicos, setCarregandoServicos] = useState(true);
  const [servicosCarregados, setServicosCarregados] = useState(false);
  const consultaServicos = useRef<AbortController | null>(null);
  const selecaoServicoInicializada = useRef(false);

  // Dados do Agendamento
  const [profissionalEscolhidoId, setProfissionalId] = useState<number>(initialProfissionalId || 1);
  const [servicoEscolhidoId, setServicoId] = useState<string>('');
  const [data, setData] = useState<string>(initialDate || new Date().toISOString().substring(0, 10));
  const [horaEscolhida, setHoraInicio] = useState<string>(initialTime || '');
  const [iniciouAgendamento, setIniciouAgendamento] = useState(false);
  const [observacoes, setObservacoes] = useState<string>('');
  const [tipoAtendimento, setTipoAtendimento] = useState('Primeira_Consulta');

  // Controle de Paciente Selecionado
  const [pacienteEscolhido, setSelectedPaciente] = useState<PacienteItem | null>(() => pacientesExistentes.find(p => p.id === initialPacienteId) || null);
  const selectedPaciente = pacientesExistentes.find(p => p.id === pacienteEscolhido?.id) || pacienteEscolhido;
  const [isHistoricoModalOpen, setIsHistoricoModalOpen] = useState(false);

  // Modo de Paciente: 'busca' ou 'novo'
  const [modoPaciente, setModoPaciente] = useState<'busca' | 'novo'>('busca');

  // Estados de Busca de Paciente
  const [termoBusca, setTermoBusca] = useState<string>('');
  const [resultadosBusca, setResultadosBusca] = useState<PacienteItem[]>([]);

  const [mostrarDropdownBusca, setMostrarDropdownBusca] = useState<boolean>(false);

  // Estados do Formulário de Pré-Cadastro Rápido
  const [novoNome, setNovoNome] = useState<string>('');
  const [novoWhatsapp, setNovoWhatsapp] = useState<string>('');
  const [novoCpf, setNovoCpf] = useState<string>('');
  const [salvandoPaciente, setSalvandoPaciente] = useState<boolean>(false);

  // Estados de Submissão e Erro
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const servicoIndisponivel = servicosCarregados && !!servicoEscolhidoId && !servicos.some(s => String(s.id) === servicoEscolhidoId);
  const servicoId = servicoIndisponivel ? '' : servicoEscolhidoId;
  const avisoServico = servicoIndisponivel ? AVISO_SERVICO_INDISPONIVEL : null;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!isOpen || termoBusca.trim().length < 2) { setResultadosBusca([]); return; }
      try {
        const res = await apiFetch((excepcional ? '/api/agenda/pacientes?busca=' : '/api/pacientes?limite=10&busca=') + encodeURIComponent(termoBusca), {signal:controller.signal});
        const json = await res.json();
        if (!res.ok) throw new Error(json.erro);
        if (!controller.signal.aborted) setResultadosBusca(json.dados.map((p: PacienteItem) => ({...p,nome:p.nome_completo || p.nome})));
      } catch { if (!controller.signal.aborted) { setResultadosBusca([]); setErrorMessage('Não foi possível buscar pacientes.'); } }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [isOpen, termoBusca, excepcional]);

  const atualizarServicosAtivos = useCallback(() => {
    consultaServicos.current?.abort();
    const controller = new AbortController();
    consultaServicos.current = controller;
    return apiFetch('/api/servicos?apenas_ativos=true', { signal: controller.signal, cache: 'no-store' }).then(async res => {
      const json = await res.json();
      if (!res.ok || !json.sucesso || !Array.isArray(json.dados)) throw new Error(json.erro || 'Não foi possível consultar os serviços ativos.');
      if (controller.signal.aborted) return;
      const ativos = json.dados.filter((servico: ServicoItem) => servico.ativo === 1 || servico.ativo === true);
      setServicos(ativos);
      if (!selecaoServicoInicializada.current) {
        selecaoServicoInicializada.current = true;
        setServicoId(ativos[0] ? String(ativos[0].id) : '');
      }
      setServicosCarregados(true);
    }).catch((erro: unknown) => {
      if (controller.signal.aborted) return;
      setServicos([]);
      setErrorMessage(erro instanceof Error ? erro.message : 'Não foi possível atualizar os serviços.');
    }).finally(() => { if (!controller.signal.aborted) setCarregandoServicos(false); });
  }, []);

  useEffect(() => {
    void atualizarServicosAtivos();
    return () => consultaServicos.current?.abort();
  }, [atualizarServicosAtivos]);

  useClinicUpdates(() => { if (isOpen) void atualizarServicosAtivos(); }, ['servicos', 'categorias']);

  const [elegibilidade, setElegibilidade] = useState<{servicoId: string; profissionais: ProfissionalItem[]}>({servicoId:'', profissionais:[]});
  const carregandoProfissionaisElegiveis = !!servicoId && elegibilidade.servicoId !== servicoId;
  const profissionaisDoServico = !servicoId ? profissionais : carregandoProfissionaisElegiveis ? [] : elegibilidade.profissionais;
  const profissionaisElegiveis = excepcional
    ? profissionaisDoServico.filter(p => p.id === initialProfissionalId)
    : profissionaisDoServico;
  const profissionalId = profissionaisElegiveis.some(p => p.id === profissionalEscolhidoId) ? profissionalEscolhidoId : profissionaisElegiveis[0]?.id || 0;

  const [revisaoHorarios, setRevisaoHorarios] = useState(0);
  const [consultaHorarios, setConsultaHorarios] = useState<{ chave: string; livres: string[]; erro?: string }>();
  const parametros = servicoId && profissionalId && data
    ? new URLSearchParams({ servico_id: servicoId, profissional_id: String(profissionalId), data, excepcional: excepcional ? '1' : '0' }).toString()
    : '';
  const chaveHorarios = parametros + '#' + revisaoHorarios;
  const horarios = consultaHorarios?.chave === chaveHorarios ? consultaHorarios : undefined;
  const horaInicio = horarios?.livres.includes(horaEscolhida) ? horaEscolhida : '';
  const atualizarHorarios = () => setRevisaoHorarios(n => n + 1);
  useClinicUpdates(atualizarHorarios, ['agendamentos', 'bloqueios', 'profissionais', 'servicos', 'jornadas', 'excecoes', 'expediente-clinica']);

  useEffect(() => {
    if (!parametros) return;
    const controller = new AbortController();
    async function consultar() {
      try {
        const res = await apiFetch('/api/disponibilidade?' + parametros, { signal: controller.signal, cache: 'no-store' });
        const resultado = await res.json();
        if (!res.ok || !resultado.sucesso || !Array.isArray(resultado.dados)) throw new Error(resultado.erro || 'Não foi possível consultar os horários.');
        const slots: { horario: string; disponivel: boolean }[] = resultado.dados;
        if (!controller.signal.aborted) setConsultaHorarios({ chave: chaveHorarios, livres: slots.filter(s => s.disponivel).map(s => s.horario) });
      } catch (erro) {
        if (!controller.signal.aborted) setConsultaHorarios({ chave: chaveHorarios, livres: [], erro: erro instanceof Error ? erro.message : 'Falha ao consultar horários.' });
      }
    }
    void consultar();
    return () => controller.abort();
  }, [chaveHorarios, parametros]);

  useEffect(() => {
    if (!servicoId) return;
    const controller = new AbortController();
    apiFetch('/api/servicos/' + servicoId + '/profissionais', {signal:controller.signal})
      .then(async res => {
        const json = await res.json();
        if (!res.ok || !json.sucesso || !Array.isArray(json.dados)) throw new Error('Falha ao consultar profissionais.');
        if (!controller.signal.aborted) setElegibilidade({servicoId, profissionais:json.dados});
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setElegibilidade({servicoId, profissionais:[]});
        setErrorMessage('Não foi possível consultar os profissionais habilitados. Tente novamente.');
      });
    return () => controller.abort();
  }, [servicoId, profissionais]);

  useEffect(() => {
    if (!initialPacienteId || pacienteEscolhido) return;
    const controller = new AbortController();
    apiFetch('/api/pacientes/' + encodeURIComponent(initialPacienteId), {signal:controller.signal})
      .then(async res => {
        const json = await res.json();
        if (!res.ok || !json.sucesso) throw new Error('Não foi possível consultar o paciente.');
        if (!controller.signal.aborted) setSelectedPaciente({...json.dados, nome:json.dados.nome_completo || json.dados.nome});
      }).catch(() => { if (!controller.signal.aborted) setErrorMessage('Não foi possível consultar o paciente.'); });
    return () => controller.abort();
  }, [initialPacienteId, pacienteEscolhido]);

  // Serviço Selecionado Atual
  const servicoSelecionado = useMemo(() => {
    return servicos.find(s => s.id.toString() === servicoId);
  }, [servicos, servicoId]);

  // Cálculo Automático de Horário de Término
  const calculoHorario = useMemo(() => {
    if (!horaInicio || !servicoSelecionado) return null;

    const [h, m] = horaInicio.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;

    const inicioMinutos = h * 60 + m;
    const duracao = servicoSelecionado.duracao_minutos || 30;
    const bufferMinutos = 15; // Intervalo de intervalo padrão

    const terminoConsultaMinutos = inicioMinutos + duracao;
    const terminoComBufferMinutos = terminoConsultaMinutos + bufferMinutos;

    const formatarHora = (totalMinutos: number) => {
      const horas = Math.floor(totalMinutos / 60) % 24;
      const minutos = totalMinutos % 60;
      return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
    };

    return {
      duracao,
      bufferMinutos,
      horaInicio,
      horaTermino: formatarHora(terminoConsultaMinutos),
      horaTerminoComBuffer: formatarHora(terminoComBufferMinutos)
    };
  }, [horaInicio, servicoSelecionado]);

  // Filtro de Pacientes para Busca
  const pacientesFiltrados = resultadosBusca;

  // Máscaras de Telefone e CPF
  const aplicarMascaraTelefone = (valor: string) => {
    const limpo = valor.replace(/\D/g, '').slice(0, 11);
    if (limpo.length <= 2) return limpo;
    if (limpo.length <= 6) return `(${limpo.slice(0, 2)}) ${limpo.slice(2)}`;
    if (limpo.length <= 10) return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  };

  const aplicarMascaraCPF = (valor: string) => {
    const limpo = valor.replace(/\D/g, '').slice(0, 11);
    if (limpo.length <= 3) return limpo;
    if (limpo.length <= 6) return `${limpo.slice(0, 3)}.${limpo.slice(3)}`;
    if (limpo.length <= 9) return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6)}`;
    return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
  };

  // Submeter Pré-Cadastro Rápido de Paciente
  const handleCriarPacienteRapido = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!novoNome.trim()) {
      setErrorMessage('Informe o nome completo do paciente.');
      return;
    }

    const cleanTel = novoWhatsapp.replace(/\D/g, '');
    if (cleanTel.length < 10) {
      setErrorMessage('Informe um telefone válido com DDD.');
      return;
    }

    setSalvandoPaciente(true);

    try {
      const res = await apiFetch(`/api/pacientes/rapido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_completo: novoNome.trim(),
          whatsapp: cleanTel,
          cpf: novoCpf ? novoCpf.replace(/\D/g, '') : undefined
        })
      });

      if ([502, 503, 504].includes(res.status)) {
        setErrorMessage('O servidor não confirmou o cadastro. Busque o paciente antes de tentar novamente.');
        return;
      }
      const dataRes = await res.json().catch(() => null);
      if (!dataRes) {
        setErrorMessage('O servidor retornou uma resposta inválida. Busque o paciente antes de tentar novamente.');
        return;
      }

      if (res.ok && dataRes.sucesso && dataRes.dados) {
        const pacienteSalvo: PacienteItem = {
          id: dataRes.dados.id,
          nome: dataRes.dados.nome || novoNome.trim(),
          nome_completo: dataRes.dados.nome_completo || novoNome.trim(),
          whatsapp: cleanTel
        };

        // Seleciona o novo paciente imediatamente
        setSelectedPaciente(pacienteSalvo);
        if (onPacienteCadastrado) {
          onPacienteCadastrado(pacienteSalvo);
        }

        // Limpa formulário de pré-cadastro e volta para a visão selecionada
        setNovoNome('');
        setNovoWhatsapp('');
        setNovoCpf('');
        setModoPaciente('busca');

        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Paciente cadastrado e selecionado',
          showConfirmButton: false,
          timer: 2500
        });
      } else {
        setErrorMessage(dataRes.erro || 'Falha ao cadastrar paciente.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Erro de conexão com o servidor ao cadastrar paciente.');
    } finally {
      setSalvandoPaciente(false);
    }
  };

  // Submeter Agendamento
  const handleSalvarAgendamento = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedPaciente) {
      setErrorMessage('Por favor, selecione ou cadastre um paciente antes de agendar.');
      return;
    }

    if (!profissionalId || profissionalId === 0 || !servicoId || !data || !horaInicio) {
      if (profissionalId === 0) {
        setErrorMessage('Selecione um profissional habilitado para realizar este procedimento.');
      } else {
        setErrorMessage('Preencha todos os campos obrigatórios do agendamento.');
      }
      return;
    }

    setSubmitting(true);

    try {
      if (excepcional && !window.confirm('Confirmar a reserva excepcional para ' + data + ' às ' + horaInicio + '?')) return;
      const response = await apiFetch(`/api/agendamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmarFechamento: excepcional,
          paciente_id: selectedPaciente.id,
          profissional_id: Number(profissionalId),
          servico_id: Number(servicoId),
          data,
          horario_inicio: horaInicio,
          observacoes,
          tipo_atendimento: tipoAtendimento
        })
      });

      const result = await response.json();

      if (result.sucesso) {
        Swal.fire({
          icon: 'success',
          title: 'Agendamento Confirmado',
          text: [selectedPaciente.nome, data.split('-').reverse().join('/'), horaInicio, servicoSelecionado?.nome].filter(Boolean).join(' · '),
          confirmButtonColor: '#1e3a8a',
          confirmButtonText: 'Concluir'
        });

        onSuccess({ data, profissionalId: Number(profissionalId) });
        onClose();
      } else {
        if (response.status === 409) atualizarHorarios();
        const msg = result.erro && result.detalhes
          ? `${result.erro} ${result.detalhes}`
          : (result.erro || result.detalhes || 'Não foi possível realizar o agendamento.');
        setErrorMessage(msg);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Falha na comunicação com o servidor ao salvar agendamento.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden text-gray-900 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho do Modal */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-700 rounded-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">{iniciouAgendamento ? 'Novo Agendamento' : 'Consultar horários disponíveis'}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            title="Fechar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Alerta de Erro */}
          {(errorMessage || avisoServico) && (
            <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded-lg text-xs text-red-700 font-semibold flex items-start gap-2">
              <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">{errorMessage || avisoServico}</div>
            </div>
          )}

          {/* SEÇÃO 1: PACIENTE */}
          {iniciouAgendamento && <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Paciente <span className="text-red-500">*</span>
              </label>

              {/* Botão de Alternância: Buscar vs Novo Paciente */}
              <div className="flex gap-1 bg-white p-1 rounded-lg border border-gray-200 shadow-xs">
                <button
                  type="button"
                  onClick={() => setModoPaciente('busca')}
                  className={`text-xs font-semibold px-3 py-1 rounded transition-all ${
                    modoPaciente === 'busca'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Buscar
                </button>
                {!excepcional && <button
                  type="button"
                  onClick={() => setModoPaciente('novo')}
                  className={`text-xs font-semibold px-3 py-1 rounded transition-all ${
                    modoPaciente === 'novo'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Novo Paciente
                </button>}
              </div>
            </div>

            {/* SE JÁ HOUVER PACIENTE SELECIONADO */}
            {selectedPaciente ? (
              <div className="bg-white p-3 rounded-lg border border-blue-300 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-700 font-bold flex items-center justify-center text-xs">
                    <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">{selectedPaciente.nome}</h4>
                    {selectedPaciente.whatsapp && <p className="text-[11px] text-gray-600">
                      WhatsApp: {aplicarMascaraTelefone(selectedPaciente.whatsapp)}
                    </p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {admin && <button
                    type="button"
                    onClick={() => setIsHistoricoModalOpen(true)}
                    className="text-xs font-bold text-primary hover:text-primary-dark bg-secondary/15 hover:bg-secondary/25 px-2.5 py-1.5 rounded-lg border border-secondary/30 transition-all flex items-center gap-1 cursor-pointer"
                    title="Visualizar histórico de atendimentos anteriores deste paciente"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Histórico</span>
                  </button>}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPaciente(null);
                      setTermoBusca('');
                    }}
                    className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1.5 rounded hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    Trocar
                  </button>
                </div>
              </div>
            ) : modoPaciente === 'busca' ? (
              /* MODO BUSCA COM AUTOCOMPLETE */
              <div className="relative">
                <div className="relative">
                  <input
                    type="text"
                    placeholder={excepcional ? 'Buscar paciente por nome' : 'Digite nome ou telefone para buscar...'}
                    value={termoBusca}
                    onChange={e => {
                      setTermoBusca(e.target.value);
                      setMostrarDropdownBusca(true);
                    }}
                    onFocus={() => setMostrarDropdownBusca(true)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all shadow-xs"
                  />
                  <svg className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>

                {/* Lista Suspensa de Sugestões */}
                {mostrarDropdownBusca && termoBusca.length >= 2 && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden max-h-48 overflow-y-auto">
                    {pacientesFiltrados.length > 0 ? (
                      pacientesFiltrados.map(p => (
                        <div
                          key={p.id}
                          onClick={() => {
                            setSelectedPaciente(p);
                            setMostrarDropdownBusca(false);
                          }}
                          className="px-3.5 py-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between border-b border-gray-100 last:border-none transition-colors"
                        >
                          <div>
                            <p className="text-xs font-semibold text-gray-900">{p.nome || p.nome_completo}</p>
                            <p className="text-[10px] text-gray-500">{p.whatsapp && aplicarMascaraTelefone(p.whatsapp)}</p>
                          </div>
                          <span className="text-[10px] bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded">
                            Selecionar
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-center">
                        <p className="text-xs text-gray-500 mb-1">Nenhum paciente encontrado com esse termo.</p>
                        {!excepcional && <button
                          type="button"
                          onClick={() => {
                            setNovoNome(termoBusca);
                            setModoPaciente('novo');
                            setMostrarDropdownBusca(false);
                          }}
                          className="text-xs text-blue-600 font-semibold hover:underline"
                        >
                          Cadastrar "{termoBusca}" como novo paciente
                        </button>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* MODO NOVO PACIENTE */
              <form onSubmit={handleCriarPacienteRapido} className="space-y-3 bg-white p-3 rounded-lg border border-blue-200">
                <p className="text-[11px] text-gray-600 font-medium">
                  Pré-cadastro: informe os dados essenciais para o atendimento.
                </p>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Nome completo do paciente"
                    value={novoNome}
                    onChange={e => setNovoNome(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 mb-1">Telefone / WhatsApp *</label>
                    <input
                      type="text"
                      required
                      placeholder="(11) 99999-9999"
                      value={novoWhatsapp}
                      onChange={e => setNovoWhatsapp(aplicarMascaraTelefone(e.target.value))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 mb-1">CPF (Opcional)</label>
                    <input
                      type="text"
                      placeholder="000.000.000-00"
                      value={novoCpf}
                      onChange={e => setNovoCpf(aplicarMascaraCPF(e.target.value))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setModoPaciente('busca')}
                    className="text-xs text-gray-600 hover:text-gray-900 px-2.5 py-1.5 font-semibold"
                  >
                    Voltar para busca
                  </button>
                  <button
                    type="submit"
                    disabled={salvandoPaciente}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-3.5 py-1.5 rounded-md shadow-xs transition-all"
                  >
                    {salvandoPaciente ? 'Salvando...' : 'Salvar Paciente'}
                  </button>
                </div>
              </form>
            )}
          </div>}

          {/* SEÇÃO 2: SERVIÇO E PROFISSIONAL (IK-80 CA03) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Serviço */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Serviço / Procedimento *
              </label>
              <select
                value={servicoId}
                onChange={e => { setServicoId(e.target.value); setErrorMessage(anterior => anterior === AVISO_SERVICO_INDISPONIVEL ? null : anterior); }}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs text-gray-900"
              >
                <option value="">{carregandoServicos ? 'Atualizando serviços...' : 'Selecione o serviço...'}</option>
                {servicos.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.nome} ({s.duracao_minutos} min) {s.preco ? `- R$ ${Number(s.preco).toFixed(2)}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Profissional Elegível */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Profissional / Terapeuta *
                </label>
                {servicoId && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    profissionaisElegiveis.length === 0
                      ? 'text-red-700 bg-red-50 border-red-200'
                      : 'text-blue-700 bg-blue-50 border-blue-200'
                  }`}>
                    {carregandoProfissionaisElegiveis
                      ? 'Filtrando...'
                      : `${profissionaisElegiveis.length} habilitado(s)`}
                  </span>
                )}
              </div>
              <select
                value={profissionalId}
                disabled={carregandoProfissionaisElegiveis || profissionaisElegiveis.length === 0}
                onChange={e => setProfissionalId(Number(e.target.value))}
                className={`w-full p-2.5 border rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs text-gray-900 ${
                  profissionaisElegiveis.length === 0 ? 'border-amber-300 bg-amber-50/50 text-amber-800' : 'border-gray-300'
                }`}
              >
                {profissionaisElegiveis.length === 0 ? (
                  <option value="0">Nenhum profissional habilitado para este serviço</option>
                ) : (
                  profissionaisElegiveis.map(prof => (
                    <option key={prof.id} value={prof.id}>
                      {prof.nome} {prof.especialidade ? `(${prof.especialidade})` : ''}
                    </option>
                  ))
                )}
              </select>
              {servicoId && profissionaisElegiveis.length === 0 && (
                <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                  <span>⚠️</span> Nenhum profissional habilitado para este procedimento.
                </p>
              )}
            </div>
          </div>

          {/* SEÇÃO 3: DATA, HORA E CÁLCULO AUTOMÁTICO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Data da Consulta *
              </label>
              <input
                type="date"
                required
                value={data}
                onChange={e => setData(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs text-gray-900"
              />
              <span className="text-[10px] text-gray-500 mt-1 block">Disponibilidade conforme a jornada do profissional</span>
            </div>

            <div>
              <label htmlFor="horario-livre" className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Horários disponíveis *
              </label>
              <select
                id="horario-livre"
                disabled={!horarios?.livres.length}
                required
                value={horaInicio}
                onChange={e => setHoraInicio(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs text-gray-900"
              >
                <option value="">{!parametros ? 'Defina serviço, profissional e data' : !horarios ? 'Consultando horários…' : horarios.erro ? 'Consulta indisponível' : horarios.livres.length ? 'Selecione um horário' : 'Nenhum horário disponível'}</option>
                {horarios?.livres.map(hora => <option key={hora} value={hora}>{hora}</option>)}
              </select>
              {horarios?.erro && <p role="alert" className="text-xs text-red-700">{horarios.erro} <button type="button" className="underline" onClick={atualizarHorarios}>Tentar novamente</button></p>}
            </div>
          </div>

          {/* CÁLCULO AUTOMÁTICO VISUAL */}
          {calculoHorario && servicoSelecionado && (
            <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200">
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-100 mb-1">
                Cálculo de Horário
              </span>
              <p className="text-xs font-semibold text-gray-900">
                Horário previsto: <span className="text-blue-700 font-bold">{calculoHorario.horaInicio}</span> às{' '}
                <span className="text-blue-700 font-bold">{calculoHorario.horaTermino}</span>
              </p>
              <p className="text-[11px] text-gray-600 mt-0.5">
                Duração da consulta: {calculoHorario.duracao} min (reserva com intervalo até {calculoHorario.horaTerminoComBuffer})
              </p>
              {servicoSelecionado.preco !== undefined && (
                <p className="text-xs font-bold text-emerald-700 mt-1">
                  Valor da consulta: {Number(servicoSelecionado.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              )}
            </div>
          )}

          {iniciouAgendamento && <><label className="block text-xs font-bold text-gray-700">Tipo de atendimento
            <select value={tipoAtendimento} onChange={e => setTipoAtendimento(e.target.value)} className="w-full p-2 border rounded-lg">
              <option value="Primeira_Consulta">Primeira consulta</option><option value="Retorno">Retorno</option>
            </select>
          </label>
          {/* Observações */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Observações (Opcional)
            </label>
            <input
              type="text"
              placeholder="Anotações gerais sobre o agendamento"
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs"
            />
          </div></>}
        </div>

        {/* Rodapé com Botões de Ação */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
          >
            Cancelar
          </button>

          {!iniciouAgendamento ? <button
            type="button"
            onClick={() => setIniciouAgendamento(true)}
            disabled={!horaInicio}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white disabled:bg-gray-400"
          >Agendar neste horário</button> : <button
            type="button"
            onClick={handleSalvarAgendamento}
            disabled={submitting || carregandoProfissionaisElegiveis || carregandoServicos || !selectedPaciente || !servicoSelecionado || !profissionalId || !horaInicio}
            className={`px-5 py-2.5 rounded-lg font-semibold text-xs text-white shadow-xs transition-all flex items-center gap-2 ${
              !selectedPaciente
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
            }`}
          >
            {submitting ? (
              <>
                <span className="inline-block h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <span>Salvar agendamento</span>
            )}
          </button>}
        </div>
      </div>

      {/* Modal de Histórico do Paciente (IK-77) */}
      {selectedPaciente && (
        <ModalHistoricoPaciente
          isOpen={isHistoricoModalOpen}
          onClose={() => setIsHistoricoModalOpen(false)}
          pacienteId={selectedPaciente.id}
          pacienteNome={selectedPaciente.nome}
        />
      )}
    </div>
  );
}
