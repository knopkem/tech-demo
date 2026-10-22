/**
 * CPU-side procedural noise — the single source of truth for the island's
 * macro shape. Everything that must "sit on" the terrain (crystals, flora,
 * rocks, camera collision, lagoon masks) samples these same functions, so
 * the CPU-baked terrain and its inhabitants always agree.
 */

const GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Deterministic PRNG (mulberry32) for reproducible world generation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePermTable(seed: number): Uint8Array {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const PERM_MAIN = makePermTable(0x5eed1);
const PERM_RIDGE = makePermTable(0x717);
const PERM_MOIST = makePermTable(0x0be4);
const PERM_GLOW = makePermTable(0x9e07);

/** Classic 2D simplex noise, roughly in [-1, 1]. */
export function simplex2(x: number, y: number, perm: Uint8Array = PERM_MAIN): number {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;

  const contrib = (xc: number, yc: number, gi: number): number => {
    let tt = 0.5 - xc * xc - yc * yc;
    if (tt < 0) return 0;
    tt *= tt;
    const g = GRAD2[gi];
    return tt * tt * (g[0] * xc + g[1] * yc);
  };

  const n =
    contrib(x0, y0, perm[ii + perm[jj]] & 7) +
    contrib(x1, y1, perm[ii + i1 + perm[jj + j1]] & 7) +
    contrib(x2, y2, perm[ii + 1 + perm[jj + 1]] & 7);
  return 32 * n; // ~[-1, 1]
}

/** Fractal Brownian motion. Returns ~[-1, 1]. */
export function fbm2(
  x: number,
  y: number,
  octaves = 5,
  perm: Uint8Array = PERM_MAIN,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(x * freq, y * freq, perm);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal (sharp mountain ridges). Returns ~[0, 1]. */
export function ridged2(
  x: number,
  y: number,
  octaves = 4,
  perm: Uint8Array = PERM_RIDGE,
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2 * simplex2(x * freq, y * freq, perm) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** smoothstep that also accepts flipped edges (edge0 > edge1). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  let t = (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------
// Island shape — the ONE canonical height function for the whole world.
// ---------------------------------------------------------------------------

/** World radius of the island (metres). */
export const ISLAND_RADIUS = 1100;
/** Full size of the terrain plane (metres) — large enough for the falloff to reach sea level. */
export const PLANE_SIZE = 4800;

/**
 * Island height at world (x, z) in metres (sea level = 0).
 * A ring of mountains on the NW arc, a luminous lagoon in the centre, a
 * gentle shelf/beach fading to sea level, all masked into a round island.
 */
export function islandHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // Radial island mask: 1 well inside, smooth to 0 at the rim + beyond.
  const mask = smoothstep(ISLAND_RADIUS + 950, ISLAND_RADIUS * 0.38, r);

  // Rolling base terrain.
  let h = fbm2(x * 0.00062 + 13.7, z * 0.00062 - 7.3, 5) * 95;

  // Ridge ring on the NW arc (angle ~140°), strongest on the inner rim.
  const ang = Math.atan2(z, x);
  const band = smoothstep(0.85, 0.14, Math.abs(ang - Math.PI * 0.78));
  const ring =
    smoothstep(ISLAND_RADIUS * 1.08, ISLAND_RADIUS * 0.55, r) *
    smoothstep(ISLAND_RADIUS * 0.18, ISLAND_RADIUS * 0.52, r);
  h += ridged2(x * 0.0018 + 3.1, z * 0.0018 + 9.4, 4) * 215 * band * ring;

  // Lagoon carve in the centre.
  const lagoonMask = 1 - smoothstep(300, 480, r);
  const lagoonDepth = -9 + fbm2(x * 0.004 + 31.4, z * 0.004 - 11.8, 3, PERM_MOIST) * 1.8;
  h = h * (1 - lagoonMask) + lagoonDepth * lagoonMask;

  return h * mask;
}

/** Slope (rise over run, ~tan) via central differences — for placement filters. */
export function islandSlope(x: number, z: number, e = 6): number {
  const hL = islandHeight(x - e, z);
  const hR = islandHeight(x + e, z);
  const hD = islandHeight(x, z - e);
  const hU = islandHeight(x, z + e);
  return Math.hypot(hR - hL, hU - hD) / (2 * e);
}

/** Height normalised to [0, 1] over the island's full range (for GPU banding). */
export function islandHeightNorm(h: number): number {
  return clamp01((h + 25) / 340);
}
