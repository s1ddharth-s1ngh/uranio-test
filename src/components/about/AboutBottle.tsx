import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { buildBottleAssembly } from "./bottleAssembly";
import {
  CONFIG,
  PHASES,
  clampAbs,
  computeCapPose,
  computeFraming,
  dampFactor,
  idleWeight,
  keyframes,
  lerp,
  makeCapPose,
  pointerWeight,
} from "./aboutTimeline";
import type { Breakpoint } from "./aboutTimeline";

// Bottiglia e tappo sono due modelli separati: li incastro io in un unico
// oggetto (vedi bottleAssembly.ts) così sembra una bottiglia chiusa.
const BOTTLE_URL = `${import.meta.env.BASE_URL}3d/ginger_beer_bottle.glb`;
const CAP_URL = `${import.meta.env.BASE_URL}3d/old_antic_beer_bottle_cap.glb`;
useGLTF.preload(BOTTLE_URL);
useGLTF.preload(CAP_URL);

// Registro di debug (solo dev) per test e taratura: window.__aboutDebug
const aboutDebug: Record<string, number> = {};
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__aboutDebug = aboutDebug;
}

// Scratch riusati a ogni frame: allocare Vector3/Quaternion/Matrix4 dentro
// useFrame vuol dire regalare lavoro al garbage collector 60 volte al secondo.
const _m = new THREE.Matrix4();
const _mInv = new THREE.Matrix4();
const _mStable = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _posStable = new THREE.Vector3();
const _quatStable = new THREE.Quaternion();
const _hoverQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _capPose = makeCapPose();

interface AboutBottleProps {
  // progresso di scroll 0..1 della sezione, letto ogni frame
  progress: RefObject<number>;
  breakpoint: Breakpoint;
  reduceMotion?: boolean;
  touch?: boolean; // niente cursore da seguire: solo moto autonomo
}

export function AboutBottle({
  progress,
  breakpoint,
  reduceMotion = false,
  touch = false,
}: AboutBottleProps) {
  const bottleGltf = useGLTF(BOTTLE_URL);
  const capGltf = useGLTF(CAP_URL);

  // Bottiglia raddrizzata + tappo calzato sulla bocca, centrati sull'origine e
  // alti 2 unità. Il tappo è un oggetto a sé, FUORI dall'assieme: dentro resta
  // solo `capAnchor`, il segnaposto della posa chiusa.
  const asm = useMemo(
    () => buildBottleAssembly(bottleGltf.scene, capGltf.scene),
    [bottleGltf.scene, capGltf.scene],
  );

  // Un rig per responsabilità: così nessun oggetto ha due scrittori e la posa
  // finale è la composizione delle matrici, non una somma di Euler fragile.
  const layoutRig = useRef<THREE.Group>(null); // inquadratura + reveal finale
  const scrollRig = useRef<THREE.Group>(null); // pose narrative da progresso
  const idleRig = useRef<THREE.Group>(null); // respiro continuo
  const pointerRig = useRef<THREE.Group>(null); // parallasse col cursore
  const capWorldRig = useRef<THREE.Group>(null); // posa da curva / anchor
  const capOffsetRig = useRef<THREE.Group>(null); // respiro e cursore del tappo
  const capSpinRig = useRef<THREE.Group>(null); // giri interi sull'asse
  const capScaleNode = useRef<THREE.Group>(null);

  const smooth = useRef(0);
  const primed = useRef(false);
  // bersagli del puntatore, smorzati nel frame loop (mai in React state)
  const pYaw = useRef(0);
  const pPitch = useRef(0);
  const pRoll = useRef(0);
  const pShift = useRef(0);
  // gli stessi bersagli, per il tappo staccato
  const capPX = useRef(0);
  const capPY = useRef(0);
  const capRX = useRef(0);
  const capRZ = useRef(0);

  const { pointer, viewport } = useThree();
  const cfg = CONFIG[breakpoint];

  /**
   * Posa del tappo. Lavora sulle MATRICI e non su valori copiati a mano:
   * qualunque cosa faccia la bottiglia, l'aggancio la eredita senza accumulare
   * errore. È idempotente e funzione del solo progresso — nessun `attach`,
   * nessun cambio di gerarchia, nessun callback che uno scrub possa saltare.
   *
   * Due riferimenti per il collo:
   *  • VIVO   = anchor com'è adesso, respiro e cursore compresi. A tappo
   *             chiuso è questo, ed è ciò che rende l'aggancio esatto.
   *  • STABILE = solo la posa narrativa, senza respiro né cursore. In hovering
   *             è questo, così il tappo non oscilla in fase con la bottiglia.
   * Si passa dall'uno all'altro con `openness`, quindi senza discontinuità.
   */
  const applyCapPose = (p: number, t: number, dt: number) => {
    const root = layoutRig.current;
    const scroll = scrollRig.current;
    const rig = capWorldRig.current;
    const offset = capOffsetRig.current;
    const spin = capSpinRig.current;
    const scaleNode = capScaleNode.current;
    if (!root || !scroll || !rig || !offset || !spin || !scaleNode) return;

    // le matrici della bottiglia sono state appena scritte: vanno ricalcolate
    // ORA, o il tappo inseguirebbe la posa del frame precedente
    root.updateMatrixWorld(true);
    _mInv.copy(root.matrixWorld).invert();

    // riferimento VIVO
    _m.copy(_mInv).multiply(asm.capAnchor.matrixWorld).decompose(_pos, _quat, _scale);
    scaleNode.scale.copy(_scale);

    const pose = reduceMotion
      ? null
      : computeCapPose(
          p,
          cfg,
          asm.world.bottleHeight,
          asm.world.capSinkDepth,
          _capPose,
        );

    if (!pose || pose.openness <= 0) {
      // agganciato: copia secca dell'anchor, offset e spin azzerati. È qui che
      // "zero drift, zero gap, zero salto" smette di essere un'aspirazione.
      rig.position.copy(_pos);
      rig.quaternion.copy(_quat);
      offset.position.set(0, 0, 0);
      offset.rotation.set(0, 0, 0);
      spin.rotation.y = 0;
      return;
    }

    // riferimento STABILE: scrollRig × anchor, saltando respiro e cursore
    _mStable
      .multiplyMatrices(scroll.matrix, asm.capAnchorLocal)
      .decompose(_posStable, _quatStable, _scale);

    const o = pose.openness;
    rig.position.set(
      lerp(_pos.x, _posStable.x, o) + pose.offset.x,
      lerp(_pos.y, _posStable.y, o) + pose.offset.y,
      lerp(_pos.z, _posStable.z, o) + pose.offset.z,
    );

    // orientamento: slerp dall'anchor alla posa assoluta di hovering. A o=0
    // vale esattamente l'anchor, quindi il riaggancio è esatto per costruzione.
    // l'inclinazione usa `orient`, non `openness`: si spegne molto prima
    // quando il tappo si riavvicina, o la gonna passerebbe dentro il vetro
    const ow = pose.orient;
    _euler.set(pose.tiltX, 0, pose.tiltZ);
    _hoverQuat.setFromEuler(_euler);
    rig.quaternion.slerpQuaternions(_quat, _hoverQuat, ow);
    spin.rotation.y = pose.spin;

    // --- offset additivi: vivi solo da staccato, si spengono da soli --------
    // pesati anche loro da `orient`, per lo stesso motivo: a fine rientro il
    // gioco radiale è di millesimi e non tollera né bob né cursore.
    const W = asm.world;
    // respiro del tappo: più mosso di quello del corpo e su altre frequenze,
    // così i due non oscillano mai in fase
    offset.position.set(
      Math.sin(t * 0.61 + 1.9) * 0.010 * W.bottleHeight * ow + capPX.current,
      Math.sin(t * 0.83 + 0.4) * 0.018 * W.bottleHeight * ow + capPY.current,
      0,
    );
    // la deriva lenta sull'asse è un'oscillazione ampia e lentissima (~57 s di
    // periodo): si legge come inerzia, non come un loop
    offset.rotation.set(
      Math.sin(t * 0.53) * 0.10 * ow + capRX.current,
      Math.sin(t * 0.11) * 0.5 * ow,
      Math.cos(t * 0.37 + 0.9) * 0.08 * ow + capRZ.current,
    );

    // risposta al cursore: più pronta della bottiglia (λ=7) ma sempre
    // smorzata, e pesata da `orient` così in riaggancio si azzera da sola
    const pw = touch ? 0 : ow;
    const k = dampFactor(7, dt);
    const px = clampAbs(pointer.x, 1);
    const py = clampAbs(pointer.y, 1);
    const shift = cfg.capPointer.shift * W.bottleWidth * pw;
    capPX.current += (px * shift - capPX.current) * k;
    capPY.current += (-py * shift * 0.7 - capPY.current) * k;
    capRX.current += (-py * cfg.capPointer.tilt * pw - capRX.current) * k;
    capRZ.current += (-px * cfg.capPointer.tilt * pw - capRZ.current) * k;
  };

  /** inquadratura: la matematica sta in computeFraming, qui solo l'applicazione */
  const applyFraming = (p: number) => {
    const rig = layoutRig.current;
    if (!rig) return;
    const f = computeFraming(p, cfg, asm.world, viewport.height, reduceMotion);
    rig.scale.setScalar(f.scale);
    rig.position.set(0, f.y, 0);
  };

  useFrame((state, delta) => {
    const scroll = scrollRig.current;
    const idle = idleRig.current;
    const ptr = pointerRig.current;
    if (!scroll || !idle || !ptr) return;
    const dt = Math.min(delta, 0.05);
    const W = asm.world;

    if (reduceMotion) {
      // niente scrollytelling: posa statica, bottiglia intera, tappo chiuso
      applyFraming(1);
      scroll.position.set(0, 0, 0);
      scroll.rotation.set(0, 0, 0);
      idle.position.set(0, 0, 0);
      idle.rotation.set(0, 0, 0);
      ptr.position.set(0, 0, 0);
      ptr.rotation.set(0, 0, 0);
      applyCapPose(1, 0, dt);
      return;
    }

    // Smoothing dello scroll indipendente dal framerate: fluido ma reattivo
    // (≈0.1/frame a 60Hz). Al primo frame — e dopo un refresh a metà sezione —
    // si aggancia secco, altrimenti si vedrebbe una spazzata da 0 al vero p.
    if (!primed.current) {
      smooth.current = progress.current;
      primed.current = true;
    } else {
      smooth.current +=
        (progress.current - smooth.current) * dampFactor(6.5, dt);
    }
    const p = smooth.current;
    const t = state.clock.elapsedTime;

    applyFraming(p);

    // --- POSA NARRATIVA (deterministica dal solo progresso) ---------------
    // Rotazione lenta durante le card: mostra il prodotto da angolazioni
    // diverse senza mai portare l'etichetta fuori leggibilità.
    const cy = cfg.contentYaw;
    const mid = PHASES.content.s + (PHASES.content.e - PHASES.content.s) * 0.45;
    const ry = keyframes(p, [
      [0, 0],
      [PHASES.content.s, -cy * 0.35],
      [mid, cy * 0.5],
      [PHASES.content.e, cy * 0.12],
      [PHASES.returning.e, 0],
      [1, 0],
    ]);

    // Rinculo: si carica durante l'anticipazione (scende), scatta allo stacco
    // del tappo e si riassesta. Sotto i 2° e sotto il 2% dell'altezza, come da
    // budget di movimento: deve sentirsi, non vedersi.
    const recoilY = keyframes(p, [
      [PHASES.tension.s, 0],
      [PHASES.tension.e, -0.012],
      [PHASES.opening.s + 0.03, 0.016],
      [PHASES.opening.e, 0],
    ]);
    const recoilRoll = keyframes(p, [
      [PHASES.tension.s, 0],
      [PHASES.tension.e, 0.008],
      [PHASES.opening.s + 0.03, -0.021],
      [PHASES.opening.e, 0],
    ]);

    scroll.position.set(0, recoilY * W.bottleHeight, 0);
    scroll.rotation.set(0, ry, recoilRoll);

    // --- RESPIRO CONTINUO (additivo, su un rig suo) -----------------------
    // Frequenze volutamente incommensurabili: il ciclo completo non si
    // riconosce nemmeno restando fermi venti secondi.
    const iw = idleWeight(p);
    idle.position.set(0, Math.sin(t * 0.47) * cfg.idle.bobY * W.bottleHeight * iw, 0);
    idle.rotation.set(
      Math.cos(t * 0.23 + 0.7) * cfg.idle.pitchX * iw,
      Math.sin(t * 0.19 + 2.1) * cfg.idle.yawY * iw,
      Math.sin(t * 0.31 + 1.3) * cfg.idle.rollZ * iw,
    );

    // --- PARALLASSE COL CURSORE (additiva, su un rig suo) -----------------
    // Stesso damping esponenziale della prima sezione (λ=5): la bottiglia
    // segue con inerzia, non incollata al puntatore.
    const pw = touch ? 0 : pointerWeight(p);
    const k = dampFactor(5, dt);
    const px = clampAbs(pointer.x, 1);
    const py = clampAbs(pointer.y, 1);
    pYaw.current += (px * cfg.pointer.yaw * pw - pYaw.current) * k;
    pPitch.current += (-py * cfg.pointer.pitch * pw - pPitch.current) * k;
    pRoll.current += (px * cfg.pointer.roll * pw - pRoll.current) * k;
    pShift.current +=
      (px * cfg.pointer.shiftX * W.bottleHeight * pw - pShift.current) * k;

    ptr.position.set(pShift.current, 0, 0);
    ptr.rotation.set(pPitch.current, pYaw.current, pRoll.current);

    applyCapPose(p, t, dt);

    if (import.meta.env.DEV) {
      aboutDebug.p = p;
      aboutDebug.scale = layoutRig.current?.scale.x ?? 0;
      aboutDebug.layoutY = layoutRig.current?.position.y ?? 0;
      aboutDebug.ry = ry;
      aboutDebug.recoilY = recoilY;
      aboutDebug.idleWeight = iw;
      aboutDebug.pointerWeight = pw;
    }
  });

  // Il rig del tappo è FRATELLO di quello della bottiglia, non figlio: così
  // durante la fase aperta non eredita scroll, respiro e parallasse del corpo.
  // Quando è agganciato ci pensa followAnchor() a rimetterlo esattamente lì.
  return (
    <group ref={layoutRig}>
      <group ref={scrollRig}>
        <group ref={idleRig}>
          <group ref={pointerRig}>
            <primitive object={asm.holder} />
          </group>
        </group>
      </group>
      <group ref={capWorldRig}>
        <group ref={capOffsetRig}>
          <group ref={capSpinRig}>
            <group ref={capScaleNode}>
              <primitive object={asm.capModel} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
