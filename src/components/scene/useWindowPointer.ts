import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface PointerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PointerState {
  // posizione del cursore in px CSS relativi alla VIEWPORT (clientX/clientY).
  // NON in NDC: le NDC dipendono da dove si trova il canvas, che si sposta con
  // lo scroll, mentre la VELOCITÀ del gesto deve essere misurata in uno spazio
  // che lo scroll non falsifica. La conversione a NDC la fa la fisica, con il
  // rettangolo qui sotto.
  cx: number;
  cy: number;
  // il cursore è dentro il canvas e la finestra è in primo piano
  active: boolean;
  // rettangolo del canvas in coordinate viewport, tenuto aggiornato su
  // scroll/resize: senza questo il punto testato scivola di S px per ogni S px
  // di scroll (il canvas dell'hero è in flusso normale, non fixed)
  rect: PointerRect;
  // incrementato a ogni DISCONTINUITÀ non dovuta a un gesto: scroll, resize,
  // rientro del cursore, cambio di tab. La fisica scarta il delta di quel
  // frame, così scrollare non genera mai una spinta.
  epoch: number;
}

/**
 * Traccia il puntatore a livello window (non sul canvas): così i calci
 * funzionano anche quando il cursore passa sopra i layer HTML in overlay
 * (titolo, pill, top bar). Gli eventi pointer coprono sia mouse che touch.
 *
 * Le coordinate restituite sono in px viewport, accompagnate dal rettangolo
 * VERO del canvas: è la fisica a comporre le due cose. Normalizzare qui su
 * window.innerWidth/innerHeight sarebbe corretto solo se il canvas fosse
 * full-viewport e non scorresse — e non è il caso.
 */
export function useWindowPointer(
  element: HTMLElement | null,
): RefObject<PointerState> {
  const state = useRef<PointerState>({
    cx: 0,
    cy: 0,
    active: false,
    rect: { left: 0, top: 0, width: 1, height: 1 },
    epoch: 0,
  });

  useEffect(() => {
    if (!element) return;
    const s = state.current;

    const readRect = () => {
      const r = element.getBoundingClientRect();
      s.rect.left = r.left;
      s.rect.top = r.top;
      s.rect.width = r.width || 1;
      s.rect.height = r.height || 1;
    };
    readRect();

    const inside = () =>
      s.cx >= s.rect.left &&
      s.cx <= s.rect.left + s.rect.width &&
      s.cy >= s.rect.top &&
      s.cy <= s.rect.top + s.rect.height;

    const setActive = (next: boolean) => {
      if (next === s.active) return;
      s.active = next;
      // entrare o uscire è una discontinuità: al rientro non deve esistere un
      // "delta" costruito con la posizione di quando si è usciti
      s.epoch++;
    };

    const update = (e: PointerEvent) => {
      s.cx = e.clientX;
      s.cy = e.clientY;
      setActive(inside());
    };
    const deactivate = () => setActive(false);
    // sul touch, alzato il dito non c'è più un "cursore" nella scena
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") deactivate();
    };
    const onVisibility = () => {
      if (document.hidden) deactivate();
    };
    // il canvas si sposta: il rettangolo va riletto e il salto che ne deriva
    // non è un gesto dell'utente
    const invalidate = () => {
      readRect();
      s.epoch++;
      setActive(inside());
    };

    window.addEventListener("pointermove", update, { passive: true });
    window.addEventListener("pointerdown", update, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    window.addEventListener("blur", deactivate);
    document.addEventListener("mouseleave", deactivate);
    document.addEventListener("visibilitychange", onVisibility);
    // capture: intercetta anche lo scroll di eventuali contenitori annidati
    window.addEventListener("scroll", invalidate, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", invalidate);
    const ro = new ResizeObserver(invalidate);
    ro.observe(element);

    return () => {
      ro.disconnect();
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerdown", update);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", deactivate);
      document.removeEventListener("mouseleave", deactivate);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", invalidate, { capture: true });
      window.removeEventListener("resize", invalidate);
    };
  }, [element]);

  return state;
}
