import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import {
  motion,
  useInView,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import { AboutBottle } from "./AboutBottle";
import { AboutEye } from "./AboutEye";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useIsTouch } from "../../hooks/useIsTouch";
import styles from "./AboutSection.module.css";

// ✏️ Testi placeholder — sostituiscili con i contenuti reali
const TITLE = "Chi siamo";
const PARAGRAPH =
  "Siamo uno studio creativo indipendente specializzato in esperienze " +
  "immersive e realtà estesa. Uniamo design, tecnologia e narrazione per " +
  "costruire mondi digitali in cui le persone possono entrare, esplorare e " +
  "lasciare un segno. Dal concept al prodotto finale curiamo ogni dettaglio: " +
  "interazione, estetica, performance. Crediamo che la tecnologia migliore " +
  "sia quella che sparisce, lasciando spazio solo all'emozione di ciò che " +
  "si vive.";

export default function AboutSection() {
  const wrapper = useRef<HTMLDivElement>(null);
  const progress = useRef(0); // letto ogni frame dal canvas
  const reduceMotion = usePrefersReducedMotion();
  // impilato (modello sopra, testo sotto): telefoni E tablet in portrait —
  // in portrait la colonna affiancata non ha mai abbastanza larghezza;
  // in landscape resta l'affiancato con tipografia compatta.
  // NB: stessa query del CSS in AboutSection.module.css, tenerle allineate
  // il ramo (hover: none) copre i tablet larghi ≥1024px in portrait (iPad
  // Pro 12.9"/13"); un monitor desktop ruotato col mouse resta affiancato
  const narrow = useMediaQuery(
    "(orientation: portrait) and (max-width: 1032px), (orientation: portrait) and (hover: none)",
  );
  // dpr ridotto su tutti gli schermi piccoli (anche telefoni in landscape)
  const smallScreen = useMediaQuery("(max-width: 1023px)");
  // senza mouse l'occhio non ha un cursore da seguire → si muove da solo
  const isTouch = useIsTouch();
  // pausa del rendering quando la sezione è fuori schermo (margine largo
  // così il canvas riparte un attimo prima di entrare in vista)
  const inView = useInView(wrapper, { margin: "300px 0px 300px 0px" });

  const { scrollYProgress } = useScroll({
    target: wrapper,
    offset: ["start start", "end end"],
  });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    progress.current = v;
  });

  // testo: sale e appare (Transizione A), poi sale e scompare (Transizione B)
  // — intervalli allineati alle nuove fasi larghe della bottiglia
  const textY = useTransform(
    scrollYProgress,
    [0.14, 0.46, 0.6, 0.92],
    [90, 0, 0, -140],
  );
  const textOpacity = useTransform(
    scrollYProgress,
    [0.14, 0.36, 0.62, 0.88],
    [0, 1, 1, 0],
  );

  return (
    <section
      ref={wrapper}
      id="about"
      className={`${styles.wrapper} ${reduceMotion ? styles.wrapperStatic : ""}`}
    >
      <div className={styles.sticky}>
        <div className={styles.canvas} aria-hidden="true">
          <Canvas
            camera={{ fov: 40, position: [0, 0, 6] }}
            dpr={[1, smallScreen ? 1.5 : 2]}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              // stesso tone mapping dell'hero (ACES di default + esposizione)
              gl.toneMappingExposure = 1.15;
            }}
            frameloop={
              reduceMotion ? "demand" : inView ? "always" : "never"
            }
          >
            <ambientLight intensity={0.25} />
            <directionalLight position={[3, 4, 2]} intensity={2} />
            <Suspense fallback={null}>
              {/* environment procedurale (niente HDR da rete), solo per i
                  riflessi: lo sfondo resta il nero della pagina */}
              <Environment resolution={128} frames={1}>
                <color attach="background" args={["#15151a"]} />
                <Lightformer
                  intensity={4}
                  position={[0, 5, 3]}
                  rotation-x={Math.PI / 2}
                  scale={[8, 4, 1]}
                />
                <Lightformer
                  intensity={1.5}
                  position={[0, 0.5, 7]}
                  scale={[12, 4, 1]}
                />
                <Lightformer
                  intensity={1.2}
                  position={[-6, 1, 2]}
                  rotation-y={Math.PI / 2}
                  scale={[5, 3, 1]}
                />
              </Environment>
              {/* piramide centrale che guida lo scrollytelling */}
              <AboutBottle
                progress={progress}
                reduceMotion={reduceMotion}
                narrow={narrow}
                touch={isTouch}
              />
              {/* occhio 3D fisso in basso a destra, segue il cursore */}
              <AboutEye
                reduceMotion={reduceMotion}
                narrow={narrow}
                touch={isTouch}
              />
            </Suspense>
          </Canvas>
        </div>

        {/* centraggio sul contenitore esterno; y/opacity di Framer sul div
            interno: nessun conflitto di transform */}
        <div className={styles.textCol}>
          {reduceMotion ? (
            <div className={styles.text}>
              <h2>{TITLE}</h2>
              <p>{PARAGRAPH}</p>
            </div>
          ) : (
            <motion.div
              className={styles.text}
              style={{ y: textY, opacity: textOpacity }}
            >
              <h2>{TITLE}</h2>
              <p>{PARAGRAPH}</p>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
}
