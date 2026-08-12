import { useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { maskHit } from "./pieceMask";
import type { PieceMask } from "./pieceMask";
import type { PointerState } from "./useWindowPointer";

// ---------------------------------------------------------------------------
// UNITÀ — leggere prima di toccare qualsiasi numero.
//
// px      = pixel CSS a schermo. La velocità del cursore vive QUI: è l'unica
//           unità che non cambia con lo scroll né con la dimensione della
//           finestra, quindi è l'unica su cui si possa tarare un "feel".
// locale  = unità del gruppo padre del logo (`<group scale={fit}>`). Il logo
//           normalizzato è largo LOGO_BASE = 6; una lettera è ~1.0 × 1.2,
//           l'emblema ~6.0 × 4.6. Su desktop 1 unità locale ≈ 126 px.
// rad/s   = velocità angolare dei pezzi.
//
// La magnitudine della spinta NON è proporzionale alla velocità in px/s: la
// velocità entra in una CURVA DI RISPOSTA normalizzata (0..1) e quella pilota
// un impulso espresso direttamente in unità locali/s. Così la risposta è
// monotona, limitata per costruzione, e identica su qualunque viewport.
// ---------------------------------------------------------------------------

export const KICK_CONFIG = {
  // --- curva di risposta: px/s del cursore → energia normalizzata 0..1 ------
  // sotto questa velocità il contatto non calcia: filtra il tremolio della
  // mano (1 px/frame a 60fps = 60 px/s) senza tagliare i gesti lenti veri
  deadZonePx: 70,
  // velocità a cui la curva arriva a 1: oltre, la risposta è la massima. Va
  // tenuta alta, altrimenti tutta la gamma utile si schiaccia in basso.
  rangePx: 2600,
  // esponente della curva: <1 dà corpo alla parte bassa (gesti lenti che si
  // vedono) mantenendo il vertice al massimo
  curveExp: 0.6,
  // costante di tempo (s) del filtro sulla velocità del cursore
  velSmoothing: 0.025,
  // oltre questo spostamento in UN frame non è un gesto ma un teletrasporto
  // (cambio schermo, ripresa del render loop dopo lo scroll): si scarta
  maxFramePx: 600,

  // --- spinta ---------------------------------------------------------------
  // impulso a energia piena: è un Δv diretto, in unità locali/s. Viene erogato
  // in modo INCREMENTALE, seguendo la crescita dell'energia: che il cursore
  // arrivi già lanciato (energia da 0 a E in un frame) o che parta da fermo
  // appoggiato sul pezzo (energia che sale in dieci frame), il totale erogato
  // è lo stesso — ed è per questo che il calcio non dipende dal frame rate.
  kickSpeed: 3.6,
  // quanto in fretta il "massimo raggiunto" si dimentica (1/s): permette a una
  // seconda accelerazione dentro lo stesso contatto di dare un nuovo impulso
  peakDecay: 1.5,
  // accelerazione della spinta CONTINUA finché il cursore resta a contatto e
  // si muove (unità locali/s²): è questa a dare la sensazione di SPINGERE
  dragAccel: 16,
  // guadagno rotazionale: converte la spinta in velocità angolare. È separato
  // dal guadagno lineare apposta — la rotazione è la parte espressiva
  // dell'interazione e va spinta, la traslazione va tenuta corta.
  spinGain: 1.7,
  // guadagno lineare. Basso di proposito: a schermo il varco fra I e O è di
  // 2 px e fra N e I di 10 px, quindi una traslazione generosa farebbe
  // compenetrare due lettere cromate alla stessa profondità — che si legge
  // come un bug, non come fisica. Con 0.4 lo spostamento di picco resta sotto
  // i ~18 px e il logo non si scompone mai.
  linGain: 0.4,
  // per quanti secondi il contatto resta "agganciato" dopo che il cursore è
  // uscito dalla sagoma. Senza questa isteresi, attraversare l'occhiello di
  // una O o il tremolio sul bordo riarmano l'impulso PIENO decine di volte.
  contactRelease: 0.12,

  // --- geometria del braccio della coppia -----------------------------------
  // Il braccio è normalizzato sul raggio del pezzo, così un colpo "sul bordo"
  // vale lo stesso su una lettera e sull'emblema. La componente nel piano è
  // limitata e quella in profondità è fissa: senza questo l'emblema (largo 6
  // unità contro 0.34 di spessore) girerebbe solo come una girandola nel
  // piano dello schermo, rendendo le diagonali indistinguibili.
  armInPlaneMax: 0.7,
  depthArm: 0.45,
  // raggio di riferimento (una lettera): pezzi più grandi rispondono un po'
  // meno, ma molto meno di quanto imporrebbe la fisica pura (r², che
  // renderebbe l'emblema immobile)
  refRadius: 0.88,
  sizeExpAngular: 0.15,
  sizeExpLinear: 0.5,

  // --- tetti invalicabili ---------------------------------------------------
  maxLinearSpeed: 3.5,
  maxAngularSpeed: 3.0,
  // ~25 px: circa il doppio dello spostamento di picco raggiungibile, quindi è
  // una rete di sicurezza contro l'accumulo, non un limite che si tocca sempre
  maxOffset: 0.2,

  // --- molle di richiamo ----------------------------------------------------
  // traslazione: ω = √k ≈ 5.8 rad/s, ζ = c / 2√k ≈ 0.64
  k: 34,
  c: 7.5,
  // rotazione: ω = √restoreTorque = 4.0 rad/s, ζ = damping / 2√rt = 0.70
  // → un solo rimbalzo morbido, a riposo in ~1.4 s
  damping: 5.6,
  restoreTorque: 16,

  // --- test di contatto -----------------------------------------------------
  // raggio del "pennello" attorno al cursore, in px: si può SFIORARE il bordo
  // di una lettera senza doverla centrare al pixel, senza però mangiarsi gli
  // occhielli di R/A/O
  brushPx: 6,
  // campionamento del tratto percorso dal cursore tra due frame: il passo sta
  // sotto il DIAMETRO del pennello (12 px), altrimenti fra due punti testati
  // resta un buco in cui un movimento veloce può infilarsi senza toccare
  // niente. Il tetto copre 320 px in un frame = 9600 px/s a 30 fps.
  sampleStepPx: 8,
  maxSamples: 40,
};

export interface LetterPiece {
  id: string;
  restPos: [number, number, number];
  // raggio della sfera circoscritta, in unità locali: normalizza il braccio e
  // pesa la reattività del pezzo
  radius: number;
  mask: PieceMask;
}

interface LetterState {
  origin: THREE.Vector3;
  originQuat: THREE.Quaternion;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  // massima energia già "pagata" in questo contatto: l'impulso eroga solo gli
  // incrementi, così partire da fermo appoggiati sul pezzo e arrivarci già
  // lanciati danno lo stesso totale
  peakEnergy: number;
  // da quanti secondi il cursore non tocca più la sagoma (isteresi)
  away: number;
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
  const prevClient = useRef(new THREE.Vector2());
  const prevEpoch = useRef(-1);
  const hasPrev = useRef(false);
  // velocità del cursore filtrata (EMA), in px/s, y verso l'alto
  const pointerVel = useRef(new THREE.Vector2());
  // pezzi toccati in QUESTO frame + punto di contatto (mondo)
  const frameHit = useRef<boolean[]>(pieces.map(() => false));
  const hitPoints = useRef<THREE.Vector3[]>(pieces.map(() => new THREE.Vector3()));
  // matrice inversa del gruppo, aggiornata una volta a frame
  const invMat = useRef<THREE.Matrix4[]>(pieces.map(() => new THREE.Matrix4()));
  const worldScales = useRef<number[]>(pieces.map(() => 1));

  // temporanei riusati: il loop gira a 60fps, niente allocazioni per frame
  const tmpV2 = useRef(new THREE.Vector2());
  const tmpDir = useRef(new THREE.Vector2());
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
        peakEnergy: 0,
        away: Infinity,
      }));
    }
    const states = statesRef.current;

    const p = pointer.current;
    // reduce-motion o touch: nessun input, i pezzi vanno solo a riposo
    const canKick = p.active && !reduceMotion && !ambient;

    // ---- dal cursore al canvas -------------------------------------------
    // Il rettangolo arriva da useWindowPointer ed è quello VERO del canvas,
    // riletto a ogni scroll/resize. Normalizzare su window.innerWidth/Height
    // sarebbe sbagliato: il canvas dell'hero è in flusso normale e scorre.
    const rw = p.rect.width || 1;
    const rh = p.rect.height || 1;
    const ndcX = ((p.cx - p.rect.left) / rw) * 2 - 1;
    const ndcY = -(((p.cy - p.rect.top) / rh) * 2 - 1);

    // ---- velocità del cursore, in px/s (filtrata) -------------------------
    // Misurata in px viewport: lo scroll muove il canvas ma non il cursore,
    // quindi scrollare non può generare velocità. Le discontinuità (scroll,
    // resize, rientro, tab) alzano `epoch` e vengono scartate.
    let dxPx = 0;
    let dyPx = 0;
    let continuous = false;
    if (canKick && hasPrev.current && p.epoch === prevEpoch.current) {
      const ddx = p.cx - prevClient.current.x;
      const ddy = -(p.cy - prevClient.current.y);
      // salto implausibile in un frame: teletrasporto, non gesto
      if (Math.hypot(ddx, ddy) <= KICK_CONFIG.maxFramePx) {
        dxPx = ddx;
        dyPx = ddy;
        continuous = true;
      }
    }
    const alpha = 1 - Math.exp(-dt / KICK_CONFIG.velSmoothing);
    pointerVel.current.lerp(tmpV2.current.set(dxPx / dt, dyPx / dt), alpha);
    let speedPx = pointerVel.current.length();
    // cintura di sicurezza: un NaN nella EMA non si ripulirebbe mai da solo
    if (!Number.isFinite(speedPx)) {
      pointerVel.current.set(0, 0);
      speedPx = 0;
    }

    // ---- curva di risposta -------------------------------------------------
    // Questa è la sola cosa che decide QUANTA energia entra: la velocità grezza
    // non arriva mai alla fisica. Risultato: monotona, limitata, e indipendente
    // sia dal frame rate sia dalla dimensione della finestra.
    let energy = 0;
    if (speedPx > KICK_CONFIG.deadZonePx) {
      const t = Math.min(
        1,
        (speedPx - KICK_CONFIG.deadZonePx) /
          (KICK_CONFIG.rangePx - KICK_CONFIG.deadZonePx),
      );
      energy = Math.pow(t, KICK_CONFIG.curveExp);
      tmpDir.current.copy(pointerVel.current).divideScalar(speedPx);
    }

    // ---- contatto cursore ↔ sagoma ---------------------------------------
    // Per ogni pezzo: si porta il raggio del cursore nello spazio LOCALE del
    // gruppo, lo si interseca con la faccia frontale e si legge la maschera di
    // silhouette — O(1).
    // Niente bounding sphere (l'emblema è una L: il suo cerchio è quasi tutto
    // vuoto — era il motivo per cui si muoveva col cursore lontano) e niente
    // raycast sulle mesh (~1.4ms per raggio su 26k triangoli: troppo).
    for (let i = 0; i < frameHit.current.length; i++) frameHit.current[i] = false;

    // mezza altezza visibile a z=0 e conversione px → unità mondo: servono al
    // pennello, che è tarato in PIXEL a schermo
    const cam = state.camera as THREE.PerspectiveCamera;
    const halfH =
      Math.tan(((cam.fov ?? 50) * Math.PI) / 360) * Math.abs(cam.position.z);
    const worldPerPx = (2 * halfH) / rh;

    if (canKick) {
      for (let i = 0; i < gs.length; i++) {
        const g = gs[i];
        if (!g) continue;
        invMat.current[i].copy(g.matrixWorld).invert();
        worldScales.current[i] = g.getWorldScale(tmpScale.current).x || 1;
      }

      const prevNdcX = ((prevClient.current.x - p.rect.left) / rw) * 2 - 1;
      const prevNdcY = -(((prevClient.current.y - p.rect.top) / rh) * 2 - 1);
      const pathPx = Math.hypot(dxPx, dyPx);
      const samples = continuous
        ? Math.min(
            KICK_CONFIG.maxSamples,
            Math.max(1, Math.ceil(pathPx / KICK_CONFIG.sampleStepPx)),
          )
        : 1;

      tmpOrigin.current.setFromMatrixPosition(state.camera.matrixWorld);

      for (let s = 1; s <= samples; s++) {
        const t = continuous ? s / samples : 1;
        const nx = prevNdcX + (ndcX - prevNdcX) * t;
        const ny = prevNdcY + (ndcY - prevNdcY) * t;

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
          if (!(tHit > 0)) continue;
          tmpLocalHit.current
            .copy(tmpLocalD.current)
            .multiplyScalar(tHit)
            .add(tmpLocalO.current);

          // il pennello è in px a schermo: qui serve in unità locali
          const brushLocal =
            (KICK_CONFIG.brushPx * worldPerPx) / worldScales.current[i];

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
          }
        }
        if (bestIdx >= 0) {
          frameHit.current[bestIdx] = true;
          // il punto di contatto va ricalcolato per il pezzo VINCENTE: dentro
          // il ciclo verrebbe scritto anche per pezzi poi scartati, e il
          // braccio (quindi l'asse di rotazione) punterebbe a un punto che
          // l'utente non ha toccato
          tmpLocalO.current
            .copy(ray.current.origin)
            .applyMatrix4(invMat.current[bestIdx]);
          tmpLocalD.current
            .copy(ray.current.direction)
            .transformDirection(invMat.current[bestIdx]);
          const tBest =
            (pieces[bestIdx].mask.zFront - tmpLocalO.current.z) /
            tmpLocalD.current.z;
          hitPoints.current[bestIdx]
            .copy(tmpLocalD.current)
            .multiplyScalar(tBest)
            .add(tmpLocalO.current)
            .applyMatrix4(gs[bestIdx]!.matrixWorld);
        }
      }
    }

    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const g = gs[i];
      if (!g) continue;

      const piece = pieces[i];
      const isInside = frameHit.current[i];

      // isteresi sul contatto: uscire per un frame (un occhiello, il tremolio
      // sul bordo) non deve riarmare l'impulso pieno
      if (isInside) {
        s.away = 0;
      } else {
        s.away += dt;
        if (s.away > KICK_CONFIG.contactRelease) s.peakEnergy = 0;
      }

      if (isInside && energy > 0) {
        // IMPULSO: solo la parte di energia non ancora pagata in questo
        // contatto. Sommato nel tempo dà sempre kickSpeed·energia, comunque il
        // gesto sia distribuito sui frame.
        // SPINTA CONTINUA: proporzionale all'energia, integrata con dt.
        const gained = Math.max(0, energy - s.peakEnergy);
        s.peakEnergy = Math.max(
          energy,
          s.peakEnergy - KICK_CONFIG.peakDecay * dt,
        );
        const mag =
          KICK_CONFIG.kickSpeed * gained +
          KICK_CONFIG.dragAccel * energy * dt;

        tmpForce.current.set(
          tmpDir.current.x * mag,
          tmpDir.current.y * mag,
          0,
        );

        // pezzi più grandi rispondono un po' meno, ma senza la penalità r²
        // della fisica pura (renderebbe l'emblema immobile accanto alle lettere)
        const sizeRatio = piece.radius / KICK_CONFIG.refRadius;
        const attAng = Math.pow(sizeRatio, KICK_CONFIG.sizeExpAngular);
        const attLin = Math.pow(sizeRatio, KICK_CONFIG.sizeExpLinear);

        // braccio NORMALIZZATO: dal baricentro al punto reale di contatto,
        // riportato in unità locali e diviso per il raggio del pezzo. La
        // componente nel piano è limitata e quella in profondità è fissa: è
        // ciò che rende una diagonale distinguibile da un'orizzontale invece
        // di far girare tutto come una girandola.
        tmpCenter.current.setFromMatrixPosition(g.matrixWorld);
        tmpArm.current
          .copy(hitPoints.current[i])
          .sub(tmpCenter.current)
          .divideScalar((worldScales.current[i] || 1) * piece.radius);
        tmpArm.current.z = 0;
        const inPlane = tmpArm.current.length();
        if (inPlane > KICK_CONFIG.armInPlaneMax) {
          tmpArm.current.multiplyScalar(KICK_CONFIG.armInPlaneMax / inPlane);
        }
        tmpArm.current.z = KICK_CONFIG.depthArm;

        tmpTorque.current
          .copy(tmpArm.current)
          .cross(tmpForce.current)
          .multiplyScalar(KICK_CONFIG.spinGain / attAng);
        s.angularVelocity.add(tmpTorque.current);
        if (s.angularVelocity.length() > KICK_CONFIG.maxAngularSpeed) {
          s.angularVelocity.setLength(KICK_CONFIG.maxAngularSpeed);
        }

        s.velocity.addScaledVector(
          tmpForce.current,
          KICK_CONFIG.linGain / attLin,
        );
        if (s.velocity.length() > KICK_CONFIG.maxLinearSpeed) {
          s.velocity.setLength(KICK_CONFIG.maxLinearSpeed);
        }
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

      // Lo snap a riposo NON deve toccare un pezzo che in questo frame sta
      // ricevendo una spinta: con l'impulso erogato in modo incrementale, un
      // gesto lento aggiunge per qualche frame meno di quanto la soglia
      // consideri "fermo", e senza questa guardia lo snap lo azzererebbe a ogni
      // frame — cioè i gesti lenti non muoverebbero mai nulla.
      const pushed = isInside && energy > 0;
      if (
        !pushed &&
        s.velocity.lengthSq() < 0.0025 &&
        s.angularVelocity.lengthSq() < 0.0025 &&
        s.position.distanceTo(s.origin) < 0.005 &&
        s.quaternion.angleTo(s.originQuat) < 0.005
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
      prevClient.current.set(p.cx, p.cy);
      prevEpoch.current = p.epoch;
      hasPrev.current = true;
    } else {
      hasPrev.current = false;
      prevEpoch.current = -1;
      // niente code di velocità da riapplicare quando il cursore rientra
      pointerVel.current.set(0, 0);
    }
  });
}
