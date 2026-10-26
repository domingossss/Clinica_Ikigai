import React, { useState, useEffect, useMemo } from 'react';
import Swal from 'sweetalert2';

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
}

interface ModalAgendamentoRapidoProps {
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

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function ModalAgendamentoRapido({
  isOpen,
  onClose,
  onSuccess,
  initialDate,
  initialTime,
  initialProfissionalId,
  initialPacienteId,
  profissionais,
  servicos,
  pacientesExistentes = [],
  onPacienteCadastrado
}: ModalAgendamentoRapidoProps) {
  // Dados do Agendamento
  const [profissionalId, setProfissionalId] = useState<number>(initialProfissionalId || 1);
  const [servicoId, setServicoId] = useState<string>('');
  const [data, setData] = useState<string>(initialDate || new Date().toISOString().substring(0, 10));
  const [horaInicio, setHoraInicio] = useState<string>(initialTime || '09:00');
  const [observacoes, setObservacoes] = useState<string>('');

  // Controle de Paciente Selecionado
  const [selectedPaciente, setSelectedPaciente] = useState<PacienteItem | null>(null);

  // Modo de Paciente: 'busca' ou 'novo'
  const [modoPaciente, setModoPaciente] = useState<'busca' | 'novo'>('busca');

  // Estados de Busca de Paciente
  const [termoBusca, setTermoBusca] = useState<string>('');
  const [mostrarDropdownBusca, setMostrarDropdownBusca] = useState<boolean>(false);

  // Estados do Formulário de Pré-Cadastro Rápido
  const [novoNome, setNovoNome] = useState<string>('');
  const [novoWhatsapp, setNovoWhatsapp] = useState<string>('');
  const [novoCpf, setNovoCpf] = useState<string>('');
  const [salvandoPaciente, setSalvandoPaciente] = useState<boolean>(false);

  // Estados de Submissão e Erro
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Atualizar quando props iniciais mudarem
  useEffect(() => {
    if (initialDate) setData(initialDate);
    if (initialTime) setHoraInicio(initialTime);
    if (initialProfissionalId) setProfissionalId(initialProfissionalId);
    if (servicos.length > 0 && !servicoId) {
      setServicoId(servicos[0].id.toString());
    }
    if (initialPacienteId && pacientesExistentes.length > 0) {
      const p = pacientesExistentes.find(item => item.id === initialPacienteId);
      if (p) setSelectedPaciente(p);
    }
  }, [initialDate, initialTime, initialProfissionalId, initialPacienteId, servicos, pacientesExistentes]);

  // Se o modal fechar, resetar erros
  useEffect(() => {
    if (!isOpen) {
      setErrorMessage(null);
      setTermoBusca('');
      setMostrarDropdownBusca(false);
    }
  }, [isOpen]);

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
  const pacientesFiltrados = useMemo(() => {
    if (!termoBusca || termoBusca.trim().length < 2) return [];
    const buscaLimpa = termoBusca.toLowerCase().replace(/\D/g, '');
    const buscaTexto = termoBusca.toLowerCase().trim();

    return pacientesExistentes.filter(p => {
      const nomeMatch = (p.nome || p.nome_completo || '').toLowerCase().includes(buscaTexto);
      const telMatch = (p.whatsapp || p.telefone || '').replace(/\D/g, '').includes(buscaLimpa);
      return nomeMatch || (buscaLimpa.length >= 2 && telMatch);
    }).slice(0, 6);
  }, [pacientesExistentes, termoBusca]);

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
      const res = await fetch(`${API_BASE_URL}/api/pacientes/rapido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_completo: novoNome.trim(),
          whatsapp: cleanTel,
          cpf: novoCpf ? novoCpf.replace(/\D/g, '') : undefined
        })
      });

      const dataRes = await res.json();

      if (dataRes.sucesso && dataRes.dados) {
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

    if (!profissionalId || !servicoId || !data || !horaInicio) {
      setErrorMessage('Preencha todos os campos obrigatórios do agendamento.');
      return;
    }

    // Validação: apenas segunda a sexta-feira
    const dataObj = new Date(data + 'T12:00:00');
    const diaSemana = dataObj.getDay();
    if (diaSemana === 0 || diaSemana === 6) {
      setErrorMessage('Agendamentos permitidos apenas de segunda a sexta-feira.');
      return;
    }

    // Validação: das 08:00 às 18:00
    const [h, m] = horaInicio.split(':').map(Number);
    const inicioMins = h * 60 + m;
    if (inicioMins < 8 * 60 || inicioMins >= 18 * 60) {
      setErrorMessage('O horário deve ser entre 08:00 e 18:00.');
      return;
    }

    if (servicoSelecionado && (inicioMins + servicoSelecionado.duracao_minutos > 18 * 60)) {
      setErrorMessage(`Com a duração de ${servicoSelecionado.duracao_minutos} min, o atendimento ultrapassa as 18:00.`);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/agendamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paciente_id: selectedPaciente.id,
          profissional_id: Number(profissionalId),
          servico_id: Number(servicoId),
          data,
          horario_inicio: horaInicio
        })
      });

      const result = await response.json();

      if (result.sucesso) {
        Swal.fire({
          icon: 'success',
          title: 'Agendamento Confirmado',
          html: `
            <div class="text-sm text-left mt-2 space-y-1">
              <p><strong>Paciente:</strong> ${selectedPaciente.nome}</p>
              <p><strong>Data:</strong> ${data.split('-').reverse().join('/')}</p>
              <p><strong>Horário:</strong> ${horaInicio} às ${calculoHorario?.horaTermino || ''}</p>
              <p><strong>Serviço:</strong> ${servicoSelecionado?.nome || ''}</p>
            </div>
          `,
          confirmButtonColor: '#1e3a8a',
          confirmButtonText: 'Concluir'
        });

        onSuccess({ data, profissionalId: Number(profissionalId) });
        onClose();
      } else {
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
              <h3 className="text-base font-bold text-gray-900">Novo Agendamento</h3>
              <p className="text-xs text-gray-500">Agendamento de consulta e cálculo automático de horário</p>
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
          {errorMessage && (
            <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded-lg text-xs text-red-700 font-semibold flex items-start gap-2">
              <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {/* SEÇÃO 1: PACIENTE */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
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
                <button
                  type="button"
                  onClick={() => setModoPaciente('novo')}
                  className={`text-xs font-semibold px-3 py-1 rounded transition-all ${
                    modoPaciente === 'novo'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Novo Paciente
                </button>
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
                    <p className="text-[11px] text-gray-600">
                      WhatsApp: {aplicarMascaraTelefone(selectedPaciente.whatsapp)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPaciente(null);
                    setTermoBusca('');
                  }}
                  className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  Trocar
                </button>
              </div>
            ) : modoPaciente === 'busca' ? (
              /* MODO BUSCA COM AUTOCOMPLETE */
              <div className="relative">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Digite nome ou telefone para buscar..."
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
                            <p className="text-[10px] text-gray-500">{aplicarMascaraTelefone(p.whatsapp)}</p>
                          </div>
                          <span className="text-[10px] bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded">
                            Selecionar
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-center">
                        <p className="text-xs text-gray-500 mb-1">Nenhum paciente encontrado com esse termo.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setNovoNome(termoBusca);
                            setModoPaciente('novo');
                            setMostrarDropdownBusca(false);
                          }}
                          className="text-xs text-blue-600 font-semibold hover:underline"
                        >
                          Cadastrar "{termoBusca}" como novo paciente
                        </button>
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
          </div>

          {/* SEÇÃO 2: PROFISSIONAL E SERVIÇO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Profissional */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Profissional / Terapeuta *
              </label>
              <select
                value={profissionalId}
                onChange={e => setProfissionalId(Number(e.target.value))}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs text-gray-900"
              >
                {profissionais.map(prof => (
                  <option key={prof.id} value={prof.id}>
                    {prof.nome} {prof.especialidade ? `(${prof.especialidade})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Serviço */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Serviço *
              </label>
              <select
                value={servicoId}
                onChange={e => setServicoId(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs text-gray-900"
              >
                <option value="">Selecione o serviço...</option>
                {servicos.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.nome} ({s.duracao_minutos} min) {s.preco ? `- R$ ${Number(s.preco).toFixed(2)}` : ''}
                  </option>
                ))}
              </select>
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
              <span className="text-[10px] text-gray-500 mt-1 block">Atendimento: Segunda a Sexta-feira</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Horário de Início *
              </label>
              <input
                type="time"
                min="08:00"
                max="18:00"
                required
                value={horaInicio}
                onChange={e => setHoraInicio(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-xs text-gray-900"
              />
              <span className="text-[10px] text-gray-500 mt-1 block">Expediente: 08:00 às 18:00</span>
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
            </div>
          )}

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
          </div>
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

          <button
            type="button"
            onClick={handleSalvarAgendamento}
            disabled={submitting || !selectedPaciente}
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
          </button>
        </div>
      </div>
    </div>
  );
}
