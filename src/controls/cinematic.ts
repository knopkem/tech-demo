/**
 * Cinematic auto-flight — a closed centripetal Catmull-Rom loop through the
 * world's best vantage points. The camera eases onto the spline on entry and
 * eases off on user input, so hand-off feels like a camera cut, not a jump.
 */
import * as THREE from 'three/webgpu';

/**
 * Waypoints of the closed flight loop. Altitudes are verified against the
 * canonical terrain (util/noise.ts `islandHeight`) — see the path-check
 * script used at design time: every point of the spline must clear the
 * surface and any 13 m spire that could stand there.
 */
export const WAYPOINTS: [number, number, number][] = [
  [380, 26, 0], // lagoon rim
  [40, 15, 0], // low pass over the lagoon
  [-430, 88, 350], // forest bowl (terrain 68.6 m — flies over the ridge bowl)
  [-640, 205, 540], // ridge overlook
  [250, 88, -520], // crystal fields
  [780, 20, 250], // beach (clears the 13 m spires on the shore)
  [1650, 26, 640], // approaching the sea
  [3000, 48, 1150], // open water
  [-1200, 320, -900], // above the cliffs
  [40, 540, -2400], // high flight
  [950, 680, -750], // star pull-up
];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Cinematic {
  private curve = new THREE.CatmullRomCurve3(
    WAYPOINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true,
    'centripetal',
  );
  private duration = 80;
  private t = 0;
  private blend = 1; // 0 = manual, 1 = fully cinematic (starts in cinematic)

  get active(): boolean {
    return this.blend > 0.001;
  }

  /** Start/keep the cinematic; blends in over ~1.4 s. */
  enter(): void {
    this.blend = Math.max(this.blend, 0.001);
  }

  /** User took control — blend out, then stop. */
  exit(): void {
    // Blend out handled in update (target 0)
  }

  /** Resync the spline clock to wherever the camera roughly is. */
  resync(camera: THREE.Camera): void {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      this.curve.getPointAt(u, _pos);
      const d = _pos.distanceToSquared(camera.position);
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    this.t = best;
  }

  update(dt: number, t: number, camera: THREE.Camera, userActive: boolean): void {
    const rate = 1 - Math.exp(-3.2 * dt);
    if (userActive) {
      this.blend = Math.max(0, this.blend - rate * (this.blend / 0.35));
    } else {
      this.blend = Math.min(1, this.blend + rate);
    }
    if (this.blend <= 0.001) return;

    this.t = (this.t + dt / this.duration) % 1;
    // getPointAt() requires u in [0,1] (no clamping upstream); keep it there.
    if (!Number.isFinite(this.t) || this.t < 0 || this.t >= 1) this.t = 0;

    this.curve.getPointAt(this.t, _pos);
    this.curve.getPointAt((this.t + 0.05) % 1, _look);

    // Gentle handheld sway so the autopilot never feels robotic.
    _look.x += Math.sin(t * 0.11) * 9;
    _look.y += Math.sin(t * 0.067) * 5;
    _look.z += Math.cos(t * 0.09) * 9;

    const w = this.blend * rate;
    camera.position.lerp(_pos, w);

    _m.lookAt(camera.position, _look, _up);
    _q.setFromRotationMatrix(_m);
    camera.quaternion.slerp(_q, w);
  }
}
