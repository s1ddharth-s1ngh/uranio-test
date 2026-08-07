// Physics + tuning for the DropletField metaball hero.
// All units are CSS pixels / seconds; scaling to device pixels happens only
// at uniform upload time in DropletField.tsx.

export type BlobKind = "cursor" | "cluster" | "ambient";

export interface DropletBlob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rendered radius (animated — the cursor blob fades in/out through this). */
  r: number;
  /** Target radius after viewport scaling. */
  baseR: number;
  kind: BlobKind;
  /** Cluster sub-drops only: true while still attached to the cluster. */
  bound: boolean;
  /**
   * kind 'cluster': offset (px) from the cluster centre.
   * kind 'ambient': anchor position as viewport fractions (0..1, y from bottom).
   */
  home: { x: number; y: number };
  /** De-syncs each drop's idle drift. */
  phase: number;
}

export interface CursorState {
  /** Pointer target, bottom-left origin CSS px. */
  tx: number;
  ty: number;
  /** False when the pointer left the window: the cursor blob fades out. */
  active: boolean;
  /** Set on (re)activation so the blob teleports instead of streaking. */
  snap: boolean;
  /** Smoothed cursor speed, px/s (drives the breakup). */
  speed: number;
}

export interface ClusterState {
  cx: number;
  cy: number;
  t: number;
  /** Seconds of calm cursor since the last breakup — drives re-clustering. */
  quietFor: number;
}

export interface DropletParams {
  // ---- look -------------------------------------------------------------
  bg: string;
  drop: string;
  highlight: string;
  lightDir: [number, number, number];
  threshold: number;
  edge: number;
  /** z of the fake normal: lower = flatter drops, higher = more domed. */
  normalZ: number;
  /** Specular exponent: 24–40 = small glassy dot, lower = soft sheen. */
  specPower: number;
  /** Broad white sheen on the lit side (0 = off). */
  sheen: number;
  /** Darkening of the drop rim (0 = off, ~0.35 = visible dark edge). */
  rimDark: number;
  pixelation: "off" | "soft" | "strong";
  /** Blocky background grain amplitude (0 = off; keep ≤ 0.08 for a clean bg). */
  grain: number;
  // ---- blob layout (fractions of viewport / CSS px) ----------------------
  cursorRadius: number;
  clusterStart: { x: number; y: number };
  clusterDrops: { dx: number; dy: number; r: number }[];
  ambientDrops: { x: number; y: number; r: number }[];
  /** Visual radius of the whole cluster, used for break proximity. */
  clusterRadius: number;
  // ---- physics ------------------------------------------------------------
  attractRadius: number;
  attractPull: number;
  breakSpeed: number;
  breakMargin: number;
  breakImpulse: number;
  springK: number;
  damping: number;
  driftAmp: number;
  mergeRadius: number;
  mergePull: number;
  softPush: number;
  /** Weak spring pulling ambient drops back to their anchor. */
  ambientAnchorK: number;
  /** Seconds of calm before free sub-drops re-form the cluster. */
  reclusterDelay: number;
  /** Gentle homing of free sub-drops towards their cluster slot while calm. */
  reclusterPull: number;
  dprMax: number;
}

export const DEFAULT_PARAMS: DropletParams = {
  bg: "#F0F0F0", // switch to #FFFFFF for a pure white hero
  drop: "#2C2C2C",
  highlight: "#FFFFFF",
  lightDir: [-0.4, 0.6, 0.7],
  threshold: 1.0,
  edge: 0.12,
  normalZ: 0.65,
  specPower: 26,
  sheen: 0.26,
  rimDark: 0.35,
  pixelation: "soft",
  grain: 0.022,

  cursorRadius: 55,
  clusterStart: { x: 0.42, y: 0.55 },
  clusterDrops: [
    { dx: -70, dy: 28, r: 95 },
    { dx: 62, dy: 52, r: 82 },
    { dx: -4, dy: -62, r: 74 },
  ],
  ambientDrops: [
    { x: 0.14, y: 0.78, r: 62 },
    { x: 0.86, y: 0.34, r: 76 },
  ],
  clusterRadius: 160,

  attractRadius: 320,
  attractPull: 0.03,
  breakSpeed: 1100,
  breakMargin: 40,
  breakImpulse: 600,
  springK: 0.06,
  damping: 0.9,
  driftAmp: 30,
  mergeRadius: 180,
  mergePull: 0.08,
  softPush: 1.0,
  ambientAnchorK: 0.008,
  reclusterDelay: 4,
  reclusterPull: 0.006,
  dprMax: 2,
};

/** Barely moves, hard to break — for a calmer hero. */
export const PRESET_SUBTLE: Partial<DropletParams> = {
  driftAmp: 14,
  attractPull: 0.015,
  breakSpeed: 1600,
  breakImpulse: 420,
  mergePull: 0.05,
};

/** Breaks easily and violently — for a showy demo. */
export const PRESET_PUNCHY: Partial<DropletParams> = {
  driftAmp: 45,
  attractPull: 0.05,
  breakSpeed: 750,
  breakImpulse: 950,
  mergePull: 0.12,
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** Shrink drops on narrow viewports so the cluster fits a phone screen. */
export function radiusScale(w: number): number {
  return clamp(w / 1280, 0.55, 1);
}

export function createBlobs(
  P: DropletParams,
  W: number,
  H: number,
): DropletBlob[] {
  const s = radiusScale(W);
  const blobs: DropletBlob[] = [
    {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      r: 0, // fades in on the first pointer move
      baseR: P.cursorRadius * s,
      kind: "cursor",
      bound: false,
      home: { x: 0, y: 0 },
      phase: 0,
    },
  ];
  P.clusterDrops.forEach((d, i) =>
    blobs.push({
      x: W * P.clusterStart.x + d.dx * s,
      y: H * P.clusterStart.y + d.dy * s,
      vx: 0,
      vy: 0,
      r: d.r * s,
      baseR: d.r * s,
      kind: "cluster",
      bound: true,
      home: { x: d.dx * s, y: d.dy * s },
      phase: i * 2.39,
    }),
  );
  P.ambientDrops.forEach((a, i) =>
    blobs.push({
      x: W * a.x,
      y: H * a.y,
      vx: 0,
      vy: 0,
      r: a.r * s,
      baseR: a.r * s,
      kind: "ambient",
      bound: false,
      home: { x: a.x, y: a.y },
      phase: 1.31 + i * 3.07,
    }),
  );
  return blobs;
}

export function createCluster(
  P: DropletParams,
  W: number,
  H: number,
): ClusterState {
  return { cx: W * P.clusterStart.x, cy: H * P.clusterStart.y, t: 0, quietFor: 0 };
}

export function createCursor(W: number, H: number): CursorState {
  return { tx: W / 2, ty: H / 2, active: false, snap: false, speed: 0 };
}

const VMAX = 3500; // px/s safety cap

export function stepDroplets(
  dt: number,
  blobs: DropletBlob[],
  cursor: CursorState,
  cluster: ClusterState,
  P: DropletParams,
  W: number,
  H: number,
): void {
  // Per-frame gains in the tuning table assume 60fps; f keeps the feel
  // consistent at other refresh rates (dt is already clamped to ≤ 1/30).
  const f = Math.min(dt * 60, 2);

  // --- cursor blob follows the pointer ------------------------------------
  const c = blobs[0];
  if (cursor.snap) {
    c.x = cursor.tx;
    c.y = cursor.ty;
    cursor.snap = false;
    cursor.speed = 0;
  } else {
    const px = c.x;
    const py = c.y;
    const follow = 1 - Math.pow(0.8, f); // ≈ 0.2 per frame @60fps
    c.x += (cursor.tx - c.x) * follow;
    c.y += (cursor.ty - c.y) * follow;
    cursor.speed = Math.hypot(c.x - px, c.y - py) / dt;
  }
  // Fade the cursor blob in/out with pointer presence.
  const rTarget = cursor.active ? c.baseR : 0;
  c.r += (rTarget - c.r) * (1 - Math.pow(0.88, f));
  if (!cursor.active) {
    // gently park the (invisible) blob towards the centre
    cursor.tx += (W / 2 - cursor.tx) * 0.01 * f;
    cursor.ty += (H / 2 - cursor.ty) * 0.01 * f;
  }

  // --- slow autonomous drift of the cluster --------------------------------
  cluster.t += dt;
  cluster.cx +=
    (Math.sin(cluster.t * 0.13) + 0.5 * Math.sin(cluster.t * 0.31 + 1.7)) *
    P.driftAmp *
    dt;
  cluster.cy +=
    (Math.cos(cluster.t * 0.11) + 0.5 * Math.sin(cluster.t * 0.23 + 0.4)) *
    P.driftAmp *
    dt;
  // soft recall so the drift never walks the cluster off screen
  cluster.cx += (W * 0.45 - cluster.cx) * 0.002 * f;
  cluster.cy += (H * 0.52 - cluster.cy) * 0.002 * f;

  const anyBound = blobs.some((b) => b.kind === "cluster" && b.bound);

  if (cursor.active) {
    // --- gentle attraction of the cluster towards the cursor ---------------
    const dcx = c.x - cluster.cx;
    const dcy = c.y - cluster.cy;
    const dCluster = Math.hypot(dcx, dcy);
    if (dCluster < P.attractRadius) {
      cluster.cx += dcx * P.attractPull * f;
      cluster.cy += dcy * P.attractPull * f;
    }

    // --- velocity breakup ----------------------------------------------------
    const near = dCluster < P.clusterRadius + P.breakMargin;
    if (near && anyBound && cursor.speed > P.breakSpeed) {
      const imp = P.breakImpulse * Math.min(cursor.speed / P.breakSpeed, 2.5);
      for (const b of blobs) {
        if (b.kind === "cluster" && b.bound) {
          b.bound = false;
          const ax = b.x - c.x;
          const ay = b.y - c.y;
          const len = Math.hypot(ax, ay) || 1;
          b.vx += (ax / len) * imp + (Math.random() - 0.5) * imp * 0.4;
          b.vy += (ay / len) * imp + (Math.random() - 0.5) * imp * 0.4;
        }
      }
      cluster.quietFor = 0;
    }
  }

  // --- springs (bound), merge pull + anchors (free) --------------------------
  for (const b of blobs) {
    if (b.kind === "cursor") continue;
    if (b.kind === "cluster" && b.bound) {
      b.vx += (cluster.cx + b.home.x - b.x) * P.springK * f;
      b.vy += (cluster.cy + b.home.y - b.y) * P.springK * f;
    } else {
      if (cursor.active) {
        const dx = c.x - b.x;
        const dy = c.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < P.mergeRadius) {
          const pull = P.mergePull * (1 - d / P.mergeRadius) * f;
          b.vx += dx * pull;
          b.vy += dy * pull;
        }
      }
      if (b.kind === "ambient") {
        // weak anchor + tiny idle sway so ambient drops float at the sides
        const ax = b.home.x * W + Math.sin(cluster.t * 0.17 + b.phase) * 14;
        const ay = b.home.y * H + Math.cos(cluster.t * 0.14 + b.phase) * 12;
        b.vx += (ax - b.x) * P.ambientAnchorK * f;
        b.vy += (ay - b.y) * P.ambientAnchorK * f;
      } else if (cluster.quietFor > P.reclusterDelay) {
        // calm spell: free sub-drops drift gently home; they are re-bound
        // only once close, so the spring never yanks them across the screen
        b.vx += (cluster.cx + b.home.x - b.x) * P.reclusterPull * f;
        b.vy += (cluster.cy + b.home.y - b.y) * P.reclusterPull * f;
      }
    }
  }

  // --- re-clustering after a calm spell --------------------------------------
  const anyFree = blobs.some((b) => b.kind === "cluster" && !b.bound);
  if (anyFree) {
    cluster.quietFor = cursor.speed < 120 ? cluster.quietFor + dt : 0;
    if (cluster.quietFor > P.reclusterDelay) {
      const candidates = blobs.filter(
        (b) =>
          b.kind === "cluster" &&
          !b.bound &&
          (!cursor.active ||
            Math.hypot(c.x - b.x, c.y - b.y) > P.mergeRadius * 0.7),
      );
      if (candidates.length && !anyBound) {
        // move the (empty) cluster centre onto the free drops so homing and
        // springs reel them in gently instead of yanking them across screen
        let sx = 0;
        let sy = 0;
        for (const b of candidates) {
          sx += b.x - b.home.x;
          sy += b.y - b.home.y;
        }
        cluster.cx = sx / candidates.length;
        cluster.cy = sy / candidates.length;
      }
      for (const b of candidates) {
        // re-bind only once the drop is near its slot (no cross-screen glide;
        // until then the reclusterPull homing above walks it home slowly)
        if (
          Math.hypot(cluster.cx + b.home.x - b.x, cluster.cy + b.home.y - b.y) <
          300
        ) {
          b.bound = true;
        }
      }
      // quietFor keeps accumulating so latecomers keep homing; it resets on
      // fast cursor movement or the next breakup.
    }
  }

  // --- soft pairwise collision (keeps drops readable until the field fuses them)
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i];
      const d = blobs[j];
      if (a.r < 1 || d.r < 1) continue;
      const dx = d.x - a.x;
      const dy = d.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const min = (a.r + d.r) * 0.8;
      if (dist < min) {
        const push = ((min - dist) / dist) * 0.5 * P.softPush;
        // the cursor blob is position-driven: push only the other one
        if (a.kind === "cursor") {
          d.x += dx * push * 2;
          d.y += dy * push * 2;
        } else if (d.kind === "cursor") {
          a.x -= dx * push * 2;
          a.y -= dy * push * 2;
        } else {
          a.x -= dx * push;
          a.y -= dy * push;
          d.x += dx * push;
          d.y += dy * push;
        }
      }
    }
  }

  // --- integrate + soft containment ------------------------------------------
  const damp = Math.pow(P.damping, f);
  for (const b of blobs) {
    if (b.kind === "cursor") continue;
    b.vx *= damp;
    b.vy *= damp;
    const v = Math.hypot(b.vx, b.vy);
    if (v > VMAX) {
      b.vx = (b.vx / v) * VMAX;
      b.vy = (b.vy / v) * VMAX;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // soft recall inside the viewport, no hard bounces
    b.vx += (clamp(b.x, b.r, W - b.r) - b.x) * 0.02 * f;
    b.vy += (clamp(b.y, b.r, H - b.r) - b.y) * 0.02 * f;
    // absolute safety net
    b.x = clamp(b.x, -200, W + 200);
    b.y = clamp(b.y, -200, H + 200);
  }
}
