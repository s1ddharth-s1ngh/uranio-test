import { useEffect, useRef, useState } from "react";

// niente cursore custom su touch (valutato una volta al mount)
const isTouchDevice = () =>
  window.matchMedia("(hover: none), (pointer: coarse)").matches;

/**
 * Soglia condivisa (frazione di viewport): quando il top della 2ª sezione
 * sale oltre questa linea, la sezione "è arrivata" → cursore invert attivo.
 * ScrollPill usa la STESSA soglia al contrario (pill visibile solo prima),
 * così non esiste mai una zona morta senza né pill né cursore invert.
 */
export const INVERT_TRIGGER = 0.8;

/**
 * Cerchio che segue il mouse e inverte i colori di ciò che ha sotto
 * (backdrop-filter: invert, funziona anche sopra i canvas WebGL).
 * Si attiva appena la seconda sezione (sectionId) "arriva": quando il suo
 * bordo superiore entra oltre `trigger` × altezza viewport, e resta attivo
 * per tutto ciò che sta sotto. Disabilitato su touch. Stili in index.css.
 */
export default function InvertCursor({
  sectionId = "about", // la SECONDA sezione
  trigger = INVERT_TRIGGER, // 0..1: più ALTO = si attiva PRIMA
}: {
  sectionId?: string;
  trigger?: number;
}) {
  const dot = useRef<HTMLDivElement>(null);
  const target = useRef({ x: -200, y: -200 });
  const active = useRef(false);
  const [enabled] = useState(() => !isTouchDevice());

  useEffect(() => {
    if (!enabled) return;

    // tracking istantaneo se l'utente preferisce meno animazioni
    const lerp = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 1
      : 0.35;

    const onMove = (e: MouseEvent) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
    };
    // feedback: il cerchio cresce sugli elementi interattivi
    const onOver = (e: MouseEvent) => {
      const interactive =
        e.target instanceof Element &&
        e.target.closest("a, button, [role='button']");
      dot.current?.classList.toggle("invert-cursor--grow", !!interactive);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseover", onOver, { passive: true });

    const cur = { x: target.current.x, y: target.current.y };
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);

      // follow morbido
      cur.x += (target.current.x - cur.x) * lerp;
      cur.y += (target.current.y - cur.y) * lerp;
      if (dot.current) {
        dot.current.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) translate(-50%, -50%)`;
      }

      // ATTIVAZIONE: appena la 2ª sezione "arriva" (anche senza scroll
      // completo), e resta attiva per tutto ciò che sta sotto. La sezione è
      // lazy: la ricerca per id resta nel loop finché il chunk non è montato.
      const el = document.getElementById(sectionId);
      if (el) {
        const top = el.getBoundingClientRect().top;
        const shouldActive = top <= window.innerHeight * trigger;
        if (shouldActive !== active.current) {
          active.current = shouldActive;
          document.body.classList.toggle("invert-cursor-active", shouldActive);
          if (dot.current) {
            dot.current.style.opacity = shouldActive ? "1" : "0";
          }
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      active.current = false;
      document.body.classList.remove("invert-cursor-active");
    };
  }, [sectionId, trigger, enabled]);

  if (!enabled) return null;
  return <div ref={dot} className="invert-cursor" aria-hidden="true" />;
}
