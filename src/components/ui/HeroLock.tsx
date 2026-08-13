import { useEffect, useRef } from "react";
import { scramble } from "../../lib/scramble";
import styles from "./HeroLock.module.css";

// Il messaggio che compare tornando dalla seconda sezione alla prima. Spiega
// il blocco E insegna l'interazione: sul mobile, senza hover, nessuno
// scoprirebbe da solo che il logo si può spingere col dito.
export const LOCK_HINT_TITLE = "Scroll bloccato";
export const LOCK_HINT_BODY = "Trascina il logo · ↓ per scendere";

interface HeroLockProps {
  /** true quando la prima sezione è agganciata e lo scroll è bloccato */
  locked: boolean;
  /** true mentre va mostrato l'avviso (lo pilota Home, che ne conosce la durata) */
  hint: boolean;
  /** il loader ha finito: prima non ha senso mostrare nulla */
  revealed: boolean;
  onRelease: () => void;
}

/**
 * Solo touch. Il pulsante è l'unico modo per scendere dalla prima sezione;
 * l'avviso appare quando si risale e lo scroll si riblocca.
 */
export default function HeroLock({
  locked,
  hint,
  revealed,
  onRelease,
}: HeroLockProps) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);

  // l'effetto qui fa una cosa sola: pilotare il DOM (la decodifica del testo).
  // Quando mostrarlo e per quanto lo decide Home.
  useEffect(() => {
    if (!hint) return;
    const stops = [
      titleRef.current && scramble(titleRef.current, LOCK_HINT_TITLE),
      bodyRef.current && scramble(bodyRef.current, LOCK_HINT_BODY, 550, 160),
    ];
    return () => {
      for (const s of stops) s?.();
    };
  }, [hint]);

  const show = revealed && locked;

  return (
    <>
      <div
        className={`${styles.hint} ${hint && show ? styles.hintVisible : ""}`}
        aria-hidden="true"
      >
        <span ref={titleRef} className={styles.hintTitle}>
          {LOCK_HINT_TITLE}
        </span>
        <span ref={bodyRef} className={styles.hintBody}>
          {LOCK_HINT_BODY}
        </span>
      </div>
      {/* l'avviso è decorativo (si scramble­a): il testo leggibile dagli screen
          reader vive qui, annunciato quando cambia */}
      <p className={styles.srOnly} role="status">
        {hint && show ? `${LOCK_HINT_TITLE}. ${LOCK_HINT_BODY}` : ""}
      </p>

      <button
        type="button"
        className={`${styles.button} ${show ? styles.visible : ""}`}
        onClick={onRelease}
        tabIndex={show ? 0 : -1}
        aria-label="Vai alla sezione successiva"
      >
        <svg
          className={styles.arrow}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 2.5v11M3.5 9.5 8 14l4.5-4.5" />
        </svg>
      </button>
    </>
  );
}
