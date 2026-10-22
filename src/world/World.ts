/**
 * World — the composition root. Owns every scene module and drives their
 * per-frame updates. Prop modules (crystals, forest, ...) register here.
 */
import * as THREE from 'three/webgpu';

import { Island } from './island.js';
import { Sea } from './sea.js';
import { SkyDome } from './sky.js';
import { Crystals } from './crystals.js';
import { Forest } from './forest.js';
import { Rocks } from './rocks.js';
import { FloatingIslands } from './floatingIslands.js';
import { Motes } from './particles.js';
import { Clouds } from './clouds.js';
import { QualityTier, TIERS } from '../util/quality.js';

export class World {
  readonly scene = new THREE.Scene();

  readonly island: Island;
  readonly sea: Sea;
  readonly sky: SkyDome;
  readonly crystals: Crystals;
  readonly forest: Forest;
  readonly rocks: Rocks;
  readonly floatingIslands: FloatingIslands;
  readonly motes: Motes;
  readonly clouds: Clouds;

  private extraUpdate: ((dt: number, t: number, camera: THREE.Camera) => void)[] = [];
  private extraTier: ((tier: QualityTier) => void)[] = [];

  constructor(islandGrid = 1024, seaSegments = 256) {
    this.island = new Island(islandGrid);
    this.sea = new Sea(seaSegments);
    this.sky = new SkyDome();

    // Props place themselves on the island and add their objects to the scene.
    this.crystals = new Crystals(this.scene, this.island);
    this.forest = new Forest(this.scene, this.island);
    this.rocks = new Rocks(this.scene, this.island);
    this.floatingIslands = new FloatingIslands(this.scene);
    this.motes = new Motes(this.scene, TIERS[0].particles);
    this.clouds = new Clouds(this.scene, TIERS[0].clouds);

    this.scene.add(this.island.mesh, this.sea.near, this.sea.far, this.sky.mesh);

    this.register({
      update: (dt, t, camera) => this.forest.update(dt, t, camera),
      onTier: (tier) => {
        this.motes.setCount(tier.particles);
        this.clouds.setCount(tier.clouds);
      },
    });
  }

  /** Register a prop module that needs per-frame updates / tier changes. */
  register(module: {
    update?: (dt: number, t: number, camera: THREE.Camera) => void;
    onTier?: (tier: QualityTier) => void;
  }): void {
    if (module.update) this.extraUpdate.push(module.update);
    if (module.onTier) this.extraTier.push(module.onTier);
  }

  update(dt: number, t: number, camera: THREE.Camera): void {
    this.sky.update(camera);
    this.sea.update(camera);
    for (const fn of this.extraUpdate) fn(dt, t, camera);
  }

  applyTier(tier: QualityTier): void {
    const grid = tier.name === 'MAX' || tier.name === 'HIGH' ? 1024 : 512;
    if (grid !== this.island.gridSize) {
      this.island.bake(grid);
    }
    this.sea.setNearSegments(tier.seaSegments);
    for (const fn of this.extraTier) fn(tier);
  }

  dispose(): void {
    this.island.dispose();
    this.sea.dispose();
    this.motes.dispose();
    this.clouds.dispose();
  }
}
