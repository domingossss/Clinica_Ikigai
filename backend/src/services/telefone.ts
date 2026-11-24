export function normalizarTelefone(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (!/^\+?[0-9(). -]+$/.test(texto)) return null;
  const digitos = texto.replace(/\D/g, '');
  if (!/^[1-9]\d{9,14}$/.test(digitos)) return null;
  return (texto.startsWith('+') ? '+' : '') + digitos;
}

export function numeroWhatsApp(valor: unknown): string | null {
  const telefone = normalizarTelefone(valor);
  if (!telefone) return null;
  if (telefone.startsWith('+')) return telefone.slice(1);
  return telefone.length <= 11 ? '55' + telefone : telefone;
}
