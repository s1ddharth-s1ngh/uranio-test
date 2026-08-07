import { useSyncExternalStore } from "react";

// hover: none = il device NON ha un puntatore che può stare fermo su un
// elemento (touch puro); pointer: coarse copre i touch screen con mouse
// collegabile. Insieme intercettano tutti i casi "si naviga col dito"
const QUERY = "(hover: none), (pointer: coarse)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsTouch(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
  );
}
