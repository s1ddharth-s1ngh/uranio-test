import * as THREE from "three";

// Montaggio della bottiglia della sezione "Chi siamo": due GLB scaricati
// separatamente (la bottiglia e il tappo) incastrati in un unico oggetto che
// sembra una bottiglia chiusa. Niente React qui dentro: è three puro, così la
// stessa funzione si esegue in Node sui GLB veri per verificare le misure.

// --- TARATURA (numeri misurati headless sui GLB, vedi commenti) ---

// La bottiglia è una scansione fotogrammetrica non allineata: il suo asse non
// è Y ma una diagonale qualsiasi. Questo è l'asse principale (PCA sui 118k
// vertici), orientato dal fondo verso il collo.
const BOTTLE_AXIS = new THREE.Vector3(-0.4885, 0.7636, 0.4222).normalize();

// Rollio attorno al proprio asse: in una scansione è arbitrario. È questo il
// numero da ritoccare se a riposo non guarda in camera il lato giusto.
const BOTTLE_ROLL = 0;

// Gioco tra la bocca della bottiglia e l'interno della gonna del tappo: 1.02 =
// il tappo è il 2% più largo del collo, quanto basta perché lo copra senza
// compenetrarlo.
const CAP_CLEARANCE = 1.02;

// Quanto il tappo cala sul collo, in frazioni della propria altezza: 0.75 = la
// gonna copre il labbro e resta fuori solo la cupola, come una capsula chiusa.
// Sotto lo 0.9 la volta interna non tocca il bordo della bocca (niente
// compenetrazione), sopra lo 0.4 il tappo non "galleggia".
const CAP_SINK = 0.75;

// Altezza finale dell'assieme in unità mondo: la timeline di scroll (scale
// 1.15→1.7) è tarata su un oggetto alto 2.
const TARGET_HEIGHT = 2;

const UP = new THREE.Vector3(0, 1, 0);

// Scorre i vertici di un sottoalbero in spazio mondo. Chi chiama deve avere le
// matrici aggiornate e la radice a trasformazione identità, così "mondo" e
// "spazio dell'assieme" coincidono.
function eachVertex(root: THREE.Object3D, fn: (v: THREE.Vector3) => void): void {
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      fn(v);
    }
  });
}

// Bocca della bottiglia: centro e raggio esterno della fascia di vertici più
// alta (il 2% dell'altezza). Misurata invece che stimata perché la scansione
// non è perfettamente simmetrica e il tappo deve cadere esattamente lì.
function measureMouth(bottle: THREE.Object3D): {
  x: number;
  y: number;
  z: number;
  radius: number;
} {
  const box = new THREE.Box3().setFromObject(bottle, true);
  const top = box.max.y;
  const band = (box.max.y - box.min.y) * 0.02;
  let n = 0;
  let cx = 0;
  let cz = 0;
  eachVertex(bottle, (v) => {
    if (v.y < top - band) return;
    n++;
    cx += v.x;
    cz += v.z;
  });
  cx /= n || 1;
  cz /= n || 1;
  let radius = 0;
  eachVertex(bottle, (v) => {
    if (v.y < top - band) return;
    radius = Math.max(radius, Math.hypot(v.x - cx, v.z - cz));
  });
  return { x: cx, y: top, z: cz, radius };
}

// Raggio interno della gonna del tappo (fascia più bassa, 8% dello spessore):
// è il foro in cui deve entrare il collo.
function measureCapBore(cap: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(cap, true);
  const band = (box.max.y - box.min.y) * 0.08;
  const center = box.getCenter(new THREE.Vector3());
  let bore = Infinity;
  eachVertex(cap, (v) => {
    if (v.y > box.min.y + band) return;
    bore = Math.min(bore, Math.hypot(v.x - center.x, v.z - center.z));
  });
  return bore;
}

export interface BottleAssembly {
  /** da dare a <primitive>: assieme centrato sull'origine e alto TARGET_HEIGHT */
  holder: THREE.Group;
  /**
   * Segnaposto vuoto DENTRO l'assieme, nella posa esatta del tappo chiuso:
   * eredita quindi ogni trasformazione della bottiglia (scroll, idle, mouse).
   * È la verità a cui il rig del tappo si riaggancia — copiandone la matrice
   * mondo il tappo torna indistinguibile da un tappo nativo, senza drift.
   */
  capAnchor: THREE.Object3D;
  /**
   * Il tappo, FUORI dall'assieme e senza trasformazioni proprie: lo monta il
   * chiamante in un rig a parte, così durante la fase aperta non eredita più
   * i movimenti della bottiglia. La sua origine locale è il centro del bordo
   * inferiore della gonna (il punto attorno a cui ha senso farlo ruotare).
   */
  capModel: THREE.Group;
  /**
   * misure utili ai test e alla taratura, nelle unità del modello (quelle
   * PRIMA della normalizzazione): moltiplica per `scale` per averle in unità
   * mondo.
   */
  metrics: {
    height: number;
    mouthY: number;
    mouthRadius: number;
    capScale: number;
    capHeight: number;
    scale: number;
  };
  /**
   * Le stesse misure già in unità dell'HOLDER (assieme alto TARGET_HEIGHT).
   * Sono quelle che serve leggere a runtime: la coreografia esprime gli
   * offset in "altezze di bottiglia" e li moltiplica per questi valori, così
   * resta identica anche se un domani il GLB cambia.
   */
  world: {
    bottleHeight: number;
    bottleWidth: number;
    capHeight: number;
    capRadius: number;
    mouthRadius: number;
    /** scala che il rig del tappo deve applicare al modello grezzo */
    capScale: number;
  };
}

/**
 * Prende le due scene GLB così come escono da useGLTF e restituisce un unico
 * oggetto pronto da mettere in scena: bottiglia raddrizzata in piedi, tappo
 * calzato sulla bocca, il tutto centrato sull'origine e normalizzato in
 * altezza (così ruota attorno al baricentro e la timeline resta valida).
 *
 * Le scene passate vengono clonate: la cache di useGLTF non viene toccata.
 */
export function buildBottleAssembly(
  bottleScene: THREE.Object3D,
  capScene: THREE.Object3D,
  options: { lit?: boolean } = {},
): BottleAssembly {
  const assembly = new THREE.Group();

  // --- bottiglia: raddrizzata, in piedi con il fondo a y=0 e l'asse in (0,0)
  const bottle = new THREE.Group();
  bottle.name = "bottle";
  bottle.add(bottleScene.clone(true));
  bottle.quaternion.setFromUnitVectors(BOTTLE_AXIS, UP);
  assembly.add(bottle);
  assembly.updateMatrixWorld(true);
  const bBox = new THREE.Box3().setFromObject(bottle, true);
  const bCenter = bBox.getCenter(new THREE.Vector3());
  // la posizione è applicata DOPO la rotazione: sposto la bbox già ruotata
  bottle.position.set(-bCenter.x, -bBox.min.y, -bCenter.z);
  assembly.updateMatrixWorld(true);

  // Il GLB è unlit (KHR_materials_unlit, luce cotta nei colori dei vertici
  // dalla scansione). Con `lit` lo si rimette sotto la luce della scena, al
  // prezzo di sommare due illuminazioni.
  if (options.lit) {
    bottle.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const old = mesh.material as THREE.MeshBasicMaterial;
      mesh.material = new THREE.MeshStandardMaterial({
        color: old.color,
        vertexColors: old.vertexColors,
        map: old.map,
        side: old.side,
        roughness: 0.55,
        metalness: 0,
      });
    });
  }

  const mouth = measureMouth(bottle);

  // --- tappo: già dritto nel suo GLB (asse Y, cupola in alto, gonna aperta in
  // basso). Lo scalo sul collo e lo calo sulla bocca.
  const cap = new THREE.Group();
  cap.name = "cap";
  const capInner = new THREE.Group();
  capInner.add(capScene.clone(true));
  cap.add(capInner);
  assembly.add(cap);
  assembly.updateMatrixWorld(true);

  const cBox = new THREE.Box3().setFromObject(capInner, true);
  const cCenter = cBox.getCenter(new THREE.Vector3());
  const capHeight = cBox.max.y - cBox.min.y;
  const bore = measureCapBore(capInner);
  // origine del gruppo "cap" = centro del bordo inferiore della gonna: è il
  // punto attorno a cui ha senso farlo saltare/ruotare
  capInner.position.set(-cCenter.x, -cBox.min.y, -cCenter.z);
  const capScale = (mouth.radius * CAP_CLEARANCE) / (bore || 1);
  cap.scale.setScalar(capScale);
  cap.position.set(mouth.x, mouth.y - capHeight * capScale * CAP_SINK, mouth.z);
  assembly.updateMatrixWorld(true);

  // --- normalizzazione: assieme centrato sull'origine e alto TARGET_HEIGHT.
  // La bbox si misura con il tappo ANCORA montato: è lui a definire il punto
  // più alto dell'assieme (cupola sopra il labbro). Smontarlo prima cambierebbe
  // altezza e baricentro, e con essi tutta la taratura della sezione.
  const aBox = new THREE.Box3().setFromObject(assembly, true);
  const aCenter = aBox.getCenter(new THREE.Vector3());
  const aHeight = aBox.max.y - aBox.min.y;
  assembly.position.sub(aCenter);

  const scale = TARGET_HEIGHT / (aHeight || 1);
  const holder = new THREE.Group();
  holder.add(assembly);
  holder.scale.setScalar(scale);
  holder.rotation.y = BOTTLE_ROLL;
  holder.updateMatrixWorld(true);

  // --- misure in unità dell'holder, prese PRIMA di smontare il tappo
  const bottleBox = new THREE.Box3().setFromObject(bottle, true);
  const capBox = new THREE.Box3().setFromObject(cap, true);

  // --- separazione: al posto del tappo resta un segnaposto vuoto con la sua
  // identica trasformazione. Il modello esce dall'assieme e viene montato dal
  // chiamante in un rig indipendente. Da qui in poi bottiglia e tappo sono due
  // oggetti distinti anche nella scena, non solo concettualmente.
  const capAnchor = new THREE.Object3D();
  capAnchor.name = "capAnchor";
  capAnchor.position.copy(cap.position);
  capAnchor.quaternion.copy(cap.quaternion);
  capAnchor.scale.copy(cap.scale);
  assembly.remove(cap);
  assembly.add(capAnchor);

  const capModel = new THREE.Group();
  capModel.name = "capModel";
  capModel.add(capInner); // capInner ha già il pivot sul bordo della gonna
  holder.updateMatrixWorld(true);

  return {
    holder,
    capAnchor,
    capModel,
    metrics: {
      height: aHeight,
      mouthY: mouth.y,
      mouthRadius: mouth.radius,
      capScale,
      capHeight: capHeight * capScale,
      scale,
    },
    // NB: bottleBox/capBox sono già misurate DOPO updateMatrixWorld, quindi la
    // scala dell'holder è dentro — non va rimoltiplicata. `mouth.radius` e
    // `capScale` invece vengono da prima della normalizzazione: quelli sì.
    world: {
      bottleHeight: bottleBox.max.y - bottleBox.min.y,
      bottleWidth: Math.max(
        bottleBox.max.x - bottleBox.min.x,
        bottleBox.max.z - bottleBox.min.z,
      ),
      capHeight: capBox.max.y - capBox.min.y,
      capRadius:
        Math.max(capBox.max.x - capBox.min.x, capBox.max.z - capBox.min.z) / 2,
      mouthRadius: mouth.radius * scale,
      capScale: capScale * scale,
    },
  };
}
