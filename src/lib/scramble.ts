// Effetto "decodifica": il testo si risolve da sinistra a destra mentre i
// caratteri non ancora risolti continuano a cambiare. Estratto da ScrollPill
// perché ora lo usa anche l'avviso di scroll bloccato sul mobile.
export const SCRAMBLE_CHARS = "!<>-_\\/[]{}—=+*^?#";
export const SCRAMBLE_MS = 550;

/**
 * Scrive `text` dentro `el` con l'effetto di decodifica.
 * Ritorna una funzione per annullarlo (che lascia il testo completo).
 */
export function scramble(
  el: HTMLElement,
  text: string,
  ms: number = SCRAMBLE_MS,
  delay = 0,
): () => void {
  let raf = 0;
  const start = performance.now() + delay;

  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    const solved = Math.floor(t * text.length);
    let out = text.slice(0, solved);
    for (let i = solved; i < text.length; i++) {
      const ch = text[i];
      out +=
        ch === " "
          ? " "
          : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
    }
    el.textContent = out;
    if (t < 1) raf = requestAnimationFrame(step);
  };

  raf = requestAnimationFrame(step);

  return () => {
    cancelAnimationFrame(raf);
    el.textContent = text;
  };
}
