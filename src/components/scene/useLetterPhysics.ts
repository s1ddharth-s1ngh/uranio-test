import { useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { maskHit } from "./pieceMask";
import type { PieceMask } from "./pieceMask";
import type { PointerState } from "./useWindowPointer";

export const KICK_CONFIG = {
  // --- impulso all'ingresso del cursore sul pezzo ---
  strength: 7,
  maxStrength: 30,
  // --- spinta CONTINUA finché il cursore resta a contatto e si muove: è
  // questa a dare la sensazione di SPINGERE la lettera, invece di un unico
  // calcio secco all'ingresso ---
  dragStrength: 26,
  // soglia sulla velocità filtrata del cursore (NDC/s): sotto questa il
  // contatto non calcia (evita scatti dal jitter del mouse fermo)
  minPointerSpeed: 0.1,
  // costante di tempo (s) del filtro sulla velocità: smorza i picchi di un
  // singolo frame senza rendere sordo un tocco breve (a 0.05 un gesto di 2-3
  // frame veniva sottostimato e non muoveva niente). A tenere calmo il moto
  // ci pensano i tetti qui sotto, non il filtro.
  velSmoothing: 0.025,
  mass: 3.0,
  inertia: 3.4,
  // tetti invalicabili: per quanto violenta sia la sciabolata, il pezzo non
  // parte mai in orbita né fa capriole
  maxLinearSpeed: 2.8,
  maxAngularSpeed: 2.2,
  maxOffset: 1.0,
  // molla di richiamo: ω = √k ≈ 5.3 rad/s, ζ = c / 2√k ≈ 0.61
  // → un solo rimbalzo morbido e ritorno al posto in ~1s
  k: 28,
  c: 6.5,
  damping: 4.2,
  restoreTorque: 9,
  // raggio del "pennello" attorno al cursore, in px: si può SFIORARE il bordo
  // di una lettera senza doverla centrare al pixel. Tarato contro il raycast
  // sulla mesh: a 8px i mancati contatti sono ~0.2% e la tolleranza extra
  // ~3.6% dello schermo (il vecchio test a bounding sphere ne sbagliava il 30%)
  brushPx: 8,
  // campionamento del tratto percorso dal cursore tra due frame: impedisce che
  // un movimento veloce "buchi" il pezzo senza toccarlo
  maxSamples: 6,
  sampleStep: 0.05,
};

export interface LetterPiece {
  id: string;
  restPos: [number, number, number];
  sizeFactor: number;
  boundR: number;
  mask: PieceMask;
}

interface LetterState {
  origin: THREE.Vector3;
  originQuat: THREE.Quaternion;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  // true dal momento in cui QUESTO contatto ha già ricevuto l'impulso pieno.
  // Non è "toccato al frame prima": se il cursore appoggia sulla lettera da
  // fermo e solo dopo parte, l'impulso d'ingresso deve arrivare allora, non
  // andare perso perché il primo frame di contatto aveva velocità nulla.
  kicked: boolean;
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
  // stato per pezzo: mutabile e vivo per tutta la vita del componente, quindi
  // in un ref. Viene popolato al primo giro DENTRO useFrame: leggere o scrivere
  // un ref durante il render è vietato (react-hooks/refs), e uno useMemo
  // sarebbe un valore immutabile che la fisica non potrebbe mutare.
  const statesRef = useRef<LetterState[] | null>(null);

  const ray = useRef(new THREE.Ray());
  const prevNdc = useRef(new THREE.Vector2());
  const hasPrev = useRef(false);
  // velocità del cursore filtrata (EMA), in NDC/s con x corretta per l'aspect
  const pointerVel = useRef(new THREE.Vector2());
  // pezzi toccati in QUESTO frame + punto di contatto (mondo)
  const frameHit = useRef<boolean[]>(pieces.map(() => false));
  const hitPoints = useRef<THREE.Vector3[]>(pieces.map(() => new THREE.Vector3()));
  // matrice inversa del gruppo, aggiornata una volta a frame
  const invMat = useRef<THREE.Matrix4[]>(pieces.map(() => new THREE.Matrix4()));
  const worldScales = useRef<number[]>(pieces.map(() => 1));

  // temporanei riusati: il loop gira a 60fps, niente allocazioni per frame
  const tmpV2 = useRef(new THREE.Vector2());
  const tmpNdc = useRef(new THREE.Vector3());
  const tmpOrigin = useRef(new THREE.Vector3());
  const tmpLocalO = useRef(new THREE.Vector3());
  const tmpLocalD = useRef(new THREE.Vector3());
  const tmpLocalHit = useRef(new THREE.Vector3());
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
    // NB: `delta` può essere 0 (primo frame di r3f, o due frame nello stesso
    // ms). Senza questo pavimento le divisioni per dt danno 0/0 = NaN e la
    // media mobile della velocità resterebbe NaN PER SEMPRE → mai più un calcio.
    const dt = Math.min(Math.max(delta, 1 / 240), 1 / 30);
    const gs = groups.current;
    if (!gs) return;

    if (!statesRef.current) {
      statesRef.current = pieces.map((piece) => ({
        origin: new THREE.Vector3(...piece.restPos),
        originQuat: new THREE.Quaternion(),
        position: new THREE.Vector3(...piece.restPos),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        kicked: false,
      }));
    }
    const states = statesRef.current;

    const p = pointer.current;
    // reduce-motion o touch: nessun input, i pezzi vanno solo a riposo
    const canKick = p.active && !reduceMotion && !ambient;
    const vw = state.size.width;
    const vh = state.size.height;
    const aspect = vw > 0 && vh > 0 ? vw / vh : 1;

    // ---- velocità del cursore (filtrata) ---------------------------------
    let dx = 0;
    let dy = 0;
    if (canKick && hasPrev.current) {
      dx = (p.x - prevNdc.current.x) * aspect;
      dy = p.y - prevNdc.current.y;
    }
    const alpha = 1 - Math.exp(-dt / KICK_CONFIG.velSmoothing);
    pointerVel.current.lerp(tmpV2.current.set(dx / dt, dy / dt), alpha);
    let speed = pointerVel.current.length();
    // cintura di sicurezza: un NaN nella EMA non si ripulirebbe mai da solo
    if (!Number.isFinite(speed)) {
      pointerVel.current.set(0, 0);
      speed = 0;
    }

    // ---- contatto cursore ↔ sagoma ---------------------------------------
    // Per ogni pezzo: si porta il raggio del cursore nello spazio LOCALE del
    // gruppo, lo si interseca con la faccia frontale e si legge la maschera di
    // silhouette — O(1).
    // Niente bounding sphere (l'emblema è una L: il suo cerchio è quasi tutto
    // vuoto — era il motivo per cui si muoveva col cursore lontano) e niente
    // raycast sulle mesh (~1.4ms per raggio su 26k triangoli: troppo).
    for (let i = 0; i < frameHit.current.length; i++) frameHit.current[i] = false;

    if (canKick) {
      for (let i = 0; i < gs.length; i++) {
        const g = gs[i];
        if (!g) continue;
        invMat.current[i].copy(g.matrixWorld).invert();
        worldScales.current[i] = g.getWorldScale(tmpScale.current).x || 1;
      }

      // il pennello, convertito da px a unità NDC-con-aspect
      const brushNdc =
        (2 * KICK_CONFIG.brushPx * aspect) / Math.max(vw, 1);

      const pathLen = Math.hypot(dx, dy);
      const samples = hasPrev.current
        ? Math.min(
            KICK_CONFIG.maxSamples,
            Math.max(1, Math.ceil(pathLen / KICK_CONFIG.sampleStep)),
          )
        : 1;

      tmpOrigin.current.setFromMatrixPosition(state.camera.matrixWorld);

      for (let s = 1; s <= samples; s++) {
        const t = hasPrev.current ? s / samples : 1;
        const nx = prevNdc.current.x + (p.x - prevNdc.current.x) * t;
        const ny = prevNdc.current.y + (p.y - prevNdc.current.y) * t;

        // raggio dalla camera attraverso il punto NDC
        tmpNdc.current.set(nx, ny, 0.5).unproject(state.camera);
        ray.current.origin.copy(tmpOrigin.current);
        ray.current.direction
          .copy(tmpNdc.current)
          .sub(tmpOrigin.current)
          .normalize();

        // solo il pezzo PIÙ VICINO alla camera prende il colpo: niente calci
        // attraverso una lettera che sta davanti
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < gs.length; i++) {
          const g = gs[i];
          if (!g) continue;

          const mask = pieces[i].mask;
          tmpLocalO.current.copy(ray.current.origin).applyMatrix4(invMat.current[i]);
          tmpLocalD.current
            .copy(ray.current.direction)
            .transformDirection(invMat.current[i]);
          // intersezione con la faccia FRONTALE del pezzo (non col piano
          // mediano: i pezzi sono spessi ~0.69 e bombati, e sul mediano il
          // punto di contatto scivolava fuori sagoma vicino ai bordi)
          if (Math.abs(tmpLocalD.current.z) < 1e-6) continue;
          const tHit = (mask.zFront - tmpLocalO.current.z) / tmpLocalD.current.z;
          if (tHit <= 0) continue;
          tmpLocalHit.current
            .copy(tmpLocalD.current)
            .multiplyScalar(tHit)
            .add(tmpLocalO.current);

          // il pennello è in NDC: qui serve in unità locali. La conversione
          // esatta dipende dalla profondità; la scala del gruppo e il fattore
          // di proiezione a z≈0 sono costanti nel frame, quindi basta il
          // rapporto tra il mezzo-lato visibile e 1 in NDC.
          const halfH =
            Math.tan(
              ((state.camera as THREE.PerspectiveCamera).fov * Math.PI) / 360,
            ) * Math.abs(state.camera.position.z);
          const brushLocal =
            (brushNdc * halfH) / worldScales.current[i];

          if (
            !maskHit(
              mask,
              tmpLocalHit.current.x,
              tmpLocalHit.current.y,
              brushLocal,
            )
          ) {
            continue;
          }

          // distanza reale del punto di contatto dalla camera
          const dist = tHit * worldScales.current[i];
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
            hitPoints.current[i]
              .copy(tmpLocalHit.current)
              .applyMatrix4(gs[i]!.matrixWorld);
          }
        }
        if (bestIdx >= 0) frameHit.current[bestIdx] = true;
      }
    }

    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const g = gs[i];
      if (!g) continue;

      const piece = pieces[i];
      const isInside = frameHit.current[i];

      if (!isInside) s.kicked = false;

      if (isInside && speed > KICK_CONFIG.minPointerSpeed) {
        // impulso pieno alla PRIMA spinta di questo contatto; finché il cursore
        // resta appoggiato e si muove, continua a spingere in modo progressivo
        const gain = s.kicked
          ? KICK_CONFIG.dragStrength * dt
          : KICK_CONFIG.strength;

        tmpForce.current
          .set(pointerVel.current.x, pointerVel.current.y, 0)
          .multiplyScalar(gain * piece.sizeFactor);
        if (tmpForce.current.length() > KICK_CONFIG.maxStrength) {
          tmpForce.current.setLength(KICK_CONFIG.maxStrength);
        }

        // braccio: dal baricentro al punto REALE di contatto, riportato nelle
        // unità locali del gruppo (il logo è scalato dal fit-to-view)
        tmpCenter.current.setFromMatrixPosition(g.matrixWorld);
        tmpArm.current
          .copy(hitPoints.current[i])
          .sub(tmpCenter.current)
          .divideScalar(worldScales.current[i] || 1);

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
        s.kicked = true;
      }

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
      if (tmpVec.current.length() > KICK_CONFIG.maxOffset) {
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
        const spin = s.angularVelocity.length();
        tmpAxis.current.copy(s.angularVelocity).divideScalar(spin);
        tmpSpin.current.setFromAxisAngle(tmpAxis.current, spin * dt);
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
      // matrice qui, così il test di contatto del frame dopo vede la posa
      // attuale
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
