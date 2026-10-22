/**
 * The sea — Gerstner-style swell computed from *world* coordinates so the
 * camera-following near plane can move without the waves swimming. Fresnel
 * reflects the procedural sky, the moon leaves a moving glint, foam hugs the
 * shore, and bioluminescent algae glow in the shallows over the lagoon.
 */
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  color,
  float,
  mix,
  pow,
  max,
  dot,
  reflect,
  normalize,
  sin,
  cos,
  length,
  smoothstep,
  step,
  time,
  vec2,
  vec3,
  positionLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
  transformNormalToView,
  mx_noise_float,
} from 'three/tsl';

import { P } from '../util/palette.js';
import { skyColor, uMoonDir } from './sky.js';

// Deep-water dispersion: omega = sqrt(g * 2π / λ). A quiet night sea.
interface Wave {
  angle: number;
  wavelength: number;
  amp: number;
}
const WAVES: Wave[] = [
  { angle: 0.5, wavelength: 34, amp: 0.5 },
  { angle: 2.2, wavelength: 21, amp: 0.3 },
  { angle: 4.4, wavelength: 12.5, amp: 0.17 },
  { angle: 1.2, wavelength: 7.4, amp: 0.09 },
  { angle: 5.5, wavelength: 4.3, amp: 0.05 },
];

function waveOmega(w: Wave): number {
  return Math.sqrt(9.81 * ((2 * Math.PI) / w.wavelength));
}

/** Wave elevation at a world-space xz node. */
function elevationAt(xz: Node<'vec2'>): Node<'float'> {
  let e: Node<'float'> = float(0);
  for (const w of WAVES) {
    const k = (2 * Math.PI) / w.wavelength;
    const phase = xz.x
      .mul(float(Math.cos(w.angle)))
      .mul(float(k))
      .add(xz.y.mul(float(Math.sin(w.angle))).mul(float(k)))
      .add(time.mul(float(waveOmega(w))));
    e = e.add(float(w.amp).mul(sin(phase)));
  }
  return e;
}

export class Sea {
  readonly near: THREE.Mesh;
  readonly far: THREE.Mesh;
  private nearMaterial: THREE.MeshStandardNodeMaterial;
  private farMaterial: THREE.MeshStandardNodeMaterial;
  private segments = 0;

  constructor(segments = 256) {
    this.segments = segments;

    // ---- near plane: animated surface that follows the camera ------------
    const nearGeo = this.makeNearGeometry(segments);
    const nearMat = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
      metalness: 0.12,
      roughness: 0.3,
      fog: true,
    });

    const xzW = vec2(positionWorld.x, positionWorld.z);

    // Gerstner displacement: vertical sine + horizontal cosine drag.
    let dx: Node<'float'> = float(0);
    let dz: Node<'float'> = float(0);
    for (const w of WAVES) {
      const k = (2 * Math.PI) / w.wavelength;
      const om = waveOmega(w);
      const phase = xzW.x
        .mul(float(Math.cos(w.angle)))
        .mul(float(k))
        .add(xzW.y.mul(float(Math.sin(w.angle))).mul(float(k)))
        .add(time.mul(float(om)));
      const drag = float(0.28).mul(float(w.amp));
      dx = dx.add(float(Math.cos(w.angle)).mul(float(k)).mul(drag).mul(cos(phase)));
      dz = dz.add(float(Math.sin(w.angle)).mul(float(k)).mul(drag).mul(cos(phase)));
    }
    nearMat.positionNode = positionLocal.add(vec3(dx, elevationAt(xzW), dz));

    // Normal via finite differences of the elevation function.
    const shift = float(0.9);
    const eC = elevationAt(xzW);
    const eX = elevationAt(vec2(positionWorld.x.add(shift), positionWorld.z));
    const eZ = elevationAt(vec2(positionWorld.x, positionWorld.z.add(shift)));
    const n = vec3(eC.sub(eX).div(shift), float(1), eC.sub(eZ).div(shift)).normalize();
    nearMat.normalNode = transformNormalToView(n);

    // Surface shading.
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1).sub(max(dot(normalWorld, viewDir), float(0))), float(3));
    const reflDir = normalize(reflect(viewDir.negate(), normalWorld));
    let c = mix(color(P.seaDeep), skyColor(reflDir), fresnel.mul(float(1.25)).saturate());

    // Moon glint.
    const glint = pow(max(dot(reflDir, uMoonDir), float(0)), float(140)).mul(float(6));
    c = c.add(color(P.moon).mul(glint));

    // Shore foam.
    const r = length(positionWorld.xz);
    const shore = smoothstep(float(1250), float(900), r);
    // Perlin output is bounded ~[-1, 1] at unit amplitude; keep it there.
    const foamN = mx_noise_float(
      xzW.mul(vec2(0.055, 0.055)).add(time.mul(vec2(0.012, 0.017))),
    );
    const foam = step(float(0.55), foamN).mul(shore).mul(foamN.mul(float(0.5)).add(float(0.5)));
    c = c.add(color(P.foam).mul(foam.mul(float(0.3))));

    nearMat.colorNode = c;

    // Bioluminescent algae in the shallows.
    const shallow = smoothstep(float(620), float(140), r);
    const algaeN = mx_noise_float(xzW.mul(vec2(0.02, 0.02)), float(1), time.mul(float(0.16)));
    const algaePulse = float(0.55).add(float(0.45).mul(sin(time.mul(float(0.45)))));
    nearMat.emissiveNode = color(P.seaGlow)
      .mul(shallow)
      .mul(algaeN.mul(float(0.5)).add(float(0.5)))
      .mul(algaePulse)
      .mul(float(0.55));

    this.nearMaterial = nearMat;
    this.near = new THREE.Mesh(nearGeo, nearMat);
    this.near.position.y = 0;

    // ---- far plane: calm shimmering water out to the horizon --------------
    const farGeo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
    farGeo.rotateX(-Math.PI / 2);
    const farMat = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
      metalness: 0.12,
      roughness: 0.25,
      fog: true,
    });
    const vDir = normalize(cameraPosition.sub(positionWorld));
    const fr = pow(float(1).sub(max(dot(normalWorld, vDir), float(0))), float(3));
    const rd = normalize(reflect(vDir.negate(), normalWorld));
    farMat.colorNode = mix(color(P.seaDeep), skyColor(rd), fr.mul(float(1.25)).saturate());
    this.farMaterial = farMat;
    this.far = new THREE.Mesh(farGeo, farMat);
    this.far.position.y = -0.35;
  }

  private makeNearGeometry(segments: number): THREE.PlaneGeometry {
    const geo = new THREE.PlaneGeometry(1400, 1400, segments, segments);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  update(camera: THREE.Camera): void {
    // Both planes track the camera; the far plane's shading is world-space and
    // it has no displacement, so nothing swims. This makes the sea effectively
    // infinite no matter how far the user flies.
    this.near.position.set(camera.position.x, 0, camera.position.z);
    this.far.position.set(camera.position.x, -0.35, camera.position.z);
  }

  /** Swap the near plane's grid resolution on tier changes. */
  setNearSegments(segments: number): void {
    if (segments === this.segments) return;
    this.segments = segments;
    const old = this.near.geometry;
    this.near.geometry = this.makeNearGeometry(segments);
    old.dispose();
  }

  dispose(): void {
    this.near.geometry.dispose();
    this.far.geometry.dispose();
    this.nearMaterial.dispose();
    this.farMaterial.dispose();
  }
}
