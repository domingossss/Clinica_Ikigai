export function aplicarMascaraCPF(value: string) {
  const limpo = value.replace(/\D/g, '').slice(0, 11);
  if (limpo.length <= 3) return limpo;
  if (limpo.length <= 6) return `${limpo.slice(0, 3)}.${limpo.slice(3)}`;
  if (limpo.length <= 9) return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6)}`;
  return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
}

/** Retorna a data atual no fuso oficial da clínica (America/Sao_Paulo) no formato YYYY-MM-DD. */
export function obterDataClinicaISO(referencia: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(referencia);
}

export function aplicarMascaraTelefone(value: string) {
  if (value.trimStart().startsWith('+')) return '+' + value.replace(/\D/g, '').slice(0, 15);
  const digitos = value.replace(/\D/g, '');
  if (digitos.length > 11) return '+' + digitos.slice(0, 15);
  const limpo = digitos;
  if (limpo.length <= 2) return limpo;
  if (limpo.length <= 6) return `(${limpo.slice(0, 2)}) ${limpo.slice(2)}`;
  if (limpo.length <= 10) return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
  return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
}

export function obterIniciais(nome: string): string {
  if (!nome) return 'PR';
  const limpo = nome.trim();
  const partes = limpo.split(/\s+/).filter(p => !['dr.', 'dra.', 'drª', 'dr', 'dra'].includes(p.toLowerCase()));
  if (partes.length === 0) return limpo.substring(0, 2).toUpperCase();
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
