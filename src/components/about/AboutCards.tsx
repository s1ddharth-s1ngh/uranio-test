import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { ABOUT_CARDS } from "./aboutContent";
import {
  CONFIG,
  applyDomPose,
  capHoverScreen,
  cardArcLift,
  cardWindow,
  computeCardPose,
  makeCapScreenBox,
  makeDomPose,
} from "./aboutTimeline";
import type { Breakpoint } from "./aboutTimeline";
import styles from "./AboutCards.module.css";

// posa riusata: le card si aggiornano scrivendo su style, mai su React state —
// un re-render per frame di scroll sarebbe insostenibile e del tutto inutile
const _pose = makeDomPose();
const _capBox = makeCapScreenBox();

// Misure dell'assieme in unità dell'holder (vedi bottleAssembly.world). Qui
// servono solo per collocare il tappo sullo schermo e tenerci lontane le
// card: sono costanti del GLB, rilevate headless.
const BOTTLE_HEIGHT = 1.9841;
const CAP_RADIUS = 0.1688;
const CAP_HEIGHT = 0.0635;

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

  // Alzata dell'arco per scavalcare il tappo. Dipende dall'ALTEZZA VERA della
  // card, che in vh cambia parecchio: su un portatile basso la stessa card
  // occupa molta più viewport. Misurata, non stimata, e ricalcolata al resize.
  const lift = useRef(0);
  useEffect(() => {
    if (reduceMotion) return;
    // due corsie estreme: la più bassa rischia di finire sotto il tappo, la
    // più alta di uscire dal bordo superiore. L'alzata è unica per tutte.
    const maxLane = Math.max(...ABOUT_CARDS.map((c) => c.lane));
    const minLane = Math.min(...ABOUT_CARDS.map((c) => c.lane));
    const measure = () => {
      const el = items.current[0];
      if (!el) return;
      const halfH = ((el.offsetHeight / window.innerHeight) * 100) / 2;
      const halfW = ((el.offsetWidth / window.innerWidth) * 100) / 2;
      capHoverScreen(
        cfg,
        window.innerWidth / window.innerHeight,
        BOTTLE_HEIGHT,
        CAP_RADIUS,
        CAP_HEIGHT,
        _capBox,
      );
      lift.current = cardArcLift(cfg, _capBox, halfH, halfW, maxLane, minLane);
    };
    measure();
    window.addEventListener("resize", measure);
    // il testo si rimpagina quando arrivano i font: cambia l'altezza della card
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener("resize", measure);
  }, [cfg, reduceMotion]);

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
            computeCardPose(
              p,
              windows[i],
              card.lane,
              card.tilt,
              cfg,
              lift.current,
              _pose,
            ),
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
