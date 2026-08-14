import { Suspense, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useInView } from "framer-motion";
import { AboutBottle } from "./AboutBottle";
import { AboutStonks } from "./AboutStonks";
import { AboutCards } from "./AboutCards";
import type { CardsHandle } from "./AboutCards";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useIsTouch } from "../../hooks/useIsTouch";
import { useSectionProgress } from "./useSectionProgress";
import { ABOUT_CANVAS_LABEL, ABOUT_INTRO } from "./aboutContent";
import {
  CONFIG,
  applyDomPose,
  computeIntroPose,
  makeDomPose,
} from "./aboutTimeline";
import type { Breakpoint } from "./aboutTimeline";
import styles from "./AboutSection.module.css";

// pose riusate: gli overlay si aggiornano scrivendo su style, mai su state
const _introPose = makeDomPose();

export default function AboutSection() {
  const wrapper = useRef<HTMLElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const cards = useRef<CardsHandle>(null);

  const reduceMotion = usePrefersReducedMotion();
  // impilato (modello sopra, testo sotto): telefoni E tablet in portrait —
  // in portrait la colonna affiancata non ha mai abbastanza larghezza.
  // NB: stessa query del CSS in AboutSection.module.css, tenerle allineate
  const narrow = useMediaQuery(
    "(orientation: portrait) and (max-width: 1032px), (orientation: portrait) and (hover: none)",
  );
  // dpr ridotto su tutti gli schermi piccoli (anche telefoni in landscape)
  const smallScreen = useMediaQuery("(max-width: 1023px)");
  // Breakpoint della coreografia: governa pin distance, inquadratura, arco del
  // tappo e ampiezze (vedi CONFIG in aboutTimeline.ts). È separato da `narrow`,
  // che riguarda solo l'impaginazione degli stonks.
  const isPhone = useMediaQuery("(max-width: 767px)");
  const isTabletWidth = useMediaQuery(
    "(min-width: 768px) and (max-width: 1279px)",
  );
  const breakpoint: Breakpoint = isPhone
    ? "mobile"
    : isTabletWidth || narrow
      ? "tablet"
      : "desktop";
  // senza mouse non c'è un cursore da seguire: i modelli si muovono da soli
  const isTouch = useIsTouch();
  // pausa del rendering quando la sezione è fuori schermo (margine largo
  // così il canvas riparte un attimo prima di entrare in vista)
  const inView = useInView(wrapper, { margin: "300px 0px 300px 0px" });

  // Overlay in DOM guidati dallo stesso progresso del 3D: nessun re-render,
  // si scrive direttamente su style dentro il frame già programmato dallo
  // scroll (vedi useSectionProgress).
  const applyOverlays = useCallback(
    (p: number) => {
      if (reduceMotion) return;
      const el = intro.current;
      if (el) applyDomPose(el, computeIntroPose(p, _introPose));
      cards.current?.apply(p);
    },
    [reduceMotion],
  );
  // unica sorgente di verità del progresso: la leggono il canvas (ogni frame)
  // e gli overlay in DOM (a ogni scroll)
  const progress = useSectionProgress(wrapper, applyOverlays);

  // pin distance da CONFIG: unica fonte di verità, il CSS la legge da qui
  const pinVh = reduceMotion ? 100 : CONFIG[breakpoint].pinVh;

  return (
    <section
      ref={wrapper}
      id="about"
      className={`${styles.wrapper} ${reduceMotion ? styles.wrapperStatic : ""}`}
      style={{ "--pin": pinVh } as React.CSSProperties}
    >
      <div className={styles.sticky}>
        <div className={styles.canvas}>
          <Canvas
            camera={{ fov: 40, position: [0, 0, 6] }}
            dpr={[1, smallScreen ? 1.5 : 2]}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              // stesso tone mapping dell'hero (ACES di default + esposizione)
              gl.toneMappingExposure = 1.15;
            }}
            frameloop={reduceMotion ? "demand" : inView ? "always" : "never"}
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
              {/* cascata di stonks specchiati che scendono a sinistra */}
              <AboutStonks
                progress={progress}
                reduceMotion={reduceMotion}
                narrow={narrow}
                touch={isTouch}
              />
              {/* bottiglia e tappo: il cuore della narrazione */}
              <AboutBottle
                progress={progress}
                breakpoint={breakpoint}
                reduceMotion={reduceMotion}
                touch={isTouch}
              />
            </Suspense>
          </Canvas>
        </div>

        {/* Il canvas è decorativo: il racconto sta tutto in DOM, leggibile
            anche senza WebGL e senza animazioni. */}
        <p className={styles.srOnly}>{ABOUT_CANVAS_LABEL}</p>

        {/* dietro il canvas: attraversano lo schermo passando dietro la
            bottiglia, che resta il fulcro */}
        <AboutCards
          ref={cards}
          breakpoint={breakpoint}
          reduceMotion={reduceMotion}
        />

        <div ref={intro} className={styles.intro}>
          <h2 className={styles.title}>{ABOUT_INTRO.title}</h2>
          <p className={styles.subtitle}>{ABOUT_INTRO.subtitle}</p>
        </div>
      </div>
    </section>
  );
}
