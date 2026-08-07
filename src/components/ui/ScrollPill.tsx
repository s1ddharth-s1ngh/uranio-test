import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { INVERT_TRIGGER } from "../InvertCursor";
import styles from "./ScrollPill.module.css";

// la pill sparisce ESATTAMENTE quando "arriva" la seconda sezione, cioè
// quando si accende il cursore invert (stessa soglia condivisa): risalendo
// torna da sola, senza zona morta e senza bisogno di muovere il mouse
const SECTION_ID = "about";

interface ScrollPillProps {
  label?: string;
  revealed: boolean;
}

// La pill insegue il cursore con inerzia (come nel riferimento: fa da
// "etichetta cursore"). Quando il cursore le finisce sopra — cioè quando la
// pill lo raggiunge — si accende in giallo pieno e il testo fa uno scramble.
// Senza mouse (touch fermo, reduced-motion) resta al suo posto in basso
const EASE = 5.5; // reattività dell'inseguimento: più alto = più incollata
const CURSOR_ANCHOR = 48; // px dal bordo destro della pill al punto-cursore
const SCRAMBLE_CHARS = "!<>-_\\/[]{}—=+*^?#";
const SCRAMBLE_MS = 550;

export default function ScrollPill({
  label = "Scorri in basso",
  revealed,
}: ScrollPillProps) {
  const el = useRef<HTMLDivElement>(null);
  const labelEl = useRef<HTMLSpanElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  // dopo il reveal iniziale (lento, col suo delay) le comparse/sparizioni
  // legate allo scroll devono essere immediate: niente delay di 0.7s quando
  // si risale dalla zona del cursore invert
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setSettled(true), 1700);
    return () => clearTimeout(t);
  }, [revealed]);

  // invito allo scroll: visibile finché il cursore invert è spento, nascosta
  // quando la 2ª sezione è arrivata. Vale anche su touch e in reduced-motion.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => {
      const el = document.getElementById(SECTION_ID);
      setHidden(
        !!el &&
          el.getBoundingClientRect().top <=
            window.innerHeight * INVERT_TRIGGER,
      );
    };
    update();
    // la 2ª sezione è in un chunk lazy: ricontrolla a chunk montato
    const retry = setTimeout(update, 1500);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const node = el.current;
    const labelNode = labelEl.current;
    if (!node || !labelNode) return;
    // reattivo anche al toggle a runtime: il cleanup riporta la pill a riposo
    if (reduceMotion) return;

    // posizione di riposo in COORDINATE DI PAGINA (stabili durante lo
    // scroll: la pagina ora scorre e la pill vive dentro l'hero)
    const rest = { x: 0, y: 0, w: 0, h: 0 };
    const measure = () => {
      const prev = node.style.transform;
      node.style.transform = "none";
      const r = node.getBoundingClientRect();
      node.style.transform = prev;
      rest.x = r.left + window.scrollX;
      rest.y = r.top + window.scrollY;
      rest.w = r.width;
      rest.h = r.height;
    };
    measure();

    const mouse = { x: 0, y: 0, has: false };
    const cur = { x: 0, y: 0 }; // offset corrente rispetto al riposo
    let hovered = false;
    let raf = 0;
    let running = false;
    let last = 0;

    // scramble del testo alla "cattura": i caratteri si decodificano
    // da sinistra a destra fino al testo reale
    let scrambleRaf = 0;
    const startScramble = () => {
      cancelAnimationFrame(scrambleRaf);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / SCRAMBLE_MS);
        const solved = Math.floor(t * label.length);
        let text = label.slice(0, solved);
        for (let i = solved; i < label.length; i++) {
          const ch = label[i];
          text +=
            ch === " "
              ? " "
              : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
        }
        labelNode.textContent = text;
        if (t < 1) scrambleRaf = requestAnimationFrame(step);
      };
      scrambleRaf = requestAnimationFrame(step);
    };

    const setHover = (next: boolean) => {
      if (next === hovered) return;
      hovered = next;
      node.classList.toggle(styles.hovered, next);
      if (next) startScramble();
    };

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0.016, 0.05);
      last = now;

      // target: il punto-cursore sta verso il fondo del testo, col dado
      // giallo poco più a destra (come nel riferimento); senza cursore
      // attivo si torna al riposo. Cursore convertito in coordinate di
      // pagina, coerenti con `rest` a qualsiasi posizione di scroll
      const mx = mouse.x + window.scrollX;
      const my = mouse.y + window.scrollY;
      const tx = mouse.has ? mx - (rest.x + rest.w - CURSOR_ANCHOR) : 0;
      const ty = mouse.has ? my - (rest.y + rest.h / 2) : 0;

      const k = 1 - Math.exp(-EASE * dt); // lerp indipendente dal framerate
      cur.x += (tx - cur.x) * k;
      cur.y += (ty - cur.y) * k;

      node.style.transform = `translate(${cur.x.toFixed(2)}px, ${cur.y.toFixed(2)}px)`;

      // "hover" geometrico: il cursore è dentro la pill nella sua posizione
      // attuale? (la pill ha pointer-events: none, l'hover CSS non esiste)
      const left = rest.x + cur.x;
      const top = rest.y + cur.y;
      setHover(
        mouse.has &&
          mx >= left &&
          mx <= left + rest.w &&
          my >= top &&
          my <= top + rest.h,
      );

      if (Math.abs(tx - cur.x) < 0.1 && Math.abs(ty - cur.y) < 0.1) {
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

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.has = true;
      wake();
    };
    // sul touch, dito sollevato → la pill torna al suo posto
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") {
        mouse.has = false;
        wake();
      }
    };
    const release = () => {
      mouse.has = false;
      wake();
    };
    const onResize = () => {
      measure();
      wake();
    };

    // lo scroll sposta il target (il cursore cambia posizione di pagina)
    const onScroll = () => wake();

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("blur", release);
    document.addEventListener("mouseleave", release);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(scrambleRaf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("blur", release);
      document.removeEventListener("mouseleave", release);
      node.style.transform = "";
      node.classList.remove(styles.hovered);
      labelNode.textContent = label;
    };
  }, [label, reduceMotion]);

  return (
    <div
      className={`${styles.wrap} ${revealed ? styles.revealed : ""} ${settled ? styles.settled : ""} ${hidden ? styles.hiddenByScroll : ""}`}
    >
      <div ref={el} className={styles.pill}>
        <span className={styles.srOnly}>{label}</span>
        <span ref={labelEl} className={styles.label} aria-hidden="true">
          {label}
        </span>
        <span className={styles.die} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
