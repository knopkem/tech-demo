/**
 * The island — CPU-baked procedural terrain with a texture-baked albedo /
 * roughness / glow map. Baking on the CPU (instead of displacing in the
 * vertex shader) keeps a single source of truth: the same `islandHeight`
 * function feeds the mesh, the baked maps, object placement, and camera
 * collision. The GPU material only adds *micro* detail on top.
 */
import * as THREE from 'three/webgpu';
import {
  color,
  float,
  sin,
  texture,
  uv,
  time,
  positionWorld,
  mx_noise_float,
  vec2,
} from 'three/tsl';

import {
  PLANE_SIZE,
  ISLAND_RADIUS,
  islandHeight,
  islandHeightNorm,
  fbm2,
  simplex2,
  mulberry32,
  clamp01,
} from '../util/noise.js';
import { P } from '../util/palette.js';

const PERM_MOIST = 0x0be4;
const PERM_GLOW = 0x9e07;

function makePerm(seed: number): Uint8Array {
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
const MOIST_PERM = makePerm(PERM_MOIST);
const GLOW_PERM = makePerm(PERM_GLOW);

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: number, b: number, t: number): [number, number, number] {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return [lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)];
}

/** Bake albedo (sRGB) + roughness (alpha) from height/slope/moisture. */
function bakeSurfacing(
  h: number,
  slope: number,
  x: number,
  z: number,
  r: number,
): { rgb: [number, number, number]; rough: number; glow: number } {
  const moisture = fbm2(x * 0.0021 + 41.2, z * 0.0021 - 17.6, 3, MOIST_PERM) * 0.5 + 0.5;
  const wet = clamp01(1 - h / 7); // everything low is tide-wet

  let rgb: [number, number, number];
  let rough: number;

  if (h < -0.4) {
    // Lagoon bed and shallows.
    const d = clamp01((h + 11) / 11); // 0 at floor, 1 at shore
    rgb = lerpColor(P.lagoonBed, P.lagoonShallow, d);
    rgb = [rgb[0] * (0.8 + moisture * 0.4), rgb[1], rgb[2]];
    rough = 0.35;
  } else if (h < 2.2) {
    // Wet sand.
    rgb = lerpColor(P.wetSand, P.drySand, clamp01((h + 0.4) / 2.6));
    rgb = [rgb[0] * (1 - wet * 0.25), rgb[1] * (1 - wet * 0.15), rgb[2] * (1 - wet * 0.15)];
    rough = lerp(0.25, 0.75, wet * 0.5 + moisture * 0.5);
  } else if (h < 10) {
    // Sand → moss transition.
    const t = clamp01((h - 2.2) / 7.8) * (0.55 + moisture * 0.45);
    rgb = lerpColor(P.drySand, P.moss, t);
    rough = lerp(0.8, 0.95, t);
  } else if (h > 235) {
    // Pale mineral caps on the high ridges.
    const t = clamp01((h - 235) / 60);
    rgb = lerpColor(P.rock, P.mineralCap, t * (0.6 + moisture * 0.4));
    rough = lerp(0.85, 0.6, t);
  } else if (slope > 0.62) {
    // Steep faces → rock.
    const t = clamp01((slope - 0.62) / 0.9);
    rgb = lerpColor(P.rock, P.mineralCap, t * 0.45 * moisture);
    rough = lerp(0.9, 0.65, t);
  } else {
    // Moss country.
    const t = clamp01((h - 10) / 120);
    rgb = lerpColor(P.moss, P.rock, t * 0.55);
    rgb = [rgb[0] * (0.75 + moisture * 0.5), rgb[1] * (0.8 + moisture * 0.4), rgb[2] * (0.8 + moisture * 0.35)];
    rough = 0.92;
  }

  // Bioluminescent masks: lagoon shallows glow, moss veins pulse, beach shimmers.
  let glow = 0;
  if (h > -2.2 && h < 3 && r < ISLAND_RADIUS * 0.55) glow = 0.75;
  const vein = fbm2(x * 0.012 + 7.7, z * 0.012 + 29.1, 3, GLOW_PERM);
  if (h > 6 && h < 190 && slope < 0.6 && vein > 0.34) glow = Math.max(glow, (vein - 0.34) * 0.9);
  if (h > 0 && h < 2.2) glow = Math.max(glow, 0.16);

  return { rgb, rough, glow };
}

export interface IslandBake {
  mesh: THREE.Mesh;
  /** Bilinear height sampling over the baked grid (metres). */
  sampleHeight: (x: number, z: number) => number;
}

export class Island {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardNodeMaterial;
  private heights: Float32Array = new Float32Array(0);
  private grid = 1;
  private half = PLANE_SIZE / 2;

  /** Baked height range (metres) — ForestGenerator maps flora onto altitude. */
  minY = 0;
  maxY = 0;
  /** Contract for ForestGenerator: the plane span `sampleHeight` covers. */
  readonly parameters = { size: PLANE_SIZE };

  /** Current bake resolution (World checks this before re-baking). */
  get gridSize(): number {
    return this.grid;
  }

  private readonly mapCanvas: HTMLCanvasElement;
  private readonly maskCanvas: HTMLCanvasElement;
  private readonly mapTexture: THREE.CanvasTexture;
  private readonly maskTexture: THREE.CanvasTexture;

  constructor(grid = 1024) {
    this.mapCanvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    for (const c of [this.mapCanvas, this.maskCanvas]) {
      c.width = 1;
      c.height = 1;
      c.getContext('2d')!.fillRect(0, 0, 1, 1);
    }
    this.mapTexture = new THREE.CanvasTexture(this.mapCanvas);
    this.maskTexture = new THREE.CanvasTexture(this.maskCanvas);
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.mapTexture.magFilter = THREE.LinearFilter;
    this.maskTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.maskTexture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshStandardNodeMaterial({
      metalness: 0.0,
      roughness: 1,
      fog: true,
    });

    // --- GPU-side micro detail (macro shape stays CPU-baked) -------------
    const map = texture(this.mapTexture, uv());
    const mask = texture(this.maskTexture, uv());
    const xz = vec2(positionWorld.x, positionWorld.z);

    // Slow mottling so the baked 4.7 m/texel albedo reads finer up close.
    // (perlin ~[-1, 1] at unit amplitude → ±16 % brightness variation)
    const mottle = mx_noise_float(xz.mul(vec2(0.11, 0.11))).mul(float(0.16)).add(float(1));
    material.colorNode = map.rgb.mul(mottle);
    material.roughnessNode = map.a;

    // Pulsing bioluminescence: lagoon shallows + moss veins, phase-shifted
    // by world position so the glow ripples rather than blinking in unison.
    const pulse = float(0.6).add(
      float(0.4).mul(sin(time.mul(float(0.65)).add(positionWorld.x.mul(float(0.021)).add(positionWorld.z.mul(float(0.017)))))),
    );
    material.emissiveNode = color(P.glowTeal).mul(mask.r).mul(pulse).mul(float(0.5));

    this.material = material;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.bake(grid);
  }

  /** Rebuild the mesh + baked maps at a new grid resolution. */
  bake(grid: number): void {
    this.grid = grid;
    const n = grid;
    const cell = PLANE_SIZE / (n - 1);
    const pos = new Float32Array(n * n * 3);
    const nrm = new Float32Array(n * n * 3);
    const uvArr = new Float32Array(n * n * 2);
    const heights = new Float32Array(n * n);

    // 1) Heights (+ track the range for altitude-based placement).
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -this.half + i * cell;
        const z = -this.half + j * cell;
        const h = islandHeight(x, z);
        heights[j * n + i] = h;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    this.minY = lo;
    this.maxY = hi;

    // 2) Attributes + baked maps.
    this.mapCanvas.width = n;
    this.mapCanvas.height = n;
    this.maskCanvas.width = n;
    this.maskCanvas.height = n;
    const mapData = this.mapCanvas.getContext('2d')!.createImageData(n, n);
    const maskData = this.maskCanvas.getContext('2d')!.createImageData(n, n);

    const hAt = (i: number, j: number): number =>
      heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const x = -this.half + i * cell;
        const z = -this.half + j * cell;
        const H = heights[idx];

        // Central-difference normal.
        const e = cell * 0.5;
        const tX = new THREE.Vector3(2 * e, hAt(i + 1, j) - hAt(i - 1, j), 0);
        const tZ = new THREE.Vector3(0, hAt(i, j + 1) - hAt(i, j - 1), 2 * e);
        const normal = new THREE.Vector3().crossVectors(tX, tZ).normalize();

        const p3 = idx * 3;
        pos[p3] = x;
        pos[p3 + 1] = H;
        pos[p3 + 2] = z;
        nrm[p3] = normal.x;
        nrm[p3 + 1] = normal.y;
        nrm[p3 + 2] = normal.z;
        uvArr[idx * 2] = i / (n - 1);
        uvArr[idx * 2 + 1] = 1 - j / (n - 1);

        const r = Math.hypot(x, z);
        const slope = Math.hypot(tX.y, tZ.y) / (2 * e);
        const s = bakeSurfacing(H, slope, x, z, r);

        const p4 = idx * 4;
        mapData.data[p4] = s.rgb[0];
        mapData.data[p4 + 1] = s.rgb[1];
        mapData.data[p4 + 2] = s.rgb[2];
        mapData.data[p4 + 3] = Math.round(s.rough * 255);
        maskData.data[p4] = Math.round(clamp01(s.glow) * 255);
        maskData.data[p4 + 1] = Math.round(islandHeightNorm(H) * 255);
        maskData.data[p4 + 2] = Math.round(clamp01(slope) * 255);
        maskData.data[p4 + 3] = 255;
      }
    }

    this.mapCanvas.getContext('2d')!.putImageData(mapData, 0, 0);
    this.maskCanvas.getContext('2d')!.putImageData(maskData, 0, 0);
    this.mapTexture.needsUpdate = true;
    this.maskTexture.needsUpdate = true;

    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    for (const name of ['position', 'normal', 'uv']) geometry.deleteAttribute(name);
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    geometry.computeBoundingSphere();

    this.heights = heights;
  }

  /** Bilinear sample of the baked height field (metres). */
  sampleHeight(x: number, z: number): number {
    const n = this.grid;
    const cell = PLANE_SIZE / (n - 1);
    const fx = (x + this.half) / cell;
    const fz = (z + this.half) / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const at = (ii: number, jj: number): number =>
      this.heights[Math.min(n - 1, Math.max(0, jj)) * n + Math.min(n - 1, Math.max(0, ii))];
    const a = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
    const b = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return a * (1 - tz) + b * tz;
  }

  /** Slope (rise over run) at world (x, z). */
  sampleSlope(x: number, z: number, e = 6): number {
    const e2 = this.sampleHeight(x + e, z) - this.sampleHeight(x - e, z);
    const e3 = this.sampleHeight(x, z + e) - this.sampleHeight(x, z - e);
    return Math.hypot(e2, e3) / (2 * e);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mapTexture.dispose();
    this.maskTexture.dispose();
  }
}
