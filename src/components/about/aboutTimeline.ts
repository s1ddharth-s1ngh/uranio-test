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

export const TAU = Math.PI * 2;

export interface CapTrajectory {
  /**
   * Da che parte vola il tappo: -1 = sinistra, 1 = destra. Sta a SINISTRA
   * perché le card attraversano da destra a sinistra, e da quel lato le
   * incrocia solo a fine corsa, quando sono già quasi trasparenti.
   */
  side: -1 | 1;
  /**
   * Punti di controllo in offset dall'anchor, espressi in ALTEZZE DI
   * BOTTIGLIA (moltiplicati a runtime per l'altezza mondo corrente): così la
   * traiettoria resta identica cambiando scala, breakpoint o reveal finale.
   * P0 è sempre l'anchor (0,0,0) e non compare qui.
   */
  lift: Vec3; // P1: stacco quasi verticale
  apex: Vec3; // P2: apice, inizio della deriva laterale
  hover: Vec3; // P3: posa di hovering
  /**
   * Curva del RITORNO: stessi estremi (anchor e hovering), pancia diversa —
   * più bassa e diretta, così il rientro non è il rewind dell'apertura. Si può
   * cambiare senza rischi: lo scambio tra le due curve avviene nel plateau in
   * cui entrambe valgono esattamente `hover`.
   */
  returnLift: Vec3;
  returnApex: Vec3;
  /** giri sull'asse del tappo durante l'apertura */
  spinTurns: number;
  /** giri aggiuntivi durante la fase delle card */
  contentSpinTurns: number;
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
  /**
   * Quanto la finestra di una card sconfina in quella della successiva.
   * 0.34 = su desktop se ne vedono due insieme, una principale e una in
   * ingresso/uscita. 0 = una alla volta (mobile).
   */
  cardOverlap: number;
  /**
   * Arco delle card, in unità di viewport (vw per x, vh per y) misurate dal
   * CENTRO. y negativa = verso l'alto. L'arco passa sopra il collo della
   * bottiglia e sopra il tappo in hovering: è quella la fascia libera.
   */
  cards: {
    enterX: number;
    exitX: number;
    apexY: number;
    edgeY: number;
    /** rotazione (gradi) da inizio a fine corsa, contro-tangente all'arco */
    tiltAmp: number;
  };
  /**
   * Arco della headline finale. `rx` in frazioni di larghezza, `ry` e `cy` in
   * frazioni di altezza, misurate dal bordo alto. `spread` è l'ampiezza
   * angolare usata dell'ellisse in gradi (180 = semicerchio pieno): più
   * stretta, meno le lettere agli estremi si coricano.
   */
  arc: {
    rx: number;
    ry: number;
    cy: number;
    spread: number;
    fontVw: number;
  };
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
    side: -1,
    // P1 quasi verticale: la corona deve sfilarsi dal collo PRIMA di derivare
    // di lato, altrimenti la gonna attraversa il vetro (vedi CAP_SINK).
    lift: [0.005, 0.1, 0.012],
    apex: [0.12, 0.2, 0.045],
    // la quota di hovering tiene conto dell'INCLINAZIONE: un disco largo
    // quanto la corona, inclinato di ~27°, abbassa il proprio bordo di
    // parecchio. A 0.075 il fondo sfiorava ancora la bocca.
    // Più di lato che in alto: sopra la bocca passa il corridoio delle card, e
    // il tappo sta DAVANTI a loro (canvas sopra), quindi lassù taglierebbe il
    // testo. Spostandolo di fianco esce dal corridoio e resta comunque
    // chiaramente staccato — la gonna è fuori dal raggio della bocca, per cui
    // può stare anche più in basso senza toccare il vetro.
    hover: [0.24, 0.055, 0.05],
    returnLift: [0.004, 0.04, 0.01],
    returnApex: [0.12, 0.1, 0.03],
    spinTurns: 1.25,
    contentSpinTurns: 0.35,
    // +X inclina la cupola verso la camera (+Z): la faccia stampata resta
    // leggibile per tutto il volo
    hoverTiltX: 0.42,
    hoverTiltZ: 0.22,
  },
  idle: { bobY: 0.012, rollZ: 0.016, pitchX: 0.012, yawY: 0.022 },
  pointer: { yaw: 0.062, pitch: 0.03, roll: 0.014, shiftX: 0.018 },
  capPointer: { shift: 0.075, tilt: 0.16 },
  contentYaw: 0.28,
  cardOverlap: 0.34,
  // L'arco passa SOPRA il tappo in hovering: le card stanno dietro il canvas,
  // quindi è il tappo a coprirle, e a quote più basse taglierebbe il testo in
  // due proprio mentre lo si legge (verificato con un test di sovrapposizione).
  cards: { enterX: 58, exitX: -58, apexY: -30, edgeY: -16, tiltAmp: 5 },
  arc: { rx: 0.4, ry: 0.16, cy: 0.34, spread: 132, fontVw: 3.4 },
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
    apex: [0.095, 0.195, 0.04],
    hover: [0.2, 0.055, 0.042],
    returnLift: [0.003, 0.04, 0.008],
    returnApex: [0.1, 0.1, 0.025],
  },
  capPointer: { shift: 0.055, tilt: 0.13 },
  contentYaw: 0.22,
  cardOverlap: 0.22,
  cards: { enterX: 64, exitX: -64, apexY: -29, edgeY: -15, tiltAmp: 4 },
  arc: { rx: 0.42, ry: 0.15, cy: 0.33, spread: 126, fontVw: 4.6 },
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
    side: -1,
    lift: [0.003, 0.1, 0.008],
    apex: [0.055, 0.2, 0.028],
    // su mobile la bottiglia è più piccola, quindi in unità di altezza serve
    // più lateralità perché i due corpi non possano proprio toccarsi
    hover: [0.185, 0.07, 0.032],
    returnLift: [0.002, 0.045, 0.006],
    returnApex: [0.09, 0.11, 0.02],
    spinTurns: 1.25,
    contentSpinTurns: 0.35,
    hoverTiltX: 0.36,
    hoverTiltZ: 0.16,
  },
  // niente puntatore su touch: restano solo idle e coreografia
  pointer: { yaw: 0, pitch: 0, roll: 0, shiftX: 0 },
  capPointer: { shift: 0, tilt: 0 },
  contentYaw: 0.16,
  // Una card alla volta, ma non zero: a finestre esattamente adiacenti si
  // aprirebbe un istante di palco vuoto al cambio. Con 0.14 le due card si
  // incrociano ai bordi opposti dello schermo, entrambe sotto la soglia di
  // leggibilità — si legge comunque una sola card per volta.
  cardOverlap: 0.14,
  // arco più piatto e più centrale: di lato non c'è spazio, e la card è larga
  cards: { enterX: 78, exitX: -78, apexY: -25, edgeY: -13, tiltAmp: 3 },
  // arco più largo e meno profondo: in portrait l'aspect ratio corica molto
  // le lettere agli estremi, e con `spread` largo diventano illeggibili
  arc: { rx: 0.47, ry: 0.13, cy: 0.3, spread: 100, fontVw: 7.6 },
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

// --- COREOGRAFIA DEL TAPPO ----------------------------------------------

export interface CapPose {
  /** offset dalla posa dell'anchor, nelle unità del layout rig */
  offset: MutableVec3;
  /** 0 = incollato all'anchor, 1 = in hovering */
  openness: number;
  /**
   * Peso dell'INCLINAZIONE, e di tutti gli strati additivi del tappo. Non
   * coincide con `openness`: è la stessa curva elevata a potenza, quindi si
   * spegne molto prima quando il tappo si riavvicina al collo.
   *
   * Serve perché a `openness` bassa il tappo è ancora infilato nella bocca (o
   * appena sopra) e il gioco radiale è di pochi millesimi: con l'inclinazione
   * ancora attiva la gonna passa dentro il vetro. Sganciare i due tempi è ciò
   * che rende l'ultimo tratto del rientro pulito.
   */
  orient: number;
  /**
   * Peso del "gioco" del tappo: respiro autonomo e risposta al cursore. Vale 1
   * solo nel plateau in cui è parcheggiato in hovering, e 0 durante volo,
   * ritorno e riaggancio.
   *
   * Non basta pesarli con `orient`: a metà rientro vale ancora ~0.7, e bob e
   * cursore spingono il tappo in basso e verso l'asse proprio mentre passa
   * accanto al collo — cioè dentro il vetro. E comunque, mentre vola, il tappo
   * deve seguire la coreografia, non ciondolare.
   */
  play: number;
  /** inclinazione assoluta verso cui interpolare (rad) */
  tiltX: number;
  tiltZ: number;
  /** giri narrativi sull'asse del tappo (rad) */
  spin: number;
}

export function makeCapPose(): CapPose {
  return {
    offset: { x: 0, y: 0, z: 0 },
    openness: 0,
    orient: 0,
    play: 0,
    tiltX: 0,
    tiltZ: 0,
    spin: 0,
  };
}

const _p1: [number, number, number] = [0, 0, 0];
const _p2: [number, number, number] = [0, 0, 0];
const _p3: [number, number, number] = [0, 0, 0];
const ORIGIN: Vec3 = [0, 0, 0];

/**
 * Posa completa del tappo a un dato progresso. Pura e senza allocazioni: la
 * stessa funzione gira nel frame loop e nei test headless.
 *
 * Tutto è funzione del solo `p`. Non esiste uno stato "aperto/chiuso" da
 * mantenere: a qualsiasi progresso, raggiunto in qualsiasi ordine e a
 * qualsiasi velocità, la posa è ricostruibile — che è ciò che rende la
 * sequenza reversibile e a prova di scrub.
 *
 * @param bottleHeight altezza della bottiglia nelle unità del layout rig:
 *        gli offset sono espressi in altezze di bottiglia e vengono convertiti
 *        qui, così la traiettoria è la stessa a ogni scala.
 * @param sinkDepth quanto la gonna è calata sotto il labbro (stesse unità).
 */
export function computeCapPose(
  p: number,
  cfg: AboutConfig,
  bottleHeight: number,
  sinkDepth: number,
  out: CapPose,
): CapPose {
  const c = cfg.cap;
  const openness = capOpenness(p);
  const H = bottleHeight;
  const side = c.side;

  // Quale delle due curve: si scambiano nel plateau dell'hovering, dove
  // entrambe valgono esattamente `hover` — quindi lo scambio è invisibile.
  const back = p > (PHASES.opening.e + PHASES.returning.s) / 2;
  const P1 = back ? c.returnLift : c.lift;
  const P2 = back ? c.returnApex : c.apex;
  const P3 = c.hover;

  // in unità del layout rig, con la lateralità dal lato giusto
  _p1[0] = P1[0] * H * side;
  _p1[1] = P1[1] * H;
  _p1[2] = P1[2] * H;
  _p2[0] = P2[0] * H * side;
  _p2[1] = P2[1] * H;
  _p2[2] = P2[2] * H;
  _p3[0] = P3[0] * H * side;
  _p3[1] = P3[1] * H;
  _p3[2] = P3[2] * H;

  bezier3(ORIGIN, _p1, _p2, _p3, openness, out.offset);

  // --- ESTRAZIONE PRIMA DELLA DERIVA ------------------------------------
  // Vincolo fisico, non estetico: una corona non può scorrere di lato finché
  // è infilata nel collo. Il gioco radiale vero è la differenza tra il raggio
  // INTERNO della gonna e quello della bocca — circa tre millesimi di unità,
  // cioè niente. Taratura a mano dei punti di controllo qui non regge: basta
  // ritoccare una curva e la gonna torna dentro il vetro.
  //
  // Quindi la lateralità viene azzerata finché il tappo non ha risalito
  // l'affondo, e rientra con uno smoothstep nell'affondo successivo. Il
  // risultato è anche più giusto da vedere: sale dritto, poi scarta.
  const gate = smoothstep(clamp01((out.offset.y - sinkDepth) / (sinkDepth * 1.2)));
  out.offset.x *= gate;
  out.offset.z *= gate;

  // --- ANTICIPAZIONE ----------------------------------------------------
  // Prima dello stacco la corona carica: si solleva di un nulla e si inclina
  // verso il lato in cui volerà. Vale ZERO ai bordi, quindi non sporca né la
  // posa iniziale né quella finale.
  const anticip = keyframes(p, [
    [PHASES.tension.s, 0],
    [PHASES.tension.e, 1],
    [PHASES.opening.s + 0.02, 0],
  ]);
  // 0.6% dell'altezza: resta comunque infilata nel collo (l'affondo è 2.4%)
  out.offset.y += anticip * 0.006 * H;

  // --- ORIENTAMENTO -----------------------------------------------------
  // In hovering è assoluto (il tappo è staccato: non deve più seguire il
  // corpo). Chi applica la posa interpola via slerp da quello dell'anchor,
  // così a openness 0 torna esattamente sul collo.
  out.tiltX = c.hoverTiltX;
  // l'inclinazione dell'anticipazione va dalla parte in cui volerà: telegrafa
  // il movimento invece di farlo sembrare improvviso
  out.tiltZ = c.hoverTiltZ * side + anticip * 0.04 * -side;

  // --- SPIN -------------------------------------------------------------
  // Separato dall'orientamento apposta: il tappo può fare giri interi e
  // arrivare comunque allineato. Il totale è arrotondato per eccesso, così a
  // fine riaggancio lo spin è un multiplo esatto di 2π — cioè l'identità.
  const total = Math.ceil(c.spinTurns + c.contentSpinTurns);
  out.spin =
    keyframes(p, [
      [PHASES.opening.s, 0],
      [PHASES.opening.e, c.spinTurns],
      [PHASES.content.e, c.spinTurns + c.contentSpinTurns],
      [PHASES.reattach.e, total],
      [1, total],
    ]) *
    TAU *
    side;

  out.openness = openness;
  // esponente tarato sul gioco radiale reale (gonna 0.155 contro bocca 0.152):
  // verificato headless che con 1.8 la penetrazione durante il rientro resta
  // sotto quella della posa chiusa di progetto
  out.orient = Math.pow(openness, 1.8);
  out.play = keyframes(p, [
    [PHASES.opening.e - 0.03, 0],
    [PHASES.opening.e, 1],
    [PHASES.returning.s, 1],
    [PHASES.returning.s + 0.04, 0],
  ]);
  return out;
}

// --- OVERLAY IN DOM ------------------------------------------------------

/** posa di un elemento in overlay: si scrive su style, mai su React state */
export interface DomPose {
  opacity: number;
  /** in unità di viewport (vw / vh) */
  x: number;
  y: number;
  rot: number;
  scale: number;
}

export function makeDomPose(): DomPose {
  return { opacity: 0, x: 0, y: 0, rot: 0, scale: 1 };
}

/** lo scrive in una stringa transform, senza toccare top/left */
export function applyDomPose(el: HTMLElement, pose: DomPose): void {
  el.style.opacity = pose.opacity.toFixed(3);
  el.style.transform =
    `translate3d(${pose.x.toFixed(3)}vw, ${pose.y.toFixed(3)}vh, 0) ` +
    `rotate(${pose.rot.toFixed(2)}deg) scale(${pose.scale.toFixed(4)})`;
  // fuori scena non deve intercettare nulla né costare compositing
  el.style.visibility = pose.opacity < 0.004 ? "hidden" : "visible";
}

/**
 * Titolo e sottotitolo: entrano dal basso, si assestano, e prima delle card
 * escono a sinistra su una piccola curva invece di sparire di colpo.
 */
export function computeIntroPose(p: number, out: DomPose): DomPose {
  const enter = easeOutCubic(phase(p, PHASES.intro));
  // esce a cavallo dell'inizio delle card, così i due movimenti si passano
  // il testimone senza un istante di vuoto
  const exit = easeInCubic(
    phase(p, { s: PHASES.content.s - 0.05, e: PHASES.content.s + 0.05 }),
  );
  out.opacity = enter * (1 - exit);
  // l'uscita è un arco: mentre va a sinistra sale appena e ruota di poco
  out.x = -exit * 16;
  out.y = (1 - enter) * 3.2 - exit * 2.4;
  out.rot = -exit * 3.5;
  out.scale = 0.98 + enter * 0.02 - exit * 0.03;
  return out;
}

/**
 * Altezza del viewport in unità mondo con la camera della sezione
 * (fov 40 a z 6, vedi AboutSection.tsx). Serve a convertire le quote 3D del
 * tappo in unità di viewport, per tenerci lontane le card.
 */
export const CAMERA_VIEW_HEIGHT = 2 * 6 * Math.tan((40 / 2) * (Math.PI / 180));

export interface CapScreenBox {
  /** centro in vw / vh dal centro schermo (y positiva verso il basso) */
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

export function makeCapScreenBox(): CapScreenBox {
  return { x: 0, y: 0, halfW: 0, halfH: 0 };
}

/**
 * Dove finisce il tappo in hovering, in unità di viewport. È la stessa
 * matematica dell'inquadratura, riletta in coordinate schermo: le card ne
 * hanno bisogno perché passano DIETRO il canvas, quindi è il tappo a coprirle
 * e se ci finisce sopra taglia il testo in due.
 */
export function capHoverScreen(
  cfg: AboutConfig,
  aspect: number,
  bottleHeight: number,
  capRadius: number,
  capHeight: number,
  out: CapScreenBox,
): CapScreenBox {
  const viewH = CAMERA_VIEW_HEIGHT;
  const viewW = viewH * aspect;
  const fr = cfg.framing.middle;
  const scale = (fr.visibleRatio * viewH) / ((1 - fr.hidden) * bottleHeight);
  // bordo alto della bottiglia = bocca, da cui si misura l'offset di hovering
  const mouthY = -viewH / 2 + fr.visibleRatio * viewH;

  const worldX = cfg.cap.hover[0] * bottleHeight * scale * cfg.cap.side;
  const worldY = mouthY + cfg.cap.hover[1] * bottleHeight * scale;
  const r = capRadius * scale;

  out.x = (worldX / viewW) * 100;
  out.y = -(worldY / viewH) * 100; // schermo: y positiva verso il basso
  out.halfW = (r / viewW) * 100;
  // disco inclinato: l'ingombro verticale è il raggio proiettato più mezzo
  // spessore, molto meno del diametro
  out.halfH =
    ((r * Math.sin(cfg.cap.hoverTiltX) + (capHeight * scale) / 2) / viewH) * 100;
  return out;
}

const _liftPose = makeDomPose();
const FULL_SPAN: Span = { s: 0, e: 1 };

/**
 * Di quanto va alzato l'arco delle card perché il loro bordo inferiore resti
 * sopra il tappo. Sempre ≤ 0: l'arco si alza, non si abbassa.
 *
 * La quota si trova campionando la CURVA, non i punti di controllo: una
 * Bézier cubica non passa mai per P1 e P2, quindi il suo punto più alto sta
 * parecchio sotto `apexY` — dimensionare sull'apice lascerebbe scoperta
 * proprio la parte di corsa in cui la card incrocia il tappo.
 *
 * Si guardano solo i campioni in cui la card è LEGGIBILE e si sovrappone al
 * tappo in orizzontale: quando è ancora a destra dello schermo la sua quota
 * non interessa nessuno.
 */
export function cardArcLift(
  cfg: AboutConfig,
  cap: CapScreenBox,
  cardHalfH: number,
  cardHalfW: number,
  /** corsia più bassa: è quella che rischia di finire sotto il tappo */
  maxLane = 0.02,
  /** corsia più alta: è quella che rischia di uscire dal bordo superiore */
  minLane = -0.02,
  margin = 2,
): number {
  let worstBottom = -Infinity;
  for (let t = 0; t <= 1; t += 0.005) {
    computeCardPose(t, FULL_SPAN, maxLane, 0, cfg, 0, _liftPose);
    if (_liftPose.opacity < 0.5) continue;
    if (Math.abs(_liftPose.x - cap.x) >= cardHalfW + cap.halfW) continue;
    const bottom = _liftPose.y + cardHalfH;
    if (bottom > worstBottom) worstBottom = bottom;
  }
  if (worstBottom === -Infinity) return 0; // non si incrociano mai

  const lift = Math.min(0, cap.y - cap.halfH - margin - worstBottom);

  // Il bordo alto non deve uscire dallo schermo. Su viewport molto basse la
  // card, in vh, è più alta e le due cose non possono stare entrambe: in quel
  // caso vince il restare in campo, e il tappo passerà dietro un angolo.
  // qui serve la corsia PIÙ ALTA: l'alzata è unica per tutte le card, quindi
  // va limitata da quella che arriva più vicina al bordo
  let highest = Infinity;
  for (let t = 0; t <= 1; t += 0.005) {
    computeCardPose(t, FULL_SPAN, minLane, 0, cfg, 0, _liftPose);
    if (_liftPose.opacity < 0.5) continue;
    highest = Math.min(highest, _liftPose.y - cardHalfH);
  }
  const topRoom = highest === Infinity ? 0 : Math.min(0, -48 - highest);
  return Math.max(lift, topRoom);
}

/**
 * Finestra di progresso della card `i`.
 *
 * Le finestre sono lunghe `stride * (1 + overlap)` e distanziate di `stride`:
 * con overlap 0 si susseguono senza toccarsi (una alla volta, mobile), con
 * overlap > 0 la coda di una copre la testa della successiva, così non c'è mai
 * un istante di palco vuoto. Lo `stride` è scelto perché l'ultima card finisca
 * ESATTAMENTE alla fine della fase contenuti, qualunque sia il numero di card.
 */
export function cardWindow(i: number, count: number, cfg: AboutConfig): Span {
  const span = PHASES.content.e - PHASES.content.s;
  const stride = span / (count + cfg.cardOverlap);
  const s = PHASES.content.s + i * stride;
  return { s, e: s + stride * (1 + cfg.cardOverlap) };
}

const _cp1: [number, number, number] = [0, 0, 0];
const _cp2: [number, number, number] = [0, 0, 0];
const _cp3: [number, number, number] = [0, 0, 0];
const _cp0: [number, number, number] = [0, 0, 0];
const _cardXY: MutableVec3 = { x: 0, y: 0, z: 0 };

/**
 * Posa di una card lungo il suo arco: entra da destra, passa alta sopra il
 * prodotto e esce a sinistra. Tutto in unità di viewport, quindi l'arco si
 * adatta da solo a qualunque risoluzione senza numeri in pixel.
 *
 * `lane` sfalsa di poco la quota e `tilt` l'inclinazione a riposo: servono
 * solo a togliere l'effetto "fila meccanica" tra una card e l'altra.
 */
export function computeCardPose(
  p: number,
  win: Span,
  lane: number,
  tilt: number,
  cfg: AboutConfig,
  /** alzata dell'arco per scavalcare il tappo, da cardArcLift (≤ 0) */
  lift: number,
  out: DomPose,
): DomPose {
  const t = phase(p, win);
  const c = cfg.cards;
  const laneY = lane * 100 + lift;

  // arco a campana: entra e esce basso, passa alto in mezzo
  _cp0[0] = c.enterX;
  _cp0[1] = c.edgeY + laneY;
  _cp1[0] = c.enterX * 0.36;
  _cp1[1] = c.apexY + laneY;
  _cp2[0] = c.exitX * 0.36;
  _cp2[1] = c.apexY + laneY;
  _cp3[0] = c.exitX;
  _cp3[1] = c.edgeY + laneY;
  // il moto lungo la curva è addolcito agli estremi: entra e esce senza
  // strappi, e in mezzo rallenta quanto basta a farsi leggere
  bezier3(_cp0, _cp1, _cp2, _cp3, easeInOutSine(t), _cardXY);
  out.x = _cardXY.x;
  out.y = _cardXY.y;

  // 0 → 1 → 1 → 0: piena per la parte centrale della corsa, così ogni
  // messaggio ha una sosta in cui è davvero leggibile
  out.opacity =
    smoothstep(clamp01(t / 0.18)) * (1 - smoothstep(clamp01((t - 0.72) / 0.28)));
  // profondità simulata: arriva un filo indietro, passa in primo piano, esce
  // appena più piccola
  out.scale = 0.94 + 0.06 * smoothstep(clamp01(t / 0.3)) - 0.02 * smoothstep(clamp01((t - 0.6) / 0.4));
  // contro-tangente: ruota mentre attraversa, restando entro pochi gradi
  out.rot = tilt + c.tiltAmp * (2 * t - 1);
  return out;
}

// --- HEADLINE SU ARCO ----------------------------------------------------

export interface ArcSlot {
  /** posizione in percentuale del contenitore */
  left: number;
  top: number;
  /** rotazione tangente, in gradi */
  rot: number;
}

export interface ArcLayout {
  /** angolo di ogni lettera, già distribuito per lunghezza d'arco */
  angles: number[];
  /** lunghezza dell'arco in ALTEZZE di viewport (moltiplicare per innerHeight) */
  length: number;
}

export function makeArcLayout(): ArcLayout {
  return { angles: [], length: 0 };
}

const _cum: number[] = [];
const ARC_STEPS = 400;

/**
 * Distribuisce `n` lettere sull'arco a passo costante di LUNGHEZZA, non di
 * angolo.
 *
 * Su un'ellisse molto schiacciata — ed è il caso: rx è quasi mezza larghezza,
 * ry un sesto di altezza — angoli uguali danno distanze diversissime: le
 * lettere si ammucchiano agli estremi e si allargano in cima. Qui si integra
 * la curva e si inverte, così il passo è regolare ovunque.
 *
 * Tutto viene misurato in proporzioni di PIXEL (x scalata per l'aspect ratio):
 * rx è in frazioni di larghezza e ry di altezza, quindi senza quella
 * correzione spaziatura e inclinazioni cambierebbero da schermo a schermo.
 */
export function arcLayout(
  n: number,
  cfg: AboutConfig,
  aspect: number,
  out: ArcLayout,
): ArcLayout {
  const { rx, ry, spread } = cfg.arc;
  const half = (spread * Math.PI) / 360;
  // -90° è la cima dell'ellisse; l'arco si apre simmetrico attorno a quella
  const a0 = -Math.PI / 2 - half;
  const a1 = -Math.PI / 2 + half;

  _cum.length = ARC_STEPS + 1;
  _cum[0] = 0;
  let px = rx * Math.cos(a0) * aspect;
  let py = ry * Math.sin(a0);
  for (let k = 1; k <= ARC_STEPS; k++) {
    const a = a0 + ((a1 - a0) * k) / ARC_STEPS;
    const x = rx * Math.cos(a) * aspect;
    const y = ry * Math.sin(a);
    _cum[k] = _cum[k - 1] + Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  const total = _cum[ARC_STEPS];
  out.length = total;
  out.angles.length = n;

  for (let i = 0; i < n; i++) {
    const target = n === 1 ? total / 2 : (i / (n - 1)) * total;
    let k = 1;
    while (k < ARC_STEPS && _cum[k] < target) k++;
    const l0 = _cum[k - 1];
    const l1 = _cum[k];
    const f = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
    out.angles[i] = a0 + ((a1 - a0) * (k - 1 + f)) / ARC_STEPS;
  }
  return out;
}

/** posizione e tangente della lettera a un dato angolo dell'ellisse */
export function arcSlot(
  a: number,
  cfg: AboutConfig,
  aspect: number,
  out: ArcSlot,
): ArcSlot {
  const { rx, ry, cy } = cfg.arc;
  out.left = (0.5 + rx * Math.cos(a)) * 100;
  out.top = (cy + ry * Math.sin(a)) * 100;
  // derivata dell'ellisse, riportata in proporzioni di pixel
  const dx = -rx * Math.sin(a) * aspect;
  const dy = ry * Math.cos(a);
  out.rot = clampAbs((Math.atan2(dy, dx) * 180) / Math.PI, ARC_MAX_ROT);
  return out;
}

/**
 * Larghezza media di un carattere maiuscolo rispetto al corpo, per Inter.
 * Serve a far entrare la frase nell'arco: sopra questa densità le lettere si
 * toccherebbero.
 */
export const ARC_ADVANCE = 0.62;

/**
 * Inclinazione massima di una lettera sull'arco. Le lettere seguono la
 * tangente "quanto basta": oltre questa soglia, sugli schermi in portrait —
 * dove l'aspect ratio corica molto gli estremi — la frase smette di leggersi.
 */
export const ARC_MAX_ROT = 38;

/**
 * Entrata della headline: il gruppo scivola da destra e ogni lettera si
 * accende in ritardo sulla precedente. Esce prima che il tappo cominci a
 * rientrare, così il palco è libero per il riaggancio.
 */
export function computeArcLetterPose(
  p: number,
  i: number,
  n: number,
  out: DomPose,
): DomPose {
  const t = phase(p, PHASES.headline);
  // sfasamento per lettera: l'ultima parte quando la prima è a 70% di corsa
  const delay = n > 1 ? (i / (n - 1)) * 0.3 : 0;
  const enter = easeOutCubic(clamp01((t / 0.42 - delay) / 0.7));
  // uscita: comincia dentro la fase di ritorno del tappo
  const exit = easeInCubic(clamp01((t - 0.8) / 0.2));

  out.opacity = enter * (1 - exit);
  out.x = (1 - enter) * 7 - exit * 4;
  out.y = 0;
  out.rot = 0;
  out.scale = 0.9 + enter * 0.1;
  return out;
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
