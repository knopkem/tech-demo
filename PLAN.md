# LUMEN HOLLOW — Implementation Plan

A **fully procedural, zero-asset** Three.js flight demo: a bioluminescent alien archipelago at
night. The user flies through a glowing crystal world at deep night — reflective sea, luminous
lagoon, star-filled sky, moonlight, drifting particles, floating islands — with a cinematic
auto-flight intro, full post-processing (GTAO/TRAA/bloom/grade), adaptive quality, and
synthesized audio.

**The claim:** this is the graphical ceiling of Three.js in a browser, with *nothing downloaded*
(no models, no textures, no HDR files, no audio files — everything generated in code).

---

## 0. Verified environment (three 0.186.1)

All APIs below were **verified against the installed package** (`node_modules/@types/three@0.186.0`)
and the **official r186 example sources** (downloaded to `_reference/`). Do not guess APIs —
consult this section, `_reference/`, and the `.d.ts` files first.

- `package.json`: `three@0.186.1` (pinned), `@types/three@0.186.0`, `vite`, `typescript`
- `three/webgpu` exports: `WebGPURenderer` (+ `forceWebGL`, `antialias`, `samples`, `powerPreference`, `getFallback` params),
  `WebGLBackend`, `WebGPUBackend`, `RenderPipeline`, `PostProcessing` (deprecated — use `RenderPipeline`),
  `PMREMGenerator` (common; `.fromScene(scene, sigma?, near?, far?, options?)`), all core classes, all node materials
  (`NodeMaterial`, `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, `PointsNodeMaterial`, `SpriteNodeMaterial`, ...), all nodes
- `three/tsl` exports (verified): `pass(scene, camera, options?)` → `PassNode`, `mrt({...})`, `sample(fn)`, `screenUV`,
  `normalView`, `velocity`, `packNormalToRGB`, `unpackRGBToNormal`, `colorSpaceToWorking`, `builtinAOContext`,
  `uniform`, `Fn`, `Loop`, `varying`, `time`, `range`, `storage`, `instancedBufferAttribute`, `instanceIndex`,
  `positionLocal`, `positionWorld`, `normalWorld`, `normalView`, `cameraPosition`, `uv`, `screenUV`, `texture`,
  `mix`, `smoothstep`, `step`, `clamp`, `saturate`, `remap`, `pow`, `exp`, `sin`, `cos`, `dot`, `cross`, `normalize`,
  `length`, `hash`, `fract`, `vec2/3/4`, `color`, `float`, `int`, `bool`, `output`, `oneMinus`, `triNoise3D(pos, seed, time)`,
  `mx_noise_float`, `densityFogFactor`, `fog(color, factor)`, `shapeCircle`, `rotateUV`, `onFrameUpdate`, `pmremTexture`, ...
  **`noise`/`fbm` do NOT exist in core TSL** — compose value-noise/fbm yourself from `hash`/`fract`/`mix`/`smoothstep`
  (pattern in `_reference/webgpu_tsl_procedural_terrain.js` using `Loop` + `mx_noise_float`)
- `three/addons/tsl/display/*.js` (runtime files exist): `ao` (GTAONode: `samples`, `radius`, `scale`, `thickness`,
  `resolutionScale`, `useTemporalFiltering`, `getTextureNode()`), `ssao`, `bloom(node, strength?, radius?, threshold?)`,
  `film(node, intensity?, uv?)`, `rgbShift` / `ChromaticAberrationNode`, `godrays`, `traa(beauty, depth, velocity, camera)`,
  `taau`, `smaa`, `fxaa`, `sss`, `ssr`
- `three/addons/objects/SkyMesh.js` — atmospheric-scattering sky w/ clouds (turbidity/rayleigh/mie/sunPosition/cloud* uniforms)
- `three/addons/generators/TerrainGenerator.js` — CPU-baked mountain range mesh (`.build()`, `.sampleHeight(x,z)`,
  `.sampleSlope(x,z)`, `.heights` Float32Array, `.material` MeshStandardNodeMaterial, `parameters.size/seaLevel/erosion/...`)
- `three/addons/generators/ForestGenerator.js` — instanced tree carpet (`.build(terrain)`, `.setCameraPosition(v)`, count up to 500k)
- `three/addons/capabilities/WebGPU.js` — `WebGPU.isAvailable()`, `WebGPU.getErrorMessage()`
- `three/addons/controls/{PointerLockControls,FirstPersonControls,FlyControls}.js`
- `scene.environmentIntensity`, `scene.fogNode`, `scene.backgroundNode` are typed (verify exact location via grep if tsc complains)
- `NeutralToneMapping` (7), `ACESFilmicToneMapping` in core constants
- Renderer lifecycle: `new WebGPURenderer({...})` → `await renderer.init()` → `renderer.render(scene, camera)`;
  `setPixelRatio`, `setSize`, `setAnimationLoop`, `toneMapping`, `toneMappingExposure`,
  `shadowMap {enabled, type}`, light `shadow.radius` / `shadow.blurSamples`
- **Backend detection (CORRECTION):** there is no `renderer.api` property. Use
  `renderer.backend instanceof WebGPUBackend` (`WebGPUBackend` is exported from `three/webgpu`;
  `renderer.backend` is typed `Backend` on the base `Renderer`). The `WebGPU` capabilities helper
  (`three/addons/capabilities/WebGPU.js`) is a **default** export: `import WebGPU from ...; WebGPU.isAvailable()`.
- **Swizzle typing (CORRECTION):** bare `Node` has NO `.x/.y/.xz` accessors. Swizzle getters are attached by a
  `declare module` augmentation in `@types/three/.../tsl/TSLCore.d.ts` **only to typed nodes**
  (`Node<'vec2'>`, `Node<'vec3'>`, ...). Type TSL helper params as `Node<'vec2'>`/`Node<'vec3'>`,
  accumulators as `let n: Node<'float'> = float(0)` (`float(0)` infers a narrow `VarNode` type that
  rejects later `Node<'float'>` reassignment). At runtime swizzles always exist (return `SplitNode`).
- **`mx_noise_float(texcoord?, amplitude?, pivot?)`** = `perlin(pivot + texcoord) * amplitude` —
  output range ±amplitude (default 1 → ~[-1,1]). Never pass "scale" in the amplitude slot; scale in JS.
  (`perlin` here is three's 2D/3D permutation perlin via `vec2|vec3` convert; texcoord may be 2D or 3D.)
- **`BufferGeometry.clear()` does NOT exist** in 0.186 — use a `deleteAttribute('position'/'normal'/'uv')` loop.
- Node method math accepts raw numbers (`node.mul(2.0)`, `smoothstep(-0.02, 0.24, node)`); `time` is a global
  auto-updated uniform; `uniform(vector3)` → `UniformNode<'vec3', Vector3>` with `.value`.
- `ForestGenerator.build(terrain)` (verified in source) reads exactly: `terrain.parameters.size`,
  `terrain.minY`, `terrain.maxY`, `terrain.sampleHeight(x,z)`, `terrain.sampleSlope(x,z)`;
  geometry gets per-vertex `ao` + per-instance `region` + `cull` attrs; `build()` returns a `Group`;
  `setCameraPosition(v)` each frame.
- **WebGPU transient-MSAA × transmission pitfall (r186.1, verified on device):**
  `ViewportSharedTextureNode` (used *internally* by `transmission` materials) copies the bound
  framebuffer in `updateBefore` → `WebGPUBackend.copyFramebufferToTexture()` sees the active pass,
  ends it, copies, then **resumes it with `loadOp=Load` while the cached `storeOp` stays
  `Discard`** ⇒ per-frame `GPUValidationError` on any transient attachment
  (`storeMultisampled*Buffer: false` ⇒ `TRANSIENT_ATTACHMENT` usage). Fix: keep
  `storeMultisampled*Buffer: true` on MSAA pass render targets (non-transient ⇒ resume valid;
  `resolve*` flags keep the AA output). The official bloom example never hits this — no
  transmission in its scene. (Diagnosis: CDP-intercepted every `encoder.beginRenderPass` —
  `load/discard` calls appeared only after a tier rebuild + with transmissive objects in scene.)

### Canonical patterns (see `_reference/` for full sources)

```js
// — boot —                                    // webgpu_pmrem_scene / webgpu_postprocessing
renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: false });
await renderer.init();                          // required before first render
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setAnimationLoop(animate);

// — post pipeline —                           // webgpu_postprocessing + _ao + _bloom + _traa
renderPipeline = new THREE.RenderPipeline(renderer);
const prePass = pass(scene, camera);
prePass.transparent = false;
prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity: velocity }));
const prePassNormal = sample(uv => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
const prePassDepth = prePass.getTextureNode('depth');
const prePassVelocity = prePass.getTextureNode('velocity');
const scenePass = pass(scene, camera);
const aoNode = ao(prePassDepth, prePassNormal, camera);          // from three/addons/tsl/display/GTAONode.js
scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
scenePass.needsUpdate = true;
const traaNode = traa(scenePass, prePassDepth, prePassVelocity, camera);
const bloomNode = bloom(traaNode, 1.0, 0.6, 0.5);                // from .../BloomNode.js
renderPipeline.outputNode = bloomNode;                           // (+ film/rgbShift chained in)
renderPipeline.needsUpdate = true;
// in animate: renderPipeline.render();

// — procedural terrain (GPU-displaced standard node material) —  // webgpu_tsl_procedural_terrain
material = new THREE.MeshStandardNodeMaterial({ ... });
material.positionNode = Fn(() => { /* fBm via Loop + mx_noise_float; neighbour-diff normals */ })();
material.normalNode = transformNormalToView(vNormal);
material.colorNode = Fn(() => { /* height/slope banding via varyings */ })();

// — sea (Gerstner + emissive) —               // webgpu_tsl_raging_sea
material.positionNode = positionLocal.add(vec3(0, elevation, 0)); // elevation = sin waves + noise via time
material.emissiveNode = emissiveColor.mul(elevation.remap(a, b).pow(p));

// — particles —                               // webgpu_particles (smoke/fire) + webgpu_instance_points
mat = new THREE.SpriteNodeMaterial();
mat.colorNode = ...; mat.opacityNode = ...; mat.positionNode = range(min, max).mul(lifeTime);
mat.scaleNode = ...; mat.blending = THREE.AdditiveBlending; mat.depthWrite = false;
const instanced = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
instanced.count = 2000;                              // GPU-driven, zero per-frame CPU

// — fog / background —                        // webgpu_custom_fog
scene.fogNode = fog(groundColor, fogArea);           // fogArea from triNoise3D + densityFogFactor(haze)
scene.backgroundNode = normalWorld.y.max(0).mix(groundColor, skyColor);
```

---

## 1. Product definition & acceptance criteria

- `npm run dev` → Vite server; open http://localhost:5173 → **start card** ("LUMEN HOLLOW — click to begin")
- Click → pointer lock, audio starts, **cinematic auto-flight** (~60 s spline) until user input
- WASD+R/F flight with banking/boost; **C** re-enters cinematic; **Esc** → pause card
- Zero network requests after page load (all procedural; verify in devtools)
- 60 fps on an M-series Mac at default tier (adaptive quality steps down if needed)
- `npm run typecheck` and `npm run build` pass
- Visual targets: readable glow silhouettes from 500 m+; lagoon glows under water; moon glints on sea;
  stars + moon + afterglow; crystals read as wet glass; fog hides all world edges; AO grounds objects in hollows
- Works on both backends (`renderer.api` reported in HUD); WebGL fallback degrades gracefully (MSAA instead of TRAA/GTAO)

## 2. Architecture

```
index.html                 — canvas mount + HUD DOM (#start, #hud, #pause) + <style> (all CSS inline)
src/
  main.ts                  — boot sequence: renderer init → world → controls → pipeline → loop
  style.css                — HUD styling (imported by main.ts)
  world/
    World.ts               — composition root: builds everything into one Scene; owns per-frame update(dt, t, camera)
    island.ts              — CPU island terrain (single source of truth: shape fn + baked buffers)
    sea.ts                 — Gerstner sea (near, camera-follow) + far calm plane
    sky.ts                 — sky dome (custom TSL: twilight + stars + moon) + shared skyColor(dir) fn
    crystals.ts            — instanced spires + 6 hero monoliths (transmission) + point lights
    forest.ts              — glowing flora: ForestGenerator restyle OR instanced mushrooms (fallback)
    rocks.ts               — instanced boulders
    floatingIslands.ts     — 4 distant inverted terrain blobs + crystals + mist columns
    waterfall.ts           — cliff sheet (TSL scrolling noise) + base mist
    particles.ts           — SpriteNodeMaterial GPU motes (drift + twinkle)
    clouds.ts              — 40 procedural fbm billboards, drifting
  lighting/
    rig.ts                 — moon dir light (VSM shadows), warm horizon rim, IBL from PMREM(skyScene), envIntensity
  post/
    pipeline.ts            — RenderPipeline graph; branches on renderer.api (WebGPU: GTAA+TRAA; WebGL: MSAA)
  controls/
    flyControls.ts         — pointer-lock flight: accel/damp, R/F, Shift boost+FOV, banking, terrain collision
    cinematic.ts           — Catmull-Rom spline + lookahead + smooth handoff/return
  ui/
    hud.ts                 — start card, hints, crosshair, FPS, altitude, backend badge, quality tier
    audio.ts               — WebAudio synth: wind + pad + proximity crystal chimes (gesture-gated)
  util/
    noise.ts               — 2D simplex (Ashima) + fbm2/ridged in TS; the CPU side of the shape function
    sky.ts (TSL)           — skyColor(dir) shared by dome/sea/fog (TSL node)
    quality.ts             — adaptive quality: EMA frame-time → tier changes
    palette.ts             — all colors as constants (single source of truth)
_reference/                — official r186 example sources (already downloaded; never import from here)
README.md                  — (P5) overview, run, controls, feature/tech notes
.gitignore                 — node_modules, dist
```

**Rules (non-negotiable):**
1. Import 3D classes from `three/webgpu` (`import * as THREE from 'three/webgpu'`), TSL fns from `three/tsl`,
   addons from `three/addons/...`. DOM-only addons (controls) may import from `three`.
2. **No GLSL ShaderMaterial for surfaces** — node materials only (WebGPU can't compile raw GLSL).
3. **No external assets** — no loaders, no URL fetches, no data URLs with remote content. Runtime-generated
   canvas textures are allowed (e.g. a fallback sprite for particles).
4. One shared island shape function (`util/noise.ts`) used by: terrain bake, object placement, camera
   collision, foam/lagoon masks. GPU materials must not re-derive the macro shape; they only add micro detail.
5. Every frame: exactly `world.update(dt, t, camera)` + `controls.update(dt, t, camera)` + `pipeline.render()`.

## 3. World spec

**Dimensions:** island 2.4 km span (centered at origin), sea level y=0, ridge peaks ~320 m, lagoon r≈300 m
(floor −8 m), sea plane 1.2 km camera-following (256², Gerstner) + 40 km far plane, sky dome 120 km (follows camera),
far mountain rings 2–6 km out in fog, floating islands at 0.6–1.4 km / 100–250 m altitude.

### 3.1 Island (`world/island.ts`)
- CPU bake: 1024² grid (2.3 m cells; LOW tier → 512²). `geometry.deleteAttribute('uv'/'normal')` then bake.
- Height = `radialFalloff(r) * (fbm2(xz*0.0008, 5 oct) * 180 + ridged2(xz*0.0022) * 140 * ridgeBand)`
  `− lagoonCarve(r)` `+ beachRamp`; add a NW cliff (steep mask) and SE forest bowl. Tune until: max ≈ 320 m,
  lagoon floor −8 m, beach band −2…+6 m.
- Bake attributes (Float32/Uint8, per-vertex): position (+y=height), normal (central differences),
  `aColor` (albedo: wet sand → dark moss → rock → pale mineral caps, by height+slope+moisture),
  `aRough`, `aGlow` (lagoon-shallows + moss-vein mask), `aHeight`.
- Material: `MeshStandardNodeMaterial({ vertexColors: true, fog: true })` with
  `colorNode = color * (0.85 + 0.3 * fbmTsl(posWorld*8))` (micro mottle),
  `roughnessNode = aRough`, `emissiveNode = teal * aGlow * (0.6 + 0.4 * triNoise3D(posWorld*0.15, 1, time*0.1))`
  (pulsing bioluminescence). If `vertexColors` doesn't drive node material color, read `aColor` via an attribute node.
- `castShadow = receiveShadow = true`.
- Export `sampleHeight(x, z)` (bilinear over the `heights` array) + `sampleSlope` for placement & collision.
- **Fallback path:** if attribute-node access is awkward, bake albedo into `color` attribute and keep the
  rest procedural in TSL. Never move macro shape into the shader.

### 3.2 Sea (`world/sea.ts`)
- Near plane 1.2 km, 256², `MeshStandardNodeMaterial`, double-sided, fog true.
  `positionNode` = 4–5 Gerstner directions (amp 0.4–1.2 m, wavelength 8–40 m) via `time`;
  analytic `normalNode = transformNormalToView(normal)` (neighbour-diff like raging_sea).
- Fragment: fresnel = pow(1−dot(N, V), 3) mix(`deepColor #052029`, `sky.ts skyColor(reflectDir)`);
  moon glint = pow(max(dot(R, moonDir),0), 120) * moonColor * 8; foam = fbmTsl(worldXZ*0.8 + drift) *
  shoreMask(distance-to-island-edge from aGlow-ish mask or island.sampleHeight near 0);
  algae glow = `emissiveNode = #37f2d8 * shallowMask * pulse`.
- Far plane: 40 km, 1×1, same material minus Gerstner (calm), so the horizon shimmers; seam hidden by fog.
- Underwater: material is double-sided + a full-screen `#02151d` tint overlay when camera.y < 0 (see HUD).

### 3.3 Sky (`world/sky.ts`)
- `skyColor(dir)` TSL fn (shared with sea/fog): `mix(horizonTeal #0e3a3f, zenithIndigo #0b1030, smoothstep(0, .55, dir.y))`
  `+ afterglow: pow(max(dot(dir, sunDir), 0), 10) * #ff7a4d * band` (sun below horizon)
  `+ stars: hashGrid(dir) twinkle * smoothstep(.05,.3,dir.y) * night` `+ moon: disc(moonDir, .013) + halo`.
  All inputs are uniforms; stars twinkle via `time`.
- Dome: `SphereGeometry(120000, 32, 16)`, `MeshBasicNodeMaterial` (or NodeMaterial) `side: BackSide`,
  `fog: false`, `depthWrite: false`, `renderOrder: -10`; follow camera each frame.
- IBL: after building the dome, `pmrem = new PMREMGenerator(renderer); scene.environment = pmrem.fromScene(skyScene, 0.08).texture; scene.environmentIntensity = 0.45`.

### 3.4 Crystals (`world/crystals.ts`)
- Spire geometry: 6-sided bipyramid (CylinderGeometry trick or LatheGeometry with 6 radial segments,
  scale y 4–9 m, slight twist) — one `InstancedMesh` count ≈ 400.
- `MeshPhysicalNodeMaterial`: roughness 0.18, metalness 0.1, clearcoat 1, clearcoatRoughness 0.25,
  iridescence 1 / iridescenceIOR 1.3 **if the pinned build supports it on the active backend** (verify; else 0),
  `emissiveNode = veinPattern(positionLocal * perInstanceHue) * pulse(instancePhase)` (TSL fbm veins),
  per-instance hue via `InstancedBufferAttribute` (cyan #40f0ff / violet #b06bff / teal #2affc4 / amber #ffb340).
- Placement: on ridge lines + beach ring + lagoon edge, sampled from `island.sampleHeight`/slope, random rot/scale.
- 6 hero monoliths (8–14 m): classic `MeshPhysicalMaterial` **transmission: 1, thickness 2, ior 1.45, roughness 0.06**
  + inner core mesh (emissive `MeshBasicNodeMaterial`, pulsing) + `PointLight` (6 total, warm/cool mix, distance ~40, decay 2).
- All spires `castShadow = true`.

### 3.5 Flora (`world/forest.ts`)
- **Primary:** `ForestGenerator({ count: 18000, ... })` built on a *compatible stand-in terrain object* exposing
  `sampleHeight/sampleSlope/minY/maxY/parameters.size` (wrap our island) — verify its expectations by reading
  `node_modules/three/examples/jsm/generators/ForestGenerator.js`. Restyle `forest.material`:
  `emissiveNode` = glow tips (crown gradient * teal/violet, pulsing), `colorNode` darker.
  Call `forest.setCameraPosition(camera.position)` each frame (distance-gated detail).
- **Fallback:** if ForestGenerator integration fights us: ~1200 instanced mushrooms (stem cylinder + squashed
  icosphere cap, `MeshStandardNodeMaterial` emissiveNode pulse, per-instance phase).

### 3.6 Rocks / floating islands / waterfall / clouds / particles
- Rocks: 250 instanced deformed icosahedra (deterministic vertex jitter), `MeshStandardNodeMaterial` grey, cliff bases.
- Floating islands: 4 × mini island bake (same shape fn, inverted radial mask → chunk), 64² grid each,
  few crystals each, `SpriteNodeMaterial` mist column below (additive, fbm alpha, slow pulse).
- Waterfall: strip plane on the cliff; `MeshBasicNodeMaterial` `AdditiveBlending`:
  `alpha = fbmTsl(vec2(uv.x*3, uv.y*6 − time*2.5)) * edgeFade`, white-teal; `emissive`-like via basic + tone;
  mist billboard at base.
- Clouds: 40 instanced planes (SpriteNodeMaterial pattern), y 200–500 m, scale 80–350 m, drifting slowly,
  `opacityNode = fbmTsl(uv*2 + time*0.02) * 0.5`, `NormalBlending`, depthWrite false — only above sea/island.
- Particles: ~15k (high tier) instanced sprites in a 2.5 km box × 0–300 m;
  `positionNode = base + drift(time + instanceIndex)`, twinkle `opacityNode`, sizes 0.1–0.5 m,
  additive; palette cyan/teal/violet. `renderer.clearDepth()` NOT needed (they're in the scene).

### 3.7 Far mountains (`world/` via generators)
- 2–3 `TerrainGenerator({ size: ~3000–6000, segments: 128–256, heightScale, seaLevel, erosion, warp })`
  rings at 2–6 km, rotated to frame the island; restyle `material` colors dark; `ForestGenerator` on the nearest
  one if cheap. These live in fog — cheap silhouette depth.

## 4. Lighting & atmosphere (`lighting/rig.ts`, `post/pipeline.ts`)

- **Moon:** `DirectionalLight(#cfe0ff, ~2.2)` (physically-scaled), elevation ~55°, azimuth chosen for
  glint path across the sea; `castShadow`, ortho frustum covering island + nearest crystals,
  `mapSize` 2048 (tier-dependent), `shadow.radius`/`blurSamples` (VSM) — check
  `_reference/webgpu_shadowmap_vsm.js` for the exact enablement in 0.186.
- **Horizon rim:** `DirectionalLight(#ff8a5c, ~0.6)`, low angle, no shadows.
- **IBL:** as in 3.3 (scene.environment + environmentIntensity 0.45).
- **Fog:** `scene.fogNode = fog(groundColor, fogArea)` — `fogArea = max(heightBand, distanceHaze)`:
  height band via `positionWorld.y` (solid below sea+2, fading by ~120 m) + `densityFogFactor(0.0011)`;
  animate with two `triNoise3D` octaves (`webgpu_custom_fog.js` pattern). Color ≈ `#0a1622` (teal-indigo).
- **Tonemapping:** `ACESFilmicToneMapping`, exposure 1.15 (tune in P4). `renderer.outputColorSpace` default sRGB.

**Post graph (`post/pipeline.ts`):**
```
WebGPU api:
  prePass(MRT: packed normal + velocity, transparent=false, samples=0)
  scenePass(samples=0, contextNode = builtinAOContext(gtao sample))
  gtao = ao(preDepth, preNormal, camera)  resolutionScale 0.5, scale ~0.85, thickness ~1, temporal on
  out = film( rgbShift( bloom( traa(scenePass, preDepth, preVel, camera), 1.1, 0.55, 0.5 ) , 0.0006 ), grainIntensity )
WebGL api:
  scenePass(samples=4)
  out = film( rgbShift( bloom( scenePass, 1.1, 0.55, 0.5 ), 0.0006 ), grainIntensity )
renderPipeline.outputNode = out   (rebuild + needsUpdate on tier change)
```
Bloom threshold ~0.5, strength ~1.1, radius ~0.55 (tune in P4) — emissives are the bloom drivers.

## 5. Flight, cinematic, HUD, audio

- **flyControls:** `PointerLockControls` for look (sensitivity 0.0022) + custom velocity:
  accel 40 m/s², max 55 m/s (Shift boost 170 m/s), exponential damp `v *= exp(-8*dt)` style,
  R/F vertical, FOV 75→83 on boost (lerp), bank roll = lerp toward lateral accel × 0.08 rad.
  Collision: `y = max(y, island.sampleHeight(x, z) + 2.5)` with 12%/frame lerp (no pop); no ceiling;
  no other collisions. Water entry allowed (tint overlay).
- **cinematic:** `CatmullRomCurve3` closed loop, ~10 waypoints (lagoon 35 m → between crystal fields 80 m →
  ridge 180 m → beach 25 m → over sea 30 m → cliff top 240 m → 450 m → star pull-up), 60 s loop;
  lookAt = point 6% ahead + gentle sin sway; any key/mouse-move → 1.2 s blend to manual; **C** re-enters.
- **HUD (`ui/hud.ts`):** start card (title, tagline, "click to begin", control list) → click:
  `controls.lock()`, `audio.start()`; unlock → pause card; crosshair dot; FPS (2 Hz) + altitude readout;
  backend badge (`renderer.api`); quality-tier toast. CSS: monospace, `#7df3e1` glow, letter-spacing, thin rules.
- **audio (`ui/audio.ts`):** all synthesized on first gesture — wind (looped noise buffer → lowpass 300–900 Hz
  LFO), pad (3 detuned triangle oscs 55/82.4/110 Hz → lowpass, gain 0.04, slow LFOs), chimes (proximity to hero
  crystals < 60 m: sine 550–1100 Hz pentatonic, exp decay 1.5 s, StereoPanner by bearing, rate-limited 1.2 s).
  Duck master gain on pause. No audio files.

## 6. Performance (`util/quality.ts`)

- Draw-call budget ≈ 15 (island 1, near-sea 1, far-sea 1, sky 1, spires 1, heroes 6 + cores 6, forest 1,
  rocks 1, islands 4, waterfall 1, mist/clouds/particles 3, mountains ≤ 6).
- Frame-time EMA (500 ms window) → tiers:
  | tier | dpr | shadows | particles | clouds | sea grid | island grid | GTAA/TRAA |
  |---|---|---|---|---|---|---|---|
  | MAX | 2.0 | 2048 VSM | 15k | 40 | 256² | 1024² | on |
  | HIGH | 1.5 | 1024 | 8k | 28 | 192² | 768² | on |
  | MED | 1.0 | off | 4k | 18 | 160² | 512² | off |
  | LOW | 0.75 | off | 2k | 10 | 128² | 512² | off |
- Step down after 3 s > 22 ms; step up after 10 s < 14 ms; rebuild dependent resources (dispose old).
- Tab hidden → `setAnimationLoop(null)`; visible → resume; context lost → show card.

## 7. Phases (build in order; each must pass `npm run typecheck` + `npm run build`)

- **P0 — boot + graybox flyable world:** scaffold files (`.gitignore`, `style.css`, `index.html` HUD),
  `main.ts` boot (renderer init, api badge, loop, resize), `flyControls` (v1), flat sea (plain material),
  island CPU bake v1 (heights + vertexColors only), gradient sky (simple TSL or basic), exp fog.
  **Exit:** fly a gray island at night; typecheck+build green; dev server serves.
- **P1 — hero surfaces:** island PBR material (3.1), sea v1 (3.2), full sky (3.3), IBL rig, moon shadows (VSM), fog v1.
  **Exit:** night look; 60 fps MAX tier on M-series.
- **P2 — props:** crystals (3.4), forest (3.5), rocks, floating islands, waterfall, far mountains (3.7).
  **Exit:** populated world, ≤ ~25 draw calls.
- **P3 — atmosphere:** particles, clouds, full fog (height band + haze, animated), star/moon polish.
- **P4 — post:** pipeline (WebGPU: GTAA+TRAA; WebGL: MSAA), bloom/grade tuning, exposure pass.
  **Exit:** screenshot-worthy; both backends verified to render.
- **P5 — presentation:** cinematic, HUD final, audio, adaptive quality, README, final tuning pass.
- **P6 — hardening:** resize/visibility/context-loss handling, edge cases (flying through waterfall, deep sea,
  max altitude), perf re-check at each tier, `npm run build` smoke (preview).

## 8. Risks & fallbacks

| Risk | Mitigation |
|---|---|
| TSL method/param drift vs 0.186 | Verify in `.d.ts` + `_reference/` before use (this plan is pre-verified; re-verify anything new) |
| `vertexColors`/attribute nodes on node materials | Fallback: bake albedo into `color` attribute; keep glow/rough in TSL |
| iridescence/transmission incomplete on WebGPU | Verify at runtime (`renderer.api`); degrade: clearcoat+emissive spires; heroes → non-transmission glassy PBR |
| GTAA/TRAANode on the WebGL fallback backend (`WebGLNodesHandler`) | Branch post graph on `renderer.api` (MSAA path); if GTAA throws on WebGL, skip AO there |
| PMREM-from-scene under WebGPU | Works per `_reference/webgpu_pmrem_scene.js`; fallback: `RoomEnvironment`-style dark generated env |
| ForestGenerator coordinate/expectation mismatch | Read its source; fallback = instanced mushrooms (3.5 fallback) |
| Safari WebGPU quirks | Auto WebGL2 backend fallback is built in; both paths must render (degraded post is acceptable) |
| Session scope creep | Phases are the contract: P0→P6, no new features; tuning knobs only |

## 10. Build status (live)

| Phase | State | Notes |
|---|---|---|
| P0 boot + graybox | ✅ done | scaffold, main.ts boot, controls, HUD, audio stubs |
| P1 hero surfaces | ✅ done | island CPU bake + canvas maps, sea (Gerstner near + far), shared TSL sky (`util/sky.ts`), VSM moon, fog, IBL |
| P2 props | ✅ done | crystals + 6 hero monoliths, ForestGenerator flora, rocks, 4 floating islands w/ mist — registered in `World.ts` |
| P3 atmosphere | ✅ done | `world/particles.ts` (15k GPU motes via `range()`), `world/clouds.ts` (40 noise sheets) — both tier-scaled |
| P4 post | ✅ done | `post/pipeline.ts` — WebGPU: prePass(MRT normal+velocity)→GTAO(half-res,temporal)→TRAA→bloom→rgbShift→film; WebGL/light: MSAA×4 same tail. Verified on-device in headless Chrome |
| P5 presentation | ✅ done | cinematic + HUD + synthesized audio wired, README, path-vs-terrain clearance check (min +9.28 m over 8k spline samples) |
| P6 hardening | ✅ done | context-loss card, sea far-plane follows camera, adaptive tier cycle test, WebGPU MSAA/transmission validation fix (§0) |

- `npm run typecheck` + `npm run build` green (bundle 269 kB gzip).
- Runtime smoke (headless Chrome, WebGPU): zero console/shader errors, zero exceptions, ~21 draw calls/frame (25.5k cumulative), 1.7M tris/frame, MAX tier, cinematic t advancing.
- Tier cycle test (MAX→LOW→MED→MAX, forced): zero console errors, pixel ratios 2.0/0.75/1.0 confirmed.
- Fixed P4: cinematic `getPointAt(u)` crashed when u escaped [0,1] — root cause: rAF timestamp vs `performance.now()` skew makes `dt` briefly negative (worst after a `visibilitychange` reset); `getUtoTmapping` does not clamp. Fix: clamp dt to [0, 0.1] in the loop + normalize `Cinematic.t` to [0,1).
- Fixed P6: WebGPU MSAA validation errors every frame on MSAA tiers — transmission material's internal `viewportTexture()` node resumes the render pass with `Load` on a transient attachment (see §0). Fix: `storeMultisampled*Buffer: true` in `post/pipeline.ts`.

## 9. Definition of done

`npm install && npm run dev` on the author's Mac: one click from card to a 60-second cinematic of a glowing
alien archipelago, then free flight at 60 fps with shadows, AO, bloom, stars, sea, and synthesized sound —
and the DevTools network tab proves the world costs exactly one request.
