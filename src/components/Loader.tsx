import { useEffect, useRef, useState } from "react";
import { getAssetProgress } from "../lib/assetProgress";
import styles from "./Loader.module.css";

interface LoaderProps {
  // Chiamata quando l'overlay inizia a scorrere via: da qui l'hero può rivelarsi
  onRevealStart: () => void;
  duration?: number; // durata minima del conteggio 0→100 in ms
}

// Flag a livello di modulo: il loader appare solo al primo mount della sessione,
// non ad ogni navigazione client-side o re-render
let alreadyShown = false;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export default function Loader({ onRevealStart, duration = 1600 }: LoaderProps) {
  // Catturato una volta per istanza: regge anche al doppio effect di StrictMode
  const [skip] = useState(alreadyShown);
  const [displayed, setDisplayed] = useState(0);
  const [phase, setPhase] = useState<"counting" | "leaving" | "done">(
    skip ? "done" : "counting",
  );

  const onRevealRef = useRef(onRevealStart);
  useEffect(() => {
    onRevealRef.current = onRevealStart;
  });

  useEffect(() => {
    if (skip) {
      onRevealRef.current();
      return;
    }
    alreadyShown = true;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const total = reduce ? 300 : duration;

    let rafId = 0;
    let timeoutId = 0;
    let shown = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      const timeTarget = easeInOutCubic(t) * 100;
      // il contatore sale col tempo ma non supera il caricamento reale:
      // finché il chunk della scena non ha riportato nulla si ferma a 90
      // (chunk three in download), poi segue il progresso dei GLB.
      // Failsafe: oltre i 12s si sblocca comunque (asset falliti, no WebGL)
      const asset = getAssetProgress();
      const cap =
        now - start > 12000
          ? 100
          : !asset.reported
            ? 90
            : asset.active
              ? asset.progress
              : 100;
      shown = Math.max(shown, Math.min(timeTarget, cap)); // mai all'indietro
      setDisplayed(Math.round(shown));

      if (shown < 100) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      // 100%: breve pausa, poi l'overlay scorre via e l'hero si rivela
      timeoutId = window.setTimeout(() => {
        setPhase("leaving");
        onRevealRef.current();
        // durata della transizione CSS (600ms) + margine
        timeoutId = window.setTimeout(() => setPhase("done"), 750);
      }, 200);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [skip, duration]);

  if (phase === "done") return null;

  return (
    <div
      className={`${styles.overlay} ${phase === "leaving" ? styles.leaving : ""}`}
      role="status"
      aria-label="Caricamento"
    >
      {/* il contatore animato è aria-hidden: la live region annuncia solo
          "Caricamento" una volta, non cento aggiornamenti di percentuale */}
      <div className={styles.counter} aria-hidden="true">
        <span className={styles.label}>Loading</span>
        <span className={styles.value}>{displayed}%</span>
      </div>
    </div>
  );
}
