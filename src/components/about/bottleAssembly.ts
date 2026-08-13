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
  /** il tappo, già in posa sul collo — il gruppo da animare quando salterà via */
  cap: THREE.Group;
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

  // --- normalizzazione: assieme centrato sull'origine e alto TARGET_HEIGHT
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

  return {
    holder,
    cap,
    metrics: {
      height: aHeight,
      mouthY: mouth.y,
      mouthRadius: mouth.radius,
      capScale,
      capHeight: capHeight * capScale,
      scale,
    },
  };
}
