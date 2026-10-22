/**
 * Fly controls — pointer-lock mouse look with smoothed acceleration,
 * R/F vertical, Shift boost (with a FOV kick), subtle banking, and a soft
 * terrain collision so the world never clips through the ground.
 */
import * as THREE from 'three/webgpu';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

import { Island } from '../world/island.js';

const ACCEL = 42; // m/s²
const MAX_SPEED = 55;
const BOOST_ACCEL = 3.2;
const BOOST_SPEED = 175;
const DAMPING = 2.7;

export class FlyControls {
  readonly plc: PointerLockControls;

  private velocity = new THREE.Vector3();
  private keys = { f: false, b: false, l: false, r: false, up: false, down: false, boost: false };
  private baseQuaternion = new THREE.Quaternion();
  private roll = 0;
  private rollQuat = new THREE.Quaternion();
  private upAxis = new THREE.Vector3(0, 1, 0);
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private worldAccel = new THREE.Vector3();

  onLock: (() => void) | null = null;
  onUnlock: (() => void) | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private island: Island,
  ) {
    this.plc = new PointerLockControls(camera, domElement);
    this.plc.addEventListener('lock', () => this.onLock?.());
    this.plc.addEventListener('unlock', () => this.onUnlock?.());
    this.plc.addEventListener('change', () => {
      this.baseQuaternion.copy(this.camera.quaternion);
    });
    this.captureBase();

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
  }

  get locked(): boolean {
    return this.plc.isLocked;
  }

  lock(): void {
    this.plc.lock();
  }

  unlock(): void {
    this.plc.unlock();
  }

  private captureBase(): void {
    this.baseQuaternion.copy(this.camera.quaternion);
  }

  private setKey(code: string, value: boolean): void {
    const k = this.keys;
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        k.f = value;
        break;
      case 'KeyS':
      case 'ArrowDown':
        k.b = value;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        k.l = value;
        break;
      case 'KeyD':
      case 'ArrowRight':
        k.r = value;
        break;
      case 'KeyR':
      case 'Space':
        k.up = value;
        break;
      case 'KeyF':
      case 'ControlLeft':
      case 'ControlRight':
        k.down = value;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        k.boost = value;
        break;
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.setKey(e.code, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.setKey(e.code, false);
  };

  update(dt: number, _t: number): void {
    const cam = this.camera;

    if (!this.plc.isLocked) {
      // Still settle banking and undo it when unlocked.
      this.applyRoll(Math.exp(-6 * dt));
      return;
    }

    cam.getWorldDirection(this.fwd);
    this.right.crossVectors(this.fwd, this.upAxis).normalize();

    const k = this.keys;
    const boost = k.boost;
    const accel = ACCEL * (boost ? BOOST_ACCEL : 1);

    this.worldAccel.set(0, 0, 0);
    if (k.f) this.worldAccel.addScaledVector(this.fwd, accel);
    if (k.b) this.worldAccel.addScaledVector(this.fwd, -accel);
    if (k.r) this.worldAccel.addScaledVector(this.right, accel);
    if (k.l) this.worldAccel.addScaledVector(this.right, -accel);
    if (k.up) this.worldAccel.y += accel;
    if (k.down) this.worldAccel.y -= accel;

    this.velocity.addScaledVector(this.worldAccel, dt);
    this.velocity.multiplyScalar(Math.exp(-DAMPING * dt));

    const maxSpeed = boost ? BOOST_SPEED : MAX_SPEED;
    const speed = this.velocity.length();
    if (speed > maxSpeed) this.velocity.multiplyScalar(maxSpeed / speed);

    // Move through the pointer-lock controls (camera-relative).
    const forwardDist = this.velocity.dot(this.fwd);
    const rightDist = this.velocity.dot(this.right);
    this.plc.moveForward(forwardDist * dt);
    this.plc.moveRight(rightDist * dt);
    cam.position.y += this.velocity.y * dt;

    // Soft terrain collision.
    const ground = this.island.sampleHeight(cam.position.x, cam.position.z) + 2.5;
    if (cam.position.y < ground) {
      cam.position.y += (ground - cam.position.y) * Math.min(1, 10 * dt);
      if (this.velocity.y < 0) this.velocity.y *= Math.exp(-8 * dt);
    }
    // Soft ceiling way above the interesting world.
    if (cam.position.y > 2600) cam.position.y -= (cam.position.y - 2600) * Math.min(1, 2 * dt);

    // Banking: lean into lateral motion.
    const targetRoll = THREE.MathUtils.clamp(-rightDist * 0.0022, -0.22, 0.22);
    this.roll += (targetRoll - this.roll) * Math.min(1, 4 * dt);
    this.applyRoll(1);

    // FOV kick with speed.
    const targetFov = 72 + 13 * THREE.MathUtils.clamp(speed / BOOST_SPEED, 0, 1);
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, 5 * dt);
      cam.updateProjectionMatrix();
    }
  }

  private applyRoll(decay: number): void {
    this.roll *= decay < 1 ? decay : 1;
    this.rollQuat.setFromAxisAngle(this.upAxis, this.roll);
    this.camera.quaternion.copy(this.baseQuaternion).multiply(this.rollQuat);
    if (decay < 1) this.baseQuaternion.copy(this.camera.quaternion); // keep unrolled base
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this.plc.dispose();
  }
}
