import { useEffect, useRef } from 'react';
export interface ClinicChange { recursos: string[]; versao?: string }
const CLINIC_CHANGE_EVENT = 'ikigai:alteracao';

export function subscribeClinicChanges(callback: (change: ClinicChange) => void, recursos: readonly string[] = []): () => void {
  const receber = (event: Event) => {
    const change = (event as CustomEvent<ClinicChange>).detail;
    if (!change.recursos.length || !recursos.length || change.recursos.some(r => recursos.includes(r))) callback(change);
  };
  window.addEventListener(CLINIC_CHANGE_EVENT, receber);
  return () => window.removeEventListener(CLINIC_CHANGE_EVENT, receber);
}

export function useClinicUpdates(callback: (change: ClinicChange) => void, recursos: readonly string[] = []): void {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; }, [callback]);
  const chave = recursos.join(',');
  useEffect(() => subscribeClinicChanges(change => latest.current(change), chave.split(',').filter(Boolean)), [chave]);
}

// Uma conexão por página; os componentes compartilham os avisos e preservam seus formulários.
export function startClinicUpdates(): () => void {
  let source: EventSource;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completa = false;
  const pendentes = new Set<string>();
  const avisar = (change: ClinicChange) => {
    if (!change.recursos.length) completa = true;
    change.recursos.forEach(r => pendentes.add(r));
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      const recursos = completa ? [] : [...pendentes];
      completa = false;
      pendentes.clear();
      window.dispatchEvent(new CustomEvent<ClinicChange>(CLINIC_CHANGE_EVENT, { detail: { recursos } }));
    }, 180);
  };
  const receber = (event: MessageEvent<string>) => {
    try {
      const change = JSON.parse(event.data) as ClinicChange;
      if (Array.isArray(change.recursos)) avisar(change);
    } catch { /* Um aviso inválido não modifica os dados da tela. */ }
  };
  const sincronizar = () => avisar({ recursos: [] });
  const visibilidade = () => { if (document.visibilityState === 'visible') sincronizar(); };
  const conectar = () => {
    if (stopped) return;
    source = new EventSource((import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api/eventos');
    source.addEventListener('pronto', receber);
    source.addEventListener('alteracao', receber);
    source.onerror = () => {
      // O navegador retoma quedas normais. Após uma resposta HTTP temporária que
      // encerre o EventSource (por exemplo durante a inicialização da API), reabre o fluxo.
      if (!stopped && source.readyState === EventSource.CLOSED && reconnect === undefined) {
        source.close();
        reconnect = setTimeout(() => { reconnect = undefined; conectar(); }, 3000);
      }
    };
  };
  conectar();
  window.addEventListener('online', sincronizar);
  window.addEventListener('focus', sincronizar);
  document.addEventListener('visibilitychange', visibilidade);
  return () => {
    stopped = true;
    if (reconnect !== undefined) clearTimeout(reconnect);
    source.close();
    source.removeEventListener('pronto', receber);
    source.removeEventListener('alteracao', receber);
    if (timer !== undefined) clearTimeout(timer);
    window.removeEventListener('online', sincronizar);
    window.removeEventListener('focus', sincronizar);
    document.removeEventListener('visibilitychange', visibilidade);
  };
}
