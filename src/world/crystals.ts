// Instanced crystal spires + six hero monoliths.
//
// Spires are one InstancedMesh (one draw). Per-instance hue and phase live in
// InstancedBufferAttributes, so the GPU animates 400 glowing veins with zero
// per-frame CPU work. Heroes are real transmissive glass with inner cores and
// point lights; their positions double as the audio chime attractors.

import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalMaterial,
  MeshPhysicalNodeMaterial,
  Object3D,
  PointLight,
  Vector2,
  Vector3,
  type Node,
  type Scene,
} from 'three/webgpu';
import {
  color,
  instancedBufferAttribute,
  mx_noise_float,
  positionLocal,
  sin,
  smoothstep,
  time,
  vec3,
} from 'three/tsl';

import { CRYSTAL_HUES, HERO_CRYSTALS } from '../util/palette.js';
import { mulberry32 } from '../util/noise.js';
import { WAYPOINTS } from '../controls/cinematic.js';
import type { Island } from './island.js';

const _dummy = new Object3D();
const _color = new Color();

function crystalGeometry(radialSegments = 6, width = 0.55): LatheGeometry {
  const profile = [
    new Vector2(0.0, 0.0),
    new Vector2(width * 0.7, 0.08),
    new Vector2(width, 0.32),
    new Vector2(width * 0.82, 0.72),
    new Vector2(width * 0.42, 0.92),
    new Vector2(0.0, 1.0),
  ];
  const geo = new LatheGeometry(profile, radialSegments);
  geo.computeVertexNormals();
  return geo;
}

export interface HeroLight {
  position: Vector3;
  color: Color;
}

/**
 * Coarse occupancy mask of the cinematic flight corridor. Spires never stand
 * inside it, so the autopilot loop (and anything flying along the spline) can
 * never clip a crystal. The world is static, so build-time exclusion is a
 * perfect runtime guarantee.
 */
function buildPathMask(): { half: number; res: number; n: number; mask: Uint8Array } {
  const curve = new CatmullRomCurve3(
    WAYPOINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    true,
    'centripetal',
  );
  const pts = curve.getSpacedPoints(600);
  const res = 4; // metres per cell
  const half = 1300; // covers the full spire placement range (r ≤ 1200 m)
  const n = Math.ceil((half * 2) / res);
  const mask = new Uint8Array(n * n);
  const R = 22; // > largest spire radius + camera buffer
  const brush = Math.ceil(R / res);
  for (const p of pts) {
    const cx = Math.floor((p.x + half) / res);
    const cz = Math.floor((p.z + half) / res);
    for (let dz = -brush; dz <= brush; dz++) {
      for (let dx = -brush; dx <= brush; dx++) {
        const ax = cx + dx;
        const az = cz + dz;
        if (ax < 0 || az < 0 || ax >= n || az >= n) continue;
        const wx = ax * res - half + res * 0.5;
        const wz = az * res - half + res * 0.5;
        const ddx = wx - p.x;
        const ddz = wz - p.z;
        if (ddx * ddx + ddz * ddz <= R * R) mask[az * n + ax] = 1;
      }
    }
  }
  return { half, res, n, mask };
}

export class Crystals {
  group: Mesh[] = [];
  spires: InstancedMesh;
  heroes: Mesh[] = [];
  heroLights: HeroLight[] = [];

  constructor(scene: Scene, island: Island, count = 400) {
    const rng = mulberry32(0x51c7a1);
    const pathMask = buildPathMask();

    const geometry = crystalGeometry(6, 0.55);
    const mat = new MeshPhysicalNodeMaterial({
      metalness: 0.08,
      roughness: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.22,
      iridescence: 0.5,
      iridescenceIOR: 1.3,
      envMapIntensity: 1.25,
    });

    const hueAttr = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const phaseAttr = new InstancedBufferAttribute(new Float32Array(count), 1);

    const hue = instancedBufferAttribute(hueAttr, 'vec3') as Node<'vec3'>;
    const phase = instancedBufferAttribute(phaseAttr, 'float') as Node<'float'>;

    const veins = mx_noise_float(
      vec3(
        positionLocal.x.mul(5.0),
        positionLocal.y.mul(2.8).add(phase.mul(7.0)),
        positionLocal.z.mul(5.0),
      ),
    )
      .mul(0.5)
      .add(0.5);
    const vein = smoothstep(0.42, 0.72, veins);
    const tip = smoothstep(0.45, 0.98, positionLocal.y);
    const pulse = sin(time.mul(1.35).add(phase.mul(9.0))).mul(0.28).add(0.72);

    mat.colorNode = color(0x061a24).mul(0.45).add(hue.mul(0.55));
    mat.emissiveNode = hue
      .mul(vein.mul(0.85).add(tip.mul(0.35)))
      .mul(pulse)
      .mul(2.1);

    const mesh = new InstancedMesh(geometry, mat, count);
    mesh.name = 'CrystalSpires';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 80) {
      attempts++;

      const angle = rng() * Math.PI * 2;
      const r = 260 + Math.pow(rng(), 0.72) * 940;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      // Flight-corridor exclusion: never plant a spire under the cinematic loop.
      const cx = Math.floor((x + pathMask.half) / pathMask.res);
      const cz = Math.floor((z + pathMask.half) / pathMask.res);
      if (cx >= 0 && cz >= 0 && cx < pathMask.n && cz < pathMask.n && pathMask.mask[cz * pathMask.n + cx]) {
        continue;
      }

      const h = island.sampleHeight(x, z);
      const slope = island.sampleSlope(x, z);

      // Ridge lines, the beach ring, and the lagoon edge all attract crystals.
      const ridge = slope > 0.22 && h > 34;
      const beach = h > 0.5 && h < 14;
      const lagoonEdge = h > -3.5 && h < 4.5 && r < 650;
      const chance = ridge ? 0.78 : beach ? 0.5 : lagoonEdge ? 0.65 : 0;
      if (chance === 0 || rng() > chance) continue;

      const sy = 3.6 + Math.pow(rng(), 1.6) * 6.2;
      const sxz = 0.7 + rng() * 1.5;

      _dummy.position.set(x, Math.max(h, -3) - 0.25, z);
      _dummy.rotation.set((rng() - 0.5) * 0.22, rng() * Math.PI * 2, (rng() - 0.5) * 0.22);
      _dummy.scale.set(sxz, sy, sxz * (0.8 + rng() * 0.4));
      _dummy.updateMatrix();
      mesh.setMatrixAt(placed, _dummy.matrix);

      const hueHex = CRYSTAL_HUES[Math.floor(rng() * CRYSTAL_HUES.length)];
      _color.setHex(hueHex);
      hueAttr.setXYZ(placed, _color.r, _color.g, _color.b);
      phaseAttr.setX(placed, rng());

      placed++;
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    hueAttr.needsUpdate = true;
    phaseAttr.needsUpdate = true;
    scene.add(mesh);
    this.spires = mesh;
    this.group.push(mesh);

    // --- hero monoliths ---------------------------------------------------
    for (const hero of HERO_CRYSTALS) {
      const ground = island.sampleHeight(hero.x, hero.z);
      const baseY = Math.max(ground, -1.5) - 0.8;
      const hueColor = new Color(hero.hue);

      const glass = new MeshPhysicalMaterial({
        color: new Color(0x8fdfe6),
        metalness: 0,
        roughness: 0.055,
        transmission: 1,
        thickness: 2.6,
        ior: 1.45,
        attenuationColor: hueColor,
        attenuationDistance: 2.8,
        envMapIntensity: 1.6,
        transparent: true,
        iridescence: 0.35,
        iridescenceIOR: 1.3,
      });

      const geo = crystalGeometry(8, 0.95);
      const monolith = new Mesh(geo, glass);
      monolith.name = 'HeroMonolith';
      monolith.position.set(hero.x, baseY, hero.z);
      monolith.scale.set(1.5 + hero.height * 0.06, hero.height, 1.5 + hero.height * 0.06);
      monolith.rotation.y = Math.atan2(hero.z, hero.x) + 0.4;
      monolith.castShadow = true;
      monolith.receiveShadow = true;
      scene.add(monolith);
      this.heroes.push(monolith);
      this.group.push(monolith);

      const coreMat = new MeshBasicNodeMaterial({
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const coreColor = color(hero.hue);
      const corePulse = sin(time.mul(0.9).add(hero.x * 0.01)).mul(0.25).add(0.75);
      coreMat.colorNode = coreColor.mul(corePulse).mul(2.4);

      const core = new Mesh(geo, coreMat);
      core.position.copy(monolith.position);
      core.scale.copy(monolith.scale).multiplyScalar(0.52);
      core.rotation.copy(monolith.rotation);
      core.renderOrder = 4;
      scene.add(core);
      this.group.push(core);

      const light = new PointLight(hueColor, 34, 52, 2);
      light.position.set(hero.x, baseY + hero.height * 0.55, hero.z);
      light.castShadow = false;
      scene.add(light);

      this.heroLights.push({ position: new Vector3(hero.x, baseY + hero.height * 0.5, hero.z), color: hueColor });
    }
  }

  /** Convenience for placement/audio: ground height at each hero. */
  heroPositions(): Vector3[] {
    return this.heroLights.map((h) => h.position);
  }
}


