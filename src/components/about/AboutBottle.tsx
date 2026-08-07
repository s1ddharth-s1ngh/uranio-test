import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const MODEL_URL = `${import.meta.env.BASE_URL}3d/PolygonalMindLogo_Art.glb`;
useGLTF.preload(MODEL_URL);

const TAU = Math.PI * 2;

// interpola su coppie [progresso, valore] ordinate, con easing smoothstep
function kf(p: number, stops: [number, number][]): number {
  if (p <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, v0] = stops[i];
    const [p1, v1] = stops[i + 1];
    if (p >= p0 && p <= p1) {
      const t = (p - p0) / (p1 - p0 || 1);
      const e = t * t * (3 - 2 * t); // smoothstep
      return v0 + (v1 - v0) * e;
    }
  }
  return last[1];
}

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

// Registro di debug (solo dev) per test e taratura: window.__aboutDebug
const aboutDebug: Record<string, number> = {};
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__aboutDebug = aboutDebug;
}

interface AboutBottleProps {
  // progresso di scroll 0..1 della sezione, letto ogni frame
  progress: RefObject<number>;
  reduceMotion?: boolean;
  narrow?: boolean; // layout mobile: impilato in verticale
  touch?: boolean; // niente cursore da seguire: occhio in moto autonomo
}

export function AboutBottle({
  progress,
  reduceMotion = false,
  narrow = false,
  touch = false,
}: AboutBottleProps) {
  const { scene } = useGLTF(MODEL_URL);

  // Clona e ricentra: il GLB ha il pivot alla BASE (y 0→2.07); per i 360°
  // deve ruotare attorno al baricentro. Materiali originali mantenuti
  // (il modello è texturizzato, l'occhio è dipinto nella texture)
  const model = useMemo(() => {
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const dims = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    const holder = new THREE.Group();
    holder.add(root);
    holder.scale.setScalar(2 / (dims.y || 1)); // altezza normalizzata ~2 unità
    return holder;
  }, [scene]);

  const group = useRef<THREE.Group>(null);
  const smooth = useRef(0);
  const tiltX = useRef(0);
  const tiltY = useRef(0);
  const { pointer } = useThree();

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);

    if (reduceMotion) {
      // niente animazione da scroll: posa statica leggibile accanto al testo
      // (narrow: stessa quota della fase centrale, sopra il testo impilato)
      g.position.set(narrow ? 0 : -1.3, narrow ? 0.95 : 0, 0);
      g.scale.setScalar(narrow ? 0.6 : 1.2);
      g.rotation.set(0, 0, 0);
      return;
    }

    // smoothing dello scroll indipendente dal framerate → fluido ma
    // reattivo (≈0.1/frame a 60Hz: parte subito, senza ritardo percepibile)
    const k = 1 - Math.exp(-6.5 * dt);
    smooth.current += (progress.current - smooth.current) * k;
    const p = smooth.current;

    // --- TIMELINE ---
    // dead zone minima (0.02): reagisce appena scrolli. Fasi larghe
    // (0.02→0.48 e 0.60→0.98) + sezione alta 480vh = giri lenti e smooth.
    // desktop: centro grande → sinistra (poco: -1.3) restando grande (1.2)
    // → sosta → ritorno al centro. mobile: sale/scende, il testo sta sotto
    let x: number;
    let y: number;
    let sc: number;
    if (narrow) {
      // fase centrale: in alto e piccola — il testo (larghezza piena, fino a
      // ~44vh dal basso) resta sotto il bordo inferiore della piramide
      x = 0;
      y = kf(p, [[0, -0.1], [0.02, -0.1], [0.48, 0.95], [0.6, 0.95], [0.98, -0.1], [1, -0.1]]);
      sc = kf(p, [[0, 1.15], [0.02, 1.15], [0.48, 0.55], [0.6, 0.55], [0.98, 1.15], [1, 1.15]]);
    } else {
      x = kf(p, [[0, 0], [0.02, 0], [0.48, -1.3], [0.6, -1.3], [0.98, 0], [1, 0]]);
      y = 0;
      sc = kf(p, [[0, 1.7], [0.02, 1.7], [0.48, 1.2], [0.6, 1.2], [0.98, 1.7], [1, 1.7]]);
    }
    // due giri completi: 0→2π nella Transizione A, 2π→4π nella Transizione B
    const ry = kf(p, [[0, 0], [0.02, 0], [0.48, TAU], [0.6, TAU], [0.98, TAU * 2], [1, TAU * 2]]);

    // --- OCCHIO CHE TI GUARDA (fallback: l'occhio è nella texture, quindi
    // l'intero modello si inclina verso il cursore — sottile, smorzato,
    // clampato; più marcato quando la bottiglia è grande al centro) ---
    const eyeAmp = kf(p, [[0, 1], [0.02, 0.95], [0.48, 0.45], [0.6, 0.45], [0.98, 1], [1, 1]]);
    const k2 = 1 - Math.exp(-5 * dt);
    if (touch) {
      // touch: piccolo giro lento autonomo (ampiezze sotto i clamp desktop)
      const t = state.clock.elapsedTime;
      tiltY.current += (Math.sin(t * 0.4) * 0.16 * eyeAmp - tiltY.current) * k2;
      tiltX.current += (Math.cos(t * 0.27) * 0.08 * eyeAmp - tiltX.current) * k2;
    } else {
      tiltY.current += (clamp(pointer.x * 0.28, 0.35) * eyeAmp - tiltY.current) * k2;
      tiltX.current += (clamp(-pointer.y * 0.18, 0.25) * eyeAmp - tiltX.current) * k2;
    }

    g.position.set(x, y, 0);
    g.scale.setScalar(sc);
    g.rotation.set(tiltX.current, ry + tiltY.current, 0);

    if (import.meta.env.DEV) {
      aboutDebug.p = p;
      aboutDebug.x = x;
      aboutDebug.y = y;
      aboutDebug.scale = sc;
      aboutDebug.ry = ry;
      aboutDebug.tiltX = tiltX.current;
      aboutDebug.tiltY = tiltY.current;
    }
  });

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  );
}
