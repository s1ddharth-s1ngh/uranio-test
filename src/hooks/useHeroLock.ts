import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Scorrimento animato controllato da noi (non `scroll-behavior: smooth`): così
 * sappiamo ESATTAMENTE quando finisce, e possiamo ribloccare lo scroll solo a
 * animazione conclusa senza dipendere da `scrollend`, che Safari ha aggiunto
 * tardi.
 */
function animateScrollTo(y: number, ms: number, instant: boolean) {
  return new Promise<void>((resolve) => {
    const start = window.scrollY;
    const delta = y - start;
    if (instant || Math.abs(delta) < 1) {
      window.scrollTo(0, y);
      resolve();
      return;
    }
    const t0 = performance.now();
    // easeInOutCubic
    const ease = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, start + delta * ease(t));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

interface UseHeroLockArgs {
  /** attivo solo dove non esiste l'hover: il gesto serve al 3D, non allo scroll */
  enabled: boolean;
  /** id della sezione a cui porta il pulsante */
  targetId?: string;
  /** chiamata ogni volta che si torna nell'hero e lo scroll si riblocca */
  onRelock?: () => void;
}

/**
 * Sul touch la prima sezione non si scorre: il dito serve a spingere il logo.
 * Si scende solo col pulsante; risalendo, appena l'hero è scoperto per più
 * della metà la pagina si riaggancia da sola e il blocco torna attivo.
 */
export function useHeroLock({
  enabled,
  targetId = "about",
  onRelock,
}: UseHeroLockArgs) {
  // se la pagina viene ricaricata già scrollata, il browser ripristina la
  // posizione: bloccare lì dentro intrappolerebbe l'utente a metà pagina
  const [locked, setLocked] = useState(
    () => enabled && (typeof window === "undefined" || window.scrollY < 1),
  );
  // un'animazione di scroll è in corso: il guardiano non deve interferire
  const busy = useRef(false);
  // in un ref, così cambiare la callback non fa ri-registrare il guardiano
  const relockRef = useRef(onRelock);
  useEffect(() => {
    relockRef.current = onRelock;
  }, [onRelock]);

  // il blocco vero e proprio. Classe sull'<html> invece di stili inline: così
  // resta tutto in un posto solo e il cleanup non deve ricordare i valori
  // precedenti di overflow.
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.toggle("scroll-locked", locked);
    return () => root.classList.remove("scroll-locked");
  }, [enabled, locked]);

  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** il pulsante: sblocca e porta alla sezione successiva */
  const release = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLocked(false);
    // un frame perché React tolga la classe: con overflow:hidden ancora
    // applicato window.scrollTo non andrebbe da nessuna parte
    await new Promise((r) => requestAnimationFrame(r));
    const el = document.getElementById(targetId);
    const y = el
      ? el.getBoundingClientRect().top + window.scrollY
      : window.innerHeight;
    await animateScrollTo(y, 700, reduced());
    busy.current = false;
  }, [targetId]);

  /** guardiano del ritorno: hero scoperto per più di metà → riaggancia */
  useEffect(() => {
    if (!enabled || locked) return;
    const onScroll = () => {
      if (busy.current) return;
      if (window.scrollY >= window.innerHeight * 0.5) return;
      busy.current = true;
      animateScrollTo(0, 450, reduced()).then(() => {
        setLocked(true);
        busy.current = false;
        relockRef.current?.();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled, locked]);

  return { locked: enabled && locked, release };
}
