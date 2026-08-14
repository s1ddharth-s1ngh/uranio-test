// Contenuti della sezione "about". Stanno tutti qui: la coreografia non deve
// mai contenere testo, così si riscrive il racconto senza toccare le curve.

export const ABOUT_INTRO = {
  title: "Dentro Uranio",
  subtitle: "Quattro elementi, una reazione sola. Scorri e apri la bottiglia.",
} as const;

export interface AboutCard {
  id: string;
  /** numerazione visibile: dà ritmo alla sequenza */
  index: string;
  title: string;
  body: string;
  /**
   * Sfasamento verticale della traiettoria, in frazioni di viewport: varia di
   * poco da una card all'altra così l'arco non sembra una fila meccanica.
   */
  lane: number;
  /** inclinazione a riposo (gradi): stesso scopo, sull'asse della rotazione */
  tilt: number;
}

// Quattro card: sotto le tre il racconto non ha ritmo, sopra le cinque la fase
// centrale diventa troppo lunga da scrollare.
export const ABOUT_CARDS: readonly AboutCard[] = [
  {
    id: "materia",
    index: "01",
    title: "Materia prima",
    body: "Zenzero fresco spremuto a freddo e acqua di sorgente. Nessun aroma, nessun concentrato: solo la radice, intera.",
    lane: -0.04,
    tilt: -3.5,
  },
  {
    id: "fissione",
    index: "02",
    title: "Fissione lenta",
    body: "Ottanta giorni di fermentazione a bassa temperatura. Il tempo è l'unico ingrediente che non si può accelerare.",
    lane: 0.05,
    tilt: 2.5,
  },
  {
    id: "massa",
    index: "03",
    title: "Massa critica",
    body: "Cinque spezie che si innescano a vicenda: pepe lungo, cardamomo, lime, vaniglia bourbon e un soffio di sale.",
    lane: -0.02,
    tilt: 3,
  },
  {
    id: "origine",
    index: "04",
    title: "Filiera corta",
    body: "Radici coltivate entro cento chilometri dal birrificio. Ogni lotto porta in etichetta il campo da cui viene.",
    lane: 0.06,
    tilt: -2,
  },
] as const;

/**
 * Messaggio finale disposto sull'arco. Tenerlo tra i 18 e i 28 caratteri:
 * più corto non riempie il semicerchio, più lungo diventa illeggibile su
 * mobile anche riducendo il font.
 */
export const ABOUT_HEADLINE = "ENERGIA CHE NON SI SPEGNE";

/** alternativa testuale del canvas, che è puramente decorativo */
export const ABOUT_CANVAS_LABEL =
  "Bottiglia Uranio che si apre e si richiude durante lo scorrimento";
