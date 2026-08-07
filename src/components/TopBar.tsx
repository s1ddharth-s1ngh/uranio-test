import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMediaQuery } from "../hooks/useMediaQuery";
import styles from "./TopBar.module.css";

interface TopBarProps {
  revealed: boolean;
}

// ✏️ Voci di menu — aggiorna gli href quando le sezioni saranno pronte
const NAV_ITEMS = [
  { href: "#about", it: "Chi siamo", en: "About us" },
  { href: "#crisi-economica", it: "Crisi economica", en: "Economic crisis" },
  { href: "#servizi", it: "Servizi", en: "Services" },
  { href: "/slash-experiment", it: "Esperimenti", en: "Experiments" },
  { href: "#contatti", it: "Contatti", en: "Contacts" },
];

function NavLinks({
  lang,
  className,
  onNavigate,
}: {
  lang: "it" | "en";
  className: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV_ITEMS.map((item) =>
        item.href.startsWith("/") ? (
          <Link
            key={item.href}
            to={item.href}
            className={className}
            onClick={onNavigate}
          >
            {lang === "en" ? item.en : item.it}
          </Link>
        ) : (
          <a
            key={item.href}
            href={item.href}
            className={className}
            onClick={onNavigate}
          >
            {lang === "en" ? item.en : item.it}
          </a>
        ),
      )}
    </>
  );
}

function LangSwitch({ lang, label }: { lang: "it" | "en"; label: string }) {
  return (
    <nav className={styles.lang} aria-label={label}>
      <Link
        to="/it"
        className={lang === "it" ? styles.active : styles.idle}
        aria-current={lang === "it" ? "true" : undefined}
      >
        it
      </Link>
      <span className={styles.sep} aria-hidden="true">
        /
      </span>
      <Link
        to="/en"
        className={lang === "en" ? styles.active : styles.idle}
        aria-current={lang === "en" ? "true" : undefined}
      >
        en
      </Link>
    </nav>
  );
}

export default function TopBar({ revealed }: TopBarProps) {
  const { pathname } = useLocation();
  const lang = pathname.startsWith("/en") ? "en" : "it";

  // sotto 861px la nav inline è nascosta → menu hamburger con overlay
  const collapsed = useMediaQuery("(max-width: 860px)");
  const [open, setOpen] = useState(false);
  // l'overlay esiste solo nel layout collapsed: derivarlo evita che un
  // `open` residuo riapra il menu al prossimo restringimento
  const menuOpen = open && collapsed;
  const burgerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLDivElement>(null);

  // reset di `open` all'uscita dal layout collapsed: STESSA query di
  // `collapsed` negata nel callback (due query complementari, es.
  // min-width: 861px, lasciano un gap ai DPR frazionari: 860.4px non
  // matcherebbe nessuna delle due)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 860px)");
    const onChange = () => {
      if (!mql.matches) setOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    // scroll lock sul root: html ha overflow-x: clip (index.css), quindi
    // l'overflow di body non si propaga più al viewport — bloccare solo
    // body non fermerebbe lo scroll
    const root = document.documentElement;
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    // Esc chiude e restituisce il focus al bottone
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        burgerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    // focus sul primo link del menu (dopo che visibility è scattata)
    const raf = requestAnimationFrame(() => {
      firstLinkRef.current
        ?.querySelector<HTMLElement>("a")
        ?.focus({ preventScroll: true });
    });

    return () => {
      root.style.overflow = prevRootOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [menuOpen]);

  const close = () => setOpen(false);

  return (
    <header className={`${styles.topbar} ${revealed ? styles.revealed : ""}`}>
      {/* overlay mobile: position fixed (fuori dal flex), z-index negativo
          nello stacking context dell'header → logo/lingua/burger restano
          visibili e cliccabili sopra di esso */}
      {collapsed && (
        <div
          id="mobile-menu"
          className={`${styles.overlay} ${menuOpen ? styles.overlayOpen : ""}`}
          aria-hidden={!menuOpen}
          onClick={(e) => {
            // tap sullo sfondo (non su un link) → chiude
            if (e.target === e.currentTarget) close();
          }}
        >
          <nav
            ref={firstLinkRef}
            className={styles.overlayNav}
            aria-label={lang === "en" ? "Main menu" : "Menu principale"}
          >
            <NavLinks
              lang={lang}
              className={styles.overlayLink}
              onNavigate={close}
            />
          </nav>
          <div className={styles.overlayLang}>
            <LangSwitch
              lang={lang}
              label={lang === "en" ? "Language" : "Lingua"}
            />
          </div>
        </div>
      )}

      <Link to="/" className={styles.logo} onClick={close}>
        uranio<span className={styles.dot}>.</span>
      </Link>

      <nav
        className={styles.nav}
        aria-label={lang === "en" ? "Main menu" : "Menu principale"}
      >
        <NavLinks lang={lang} className={styles.navLink} />
      </nav>

      <div className={styles.right}>
        <LangSwitch lang={lang} label={lang === "en" ? "Language" : "Lingua"} />

        <button
          ref={burgerRef}
          type="button"
          className={`${styles.burger} ${menuOpen ? styles.burgerOpen : ""}`}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={
            menuOpen
              ? lang === "en"
                ? "Close menu"
                : "Chiudi menu"
              : lang === "en"
                ? "Open menu"
                : "Apri menu"
          }
          onClick={() => setOpen(!menuOpen)}
        >
          <span className={styles.burgerBox} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      </div>
    </header>
  );
}
