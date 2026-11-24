const entidadesHtml = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escaparTextoHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caractere => entidadesHtml[caractere]);
}
