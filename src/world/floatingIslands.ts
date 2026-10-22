// Four small inverted island chunks hanging over the sea, each with its own
// crystal cluster and a soft mist column. The chunks share one material; the
// crystals share one instanced draw; the mist is one instanced sprite draw.

import {
  AdditiveBlending,
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  SpriteNodeMaterial,
  Uint32BufferAttribute,
  Vector3,
  type Node,
  type Scene,
} from 'three/webgpu';
import {
  color,
  float,
  instancedBufferAttribute,
  mix,
  mx_noise_float,
  positionLocal,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
} from 'three/tsl';

import { fbm2, mulberry32 } from '../util/noise.js';
import { PALETTE } from '../util/palette.js';

interface ChunkSpec {
  size: number;
  x: number;
  z: number;
  y: number;
  rotation: number;
  seed: number;
}

const CHUNKS: ChunkSpec[] = [
  { size: 260, x: -1180, z: 720, y: 175, rotation: 0.4, seed: 11 },
  { size: 210, x: 1360, z: -420, y: 235, rotation: 1.9, seed: 23 },
  { size: 300, x: 880, z: 1250, y: 130, rotation: 3.2, seed: 37 },
  { size: 230, x: -690, z: -1330, y: 205, rotation: 4.8, seed: 51 },
];

function topHeight(lx: number, lz: number, size: number, seed: number): number {
  const r = Math.hypot(lx, lz) / (size * 0.5);
  const mask = Math.max(0, 1 - r * r);
  const n = fbm2(lx * 0.028 + seed, lz * 0.028 - seed, 3);
  return Math.pow(mask, 0.65) * (11 + n * 7);
}

function bottomHeight(lx: number, lz: number, size: number, seed: number): number {
  const r = Math.hypot(lx, lz) / (size * 0.5);
  const mask = Math.max(0, 1 - r * r);
  const n = fbm2(lx * 0.038 - seed, lz * 0.038 + seed, 3);
  return -Math.pow(mask, 0.8) * (42 + (n * 0.5 + 0.5) * 30);
}

function chunkGeometry(size: number, seed: number, segments = 64): BufferGeometry {
  const n = segments + 1;
  const cell = size / segments;
  const half = size * 0.5;
  const positions: number[] = [];
  const indices: number[] = [];

  // top grid
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * cell;
      const z = -half + j * cell;
      positions.push(x, topHeight(x, z, size, seed), z);
    }
  }

  // bottom grid (offset by n*n vertices)
  const bottomStart = n * n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * cell;
      const z = -half + j * cell;
      positions.push(x, bottomHeight(x, z, size, seed), z);
    }
  }

  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;

      indices.push(a, c, b, b, c, d);
      indices.push(
        bottomStart + a,
        bottomStart + b,
        bottomStart + c,
        bottomStart + b,
        bottomStart + d,
        bottomStart + c,
      );
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setIndex(new Uint32BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

export class FloatingIslands {
  group: Mesh[] = [];
  crystals: InstancedMesh;
  mist: Mesh;

  constructor(scene: Scene) {
    const rng = mulberry32(0xf10a7);

    // One shared rock material for all four chunks.
    const rockMat = new MeshStandardNodeMaterial({
      metalness: 0.02,
      roughness: 0.88,
      fog: true,
    });
    const moss = smoothstep(-4, 8, positionLocal.y);
    const veins = mx_noise_float(positionLocal.mul(0.07)).mul(0.5).add(0.5);
    rockMat.colorNode = mix(
      color(PALETTE.rockDark),
      mix(color(PALETTE.mossMid), color(PALETTE.rockMid), veins),
      moss,
    );
    rockMat.emissiveNode = color(PALETTE.floraTeal)
      .mul(smoothstep(0.58, 0.9, veins))
      .mul(moss)
      .mul(0.55);

    const crystalGeo = new ConeGeometry(0.7, 4.5, 6, 1);
    crystalGeo.translate(0, 2.25, 0);
    const crystalMat = new MeshStandardNodeMaterial({
      metalness: 0.1,
      roughness: 0.2,
      color: 0x0d2b38,
    });
    crystalMat.emissiveNode = mix(color(PALETTE.crystalCyan), color(PALETTE.crystalViolet), 0.45)
      .mul(sin(time.mul(1.1).add(positionLocal.y.mul(0.7))).mul(0.25).add(0.75))
      .mul(0.9);
    const crystals = new InstancedMesh(crystalGeo, crystalMat, CHUNKS.length * 5);
    crystals.name = 'FloatingCrystals';
    crystals.castShadow = false;
    crystals.frustumCulled = false;

    const dummy = new Object3D();
    let ci = 0;

    for (const spec of CHUNKS) {
      const geo = chunkGeometry(spec.size, spec.seed, 64);
      const mesh = new Mesh(geo, rockMat);
      mesh.name = 'FloatingIsland';
      mesh.position.set(spec.x, spec.y, spec.z);
      mesh.rotation.y = spec.rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.group.push(mesh);

      // A few spires on the flat top.
      for (let k = 0; k < 5; k++) {
        const a = rng() * Math.PI * 2;
        const rr = rng() * spec.size * 0.26;
        const lx = Math.cos(a) * rr;
        const lz = Math.sin(a) * rr;
        const ly = topHeight(lx, lz, spec.size, spec.seed);

        const cos = Math.cos(spec.rotation);
        const sin = Math.sin(spec.rotation);
        dummy.position.set(
          spec.x + lx * cos - lz * sin,
          spec.y + ly + 0.2,
          spec.z + lx * sin + lz * cos,
        );
        dummy.rotation.set((rng() - 0.5) * 0.2, rng() * Math.PI * 2, (rng() - 0.5) * 0.2);
        const s = 0.5 + rng() * 1.1;
        dummy.scale.set(s, s * (0.8 + rng()), s);
        dummy.updateMatrix();
        crystals.setMatrixAt(ci++, dummy.matrix);
      }
    }

    crystals.count = ci;
    crystals.instanceMatrix.needsUpdate = true;
    scene.add(crystals);
    this.crystals = crystals;

    // --- mist columns (one instanced sprite draw) -------------------------
    const centers = new Float32Array(CHUNKS.length * 3);
    CHUNKS.forEach((spec, i) => {
      centers[i * 3 + 0] = spec.x;
      centers[i * 3 + 1] = spec.y - 82;
      centers[i * 3 + 2] = spec.z;
    });
    const centerAttr = new InstancedBufferAttribute(centers, 3);

    const mistMat = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    const mUv = uv();
    const n = mx_noise_float(
      vec3(mUv.x.mul(3.1), mUv.y.mul(2.4), time.mul(0.035)),
    )
      .mul(0.5)
      .add(0.5);
    const vertical = smoothstep(0.0, 0.35, mUv.y).mul(smoothstep(1.0, 0.55, mUv.y));
    mistMat.colorNode = color(PALETTE.mist).mul(0.45);
    mistMat.opacityNode = n
      .mul(vertical)
      .mul(sin(time.mul(0.22)).mul(0.08).add(0.18));
    mistMat.scaleNode = float(220);

    const mist = new Mesh(new ConeGeometry(1, 1, 12, 1, true), mistMat);
    mist.position.set(0, 0, 0);
    mist.count = CHUNKS.length;
    mist.frustumCulled = false;
    mist.renderOrder = 6;
    // positionNode is overridden by the per-instance center attribute.
    mistMat.positionNode = instancedBufferAttribute(centerAttr, 'vec3') as Node<'vec3'>;
    scene.add(mist);
    this.mist = mist;

    // touch the shared vector type so tree-shaking keeps the import meaningful
    void Vector3;
  }
}
