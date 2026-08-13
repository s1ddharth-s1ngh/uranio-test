import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

// Asset del grafico di trend negativo (stonks): caricato e specchiato
// orizzontalmente così che la discesa vada da destra verso sinistra
const TRENDING_URL = `${import.meta.env.BASE_URL}trending.png`;
useTexture.preload(TRENDING_URL);

interface StonkConfig {
  id: number;
  // coordinate base (x, y, z) nello spazio della scena
  baseX: number;
  baseY: number;
  baseZ: number;
  scale: number;
  rotationZ: number;
  // velocità specifica di discesa allo scroll e moto proprio
  fallSpeed: number;
  driftSpeed: number;
  wobbleSpeed: number;
  wobbleAmp: number;
  // opacità massima di questo elemento (varia con la profondità Z)
  maxOpacity: number;
  // ritardo relativo di comparsa per l'effetto a cascata
  stagger: number;
}

const TOTAL_STONKS = 18;

// Genera una distribuzione armoniosa di stonks che circondano la scena
// ESCLUDENDO rigorosamente il corridoio centrale della bottiglia (|x| < 1.0, |y| < 2.0)
function generateStonks(narrow: boolean): StonkConfig[] {
  const list: StonkConfig[] = [];
  
  for (let i = 0; i < TOTAL_STONKS; i++) {
    // Alterniamo tra il lato sinistro e il lato destro della scena
    const isLeft = i % 2 === 0;
    
    // Su desktop: cluster sinistro [-3.6, -1.25], cluster destro [1.25, 3.6]
    // Su mobile (narrow): spazio più compatto e orientato verso l'alto/basso perimetrale
    let xRange: [number, number];
    let yRange: [number, number];
    
    if (narrow) {
      // Mobile: lasciamo libero il centro dove la bottiglia sale/scende
      xRange = isLeft ? [-1.9, -0.85] : [0.85, 1.9];
      yRange = [-2.4, 2.4];
    } else {
      xRange = isLeft ? [-3.6, -1.25] : [1.25, 3.6];
      yRange = [-2.2, 2.2];
    }

    // Hash pseudo-deterministico per evitare sfarfallii o layout shifting ai render
    const seed1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const rnd1 = seed1 - Math.floor(seed1);
    const seed2 = Math.sin(i * 93.9898 + 67.345) * 24634.6345;
    const rnd2 = seed2 - Math.floor(seed2);
    const seed3 = Math.sin(i * 45.1234 + 12.876) * 78945.1234;
    const rnd3 = seed3 - Math.floor(seed3);
    const seed4 = Math.sin(i * 81.3456 + 34.567) * 12345.6789;
    const rnd4 = seed4 - Math.floor(seed4);

    const baseX = xRange[0] + rnd1 * (xRange[1] - xRange[0]);
    const baseY = yRange[0] + rnd2 * (yRange[1] - yRange[0]);
    // Z da -2.5 (dietro, più lenti e tenui) a +0.8 (avanti, più veloci e visibili)
    const baseZ = -2.2 + rnd3 * 3.0;

    // Dimensioni: elementi più lontani sono più piccoli, elementi vicini sono più grandi
    const baseScale = narrow ? 0.45 + rnd4 * 0.35 : 0.55 + rnd4 * 0.55;
    const depthScaleFactor = (baseZ + 3.0) / 4.0;
    const scale = baseScale * (0.7 + depthScaleFactor * 0.5);

    // Leggera inclinazione naturale attorno all'asse Z
    const rotationZ = (rnd1 - 0.5) * 0.35;

    // Opacità proporzionale alla vicinanza, per accentuare la profondità di campo
    const maxOpacity = Math.min(0.88, 0.35 + depthScaleFactor * 0.55);

    list.push({
      id: i,
      baseX,
      baseY,
      baseZ,
      scale,
      rotationZ,
      fallSpeed: 1.2 + rnd2 * 1.6,
      driftSpeed: 0.8 + rnd3 * 0.9,
      wobbleSpeed: 1.5 + rnd4 * 1.5,
      wobbleAmp: 0.06 + rnd1 * 0.08,
      maxOpacity,
      stagger: (i / TOTAL_STONKS) * 0.07,
    });
  }

  return list;
}

interface AboutStonksProps {
  progress: RefObject<number>;
  reduceMotion?: boolean;
  narrow?: boolean;
  touch?: boolean;
}

export function AboutStonks({
  progress,
  reduceMotion = false,
  narrow = false,
  touch = false,
}: AboutStonksProps) {
  const texture = useTexture(TRENDING_URL);
  const items = useMemo(() => generateStonks(narrow), [narrow]);
  const groupRef = useRef<THREE.Group>(null);
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const materialRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  // Smoothing dello scroll analogo a quello della bottiglia per perfetta coerenza
  const smooth = useRef(0);
  const tiltX = useRef(0);
  const tiltY = useRef(0);
  const { pointer } = useThree();

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);

    // Se l'utente ha preferenze per motion ridotto, posizioniamo gli stonks statici a bassa opacità
    if (reduceMotion) {
      items.forEach((item, idx) => {
        const mesh = meshRefs.current[idx];
        const mat = materialRefs.current[idx];
        if (mesh && mat) {
          mesh.position.set(item.baseX, item.baseY, item.baseZ);
          mesh.scale.set(-item.scale, item.scale, 1);
          mat.opacity = item.maxOpacity * 0.4;
        }
      });
      return;
    }

    // Smoothing esponenziale del progresso di scroll
    const k = 1 - Math.exp(-6.5 * dt);
    smooth.current += (progress.current - smooth.current) * k;
    const p = smooth.current;

    // Parallasse col cursore o oscillazione autonoma su touch
    const k2 = 1 - Math.exp(-5 * dt);
    if (touch) {
      const t = state.clock.elapsedTime;
      tiltY.current += (Math.sin(t * 0.35) * 0.12 - tiltY.current) * k2;
      tiltX.current += (Math.cos(t * 0.25) * 0.06 - tiltX.current) * k2;
    } else {
      tiltY.current += (pointer.x * 0.2 - tiltY.current) * k2;
      tiltX.current += (-pointer.y * 0.12 - tiltX.current) * k2;
    }

    const time = state.clock.elapsedTime;

    items.forEach((item, idx) => {
      const mesh = meshRefs.current[idx];
      const mat = materialRefs.current[idx];
      if (!mesh || !mat) return;

      // --- CURVA DI VISIBILITÀ (FADE IN & FADE OUT) ---
      // Comparsa immediata all'inizio della sezione (p: 0.00 → 0.06 + stagger),
      // permanenza durante l'ingresso della bottiglia (p: 0.06 → 0.22),
      // e dissolvenza morbida man mano che entra il testo (p: 0.22 → 0.42).
      const entryP = Math.max(0, p - item.stagger);
      let opacityFactor: number;

      if (entryP < 0.06) {
        // Fade-in rapido e d'impatto all'inizio dello scroll
        opacityFactor = entryP / 0.06;
      } else if (entryP <= 0.22) {
        // Piena visibilità durante l'effetto di transizione
        opacityFactor = 1.0;
      } else if (entryP <= 0.42) {
        // Fade-out morbido verso l'inizio della lettura del testo
        opacityFactor = 1.0 - (entryP - 0.22) / 0.2;
      } else {
        opacityFactor = 0;
      }

      // Applicazione dell'opacità con smoothing visivo
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, item.maxOpacity * opacityFactor, 0.2);

      if (mat.opacity < 0.001) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;

      // --- MOVIMENTO IN DIAGONALE VERSO IL BASSO A SINISTRA ---
      // 1. Spostamento guidato dallo scroll: mentre scendi, gli stonks scendono diagonalmente
      const scrollDisplacement = p * 4.5 * item.fallSpeed;
      // Vettore diagonale di discesa coerente con la pendenza della freccia specchiata
      const scrollDx = -scrollDisplacement * 0.85;
      const scrollDy = -scrollDisplacement;

      // 2. Moto proprio continuo (discesa lenta e fluttuazione organica)
      const ambientFall = (time * item.driftSpeed * 0.45) % 6.0;
      const ambientDx = -ambientFall * 0.85;
      const ambientDy = -ambientFall;
      const wobble = Math.sin(time * item.wobbleSpeed + item.id) * item.wobbleAmp;

      // 3. Parallasse 3D in profondità (elementi più vicini si muovono di più col mouse)
      const parallaxFactor = (item.baseZ + 3.0) * 0.35;
      const posX = item.baseX + scrollDx + ambientDx + tiltY.current * parallaxFactor + wobble;
      const posY = item.baseY + scrollDy + ambientDy + tiltX.current * parallaxFactor;
      const posZ = item.baseZ;

      mesh.position.set(posX, posY, posZ);

      // Inversione orizzontale mediante scale.x negativo: inverte il PNG verso sinistra
      mesh.scale.set(-item.scale, item.scale, 1);
      mesh.rotation.set(0, 0, item.rotationZ + wobble * 0.5);
    });
  });

  return (
    <group ref={groupRef}>
      {items.map((item, idx) => (
        <mesh
          key={item.id}
          ref={(el) => {
            meshRefs.current[idx] = el;
          }}
          geometry={new THREE.PlaneGeometry(1, 1)}
        >
          <meshBasicMaterial
            ref={(el) => {
              materialRefs.current[idx] = el;
            }}
            map={texture}
            transparent={true}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
