import GradeClinica from './GradeClinica';
import { apiFetch } from '../api';
import { useClinicUpdates } from '../services/clinicUpdates';
import { useState, useEffect, useRef, useCallback } from 'react';
import Swal from 'sweetalert2';

export type { DiaJornada } from './ModalMinhaJornada';

interface Categoria {
  id: number;
  nome: string;
}

interface ServicoResumo {
  id: number;
  categoria_id: number;
}

export interface ProfissionalItem {
  id: number;
  nome: string;
  especialidade: string;
  ativo?: number | boolean;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface ExcecaoItem {
  id: number;
  data: string;
  id_profissional: number | null;
  profissional_nome: string | null;
  tipo_excecao: 'Fechado' | 'Horario_Especial';
  horario_inicio: string | null;
  horario_fim: string | null;
  motivo: string;
}

interface ServicosAgendamentosProps {
  onProfissionaisAtualizados?: () => void;
  onStatusServicoAlterado?: (servico: { id: number; ativo: number }) => void;
  onAbrirAgendaProfissional?: (profissionalId: number) => void;
  isAdmin?: boolean;
}

export default function ServicosAgendamentos({
  onProfissionaisAtualizados,
  isAdmin = false
}: ServicosAgendamentosProps) {
  const [subAba, setSubAba] = useState<'excecoes' | 'especialidades'>('excecoes');

  // Especialidades / Categorias
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [servicosResumo, setServicosResumo] = useState<ServicoResumo[]>([]);
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('');
  const [loadingEspecialidades, setLoadingEspecialidades] = useState(true);
  const [submittingCategoria, setSubmittingCategoria] = useState(false);

  // Profissionais (para filtro opcional em Exceções)
  const [profissionais, setProfissionais] = useState<ProfissionalItem[]>([]);

  // Exceções e Feriados (IK-83)
  const [excecoes, setExcecoes] = useState<ExcecaoItem[]>([]);
  const [loadingExcecoes, setLoadingExcecoes] = useState(true);
  const [submittingExcecao, setSubmittingExcecao] = useState(false);
  const [excecaoForm, setExcecaoForm] = useState({
    data: '',
    tipo_excecao: 'Fechado' as 'Fechado' | 'Horario_Especial',
    horario_inicio: '08:00',
    horario_fim: '12:00',
    motivo: '',
    id_profissional: ''
  });

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const consultas = useRef<Record<string, AbortController>>({});
  const iniciarConsulta = useCallback((chave: string) => {
    consultas.current[chave]?.abort();
    const controller = new AbortController();
    consultas.current[chave] = controller;
    return controller;
  }, []);

  const carregarEspecialidades = useCallback(() => {
    const controller = iniciarConsulta('especialidades');
    return Promise.all(['categorias', 'servicos'].map(async recurso => {
      const res = await apiFetch('/api/' + recurso, { signal: controller.signal });
      const json = await res.json();
      if (!res.ok || !json.sucesso || !Array.isArray(json.dados)) {
        throw new Error(json.erro || 'Falha ao consultar ' + recurso);
      }
      return json.dados;
    })).then(([categoriasNovas, servicosNovos]) => {
      if (controller.signal.aborted) return;
      setCategorias(categoriasNovas);
      setServicosResumo(servicosNovos);
    }).catch((erro: unknown) => {
      if (controller.signal.aborted) return;
      showToast(erro instanceof Error ? erro.message : 'Não foi possível atualizar as especialidades.', 'error');
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingEspecialidades(false);
    });
  }, [iniciarConsulta, showToast]);

  const carregarProfissionais = useCallback(() => {
    const controller = iniciarConsulta('profissionais');
    return apiFetch('/api/profissionais', { signal: controller.signal }).then(async res => {
      const data = await res.json();
      if (!res.ok || !data.sucesso || !Array.isArray(data.dados)) {
        throw new Error(data.erro || 'Falha ao consultar profissionais.');
      }
      if (!controller.signal.aborted) setProfissionais(data.dados);
    }).catch((erro: unknown) => {
      if (controller.signal.aborted) return;
      showToast(erro instanceof Error ? erro.message : 'Não foi possível atualizar os profissionais.', 'error');
    });
  }, [iniciarConsulta, showToast]);

  const carregarExcecoes = useCallback(() => {
    const controller = iniciarConsulta('excecoes');
    return apiFetch('/api/excecoes', { signal: controller.signal }).then(async res => {
      const data = await res.json();
      if (!res.ok || !data.sucesso || !Array.isArray(data.dados)) {
        throw new Error(data.erro || 'Falha ao consultar exceções.');
      }
      if (!controller.signal.aborted) setExcecoes(data.dados);
    }).catch((erro: unknown) => {
      if (controller.signal.aborted) return;
      showToast(erro instanceof Error ? erro.message : 'Não foi possível atualizar as exceções.', 'error');
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingExcecoes(false);
    });
  }, [iniciarConsulta, showToast]);

  useEffect(() => {
    const pendentes = consultas.current;
    void carregarEspecialidades();
    if (isAdmin) {
      void carregarProfissionais();
      void carregarExcecoes();
    }
    return () => Object.values(pendentes).forEach(controller => controller.abort());
  }, [carregarEspecialidades, carregarProfissionais, carregarExcecoes, isAdmin]);

  useClinicUpdates(change => {
    const geral = !change.recursos.length;
    if (geral || change.recursos.some(r => ['servicos', 'categorias'].includes(r))) void carregarEspecialidades();
    if (isAdmin && (geral || change.recursos.includes('profissionais'))) void carregarProfissionais();
    if (isAdmin && (geral || change.recursos.includes('excecoes'))) void carregarExcecoes();
  }, ['servicos', 'categorias', 'profissionais', 'excecoes']);

  // ==========================================
  // AÇÕES DE ESPECIALIDADES / CATEGORIAS
  // ==========================================
  const handleCriarCategoria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaCategoriaNome.trim()) return;
    setSubmittingCategoria(true);
    try {
      const res = await apiFetch('/api/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novaCategoriaNome.trim() })
      });
      const data = await res.json();
      if (data.sucesso) {
        setCategorias(prev => [...prev, data.dados].sort((a, b) => a.nome.localeCompare(b.nome)));
        setNovaCategoriaNome('');
        showToast('Especialidade cadastrada com sucesso!', 'success');
        onProfissionaisAtualizados?.();
      } else {
        showToast(data.erro || 'Erro ao criar especialidade.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao criar especialidade.', 'error');
    } finally {
      setSubmittingCategoria(false);
    }
  };

  const handleEditarCategoria = async (catId: number, nomeAtual: string) => {
    const { value: novoNome } = await Swal.fire({
      title: 'Editar Especialidade',
      input: 'text',
      inputLabel: 'Novo nome da especialidade',
      inputValue: nomeAtual,
      showCancelButton: true,
      confirmButtonText: 'Salvar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#262B6B',
      cancelButtonColor: '#6B7280',
      inputValidator: value => {
        if (!value || !value.trim()) {
          return 'O nome da especialidade não pode ficar vazio.';
        }
        return null;
      }
    });

    if (novoNome && novoNome.trim() && novoNome.trim() !== nomeAtual) {
      try {
        const res = await apiFetch(`/api/categorias/${catId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: novoNome.trim() })
        });
        const data = await res.json();
        if (data.sucesso) {
          showToast('Especialidade atualizada com sucesso!', 'success');
          void carregarEspecialidades();
          onProfissionaisAtualizados?.();
        } else {
          showToast(data.erro || 'Falha ao atualizar especialidade.', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Erro de rede ao atualizar especialidade.', 'error');
      }
    }
  };

  const handleExcluirCategoria = async (catId: number, nome: string) => {
    const qtdProcedimentos = servicosResumo.filter(s => s.categoria_id === catId).length;
    const textoAviso = qtdProcedimentos > 0
      ? `Atenção: Existem ${qtdProcedimentos} procedimento(s) vinculado(s) a esta especialidade. Ao excluí-la, os procedimentos e agendamentos vinculados também podem ser removidos.`
      : 'Tem certeza de que deseja excluir esta especialidade? Esta ação não poderá ser desfeita.';

    const result = await Swal.fire({
      titleText: `Excluir "${nome}"?`,
      text: textoAviso,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
      const res = await apiFetch(`/api/categorias/${catId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.sucesso) {
        showToast('Especialidade excluída com sucesso!', 'success');
        void carregarEspecialidades();
        onProfissionaisAtualizados?.();
      } else {
        showToast(data.erro || 'Erro ao excluir especialidade.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao excluir especialidade.', 'error');
    }
  };

  // ==========================================
  // AÇÕES DE EXCEÇÕES E FERIADOS (IK-83)
  // ==========================================
  const handleCriarExcecao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excecaoForm.data || !excecaoForm.motivo.trim()) {
      showToast('Preencha a data e o motivo da exceção.', 'error');
      return;
    }
    setSubmittingExcecao(true);
    try {
      const res = await apiFetch('/api/excecoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: excecaoForm.data,
          tipo_excecao: excecaoForm.tipo_excecao,
          horario_inicio: excecaoForm.tipo_excecao === 'Horario_Especial' ? excecaoForm.horario_inicio : null,
          horario_fim: excecaoForm.tipo_excecao === 'Horario_Especial' ? excecaoForm.horario_fim : null,
          motivo: excecaoForm.motivo,
          id_profissional: excecaoForm.id_profissional ? Number(excecaoForm.id_profissional) : null
        })
      });
      const data = await res.json();
      if (data.sucesso) {
        showToast('Exceção cadastrada com sucesso!', 'success');
        setExcecaoForm({
          data: '',
          tipo_excecao: 'Fechado',
          horario_inicio: '08:00',
          horario_fim: '12:00',
          motivo: '',
          id_profissional: ''
        });
        void carregarExcecoes();
      } else {
        showToast(data.erro || 'Erro ao cadastrar exceção.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao salvar exceção.', 'error');
    } finally {
      setSubmittingExcecao(false);
    }
  };

  const handleExcluirExcecao = async (id: number) => {
    const result = await Swal.fire({
      title: 'Remover Exceção?',
      text: 'A data voltará a seguir a grade de funcionamento padrão.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#262B6B',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'Sim, remover',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;

    try {
      const res = await apiFetch(`/api/excecoes/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.sucesso) {
        showToast('Exceção removida com sucesso!', 'success');
        void carregarExcecoes();
      } else {
        showToast(data.erro || 'Erro ao remover exceção.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao remover exceção.', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-light-gray text-dark font-sans p-2 sm:p-6">
      {/* Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-3 max-w-sm w-full">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`p-4 rounded-2xl shadow-premium border flex items-start gap-3 backdrop-blur-md animate-in slide-in-from-right duration-300 ${
              toast.type === 'success' ? 'bg-primary/10 border-primary/30 text-primary-dark' :
              toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-700' :
              'bg-white/95 border-gray/10 text-dark'
            }`}
          >
            <span className="text-sm font-bold">
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '!'}
              {toast.type === 'info' && 'i'}
            </span>
            <p className="text-xs font-semibold leading-relaxed">{toast.message}</p>
          </div>
        ))}
      </div>

      {/* Sub-Navegação Superior: Funcionamento & Exceções | Especialidades */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="bg-white p-2 rounded-2xl shadow-premium border border-gray/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 p-1 bg-light-gray rounded-xl">
            <button
              type="button"
              onClick={() => {
                setSubAba('excecoes');
                void carregarExcecoes();
              }}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                subAba === 'excecoes'
                  ? 'bg-white text-primary shadow-xs font-extrabold'
                  : 'text-gray hover:text-dark hover:bg-white/50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Funcionamento &amp; Exceções
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                subAba === 'excecoes' ? 'bg-primary/10 text-primary' : 'bg-gray/10 text-gray'
              }`}>
                {excecoes.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSubAba('especialidades');
                void carregarEspecialidades();
              }}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                subAba === 'especialidades'
                  ? 'bg-white text-primary shadow-xs font-extrabold'
                  : 'text-gray hover:text-dark hover:bg-white/50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Especialidades
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                subAba === 'especialidades' ? 'bg-primary/10 text-primary' : 'bg-gray/10 text-gray'
              }`}>
                {categorias.length}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 text-xs text-gray font-medium flex-wrap">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Procedimentos são gerenciados por cada profissional em &ldquo;Meus Procedimentos&rdquo;</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ABA: FUNCIONAMENTO & EXCEÇÕES (IK-83)                                     */}
      {/* ========================================================================= */}
      {isAdmin && subAba === 'excecoes' && <GradeClinica />}
      {subAba === 'excecoes' && (
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          {/* Formulário de Criação de Exceção (1/3) */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5">
              <h2 className="text-lg font-bold text-dark mb-1 flex items-center gap-2">
                Nova Exceção
              </h2>
              <p className="text-xs text-gray mb-5">
                Configure feriados, recessos ou datas pontuais com horário especial que prevalecem sobre a grade normal.
              </p>

              <form onSubmit={handleCriarExcecao} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Data da Exceção <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={excecaoForm.data}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, data: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Tipo de Exceção
                  </label>
                  <select
                    value={excecaoForm.tipo_excecao}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, tipo_excecao: e.target.value as 'Fechado' | 'Horario_Especial' }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  >
                    <option value="Fechado">Fechado (Sem Atendimento)</option>
                    <option value="Horario_Especial">Horário Especial / Reduzido</option>
                  </select>
                </div>

                {excecaoForm.tipo_excecao === 'Horario_Especial' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-dark mb-1 notranslate" translate="no">Inicio</label>
                      <input
                        type="time"
                        value={excecaoForm.horario_inicio}
                        onChange={e => setExcecaoForm(prev => ({ ...prev, horario_inicio: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray/15 rounded-xl text-xs bg-light-gray/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-dark mb-1 notranslate" translate="no">Termino</label>
                      <input
                        type="time"
                        value={excecaoForm.horario_fim}
                        onChange={e => setExcecaoForm(prev => ({ ...prev, horario_fim: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray/15 rounded-xl text-xs bg-light-gray/50"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Profissional Específico (Opcional)
                  </label>
                  <select
                    value={excecaoForm.id_profissional}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, id_profissional: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  >
                    <option value="">Toda a Clínica (Geral)</option>
                    {profissionais.map(p => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Motivo / Descrição <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Feriado de Carnaval, Recesso de Fim de Ano..."
                    value={excecaoForm.motivo}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, motivo: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingExcecao}
                  className="w-full py-2.5 px-4 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md shadow-primary/10 cursor-pointer"
                >
                  {submittingExcecao ? 'Salvando...' : 'Cadastrar Exceção'}
                </button>
              </form>
            </div>
          </div>

          {/* Lista de Exceções Cadastradas (2/3) */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5 flex flex-col h-full">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-dark">Exceções e Feriados Cadastrados</h3>
                <span className="text-xs bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">
                  {excecoes.length} cadastradas
                </span>
              </div>

              {loadingExcecoes ? (
                <div className="flex justify-center items-center py-12 text-gray">Carregando exceções...</div>
              ) : excecoes.length === 0 ? (
                <div className="text-center py-12 text-gray border border-dashed border-gray/20 rounded-2xl">
                  <p className="text-xs font-medium">Nenhuma exceção ou feriado cadastrado.</p>
                  <p className="text-[11px] text-gray/70 mt-1">A clínica segue a grade padrão de funcionamento.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray/10 overflow-y-auto max-h-[500px]">
                  {excecoes.map(exc => (
                    <div key={exc.id} className="py-3 flex items-center justify-between gap-3 hover:bg-light-gray/40 px-2 rounded-xl transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-dark">{exc.data.split('-').reverse().join('/')}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            exc.tipo_excecao === 'Fechado'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {exc.tipo_excecao === 'Fechado' ? 'Fechado' : `Especial: ${exc.horario_inicio} às ${exc.horario_fim}`}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-gray-700 mt-0.5">{exc.motivo}</p>
                        <p className="text-[10px] text-gray">
                          {exc.profissional_nome ? `Aplica-se a: ${exc.profissional_nome}` : 'Aplica-se a toda a clínica'}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleExcluirExcecao(exc.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer text-xs font-bold flex items-center gap-1"
                        title="Remover exceção"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA: ESPECIALIDADES DA CLÍNICA                                            */}
      {/* ========================================================================= */}
      {subAba === 'especialidades' && (
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          {/* Formulário de Nova Especialidade */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5">
              <h2 className="text-lg font-bold text-dark mb-1 flex items-center gap-2">
                <span className="p-1.5 bg-primary/10 rounded-lg text-primary text-xs font-bold">Clínica</span>
                Nova Especialidade
              </h2>
              <p className="text-xs text-gray mb-5">
                Gerencie as áreas de atuação disponíveis no cadastro de profissionais e procedimentos.
              </p>

              <form onSubmit={handleCriarCategoria} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Nome da Especialidade <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Fisioterapia, Acupuntura, Psicologia..."
                    value={novaCategoriaNome}
                    onChange={e => setNovaCategoriaNome(e.target.value)}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingCategoria || !novaCategoriaNome.trim()}
                  className="w-full py-2.5 px-4 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md shadow-primary/10 disabled:opacity-60 cursor-pointer"
                >
                  {submittingCategoria ? 'Salvando...' : 'Adicionar Especialidade'}
                </button>
              </form>

              <div className="mt-5 p-3.5 rounded-xl bg-secondary/10 border border-secondary/25 text-[11px] text-dark/80 leading-relaxed">
                <strong>Descentralização ativa:</strong> cada profissional cadastra e gerencia seus próprios procedimentos (com duração e valor) diretamente em <strong>Meus Procedimentos</strong>, vinculando-os automaticamente à sua agenda.
              </div>
            </div>
          </div>

          {/* Lista de Especialidades */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5 h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-dark flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  Especialidades Cadastradas ({categorias.length})
                </h3>
              </div>

              {loadingEspecialidades ? (
                <div className="flex flex-col gap-3 animate-pulse">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-12 bg-light-gray rounded-xl" />
                  ))}
                </div>
              ) : categorias.length === 0 ? (
                <div className="text-center py-12 text-gray border border-dashed border-gray/20 rounded-2xl">
                  <p className="text-xs font-medium">Nenhuma especialidade cadastrada ainda.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray/10 border border-gray/10 rounded-xl bg-light-gray/20 overflow-y-auto max-h-[550px]">
                  {categorias.map(cat => {
                    const qtdProcedimentos = servicosResumo.filter(s => s.categoria_id === cat.id).length;
                    return (
                      <div
                        key={cat.id}
                        className="p-3.5 flex items-center justify-between gap-3 hover:bg-white transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs font-bold text-dark truncate">{cat.nome}</span>
                          <span className="text-[10px] font-semibold text-gray bg-gray/10 px-2 py-0.5 rounded-full shrink-0">
                            {qtdProcedimentos} {qtdProcedimentos === 1 ? 'procedimento' : 'procedimentos'}
                          </span>
                        </div>
                        {isAdmin && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleEditarCategoria(cat.id, cat.nome)}
                              className="px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/10 rounded-lg transition-colors cursor-pointer"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExcluirCategoria(cat.id, cat.nome)}
                              className="px-2.5 py-1 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                            >
                              Excluir
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
