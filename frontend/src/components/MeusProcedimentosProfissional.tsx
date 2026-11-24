import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { apiFetch } from '../api';
import type { UsuarioSessao } from '../services/auth';

interface ProcedimentoItem {
  id: number;
  nome: string;
  duracao_minutos: number;
  preco: number;
  categoria_id: number;
  categoria_nome: string;
  ativo: number | boolean;
  vinculado: number | boolean;
}

interface CategoriaItem {
  id: number;
  nome: string;
}

interface Props {
  usuario: UsuarioSessao;
  onUpdated?: () => void;
  onNotify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function MeusProcedimentosProfissional({ usuario, onUpdated, onNotify }: Props) {
  const profId = usuario.profissional_id;
  const [procedimentos, setProcedimentos] = useState<ProcedimentoItem[]>([]);
  const [categorias, setCategorias] = useState<CategoriaItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Formulário de criação/edição de procedimento próprio
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [criandoNovaCategoria, setCriandoNovaCategoria] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState('');
  const [duracaoMinutos, setDuracaoMinutos] = useState('60');
  const [preco, setPreco] = useState('');

  const carregarDados = useCallback(async () => {
    if (!profId) return;
    setCarregando(true);
    try {
      const [resProcs, resCats] = await Promise.all([
        apiFetch(`/api/profissionais/${profId}/procedimentos`),
        apiFetch('/api/categorias'),
      ]);
      const jsonProcs = await resProcs.json();
      if (resProcs.ok && jsonProcs.sucesso) {
        setProcedimentos(jsonProcs.dados || []);
      }
      if (resCats.ok) {
        const jsonCats = await resCats.json();
        if (jsonCats.sucesso && Array.isArray(jsonCats.dados)) {
          setCategorias(jsonCats.dados);
          const espProf = (usuario.profissional_especialidade || '').toLowerCase();
          const match = jsonCats.dados.find((c: CategoriaItem) => c.nome.toLowerCase() === espProf);
          if (match) {
            setCategoriaId(prev => prev || String(match.id));
          } else if (jsonCats.dados[0]) {
            setCategoriaId(prev => prev || String(jsonCats.dados[0].id));
          }
        }
      }
    } catch {
      onNotify?.('Não foi possível carregar seus procedimentos.', 'error');
    } finally {
      setCarregando(false);
    }
  }, [profId, usuario.profissional_especialidade, onNotify]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  function limparFormulario() {
    setEditandoId(null);
    setNome('');
    setDuracaoMinutos('60');
    setPreco('');
    setCriandoNovaCategoria(false);
    setNovaCategoria('');
  }

  function iniciarEdicao(p: ProcedimentoItem) {
    setEditandoId(p.id);
    setNome(p.nome);
    setCategoriaId(String(p.categoria_id));
    setDuracaoMinutos(String(p.duracao_minutos));
    setPreco(Number(p.preco || 0).toFixed(2));
    setCriandoNovaCategoria(false);
    setNovaCategoria('');
  }

  async function handleSalvar(e: FormEvent) {
    e.preventDefault();
    if (!profId) return;
    if (!nome.trim()) {
      onNotify?.('Informe o nome do procedimento.', 'error');
      return;
    }
    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/profissionais/${profId}/procedimentos/${editandoId}`
        : `/api/profissionais/${profId}/procedimentos`;
      const method = editandoId ? 'PUT' : 'POST';
      const body: Record<string, unknown> = {
        nome: nome.trim(),
        duracao_minutos: Number(duracaoMinutos) || 60,
        preco: preco !== '' ? Number(preco) : 0,
      };
      if (criandoNovaCategoria && novaCategoria.trim()) {
        body.nova_categoria = novaCategoria.trim();
      } else if (categoriaId) {
        body.categoria_id = Number(categoriaId);
      }

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Não foi possível salvar o procedimento.');
      }

      onNotify?.(
        editandoId
          ? 'Procedimento atualizado com sucesso!'
          : 'Procedimento criado e vinculado automaticamente à sua agenda!',
        'success'
      );
      limparFormulario();
      await carregarDados();
      onUpdated?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao salvar procedimento.', 'error');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatusProcedimento(p: ProcedimentoItem) {
    if (!profId) return;
    const novoAtivo = !(p.ativo === 1 || p.ativo === true);
    try {
      const res = await apiFetch(`/api/profissionais/${profId}/procedimentos/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: novoAtivo ? 1 : 0 }),
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Falha ao atualizar status do procedimento.');
      }
      onNotify?.(
        novoAtivo ? `Procedimento "${p.nome}" ativado na sua agenda!` : `Procedimento "${p.nome}" inativado.`,
        'info'
      );
      await carregarDados();
      onUpdated?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao alterar status.', 'error');
    }
  }

  async function desvincularProcedimento(p: ProcedimentoItem) {
    if (!profId) return;
    try {
      const res = await apiFetch(`/api/profissionais/${profId}/procedimentos/${p.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Não foi possível remover o vínculo.');
      }
      onNotify?.(`Procedimento "${p.nome}" removido da sua agenda.`, 'info');
      await carregarDados();
      onUpdated?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao remover procedimento.', 'error');
    }
  }

  const meusProcedimentos = procedimentos.filter(p => p.vinculado === 1 || p.vinculado === true);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Coluna 1: Criar / Editar Procedimento Próprio */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-2xl shadow-premium border border-gray/10 p-6 space-y-4 sticky top-24">
          <div>
            <h2 className="text-base font-bold text-dark flex items-center gap-2">
              <span className="p-1.5 bg-primary/10 rounded-lg text-primary text-xs font-bold">
                Consultório
              </span>
              {editandoId ? 'Editar Procedimento' : 'Criar Meu Procedimento'}
            </h2>
            <p className="text-xs text-gray mt-1">
              Os procedimentos criados aqui já ficam automaticamente vinculados à sua agenda profissional.
            </p>
          </div>

          <form onSubmit={handleSalvar} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-dark mb-1">
                Nome do Procedimento *
              </label>
              <input
                type="text"
                required
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex.: Consulta Ortomolecular, Sessão de Acupuntura..."
                className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-dark">
                  Especialidade / Categoria *
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setCriandoNovaCategoria(prev => !prev);
                    setNovaCategoria('');
                  }}
                  className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                >
                  {criandoNovaCategoria ? 'Selecionar existente' : '+ Nova especialidade'}
                </button>
              </div>

              {!criandoNovaCategoria ? (
                <select
                  value={categoriaId}
                  onChange={e => setCategoriaId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {categorias.map(c => (
                    <option key={c.id} value={String(c.id)}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required
                  value={novaCategoria}
                  onChange={e => setNovaCategoria(e.target.value)}
                  placeholder="Digite o nome da nova especialidade..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-dark mb-1">
                  Duração (minutos) *
                </label>
                <select
                  value={duracaoMinutos}
                  onChange={e => setDuracaoMinutos(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {[15, 20, 30, 40, 45, 50, 60, 75, 90, 120].map(m => (
                    <option key={m} value={String(m)}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-dark mb-1">
                  Valor (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
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
                disabled={salvando}
                className="flex-1 py-2.5 px-4 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all disabled:opacity-50 cursor-pointer"
              >
                {salvando
                  ? 'Salvando...'
                  : editandoId
                  ? 'Salvar Alterações'
                  : '+ Criar e Vincular à Minha Agenda'}
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
              <p className="text-sm font-bold text-dark">Você ainda não cadastrou nenhum procedimento</p>
              <p className="text-xs text-gray max-w-md mx-auto">
                Utilize o formulário ao lado para criar seus procedimentos. Assim que cadastrados, eles já ficam vinculados à sua agenda e disponíveis para marcação de consultas.
              </p>
            </div>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {meusProcedimentos.map(proc => {
                const isAtivo = proc.ativo === 1 || proc.ativo === true;
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
                          {isAtivo ? 'Ativo' : 'Inativo'}
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
                        onClick={() => void alternarStatusProcedimento(proc)}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border border-gray/20 hover:bg-light-gray text-dark cursor-pointer"
                      >
                        {isAtivo ? 'Pausar / Inativar' : 'Reativar'}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => iniciarEdicao(proc)}
                          className="text-xs font-bold px-2.5 py-1 rounded-lg text-primary hover:bg-primary/10 cursor-pointer"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void desvincularProcedimento(proc)}
                          className="text-xs font-bold px-2.5 py-1 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
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
