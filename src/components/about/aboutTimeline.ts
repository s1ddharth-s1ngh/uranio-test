// Timeline della sezione "about": UNICA fonte dei numeri di taratura.
// Qui non entra né React né three: sono funzioni pure e tabelle di costanti,
// così la stessa logica si esegue in Node per verificare le pose ai checkpoint
// (vedi la nota tecnica in fondo al file).
//
// Regola d'oro: la posa a un dato `progress` non dipende MAI dalla storia
// dello scroll. Tutto è ricostruibile da p ∈ [0,1], in avanti e all'indietro.

// --- MISURE REALI DEI GLB (rilevate headless, non stimate) ---------------
// buildBottleAssembly normalizza l'assieme a 2 unità di altezza, centrato
// sull'origine. Dentro quell'assieme, misurato sui GLB veri:
//   bottiglia  h 1.9841  largh. 0.7128   y ∈ [-1.0000, 0.9841]
//   tappo      h 0.0635  raggio 0.1688   origine (fondo gonna) y 0.9365
//   bocca      raggio 0.1520             top y 0.9841
// Il tappo è una corona (Ø/h ≈ 5.3): gonna cilindrica aperta in basso e
// cupola chiusa in alto → apertura con micro-tilt, pop e spin.
export const ASSEMBLY_HEIGHT = 2;
export const BOTTLE_HEIGHT = 1.9841;
export const BOTTLE_WIDTH = 0.7128;
/** larghezza/altezza della bottiglia: converte le quote "in altezze" in "in larghezze" */
export const BOTTLE_ASPECT = BOTTLE_WIDTH / BOTTLE_HEIGHT;

// --- FASI ----------------------------------------------------------------
// Gli intervalli si sovrappongono di proposito: senza sovrapposizione, tra una
// fase e l'altra ci sarebbe un istante di immobilità che si legge come scatto.
export interface Span {
  s: number;
  e: number;
}

export const PHASES = {
  /** handoff dalla sezione precedente: bottiglia mezza nascosta, tappo attaccato */
  entry: { s: 0.0, e: 0.08 },
  /** titolo e sottotitolo entrano e si assestano */
  intro: { s: 0.05, e: 0.18 },
  /** anticipazione: il tappo carica, la bottiglia rincula appena */
  tension: { s: 0.16, e: 0.23 },
  /** distacco, arco, spin e arrivo in hovering */
  opening: { s: 0.22, e: 0.36 },
  /** card da destra a sinistra, bottiglia aperta, tappo reattivo */
  content: { s: 0.32, e: 0.72 },
  /** messaggio grande sul semicerchio */
  headline: { s: 0.66, e: 0.83 },
  /** uscita contenuti e traiettoria di ritorno del tappo */
  returning: { s: 0.8, e: 0.93 },
  /** allineamento, contatto e micro-assestamento sull'anchor */
  reattach: { s: 0.91, e: 0.97 },
  /** bottiglia intera, hold finale e uscita */
  reveal: { s: 0.94, e: 1.0 },
} as const satisfies Record<string, Span>;

// --- HELPER PURI ---------------------------------------------------------

export const clamp01 = (v: number): number =>
  v < 0 ? 0 : v > 1 ? 1 : v;

export const clampAbs = (v: number, lim: number): number =>
  v < -lim ? -lim : v > lim ? lim : v;

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/**
 * Progresso locale 0..1 dentro una fase. È l'unico modo in cui la timeline
 * legge `p`: nessuna macchina a stati, nessun onComplete.
 */
export const phase = (p: number, span: Span): number =>
  clamp01((p - span.s) / (span.e - span.s || 1));

// Easing "premium": sine/cubic/quint e un overshoot minimo. Niente elastic,
// niente bounce: su uno scrub fanno sembrare l'animazione sporca.
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutQuint = (t: number): number => 1 - (1 - t) ** 5;
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** overshoot appena percettibile (~3%): l'assestamento, non il rimbalzo */
export const easeOutBackSoft = (t: number): number => {
  const c = 0.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** finestra 0→1→0: utile a pesare un effetto solo dentro una fase */
export const bump = (t: number): number => Math.sin(Math.PI * clamp01(t));

/** interpola su coppie [progresso, valore] ordinate, con smoothstep */
export function keyframes(p: number, stops: readonly [number, number][]): number {
  if (p <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, v0] = stops[i];
    const [p1, v1] = stops[i + 1];
    if (p >= p0 && p <= p1) {
      return v0 + (v1 - v0) * smoothstep((p - p0) / (p1 - p0 || 1));
    }
  }
  return last[1];
}

/**
 * Damping esponenziale indipendente dal frame rate: stesso tempo di
 * assestamento a 60Hz, 120Hz e con i frame persi. È il linguaggio di
 * movimento già usato dalla prima sezione (λ tra 5 e 11).
 */
export const dampFactor = (lambda: number, dt: number): number =>
  1 - Math.exp(-lambda * dt);

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}
export type Vec3 = readonly [number, number, number];

/** Bézier cubica scritta in `out`: zero allocazioni per frame. */
export function bezier3(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  t: number,
  out: MutableVec3,
): MutableVec3 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  out.x = a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0];
  out.y = a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1];
  out.z = a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2];
  return out;
}

// --- TARATURA PER BREAKPOINT --------------------------------------------

export type Breakpoint = "desktop" | "tablet" | "mobile";

export interface BottleFraming {
  /**
   * frazione dell'altezza della bottiglia che resta SOTTO il bordo inferiore
   * del viewport. 0.5 = metà nascosta (fase centrale), ~0 = intera (finale).
   */
  hidden: number;
  /** quanto della viewport occupa la parte VISIBILE della bottiglia */
  visibleRatio: number;
}

export interface CapTrajectory {
  /**
   * Punti di controllo in offset dall'anchor, espressi in ALTEZZE DI
   * BOTTIGLIA (moltiplicati a runtime per l'altezza mondo corrente): così la
   * traiettoria resta identica cambiando scala, breakpoint o reveal finale.
   * P0 è sempre l'anchor (0,0,0) e non compare qui.
   */
  lift: Vec3; // P1: stacco quasi verticale
  apex: Vec3; // P2: apice, inizio della deriva laterale
  hover: Vec3; // P3: posa di hovering
  /** giri interi sull'asse del tappo durante l'apertura */
  spinTurns: number;
  /** inclinazione (rad) del tappo in hovering: mostra la cupola alla camera */
  hoverTiltX: number;
  hoverTiltZ: number;
}

export interface AboutConfig {
  /** altezza del wrapper in viewport: è la "pin distance" della narrazione */
  pinVh: number;
  framing: { middle: BottleFraming; final: BottleFraming };
  cap: CapTrajectory;
  /** ampiezze del moto continuo della bottiglia (unità mondo / radianti) */
  idle: { bobY: number; rollZ: number; pitchX: number; yawY: number };
  /** risposta al puntatore della bottiglia */
  pointer: { yaw: number; pitch: number; roll: number; shiftX: number };
  /** risposta al puntatore del tappo staccato (più viva) */
  capPointer: { shift: number; tilt: number };
  /** rotazione narrativa della bottiglia durante le card (rad, totale) */
  contentYaw: number;
  /** card visibili contemporaneamente (governa la sovrapposizione) */
  cardOverlap: number;
  /** semiassi dell'arco della headline, in frazioni di viewport */
  arc: { rx: number; ry: number; cy: number; fontVw: number };
}

// I numeri nascono dai budget di movimento del brief e sono poi tarati sul
// modello vero: idle sotto l'1.5% dell'altezza, yaw del mouse entro 4°,
// apice del tappo ~13% dell'altezza bottiglia sopra il collo, lateralità
// ~16% (≈45% della larghezza) perché la corona è larga e va staccata bene.
const DESKTOP: AboutConfig = {
  pinVh: 700,
  framing: {
    middle: { hidden: 0.5, visibleRatio: 0.56 },
    final: { hidden: -0.04, visibleRatio: 0.82 },
  },
  cap: {
    // P1 quasi verticale: la corona deve sfilarsi dal collo PRIMA di derivare
    // di lato, altrimenti la gonna attraversa il vetro (vedi CAP_SINK).
    lift: [0.005, 0.1, 0.012],
    apex: [0.12, 0.19, 0.045],
    hover: [0.165, 0.075, 0.05],
    spinTurns: 1.25,
    hoverTiltX: -0.38,
    hoverTiltZ: 0.22,
  },
  idle: { bobY: 0.012, rollZ: 0.016, pitchX: 0.012, yawY: 0.022 },
  pointer: { yaw: 0.062, pitch: 0.03, roll: 0.014, shiftX: 0.018 },
  capPointer: { shift: 0.075, tilt: 0.16 },
  contentYaw: 0.28,
  cardOverlap: 0.34,
  arc: { rx: 0.42, ry: 0.2, cy: 0.4, fontVw: 3.6 },
};

const TABLET: AboutConfig = {
  ...DESKTOP,
  pinVh: 560,
  framing: {
    middle: { hidden: 0.5, visibleRatio: 0.52 },
    final: { hidden: -0.04, visibleRatio: 0.78 },
  },
  cap: {
    ...DESKTOP.cap,
    // arco più contenuto: meno larghezza disponibile ai lati del collo
    lift: [0.004, 0.095, 0.01],
    apex: [0.095, 0.175, 0.04],
    hover: [0.13, 0.07, 0.042],
  },
  capPointer: { shift: 0.055, tilt: 0.13 },
  contentYaw: 0.22,
  cardOverlap: 0.22,
  arc: { rx: 0.44, ry: 0.19, cy: 0.4, fontVw: 5 },
};

const MOBILE: AboutConfig = {
  ...DESKTOP,
  pinVh: 460,
  framing: {
    middle: { hidden: 0.5, visibleRatio: 0.46 },
    final: { hidden: -0.04, visibleRatio: 0.7 },
  },
  cap: {
    // traiettoria più verticale e compatta: di lato non c'è spazio
    lift: [0.003, 0.1, 0.008],
    apex: [0.055, 0.185, 0.028],
    hover: [0.085, 0.1, 0.032],
    spinTurns: 1.25,
    hoverTiltX: -0.32,
    hoverTiltZ: 0.16,
  },
  // niente puntatore su touch: restano solo idle e coreografia
  pointer: { yaw: 0, pitch: 0, roll: 0, shiftX: 0 },
  capPointer: { shift: 0, tilt: 0 },
  contentYaw: 0.16,
  cardOverlap: 0, // una card alla volta
  arc: { rx: 0.46, ry: 0.17, cy: 0.42, fontVw: 8.5 },
};

export const CONFIG: Record<Breakpoint, AboutConfig> = {
  desktop: DESKTOP,
  tablet: TABLET,
  mobile: MOBILE,
};

// --- INQUADRATURA --------------------------------------------------------

/** le misure dell'assieme che servono a inquadrare (vedi bottleAssembly.world) */
export interface FramingMetrics {
  bottleHeight: number;
  bottleCenterY: number;
}

export interface Framing {
  /** scala da mettere sul layout rig */
  scale: number;
  /** y del layout rig */
  y: number;
  /** frazione dell'altezza bottiglia sotto il bordo inferiore (per i test) */
  hidden: number;
}

/**
 * Traduce "metà bottiglia nascosta e collo a quell'altezza" in scala e
 * posizione del rig, partendo dalla bbox VERA e dall'altezza del viewport in
 * unità mondo. Nessun pixel scritto a mano: regge qualsiasi aspect ratio, e
 * il reveal finale è solo un'interpolazione tra due inquadrature.
 *
 * Funzione pura apposta: la stessa che gira nel componente si esegue in Node
 * per verificare che il taglio sia davvero quello dichiarato.
 */
export function computeFraming(
  p: number,
  cfg: AboutConfig,
  world: FramingMetrics,
  viewportHeight: number,
  reduceMotion = false,
): Framing {
  const { middle, final } = cfg.framing;
  // il reveal finale è l'unica cosa che cambia l'inquadratura
  const rev = reduceMotion ? 1 : easeInOutCubic(phase(p, PHASES.reveal));
  const hidden = lerp(middle.hidden, final.hidden, rev);
  const visibleRatio = lerp(middle.visibleRatio, final.visibleRatio, rev);

  // la parte VISIBILE (1 - hidden) deve occupare visibleRatio del viewport
  const scale = (visibleRatio * viewportHeight) / ((1 - hidden) * world.bottleHeight);
  const bottleH = world.bottleHeight * scale;
  // centro del CORPO tale che `hidden` della sua altezza stia sotto il bordo
  const bodyCenterY = -viewportHeight / 2 + bottleH * (0.5 - hidden);

  // ingresso: parte un filo più in basso e sale in posa. Reversibile, e toglie
  // il "compare dal nulla" quando la sezione entra in viewport.
  const entryDip = reduceMotion
    ? 0
    : (1 - easeInOutCubic(phase(p, PHASES.entry))) * bottleH * 0.07;

  return {
    scale,
    y: bodyCenterY - world.bottleCenterY * scale - entryDip,
    hidden,
  };
}

// --- PESI DEGLI STRATI ADDITIVI -----------------------------------------
// Idle e puntatore sono SEMPRE additivi rispetto alla posa narrativa (gruppi
// figli separati). Qui si decide solo *quanto* pesano: durante l'apertura e il
// riaggancio si abbassano, altrimenti combattono con la coreografia.

/** peso dell'idle della bottiglia */
export function idleWeight(p: number): number {
  return keyframes(p, [
    [0, 1],
    [PHASES.tension.s, 1],
    [PHASES.opening.s, 0.35],
    [PHASES.opening.e, 0.85],
    [PHASES.returning.e, 0.5],
    [PHASES.reattach.e, 0.35],
    [1, 0.6],
  ]);
}

/** peso della parallasse col cursore sulla bottiglia */
export function pointerWeight(p: number): number {
  return keyframes(p, [
    [0, 1],
    [PHASES.opening.s, 0.5],
    [PHASES.opening.e, 1],
    [PHASES.returning.e, 0.4],
    [PHASES.reattach.e, 0.2],
    [1, 0.5],
  ]);
}

/**
 * Quanto il tappo è "staccato": 0 = incollato all'anchor, 1 = in volo/hovering.
 * Governa sia il blend della posa sia il peso dei suoi offset additivi, così
 * in riaggancio gli offset si azzerano da soli.
 */
export function capOpenness(p: number): number {
  if (p <= PHASES.opening.s) return 0;
  if (p >= PHASES.reattach.e) return 0;
  if (p < PHASES.opening.e) return easeInOutSine(phase(p, PHASES.opening));
  if (p <= PHASES.returning.s) return 1;
  // ritorno: 1 → 0 lungo returning+reattach, con l'ultimo tratto piatto
  return 1 - easeInOutSine(phase(p, { s: PHASES.returning.s, e: PHASES.reattach.e }));
}

// --- NOTA TECNICA --------------------------------------------------------
// Dove mettere le mani:
//   • ritmo della narrazione        → PHASES
//   • lunghezza della sezione       → CONFIG[bp].pinVh
//   • quanta bottiglia si vede      → CONFIG[bp].framing
//   • volo del tappo                → CONFIG[bp].cap (offset in altezze bottiglia)
//   • intensità mouse / respiro     → CONFIG[bp].pointer / .idle + idleWeight/pointerWeight
//   • rotazione durante le card     → CONFIG[bp].contentYaw
//   • arco della headline           → CONFIG[bp].arc
//   • testi                         → aboutContent.ts
