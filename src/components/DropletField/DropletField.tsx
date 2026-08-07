import { useEffect, useMemo, useRef } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { FRAG_SRC, MAX_BLOBS, VERT_SRC } from "./dropletShaders";
import {
  createBlobs,
  createCluster,
  createCursor,
  DEFAULT_PARAMS,
  stepDroplets,
  type DropletParams,
} from "./dropletPhysics";

export interface DropletFieldProps {
  /** Overrides merged over DEFAULT_PARAMS (see dropletPhysics.ts, §presets). */
  params?: Partial<DropletParams>;
  className?: string;
}

const PIXEL_SIZE: Record<DropletParams["pixelation"], number> = {
  off: 0,
  soft: 7,
  strong: 14,
};

function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("DropletField shader error:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * Fullscreen interactive metaball "water drops" background.
 * Pure WebGL1 on a single canvas — no three.js, no meshes. Decorative only:
 * the canvas never intercepts pointer events (tracking happens on window).
 */
export default function DropletField({ params, className }: DropletFieldProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  // Live-updatable params: the render loop reads this ref every frame, so
  // tweaking props does not tear down the GL context or reset the scene.
  const merged = useMemo(() => ({ ...DEFAULT_PARAMS, ...params }), [params]);
  const paramsRef = useRef(merged);
  useEffect(() => {
    paramsRef.current = merged;
  }, [merged]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const gl = (canvas.getContext("webgl", {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: "high-performance",
    }) ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return; // no WebGL: the CSS background of the hero remains

    // --- program (re-creatable: a real GPU context loss must rebuild it) -----
    const initGL = () => {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      if (!prog) return null;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, "aPos");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("DropletField link error:", gl.getProgramInfoLog(prog));
        return null;
      }
      gl.useProgram(prog);

      // fullscreen triangle
      const buf = gl.createBuffer();
      if (!buf) return null;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const U = (name: string) => gl.getUniformLocation(prog, name);
      return {
        prog,
        vs,
        fs,
        buf,
        loc: {
          blobs: U("uBlobs[0]"),
          count: U("uCount"),
          bg: U("uBg"),
          drop: U("uDrop"),
          highlight: U("uHighlight"),
          lightDir: U("uLightDir"),
          threshold: U("uThreshold"),
          edge: U("uEdge"),
          pixel: U("uPixel"),
          grain: U("uGrain"),
          grainCell: U("uGrainCell"),
          normalZ: U("uNormalZ"),
          specPower: U("uSpecPower"),
          sheen: U("uSheen"),
          rim: U("uRim"),
        },
      };
    };
    let glo = initGL();
    if (!glo) return;

    // --- state ----------------------------------------------------------------
    let W = 1; // CSS px
    let H = 1;
    let dpr = 1;
    let rect = { left: 0, top: 0, width: 1, height: 1 };
    let P = paramsRef.current;
    let blobs = createBlobs(P, W, H);
    let cluster = createCluster(P, W, H);
    const cursor = createCursor(W, H);
    const blobArr = new Float32Array(MAX_BLOBS * 3); // reused every frame
    const colorCache = new Map<string, [number, number, number]>();
    const color = (hex: string) => {
      let c = colorCache.get(hex);
      if (!c) {
        c = hexToRgb01(hex);
        colorCache.set(hex, c);
      }
      return c;
    };

    let raf = 0;
    let lastT = 0;
    let inView = true;
    let disposed = false;
    let contextLost = false;

    // --- render -----------------------------------------------------------------
    const render = () => {
      if (!glo || contextLost) return;
      const loc = glo.loc;
      P = paramsRef.current;
      let n = 0;
      for (const b of blobs) {
        if (b.r < 0.5 || n >= MAX_BLOBS) continue;
        blobArr[n * 3] = b.x * dpr;
        blobArr[n * 3 + 1] = b.y * dpr;
        blobArr[n * 3 + 2] = b.r * dpr;
        n++;
      }
      const [lx, ly, lz] = P.lightDir;
      const ll = Math.hypot(lx, ly, lz) || 1;
      const pixel = PIXEL_SIZE[P.pixelation] * dpr;

      gl.uniform3fv(loc.blobs, blobArr);
      gl.uniform1i(loc.count, n);
      gl.uniform3fv(loc.bg, color(P.bg));
      gl.uniform3fv(loc.drop, color(P.drop));
      gl.uniform3fv(loc.highlight, color(P.highlight));
      gl.uniform3f(loc.lightDir, lx / ll, ly / ll, lz / ll);
      gl.uniform1f(loc.threshold, P.threshold);
      gl.uniform1f(loc.edge, P.edge);
      gl.uniform1f(loc.pixel, pixel);
      gl.uniform1f(loc.grain, P.grain);
      gl.uniform1f(loc.grainCell, Math.max(pixel, 8 * dpr));
      gl.uniform1f(loc.normalZ, P.normalZ);
      gl.uniform1f(loc.specPower, P.specPower);
      gl.uniform1f(loc.sheen, P.sheen);
      gl.uniform1f(loc.rim, P.rimDark);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // --- sizing --------------------------------------------------------------
    const applySize = () => {
      const first = W === 1;
      const r = wrap.getBoundingClientRect();
      rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, paramsRef.current.dprMax);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (first) {
        blobs = createBlobs(paramsRef.current, W, H);
        cluster = createCluster(paramsRef.current, W, H);
        cursor.tx = W / 2;
        cursor.ty = H / 2;
      } else {
        // keep the scene, just pull everything back inside the new bounds
        for (const b of blobs) {
          b.x = Math.min(Math.max(b.x, b.r), W - b.r);
          b.y = Math.min(Math.max(b.y, b.r), H - b.r);
        }
      }
      render();
    };

    // --- loop -----------------------------------------------------------------
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!lastT) {
        lastT = now;
        return;
      }
      const raw = (now - lastT) / 1000;
      lastT = now;
      if (raw <= 0) return;
      if (raw > 0.25) {
        // long main-thread stall: teleport the cursor blob instead of letting
        // the clamped dt fake a huge cursor speed (spurious cluster breakup)
        cursor.snap = true;
      }
      const dt = Math.min(raw, 1 / 30);
      stepDroplets(dt, blobs, cursor, cluster, paramsRef.current, W, H);
      render();
    };

    const updateRunning = () => {
      const should =
        !disposed && !contextLost && !document.hidden && inView && !reducedMotion;
      if (should && !raf) {
        lastT = 0;
        raf = requestAnimationFrame(frame);
      } else if (!should && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    // --- input (window-level so the text layer never blocks tracking) ---------
    const onPointer = (e: PointerEvent) => {
      const m = 80; // let the blob park slightly past the hero edges
      cursor.tx = Math.min(Math.max(e.clientX - rect.left, -m), rect.width + m);
      cursor.ty = Math.min(
        Math.max(rect.height - (e.clientY - rect.top), -m),
        rect.height + m,
      );
      if (!cursor.active) {
        cursor.active = true;
        cursor.snap = true;
      }
    };
    const onPointerGone = () => {
      cursor.active = false;
    };
    const onScroll = () => {
      const r = wrap.getBoundingClientRect();
      rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    };

    // --- real GPU context loss (mobile tab eviction etc.) -----------------------
    const onCtxLost = (e: Event) => {
      e.preventDefault(); // allows the browser to restore the context later
      contextLost = true;
      updateRunning();
    };
    const onCtxRestored = () => {
      glo = initGL();
      contextLost = !glo;
      applySize();
      updateRunning();
    };
    canvas.addEventListener("webglcontextlost", onCtxLost);
    canvas.addEventListener("webglcontextrestored", onCtxRestored);

    // --- observers -------------------------------------------------------------
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applySize, 120);
    });
    ro.observe(wrap);
    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      updateRunning();
    });
    io.observe(wrap);
    const onVisibility = () => updateRunning();

    applySize();

    if (reducedMotion) {
      // Static scene: keep the look, drop the animation entirely.
      render();
    } else {
      window.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("pointerdown", onPointer, { passive: true });
      window.addEventListener("blur", onPointerGone);
      document.documentElement.addEventListener("pointerleave", onPointerGone);
      window.addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      updateRunning();
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("webglcontextlost", onCtxLost);
      canvas.removeEventListener("webglcontextrestored", onCtxRestored);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("blur", onPointerGone);
      document.documentElement.removeEventListener("pointerleave", onPointerGone);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      if (glo) {
        gl.deleteBuffer(glo.buf);
        gl.deleteProgram(glo.prog);
        gl.deleteShader(glo.vs);
        gl.deleteShader(glo.fs);
      }
      // NOTE: no WEBGL_lose_context here — under React StrictMode the effect
      // re-runs on the same canvas and getContext() would return the lost
      // context, leaving the hero blank in dev.
    };
  }, [reducedMotion]);

  return (
    <div
      ref={wrapRef}
      className={className}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
