// Transizione tra la prima sezione (hero) e la seconda ("Chi siamo").
//
// Tutto è funzione di UNA sola grandezza: quante schermate sono state
// scrollate, `p = scrollY / innerHeight`. 0 = hero fermo a schermo intero,
// 1 = hero appena uscito di scena. Nessuno stato, nessuna direzione: in
// risalita si riavvolge identica per costruzione.
//
// La matematica sta qui, pura e senza DOM, per due motivi: la usa Home.tsx
// per applicare gli stili, e si esegue in Node per verificarne le curve.

/**
 * Quanto la seconda sezione risale sotto la prima, in frazioni di viewport.
 * 0.2 = l'hero consuma l'80% di una schermata di scroll, poi "Chi siamo" è
 * già agganciata in cima e visibile al 100%. Alzarla accorcia ancora la
 * prima sezione. La consuma il margine negativo in Home.module.css, via la
 * variabile CSS --hero-overlap.
 */
export const HERO_OVERLAP = 0.2;

/**
 * Dissolvenza dell'hero: comincia a metà schermata e finisce esattamente
 * quando la seconda sezione arriva in posizione. Chiudere prima di
 * (1 - HERO_OVERLAP) lascerebbe un buco nero, dopo lascerebbe l'hero
 * visibile sopra la sezione già agganciata.
 */
export const HERO_FADE: readonly [number, number] = [0.5, 1 - HERO_OVERLAP];

/**
 * Dissolvenza in entrata della seconda sezione. Serve perché, salita di
 * HERO_OVERLAP nel documento, da fermi il tappo della bottiglia farebbe
 * capolino in fondo all'hero. Finisce presto: il "sale dal basso" resta.
 */
export const ABOUT_FADE: readonly [number, number] = [0.04, 0.3];

/** rampa 0→1 tra due soglie, con partenza e arrivo a velocità nulla */
function ramp(p: number, [from, to]: readonly [number, number]): number {
  const t = Math.max(0, Math.min(1, (p - from) / (to - from || 1)));
  return t * t * (3 - 2 * t); // smoothstep: niente scatti agli estremi
}

export interface TransitionState {
  /** schermate scrollate: 0 = hero intero, 1 = hero appena uscito */
  p: number;
  /** opacità della prima sezione */
  hero: number;
  /** opacità della seconda */
  about: number;
}

/** Lo stato della transizione a una data posizione di scroll. */
export function transitionAt(
  scrollY: number,
  viewportHeight: number,
): TransitionState {
  const p = viewportHeight > 0 ? scrollY / viewportHeight : 0;
  return {
    p,
    hero: 1 - ramp(p, HERO_FADE),
    about: ramp(p, ABOUT_FADE),
  };
}
