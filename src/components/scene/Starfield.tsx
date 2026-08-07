import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface StarfieldProps {
  reduceMotion?: boolean;
  // riduce il numero di stelle sui dispositivi meno potenti (1 = pieno)
  factor?: number;
}

// Sprite circolare soffice generato una volta sola: i PointsMaterial di default
// disegnano quadrati, con questa alphaMap diventano puntini rotondi sfumati
function makeStarSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Posizioni casuali in un guscio sferico [rMin, rMax] + luminosità variabile
function makeStars(count: number, rMin: number, rMax: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.set(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    );
    if (v.lengthSq() < 1e-4) v.set(0, 0, 1);
    v.normalize().multiplyScalar(rMin + Math.random() * (rMax - rMin));
    positions.set([v.x, v.y, v.z], i * 3);
    // dal grigio tenue al bianco pieno, con code deboli più frequenti
    const brightness = 0.25 + Math.pow(Math.random(), 2.2) * 0.75;
    colors.set([brightness, brightness, brightness], i * 3);
  }
  return { positions, colors };
}

function StarLayer({
  count,
  rMin,
  rMax,
  size,
  sprite,
}: {
  count: number;
  rMin: number;
  rMax: number;
  size: number;
  sprite: THREE.CanvasTexture;
}) {
  const { positions, colors } = useMemo(
    () => makeStars(count, rMin, rMax),
    [count, rMin, rMax],
  );
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        sizeAttenuation
        vertexColors
        transparent
        depthWrite={false}
        map={sprite}
        alphaMap={sprite}
      />
    </points>
  );
}

export default function Starfield({
  reduceMotion = false,
  factor = 1,
}: StarfieldProps) {
  const group = useRef<THREE.Group>(null);
  const sprite = useMemo(() => makeStarSprite(), []);

  // rotazione lentissima dell'intero campo; la parallasse col mouse
  // arriva "gratis" dal movimento della camera (CameraRig)
  useFrame((_, delta) => {
    if (reduceMotion || !group.current) return;
    group.current.rotation.y += delta * 0.004;
    group.current.rotation.x += delta * 0.0015;
  });

  return (
    <group ref={group}>
      {/* strato lontano: tante stelle piccole e deboli */}
      <StarLayer
        count={Math.round(1300 * factor)}
        rMin={18}
        rMax={42}
        size={0.14}
        sprite={sprite}
      />
      {/* strato vicino: poche stelle più grandi e luminose, più parallasse */}
      <StarLayer
        count={Math.round(220 * factor)}
        rMin={9}
        rMax={17}
        size={0.3}
        sprite={sprite}
      />
    </group>
  );
}
