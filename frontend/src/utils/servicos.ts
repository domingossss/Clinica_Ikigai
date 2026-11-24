export function procedimentoAtivo(procedimento: { ativo?: number | boolean }): boolean {
  return procedimento.ativo !== false && procedimento.ativo !== 0;
}
