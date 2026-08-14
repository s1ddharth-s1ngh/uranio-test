# Seconda sezione — nota tecnica

Scrollytelling con bottiglia e tappo come **due oggetti 3D distinti**: il tappo
parte incastrato sul collo, si stacca, vola, resta reattivo al cursore, rientra
e si riallinea. Tutto guidato dallo scroll, in entrambi i versi.

## Regola che tiene in piedi tutto

**La posa dipende SOLO dal progresso `p ∈ [0,1]`.** Non esiste uno stato
"aperto/chiuso" da mantenere, nessun `onComplete`, nessun reparenting. A
qualsiasi progresso, raggiunto in qualsiasi ordine e a qualsiasi velocità, la
posa è ricostruibile. È questo che rende la sequenza a prova di scroll veloce,
scrollbar trascinata, refresh a metà, inversioni e ritorno dal basso.

Il corollario pratico: se aggiungi un comportamento, deve essere una **funzione
pura di `p`**. Se ti serve ricordare qualcosa da un frame all'altro, quasi
sicuramente stai sbagliando strada.

## Dove mettere le mani

| Cosa | Dove |
|---|---|
| ritmo della narrazione | `PHASES` in `aboutTimeline.ts` |
| lunghezza della sezione | `CONFIG[bp].pinVh` (arriva al CSS come `--pin`) |
| quanta bottiglia si vede | `CONFIG[bp].framing` |
| volo del tappo | `CONFIG[bp].cap` |
| intensità mouse e respiro | `CONFIG[bp].pointer` / `.idle`, e i pesi `idleWeight`/`pointerWeight`/`capOpenness` |
| rotazione durante le card | `CONFIG[bp].contentYaw` |
| traiettoria e ritmo delle card | `CONFIG[bp].cards` / `.cardOverlap` |
| arco della headline | `CONFIG[bp].arc` |
| **testi** (titolo, card, frase finale) | `aboutContent.ts` |

Gli offset del tappo sono in **altezze di bottiglia**, non in unità mondo:
cambiando scala, breakpoint o reveal finale l'arco resta identico.

## Gerarchia dei rig

Un rig per responsabilità, così nessun oggetto ha due scrittori e la posa
finale è composizione di matrici, non somma di Euler:

```
layoutRig          inquadratura + reveal finale
├── scrollRig      pose narrative (yaw durante le card, rinculo)
│   └── idleRig    respiro continuo
│       └── pointerRig   parallasse col cursore
│           └── holder → bottiglia + capAnchor
└── capWorldRig    posa da curva / anchor      ← FRATELLO, non figlio
    └── capOffsetRig    respiro e cursore del tappo
        └── capSpinRig  giri interi sull'asse
            └── capScaleNode → capModel
```

Il rig del tappo è **fratello** di quello della bottiglia: da staccato non deve
ereditarne scroll, respiro e parallasse.

## Come funziona il riaggancio esatto

Dentro l'assieme, al posto del tappo, c'è `capAnchor`: un `Object3D` vuoto
nella posa esatta del tappo chiuso, che eredita ogni movimento della bottiglia.
Ogni frame `applyCapPose()` ricompone la posa lavorando sulle **matrici mondo**
(inversa del layout rig × matrice dell'anchor, poi `decompose`).

Quando `openness === 0` il rig copia l'anchor di netto e azzera offset e spin.
Non è un'approssimazione che converge: è una copia. Verificato headless, il
drift è `1e-16` — l'epsilon del `double` — su posizione, orientamento e scala.

Lo spin sta su un rig separato dall'orientamento, così può fare giri interi e
arrivare comunque allineato: il totale è arrotondato per eccesso e a fine
riaggancio vale esattamente 2 giri, cioè l'identità.

Due riferimenti per il collo: **vivo** (anchor com'è adesso, respiro e cursore
compresi) quando è agganciato, **stabile** (solo posa narrativa) in hovering,
così il tappo non oscilla in fase con la bottiglia. Il passaggio è pesato da
`openness`, quindi continuo.

## Tre vincoli che sembrano dettagli e non lo sono

1. **Il gioco radiale è di tre millesimi.** Non è "raggio tappo meno raggio
   bocca" ma "raggio *interno* della gonna meno raggio bocca". Con margini
   così, tarare a mano i punti di controllo non regge: basta ritoccare una
   curva e la gonna attraversa il vetro. Per questo la lateralità è azzerata da
   un gate finché il tappo non ha risalito l'affondo — deriva esattamente 0
   mentre è infilato, per costruzione.

2. **`orient` non è `openness`.** L'inclinazione deve spegnersi molto prima
   della posizione: a openness bassa il tappo è ancora dentro la bocca, e con
   la corona ancora inclinata la gonna entra nel vetro.

3. **`play` non è `orient`.** Respiro e cursore del tappo valgono 1 solo nel
   plateau di hovering. Pesarli con `orient` li lasciava attivi a metà rientro,
   spingendo il tappo in basso e verso l'asse proprio mentre sfilava accanto al
   collo.

## Le card passano dietro il canvas

Quindi è il **tappo a coprirle**, e dove ci finisce sopra taglia il testo in
due. L'alzata dell'arco (`cardArcLift`) si calcola campionando la curva — una
Bézier non passa mai per i punti di controllo — e sull'**altezza vera della
card misurata nel DOM**: in `vh` la stessa card è molto più alta su un
portatile basso. Serve anche la corsia più alta, non solo la più bassa, perché
l'alzata è unica e la card più in alto è quella che esce dal bordo.

## Verifica

Niente browser headless: si carica il GLB in Node e si esegue la **logica vera**
(`aboutTimeline.ts` non importa né React né three apposta). Gli script stanno
fuori dal repo; il riassunto di cosa coprono:

- **timeline** — continuità di tutti i pesi su 20.000 campioni, terminali
  esatti, nessun momento morto tra le fasi
- **progresso** — estremi esatti, monotonia, nessun NaN ai casi limite
- **inquadratura** — su 7 schermi reali: 50% del corpo sotto il bordo nella
  fase centrale, bottiglia intera solo alla fine
- **tappo** — 34.850 vertici contro il collo lungo tutta la timeline;
  penetrazione max 2.1 px @1080p contro gli 1.6 px che la posa chiusa ha già
- **card** — su 8 schermi: il tappo non taglia mai una card leggibile, mai più
  di due leggibili insieme (una su mobile), nessun palco vuoto
- **arco** — passo regolare entro lo 0.1%, nessuna sovrapposizione, corpo che
  si adatta da solo alla frase e alla risoluzione
- **checkpoint** — lo stato dell'intero sistema ai nove progressi chiave,
  identico in avanti, all'indietro e con salti arbitrari

## Limiti noti

- La corona scansionata ha il bore che si **stringe salendo** (profilo interno
  da 1.0055 a 0.9680 tra il fondo e il 25%). Sfilando un oggetto rigido, la
  fascia più stretta passa per forza a filo del labbro: restano ~2 px di
  sovrapposizione a 1080p, contro gli ~1.6 px che la posa chiusa ha già in
  produzione. Sotto la soglia del visibile, e non dipende dalla coreografia.
- `npm run build` fallisce su Windows: il ciclo `for` finale dello script è
  sintassi POSIX e `cmd.exe` non la capisce. `tsc -b` e `vite build` passano;
  la stessa riga eseguita in bash completa e produce `dist` con tutte le rotte.
