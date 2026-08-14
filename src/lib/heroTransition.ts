// Taratura della transizione tra la prima sezione (hero) e la seconda
// ("Chi siamo"). Tutto in frazioni di viewport scrollata dentro l'hero:
// 0 = hero a schermo intero fermo in cima, 1 = hero appena uscito di scena.
//
// Sta in un modulo a sé perché la stessa taratura serve in tre posti che non
// devono importarsi a vicenda: il layout (Home.tsx → variabile CSS), la
// dissolvenza (Home.tsx) e la soglia di pill/cursore invert (InvertCursor.tsx).

/**
 * Quanto la seconda sezione risale sotto la prima. 0.2 = l'hero consuma
 * l'80% di una schermata di scroll, poi "Chi siamo" è già agganciata in cima
 * e visibile al 100%. Alzarla accorcia ancora la prima sezione.
 */
export const HERO_OVERLAP = 0.2;

/**
 * Dissolvenza dell'hero: comincia a metà schermata e finisce esattamente
 * quando la seconda sezione arriva in posizione. Chiudere PRIMA di
 * (1 - HERO_OVERLAP) lascerebbe un buco nero, DOPO lascerebbe l'hero
 * visibile sopra la sezione già agganciata.
 */
export const HERO_FADE: [number, number] = [0.5, 1 - HERO_OVERLAP];

/**
 * Dissolvenza in entrata della seconda sezione. Serve perché, salita di
 * HERO_OVERLAP nel documento, da fermi il tappo della bottiglia farebbe
 * capolino in fondo all'hero. Finisce presto: il "sale dal basso" resta.
 */
export const ABOUT_FADE: [number, number] = [0.05, 0.35];
