/**
 * The light rig — moonlight key (soft VSM shadows), warm horizon rim from
 * the sunset afterglow, IBL generated from the procedural sky, and an
 * animated two-octave height-band fog that settles over the lowlands.
 */
import * as THREE from 'three/webgpu';
import {
  color,
  float,
  fog,
  positionWorld,
  time,
  triNoise3D,
  densityFogFactor,
  vec3,
} from 'three/tsl';

import { P } from '../util/palette.js';
import { uMoonDir, uSunDir, SkyDome, SKY_DOME_RADIUS } from '../world/sky.js';

export class LightRig {
  readonly moon: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;

  constructor(private scene: THREE.Scene) {
    // Moonlight key.
    this.moon = new THREE.DirectionalLight(P.moon, 2.6);
    this.moon.position.copy(uMoonDir.value).multiplyScalar(3200);
    this.moon.target.position.set(0, 0, 0);
    this.moon.castShadow = true;
    const cam = this.moon.shadow.camera;
    cam.left = -2100;
    cam.right = 2100;
    cam.top = 2100;
    cam.bottom = -2100;
    cam.near = 1100;
    cam.far = 5400;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.radius = 16;
    this.moon.shadow.blurSamples = 24;
    this.moon.shadow.bias = -0.00018;
    this.scene.add(this.moon, this.moon.target);

    // Warm afterglow rim from the sun's bearing (no shadows — it's twilight).
    this.rim = new THREE.DirectionalLight(P.afterglow, 0.5);
    this.rim.position.copy(uSunDir.value).multiplyScalar(3200);
    this.scene.add(this.rim);

    // Animated fog: a height band (solid in the lowlands, wobbly top edge)
    // plus a distance haze so the far peaks dissolve into the horizon.
    const nA = triNoise3D(positionWorld.mul(vec3(0.004, 0.009, 0.004)), float(0.31), time.mul(float(0.05)));
    const nB = triNoise3D(positionWorld.mul(vec3(0.009, 0.018, 0.009)), float(0.7), time.mul(float(0.07)));
    const top = float(150).add(nA.add(nB).sub(float(0.5)).mul(float(90)));
    const heightFog = top.sub(positionWorld.y).div(top.sub(float(-8))).saturate().mul(float(0.94));
    const distFog = densityFogFactor(float(0.00115));
    this.scene.fogNode = fog(color(P.fog), heightFog.max(distFog));
  }

  applyQuality(shadows: boolean, shadowSize: number): void {
    if (this.moon.castShadow === shadows) {
      this.moon.shadow.mapSize.set(shadowSize || 1024, shadowSize || 1024);
      return;
    }
    this.moon.castShadow = shadows;
    if (!shadows && this.moon.shadow.map) {
      this.moon.shadow.map.dispose();
      this.moon.shadow.map = null;
    }
    if (shadows) this.moon.shadow.mapSize.set(shadowSize, shadowSize);
  }

  dispose(): void {
    this.scene.remove(this.moon, this.moon.target, this.rim);
    (this.moon.shadow.map as THREE.Texture | null)?.dispose?.();
  }
}

/**
 * Bake image-based lighting from the procedural sky so PBR materials get
 * the same twilight ambience the dome shows. Runs once, before the loop.
 */
export function generateSkyIBL(worldScene: THREE.Scene, renderer: THREE.WebGPURenderer): void {
  const iblScene = new THREE.Scene();
  const dome = new SkyDome();
  iblScene.add(dome.mesh);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(iblScene, 0.1, 1, SKY_DOME_RADIUS * 1.05);
  worldScene.environment = target.texture;
  worldScene.environmentIntensity = 0.5;
  dome.mesh.geometry.dispose();
  (dome.mesh.material as THREE.Material).dispose();
  pmrem.dispose();
}
