import { apiFetch } from '../api';

export type PerfilUsuario = 'ADMIN' | 'RECEPCAO' | 'PROFISSIONAL';

export interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  profissional_id?: number | null;
  profissional_nome?: string | null;
  profissional_especialidade?: string | null;
}

export const PERFIL_LABELS: Record<PerfilUsuario, string> = {
  ADMIN: 'Administrador',
  RECEPCAO: 'Recepção',
  PROFISSIONAL: 'Profissional',
};

export async function buscarSessao(): Promise<UsuarioSessao | null> {
  const res = await apiFetch('/api/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Não foi possível verificar sua sessão.');
  return (await res.json()).dados;
}

export async function efetuarLogin(email: string, senha: string): Promise<UsuarioSessao> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, senha }),
  });
  const json = await res.json();
  if (!res.ok || !json.sucesso || !json.dados?.usuario) {
    throw new Error(json.erro || 'Não foi possível entrar no sistema.');
  }
  return json.dados.usuario;
}

export async function encerrarSessao(): Promise<void> {
  const res = await apiFetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 401) throw new Error('Não foi possível encerrar sua sessão. Tente novamente.');
}
