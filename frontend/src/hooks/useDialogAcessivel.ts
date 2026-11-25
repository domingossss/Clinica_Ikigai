import { useEffect, useEffectEvent, useRef } from 'react';

const focaveis = 'button, input, select, textarea, a[href], [tabindex]';

export function useDialogAcessivel(aberto: boolean, onFechar: () => void, ocupado = false) {
  const ref = useRef<HTMLDivElement>(null);
  const fechar = useEffectEvent(() => { if (!ocupado) onFechar(); });

  useEffect(() => {
    const dialogo = ref.current;
    if (!aberto || !dialogo) return;
    const acionador = document.activeElement;
    dialogo.focus();

    function tratarTecla(evento: KeyboardEvent) {
      if (!dialogo || evento.defaultPrevented) return;
      if (evento.key === 'Escape') {
        evento.preventDefault();
        evento.stopPropagation();
        fechar();
        return;
      }
      if (evento.key !== 'Tab') return;
      const controles = [...dialogo.querySelectorAll<HTMLElement>(focaveis)].filter(elemento =>
        elemento.tabIndex >= 0 && !elemento.matches(':disabled') && elemento.getClientRects().length > 0
      );
      const primeiro = controles[0];
      const ultimo = controles.at(-1);
      const foco = document.activeElement;
      if (!primeiro || !ultimo) {
        evento.preventDefault();
      } else if (!controles.some(elemento => elemento === foco) || foco === (evento.shiftKey ? primeiro : ultimo)) {
        evento.preventDefault();
        (evento.shiftKey ? ultimo : primeiro).focus();
      }
    }

    dialogo.addEventListener('keydown', tratarTecla);
    return () => {
      dialogo.removeEventListener('keydown', tratarTecla);
      if (acionador instanceof HTMLElement && acionador.isConnected) acionador.focus();
    };
  }, [aberto]);

  return ref;
}
