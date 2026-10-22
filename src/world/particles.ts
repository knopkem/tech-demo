/**
 * Drifting bioluminescent motes — up to 15k GPU-resident sprites over the
 * island. Every instance gets a random home position, size, hue and phase
 * from `range()` (per-instance random buffers generated once at compile
 * time — zero per-frame CPU), then drifts on slow bounded sines and
 * twinkles. The whole cloud is one additive draw call; tiers scale `count`.
 */
import {
  AdditiveBlending,
  Color,
  Mesh,
  PlaneGeometry,
  SpriteNodeMaterial,
  Vector3,
  type Scene,
} from 'three/webgpu';
import { cos, float, range, sin, time, vec3 } from 'three/tsl';

import { PALETTE } from '../util/palette.js';

/** Half-size of the mote cloud — covers the island, ridge ring and beach shelf. */
const BOUND = 1500;

export class Motes {
  readonly mesh: Mesh;
  readonly material: SpriteNodeMaterial;

  constructor(scene: Scene, maxCount = 15000) {
    const material = new SpriteNodeMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: true,
    });

    // Per-instance randoms.
    const home = range(new Vector3(-BOUND, -8, -BOUND), new Vector3(BOUND, 320, BOUND));
    const phase = range(0, 1);
    const size = range(0.12, 0.55);
    const hue = range(new Color(PALETTE.crystalCyan), new Color(PALETTE.crystalViolet));

    // Bounded drift: slow sines around the home position, one per instance.
    const t = time.mul(float(0.16));
    const drift = vec3(
      sin(t.add(phase.mul(float(6.28)))),
      sin(t.mul(float(0.6)).add(phase.mul(float(9.4)))),
      cos(t.mul(float(0.8)).add(phase.mul(float(12.1)))),
    ).mul(float(9));

    material.positionNode = home.add(drift);
    material.scaleNode = size;
    // > 1 so the brightest motes drive the bloom pass.
    material.colorNode = hue.mul(float(1.8));
    material.opacityNode = float(0.55)
      .mul(sin(time.mul(float(1.1)).add(phase.mul(float(40)))).mul(float(0.4)).add(float(0.6)))
      .mul(size.mul(float(0.9)).add(float(0.1)));

    const mesh = new Mesh(new PlaneGeometry(1, 1), material);
    mesh.count = maxCount;
    mesh.frustumCulled = false; // instances span the whole cloud box
    mesh.renderOrder = 5;
    scene.add(mesh);

    this.mesh = mesh;
    this.material = material;
  }

  /** Tier hook — the random buffers stay max-sized; we only draw a prefix. */
  setCount(count: number): void {
    this.mesh.count = count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
