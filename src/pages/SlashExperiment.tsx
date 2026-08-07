import { useEffect } from "react";
import DropletField from "../components/DropletField/DropletField";
// import { PRESET_PUNCHY, PRESET_SUBTLE } from "../components/DropletField/dropletPhysics";
import styles from "./SlashExperiment.module.css";

// --- copy (edit freely) -------------------------------------------------------
const KICKER = "SLASH — EXPERIMENT LAB";
const TITLE_LINE_1 = "EXPERIMENTS";
const TITLE_LINE_2 = "OLTRE L'INTERFACCIA";
// Alternatives to try:
// const TITLE_LINE_2 = "DOVE LE IDEE PRENDONO FORMA";
// const TITLE_LINE_2 = "SENZA CONFINI";
// const TITLE_LINE_2 = "CAMPO DI PROVA";
const LABEL_LEFT = "PROTOTIPI / R&D";
const LABEL_RIGHT = "DAL 2025";

export default function SlashExperiment() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Slash — Experiment Lab";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <main>
      <section className={styles.hero}>
        {/* interactive droplet background; try params={PRESET_PUNCHY} */}
        <DropletField />
        <div className={styles.content}>
          <p className={styles.kicker}>{KICKER}</p>
          <h1 className={styles.title}>
            {TITLE_LINE_1}
            <br />
            {TITLE_LINE_2}
          </h1>
          <p className={`${styles.label} ${styles.labelLeft}`}>{LABEL_LEFT}</p>
          <p className={`${styles.label} ${styles.labelRight}`}>{LABEL_RIGHT}</p>
        </div>
      </section>
    </main>
  );
}
