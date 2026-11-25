import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import Swal from 'sweetalert2';
import { apiFetch, lerJsonSeguro } from '../api';
import type { UsuarioSessao } from '../services/auth';

interface ProcedimentoItem {
  id: number;
  nome: string;
  duracao_minutos: number;
  preco: number;
  duracao_padrao?: number;
  preco_padrao?: number;
  categoria_id: number;
  categoria_nome: string;
  ativo: number | boolean;
  ativo_global?: number | boolean;
  ativo_profissional?: number | boolean;
  vinculado: number | boolean;
}

interface Props {
  usuario: UsuarioSessao;
  onUpdated?: () => void;
  onNotify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function MeusProcedimentosProfissional({ usuario, onUpdated, onNotify }: Props) {
  const profId = usuario.profissional_id;
  const [procedimentos, setProcedimentos] = useState<ProcedimentoItem[]>([]);
  const [carregando, setCarregando] = useState(Boolean(profId));
  const [salvando, setSalvando] = useState(false);
  const [processandoId, setProcessandoId] = useState<number | null>(null);
  const envioRef = useRef(false);

  // Formulário para vincular procedimento existente da clínica ou personalizar preço/duração próprios
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [procedimentoSelecionadoId, setProcedimentoSelecionadoId] = useState<string>('');
  const [duracaoMinutos, setDuracaoMinutos] = useState('60');
  const [preco, setPreco] = useState('');

  const recarregarDados = useCallback(async (signal?: AbortSignal) => {
    if (!profId) {
      setCarregando(false);
      return;
    }
    try {
      const resProcs = await apiFetch(`/api/profissionais/${profId}/procedimentos`, { signal });
      if (signal?.aborted) return;
      const jsonProcs = await lerJsonSeguro<{ sucesso?: boolean; erro?: string; dados?: ProcedimentoItem[] }>(resProcs);
      if (resProcs.ok && jsonProcs?.sucesso) {
        setProcedimentos(jsonProcs.dados || []);
      } else if (!resProcs.ok) {
        onNotify?.(jsonProcs?.erro || 'Não foi possível carregar seus procedimentos.', 'error');
      }
    } catch {
      if (!signal?.aborted) {
        onNotify?.('Não foi possível carregar seus procedimentos.', 'error');
      }
    } finally {
      if (!signal?.aborted) setCarregando(false);
    }
  }, [profId, onNotify]);

  useEffect(() => {
    if (!profId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void recarregarDados(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [profId, recarregarDados]);

  function limparFormulario() {
    setEditandoId(null);
    setProcedimentoSelecionadoId('');
    setDuracaoMinutos('60');
    setPreco('');
  }

  function iniciarEdicao(p: ProcedimentoItem) {
    setEditandoId(p.id);
    setProcedimentoSelecionadoId(String(p.id));
    setDuracaoMinutos(String(p.duracao_minutos));
    setPreco(Number(p.preco || 0).toFixed(2));
  }

  async function handleSalvar(e: FormEvent) {
    e.preventDefault();
    if (!profId || envioRef.current) return;

    const alvoId = editandoId ?? Number(procedimentoSelecionadoId);
    if (!alvoId || !Number.isSafeInteger(alvoId) || alvoId <= 0) {
      onNotify?.('Selecione um procedimento da clínica para vincular à sua agenda.', 'error');
      return;
    }

    const duracaoVal = Number(duracaoMinutos);
    if (!Number.isSafeInteger(duracaoVal) || duracaoVal <= 0 || duracaoVal > 1440 || duracaoVal % 5 !== 0) {
      onNotify?.('Informe uma duração válida (múltiplo de 5 minutos).', 'error');
      return;
    }

    const precoVal = preco.trim() !== '' ? Number(preco.replace(',', '.')) : 0;
    if (!Number.isFinite(precoVal) || precoVal < 0 || precoVal > 999999.99) {
      onNotify?.('Informe um valor em R$ válido (entre 0 e 999.999,99).', 'error');
      return;
    }

    envioRef.current = true;
    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/profissionais/${profId}/procedimentos/${editandoId}`
        : `/api/profissionais/${profId}/procedimentos`;
      const method = editandoId ? 'PUT' : 'POST';
      const body = editandoId
        ? { duracao_minutos: duracaoVal, preco: precoVal }
        : { procedimento_id: alvoId, duracao_minutos: duracaoVal, preco: precoVal };

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string }>(res);
      if (!res.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Não foi possível salvar a configuração do procedimento.');
      }

      onNotify?.(
        editandoId
          ? 'Preço e duração atualizados apenas para a sua agenda!'
          : 'Procedimento vinculado à sua agenda com as suas configurações!',
        'success'
      );
      limparFormulario();
      await recarregarDados();
      onUpdated?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao salvar procedimento.', 'error');
    } finally {
      envioRef.current = false;
      setSalvando(false);
    }
  }

  async function alternarStatusProcedimento(p: ProcedimentoItem) {
    if (!profId || processandoId !== null) return;
    const novoAtivo = !(p.ativo_profissional === undefined ? (p.ativo === 1 || p.ativo === true) : (p.ativo_profissional === 1 || p.ativo_profissional === true));
    setProcessandoId(p.id);
    try {
      const res = await apiFetch(`/api/profissionais/${profId}/procedimentos/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: novoAtivo ? 1 : 0 }),
      });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string }>(res);
      if (!res.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Falha ao atualizar status do procedimento.');
      }
      onNotify?.(
        novoAtivo
          ? `Procedimento "${p.nome}" reativado na sua agenda!`
          : `Procedimento "${p.nome}" pausado apenas na sua agenda.`,
        'info'
      );
      await recarregarDados();
      onUpdated?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao alterar status.', 'error');
    } finally {
      setProcessandoId(null);
    }
  }

  async function desvincularProcedimento(p: ProcedimentoItem) {
    if (!profId || processandoId !== null) return;
    const confirmacao = await Swal.fire({
      titleText: 'Remover procedimento da sua agenda?',
      text: `"${p.nome}" deixará de aparecer nos seus novos agendamentos. Os demais profissionais da clínica não serão afetados.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Remover da minha agenda',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
      focusCancel: true,
    });
    if (!confirmacao.isConfirmed) return;

    setProcessandoId(p.id);
    try {
      const res = await apiFetch(`/api/profissionais/${profId}/procedimentos/${p.id}`, {
        method: 'DELETE',
      });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string }>(res);
      if (!res.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Não foi possível remover o vínculo.');
      }
      if (editandoId === p.id) limparFormulario();
      onNotify?.(`Procedimento "${p.nome}" removido da sua agenda.`, 'info');
      await recarregarDados();
      onUpdated?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao remover procedimento.', 'error');
    } finally {
      setProcessandoId(null);
    }
  }

  if (!profId) {
    return (
      <div className="bg-white rounded-2xl shadow-premium border border-gray/10 p-8 text-center space-y-2">
        <p className="text-sm font-bold text-dark">Conta profissional sem agenda vinculada</p>
        <p className="text-xs text-gray">
          Solicite à administração da clínica que vincule seu cadastro de profissional para gerenciar seus procedimentos.
        </p>
      </div>
    );
  }

  const meusProcedimentos = procedimentos.filter(p => p.vinculado === 1 || p.vinculado === true);
  const disponiveisParaVincular = procedimentos.filter(
    p => !(p.vinculado === 1 || p.vinculado === true) && (p.ativo_global === undefined ? (p.ativo === 1 || p.ativo === true) : Boolean(p.ativo_global))
  );
  const procEditando = editandoId ? meusProcedimentos.find(p => p.id === editandoId) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Coluna 1: Vincular Procedimento da Clínica / Personalizar Preço e Duração */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-2xl shadow-premium border border-gray/10 p-6 space-y-4 sticky top-24">
          <div>
            <h2 className="text-base font-bold text-dark flex items-center gap-2">
              <span className="p-1.5 bg-primary/10 rounded-lg text-primary text-xs font-bold">
                Consultório
              </span>
              {editandoId ? 'Personalizar na Minha Agenda' : 'Adicionar à Minha Agenda'}
            </h2>
            <p className="text-xs text-gray mt-1">
              {editandoId
                ? 'Ajuste preço e duração apenas para os seus atendimentos, sem alterar os valores dos colegas.'
                : 'Escolha um procedimento cadastrado pela clínica e defina o preço e duração para a sua agenda.'}
            </p>
          </div>

          <form onSubmit={handleSalvar} className="space-y-3.5">
            <div>
              <label htmlFor="meus-proc-select" className="block text-xs font-bold text-dark mb-1">
                Procedimento *
              </label>
              {editandoId && procEditando ? (
                <input
                  id="meus-proc-select"
                  type="text"
                  disabled
                  value={`${procEditando.nome} (${procEditando.categoria_nome})`}
                  className="w-full px-3 py-2 rounded-xl border border-gray/20 bg-gray-100 text-xs text-dark font-semibold"
                />
              ) : (
                <select
                  id="meus-proc-select"
                  required
                  value={procedimentoSelecionadoId}
                  onChange={e => {
                    const idStr = e.target.value;
                    setProcedimentoSelecionadoId(idStr);
                    const escolhido = disponiveisParaVincular.find(p => String(p.id) === idStr);
                    if (escolhido) {
                      setDuracaoMinutos(String(escolhido.duracao_minutos || 60));
                      setPreco(Number(escolhido.preco || 0).toFixed(2));
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Selecione um procedimento da clínica...</option>
                  {disponiveisParaVincular.map(p => (
                    <option key={p.id} value={String(p.id)}>
                      {p.nome} — {p.categoria_nome}
                    </option>
                  ))}
                </select>
              )}
              {!editandoId && disponiveisParaVincular.length === 0 && !carregando && (
                <p className="text-[11px] text-gray mt-1">
                  Todos os procedimentos ativos da clínica já estão vinculados à sua agenda. Para novos serviços, solicite à administração.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="meus-proc-duracao" className="block text-xs font-bold text-dark mb-1">
                  Minha duração (min) *
                </label>
                <select
                  id="meus-proc-duracao"
                  value={duracaoMinutos}
                  onChange={e => setDuracaoMinutos(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {[
                    ...new Set([
                      15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180,
                      ...(Number(duracaoMinutos) > 0 ? [Number(duracaoMinutos)] : []),
                    ]),
                  ]
                    .sort((a, b) => a - b)
                    .map(m => (
                      <option key={m} value={String(m)}>
                        {m} min
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label htmlFor="meus-proc-preco" className="block text-xs font-bold text-dark mb-1">
                  Meu valor (R$)
                </label>
                <input
                  id="meus-proc-preco"
                  type="number"
                  step="0.01"
                  min="0"
                  max="999999.99"
                  value={preco}
                  onChange={e => setPreco(e.target.value)}
                  placeholder="Ex.: 250.00"
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={salvando || (!editandoId && disponiveisParaVincular.length === 0)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all disabled:opacity-50 cursor-pointer"
              >
                {salvando
                  ? 'Salvando...'
                  : editandoId
                  ? 'Salvar na Minha Agenda'
                  : '+ Vincular à Minha Agenda'}
              </button>
              {editandoId && (
                <button
                  type="button"
                  onClick={limparFormulario}
                  className="px-3.5 py-2.5 rounded-xl border border-gray/25 text-xs font-bold text-dark hover:bg-light-gray cursor-pointer"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Coluna 2: Lista dos Procedimentos Vinculados ao Profissional */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-2xl shadow-premium border border-gray/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray/10 bg-light-gray/30 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-dark">Meus Procedimentos Habilitados</h2>
              <p className="text-xs text-gray mt-0.5">
                Procedimentos disponíveis para agendamento na agenda de {usuario.profissional_nome || usuario.nome}
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-primary/10 text-primary">
              {meusProcedimentos.length} {meusProcedimentos.length === 1 ? 'procedimento' : 'procedimentos'}
            </span>
          </div>

          {carregando ? (
            <div className="p-8 text-center text-xs text-gray">Carregando seus procedimentos...</div>
          ) : meusProcedimentos.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-bold text-dark">Você ainda não vinculou nenhum procedimento</p>
              <p className="text-xs text-gray max-w-md mx-auto">
                Selecione ao lado os procedimentos oferecidos pela clínica que você realiza e ajuste seu valor e tempo de sessão.
              </p>
            </div>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {meusProcedimentos.map(proc => {
                const isAtivo = proc.ativo === 1 || proc.ativo === true;
                const ativoGlobal = proc.ativo_global === undefined ? true : Boolean(proc.ativo_global);
                const ocupado = processandoId === proc.id;
                return (
                  <div
                    key={proc.id}
                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                      isAtivo
                        ? 'bg-white border-gray/15 shadow-xs'
                        : 'bg-light-gray/40 border-gray/10 opacity-75'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold text-dark">{proc.nome}</h3>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            isAtivo
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-gray-100 text-gray-600 border-gray-300'
                          }`}
                        >
                          {isAtivo ? 'Ativo na agenda' : !ativoGlobal ? 'Inativo na clínica' : 'Pausado por você'}
                        </span>
                      </div>
                      <span className="inline-block mt-1 text-[11px] font-semibold text-primary-dark bg-secondary/20 px-2 py-0.5 rounded-md border border-secondary/30">
                        {proc.categoria_nome}
                      </span>
                      <div className="mt-2.5 flex items-center gap-3 text-xs text-gray">
                        <span>⏱️ <strong>{proc.duracao_minutos} min</strong></span>
                        <span>•</span>
                        <span>
                          💰{' '}
                          <strong className="text-dark">
                            {Number(proc.preco || 0).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-gray/10 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={ocupado || !ativoGlobal}
                        onClick={() => void alternarStatusProcedimento(proc)}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border border-gray/20 hover:bg-light-gray text-dark cursor-pointer disabled:opacity-50"
                      >
                        {isAtivo ? 'Pausar na minha agenda' : 'Reativar na minha agenda'}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => iniciarEdicao(proc)}
                          className="text-xs font-bold px-2.5 py-1 rounded-lg text-primary hover:bg-primary/10 cursor-pointer disabled:opacity-50"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => void desvincularProcedimento(proc)}
                          className="text-xs font-bold px-2.5 py-1 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
