# LUMEN HOLLOW

A **fully procedural, zero-asset** Three.js flight demo: a bioluminescent alien
archipelago at night. Click to begin, fly with the mouse, and fly *through* a
glowing world — reflective sea, luminous lagoon, star-filled sky, moonlight,
15,000 drifting motes, crystal monoliths, a whisper of wind — with nothing
downloaded. No models, no textures, no HDRIs, no audio files: every pixel and
every sound is generated in code.

Build in one pass (8h) using qwen3.8-27B-4bit (M4 Max 36GB). 

```
npm install
npm run dev        # develop (Vite, port 5173)
npm run build      # production build
npm run preview    # serve the production build
npm run typecheck  # strict TypeScript gate
```

Best in a recent Chrome/Edge with **WebGPU** (the page detects it and falls
back to a WebGL2 path automatically — the badge in the top-right corner shows
which one you got).

## Controls

| Key | Action |
|---|---|
| click | begin (also unlocks pointer lock; audio starts here) |
| mouse | look |
| `W A S D` | fly |
| `R` / `F` | rise / sink |
| `SHIFT` | boost |
| `C` | hand off to / resume the cinematic auto-flight |
| `ESC` | pause |

On load the camera runs an **80-second closed Catmull-Rom tour** of the world's
vantage points (lagoon pass → forest bowl → ridge overlook → crystal fields →
open sea → a 680 m star pull-up). Any input blends you out of it; `C` blends
you back in.

## What it shows

- **Terrain** — the island is baked on the CPU from layered 2-D simplex noise
  (rolling base + ridged NW arc + lagoon carve) into a canvas-generated
  albedo/roughness map; the GPU adds live mottling, slope-driven surfacing and
  a lagoon-glow band. One mesh, one draw.
- **Sea** — Gerstner swell computed from *world* coordinates in the vertex
  stage (a camera-following near plane + a far plane), Fresnel sky reflection,
  a moon glint, shoreline foam, and bioluminescent algae over the lagoon.
- **Sky** — one TSL radiance function (twilight gradient, afterglow band,
  hash-grid starfield, moon + halo) shared by the dome, the sea reflections and
  the IBL: the world always agrees with itself.
- **Props** — instanced crystal spires with GPU-animated emissive veins, six
  transmissive-glass hero monoliths with inner cores and point lights,
  `ForestGenerator` flora restyled as bioluminescent mushroom-coral, instanced
  boulders, four floating island chunks with mist columns.
- **Atmosphere** — up to 15k `SpriteNodeMaterial` motes (per-instance randoms
  from `range()`, bounded sine drift, twinkle, additive) and a 40-sheet
  noise-alpha cloud deck.
- **Post** — a `RenderPipeline` graph: opaque pre-pass (MRT packed normal +
  velocity) → GTAO (half-res, temporal) → TRAA → bloom → RGB shift → film
  grain, with ACES + sRGB applied by the pipeline. The WebGL2 fallback and the
  light quality tiers swap to an MSAA×4 pass with the same tail.
- **Audio** — synthesized WebAudio: brown-noise wind through an LFO-swept
  low-pass (it swells with flight speed), a three-oscillator dark pad,
  proximity-triggered pentatonic crystal chimes panned by bearing, and a muffle
  filter when you dive below sea level.
- **Adaptive quality** — a frame-time EMA steps through four tiers (pixel ratio,
  shadows, particle counts, sea resolution, post level); heavy resources are
  rebuilt live, the toast in the corner announces the change.

> **Manual verification:** the headless smoke test can't click, so the audio
> (autoplay policy) and pointer-lock flight need a real browser: click the start
> card, fly near a hero monolith (chime), dive below a shoreline (muffle +
> underwater vignette), and hold `SHIFT` (wind swells).

## Quality tiers

| Tier | Pixel ratio | Shadows | Motes | Clouds | Sea | Post |
|---|---|---|---|---|---|---|
| MAX | 2.0 | VSM 2048 | 15 000 | 40 | 256 | GTAO+TRAA+bloom |
| HIGH | 1.5 | VSM 1024 | 8 000 | 28 | 192 | GTAO+TRAA+bloom |
| MED | 1.0 | off | 4 000 | 18 | 160 | MSAA+bloom |
| LOW | 0.75 | off | 2 000 | 10 | 128 | MSAA+bloom |

## Layout

```
src/
  main.ts               boot, loop, quality wiring, __demo debug hook
  world/
    World.ts            composition root; per-frame + tier registration
    island.ts           CPU-baked terrain (height → canvas albedo/roughness)
    sea.ts              Gerstner near + far planes (TSL vertex displacement)
    sky.ts              dome; re-exports the shared sky model
    crystals.ts         spires + hero monoliths (+ flight-corridor exclusion)
    forest.ts           ForestGenerator flora, bioluminescent restyle
    rocks.ts            instanced boulders
    floatingIslands.ts  four hanging chunks + mist
    particles.ts        motes (range() per-instance randoms)
    clouds.ts           noise-alpha cloud deck
  lighting/rig.ts       moon key (VSM), rim, IBL, height-band fog
  controls/
    flyControls.ts      pointer-lock flight (velocity, boost, terrain clamp)
    cinematic.ts        closed Catmull-Rom tour; WAYPOINTS exported for checks
  post/pipeline.ts      RenderPipeline graph (backend-branching)
  ui/hud.ts             cards, crosshair, telemetry, toasts
  ui/audio.ts           synthesized ambience
  util/
    noise.ts            CPU simplex/ridged fbm + canonical islandHeight()
    palette.ts          all colours + hero crystal specs
    quality.ts          tiers + frame-time EMA
    sky.ts              the one TSL sky radiance model
```

## Design notes

- **One sky, three uses.** `util/sky.ts` is a single TSL function of view
  direction; the dome, the sea's fresnel reflection and the IBL all call it, so
  reflections, fog tint and ambient light can't disagree.
- **World-space animation.** Sea waves, crystal veins and mote drift all read
  *world* coordinates (or per-instance buffers), so nothing "swims" when the
  camera-following near plane moves.
- **CPU/GPU agreement.** Everything that must sit on the terrain (crystals,
  flora, rocks, camera collision, the cinematic path check) samples the same
  canonical `islandHeight()` the mesh is baked from.
- **Crystals never stand under the flight path.** The placement loop rejects
  candidates inside a corridor mask rasterized from the cinematic spline, so
  the autopilot can never clip a spire — a build-time exclusion is a perfect
  runtime guarantee because the world is static.
- **Zero assets, verified.** No loaders, no `fetch`, no data-URL textures;
  the only runtime canvas is the terrain albedo/roughness bake.
