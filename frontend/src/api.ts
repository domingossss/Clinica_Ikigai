const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const eventoSessao = 'ikigai:verificar-sessao';

export function apiUrl(caminho: string) {
  if (!caminho.startsWith('/api/')) throw new Error('Caminho da API inválido.');
  return base + caminho;
}

export async function apiFetch(caminho: string, opcoes: RequestInit = {}) {
  const resposta = await fetch(apiUrl(caminho), { ...opcoes, credentials: 'include' });
  if (!caminho.startsWith('/api/auth/') && [401, 403].includes(resposta.status)) {
    window.dispatchEvent(new Event(eventoSessao));
  }
  return resposta;
}
