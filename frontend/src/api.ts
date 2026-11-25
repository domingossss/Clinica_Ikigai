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

/** Faz parse seguro de JSON evitando SyntaxError em respostas HTML (502/503/504/429). */
export async function lerJsonSeguro<T = Record<string, unknown>>(resposta: Response): Promise<T | null> {
  try {
    return (await resposta.json()) as T;
  } catch {
    return null;
  }
}
