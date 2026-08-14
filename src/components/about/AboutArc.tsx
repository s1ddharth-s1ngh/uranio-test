import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { ABOUT_HEADLINE } from "./aboutContent";
import {
  ARC_ADVANCE,
  CONFIG,
  arcLayout,
  arcSlot,
  computeArcLetterPose,
  makeArcLayout,
  makeDomPose,
} from "./aboutTimeline";
import type { ArcSlot, Breakpoint } from "./aboutTimeline";
import styles from "./AboutArc.module.css";

const _pose = makeDomPose();
const _slot: ArcSlot = { left: 0, top: 0, rot: 0 };
const _layout = makeArcLayout();

export interface ArcHandle {
  apply(p: number): void;
}

interface AboutArcProps {
  ref: RefObject<ArcHandle | null>;
  breakpoint: Breakpoint;
  reduceMotion: boolean;
}

/**
 * Messaggio finale disposto su un arco ellittico.
 *
 * Lettere singole invece di un <textPath> SVG: così ognuna può entrare in
 * ritardo sulla precedente. Il testo completo resta leggibile agli screen
 * reader tramite aria-label, e gli span sono aria-hidden — altrimenti la
 * frase verrebbe letta lettera per lettera.
 *
 * Due trasformazioni su elementi diversi, mai sullo stesso: lo span esterno
 * porta la posa STATICA sull'arco (posizione e tangente), quello interno la
 * posa animata dalla timeline.
 */
export function AboutArc({ ref, breakpoint, reduceMotion }: AboutArcProps) {
  const cfg = CONFIG[breakpoint];
  const outers = useRef<(HTMLElement | null)[]>([]);
  const inners = useRef<(HTMLElement | null)[]>([]);

  // gli spazi restano nel testo per gli screen reader ma non diventano slot:
  // una lettera invisibile occuperebbe comunque un posto sull'arco
  const letters = useMemo(() => Array.from(ABOUT_HEADLINE), []);

  // Collocazione sull'arco: dipende dall'aspect ratio (rx è in frazioni di
  // larghezza, ry di altezza), quindi va rifatta a ogni resize. Si scrive
  // direttamente sugli elementi: è statica, non merita un re-render.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const n = letters.length;
      arcLayout(n, cfg, w / h, _layout);

      // Corpo che sta DAVVERO nell'arco: quello di config è un massimo, ma su
      // uno schermo stretto una frase lunga non ci entra e le lettere si
      // sovrapporrebbero. Ricavarlo dalla lunghezza misurata rende il
      // componente indifferente sia al testo sia alla risoluzione.
      const arcPx = _layout.length * h;
      const fit = arcPx / (Math.max(n - 1, 1) * ARC_ADVANCE);
      const fontPx = Math.min((cfg.arc.fontVw / 100) * w, fit);
      root.current?.style.setProperty("--arc-font", `${fontPx.toFixed(2)}px`);

      const aspect = w / h;
      for (let i = 0; i < n; i++) {
        const el = outers.current[i];
        if (!el) continue;
        arcSlot(_layout.angles[i], cfg, aspect, _slot);
        el.style.left = `${_slot.left.toFixed(3)}%`;
        el.style.top = `${_slot.top.toFixed(3)}%`;
        el.style.transform = `translate(-50%, -50%) rotate(${_slot.rot.toFixed(2)}deg)`;
      }
    };
    place();
    window.addEventListener("resize", place);
    // il corpo dipende dalla metrica del font: va rifatto quando arriva
    document.fonts?.ready.then(place).catch(() => {});
    return () => window.removeEventListener("resize", place);
  }, [cfg, letters]);

  useImperativeHandle(
    ref,
    () => ({
      apply(p: number) {
        if (reduceMotion) return;
        for (let i = 0; i < letters.length; i++) {
          const el = inners.current[i];
          if (!el) continue;
          computeArcLetterPose(p, i, letters.length, _pose);
          el.style.opacity = _pose.opacity.toFixed(3);
          el.style.transform =
            `translate3d(${_pose.x.toFixed(3)}vw, 0, 0) scale(${_pose.scale.toFixed(4)})`;
        }
      },
    }),
    [reduceMotion, letters],
  );

  return (
    <div
      ref={root}
      className={`${styles.arc} ${reduceMotion ? styles.arcStatic : ""}`}
      aria-label={ABOUT_HEADLINE}
      role="img"
    >
      {letters.map((ch, i) => (
        <span
          key={`${ch}-${i}`}
          ref={(el) => {
            outers.current[i] = el;
          }}
          className={styles.slot}
          aria-hidden="true"
        >
          <span
            ref={(el) => {
              inners.current[i] = el;
            }}
            className={styles.letter}
          >
            {/* spazio unificatore: in reduced motion le lettere tornano in
                flusso e uno spazio normale collasserebbe, attaccando le parole */}
            {ch === " " ? " " : ch}
          </span>
        </span>
      ))}
    </div>
  );
}
