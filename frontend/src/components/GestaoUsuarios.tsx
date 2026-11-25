import Swal from 'sweetalert2';
import { apiFetch, lerJsonSeguro } from '../api';
import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { gerarLoginPreview, PERFIL_LABELS, type PerfilUsuario } from '../services/auth';

interface UsuarioItem {
  id: number;
  nome: string;
  login?: string | null;
  email: string;
  perfil: PerfilUsuario;
  primeiro_acesso?: boolean;
  precisa_trocar_senha?: boolean;
  profissional_id?: number | null;
  profissional_nome?: string | null;
  profissional_especialidade?: string | null;
  profissional_ativo?: number | boolean | null;
  ativo: number | boolean;
  criado_em?: string;
}

interface CategoriaEspecialidade {
  id: number;
  nome: string;
}

interface GestaoUsuariosProps {
  usuarioLogadoId: number;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
  onProfissionaisChange?: () => void;
}

export default function GestaoUsuarios({ usuarioLogadoId, onNotify, onProfissionaisChange }: GestaoUsuariosProps) {
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [especialidades, setEspecialidades] = useState<CategoriaEspecialidade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  // Formulário de criação/edição
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<PerfilUsuario>('PROFISSIONAL');
  const [especialidade, setEspecialidade] = useState('');
  const [criandoNovaEspecialidade, setCriandoNovaEspecialidade] = useState(false);
  const [novaEspecialidadeNome, setNovaEspecialidadeNome] = useState('');
  const [salvandoEspecialidade, setSalvandoEspecialidade] = useState(false);
  const [resetarSenhaPadrao, setResetarSenhaPadrao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [processandoId, setProcessandoId] = useState<number | null>(null);
  const envioRef = useRef(false);

  const carregarDados = useCallback(async (signal?: AbortSignal) => {
    try {
      const [resUsers, resCats] = await Promise.all([
        apiFetch('/api/usuarios', { signal }),
        apiFetch('/api/categorias', { signal }),
      ]);
      if (signal?.aborted) return;
      const jsonUsers = await lerJsonSeguro<{ sucesso?: boolean; erro?: string; dados?: UsuarioItem[] }>(resUsers);
      if (!resUsers.ok || !jsonUsers?.sucesso) {
        throw new Error(jsonUsers?.erro || 'Não foi possível carregar usuários.');
      }
      setErro(null);
      setUsuarios(jsonUsers.dados || []);

      if (resCats.ok) {
        const jsonCats = await lerJsonSeguro<{ sucesso?: boolean; dados?: CategoriaEspecialidade[] }>(resCats);
        if (jsonCats?.sucesso && Array.isArray(jsonCats.dados)) {
          setEspecialidades(jsonCats.dados);
        }
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      setErro(err instanceof Error ? err.message : 'Erro ao buscar usuários.');
    } finally {
      if (!signal?.aborted) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void carregarDados(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [carregarDados]);

  function limparFormulario() {
    setEditandoId(null);
    setNome('');
    setEmail('');
    setPerfil('PROFISSIONAL');
    setEspecialidade('');
    setCriandoNovaEspecialidade(false);
    setNovaEspecialidadeNome('');
    setResetarSenhaPadrao(false);
  }

  function iniciarEdicao(u: UsuarioItem) {
    setEditandoId(u.id);
    setNome(u.nome);
    setEmail(u.email);
    setPerfil(u.perfil);
    setEspecialidade(u.profissional_especialidade || '');
    setCriandoNovaEspecialidade(false);
    setNovaEspecialidadeNome('');
    setResetarSenhaPadrao(false);
  }

  async function handleCriarNovaEspecialidade() {
    const nomeLimpo = novaEspecialidadeNome.trim();
    if (!nomeLimpo) {
      onNotify?.('Digite o nome da nova especialidade.', 'error');
      return;
    }
    setSalvandoEspecialidade(true);
    try {
      const res = await apiFetch('/api/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeLimpo }),
      });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string; dados?: { nome?: string } }>(res);
      if (!res.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Não foi possível criar a especialidade.');
      }
      await carregarDados();
      setEspecialidade(json.dados?.nome || nomeLimpo);
      setNovaEspecialidadeNome('');
      setCriandoNovaEspecialidade(false);
      onNotify?.(`Especialidade "${nomeLimpo}" criada com sucesso!`, 'success');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao criar especialidade.', 'error');
    } finally {
      setSalvandoEspecialidade(false);
    }
  }

  async function handleSalvar(e: FormEvent) {
    e.preventDefault();
    if (envioRef.current) return;
    if (!nome.trim() || nome.trim().length < 2) {
      onNotify?.('Informe um nome válido (mínimo de 2 caracteres).', 'error');
      return;
    }
    const espFinal = criandoNovaEspecialidade ? novaEspecialidadeNome.trim() : especialidade.trim();
    if (perfil === 'PROFISSIONAL' && !espFinal) {
      onNotify?.('Selecione ou crie uma especialidade para o profissional.', 'error');
      return;
    }
    envioRef.current = true;
    setSalvando(true);
    try {
      const url = editandoId ? `/api/usuarios/${editandoId}` : `/api/usuarios`;
      const method = editandoId ? 'PUT' : 'POST';
      const body: Record<string, string | number | boolean | null> = {
        nome: nome.trim(),
        email: email.trim(),
        perfil,
      };
      if (perfil === 'PROFISSIONAL') {
        body.especialidade = espFinal;
      }
      if (!editandoId) {
        body.usar_senha_padrao = true;
      } else if (resetarSenhaPadrao) {
        body.resetar_senha_padrao = true;
      }

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await lerJsonSeguro<{
        sucesso?: boolean;
        erro?: string;
        dados?: { login?: string; credencial_temporaria?: string };
      }>(res);
      if (!res.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Falha ao salvar usuário.');
      }
      const loginGerado = json.dados?.login || gerarLoginPreview(nome);
      const credencialTemporaria = json.dados?.credencial_temporaria;
      if (credencialTemporaria) {
        await Swal.fire({
          titleText: editandoId ? 'Senha temporária gerada' : 'Usuário cadastrado com sucesso',
          text: `Login: ${loginGerado} | Senha temporária (uso único no 1º acesso): ${credencialTemporaria}. Copie e entregue com segurança ao usuário — ela não será exibida novamente.`,
          icon: 'success',
          confirmButtonText: 'Entendi',
        });
      }
      onNotify?.(
        editandoId
          ? `Usuário atualizado! Login: ${loginGerado}`
          : `Usuário cadastrado! Login: "${loginGerado}"`,
        'success'
      );
      limparFormulario();
      await carregarDados();
      onProfissionaisChange?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao salvar usuário.', 'error');
    } finally {
      envioRef.current = false;
      setSalvando(false);
    }
  }

  async function alternarStatus(u: UsuarioItem) {
    if (processandoId !== null) return;
    const novoAtivo = !u.ativo;
    if (!novoAtivo) {
      const confirmacao = await Swal.fire({
        titleText: 'Inativar usuário?',
        text: `${u.nome} perderá imediatamente o acesso ao sistema e todas as sessões ativas serão encerradas.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Inativar acesso',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#b91c1c',
        focusCancel: true,
      });
      if (!confirmacao.isConfirmed) return;
    }
    setProcessandoId(u.id);
    try {
      const res = await apiFetch(`/api/usuarios/${u.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ativo: novoAtivo }),
      });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string }>(res);
      if (!res.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Falha ao alterar status.');
      }
      onNotify?.(novoAtivo ? 'Usuário ativado.' : 'Usuário inativado.', 'success');
      await carregarDados();
      onProfissionaisChange?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao alterar status.', 'error');
    } finally {
      setProcessandoId(null);
    }
  }

  async function excluirUsuario(u: UsuarioItem) {
    if (processandoId !== null) return;
    const confirmacao = await Swal.fire({
      titleText: 'Excluir usuário?',
      text: `O acesso de ${u.nome} (${u.email}) será removido definitivamente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Excluir usuário',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#b91c1c',
      focusCancel: true,
    });
    if (!confirmacao.isConfirmed) return;
    setProcessandoId(u.id);
    try {
      const res = await apiFetch(`/api/usuarios/${u.id}`, { method: 'DELETE' });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string }>(res);
      if (!res.ok || !json?.sucesso) throw new Error(json?.erro || 'Falha ao excluir usuário.');
      if (editandoId === u.id) limparFormulario();
      onNotify?.('Usuário excluído.', 'success');
      await carregarDados();
      onProfissionaisChange?.();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Falha ao excluir usuário.', 'error');
    } finally {
      setProcessandoId(null);
    }
  }

  const loginPreview = gerarLoginPreview(nome);

  const filtrados = usuarios.filter(u => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return (
      u.nome.toLowerCase().includes(q) ||
      (u.login || '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.perfil.toLowerCase().includes(q) ||
      (u.profissional_especialidade || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Formulário */}
      <div className="bg-white rounded-2xl border border-gray/15 shadow-sm p-6 h-fit">
        <h2 className="text-base font-bold text-dark mb-1">
          {editandoId ? 'Editar Usuário' : 'Novo Usuário'}
        </h2>
        <p className="text-xs text-gray mb-4">
          O usuário de login é gerado automaticamente no formato <strong>nome.ultimonome</strong>.
        </p>

        <form onSubmit={handleSalvar} autoComplete="off" className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-dark mb-1">Perfil de acesso</label>
            <select
              value={perfil}
              onChange={e => setPerfil(e.target.value as PerfilUsuario)}
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="PROFISSIONAL">Profissional (agenda clínica individual)</option>
              <option value="RECEPCAO">Recepção (agenda, pacientes e painel)</option>
              <option value="ADMIN">Administrador (acesso total)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-dark mb-1">Nome completo</label>
            <input
              type="text"
              required
              minLength={2}
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder={perfil === 'PROFISSIONAL' ? 'Ex.: Dr. Ulisses Higo' : 'Ex.: Maria Oliveira'}
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {loginPreview && (
              <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/20 flex items-center justify-between text-xs">
                <span className="text-gray font-medium">Usuário de login:</span>
                <strong className="font-mono text-primary">{loginPreview}</strong>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-dark mb-1">E-mail</label>
            <input
              type="email"
              name="novo-usuario-email"
              autoComplete="off"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="usuario@clinicaikigai.com.br"
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {perfil === 'PROFISSIONAL' && (
            <div className="p-3.5 rounded-xl bg-secondary/10 border border-secondary/30 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-primary-dark">
                    Especialidade *
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setCriandoNovaEspecialidade(prev => !prev);
                      setNovaEspecialidadeNome('');
                    }}
                    className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                  >
                    {criandoNovaEspecialidade ? 'Selecionar existente' : '+ Nova especialidade'}
                  </button>
                </div>

                {!criandoNovaEspecialidade ? (
                  <select
                    required
                    value={especialidade}
                    onChange={e => {
                      if (e.target.value === '__nova__') {
                        setCriandoNovaEspecialidade(true);
                      } else {
                        setEspecialidade(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">Selecione a especialidade...</option>
                    {especialidades.map(esp => (
                      <option key={esp.id} value={esp.nome}>
                        {esp.nome}
                      </option>
                    ))}
                    {especialidade && !especialidades.some(e => e.nome === especialidade) && (
                      <option value={especialidade}>{especialidade}</option>
                    )}
                    <option value="__nova__">+ Criar nova especialidade...</option>
                  </select>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={novaEspecialidadeNome}
                        onChange={e => setNovaEspecialidadeNome(e.target.value)}
                        placeholder="Nome da nova especialidade..."
                        className="flex-1 px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <button
                        type="button"
                        disabled={salvandoEspecialidade}
                        onClick={() => void handleCriarNovaEspecialidade()}
                        className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark cursor-pointer disabled:opacity-50"
                      >
                        {salvandoEspecialidade ? '...' : 'Criar'}
                      </button>
                    </div>
                    <span className="text-[10px] text-gray block">
                      Você pode clicar em "Criar" agora ou salvar o usuário diretamente com o nome digitado.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!editandoId ? (
            <div className="p-3 rounded-xl bg-light-gray/60 border border-gray/15 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-dark">🔑 Senha temporária exclusiva</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white border border-gray/20 text-primary">
                  Gerada automaticamente
                </span>
              </div>
              <p className="text-[11px] text-gray">
                O usuário entrará com o login <strong>{loginPreview || 'nome.ultimonome'}</strong> e uma senha temporária aleatória exibida uma única vez após o cadastro, com troca obrigatória no primeiro acesso.
              </p>
            </div>
          ) : (
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={resetarSenhaPadrao}
                onChange={e => setResetarSenhaPadrao(e.target.checked)}
                className="mt-0.5 rounded border-amber-300 text-primary focus:ring-primary"
              />
              <span>
                <strong className="text-amber-900 block">Gerar nova senha temporária de primeiro acesso</strong>
                <span className="text-[11px] text-amber-800">
                  Revoga sessões ativas e exige que o usuário crie uma nova senha pessoal no próximo login.
                </span>
              </span>
            </label>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={salvando}
              className="flex-1 py-2.5 px-4 rounded-xl bg-dark text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {salvando ? 'Salvando...' : editandoId ? 'Salvar alterações' : 'Cadastrar usuário'}
            </button>
            {editandoId && (
              <button
                type="button"
                onClick={limparFormulario}
                className="px-4 py-2.5 rounded-xl border border-gray/25 text-xs font-bold text-dark hover:bg-light-gray cursor-pointer"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Lista de usuários */}
      <div className="lg:col-span-2 bg-white rounded-2xl border border-gray/15 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-dark">Usuários e Profissionais Cadastrados</h2>
            <p className="text-xs text-gray">{usuarios.length} usuário(s) registrado(s)</p>
          </div>
          <input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, usuário, e-mail ou especialidade..."
            className="px-3.5 py-2 rounded-xl border border-gray/25 text-xs text-dark w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {carregando && <p className="text-sm text-gray py-6 text-center">Carregando usuários...</p>}
        {!carregando && erro && <p className="text-sm text-red-600 py-4">{erro}</p>}

        {!carregando && !erro && (
          <div className="divide-y divide-gray/15">
            {filtrados.map(u => {
              const ativo = Boolean(u.ativo);
              const loginExibicao = u.login || gerarLoginPreview(u.nome);
              return (
                <div key={u.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-dark">{u.nome}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary-dark border border-primary/25">
                        {PERFIL_LABELS[u.perfil] || u.perfil}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ativo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-600 border-zinc-300'}`}>
                        {ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {(u.primeiro_acesso || u.precisa_trocar_senha) && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                          Senha temporária (1º acesso pendente)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray">
                      <span className="inline-flex items-center gap-1 font-mono bg-light-gray px-2 py-0.5 rounded-md text-dark font-semibold">
                        👤 {loginExibicao}
                      </span>
                      <span>•</span>
                      <span className="font-mono">{u.email}</span>
                    </div>
                    {u.perfil === 'PROFISSIONAL' && u.profissional_especialidade && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-dark bg-secondary/20 px-2.5 py-0.5 rounded-lg border border-secondary/40">
                          <span>🩺</span>
                          <span>Especialidade: <strong>{u.profissional_especialidade}</strong></span>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => iniciarEdicao(u)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-gray/25 text-dark hover:bg-light-gray cursor-pointer"
                    >
                      Editar
                    </button>
                    {u.id !== usuarioLogadoId && (
                      <button
                        type="button"
                        disabled={processandoId === u.id}
                        onClick={() => void alternarStatus(u)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer disabled:opacity-50 ${
                          ativo
                            ? 'border-red-200 text-red-700 bg-red-50 hover:bg-red-100'
                            : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        {ativo ? 'Inativar' : 'Ativar'}
                      </button>
                    )}
                    {u.id !== usuarioLogadoId && (
                      <button
                        type="button"
                        disabled={processandoId === u.id}
                        onClick={() => void excluirUsuario(u)}
                        className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtrados.length === 0 && (
              <p className="text-xs text-gray text-center py-6">Nenhum usuário encontrado.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
