import { Component, Suspense, useMemo } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  useGLTF,
  useProgress,
} from "@react-three/drei";
import * as THREE from "three";
import UranioLogo, { URANIO_URL } from "./UranioLogo";
import Starfield from "./Starfield";
import { useWindowPointer } from "./useWindowPointer";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useIsTouch } from "../../hooks/useIsTouch";
import { setAssetProgress } from "../../lib/assetProgress";
import {
  FILL_LIGHT_INTENSITY,
  KEY_LIGHT_INTENSITY,
  TONE_MAPPING_EXPOSURE,
} from "./heroParams";

// inoltra il progresso reale dei GLB allo store letto dal Loader.
// Registrato PRIMA dei preload (l'onStart sincrono non va perso) e con un
// sync iniziale: da qui in poi il Loader sa che il chunk della scena è vivo
useProgress.subscribe((s) => {
  setAssetProgress({ progress: s.progress, active: s.active });
});
setAssetProgress({
  progress: useProgress.getState().progress,
  active: useProgress.getState().active,
});

// il logo Uranio (lettere + emblema) è l'unico modello dell'hero: preload DOPO
// la subscription qui sopra, così l'onStart sincrono non va perso
useGLTF.preload(URANIO_URL);

interface HeroSceneProps {
  reduceMotion?: boolean;
  // false quando l'hero è scrollato fuori vista: il render loop si ferma
  active?: boolean;
}

// Configurazione camera/qualità per fascia di dispositivo. Il logo è ~quadrato
// e viene sempre adattato alla viewport da UranioLogo (fit-to-view interno),
// quindi qui bastano fov/distanza camera + parametri di qualità
interface ViewConfig {
  fov: number;
  camZ: number;
  dpr: [number, number];
  starFactor: number;
  envRes: number;
}

const DESKTOP_VIEW: ViewConfig = {
  fov: 40,
  camZ: 9.5,
  dpr: [1, 2],
  starFactor: 1,
  envRes: 256,
};

// Applica fov/z al volo (breakpoint o rotazione device): il prop camera del
// Canvas vale solo al mount. Nel useFrame (come CameraRig): il cambio di
// breakpoint arriva sempre con un resize, che fa girare un frame anche in
// frameloop="demand"
function CameraConfig({ fov, camZ }: { fov: number; camZ: number }) {
  useFrame((state) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    if (cam.fov !== fov || cam.position.z !== camZ) {
      cam.fov = fov;
      cam.position.z = camZ;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

// Gradiente ambiente "cielo chiaro / terra NERA" ad alto contrasto: è la
// sorgente vera del look liquid-chrome (§4/§5). Sulle lettere GONFIE la
// curvatura stira questo gradiente verticale sulla superficie → le creste
// rivolte in su pescano il cielo chiaro (bianco), le facce inferiori e le
// cavità pescano la terra nera (nero profondo), il centro frontale resta
// argento medio. Un filo di FREDDO (blu/ciano) nei bui dà il tocco "acciaio".
function makeChromeGradient(): THREE.CanvasTexture {
  const w = 16;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // gradiente verticale continuo (niente orizzonte netto: le lettere sono
  // curve, un gradiente morbido rende meglio della banda dura). Contrasto
  // spinto zenit→nadir: è quello che separa creste bianche e ventri neri.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, "#ced2dc"); // zenit: argento chiaro (creste in su)
  grad.addColorStop(0.12, "#f6f8fc"); // fascia alta bruciata → creste bianche
  grad.addColorStop(0.24, "#d0d3db"); // sotto la fascia: argento chiaro
  grad.addColorStop(0.38, "#a6a9b2"); // alto-medio: argento
  grad.addColorStop(0.5, "#7c7f88"); // equatore: argento medio (facce frontali)
  grad.addColorStop(0.62, "#484a52"); // sotto l'equatore: grigio, in calo
  grad.addColorStop(0.74, "#242630"); // scuro freddo
  grad.addColorStop(0.86, "#101218"); // basso: quasi nero
  grad.addColorStop(1.0, "#040508"); // nadir: nero (ventri e cavità)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ambiente procedurale (niente HDR da rete: funziona offline e non pesa sul
// caricamento): sfera col gradiente chiaro/nero + una fascia di luce netta in
// alto per gli highlight bruciati sulle creste (§5)
function ChromeEnvironment({ resolution = 256 }: { resolution?: number }) {
  const gradient = useMemo(() => makeChromeGradient(), []);
  return (
    <Environment resolution={resolution} frames={1}>
      <mesh scale={50}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial map={gradient} side={THREE.BackSide} />
      </mesh>
      {/* KEY LIGHT: grande fascia rettangolare in ALTO → l'highlight bianco
          bruciato netto sulle creste superiori. È il riflesso brillante su
          corpo scuro a dare l'effetto cromo (§5) */}
      <Lightformer
        intensity={KEY_LIGHT_INTENSITY}
        position={[0, 6, 3]}
        rotation-x={Math.PI / 2}
        scale={[12, 3, 1]}
      />
      {/* riempimenti laterali tenui: un accenno di luce sui fianchi così i
          bordi visti di taglio (Fresnel) hanno qualcosa di chiaro da pescare,
          senza schiarire i ventri */}
      <Lightformer
        intensity={FILL_LIGHT_INTENSITY}
        position={[-6, 1, 4]}
        rotation-y={Math.PI / 2}
        scale={[5, 5, 1]}
      />
      <Lightformer
        intensity={FILL_LIGHT_INTENSITY}
        position={[6, 1, 4]}
        rotation-y={-Math.PI / 2}
        scale={[5, 5, 1]}
      />
    </Environment>
  );
}

function SceneContents({
  reduceMotion,
  ambient,
  portrait,
  view,
}: {
  reduceMotion: boolean;
  ambient: boolean;
  portrait: boolean;
  view: ViewConfig;
}) {
  const pointer = useWindowPointer();

  return (
    <>
      <color attach="background" args={["#050505"]} />
      <ambientLight intensity={0.15} />
      <Starfield reduceMotion={reduceMotion} factor={view.starFactor} />
      <Suspense fallback={null}>
        <ChromeEnvironment resolution={view.envRes} />
        {/* il logo Uranio: emblema + 6 lettere, ciascuno calciabile per conto
            suo. Il fit alla viewport è calcolato dentro UranioLogo (il logo è
            ~quadrato: entra bene sia in landscape che in portrait). Nessun
            remount sui resize → la fisica del calcio sopravvive */}
        <UranioLogo
          pointer={pointer}
          reduceMotion={reduceMotion}
          ambient={ambient}
          fov={view.fov}
          camZ={view.camZ}
          portrait={portrait}
        />
      </Suspense>
    </>
  );
}

interface BoundaryState {
  failed: boolean;
}

// Se WebGL non è disponibile la scena sparisce senza far crollare la pagina:
// restano sfondo nero, titolo e UI
class SceneErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function HeroScene({
  reduceMotion = false,
  active = true,
}: HeroSceneProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const portrait = useMediaQuery("(orientation: portrait)");
  // su touch niente calcio (il dito serve a scrollare): deriva ambientale
  const isTouch = useIsTouch();

  const view: ViewConfig = isMobile
    ? {
        fov: portrait ? 55 : 45,
        camZ: portrait ? 8.5 : 8,
        dpr: [1, 1.5],
        starFactor: 0.55,
        envRes: 128,
      }
    : isTablet || (isTouch && portrait)
      ? {
          // isTouch && portrait copre i tablet larghi ≥1024px (iPad Pro
          // 12.9"/13" in portrait) che sfuggirebbero al max-width: 1023;
          // su desktop col mouse isTouch è false → DESKTOP_VIEW intatto
          fov: portrait ? 52 : 45,
          camZ: portrait ? 8 : 7.5,
          dpr: [1, 2],
          starFactor: 0.8,
          envRes: 256,
        }
      : DESKTOP_VIEW;

  return (
    <SceneErrorBoundary>
      <Canvas
        dpr={view.dpr}
        camera={{
          fov: view.fov,
          position: [0, 0, view.camZ],
          near: 0.1,
          far: 90,
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          // ACES (default R3F): roll-off morbido delle alte luci → gli
          // highlight delle key light restano bianchi brillanti senza clippare
          // a bianco piatto, il corpo resta argento. Valore in heroParams.ts
          gl.toneMappingExposure = TONE_MAPPING_EXPOSURE;
        }}
        frameloop={reduceMotion ? "demand" : active ? "always" : "never"}
        // il touch verticale sul canvas deve scrollare la pagina
        style={{ touchAction: "pan-y" }}
      >
        <CameraConfig fov={view.fov} camZ={view.camZ} />
        <SceneContents
          reduceMotion={reduceMotion}
          ambient={isTouch}
          portrait={portrait}
          view={view}
        />
      </Canvas>
    </SceneErrorBoundary>
  );
}
