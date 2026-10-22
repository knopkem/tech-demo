// Instanced boulders: deformed icosahedra clustered at cliff bases and along the
// shoreline. One draw call, one material, deterministic placement.

import {
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardNodeMaterial,
  Object3D,
  type BufferAttribute,
  type Scene,
} from 'three/webgpu';
import {
  color,
  mx_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
} from 'three/tsl';

import { mulberry32, simplex2 } from '../util/noise.js';
import { PALETTE } from '../util/palette.js';
import type { Island } from './island.js';

const _dummy = new Object3D();

function boulderGeometry(): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position as BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Hash on position so duplicated (non-indexed) vertices move together.
    const n =
      simplex2(x * 2.15 + y * 1.31 + 5.2, z * 2.15 - y * 0.77 - 3.7) * 0.5 +
      simplex2(x * 4.7 - z * 2.2, y * 4.7 + 1.9) * 0.24;

    const r = 1 + n * 0.42;
    pos.setXYZ(i, x * r, y * r * 0.72, z * r);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export class Rocks {
  mesh: InstancedMesh;

  constructor(scene: Scene, island: Island, count = 250) {
    const rng = mulberry32(0xb01d3e);
    const geo = boulderGeometry();

    const mat = new MeshStandardNodeMaterial({
      metalness: 0.06,
      roughness: 0.84,
      fog: true,
    });
    const mottle = mx_noise_float(positionWorld.mul(0.7)).mul(0.25).add(0.88);
    mat.colorNode = color(PALETTE.rock).mul(mottle);
    mat.emissiveNode = color(PALETTE.floraTeal)
      .mul(smoothstep(0.72, 0.98, normalWorld.y))
      .mul(0.09);

    const mesh = new InstancedMesh(geo, mat, count);
    mesh.name = 'Boulders';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 60) {
      attempts++;
      const angle = rng() * Math.PI * 2;
      const r = 300 + Math.pow(rng(), 0.7) * 900;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = island.sampleHeight(x, z);
      const slope = island.sampleSlope(x, z);

      const cliffBase = slope > 0.2 && h > 18 && h < 260;
      const shore = h > -1 && h < 9;
      if (!cliffBase && !shore) continue;
      if (rng() > (cliffBase ? 0.8 : 0.4)) continue;

      const s = 1.2 + Math.pow(rng(), 2.1) * 5.2;
      _dummy.position.set(x, h - s * 0.28, z);
      _dummy.rotation.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
      _dummy.scale.set(s * (0.8 + rng() * 0.5), s, s * (0.8 + rng() * 0.5));
      _dummy.updateMatrix();
      mesh.setMatrixAt(placed, _dummy.matrix);
      placed++;
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    this.mesh = mesh;
  }
}
