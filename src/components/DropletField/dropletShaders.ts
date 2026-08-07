// GLSL (ES 1.00 / WebGL1-compatible) sources for the DropletField metaball hero.

export const MAX_BLOBS = 10;

export const VERT_SRC = /* glsl */ `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Classic metaball field  f(p) = Σ r_i² / (|p - c_i|² + 1)  evaluated per
// fragment. The surface is the f = uThreshold iso-line; when two centres get
// close their fields add up and the liquid "neck" appears by itself.
// Lighting is fake 3D: a normal is derived from the analytic field gradient
// (equivalent to the classic central-difference version with e = 1.5, but a
// single loop instead of five field evaluations).
//
// All distances are evaluated in "field space" (device px × FS, FS = 1/64):
// the field value is mathematically identical (r²FS² / (d²FS² + FS²) =
// r² / (d² + 1)) but squared magnitudes stay finite on GPUs whose fragment
// shaders only support mediump (fp16 max ≈ 65504, while squared device-pixel
// distances reach ~1.8e7).
export const FRAG_SRC = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define MAX_BLOBS ${MAX_BLOBS}

const float FS = 1.0 / 64.0; // field-space scale, see note above

uniform vec3  uBlobs[MAX_BLOBS]; // xy = position (device px, origin bottom-left), z = radius
uniform int   uCount;
uniform vec3  uBg;
uniform vec3  uDrop;
uniform vec3  uHighlight;
uniform vec3  uLightDir;    // normalized on the JS side
uniform float uThreshold;   // ~1.0
uniform float uEdge;        // ~0.12 edge softness (field units)
uniform float uPixel;       // mosaic cell size in device px (0 = off)
uniform float uGrain;       // background grain amplitude (0 = off)
uniform float uGrainCell;   // grain cell size in device px
uniform float uNormalZ;     // bulge: lower = flatter drops
uniform float uSpecPower;   // specular exponent
uniform float uSheen;       // broad sheen amount on the lit side
uniform float uRim;         // rim darkening amount

// x = field value, yz = field gradient (in field-space units)
vec3 fieldAt(vec2 p) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= uCount) break;
    vec2 d = p - uBlobs[i].xy * FS;
    float r = uBlobs[i].z * FS;
    // q is clamped from below: only affects fragments within ~6 device px of
    // a blob core (mask/body already saturated there) and keeps -2g/q finite
    // on fp16 hardware.
    float q = max(dot(d, d) + FS * FS, 1e-2);
    float g = min((r * r) / q, 64.0);
    acc.x += g;
    acc.yz += (-2.0 * g / q) * d;
  }
  return acc;
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (uPixel > 1.0) {
    frag = (floor(frag / uPixel) + 0.5) * uPixel; // optional mosaic
  }

  vec3 fg = fieldAt(frag * FS);
  float f = fg.x;
  float mask = smoothstep(uThreshold - uEdge, uThreshold + uEdge, f);

  // Fake normal from the field gradient. ×FS converts the gradient back to
  // per-device-pixel units; ×3.0 matches the reference central-difference
  // sampling with e = 1.5.
  vec3 n = normalize(vec3(-fg.yz * FS * 3.0, uNormalZ));

  vec3 L = uLightDir;
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), uSpecPower);

  // f grows quickly towards the blob core: use it to darken the rim band.
  float body = smoothstep(uThreshold, uThreshold * 2.3, f);

  vec3 dropCol = uDrop * (0.35 + 0.8 * diff);
  dropCol += uHighlight * pow(diff, 3.0) * uSheen;   // broad soft sheen
  dropCol *= mix(1.0 - uRim, 1.0, body);             // darker edges
  dropCol += uHighlight * spec * 0.9;                // glassy white dot

  // Subtle blocky grain on the light background (two octaves). Cells tile
  // every 64 units so the hash input stays inside mediump range.
  vec2 cell = mod(floor(gl_FragCoord.xy / uGrainCell), 64.0);
  float g1 = hash21(cell) - 0.5;
  float g2 = hash21(floor(cell / 3.0) + 17.0) - 0.5;
  vec3 bg = uBg + (g1 + g2 * 1.6) * uGrain;

  gl_FragColor = vec4(mix(bg, dropCol, mask), 1.0);
}
`;
