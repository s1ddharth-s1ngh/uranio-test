import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

interface InteractiveTextProps {
  text: string;
  className?: string;
  radius?: number; // raggio di influenza in px
  strength?: number; // spostamento massimo in px
  ease?: number; // morbidezza del ritorno (0..1, più basso = più lento)
  maxRotation?: number; // rotazione massima in gradi
}

// Stato di moto di un carattere: posizione corrente (x, y, r) e target (tx, ty, tr)
interface CharMotion {
  x: number;
  y: number;
  r: number;
  tx: number;
  ty: number;
  tr: number;
}

// Centro "a riposo" di un carattere, in coordinate di pagina (stabili durante lo scroll)
interface CharBase {
  cx: number;
  cy: number;
}

// Testo reale per screen reader; la copia animata è aria-hidden
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

// white-space: nowrap impedisce il wrapping TRA i char inline-block della stessa
// parola: le interruzioni di riga restano possibili solo agli spazi tra le parole
const WORD_STYLE: CSSProperties = {
  display: "inline-block",
  whiteSpace: "nowrap",
};

const CHAR_STYLE: CSSProperties = {
  display: "inline-block",
  willChange: "transform",
};

// pre-wrap: preserva gli spazi e trasforma gli \n del testo in veri a-capo;
// a differenza di pre, lo spazio a fine riga "pende" fuori dal box e non
// sbilancia il centraggio delle righe successive al wrap
const SPACE_STYLE: CSSProperties = {
  whiteSpace: "pre-wrap",
};

// Sotto questa soglia (px / gradi) una lettera è considerata "ferma": quando
// tutte le lettere sono ferme il loop rAF si sospende finché il puntatore non si muove
const SETTLE_EPS = 0.02;

export default function InteractiveText({
  text,
  className = "",
  radius = 140,
  strength = 40,
  ease = 0.12,
  maxRotation = 12,
}: InteractiveTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const charsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const reduceMotion = usePrefersReducedMotion();

  // Token alternati parola / spazi (la regex cattura anche i separatori)
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);
  const totalChars = useMemo(
    () =>
      tokens.reduce(
        (n, t) => (!t || /^\s/.test(t) ? n : n + Array.from(t).length),
        0,
      ),
    [tokens],
  );

  useEffect(() => {
    const container = containerRef.current;
    // Tronca eventuali ref rimasti da un testo precedente più lungo
    charsRef.current.length = totalChars;
    const chars = charsRef.current.filter((el): el is HTMLSpanElement =>
      Boolean(el),
    );
    if (!container || chars.length === 0) return;

    // Rispetta chi non vuole animazioni: testo fermo e leggibile
    // (reattivo anche al cambio della preferenza a pagina aperta)
    if (reduceMotion) return;

    // Su touch screen l'effetto resta (segue il dito) ma più contenuto
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const effRadius = radius * (coarse ? 0.7 : 1);
    const effStrength = strength * (coarse ? 0.6 : 1);

    const motion: CharMotion[] = chars.map(() => ({
      x: 0,
      y: 0,
      r: 0,
      tx: 0,
      ty: 0,
      tr: 0,
    }));
    let bases: CharBase[] = [];

    // Posizione del puntatore in coordinate di pagina + ultima posizione client
    // (serve a ricalcolare le coordinate di pagina quando si scrolla senza muovere il mouse)
    const mouse = { x: -99999, y: -99999, active: false };
    const lastClient = { x: -99999, y: -99999 };

    let disposed = false;

    // Misura la posizione a riposo azzerando temporaneamente i transform.
    // Batch (azzera tutto → leggi tutto → ripristina) per evitare un reflow per carattere.
    const measure = () => {
      const saved = chars.map((el) => el.style.transform);
      for (const el of chars) el.style.transform = "none";
      const sx = window.scrollX;
      const sy = window.scrollY;
      bases = chars.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          cx: rect.left + rect.width / 2 + sx,
          cy: rect.top + rect.height / 2 + sy,
        };
      });
      chars.forEach((el, i) => {
        el.style.transform = saved[i];
      });
    };
    measure();

    const lerp = (a: number, b: number, n: number) => a + (b - a) * n;

    let rafId = 0;
    let running = false;

    const loop = () => {
      const m = mouse;
      let settled = true;

      for (let i = 0; i < chars.length; i++) {
        const s = motion[i];
        const base = bases[i];
        if (!s || !base) continue;

        const dx = base.cx - m.x;
        const dy = base.cy - m.y;
        const dist = Math.hypot(dx, dy);

        if (m.active && dist < effRadius) {
          const force = 1 - dist / effRadius; // 1 vicino, 0 al bordo del raggio
          const angle = Math.atan2(dy, dx); // dal cursore verso la lettera (repulsione)
          s.tx = Math.cos(angle) * force * effStrength;
          s.ty = Math.sin(angle) * force * effStrength;
          s.tr = force * maxRotation * (dx > 0 ? 1 : -1);
        } else {
          s.tx = 0;
          s.ty = 0;
          s.tr = 0;
        }

        // Interpolazione morbida verso il target (vale sia per andata che ritorno)
        s.x = lerp(s.x, s.tx, ease);
        s.y = lerp(s.y, s.ty, ease);
        s.r = lerp(s.r, s.tr, ease);

        if (
          Math.abs(s.x - s.tx) > SETTLE_EPS ||
          Math.abs(s.y - s.ty) > SETTLE_EPS ||
          Math.abs(s.r - s.tr) > SETTLE_EPS
        ) {
          settled = false;
        }

        chars[i].style.transform =
          `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px) rotate(${s.r.toFixed(2)}deg)`;
      }

      if (settled) {
        // Tutto a riposo: sospendi il loop; qualsiasi evento chiama wake()
        running = false;
        return;
      }
      rafId = requestAnimationFrame(loop);
    };

    const wake = () => {
      if (!running) {
        running = true;
        rafId = requestAnimationFrame(loop);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      lastClient.x = e.clientX;
      lastClient.y = e.clientY;
      mouse.x = e.clientX + window.scrollX;
      mouse.y = e.clientY + window.scrollY;
      mouse.active = true;
      wake();
    };

    // Sul touch: dito sollevato → le lettere tornano a posto
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") {
        mouse.active = false;
        wake();
      }
    };

    const deactivate = () => {
      mouse.active = false;
      wake();
    };

    // Le basi sono in coordinate di pagina, quindi lo scroll non richiede rimisure:
    // va solo aggiornata la posizione di pagina del cursore fermo
    const onScroll = () => {
      mouse.x = lastClient.x + window.scrollX;
      mouse.y = lastClient.y + window.scrollY;
      wake();
    };

    let measureRaf = 0;
    const requestMeasure = () => {
      cancelAnimationFrame(measureRaf);
      measureRaf = requestAnimationFrame(() => {
        measure();
        wake();
      });
    };

    // Rimisura se cambia la larghezza del blocco che contiene il testo (re-wrap).
    // L'osservazione va fatta sul genitore block-level: gli inline riportano sempre 0x0.
    const observed = container.parentElement ?? document.body;
    const ro = new ResizeObserver(requestMeasure);
    ro.observe(observed);

    // Rimisura quando i webfont finiscono di caricare (le metriche cambiano)
    document.fonts?.ready.then(() => {
      if (!disposed) requestMeasure();
    });

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", requestMeasure);
    window.addEventListener("blur", deactivate);
    document.addEventListener("mouseleave", deactivate);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(measureRaf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", requestMeasure);
      window.removeEventListener("blur", deactivate);
      document.removeEventListener("mouseleave", deactivate);
      for (const el of chars) el.style.transform = "";
    };
  }, [text, totalChars, radius, strength, ease, maxRotation, reduceMotion]);

  let charIndex = 0;

  return (
    <span ref={containerRef} className={className}>
      <span style={SR_ONLY}>{text}</span>
      <span aria-hidden="true">
        {tokens.map((token, ti) => {
          if (!token) return null;
          if (/^\s/.test(token)) {
            return (
              <span key={ti} style={SPACE_STYLE}>
                {token}
              </span>
            );
          }
          return (
            <span key={ti} style={WORD_STYLE}>
              {Array.from(token).map((ch, ci) => {
                const idx = charIndex++;
                return (
                  <span
                    key={ci}
                    style={CHAR_STYLE}
                    ref={(el) => {
                      charsRef.current[idx] = el;
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          );
        })}
      </span>
    </span>
  );
}
