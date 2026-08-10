import { useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PointerState } from "./useWindowPointer";

export const KICK_CONFIG = {
  // --- impulso ---
  strength: 6,
  maxStrength: 26,
  // soglia sulla velocità FILTRATA del puntatore (unità NDC/s): sotto questa
  // il passaggio del mouse non calcia (evita micro-scatti da jitter)
  minPointerSpeed: 0.25,
  // costante di tempo (s) del filtro sulla velocità del puntatore: smorza i
  // picchi di un singolo frame, così un tocco piccolo resta un tocco piccolo
  velSmoothing: 0.05,
  mass: 3.0,
  inertia: 3.2,
  // tetti invalicabili: per quanto violenta sia la sciabolata, il pezzo non
  // parte mai in orbita né fa capriole
  maxLinearSpeed: 2.6,
  maxAngularSpeed: 2.2,
  maxOffset: 1.0,
  // molla di richiamo: ω = √k ≈ 5.3 rad/s, ζ = c / 2√k ≈ 0.61
  // → un solo rimbalzo morbido e ritorno al posto in ~1s
  k: 28,
  c: 6.5,
  damping: 4.2,
  restoreTorque: 9,
  // campionamento del tratto percorso dal puntatore tra due frame: impedisce
  // che un movimento veloce "buchi" il pezzo senza colpirlo
  maxSamples: 5,
  sampleStep: 0.08,
};

export interface LetterPiece {
  id: string;
  restPos: [number, number, number];
  sizeFactor: number;
  boundR: number;
}

interface LetterState {
  origin: THREE.Vector3;
  originQuat: THREE.Quaternion;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  wasInside: boolean;
}

interface UseLetterPhysicsArgs {
  pieces: LetterPiece[];
  groups: RefObject<(THREE.Group | null)[]>;
  pointer: RefObject<PointerState>;
  reduceMotion: boolean;
  ambient: boolean;
}

export function useLetterPhysics({
  pieces,
  groups,
  pointer,
  reduceMotion,
  ambient,
}: UseLetterPhysicsArgs) {
  const states = useRef<LetterState[]>([]);
  if (states.current.length === 0) {
    states.current = pieces.map((p) => ({
      origin: new THREE.Vector3(...p.restPos),
      originQuat: new THREE.Quaternion(),
      position: new THREE.Vector3(...p.restPos),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      wasInside: false,
    }));
  }

  const raycaster = useRef(new THREE.Raycaster());
  const prevNdc = useRef(new THREE.Vector2());
  const hasPrev = useRef(false);
  // velocità del puntatore filtrata (EMA), in NDC/s con x corretta per l'aspect
  const pointerVel = useRef(new THREE.Vector2());
  // pezzi sotto al puntatore in QUESTO frame + punto di impatto sulla mesh
  const frameHit = useRef<boolean[]>(pieces.map(() => false));
  const hitPoints = useRef<THREE.Vector3[]>(pieces.map(() => new THREE.Vector3()));

  // temporanei riusati: il loop gira a 60fps su 7 pezzi, niente allocazioni
  const tmpV2 = useRef(new THREE.Vector2());
  const tmpNdc = useRef(new THREE.Vector2());
  const tmpCenter = useRef(new THREE.Vector3());
  const tmpArm = useRef(new THREE.Vector3());
  const tmpForce = useRef(new THREE.Vector3());
  const tmpTorque = useRef(new THREE.Vector3());
  const tmpVec = useRef(new THREE.Vector3());
  const tmpScale = useRef(new THREE.Vector3());
  const tmpAxis = useRef(new THREE.Vector3());
  const tmpQuat = useRef(new THREE.Quaternion());
  const tmpSpin = useRef(new THREE.Quaternion());

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const gs = groups.current;
    if (!gs) return;

    const p = pointer.current;
    // reduce-motion o touch: nessun input, i pezzi vanno solo a riposo
    const canKick = p.active && !reduceMotion && !ambient;
    const aspect = state.size.width / state.size.height;

    // ---- velocità del puntatore ------------------------------------------
    let dx = 0;
    let dy = 0;
    if (canKick && hasPrev.current) {
      dx = (p.x - prevNdc.current.x) * aspect;
      dy = p.y - prevNdc.current.y;
    }
    const alpha = 1 - Math.exp(-dt / KICK_CONFIG.velSmoothing);
    pointerVel.current.lerp(tmpV2.current.set(dx / dt, dy / dt), alpha);
    const speed = pointerVel.current.length();

    // ---- chi sta davvero sotto al puntatore -------------------------------
    // Raycast sulla GEOMETRIA reale (non sulla bounding sphere): l'emblema è
    // una forma a L, la sua sfera copriva mezzo schermo di vuoto. Si campiona
    // il segmento prev→ora così un movimento veloce non lo scavalca.
    const pathLen = Math.hypot(dx, dy);
    if (!canKick) {
      for (let i = 0; i < frameHit.current.length; i++) frameHit.current[i] = false;
    } else if (pathLen > 1e-5 || !hasPrev.current) {
      for (let i = 0; i < frameHit.current.length; i++) frameHit.current[i] = false;
      const samples = Math.min(
        KICK_CONFIG.maxSamples,
        Math.max(1, Math.ceil(pathLen / KICK_CONFIG.sampleStep)),
      );
      for (let s = 1; s <= samples; s++) {
        const t = hasPrev.current ? s / samples : 1;
        tmpNdc.current.set(
          prevNdc.current.x + (p.x - prevNdc.current.x) * t,
          prevNdc.current.y + (p.y - prevNdc.current.y) * t,
        );
        raycaster.current.setFromCamera(tmpNdc.current, state.camera);

        // solo il pezzo PIÙ VICINO alla camera prende il colpo: niente calci
        // attraverso una lettera che sta davanti
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < gs.length; i++) {
          const g = gs[i];
          if (!g) continue;
          const hit = raycaster.current.intersectObject(g, true)[0];
          if (hit && hit.distance < bestDist) {
            bestDist = hit.distance;
            bestIdx = i;
            hitPoints.current[i].copy(hit.point);
          }
        }
        if (bestIdx >= 0) frameHit.current[bestIdx] = true;
      }
    }
    // puntatore fermo sopra un pezzo: frameHit resta com'era → nessun calcio
    // ripetuto finché non esce e rientra

    for (let i = 0; i < states.current.length; i++) {
      const s = states.current[i];
      const g = gs[i];
      if (!g) continue;

      const isInside = frameHit.current[i];

      // il calcio scatta solo sul FRONTE d'ingresso: mesh toccata ora, non
      // toccata al frame prima, e con abbastanza velocità
      if (isInside && !s.wasInside && speed > KICK_CONFIG.minPointerSpeed) {
        const piece = pieces[i];

        tmpForce.current
          .set(pointerVel.current.x, pointerVel.current.y, 0)
          .multiplyScalar(KICK_CONFIG.strength * piece.sizeFactor);
        if (tmpForce.current.length() > KICK_CONFIG.maxStrength) {
          tmpForce.current.setLength(KICK_CONFIG.maxStrength);
        }

        // braccio: dal baricentro al punto REALE di impatto, riportato nelle
        // unità locali del gruppo (il logo è scalato dal fit-to-view)
        const worldScale = g.getWorldScale(tmpScale.current).x || 1;
        tmpCenter.current.setFromMatrixPosition(g.matrixWorld);
        tmpArm.current
          .copy(hitPoints.current[i])
          .sub(tmpCenter.current)
          .divideScalar(worldScale);

        tmpTorque.current
          .copy(tmpArm.current)
          .cross(tmpForce.current)
          .divideScalar(KICK_CONFIG.inertia * piece.sizeFactor);
        s.angularVelocity.add(tmpTorque.current);
        if (s.angularVelocity.length() > KICK_CONFIG.maxAngularSpeed) {
          s.angularVelocity.setLength(KICK_CONFIG.maxAngularSpeed);
        }

        s.velocity.add(
          tmpForce.current.divideScalar(KICK_CONFIG.mass * piece.sizeFactor),
        );
        if (s.velocity.length() > KICK_CONFIG.maxLinearSpeed) {
          s.velocity.setLength(KICK_CONFIG.maxLinearSpeed);
        }
      }
      s.wasInside = isInside;

      // ---- molla di richiamo (traslazione) --------------------------------
      tmpVec.current
        .copy(s.origin)
        .sub(s.position)
        .multiplyScalar(KICK_CONFIG.k)
        .addScaledVector(s.velocity, -KICK_CONFIG.c);
      s.velocity.addScaledVector(tmpVec.current, dt);
      s.position.addScaledVector(s.velocity, dt);

      // tetto allo spostamento: il pezzo resta sempre riconoscibile nel logo
      tmpVec.current.copy(s.position).sub(s.origin);
      const off = tmpVec.current.length();
      if (off > KICK_CONFIG.maxOffset) {
        tmpVec.current.setLength(KICK_CONFIG.maxOffset);
        s.position.copy(s.origin).add(tmpVec.current);
        // annulla la componente di velocità che spinge ancora verso l'esterno
        tmpVec.current.normalize();
        const radial = s.velocity.dot(tmpVec.current);
        if (radial > 0) s.velocity.addScaledVector(tmpVec.current, -radial);
      }

      // ---- molla di richiamo (rotazione) ----------------------------------
      s.angularVelocity.multiplyScalar(Math.exp(-KICK_CONFIG.damping * dt));

      tmpQuat.current.copy(s.quaternion).invert().premultiply(s.originQuat);
      tmpAxis.current.set(tmpQuat.current.x, tmpQuat.current.y, tmpQuat.current.z);
      const sinHalfAngle = tmpAxis.current.length();
      if (sinHalfAngle > 0.001) {
        tmpAxis.current.normalize();
        let angle = 2 * Math.atan2(sinHalfAngle, tmpQuat.current.w);
        if (angle > Math.PI) angle -= 2 * Math.PI;
        s.angularVelocity.addScaledVector(
          tmpAxis.current,
          angle * KICK_CONFIG.restoreTorque * dt,
        );
      }

      if (s.angularVelocity.lengthSq() > 0.0001) {
        const w = s.angularVelocity.length();
        tmpAxis.current.copy(s.angularVelocity).divideScalar(w);
        tmpSpin.current.setFromAxisAngle(tmpAxis.current, w * dt);
        s.quaternion.premultiply(tmpSpin.current).normalize();
      }

      if (
        s.velocity.lengthSq() < 0.01 &&
        s.angularVelocity.lengthSq() < 0.01 &&
        s.position.distanceTo(s.origin) < 0.01 &&
        s.quaternion.angleTo(s.originQuat) < 0.01
      ) {
        s.position.copy(s.origin);
        s.quaternion.copy(s.originQuat);
        s.velocity.set(0, 0, 0);
        s.angularVelocity.set(0, 0, 0);
      }

      g.position.copy(s.position);
      g.quaternion.copy(s.quaternion);
      // la fisica scrive DOPO il render del frame precedente: aggiorniamo la
      // matrice qui, così il raycast del prossimo frame vede la posa attuale
      g.updateMatrixWorld();
    }

    if (canKick) {
      prevNdc.current.set(p.x, p.y);
      hasPrev.current = true;
    } else {
      hasPrev.current = false;
    }
  });
}
