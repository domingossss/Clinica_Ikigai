import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { PERFIL_LABELS, type PerfilUsuario } from '../services/auth';
import CampoSenha from './CampoSenha';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface UsuarioItem {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  ativo: number | boolean;
  criado_em?: string;
}

interface GestaoUsuariosProps {
  usuarioLogadoId: number;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export default function GestaoUsuarios({ usuarioLogadoId, onNotify }: GestaoUsuariosProps) {
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  // Formulário de criação/edição
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<PerfilUsuario>('RECEPCAO');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregarUsuarios = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/usuarios`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Não foi possível carregar usuários.');
      }
      setUsuarios(json.dados || []);
    } catch (err: any) {
      setErro(err.message || 'Erro ao buscar usuários.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarUsuarios();
  }, [carregarUsuarios]);

  function limparFormulario() {
    setEditandoId(null);
    setNome('');
    setEmail('');
    setPerfil('RECEPCAO');
    setSenha('');
  }

  function iniciarEdicao(u: UsuarioItem) {
    setEditandoId(u.id);
    setNome(u.nome);
    setEmail(u.email);
    setPerfil(u.perfil);
    setSenha('');
  }

  async function handleSalvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const url = editandoId
        ? `${API_BASE_URL}/api/usuarios/${editandoId}`
        : `${API_BASE_URL}/api/usuarios`;
      const method = editandoId ? 'PUT' : 'POST';
      const body: Record<string, string> = { nome: nome.trim(), email: email.trim(), perfil };
      if (senha) body.senha = senha;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Falha ao salvar usuário.');
      }
      onNotify?.(editandoId ? 'Usuário atualizado com sucesso!' : 'Usuário criado com sucesso!', 'success');
      limparFormulario();
      await carregarUsuarios();
    } catch (err: any) {
      onNotify?.(err.message || 'Erro ao salvar usuário.', 'error');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus(u: UsuarioItem) {
    const novoAtivo = !Boolean(u.ativo);
    try {
      const res = await fetch(`${API_BASE_URL}/api/usuarios/${u.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ativo: novoAtivo }),
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        throw new Error(json.erro || 'Falha ao alterar status.');
      }
      onNotify?.(novoAtivo ? 'Usuário ativado.' : 'Usuário inativado.', 'success');
      await carregarUsuarios();
    } catch (err: any) {
      onNotify?.(err.message || 'Erro ao alterar status.', 'error');
    }
  }

  const filtrados = usuarios.filter(u => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.perfil.toLowerCase().includes(q);
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Formulário */}
      <div className="bg-white rounded-2xl border border-gray/15 shadow-sm p-6 h-fit">
        <h2 className="text-base font-bold text-dark mb-1">
          {editandoId ? 'Editar Usuário' : 'Novo Usuário'}
        </h2>
        <p className="text-xs text-gray mb-4">
          Defina o perfil de acesso para controlar as permissões no sistema.
        </p>

        <form onSubmit={handleSalvar} autoComplete="off" className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-dark mb-1">Nome completo</label>
            <input
              type="text"
              required
              minLength={2}
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Ex.: Maria Oliveira"
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
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
              placeholder="maria@clinicaikigai.com.br"
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-dark mb-1">Perfil de acesso</label>
            <select
              value={perfil}
              onChange={e => setPerfil(e.target.value as PerfilUsuario)}
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="ADMIN">Administrador (acesso total)</option>
              <option value="RECEPCAO">Recepção (agenda, pacientes e painel)</option>
              <option value="PROFISSIONAL">Profissional (consulta agenda e status)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-dark mb-1">
              {editandoId ? 'Nova senha (opcional)' : 'Senha inicial'}
            </label>
            <CampoSenha
              name="novo-usuario-senha"
              autoComplete="new-password"
              required={!editandoId}
              minLength={6}
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder={editandoId ? 'Deixe em branco para manter' : 'Mínimo 6 caracteres'}
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

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
            <h2 className="text-base font-bold text-dark">Usuários Cadastrados</h2>
            <p className="text-xs text-gray">{usuarios.length} usuário(s) registrado(s)</p>
          </div>
          <input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail ou perfil..."
            className="px-3.5 py-2 rounded-xl border border-gray/25 text-xs text-dark w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {carregando && <p className="text-sm text-gray py-6 text-center">Carregando usuários...</p>}
        {!carregando && erro && <p className="text-sm text-red-600 py-4">{erro}</p>}

        {!carregando && !erro && (
          <div className="divide-y divide-gray/15">
            {filtrados.map(u => {
              const ativo = Boolean(u.ativo);
              return (
                <div key={u.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-dark">{u.nome}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary-dark border border-primary/25">
                        {PERFIL_LABELS[u.perfil] || u.perfil}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ativo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-600 border-zinc-300'}`}>
                        {ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p className="text-xs text-gray font-mono">{u.email}</p>
                  </div>

                  <div className="flex items-center gap-2">
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
                        onClick={() => alternarStatus(u)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                          ativo
                            ? 'border-red-200 text-red-700 bg-red-50 hover:bg-red-100'
                            : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        {ativo ? 'Inativar' : 'Ativar'}
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
