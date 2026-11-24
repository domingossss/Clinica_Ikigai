import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { apiFetch } from '../api';

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

interface Props {
  isOpen: boolean;
  onClose: () => void;
  pacienteId: string;
  pacienteNome?: string;
  agendamentoInicialId?: number | null;
  statusAgendamentoAtual?: string;
  transicoesPermitidas?: string[];
  atualizandoStatus?: boolean;
  onAtualizarStatus?: (novoStatus: string) => void;
  onAbrirReagendamento?: () => void;
  onSaved?: () => void;
}

function formatarDataBR(dataStr?: string | null): string {
  if (!dataStr) return '—';
  const [y, m, d] = dataStr.split('-');
  if (!y || !m || !d) return dataStr;
  return `${d}/${m}/${y}`;
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
  onAtualizarStatus,
  onAbrirReagendamento,
  onSaved,
}: Props) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);

  const [paciente, setPaciente] = useState<PacienteIdentificacao | null>(null);
  const [linhaDoTempo, setLinhaDoTempo] = useState<ConsultaLinhaTempo[]>([]);
  const [consultaSelecionadaId, setConsultaSelecionadaId] = useState<number | null>(
    agendamentoInicialId ?? null
  );

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

  const preencherCamposDaConsulta = useCallback(
    (consulta: ConsultaLinhaTempo | undefined, pac: PacienteIdentificacao | null) => {
      if (consulta) {
        setAnamnese(consulta.anamnese || pac?.historico_clinico || '');
        setExameFisico(consulta.exame_fisico || '');
        setHipotesesDiagnosticas(consulta.hipoteses_diagnosticas || '');
        setPrescricoes(consulta.prescricoes || '');
        setEvolucao(consulta.evolucao || pac?.observacoes || '');
        setExamesLaudos(consulta.exames_laudos || '');
      } else {
        setAnamnese(pac?.historico_clinico || '');
        setExameFisico('');
        setHipotesesDiagnosticas('');
        setPrescricoes('');
        setEvolucao(pac?.observacoes || '');
        setExamesLaudos('');
      }
    },
    []
  );

  const carregarProntuario = useCallback(async () => {
    if (!pacienteId) return;
    setCarregando(true);
    setErro(null);
    try {
      const res = await apiFetch(`/api/pacientes/${pacienteId}/prontuario`);
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Não foi possível carregar o prontuário do paciente.');
      }

      const pac: PacienteIdentificacao = json.dados.paciente;
      const consultas: ConsultaLinhaTempo[] = json.dados.linha_do_tempo || [];

      setPaciente(pac);
      setLinhaDoTempo(consultas);

      setDataNascimento(pac.data_nascimento || '');
      setSexo(pac.sexo || 'Outro');
      setFiliacao(pac.filiacao || '');
      setNaturalidade(pac.naturalidade || '');
      setRg(pac.rg || '');
      setEndereco(pac.endereco || '');
      setEtapaTratamento(pac.etapa_tratamento || 'Avaliação');

      const alvoId =
        agendamentoInicialId && consultas.some(c => Number(c.id) === Number(agendamentoInicialId))
          ? Number(agendamentoInicialId)
          : consultas[0]?.id ?? null;

      setConsultaSelecionadaId(alvoId);
      const consultaAlvo = consultas.find(c => Number(c.id) === Number(alvoId));
      preencherCamposDaConsulta(consultaAlvo, pac);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar prontuário.');
    } finally {
      setCarregando(false);
    }
  }, [pacienteId, agendamentoInicialId, preencherCamposDaConsulta]);

  useEffect(() => {
    if (isOpen && pacienteId) {
      void carregarProntuario();
    }
  }, [isOpen, pacienteId, carregarProntuario]);

  if (!isOpen) return null;

  const consultaAtiva = linhaDoTempo.find(c => Number(c.id) === Number(consultaSelecionadaId));

  function selecionarConsultaNaLinhaDoTempo(consulta: ConsultaLinhaTempo) {
    setConsultaSelecionadaId(consulta.id);
    preencherCamposDaConsulta(consulta, paciente);
    setMensagemSucesso(null);
  }

  async function handleSalvarProntuario(e: FormEvent) {
    e.preventDefault();
    if (!pacienteId) return;
    setSalvando(true);
    setErro(null);
    setMensagemSucesso(null);

    try {
      const res = await apiFetch(`/api/pacientes/${pacienteId}/prontuario`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agendamento_id: consultaSelecionadaId,
          data_nascimento: dataNascimento || null,
          sexo,
          filiacao: filiacao || null,
          naturalidade: naturalidade || null,
          rg: rg || null,
          endereco: endereco || null,
          etapa_tratamento: etapaTratamento,
          anamnese: anamnese || null,
          exame_fisico: exameFisico || null,
          hipoteses_diagnosticas: hipotesesDiagnosticas || null,
          prescricoes: prescricoes || null,
          evolucao: evolucao || null,
          exames_laudos: examesLaudos || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Não foi possível salvar o prontuário.');
      }

      setMensagemSucesso('Prontuário salvo com sucesso e atualizado na linha do tempo do paciente!');
      await carregarProntuario();
      onSaved?.();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar prontuário.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl max-w-6xl w-full max-h-[92vh] shadow-2xl border border-gray/15 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
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
            </div>
            <p className="text-xs text-white/80 mt-0.5">
              {consultaAtiva
                ? `Consulta selecionada: ${formatarDataBR(consultaAtiva.data)} às ${consultaAtiva.horario_inicio} • ${consultaAtiva.servico_nome} (${consultaAtiva.status})`
                : 'Todos os campos clínicos são opcionais e ficam salvos no histórico do paciente'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Fechar prontuário"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Barra de Ações Rápidas do Atendimento da Grade (quando aberto pela Grade de Horários) */}
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
                  onClick={() => onAtualizarStatus(novoStatus)}
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

        {/* Corpo Principal: 2 Colunas (Esquerda: Prontuário com 7 seções | Direita: Linha do Tempo Vertical) */}
        {carregando ? (
          <div className="p-12 text-center text-xs text-gray font-semibold">
            Carregando prontuário e linha do tempo do paciente…
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* COLUNA ESQUERDA (7/12): Formulário do Prontuário Completo */}
            <form onSubmit={handleSalvarProntuario} className="lg:col-span-7 space-y-5">
              {erro && (
                <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                  {erro}
                </div>
              )}
              {mensagemSucesso && (
                <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">
                  ✓ {mensagemSucesso}
                </div>
              )}

              {/* 1. Identificação do Paciente */}
              <section className="rounded-xl border border-gray/15 bg-light-gray/25 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <span>1. Identificação do Paciente</span>
                  </h3>
                  <span className="text-[11px] text-gray font-mono">
                    CPF: {paciente?.cpf || 'Não informado'}
                  </span>
                </div>

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
                      value={dataNascimento}
                      onChange={e => setDataNascimento(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-dark mb-1">Sexo</label>
                    <select
                      value={sexo}
                      onChange={e => setSexo(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark"
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
                      value={rg}
                      onChange={e => setRg(e.target.value)}
                      placeholder="Opcional"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-dark mb-1">Naturalidade</label>
                    <input
                      type="text"
                      value={naturalidade}
                      onChange={e => setNaturalidade(e.target.value)}
                      placeholder="Cidade / UF (Opcional)"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-dark mb-1">Filiação</label>
                    <input
                      type="text"
                      value={filiacao}
                      onChange={e => setFiliacao(e.target.value)}
                      placeholder="Nome dos pais / responsáveis (Opcional)"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark"
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
                      value={endereco}
                      onChange={e => setEndereco(e.target.value)}
                      placeholder="Endereço residencial"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray/25 bg-white text-dark"
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

              {/* 2. Folha de Admissão / Anamnese */}
              <section className="space-y-1.5">
                <label className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                  2. Folha de Admissão / Anamnese (Opcional)
                </label>
                <p className="text-[11px] text-gray">
                  Histórico de saúde do paciente, queixa principal, história da doença atual, doenças passadas, vacinações e histórico familiar.
                </p>
                <textarea
                  rows={3}
                  value={anamnese}
                  onChange={e => setAnamnese(e.target.value)}
                  placeholder="Registre a queixa principal, história da doença atual, antecedentes pessoais e familiares..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              {/* 3. Exame Físico */}
              <section className="space-y-1.5">
                <label className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                  3. Exame Físico (Opcional)
                </label>
                <p className="text-[11px] text-gray">
                  Dados coletados pelo profissional durante a avaliação clínica do paciente.
                </p>
                <textarea
                  rows={2}
                  value={exameFisico}
                  onChange={e => setExameFisico(e.target.value)}
                  placeholder="Sinais vitais, achados clínicos e avaliação física..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              {/* 4. Hipóteses Diagnósticas e Diagnóstico */}
              <section className="space-y-1.5">
                <label className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                  4. Hipóteses Diagnósticas e Diagnóstico (Opcional)
                </label>
                <p className="text-[11px] text-gray">
                  Avaliação técnica inicial ou conclusiva do quadro de saúde.
                </p>
                <textarea
                  rows={2}
                  value={hipotesesDiagnosticas}
                  onChange={e => setHipotesesDiagnosticas(e.target.value)}
                  placeholder="Hipóteses diagnósticas, diagnóstico clínico ou integrativo..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              {/* 5. Prescrições */}
              <section className="space-y-1.5">
                <label className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                  5. Prescrições e Plano Terapêutico (Opcional)
                </label>
                <p className="text-[11px] text-gray">
                  Orientações de tratamento médico (focadas na doença) e planos de cuidados da enfermagem ou equipe multiprofissional.
                </p>
                <textarea
                  rows={2}
                  value={prescricoes}
                  onChange={e => setPrescricoes(e.target.value)}
                  placeholder="Prescrições, fitoterápicos, suplementação, orientações e plano de cuidados..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              {/* 6. Folha de Evolução */}
              <section className="space-y-1.5">
                <label className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                  6. Folha de Evolução (Opcional)
                </label>
                <p className="text-[11px] text-gray">
                  Anotações periódicas sobre o estado de saúde do paciente e a resposta aos tratamentos.
                </p>
                <textarea
                  rows={3}
                  value={evolucao}
                  onChange={e => setEvolucao(e.target.value)}
                  placeholder="Evolução clínica do dia, resposta ao tratamento anterior e conduta realizada na sessão..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              {/* 7. Resultados de Exames e Laudos */}
              <section className="space-y-1.5">
                <label className="block text-xs font-extrabold text-primary uppercase tracking-wider">
                  7. Resultados de Exames e Laudos (Opcional)
                </label>
                <p className="text-[11px] text-gray">
                  Exames laboratoriais, de imagem, termos de consentimento e laudos anexados ao longo do acompanhamento.
                </p>
                <textarea
                  rows={2}
                  value={examesLaudos}
                  onChange={e => setExamesLaudos(e.target.value)}
                  placeholder="Resultados de exames laboratoriais, imagem, laudos e termos de consentimento..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>

              <div className="pt-2 flex items-center justify-end gap-3 sticky bottom-0 bg-white py-3 border-t border-gray/15">
                <button
                  type="button"
                  onClick={onClose}
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
            </form>

            {/* COLUNA DIREITA (5/12): Linha do Tempo Vertical do Paciente atrelada ao Profissional */}
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
                        {/* Marcador circular da linha do tempo vertical */}
                        <span
                          className={`absolute -left-[31px] top-3 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            isSelecionada
                              ? 'bg-primary border-primary ring-4 ring-primary/20'
                              : temProntuario
                              ? 'bg-emerald-500 border-white shadow-xs'
                              : 'bg-white border-primary/50'
                          }`}
                        />

                        <div
                          onClick={() => selecionarConsultaNaLinhaDoTempo(item)}
                          className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 ${
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

                          {/* Resumo do Prontuário do Dia dentro da Linha do Tempo */}
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
                        </div>
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
