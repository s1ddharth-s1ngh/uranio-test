import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface PointerState {
  // coordinate normalizzate stile NDC three.js: x,y in -1..1, y verso l'alto
  x: number;
  y: number;
  active: boolean;
}

/**
 * Traccia il puntatore a livello window (non sul canvas): così i calci
 * funzionano anche quando il cursore passa sopra i layer HTML in overlay.
 * Gli eventi pointer coprono sia mouse che touch.
 */
export function useWindowPointer(): RefObject<PointerState> {
  const state = useRef<PointerState>({ x: 0, y: 0, active: false });

  useEffect(() => {
    const update = (e: PointerEvent) => {
      const s = state.current;
      s.x = (e.clientX / window.innerWidth) * 2 - 1;
      s.y = -((e.clientY / window.innerHeight) * 2 - 1);
      s.active = true;
    };
    const deactivate = () => {
      state.current.active = false;
    };
    // sul touch, alzato il dito non c'è più un "cursore" nella scena
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") deactivate();
    };

    window.addEventListener("pointermove", update, { passive: true });
    window.addEventListener("pointerdown", update, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    window.addEventListener("blur", deactivate);
    document.addEventListener("mouseleave", deactivate);

    return () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerdown", update);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", deactivate);
      document.removeEventListener("mouseleave", deactivate);
    };
  }, []);

  return state;
}
