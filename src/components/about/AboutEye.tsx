import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

// Occhio 3D fisso in basso a destra, piccolino: lo sguardo insegue sempre il
// cursore. Tecnica: lookAt su un punto lungo il raggio del mouse, davanti alla
// camera → la pupilla punta verso il puntatore ovunque sia sullo schermo.
const MODEL_URL = `${import.meta.env.BASE_URL}3d/free_3d_eye_model.glb`;
useGLTF.preload(MODEL_URL);

// Pre-orientamento del modello così lo sguardo nativo coincide con +Z (asse
// usato da Object3D.lookAt). Calibrato guardando il render (vedi CALIB_*).
const CALIB_X = 0;
const CALIB_Y = -Math.PI / 2; // lo sguardo nativo è lungo +X → lo porto su +Z
const CALIB_Z = 0;

interface AboutEyeProps {
  reduceMotion?: boolean;
  narrow?: boolean;
  touch?: boolean; // niente cursore: lo sguardo vaga piano
}

export function AboutEye({
  reduceMotion = false,
  narrow = false,
  touch = false,
}: AboutEyeProps) {
  const { scene } = useGLTF(MODEL_URL);

  // clona, ricentra sul baricentro, normalizza l'altezza a ~2 unità e
  // pre-orienta lo sguardo lungo +Z
  const model = useMemo(() => {
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const dims = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    const holder = new THREE.Group();
    holder.add(root);
    holder.scale.setScalar(2 / (dims.y || 1));
    holder.rotation.set(CALIB_X, CALIB_Y, CALIB_Z);
    return holder;
  }, [scene]);

  const group = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3(0, 0, 3));
  const dir = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());
  const { pointer, viewport, camera } = useThree();

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);

    const sc = narrow ? 0.22 : 0.25; // piccolino
    g.scale.setScalar(sc);

    // nell'angolo estremo in basso a destra, ma con un minimo di distanza dai
    // bordi: il margine è lo spazio dal bordo (world units)
    const half = sc;
    const margin = narrow ? 0.1 : 0.12;
    const baseX = viewport.width / 2 - half - margin;
    const baseY = -viewport.height / 2 + half + margin;
    g.position.set(baseX, baseY, 0);

    if (reduceMotion) {
      g.rotation.set(0, 0, 0);
      return;
    }

    // punto bersaglio dello sguardo
    if (touch) {
      // nessun cursore: bersaglio che gira piano davanti all'occhio
      const t = state.clock.elapsedTime;
      desired.current.set(
        baseX + Math.sin(t * 0.5) * 2,
        baseY + Math.cos(t * 0.4) * 1.2,
        4,
      );
    } else {
      // raggio dal cursore: punto a distanza fissa davanti alla camera, così
      // l'occhio guarda verso il mouse ovunque sia sullo schermo
      dir.current
        .set(pointer.x, pointer.y, 0.5)
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      desired.current
        .copy(camera.position)
        .addScaledVector(dir.current, 4.2);
    }

    // smoothing del bersaglio → il movimento dell'occhio è fluido ma reattivo
    const k = 1 - Math.exp(-11 * dt);
    target.current.lerp(desired.current, k);
    g.lookAt(target.current);
  });

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  );
}
