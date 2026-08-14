import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// Progresso 0..1 dello scroll dentro una sezione alta più di una schermata.
// È l'UNICA sorgente di verità della seconda sezione: la leggono sia il canvas
// (ogni frame, da una ref) sia gli overlay in DOM (a ogni scroll).
//
// Scritto a mano invece che con useScroll di Framer, per lo stesso motivo per
// cui è stata rifatta la transizione dell'hero (vedi lib/heroTransition.ts):
// useScroll misura l'elemento dentro un effect, e col doppio mount/unmount di
// StrictMode resta agganciato a misure fantasma. Qui la sorgente è scrollY,
// letta al momento, e le misure del wrapper stanno in una cache invalidata da
// ResizeObserver — nessuno stato da cui divergere.

/**
 * Progresso della sezione: 0 quando il suo bordo alto tocca il bordo alto del
 * viewport, 1 quando il bordo basso tocca quello basso. Equivale all'offset
 * ["start start", "end end"] di Framer, ma senza misure conservate in stato.
 *
 * Pura apposta: si esegue in Node per verificare gli estremi.
 */
export function sectionProgress(
  scrollY: number,
  viewportHeight: number,
  wrapperTop: number,
  wrapperHeight: number,
): number {
  // quanto scroll "consuma" la sezione: la sua altezza meno una schermata
  const travel = wrapperHeight - viewportHeight;
  if (travel <= 0) return 0;
  const p = (scrollY - wrapperTop) / travel;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * Restituisce la ref del progresso e chiama `onUpdate` a ogni cambiamento.
 *
 * La ref la crea l'hook e la possiede: passargliela dall'esterno vorrebbe dire
 * mutare un argomento, cosa che il lint (giustamente) vieta.
 *
 * Non c'è un RAF continuo: si programma un frame solo quando la pagina scorre
 * o cambia misura. Il canvas 3D ha già il suo loop e legge la ref, quindi non
 * servono due ticker che girano a vuoto.
 */
export function useSectionProgress(
  wrapper: RefObject<HTMLElement | null>,
  onUpdate: (p: number) => void,
): RefObject<number> {
  const progress = useRef(0);

  // `onUpdate` sta nelle dipendenze, quindi va passata memoizzata: altrimenti
  // i listener si riagganciano a ogni render. Tenerla in una ref aggiornata in
  // render sarebbe più comodo ma è proprio ciò che react-hooks/refs vieta.
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;

    // misure in cache: leggerle a ogni frame vorrebbe dire forzare un layout
    // sincrono subito dopo aver scritto gli stili degli overlay
    let top = 0;
    let height = 0;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      top = rect.top + window.scrollY;
      height = rect.height;
    };

    let raf = 0;
    const apply = () => {
      raf = 0;
      const p = sectionProgress(
        window.scrollY,
        window.innerHeight,
        top,
        height,
      );
      progress.current = p;
      onUpdate(p);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const remeasure = () => {
      measure();
      schedule();
    };

    measure();
    apply();

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    // l'altezza del wrapper è in svh: cambia con i breakpoint e quando le
    // barre del browser mobile collassano
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    // i font cambiano l'altezza del contenuto sopra la sezione, quindi la sua
    // posizione nel documento: senza questo il progresso parte sfasato
    document.fonts?.ready.then(remeasure).catch(() => {});

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      ro.disconnect();
    };
  }, [wrapper, onUpdate]);

  return progress;
}
