/**
 * LUMEN HOLLOW — boot sequence.
 *
 * renderer (WebGPU, auto-fallback to WebGL) → world → light rig + IBL →
 * controls + cinematic + hud + audio → animation loop with adaptive quality.
 */
import * as THREE from 'three/webgpu';
import { WebGPURenderer, WebGPUBackend, ACESFilmicToneMapping, VSMShadowMap } from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';

import './style.css';

import { World } from './world/World.js';
import { LightRig, generateSkyIBL } from './lighting/rig.js';
import { PostPipeline } from './post/pipeline.js';
import { FlyControls } from './controls/flyControls.js';
import { Cinematic } from './controls/cinematic.js';
import { Hud } from './ui/hud.js';
import { Ambience } from './ui/audio.js';
import { QualityManager, TIERS } from './util/quality.js';

const dprCap = Math.min(window.devicePixelRatio, 2);

async function boot(): Promise<void> {
  // --- renderer -------------------------------------------------------------
  const renderer = new WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(dprCap);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap;

  document.getElementById('app')!.appendChild(renderer.domElement);
  await renderer.init();

  const webgpu = renderer.backend instanceof WebGPUBackend;
  const api = webgpu ? 'WebGPU' : 'WebGL';
  if (!webgpu && WebGPU.isAvailable()) {
    console.warn('Lumen Hollow: WebGPU is available but the renderer fell back to WebGL2.');
  }

  // --- camera / world ---------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(
    72,
    window.innerWidth / window.innerHeight,
    0.5,
    300000,
  );
  camera.position.set(380, 26, 0);

  const world = new World();
  const rig = new LightRig(world.scene);
  generateSkyIBL(world.scene, renderer);
  const pipeline = new PostPipeline(renderer, world.scene, camera, webgpu);

  // --- ui / controls ------------------------------------------------------------
  const hud = new Hud();
  hud.setBackend(api);
  const ambience = new Ambience();
  const cinematic = new Cinematic();

  const controls = new FlyControls(camera, renderer.domElement, world.island);
  controls.onLock = () => {
    hud.hideCards();
    cinematic.exit(); // user took over
  };
  controls.onUnlock = () => {
    hud.showPause();
    ambience.suspend();
  };

  const begin = (): void => {
    if (!ambience.started) ambience.start();
    ambience.resume();
    hud.hideCards();
    controls.lock();
    cinematic.exit();
  };
  document.getElementById('start-card')!.addEventListener('click', begin);
  document.getElementById('pause-card')!.addEventListener('click', begin);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC' && controls.locked) {
      cinematic.enter();
    }
  });

  // --- adaptive quality ---------------------------------------------------------
  const quality = new QualityManager();
  quality.onTierChange = (tier) => {
    renderer.setPixelRatio(tier.pixelRatio * dprCap);
    rig.applyQuality(tier.shadows, tier.shadowSize);
    world.applyTier(tier);
    pipeline.applyPostLevel(tier.postLevel);
    hud.setTierName(tier.name);
  };
  quality.onTierChangeStart = (name) => {
    console.info(`Lumen Hollow: quality tier → ${name}`);
  };
  renderer.setPixelRatio(TIERS[quality.tier].pixelRatio * dprCap);
  rig.applyQuality(TIERS[quality.tier].shadows, TIERS[quality.tier].shadowSize);
  world.applyTier(TIERS[quality.tier]);
  pipeline.applyPostLevel(TIERS[quality.tier].postLevel);

  // Debug / smoke-test hook (needs everything above in scope).
  (window as unknown as Record<string, unknown>).__demo = {
    renderer,
    webgpu,
    api,
    cinematic,
    quality,
  };

  // --- context-loss safety net ---------------------------------------------------
  const onContextLost = (): void => {
    renderer.setAnimationLoop(null);
    ambience.suspend();
    hud.showGpuLost();
    document
      .getElementById('gpu-lost')!
      .addEventListener('click', () => location.reload(), { once: true });
  };
  if (webgpu) {
    // `device` exists at runtime but isn't declared on the class in the types.
    const device = (renderer.backend as unknown as { device?: GPUDevice | null }).device;
    device?.lost.then(() => onContextLost());
  } else {
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      onContextLost();
    });
  }

  // --- loop -----------------------------------------------------------------------
  let last = performance.now();
  let fpsEma = 60;
  let fpsClock = 0;
  const _prevPos = new THREE.Vector3().copy(camera.position);
  const _v = new THREE.Vector3();
  const _qi = new THREE.Quaternion();
  const heroPos = world.crystals.heroPositions();

  const frame = (now: number): void => {
    const t = now / 1000;
    let dt = (now - last) / 1000;
    last = now;
    // rAF timestamps and performance.now() can disagree by up to a frame
    // (worst right after a visibilitychange reset) — clamp to [0, 0.1] so no
    // downstream consumer (cinematic clock, quality EMA) sees a negative dt.
    dt = Math.min(Math.max(dt, 0), 0.1);

    fpsEma = fpsEma * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    fpsClock += dt;

    cinematic.update(dt, t, camera, controls.locked);
    if (controls.locked) controls.update(dt, t);
    world.update(dt, t, camera);

    pipeline.render();

    // --- ambience: wind by speed, muffle + chimes --------------------------------
    const speed = dt > 1e-4 ? camera.position.distanceTo(_prevPos) / dt : 0;
    _prevPos.copy(camera.position);
    ambience.setWind(speed);

    if (ambience.started) {
      let best = 0;
      let bestBearing = 0;
      _qi.copy(camera.quaternion).invert();
      for (const p of heroPos) {
        _v.copy(p).sub(camera.position);
        const d2 = _v.lengthSq();
        if (d2 > 160000) continue; // 400 m
        _v.applyQuaternion(_qi);
        const prox = 1 - Math.sqrt(d2) / 400;
        if (prox > best) {
          best = prox;
          bestBearing = _v.x / (Math.abs(_v.x) + Math.abs(_v.z) + 1e-3);
        }
      }
      if (best > 0.02) ambience.chime(best, bestBearing, t);
    }

    if (fpsClock > 0.5) {
      fpsClock = 0;
      const under = camera.position.y < -0.4;
      hud.updateFrame(fpsEma, camera.position.y, TIERS[quality.tier].name, api);
      hud.setUnderwater(under);
      ambience.setUnderwater(under);
    }
    quality.sample(dt * 1000);
  };

  renderer.setAnimationLoop(frame);

  // --- housekeeping -----------------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
      ambience.suspend();
    } else {
      last = performance.now();
      renderer.setAnimationLoop(frame);
      ambience.resume();
    }
  });
}

boot();
