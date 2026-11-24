import { apiFetch } from '../api';

export type PerfilUsuario = 'ADMIN' | 'RECEPCAO' | 'PROFISSIONAL';

export interface UsuarioSessao {
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
}

export const SENHA_PADRAO_INICIAL = 'Ikigai@123';

export function gerarLoginPreview(nome: string): string {
  const ignorar = new Set(['dr', 'dra', 'dr.', 'dra.', 'terapeuta', 'prof', 'prof.', 'de', 'da', 'do', 'dos', 'das', 'e']);
  const partes = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length > 0 && !ignorar.has(p));

  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0];
  return `${partes[0]}.${partes[partes.length - 1]}`;
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

export async function efetuarLogin(identificador: string, senha: string): Promise<UsuarioSessao> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ login: identificador, email: identificador, senha }),
  });
  const json = await res.json();
  if (!res.ok || !json.sucesso || !json.dados?.usuario) {
    throw new Error(json.erro || 'Não foi possível entrar no sistema.');
  }
  return json.dados.usuario;
}

export async function trocarSenhaPrimeiroAcesso(novaSenha: string, confirmarSenha: string): Promise<void> {
  const res = await apiFetch('/api/auth/trocar-senha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ nova_senha: novaSenha, confirmar_senha: confirmarSenha }),
  });
  const json = await res.json();
  if (!res.ok || !json.sucesso) {
    throw new Error(json.erro || 'Não foi possível alterar a senha.');
  }
}

export async function encerrarSessao(): Promise<void> {
  const res = await apiFetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 401) throw new Error('Não foi possível encerrar sua sessão. Tente novamente.');
}
