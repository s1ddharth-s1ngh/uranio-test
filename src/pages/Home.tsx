import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useInView } from "framer-motion";
import Loader from "../components/Loader";
import TopBar from "../components/TopBar";
import InteractiveText from "../components/InteractiveText";
import InvertCursor from "../components/InvertCursor";
import ScrollPill from "../components/ui/ScrollPill";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import styles from "./Home.module.css";

// Le scene WebGL (three + R3F) vivono in chunk separati: la home shell e
// /coming-soon restano leggere; il Loader copre l'attesa di chunk + GLB
const HeroScene = lazy(() => import("../components/scene/HeroScene"));
const AboutSection = lazy(() => import("../components/about/AboutSection"));

// ✏️ Testi placeholder — sostituiscili qui con i contenuti reali
const HERO_TITLE = "ATOMIC BEER";
const PILL_LABEL = "Scorri in basso";

export default function Home() {
  const [revealed, setRevealed] = useState(false);
  const reduceMotion = usePrefersReducedMotion();
  const { pathname } = useLocation();

  // pausa del canvas hero quando è scrollato fuori vista
  const heroRef = useRef<HTMLElement>(null);
  const heroInView = useInView(heroRef, { margin: "200px 0px 200px 0px" });

  useEffect(() => {
    document.documentElement.lang = pathname.startsWith("/en") ? "en" : "it";
  }, [pathname]);

  return (
    <div className={styles.page}>
      <Loader onRevealStart={() => setRevealed(true)} />
      <TopBar revealed={revealed} />
      {/* soglia unica pill/cursore: INVERT_TRIGGER in InvertCursor.tsx */}
      <InvertCursor sectionId="about" />

      <main>
        {/* HERO: sezione alta 100vh che scorre via normalmente */}
        <section ref={heroRef} id="hero" className={styles.hero}>
          <div
            className={`${styles.scene} ${revealed ? styles.sceneRevealed : ""}`}
            aria-hidden="true"
          >
            <Suspense fallback={null}>
              <HeroScene reduceMotion={reduceMotion} active={heroInView} />
            </Suspense>
          </div>

          <div className={styles.overlay}>
            <h1
              className={`${styles.title} ${revealed ? styles.titleRevealed : ""}`}
            >
              <InteractiveText
                text={HERO_TITLE}
                radius={90}
                strength={12}
                maxRotation={5}
              />
            </h1>
          </div>

          <ScrollPill label={PILL_LABEL} revealed={revealed} />
        </section>

        {/* CHI SIAMO: scrollytelling con canvas pinnato */}
        <Suspense fallback={null}>
          <AboutSection />
        </Suspense>
      </main>
    </div>
  );
}
