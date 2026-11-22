import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { PERFIL_LABELS, type PerfilUsuario } from '../services/auth';
import CampoSenha from './CampoSenha';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface UsuarioItem {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  profissional_id?: number | null;
  profissional_nome?: string | null;
  profissional_especialidade?: string | null;
  profissional_ativo?: number | boolean | null;
  ativo: number | boolean;
  criado_em?: string;
}

interface ProfissionalOpcao {
  id: number;
  nome: string;
  especialidade?: string;
  ativo?: number | boolean;
}

interface GestaoUsuariosProps {
  usuarioLogadoId: number;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
  onProfissionaisChange?: () => void;
}

export default function GestaoUsuarios({ usuarioLogadoId, onNotify, onProfissionaisChange }: GestaoUsuariosProps) {
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [profissionais, setProfissionais] = useState<ProfissionalOpcao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  // Formulário de criação/edição
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<PerfilUsuario>('RECEPCAO');
  const [profissionalId, setProfissionalId] = useState<string>('novo');
  const [especialidade, setEspecialidade] = useState('');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregarDados = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [resUsers, resProfs] = await Promise.all([
        fetch(`${API_BASE_URL}/api/usuarios`, { credentials: 'include' }),
        fetch(`${API_BASE_URL}/api/profissionais`, { credentials: 'include' }),
      ]);
      const jsonUsers = await resUsers.json();
      if (!resUsers.ok || !jsonUsers.sucesso) {
        throw new Error(jsonUsers.erro || 'Não foi possível carregar usuários.');
      }
      setUsuarios(jsonUsers.dados || []);

      if (resProfs.ok) {
        const jsonProfs = await resProfs.json();
        if (jsonProfs.sucesso && Array.isArray(jsonProfs.dados)) {
          setProfissionais(jsonProfs.dados);
        }
      }
    } catch (err: any) {
      setErro(err.message || 'Erro ao buscar usuários.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  function limparFormulario() {
    setEditandoId(null);
    setNome('');
    setEmail('');
    setPerfil('RECEPCAO');
    setProfissionalId('novo');
    setEspecialidade('');
    setSenha('');
  }

  function iniciarEdicao(u: UsuarioItem) {
    setEditandoId(u.id);
    setNome(u.nome);
    setEmail(u.email);
    setPerfil(u.perfil);
    setProfissionalId(u.profissional_id ? String(u.profissional_id) : 'novo');
    setEspecialidade(u.profissional_especialidade || '');
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
      const body: Record<string, any> = {
        nome: nome.trim(),
        email: email.trim(),
        perfil,
      };
      if (perfil === 'PROFISSIONAL') {
        body.especialidade = especialidade.trim() || 'Especialista';
        body.profissional_id = profissionalId !== 'novo' ? Number(profissionalId) : null;
      }
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
      onNotify?.(
        editandoId
          ? 'Usuário atualizado com sucesso!'
          : perfil === 'PROFISSIONAL'
          ? 'Usuário e cadastro de profissional criados e vinculados com sucesso!'
          : 'Usuário criado com sucesso!',
        'success'
      );
      limparFormulario();
      await carregarDados();
      onProfissionaisChange?.();
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
      await carregarDados();
    } catch (err: any) {
      onNotify?.(err.message || 'Erro ao alterar status.', 'error');
    }
  }

  const filtrados = usuarios.filter(u => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return (
      u.nome.toLowerCase().includes(q) ||
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
          Defina o perfil de acesso para controlar as permissões no sistema.
        </p>

        <form onSubmit={handleSalvar} autoComplete="off" className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-dark mb-1">Perfil de acesso</label>
            <select
              value={perfil}
              onChange={e => setPerfil(e.target.value as PerfilUsuario)}
              className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="ADMIN">Administrador (acesso total)</option>
              <option value="RECEPCAO">Recepção (agenda, pacientes e painel)</option>
              <option value="PROFISSIONAL">Profissional (agenda clínica individual)</option>
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
                <label className="block text-xs font-bold text-primary-dark mb-1">
                  Especialidade Clínica *
                </label>
                <input
                  type="text"
                  required
                  value={especialidade}
                  onChange={e => setEspecialidade(e.target.value)}
                  placeholder="Ex.: Terapeuta Ortomolecular, Acupunturista..."
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-primary-dark mb-1">
                  Vínculo na Grade de Horários (1:1)
                </label>
                <select
                  value={profissionalId}
                  onChange={e => setProfissionalId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray/25 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="novo">+ Criar novo cadastro de profissional na grade</option>
                  {profissionais.map(p => {
                    const usuarioVinculado = usuarios.find(
                      u => Number(u.profissional_id) === Number(p.id) && u.id !== editandoId
                    );
                    return (
                      <option key={p.id} value={String(p.id)} disabled={Boolean(usuarioVinculado)}>
                        {p.nome} ({p.especialidade || 'Especialista'})
                        {usuarioVinculado ? ` — Já vinculado a ${usuarioVinculado.nome}` : ''}
                      </option>
                    );
                  })}
                </select>
                <span className="text-[10px] text-gray mt-1 block">
                  Cada login de profissional fica vinculado exclusivamente à sua própria coluna na agenda.
                </span>
              </div>
            </div>
          )}

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
              const profInativo = u.perfil === 'PROFISSIONAL' && u.profissional_id && (u.profissional_ativo === 0 || u.profissional_ativo === false);
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
                      {profInativo && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                          Agenda Inativa na Clínica
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray font-mono">{u.email}</p>
                    {u.perfil === 'PROFISSIONAL' && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {u.profissional_id ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-dark bg-secondary/20 px-2.5 py-0.5 rounded-lg border border-secondary/40">
                            <span>🩺</span>
                            <span>
                              Agenda vinculada: <strong>{u.profissional_nome || u.nome}</strong>
                              {u.profissional_especialidade ? ` • ${u.profissional_especialidade}` : ''}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-lg border border-amber-200">
                            ⚠️ Sem agenda vinculada (clique em Editar para vincular)
                          </span>
                        )}
                      </div>
                    )}
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
