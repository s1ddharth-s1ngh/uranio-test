// Store minimale e senza dipendenze per il progresso di caricamento degli
// asset 3D. Il Loader (bundle principale) legge da qui; è la scena (chunk
// lazy, dove vivono three/drei) a scrivere. Così three non finisce nel
// bundle principale solo per mostrare una percentuale.

export interface AssetProgress {
  progress: number; // 0..100
  active: boolean; // c'è un caricamento in corso
  // false finché il chunk della scena non ha ancora scritto nulla: distingue
  // "nessun dato" (chunk in download) da "tutto caricato"
  reported: boolean;
}

let state: AssetProgress = { progress: 0, active: false, reported: false };

export function setAssetProgress(
  next: Omit<AssetProgress, "reported">,
): void {
  state = { ...next, reported: true };
}

export function getAssetProgress(): AssetProgress {
  return state;
}
