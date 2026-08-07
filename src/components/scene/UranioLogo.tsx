import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { chromeMaterial, ensureUVs } from "./chromeMaterial";
import { useLetterPhysics } from "./useLetterPhysics";
import type { LetterPiece } from "./useLetterPhysics";
import type { PointerState } from "./useWindowPointer";

// preload registrato da HeroScene DOPO la subscription al progresso (così il
// Loader non perde l'onStart sincrono del GLB)
export const URANIO_URL = `${import.meta.env.BASE_URL}3d/uranio_logo.glb`;

// Il GLB del logo è un unico file con 8 nodi già disposti a comporre il marchio:
//   path5 + path6  → l'emblema in alto (l'anello/portachiavi + la bottiglia)
//   path7..path12  → le 6 lettere  U R A N I O
// Le path giacciono nel piano XZ (SVG estruso lungo Y): le raddrizziamo verso
// la camera con una rotazione di +90° attorno a X. Ogni "pezzo" diventa un
// oggetto CALCIABILE indipendente che conserva il suo posto nel logo ma reagisce
// al mouse per conto suo (puoi tirare un calcio alla U, alla R, all'emblema…).
const PIECES: { id: string; nodes: string[] }[] = [
  { id: "emblem", nodes: ["path5", "path6"] },
  { id: "U", nodes: ["path7"] },
  { id: "R", nodes: ["path8"] },
  { id: "A", nodes: ["path9"] },
  { id: "N", nodes: ["path10"] },
  { id: "I", nodes: ["path11"] },
  { id: "O", nodes: ["path12"] },
];

// dimensione (unità mondo) del lato maggiore del logo assemblato DOPO la
// normalizzazione: tiene la fisica (MAX_OFFSET ecc.) in un range coerente e
// fa sì che su desktop il fit calcolato sia ~1
const LOGO_BASE = 6.0;

interface Piece {
  id: string;
  holder: THREE.Object3D; // mesh(es) centrate sul baricentro del pezzo
  restPos: [number, number, number]; // baricentro nel logo assemblato+centrato
  sizeFactor: number;
  boundR: number;
}



interface UranioLogoProps {
  pointer: RefObject<PointerState>;
  reduceMotion: boolean;
  ambient: boolean;
  fov: number;
  camZ: number;
  portrait: boolean;
}

export default function UranioLogo({
  pointer,
  reduceMotion,
  ambient,
  fov,
  camZ,
  portrait,
}: UranioLogoProps) {
  const { scene } = useGLTF(URANIO_URL);
  const size = useThree((s) => s.size);

  // Costruzione dei pezzi (una sola volta per GLB): clona la scena, cuoce nella
  // geometria la trasformazione di ogni nodo + la rotazione globale + una
  // normalizzazione/centratura comune, poi separa ciascun pezzo centrandolo sul
  // proprio baricentro (così ruota attorno al centro sotto la fisica del calcio)
  const { pieces, assemblyW, assemblyH } = useMemo(() => {
    const src = scene.clone(true);
    src.updateMatrixWorld(true);

    const byName: Record<string, THREE.Mesh> = {};
    src.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) byName[o.name] = o as THREE.Mesh;
    });

    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);

    // 1° passata: cuoci nodo (TRS, scala ~238) + rotazione globale in geometrie
    // clonate (mai mutare le geometrie condivise nella cache di useGLTF) e
    // accumula il bounding box dell'intero logo
    const geos: Record<string, THREE.BufferGeometry> = {};
    const globalBox = new THREE.Box3();
    for (const name of Object.keys(byName)) {
      const g = byName[name].geometry.clone();
      g.applyMatrix4(byName[name].matrixWorld);
      g.applyMatrix4(rot);
      g.computeBoundingBox();
      globalBox.union(g.boundingBox!);
      geos[name] = g;
    }

    // normalizzazione comune: centra il logo sull'origine e scala il lato
    // maggiore a LOGO_BASE. post = Scale(norm) * Translate(-center)
    const center = globalBox.getCenter(new THREE.Vector3());
    const dims = globalBox.getSize(new THREE.Vector3());
    const norm = LOGO_BASE / (Math.max(dims.x, dims.y) || 1);
    const post = new THREE.Matrix4()
      .makeScale(norm, norm, norm)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

    // 2° passata: applica `post`, prepara UV per la normal map del cromo
    for (const name of Object.keys(geos)) {
      geos[name].applyMatrix4(post);
      ensureUVs(geos[name]);
    }

    // 3° passata: raggruppa i nodi in pezzi calciabili, centrando ciascun
    // pezzo sul proprio baricentro (holder) e registrando restPos = baricentro
    const built: Piece[] = [];
    for (const def of PIECES) {
      const present = def.nodes.filter((n) => geos[n]);
      if (present.length === 0) continue;

      const pieceBox = new THREE.Box3();
      const meshes: THREE.Mesh[] = [];
      for (const n of present) {
        const m = new THREE.Mesh(geos[n], chromeMaterial);
        meshes.push(m);
        pieceBox.union(geos[n].boundingBox!);
      }
      const c = pieceBox.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      for (const m of meshes) {
        m.position.sub(c); // baricentro del pezzo all'origine dell'holder
        holder.add(m);
      }
      const r = pieceBox.getBoundingSphere(new THREE.Sphere()).radius;
      built.push({
        id: def.id,
        holder,
        restPos: [c.x, c.y, c.z],
        // taglia usata per scalare l'impulso: lettere ~0.9, emblema clampato
        sizeFactor: Math.min(1.3, Math.max(0.5, r)),
        boundR: r,
      });
    }

    const asmSize = globalBox.getSize(new THREE.Vector3());
    return {
      pieces: built,
      assemblyW: asmSize.x * norm,
      assemblyH: asmSize.y * norm,
    };
  }, [scene]);

  // fit-to-view: il logo è ~quadrato, quindi entra bene sia in landscape che
  // in portrait. Larghezza/altezza VISIBILI a z=0 dai parametri camera (non da
  // state.viewport, che non riflette i cambi di CameraConfig)
  const worldH = 2 * camZ * Math.tan((fov * Math.PI) / 360);
  const worldW = worldH * (size.width / size.height);
  // margini più stretti = logo più piccolo, con più aria attorno (era 0.9/0.84)
  const fit = Math.min(
    (worldW * 0.74) / assemblyW,
    (worldH * 0.7) / assemblyH,
  );
  // solleva un po' il gruppo: in portrait di più, così URANIO libera il titolo
  // in basso a sinistra e la pill; in landscape un tocco
  const yOffset = worldH * (portrait ? 0.06 : 0.04);

  const letterPieces = useMemo<LetterPiece[]>(
    () =>
      pieces.map((p) => ({
        id: p.id,
        restPos: p.restPos,
        sizeFactor: p.sizeFactor,
        boundR: p.boundR,
      })),
    [pieces],
  );

  const groupsRef = useRef<(THREE.Group | null)[]>([]);
  useLetterPhysics({
    pieces: letterPieces,
    groups: groupsRef,
    pointer,
    reduceMotion,
    ambient,
  });

  // Il logo è FISSO e frontale: non ruota né trasla in base al mouse. Reagisce
  // solo quando un pezzo viene "toccato"/colpito, e i pezzi si urtano tra loro
  // come solidi rigidi (niente compenetrazione, rimbalzo).
  return (
    <group scale={fit} position={[0, yOffset, 0]}>
      {pieces.map((p, i) => (
        <group
          key={p.id}
          position={p.restPos}
          ref={(el) => {
            groupsRef.current[i] = el;
          }}
        >
          <primitive object={p.holder} />
        </group>
      ))}
    </group>
  );
}
