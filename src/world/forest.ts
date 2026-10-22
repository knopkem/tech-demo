// Glowing night flora. ForestGenerator gives us 18k instanced crowns in a single
// draw with free distance culling; we restyle its material into bioluminescent
// mushroom-coral tips instead of daylight foliage.

import { Group, type Camera, type Node, type Scene } from 'three/webgpu';
import { attribute, color, mix, positionWorld, pow, sin, smoothstep, time } from 'three/tsl';
import { ForestGenerator } from 'three/addons/generators/ForestGenerator.js';
import type { TerrainGenerator } from 'three/addons/generators/TerrainGenerator.js';

import { PALETTE } from '../util/palette.js';
import type { Island } from './island.js';

export class Forest {
  readonly generator: ForestGenerator;
  group: Group;
  count: number;

  constructor(scene: Scene, island: Island, count = 18000) {
    this.count = count;
    this.generator = new ForestGenerator({
      seed: 0x1a2b3c,
      count,
      detail: 0,
      radius: 0.95,
      height: 5.4,
      distortion: 0.58,
      sink: 0.55,
      altitudeMin: 0.035,
      altitudeMax: 0.62,
      minSlope: 0.4,
      densityFrequency: 0.0058,
      minScale: 0.65,
      maxScale: 2.1,
      from: 320,
      to: 760,
      castShadow: false,
    });

    const mat = this.generator.material;
    const ao = attribute('ao', 'float') as Node<'float'>;
    const region = attribute('region', 'float') as Node<'float'>;

    const body = mix(color(PALETTE.mossDeep), color(0x1b2440), region.mul(0.7));
    mat.colorNode = mix(color(0x02090b), body, ao.mul(0.85));

    const tip = pow(ao, 2.4);
    const pulse = sin(
      time.mul(0.85).add(region.mul(31.0)).add(positionWorld.x.mul(0.02)),
    )
      .mul(0.3)
      .add(0.7);
    const glowColor = mix(color(PALETTE.floraTeal), color(PALETTE.floraViolet), region);
    mat.emissiveNode = glowColor
      .mul(tip)
      .mul(pulse)
      .mul(smoothstep(0.05, 0.35, ao).mul(0.45).add(0.55))
      .mul(2.2);

    this.group = this.generator.build(island as unknown as TerrainGenerator);
    this.group.name = 'GlowForest';
    scene.add(this.group);
  }

  update(_dt: number, _t: number, camera: Camera): void {
    this.generator.setCameraPosition(camera.position);
  }

  setQuality(_tier: string): void {
    // Detail is already GPU-distance-gated; drawing the same one instanced call
    // is cheaper than rebuilding the placement on every tier change.
  }
}
