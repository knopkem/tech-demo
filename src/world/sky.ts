/**
 * The night sky — one TSL radiance function of view direction, shared by the
 * sky dome, the sea's reflections and (indirectly) the fog. One function,
 * three uses: the world always agrees with itself.
 *
 * The model itself lives in `../util/sky.js` (twilight gradient, afterglow
 * band, hash-grid starfield, moon + halo). This module builds the visible
 * dome and re-exports the shared nodes for the sea and the light rig.
 */
import {
  BackSide,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  type Camera,
} from 'three/webgpu';
import { cameraPosition, normalize, positionWorld } from 'three/tsl';

import { MOON_DIR, SUN_DIR, fogTint, moonDirection, skyColor, sunDirection } from '../util/sky.js';

export { skyColor, fogTint, MOON_DIR, SUN_DIR };

/** Shared moon / sun direction uniforms (see util/sky). */
export const uMoonDir = moonDirection;
export const uSunDir = sunDirection;

export const SKY_DOME_RADIUS = 120000;

/** A huge inward-facing dome that follows the camera. */
export class SkyDome {
  readonly mesh: Mesh;

  constructor() {
    const geometry = new SphereGeometry(SKY_DOME_RADIUS, 48, 24);
    const material = new MeshBasicNodeMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    material.colorNode = skyColor(normalize(positionWorld.sub(cameraPosition)));

    this.mesh = new Mesh(geometry, material);
    this.mesh.renderOrder = -10;
  }

  update(camera: Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
