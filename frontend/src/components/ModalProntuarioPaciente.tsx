import { useState, useEffect, useCallback, useRef, useMemo, type FormEvent } from 'react';
import Swal from 'sweetalert2';
import { apiFetch, lerJsonSeguro } from '../api';
import { useDialogAcessivel } from '../hooks/useDialogAcessivel';
import { obterDataClinicaISO } from '../utils/formatacao';

export interface ConsultaLinhaTempo {
  id: number;
  data: string;
  horario_inicio: string;
  horario_fim: string;
  status: string;
  servico_nome: string;
  duracao_minutos: number;
  profissional_id: number;
  profissional_nome: string;
  profissional_especialidade: string;
  id_prontuario: number | null;
  anamnese: string | null;
  exame_fisico: string | null;
  hipoteses_diagnosticas: string | null;
  prescricoes: string | null;
  evolucao: string | null;
  exames_laudos: string | null;
  prontuario_atualizado_em: string | null;
}

interface PacienteIdentificacao {
  id: string;
  id_paciente: number;
  versao: number;
  nome_completo: string;
  cpf: string | null;
  rg: string | null;
  data_nascimento: string | null;
  sexo: string | null;
  filiacao: string | null;
  naturalidade: string | null;
  telefone: string | null;
  whatsapp: string | null;
  endereco: string | null;
  etapa_tratamento: string | null;
  historico_clinico: string | null;
  observacoes: string | null;
}

interface SnapshotFormulario {
  dataNascimento: string;
  sexo: string;
  filiacao: string;
  naturalidade: string;
  rg: string;
  endereco: string;
  etapaTratamento: string;
  anamnese: string;
  exameFisico: string;
  hipotesesDiagnosticas: string;
  prescricoes: string;
  evolucao: string;
  examesLaudos: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  pacienteId: string;
  pacienteNome?: string;
  agendamentoInicialId?: number | null;
  statusAgendamentoAtual?: string;
  transicoesPermitidas?: string[];
  atualizandoStatus?: boolean;
  somenteClinico?: boolean;
  onAtualizarStatus?: (novoStatus: string) => void;
  onAbrirReagendamento?: () => void;
  onSaved?: () => void;
}

const MAX_TEXTO_CLINICO = 5000;

function formatarDataBR(dataStr?: string | null): string {
  if (!dataStr) return '—';
  const partes = dataStr.split('-');
  if (partes.length !== 3) return dataStr;
  const [y, m, d] = partes;
  return `${d}/${m}/${y}`;
}

function chaveRascunho(pacienteId: string, consultaId: number | null): string {
  return `ikigai:rascunho-prontuario:${pacienteId}:${consultaId ?? 'geral'}`;
}

function lerRascunho(chave: string): Partial<SnapshotFormulario> | null {
  try {
    const bruto = sessionStorage.getItem(chave);
    if (!bruto) return null;
    const parsed = JSON.parse(bruto);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<SnapshotFormulario>) : null;
  } catch {
    return null;
  }
}

function limparRascunho(chave: string) {
  try {
    sessionStorage.removeItem(chave);
  } catch {
    // ignore storage errors
  }
}

function criarSnapshot(
  consulta: ConsultaLinhaTempo | undefined,
  pac: PacienteIdentificacao | null
): SnapshotFormulario {
  return {
    dataNascimento: pac?.data_nascimento || '',
    sexo: pac?.sexo || 'Outro',
    filiacao: pac?.filiacao || '',
    naturalidade: pac?.naturalidade || '',
    rg: pac?.rg || '',
    endereco: pac?.endereco || '',
    etapaTratamento: pac?.etapa_tratamento || 'Avaliação',
    anamnese: consulta ? (consulta.anamnese || '') : (pac?.historico_clinico || ''),
    exameFisico: consulta?.exame_fisico || '',
    hipotesesDiagnosticas: consulta?.hipoteses_diagnosticas || '',
    prescricoes: consulta?.prescricoes || '',
    evolucao: consulta ? (consulta.evolucao || '') : (pac?.observacoes || ''),
    examesLaudos: consulta?.exames_laudos || '',
  };
}

export default function ModalProntuarioPaciente({
  isOpen,
  onClose,
  pacienteId,
  pacienteNome,
  agendamentoInicialId,
  statusAgendamentoAtual,
  transicoesPermitidas = [],
  atualizandoStatus = false,
  somenteClinico = false,
  onAtualizarStatus,
  onAbrirReagendamento,
  onSaved,
}: Props) {
  const [recarregarSeq, setRecarregarSeq] = useState(0);
  const [chaveConcluida, setChaveConcluida] = useState('');
  const chaveAtual = isOpen && pacienteId ? `${pacienteId}:${recarregarSeq}` : '';
  const carregando = Boolean(chaveAtual) && chaveConcluida !== chaveAtual;

  const [salvando, setSalvando] = useState(false);
  const envioRef = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conflitoVersao, setConflitoVersao] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [rascunhoRestaurado, setRascunhoRestaurado] = useState(false);

  const [paciente, setPaciente] = useState<PacienteIdentificacao | null>(null);
  const [linhaDoTempo, setLinhaDoTempo] = useState<ConsultaLinhaTempo[]>([]);
  const [consultaSelecionadaId, setConsultaSelecionadaId] = useState<number | null>(
    agendamentoInicialId ?? null
  );
  const consultaSelecionadaRef = useRef<number | null>(agendamentoInicialId ?? null);

  // 1. Identificação do paciente
  const [dataNascimento, setDataNascimento] = useState('');
  const [sexo, setSexo] = useState('Outro');
  const [filiacao, setFiliacao] = useState('');
  const [naturalidade, setNaturalidade] = useState('');
  const [rg, setRg] = useState('');
  const [endereco, setEndereco] = useState('');
  const [etapaTratamento, setEtapaTratamento] = useState('Avaliação');

  // 2 a 7. Campos clínicos do Prontuário da Consulta Selecionada
  const [anamnese, setAnamnese] = useState('');
  const [exameFisico, setExameFisico] = useState('');
  const [hipotesesDiagnosticas, setHipotesesDiagnosticas] = useState('');
  const [prescricoes, setPrescricoes] = useState('');
  const [evolucao, setEvolucao] = useState('');
  const [examesLaudos, setExamesLaudos] = useState('');

  const [snapshotInicial, setSnapshotInicial] = useState<SnapshotFormulario | null>(null);
  const hojeClinica = obterDataClinicaISO();

  const aplicarFormulario = useCallback(
    (base: SnapshotFormulario, pacId: string, consultaId: number | null) => {
      setSnapshotInicial(base);
      const rascunho = lerRascunho(chaveRascunho(pacId, consultaId));
      const fonte = rascunho ? { ...base, ...rascunho } : base;
      setRascunhoRestaurado(Boolean(rascunho));

      setDataNascimento(fonte.dataNascimento);
      setSexo(fonte.sexo);
      setFiliacao(fonte.filiacao);
      setNaturalidade(fonte.naturalidade);
      setRg(fonte.rg);
      setEndereco(fonte.endereco);
      setEtapaTratamento(fonte.etapaTratamento);
      setAnamnese(fonte.anamnese);
      setExameFisico(fonte.exameFisico);
      setHipotesesDiagnosticas(fonte.hipotesesDiagnosticas);
      setPrescricoes(fonte.prescricoes);
      setEvolucao(fonte.evolucao);
      setExamesLaudos(fonte.examesLaudos);
    },
    []
  );

  const estadoAtualForm = useMemo<SnapshotFormulario>(
    () => ({
      dataNascimento,
      sexo,
      filiacao,
      naturalidade,
      rg,
      endereco,
      etapaTratamento,
      anamnese,
      exameFisico,
      hipotesesDiagnosticas,
      prescricoes,
      evolucao,
      examesLaudos,
    }),
    [
      dataNascimento,
      sexo,
      filiacao,
      naturalidade,
      rg,
      endereco,
      etapaTratamento,
      anamnese,
      exameFisico,
      hipotesesDiagnosticas,
      prescricoes,
      evolucao,
      examesLaudos,
    ]
  );

  const temAlteracoesNaoSalvas = useMemo(() => {
    if (!snapshotInicial) return false;
    return (Object.keys(snapshotInicial) as (keyof SnapshotFormulario)[]).some(
      campo => estadoAtualForm[campo] !== snapshotInicial[campo]
    );
  }, [estadoAtualForm, snapshotInicial]);

  // Salva rascunho localmente enquanto houver alterações não salvas
  useEffect(() => {
    if (!isOpen || !pacienteId || carregando || !snapshotInicial) return;
    const chave = chaveRascunho(pacienteId, consultaSelecionadaId);
    if (temAlteracoesNaoSalvas) {
      try {
        sessionStorage.setItem(chave, JSON.stringify(estadoAtualForm));
      } catch {
        // ignore quota errors
      }
    } else {
      limparRascunho(chave);
    }
  }, [isOpen, pacienteId, consultaSelecionadaId, carregando, snapshotInicial, temAlteracoesNaoSalvas, estadoAtualForm]);

  // Alerta ao fechar/atualizar a aba do navegador com rascunho pendente
  useEffect(() => {
    if (!isOpen || !temAlteracoesNaoSalvas) return;
    function avisarSaida(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', avisarSaida);
    return () => window.removeEventListener('beforeunload', avisarSaida);
  }, [isOpen, temAlteracoesNaoSalvas]);

  // Carregamento assíncrono do prontuário sem setState síncrono no effect
  useEffect(() => {
    if (!isOpen || !pacienteId) return;
    const controller = new AbortController();
    const chaveExecucao = `${pacienteId}:${recarregarSeq}`;

    async function buscar() {
      try {
        const res = await apiFetch(`/api/pacientes/${encodeURIComponent(pacienteId)}/prontuario`, {
          signal: controller.signal,
        });
        const json = await lerJsonSeguro<{
          sucesso?: boolean;
          erro?: string;
          dados?: { paciente: PacienteIdentificacao; linha_do_tempo?: ConsultaLinhaTempo[] };
        }>(res);
        if (controller.signal.aborted) return;
        if (!res.ok || !json?.sucesso || !json.dados?.paciente) {
          throw new Error(json?.erro || 'Não foi possível carregar o prontuário do paciente.');
        }

        const pac = json.dados.paciente;
        const consultas = json.dados.linha_do_tempo || [];

        setErro(null);
        setConflitoVersao(false);
        setPaciente(pac);
        setLinhaDoTempo(consultas);

        const atualRef = consultaSelecionadaRef.current;
        const alvoId =
          atualRef && consultas.some(c => Number(c.id) === Number(atualRef))
            ? Number(atualRef)
            : agendamentoInicialId && consultas.some(c => Number(c.id) === Number(agendamentoInicialId))
            ? Number(agendamentoInicialId)
            : consultas[0]?.id ?? null;

        consultaSelecionadaRef.current = alvoId;
        setConsultaSelecionadaId(alvoId);
        const consultaAlvo = consultas.find(c => Number(c.id) === Number(alvoId));
        aplicarFormulario(criarSnapshot(consultaAlvo, pac), pacienteId, alvoId);
      } catch (err) {
        if (controller.signal.aborted) return;
        setErro(err instanceof Error ? err.message : 'Erro ao carregar prontuário.');
      } finally {
        if (!controller.signal.aborted) {
          setChaveConcluida(chaveExecucao);
        }
      }
    }

    void buscar();
    return () => controller.abort();
  }, [isOpen, pacienteId, agendamentoInicialId, recarregarSeq, aplicarFormulario]);

  const tentarFechar = useCallback(async () => {
    if (salvando) return;
    if (temAlteracoesNaoSalvas) {
      const confirmacao = await Swal.fire({
        icon: 'warning',
        titleText: 'Descartar alterações não salvas?',
        text: 'Existem anotações no prontuário que ainda não foram salvas no servidor. Um rascunho temporário foi mantido neste navegador, mas recomendamos salvar antes de fechar.',
        showCancelButton: true,
        confirmButtonText: 'Fechar sem salvar',
        cancelButtonText: 'Continuar editando',
        confirmButtonColor: '#b91c1c',
      });
      if (!confirmacao.isConfirmed) return;
    }
    onClose();
  }, [salvando, temAlteracoesNaoSalvas, onClose]);

  const dialogoRef = useDialogAcessivel(isOpen, () => {
    void tentarFechar();
  }, salvando);

  if (!isOpen) return null;

  const consultaAtiva = linhaDoTempo.find(c => Number(c.id) === Number(consultaSelecionadaId));

  async function selecionarConsultaNaLinhaDoTempo(consulta: ConsultaLinhaTempo) {
    if (Number(consulta.id) === Number(consultaSelecionadaId)) return;
    if (temAlteracoesNaoSalvas) {
      const confirmacao = await Swal.fire({
        icon: 'question',
        titleText: 'Trocar de consulta na linha do tempo?',
        text: 'Você tem alterações não salvas na consulta atual. Salve antes de trocar para evitar perda de dados.',
        showCancelButton: true,
        confirmButtonText: 'Trocar mesmo assim',
        cancelButtonText: 'Voltar para salvar',
        confirmButtonColor: '#0f766e',
      });
      if (!confirmacao.isConfirmed) return;
    }

    consultaSelecionadaRef.current = consulta.id;
    setConsultaSelecionadaId(consulta.id);
    aplicarFormulario(criarSnapshot(consulta, paciente), pacienteId, consulta.id);
    setMensagemSucesso(null);
    setErro(null);
  }

  async function handleAtualizarStatusSeguro(novoStatus: string) {
    if (!onAtualizarStatus) return;
    if (novoStatus === 'Cancelado' || novoStatus === 'No_Show') {
      const rotulo = novoStatus === 'No_Show' ? 'Não compareceu' : 'Cancelado';
      const confirmacao = await Swal.fire({
        icon: 'warning',
        titleText: `Confirmar status "${rotulo}"?`,
        text: 'Esta ação encerra o atendimento na grade e impede novas edições deste agendamento.',
        showCancelButton: true,
        confirmButtonText: `Confirmar: ${rotulo}`,
        cancelButtonText: 'Voltar',
        confirmButtonColor: '#b91c1c',
      });
      if (!confirmacao.isConfirmed) return;
    }
    onAtualizarStatus(novoStatus);
  }

  async function handleSalvarProntuario(e: FormEvent) {
    e.preventDefault();
    if (!pacienteId || envioRef.current) return;

    if (!somenteClinico && dataNascimento && dataNascimento > hojeClinica) {
      setErro('A data de nascimento não pode estar no futuro.');
      return;
    }

    envioRef.current = true;
    setSalvando(true);
    setErro(null);
    setConflitoVersao(false);
    setMensagemSucesso(null);

    try {
      const payload: Record<string, unknown> = {
        versao: paciente?.versao,
        agendamento_id: consultaSelecionadaId,
        etapa_tratamento: etapaTratamento,
        anamnese: anamnese || null,
        exame_fisico: exameFisico || null,
        hipoteses_diagnosticas: hipotesesDiagnosticas || null,
        prescricoes: prescricoes || null,
        evolucao: evolucao || null,
        exames_laudos: examesLaudos || null,
      };
      // Quando ainda não há consulta selecionada, persiste o resumo geral em historico_clinico/observacoes
      // para nunca descartar silenciosamente anotações digitadas.
      if (!consultaSelecionadaId) {
        payload.historico_clinico = anamnese || null;
        payload.observacoes = evolucao || null;
      }

      if (!somenteClinico) {
        payload.data_nascimento = dataNascimento || null;
        payload.sexo = sexo;
        payload.filiacao = filiacao || null;
        payload.naturalidade = naturalidade || null;
        payload.rg = rg || null;
        payload.endereco = endereco || null;
      }

      const res = await apiFetch(`/api/pacientes/${encodeURIComponent(pacienteId)}/prontuario`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await lerJsonSeguro<{
        sucesso?: boolean;
        erro?: string;
        dados?: { versao?: number };
      }>(res);

      if (res.status === 409) {
        setConflitoVersao(true);
        throw new Error(
          json?.erro ||
            'Este prontuário foi atualizado em outra aba ou por outro profissional. Recarregue para evitar sobrescrever dados.'
        );
      }

      if (!res.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Não foi possível salvar o prontuário.');
      }

      limparRascunho(chaveRascunho(pacienteId, consultaSelecionadaId));
      setRascunhoRestaurado(false);
      if (typeof json.dados?.versao === 'number') {
        const novaVersao = json.dados.versao;
        setPaciente(prev => (prev ? { ...prev, versao: novaVersao } : prev));
      }
      setSnapshotInicial(estadoAtualForm);
      setMensagemSucesso('Prontuário salvo com sucesso e atualizado na linha do tempo do paciente!');
      setRecarregarSeq(seq => seq + 1);
      onSaved?.();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar prontuário.');
    } finally {
      envioRef.current = false;
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={e => {
        if (e.target === e.currentTarget) void tentarFechar();
      }}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-label="Prontuário Clínico e Linha do Tempo"
        tabIndex={-1}
        className="bg-white rounded-2xl max-w-6xl w-full max-h-[92vh] shadow-2xl border border-gray/15 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 focus:outline-none"
      >
        {/* Cabeçalho do Modal */}
        <div className="bg-primary text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-secondary-light text-[11px] font-bold">
                Prontuário Clínico & Linha do Tempo
              </span>
              <h2 className="text-base sm:text-lg font-bold">
                {paciente?.nome_completo || pacienteNome || 'Paciente'}
              </h2>
              {temAlteracoesNaoSalvas && (
                <span className="px-2 py-0.5 rounded-full bg-amber-400/25 text-amber-100 border border-amber-300/40 text-[10px] font-bold">
                  Alterações não salvas
                </span>
              )}
            </div>
            <p className="text-xs text-white/80 mt-0.5">
              {consultaAtiva
                ? `Consulta selecionada: ${formatarDataBR(consultaAtiva.data)} às ${consultaAtiva.horario_inicio} • ${consultaAtiva.servico_nome} (${consultaAtiva.status})`
                : 'Todos os campos clínicos são opcionais e ficam salvos no histórico do paciente'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void tentarFechar()}
            className="text-white/80 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Fechar prontuário"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Barra de Ações Rápidas do Atendimento da Grade */}
        {onAtualizarStatus && (
          <div className="px-6 py-3 bg-light-gray/60 border-b border-gray/15 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-dark">Status desta consulta na Grade:</span>
              <span className="px-2.5 py-0.5 rounded-full font-bold bg-white border border-gray/20 text-primary">
                {statusAgendamentoAtual || consultaAtiva?.status || 'Agendado'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {transicoesPermitidas.map(novoStatus => (
                <button
                  key={novoStatus}
                  type="button"
                  disabled={atualizandoStatus}
                  onClick={() => void handleAtualizarStatusSeguro(novoStatus)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer disabled:opacity-50 ${
                    novoStatus === 'Cancelado' || novoStatus === 'No_Show'
                      ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                      : novoStatus === 'Em Atendimento'
                      ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700 shadow-xs'
                      : novoStatus === 'Concluído'
                      ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 shadow-xs'
                      : 'bg-white text-dark border-gray/25 hover:bg-light-gray'
                  }`}
                >
                  {novoStatus === 'No_Show' ? 'Não compareceu' : `Marcar: ${novoStatus}`}
                </button>
              ))}
              {onAbrirReagendamento && (
                <button
                  type="button"
                  onClick={onAbrirReagendamento}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-white transition-all cursor-pointer"
                >
                  Reagendar
                </button>
              )}
            </div>
          </div>
        )}

        {/* Corpo Principal */}
        {carregando ? (
          <div className="p-12 text-center text-xs text-gray font-semibold">
            Carregando prontuário e linha do tempo do paciente…
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* COLUNA ESQUERDA (7/12): Formulário do Prontuário Completo */}
            <form onSubmit={handleSalvarProntuario} className="lg:col-span-7 space-y-5">
              {rascunhoRestaurado && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
                  <span>Rascunho local restaurado automaticamente. Clique em salvar para gravar no prontuário.</span>
                  <button
                    type="button"
                    onClick={() => {
                      limparRascunho(chaveRascunho(pacienteId, consultaSelecionadaId));
                      aplicarFormulario(criarSnapshot(consultaAtiva, paciente), pacienteId, consultaSelecionadaId);
                    }}
                    className="font-bold underline cursor-pointer"
                  >
                    Descartar rascunho
                  </button>
                </div>
              )}

              {erro && (
                <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex flex-wrap items-center justify-between gap-2">
                  <span>{erro}</span>
                  {conflitoVersao && (
                    <button
                      type="button"
                      onClick={() => {
                        limparRascunho(chaveRascunho(pacienteId, consultaSelecionadaId));
                        setConflitoVersao(false);
                        setRecarregarSeq(seq => seq + 1);
                      }}
                      className="px-3 py-1 rounded-lg bg-red-700 text-white font-bold hover:bg-red-800 cursor-pointer"
                    >
                      Recarregar versão atual
                    </button>
                  )}
                </div>
              )}
              {mensagemSucesso && (
                <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">
                  ✓ {mensagemSucesso}
                </div>
              )}

              {/* 1. Identificação do Paciente */}
              <section className="rounded-xl border border-gray/15 bg-light-gray/25 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <span>1. Identificação do Paciente</span>
                  </h3>
                  <span className="text-[11px] text-gray font-mono">
                    CPF: {paciente?.cpf || 'Não informado'}
                  </span>
                </div>
                {somenteClinico && (
                  <p className="text-[11px] text-gray">
                    Os dados cadastrais são gerenciados pela Recepção. Você pode atualizar a etapa do tratamento e as anotações clínicas abaixo.
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-gray mb-1">Nome Completo</label>
                    <input
                      type="text"
                      disabled
                      value={paciente?.nome_completo || ''}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/20 bg-gray-100 text-dark font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-dark mb-1">Data de Nascimento</label>
                    <input
                      type="date"
                      disabled={somenteClinico}
                      max={hojeClinica}
                      value={dataNascimento}
                      onChange={e => setDataNascimento(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark disabled:bg-gray-100 disabled:text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-dark mb-1">Sexo</label>
                    <select
                      disabled={somenteClinico}
                      value={sexo}
                      onChange={e => setSexo(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark disabled:bg-gray-100 disabled:text-gray-600"
                    >
                      <option value="Feminino">Feminino</option>
                      <option value="Masculino">Masculino</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-dark mb-1">Número de RG</label>
                    <input
                      type="text"
                      disabled={somenteClinico}
                      maxLength={30}
                      value={rg}
                      onChange={e => setRg(e.target.value)}
                      placeholder="Opcional"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark disabled:bg-gray-100 disabled:text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-dark mb-1">Naturalidade</label>
                    <input
                      type="text"
                      disabled={somenteClinico}
                      maxLength={100}
                      value={naturalidade}
                      onChange={e => setNaturalidade(e.target.value)}
                      placeholder="Cidade / UF (Opcional)"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark disabled:bg-gray-100 disabled:text-gray-600"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-dark mb-1">Filiação</label>
                    <input
                      type="text"
                      disabled={somenteClinico}
                      maxLength={150}
                      value={filiacao}
                      onChange={e => setFiliacao(e.target.value)}
                      placeholder="Nome dos pais / responsáveis (Opcional)"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark disabled:bg-gray-100 disabled:text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray mb-1">Telefones</label>
                    <input
                      type="text"
                      disabled
                      value={paciente?.telefone || paciente?.whatsapp || 'Não informado'}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/20 bg-gray-100 text-dark font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-dark mb-1">Endereço</label>
                    <input
                      type="text"
                      disabled={somenteClinico}
                      maxLength={255}
                      value={endereco}
                      onChange={e => setEndereco(e.target.value)}
                      placeholder="Endereço residencial"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark disabled:bg-gray-100 disabled:text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-dark mb-1">Etapa do Tratamento</label>
                    <select
                      value={etapaTratamento}
                      onChange={e => setEtapaTratamento(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark font-semibold"
                    >
                      <option value="Avaliação">Avaliação</option>
                      <option value="Em Tratamento">Em Tratamento</option>
                      <option value="Retorno">Retorno</option>
                      <option value="Manutenção">Manutenção</option>
                      <option value="Alta">Alta Clínica</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Aviso claro quando ainda não há consulta selecionada na linha do tempo */}
              {!consultaSelecionadaId && (
                <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900">
                  Este paciente ainda não possui consultas na linha do tempo. Você pode salvar a <strong>Identificação</strong>, a <strong>Etapa do Tratamento</strong>, a <strong>Anamnese/Histórico Geral</strong> e a <strong>Evolução/Observações Gerais</strong>; os campos específicos da sessão (Exame Físico, Hipóteses, Prescrições e Exames/Laudos) ficam liberados assim que houver uma consulta agendada.
                </div>
              )}

              {/* 2. Folha de Admissão / Anamnese */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prontuario-anamnese" className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                    2. Folha de Admissão / Anamnese (Opcional)
                  </label>
                  <span className="text-[10px] text-gray font-mono">{anamnese.length}/{MAX_TEXTO_CLINICO}</span>
                </div>
                <p className="text-[11px] text-gray">
                  Histórico de saúde do paciente, queixa principal, história da doença atual, doenças passadas, vacinações e histórico familiar.
                </p>
                <textarea
                  id="prontuario-anamnese"
                  rows={3}
                  maxLength={MAX_TEXTO_CLINICO}
                  value={anamnese}
                  onChange={e => setAnamnese(e.target.value)}
                  placeholder="Registre a queixa principal, história da doença atual, antecedentes pessoais e familiares..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              {/* 3. Exame Físico */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prontuario-exame" className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                    3. Exame Físico (Opcional)
                  </label>
                  <span className="text-[10px] text-gray font-mono">{exameFisico.length}/{MAX_TEXTO_CLINICO}</span>
                </div>
                <p className="text-[11px] text-gray">
                  Dados coletados pelo profissional durante a avaliação clínica do paciente.
                </p>
                <textarea
                  id="prontuario-exame"
                  rows={2}
                  maxLength={MAX_TEXTO_CLINICO}
                  disabled={!consultaSelecionadaId}
                  value={exameFisico}
                  onChange={e => setExameFisico(e.target.value)}
                  placeholder={consultaSelecionadaId ? 'Sinais vitais, achados clínicos e avaliação física...' : 'Disponível ao selecionar uma consulta na linha do tempo.'}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </section>

              {/* 4. Hipóteses Diagnósticas e Diagnóstico */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prontuario-hipoteses" className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                    4. Hipóteses Diagnósticas e Diagnóstico (Opcional)
                  </label>
                  <span className="text-[10px] text-gray font-mono">{hipotesesDiagnosticas.length}/{MAX_TEXTO_CLINICO}</span>
                </div>
                <p className="text-[11px] text-gray">
                  Avaliação técnica inicial ou conclusiva do quadro de saúde.
                </p>
                <textarea
                  id="prontuario-hipoteses"
                  rows={2}
                  maxLength={MAX_TEXTO_CLINICO}
                  disabled={!consultaSelecionadaId}
                  value={hipotesesDiagnosticas}
                  onChange={e => setHipotesesDiagnosticas(e.target.value)}
                  placeholder={consultaSelecionadaId ? 'Hipóteses diagnósticas, diagnóstico clínico ou integrativo...' : 'Disponível ao selecionar uma consulta na linha do tempo.'}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </section>

              {/* 5. Prescrições */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prontuario-prescricoes" className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                    5. Prescrições e Plano Terapêutico (Opcional)
                  </label>
                  <span className="text-[10px] text-gray font-mono">{prescricoes.length}/{MAX_TEXTO_CLINICO}</span>
                </div>
                <p className="text-[11px] text-gray">
                  Orientações de tratamento médico (focadas na doença) e planos de cuidados da enfermagem ou equipe multiprofissional.
                </p>
                <textarea
                  id="prontuario-prescricoes"
                  rows={2}
                  maxLength={MAX_TEXTO_CLINICO}
                  disabled={!consultaSelecionadaId}
                  value={prescricoes}
                  onChange={e => setPrescricoes(e.target.value)}
                  placeholder={consultaSelecionadaId ? 'Prescrições, fitoterápicos, suplementação, orientações e plano de cuidados...' : 'Disponível ao selecionar uma consulta na linha do tempo.'}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </section>

              {/* 6. Folha de Evolução */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prontuario-evolucao" className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                    6. Folha de Evolução (Opcional)
                  </label>
                  <span className="text-[10px] text-gray font-mono">{evolucao.length}/{MAX_TEXTO_CLINICO}</span>
                </div>
                <p className="text-[11px] text-gray">
                  Anotações periódicas sobre o estado de saúde do paciente e a resposta aos tratamentos.
                </p>
                <textarea
                  id="prontuario-evolucao"
                  rows={3}
                  maxLength={MAX_TEXTO_CLINICO}
                  value={evolucao}
                  onChange={e => setEvolucao(e.target.value)}
                  placeholder="Evolução clínica do dia, resposta ao tratamento anterior e conduta realizada na sessão..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              {/* 7. Resultados de Exames e Laudos */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prontuario-laudos" className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                    7. Resultados de Exames e Laudos (Opcional)
                  </label>
                  <span className="text-[10px] text-gray font-mono">{examesLaudos.length}/{MAX_TEXTO_CLINICO}</span>
                </div>
                <p className="text-[11px] text-gray">
                  Exames laboratoriais, de imagem, termos de consentimento e laudos anexados ao longo do acompanhamento.
                </p>
                <textarea
                  id="prontuario-laudos"
                  rows={2}
                  maxLength={MAX_TEXTO_CLINICO}
                  disabled={!consultaSelecionadaId}
                  value={examesLaudos}
                  onChange={e => setExamesLaudos(e.target.value)}
                  placeholder={consultaSelecionadaId ? 'Resultados de exames laboratoriais, imagem, laudos e termos de consentimento...' : 'Disponível ao selecionar uma consulta na linha do tempo.'}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </section>

              <div className="pt-2 space-y-2 sticky bottom-0 bg-white py-3 border-t border-gray/15">
                {erro && (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-red-700">
                    <span>{erro}</span>
                    {conflitoVersao && (
                      <button
                        type="button"
                        onClick={() => {
                          limparRascunho(chaveRascunho(pacienteId, consultaSelecionadaId));
                          setConflitoVersao(false);
                          setRecarregarSeq(seq => seq + 1);
                        }}
                        className="px-3 py-1 rounded-lg bg-red-700 text-white font-bold hover:bg-red-800 cursor-pointer"
                      >
                        Recarregar versão atual
                      </button>
                    )}
                  </div>
                )}
                {mensagemSucesso && (
                  <p role="status" className="text-xs font-semibold text-emerald-700">
                    ✓ {mensagemSucesso}
                  </p>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => void tentarFechar()}
                    className="px-4 py-2.5 rounded-xl border border-gray/25 text-xs font-bold text-gray hover:text-dark hover:bg-light-gray cursor-pointer"
                  >
                    Fechar
                  </button>
                  <button
                    type="submit"
                    disabled={salvando}
                    className="px-5 py-2.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {salvando ? 'Salvando Prontuário...' : 'Salvar Prontuário no Histórico'}
                  </button>
                </div>
              </div>
            </form>

            {/* COLUNA DIREITA (5/12): Linha do Tempo Vertical */}
            <aside className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-gray/15 lg:pl-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-dark flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold">
                    Linha do Tempo
                  </span>
                  Histórico de Consultas e Prontuários
                </h3>
                <p className="text-xs text-gray mt-1">
                  Clique em qualquer consulta da linha do tempo para visualizar ou editar o prontuário daquele dia.
                </p>
              </div>

              {linhaDoTempo.length === 0 ? (
                <div className="p-6 rounded-xl bg-light-gray/40 border border-gray/15 text-center text-xs text-gray">
                  Nenhuma consulta encontrada para este paciente na sua agenda.
                </div>
              ) : (
                <div className="relative pl-6 border-l-2 border-primary/25 space-y-5 ml-2">
                  {linhaDoTempo.map(item => {
                    const isSelecionada = Number(item.id) === Number(consultaSelecionadaId);
                    const temProntuario = Boolean(
                      item.anamnese ||
                        item.exame_fisico ||
                        item.hipoteses_diagnosticas ||
                        item.prescricoes ||
                        item.evolucao ||
                        item.exames_laudos
                    );

                    return (
                      <div key={item.id} className="relative">
                        <span
                          aria-hidden="true"
                          className={`absolute -left-[31px] top-3 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            isSelecionada
                              ? 'bg-primary border-primary ring-4 ring-primary/20'
                              : temProntuario
                              ? 'bg-emerald-500 border-white shadow-xs'
                              : 'bg-white border-primary/50'
                          }`}
                        />

                        <button
                          type="button"
                          onClick={() => void selecionarConsultaNaLinhaDoTempo(item)}
                          aria-pressed={isSelecionada}
                          className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                            isSelecionada
                              ? 'bg-primary/5 border-primary shadow-sm ring-1 ring-primary/30'
                              : 'bg-white border-gray/15 hover:border-primary/40 hover:bg-light-gray/20'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-extrabold text-primary">
                                {formatarDataBR(item.data)}
                              </span>
                              <span className="text-xs font-mono text-gray">
                                {item.horario_inicio} – {item.horario_fim}
                              </span>
                            </div>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                item.status === 'Concluído' || item.status === 'Realizado'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : item.status === 'Cancelado' || item.status === 'No_Show'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : item.status === 'Em Atendimento'
                                  ? 'bg-violet-50 text-violet-800 border-violet-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {item.status === 'No_Show' ? 'Não compareceu' : item.status}
                            </span>
                          </div>

                          <div>
                            <p className="text-xs font-bold text-dark">{item.servico_nome}</p>
                            <p className="text-[11px] text-gray">
                              {item.profissional_nome} ({item.profissional_especialidade})
                            </p>
                          </div>

                          {temProntuario ? (
                            <div className="pt-2 border-t border-gray/15 space-y-1.5 text-[11px]">
                              {item.anamnese && (
                                <div>
                                  <strong className="text-primary-dark">Anamnese:</strong>{' '}
                                  <span className="text-dark">{item.anamnese}</span>
                                </div>
                              )}
                              {item.exame_fisico && (
                                <div>
                                  <strong className="text-primary-dark">Exame Físico:</strong>{' '}
                                  <span className="text-dark">{item.exame_fisico}</span>
                                </div>
                              )}
                              {item.hipoteses_diagnosticas && (
                                <div>
                                  <strong className="text-primary-dark">Diagnóstico:</strong>{' '}
                                  <span className="text-dark">{item.hipoteses_diagnosticas}</span>
                                </div>
                              )}
                              {item.prescricoes && (
                                <div>
                                  <strong className="text-primary-dark">Prescrições:</strong>{' '}
                                  <span className="text-dark">{item.prescricoes}</span>
                                </div>
                              )}
                              {item.evolucao && (
                                <div>
                                  <strong className="text-primary-dark">Evolução:</strong>{' '}
                                  <span className="text-dark">{item.evolucao}</span>
                                </div>
                              )}
                              {item.exames_laudos && (
                                <div>
                                  <strong className="text-primary-dark">Exames e Laudos:</strong>{' '}
                                  <span className="text-dark">{item.exames_laudos}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-[11px] italic text-gray pt-1 border-t border-gray/10">
                              Sem anotações de prontuário nesta data (clique para preencher).
                            </p>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
