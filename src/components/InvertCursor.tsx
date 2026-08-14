import { useEffect, useRef, useState } from "react";
import { HERO_OVERLAP } from "../lib/heroTransition";

// niente cursore custom su touch (valutato una volta al mount)
const isTouchDevice = () =>
  window.matchMedia("(hover: none), (pointer: coarse)").matches;

/**
 * Soglia condivisa (frazione di viewport): quando il top della 2ª sezione
 * sale oltre questa linea, la sezione "è arrivata" → cursore invert attivo.
 * ScrollPill usa la STESSA soglia al contrario (pill visibile solo prima),
 * così non esiste mai una zona morta senza né pill né cursore invert.
 *
 * Lo 0.8 di partenza è la soglia voluta; il meno HERO_OVERLAP la compensa,
 * perché la 2ª sezione ora sta più in alto nel documento (margine negativo
 * dell'hero) e senza correzione scatterebbe già a scroll fermo.
 */
export const INVERT_TRIGGER = 0.8 - HERO_OVERLAP;

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

    // tracking istantaneo se l'utente preferisce meno animazioni. Altrimenti
    // inseguimento a costante di tempo (1/s), non a fattore per frame: il
    // vecchio 0.35 per frame rendeva il cerchio il doppio più veloce su un
    // pannello a 120 Hz. 26/s ≈ 0.35 a 60 fps.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const RATE = 26;

    const cur = { x: target.current.x, y: target.current.y };
    let raf = 0;
    let running = false;
    let last = 0;

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 1 / 60, 0.05);
      last = now;
      const k = reduced ? 1 : 1 - Math.exp(-RATE * dt);

      cur.x += (target.current.x - cur.x) * k;
      cur.y += (target.current.y - cur.y) * k;
      if (dot.current) {
        dot.current.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) translate(-50%, -50%)`;
      }

      // arrivato: il loop si spegne. Prima girava per sempre, e a ogni frame
      // faceva getElementById + getBoundingClientRect — un forced layout per
      // frame in parallelo al render WebGL dell'hero, anche col cerchio spento.
      if (
        Math.abs(target.current.x - cur.x) < 0.1 &&
        Math.abs(target.current.y - cur.y) < 0.1
      ) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    const wake = () => {
      if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    const onMove = (e: MouseEvent) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
      wake();
    };
    // feedback: il cerchio cresce sugli elementi interattivi
    const onOver = (e: MouseEvent) => {
      const interactive =
        e.target instanceof Element &&
        e.target.closest("a, button, [role='button']");
      dot.current?.classList.toggle("invert-cursor--grow", !!interactive);
    };

    // ATTIVAZIONE: appena la 2ª sezione "arriva" (anche senza scroll completo),
    // e resta attiva per tutto ciò che sta sotto. Legata a scroll/resize, non
    // al render loop. La sezione è lazy: un ricontrollo differito copre il caso
    // in cui il chunk non fosse ancora montato al mount di questo effetto.
    const updateActive = () => {
      const el = document.getElementById(sectionId);
      if (!el) return;
      const shouldActive =
        el.getBoundingClientRect().top <= window.innerHeight * trigger;
      if (shouldActive === active.current) return;
      active.current = shouldActive;
      document.body.classList.toggle("invert-cursor-active", shouldActive);
      if (dot.current) dot.current.style.opacity = shouldActive ? "1" : "0";
    };
    updateActive();
    const retry = setTimeout(updateActive, 1500);

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseover", onOver, { passive: true });
    window.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive);
    wake();

    return () => {
      clearTimeout(retry);
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      window.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
      active.current = false;
      document.body.classList.remove("invert-cursor-active");
    };
  }, [sectionId, trigger, enabled]);

  if (!enabled) return null;
  return <div ref={dot} className="invert-cursor" aria-hidden="true" />;
}
