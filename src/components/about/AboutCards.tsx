import { useImperativeHandle, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { ABOUT_CARDS } from "./aboutContent";
import {
  CONFIG,
  applyDomPose,
  cardWindow,
  computeCardPose,
  makeDomPose,
} from "./aboutTimeline";
import type { Breakpoint } from "./aboutTimeline";
import styles from "./AboutCards.module.css";

// posa riusata: le card si aggiornano scrivendo su style, mai su React state —
// un re-render per frame di scroll sarebbe insostenibile e del tutto inutile
const _pose = makeDomPose();

export interface CardsHandle {
  /** riposiziona tutte le card al progresso dato */
  apply(p: number): void;
}

interface AboutCardsProps {
  ref: RefObject<CardsHandle | null>;
  breakpoint: Breakpoint;
  reduceMotion: boolean;
}

export function AboutCards({ ref, breakpoint, reduceMotion }: AboutCardsProps) {
  const items = useRef<(HTMLElement | null)[]>([]);
  const cfg = CONFIG[breakpoint];

  // le finestre dipendono solo dal breakpoint: calcolarle a ogni frame
  // sarebbe sprecato, e cambiano solo quando cambia la configurazione
  const windows = useMemo(
    () => ABOUT_CARDS.map((_, i) => cardWindow(i, ABOUT_CARDS.length, cfg)),
    [cfg],
  );

  useImperativeHandle(
    ref,
    () => ({
      apply(p: number) {
        if (reduceMotion) return;
        for (let i = 0; i < ABOUT_CARDS.length; i++) {
          const el = items.current[i];
          if (!el) continue;
          const card = ABOUT_CARDS[i];
          applyDomPose(
            el,
            computeCardPose(p, windows[i], card.lane, card.tilt, cfg, _pose),
          );
        }
      },
    }),
    [reduceMotion, windows, cfg],
  );

  return (
    <ul
      className={`${styles.list} ${reduceMotion ? styles.listStatic : ""}`}
      // in reduced motion diventa una lista leggibile e statica: il contenuto
      // non deve mai dipendere dall'animazione per essere raggiungibile
    >
      {ABOUT_CARDS.map((card, i) => (
        <li key={card.id} className={styles.card}>
          {/* il transform va sul figlio: il <li> serve solo a centrare, così
              rotazione e scala girano attorno al centro della card */}
          <div
            ref={(el) => {
              items.current[i] = el;
            }}
            className={styles.inner}
          >
            <span className={styles.index}>{card.index}</span>
            <h3 className={styles.title}>{card.title}</h3>
            <p className={styles.body}>{card.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
