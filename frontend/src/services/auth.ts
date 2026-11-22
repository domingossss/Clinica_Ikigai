const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

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
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: 'include' });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.sucesso ? json.dados : null;
  } catch {
    return null;
  }
}

export async function efetuarLogin(email: string, senha: string): Promise<UsuarioSessao> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
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
  await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}
