import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { useInView } from "framer-motion";
import Loader from "../components/Loader";
import TopBar from "../components/TopBar";
import InteractiveText from "../components/InteractiveText";
import InvertCursor from "../components/InvertCursor";
import ScrollPill from "../components/ui/ScrollPill";
import HeroLock from "../components/ui/HeroLock";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useIsTouch } from "../hooks/useIsTouch";
import { useHeroLock } from "../hooks/useHeroLock";
import { HERO_OVERLAP, transitionAt } from "../lib/heroTransition";
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

  // TRANSIZIONE HERO → "CHI SIAMO" (vedi lib/heroTransition.ts). Scritta a
  // mano invece che con useScroll+useTransform di Framer: quelli si appoggiano
  // a una misurazione dell'elemento fatta in un effect, e col doppio
  // mount/unmount di StrictMode restavano agganciati a misure fantasma —
  // le due sezioni svanivano insieme a metà pagina. Qui la sorgente è
  // scrollY/innerHeight, letta al momento: niente stato, niente misure.
  const aboutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hero = heroRef.current;
    const about = aboutRef.current;
    if (!hero || !about) return;
    if (reduceMotion) {
      hero.style.opacity = "";
      hero.style.pointerEvents = "";
      about.style.opacity = "";
      return;
    }

    let raf = 0;
    const apply = () => {
      raf = 0;
      const { hero: h, about: a } = transitionAt(
        window.scrollY,
        window.innerHeight,
      );
      hero.style.opacity = h.toFixed(4);
      // svanito = trasparente ai click: la sua ultima striscia (invisibile ma
      // sopra per z-index) ruberebbe il puntatore al canvas della sezione 2
      hero.style.pointerEvents = h < 0.01 ? "none" : "auto";
      about.style.opacity = a.toFixed(4);
    };
    // un frame per scroll: la lettura di scrollY è sempre quella corrente,
    // quindi non si accumula ritardo nemmeno con lo scroll a raffica
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      hero.style.opacity = "";
      hero.style.pointerEvents = "";
      about.style.opacity = "";
    };
  }, [reduceMotion]);

  // Senza hover il gesto del dito non può essere insieme scroll e interazione:
  // nella prima sezione lo scroll è bloccato e il dito pilota il logo 3D, si
  // scende solo col pulsante. Risalendo, la pagina si riaggancia da sola.
  const isTouch = useIsTouch();
  // l'avviso compare solo tornando indietro: al primo caricamento la freccia
  // parla da sola, spiegare il blocco prima che l'utente ci sbatta è rumore
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(0);
  const onRelock = useCallback(() => {
    setHint(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(false), 4200);
  }, []);
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  const { locked, release } = useHeroLock({ enabled: isTouch, onRelock });

  useEffect(() => {
    document.documentElement.lang = pathname.startsWith("/en") ? "en" : "it";
  }, [pathname]);

  return (
    <div
      className={styles.page}
      style={
        {
          // sovrapposizione tra le due sezioni: la consuma il margine
          // negativo dell'hero (Home.module.css). Con reduced-motion le
          // sezioni restano separate, senza dissolvenze da nascondere
          "--hero-overlap": reduceMotion ? "0px" : `${HERO_OVERLAP * 100}svh`,
        } as CSSProperties
      }
    >
      <Loader onRevealStart={() => setRevealed(true)} />
      <TopBar revealed={revealed} />
      {/* soglia unica pill/cursore: INVERT_TRIGGER in InvertCursor.tsx */}
      <InvertCursor sectionId="about" />

      <main>
        {/* HERO: alta 100vh, ma ne consuma solo (1 - HERO_OVERLAP) di scroll:
            svanisce mentre la sezione sotto sale e prende posizione */}
        <section
          ref={heroRef}
          id="hero"
          className={`${styles.hero} ${locked ? styles.heroLocked : ""}`}
        >
          <div
            className={`${styles.scene} ${revealed ? styles.sceneRevealed : ""}`}
            aria-hidden="true"
          >
            <Suspense fallback={null}>
              <HeroScene
                reduceMotion={reduceMotion}
                active={heroInView}
                lockGestures={locked}
              />
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

          {/* col mouse: la pill insegue il cursore. Col dito: un pulsante fisso,
              perché non esiste un cursore da inseguire e lo scroll è bloccato */}
          {isTouch ? null : (
            <ScrollPill label={PILL_LABEL} revealed={revealed} />
          )}
        </section>

        {/* CHI SIAMO: scrollytelling con canvas pinnato. Sale di HERO_OVERLAP
            sotto l'hero, quindi si aggancia in cima prima che l'hero finisca;
            la dissolvenza in entrata evita che da fermi faccia capolino */}
        <div ref={aboutRef}>
          <Suspense fallback={null}>
            <AboutSection />
          </Suspense>
        </div>
      </main>

      {isTouch && (
        <HeroLock
          locked={locked}
          hint={hint}
          revealed={revealed}
          onRelease={release}
        />
      )}
    </div>
  );
}
