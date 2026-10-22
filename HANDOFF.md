# HANDOFF — LUMEN HOLLOW

A fully procedural, zero-asset bioluminescent alien archipelago you fly through at night,
built to show the ceiling of Three.js graphics (WebGPU/TSL, GTAO+TRAA+bloom, adaptive
quality, synthesized audio). **All phases complete** — status detail in `PLAN.md` §10.

## Run it

```
npm install
npm run dev        # http://localhost:5173 — click the start card
npm run build      # then: npm run preview
```

One click → 60 s cinematic → free flight. Audio and pointer-lock need a real pointer
gesture; everything else works headless.

## Verify (all currently green)

```
npm run typecheck && npm run build
# headless (from the repo root, servers as above):
node /private/var/folders/qt/cyqkdkgd009g2cf39f99gdgw0000gn/T/opencode/smoke.mjs http://localhost:4173/
node /private/var/folders/qt/cyqkdkgd009g2cf39f99gdgw0000gn/T/opencode/tier-test.mjs http://localhost:4173/
```

Both report `console errors: 0 / exceptions: 0`. (`Vite build does NOT run tsc — run
typecheck and build separately; the preview serves `dist/` from disk, so a rebuild is
enough, no restart.)

## The one gotcha that bit us (do not "optimize" this away)

`src/post/pipeline.ts` sets `storeMultisampled*Buffer: true` on the MSAA passes.
This looks like it throws away the transient-attachment bandwidth win from the official
bloom example — **it must stay true.** The transmissive crystal material uses a
`viewportTexture()` node internally; `WebGPUBackend.copyFramebufferToTexture()` then
ends and *resumes* the active render pass with `LoadOp::Load`, and the cached
`storeOp` stays `Discard`. On a transient attachment that is a per-frame
`GPUValidationError` (see `PLAN.md` §0 for the full writeup). The official bloom
example never hits this because its scene has no transmission.

## Layout

- `src/main.ts` — boot, `window.__demo` debug hook (`renderer`, `scene`, `cinematic`, `quality.setTier(n)`), dt clamp, GPU context-loss card
- `src/world/` — island/sea/sky/crystals/flora/rocks/islands/clouds/particles (all TSL, zero assets)
- `src/post/pipeline.ts` — the `RenderPipeline` graph + adaptive rebuild (see gotcha)
- `src/audio/` — synthesized WebAudio ambience
- `src/ui/` — HUD
- `_reference/` — downloaded official r186 example sources (consult before touching node code)
- `PLAN.md` — §0 verified-API notes, §10 live build status
