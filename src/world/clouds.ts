/**
 * A thin cloud deck — ~40 horizontal, noise-shaded planes at 220–520 m that
 * slowly wander above the archipelago. One draw call; alpha is a 3-octave
 * perlin lobe so each sheet reads as a soft cloud rather than a card.
 */
import {
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  PlaneGeometry,
  Vector3,
  type Node,
  type Scene,
} from 'three/webgpu';
import {
  color,
  cos,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  range,
  sin,
  smoothstep,
  time,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

const BOUND = 2600;

/** Three octaves of perlin, ~[-1, 1]. */
function fbm(xz: Node<'vec2'>): Node<'float'> {
  const n1 = mx_noise_float(xz);
  const n2 = mx_noise_float(xz.mul(2.1).add(vec2(3.1, 1.7)));
  const n3 = mx_noise_float(xz.mul(4.3).add(vec2(7.9, 4.2)));
  return n1.mul(float(0.55)).add(n2.mul(float(0.3))).add(n3.mul(float(0.15)));
}

export class Clouds {
  readonly mesh: Mesh;
  readonly material: MeshBasicNodeMaterial;

  constructor(scene: Scene, maxCount = 40) {
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      fog: true, // distance haze fades far sheets; the height band stays clear above
    });

    // Per-instance randoms: home position, sheet size, drift seed.
    const home = range(new Vector3(-BOUND, 220, -BOUND), new Vector3(BOUND, 520, BOUND));
    const scale = range(90, 380);
    const seed = range(0, 60);

    // Slow bounded wander (±~140 m) so sheets never leave the sky.
    const wob = vec3(
      sin(time.mul(float(0.011)).add(seed)).mul(float(140)),
      sin(time.mul(float(0.007)).add(seed.mul(float(2.3)))).mul(float(24)),
      cos(time.mul(float(0.009)).add(seed.mul(float(1.7)))).mul(float(140)),
    );

    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2); // flat sheets, seen from below

    const pUv = uv();
    const n = fbm(
      pUv.mul(vec2(2.2, 1.6)).add(seed.mul(vec2(0.13, 0.07))).add(time.mul(vec2(0.004, 0.002))),
    );
    material.positionNode = positionLocal.mul(scale).add(home).add(wob);
    material.opacityNode = smoothstep(float(0.02), float(0.62), n)
      .mul(float(0.5))
      .mul(smoothstep(float(0.0), float(0.45), pUv.x.mul(pUv.y).mul(4.0))); // soft edges
    material.colorNode = mix(color(0x141d38), color(0x21404a), pUv.y);

    const mesh = new Mesh(geo, material);
    mesh.count = maxCount;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);

    this.mesh = mesh;
    this.material = material;
  }

  setCount(count: number): void {
    this.mesh.count = count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
