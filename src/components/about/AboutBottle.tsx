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
  computeFraming,
  dampFactor,
  idleWeight,
  keyframes,
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
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

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
  const capWorldRig = useRef<THREE.Group>(null);
  const capScaleNode = useRef<THREE.Group>(null);

  const smooth = useRef(0);
  const primed = useRef(false);
  // bersagli del puntatore, smorzati nel frame loop (mai in React state)
  const pYaw = useRef(0);
  const pPitch = useRef(0);
  const pRoll = useRef(0);
  const pShift = useRef(0);

  const { pointer, viewport } = useThree();
  const cfg = CONFIG[breakpoint];

  /**
   * Rimette il tappo esattamente sull'anchor. Lavora sulle MATRICI MONDO e non
   * su valori copiati a mano: qualunque cosa faccia la bottiglia (rotazione,
   * traslazione, scala del layout), il tappo la eredita senza accumulare
   * errore. È idempotente, quindi si può chiamare a ogni frame e a qualsiasi
   * progresso — nessun `attach`, nessun cambio di gerarchia, nessun callback.
   */
  const followAnchor = () => {
    const root = layoutRig.current;
    const rig = capWorldRig.current;
    const scaleNode = capScaleNode.current;
    if (!root || !rig || !scaleNode) return;
    // le matrici della bottiglia sono state appena scritte: vanno ricalcolate
    // ORA, o il tappo inseguirebbe la posa del frame precedente
    root.updateMatrixWorld(true);
    _m
      .copy(root.matrixWorld)
      .invert()
      .multiply(asm.capAnchor.matrixWorld)
      .decompose(_pos, _quat, _scale);
    rig.position.copy(_pos);
    rig.quaternion.copy(_quat);
    scaleNode.scale.copy(_scale);
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
      followAnchor();
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

    // il tappo, per ora, resta incollato all'anchor: la coreografia del volo
    // arriva nel passo successivo
    followAnchor();

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
        <group ref={capScaleNode}>
          <primitive object={asm.capModel} />
        </group>
      </group>
    </group>
  );
}
