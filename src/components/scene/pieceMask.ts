import * as THREE from "three";

// MASCHERA DI SILHOUETTE — il test di contatto cursore/pezzo.
//
// Perché non un raycast: le geometrie del logo sono SVG estrusi pesanti (86k
// triangoli in tutto, 26k solo l'emblema). Un `Raycaster.intersectObject`
// costa ~1.4ms per raggio sull'emblema: con qualche raggio a frame si mangia
// mezzo budget dei 16.7ms. Qui invece la sagoma di ogni pezzo viene
// rasterizzata UNA volta in una bitmap, e il test a runtime è una lettura in
// un array — O(1).
//
// I pezzi sono lastre estruse quasi frontali alla camera: la loro proiezione
// sul piano XY locale È la sagoma che si vede. Il raggio del cursore viene
// portato nello spazio locale del pezzo e intersecato col piano mediano z=0.

export interface PieceMask {
  res: number; // celle per lato (griglia quadrata)
  min: THREE.Vector2; // angolo in basso a sinistra, in unità locali
  cell: number; // lato di una cella, in unità locali
  data: Uint8Array; // res*res, 1 = pieno
  // z locale della faccia FRONTALE: è il piano su cui si interseca il raggio
  // del cursore. I pezzi sono spessi (~0.69) e bombati: intersecare il piano
  // mediano z=0 sbagliava di qualche pixel vicino ai bordi.
  zFront: number;
}

/**
 * Rasterizza la proiezione XY dei triangoli nella bitmap.
 * `center` è il baricentro sottratto alle mesh (le coordinate locali del pezzo
 * sono coordinateGeometria - center).
 */
export function buildPieceMask(
  geos: THREE.BufferGeometry[],
  center: THREE.Vector3,
  box: THREE.Box3,
  targetCell: number,
): PieceMask {
  const pad = targetCell * 2;
  const minX = box.min.x - center.x - pad;
  const minY = box.min.y - center.y - pad;
  const span =
    Math.max(box.max.x - box.min.x, box.max.y - box.min.y) + 2 * pad;
  const res = Math.min(320, Math.max(48, Math.ceil(span / targetCell)));
  const cell = span / res;
  const data = new Uint8Array(res * res);

  const ax = new Float64Array(3);
  const ay = new Float64Array(3);

  for (const g of geos) {
    const pos = g.getAttribute("position");
    const index = g.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
        ax[k] = (pos.getX(vi) - center.x - minX) / cell;
        ay[k] = (pos.getY(vi) - center.y - minY) / cell;
      }
      let x0 = Math.floor(Math.min(ax[0], ax[1], ax[2]));
      let x1 = Math.floor(Math.max(ax[0], ax[1], ax[2]));
      let y0 = Math.floor(Math.min(ay[0], ay[1], ay[2]));
      let y1 = Math.floor(Math.max(ay[0], ay[1], ay[2]));
      if (x1 < 0 || y1 < 0 || x0 >= res || y0 >= res) continue;
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;
      if (x1 >= res) x1 = res - 1;
      if (y1 >= res) y1 = res - 1;

      // triangolo minuscolo (il caso normale su queste mesh dense): riempire
      // il suo bounding box costa meno del test baricentrico ed è conservativo
      if (x1 - x0 <= 2 && y1 - y0 <= 2) {
        for (let y = y0; y <= y1; y++) {
          const row = y * res;
          for (let x = x0; x <= x1; x++) data[row + x] = 1;
        }
        continue;
      }

      // triangolo grande: test baricentrico sul centro di ogni cella, così non
      // si riempiono i vuoti (i buchi di R, A, O e del bicchiere)
      const d =
        (ay[1] - ay[2]) * (ax[0] - ax[2]) + (ax[2] - ax[1]) * (ay[0] - ay[2]);
      if (Math.abs(d) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        const row = y * res;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const l0 =
            ((ay[1] - ay[2]) * (px - ax[2]) + (ax[2] - ax[1]) * (py - ay[2])) /
            d;
          const l1 =
            ((ay[2] - ay[0]) * (px - ax[2]) + (ax[0] - ax[2]) * (py - ay[2])) /
            d;
          const l2 = 1 - l0 - l1;
          if (l0 >= -0.02 && l1 >= -0.02 && l2 >= -0.02) data[row + x] = 1;
        }
      }
    }
  }

  // dilatazione di 1 cella: chiude gli spilli lasciati dai triangoli a scheggia
  // delle pareti di estrusione, senza gonfiare la sagoma in modo percepibile
  const dil = new Uint8Array(data);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      if (!data[y * res + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= res) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= res) continue;
          dil[yy * res + xx] = 1;
        }
      }
    }
  }

  return {
    res,
    min: new THREE.Vector2(minX, minY),
    cell,
    data: dil,
    zFront: box.max.z - center.z,
  };
}

/**
 * Il punto locale (x,y) tocca la sagoma? `radius` è la tolleranza in unità
 * locali (il "pennello" attorno al cursore).
 */
export function maskHit(
  m: PieceMask,
  x: number,
  y: number,
  radius: number,
): boolean {
  const gx = (x - m.min.x) / m.cell;
  const gy = (y - m.min.y) / m.cell;
  const rc = Math.min(8, Math.max(0, Math.round(radius / m.cell)));
  let x0 = Math.floor(gx) - rc;
  let x1 = Math.floor(gx) + rc;
  let y0 = Math.floor(gy) - rc;
  let y1 = Math.floor(gy) + rc;
  if (x1 < 0 || y1 < 0 || x0 >= m.res || y0 >= m.res) return false;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 >= m.res) x1 = m.res - 1;
  if (y1 >= m.res) y1 = m.res - 1;
  const r2 = (rc + 0.5) * (rc + 0.5);
  for (let y = y0; y <= y1; y++) {
    const row = y * m.res;
    const dy = y + 0.5 - gy;
    for (let x = x0; x <= x1; x++) {
      if (!m.data[row + x]) continue;
      const dx = x + 0.5 - gx;
      if (dx * dx + dy * dy <= r2) return true;
    }
  }
  return false;
}
