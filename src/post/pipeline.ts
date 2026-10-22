/**
 * Post pipeline — the `RenderPipeline` graph.
 *
 * WebGPU backend, full stack (postLevel 0):
 *   prePass (opaque, MRT: packed normal + velocity)
 *     → GTAO (half-res, temporal) feeding the scene via builtinAOContext
 *     → scenePass → TRAA (temporal AA)
 *     → + bloom → rgb shift → film grain
 *   (ACES tone map + sRGB are applied automatically by the pipeline)
 *
 * WebGL fallback:
 *   scenePass (MSAA ×4) → + bloom → rgb shift → film grain
 *   (GTAO/TRAA are WebGPU-only; MSAA stands in for TRAA)
 *
 * Light tiers (postLevel 1) skip GTAO + TRAA on both backends and rely on
 * MSAA instead — the rebuild is cheap: only `outputNode` rewiring + needsUpdate.
 */
import {
  RenderPipeline,
  UnsignedByteType,
  type Camera,
  type Node,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  builtinAOContext,
  float,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  sample,
  screenUV,
  unpackRGBToNormal,
  velocity,
} from 'three/tsl';
import GTAONode, { ao } from 'three/addons/tsl/display/GTAONode.js';
import BloomNode, { bloom } from 'three/addons/tsl/display/BloomNode.js';
import FilmNode, { film } from 'three/addons/tsl/display/FilmNode.js';
import RGBShiftNode, { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';
import TRAANode, { traa } from 'three/addons/tsl/display/TRAANode.js';

export class PostPipeline {
  readonly pipeline: RenderPipeline;

  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly webgpu: boolean;

  /** Nodes this class created — disposed on rebuild. */
  private owned: { dispose(): void }[] = [];

  constructor(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: Camera,
    webgpu: boolean,
    postLevel: 0 | 1 = 0,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.webgpu = webgpu;

    this.pipeline = new RenderPipeline(renderer);
    this.applyPostLevel(postLevel);
  }

  /** Rebuild the graph for a tier's post level. Cheap: node rewiring only. */
  applyPostLevel(postLevel: 0 | 1): void {
    for (const node of this.owned) node.dispose();
    this.owned.length = 0;

    // Temporal path (GTAO + TRAA) only exists on the WebGPU backend.
    const useTemporal = this.webgpu && postLevel === 0;
    const samples = useTemporal ? 0 : 4;

    // MSAA passes only need the resolved colour buffer.
    //
    // NOTE: the multisampled buffers must stay *stored* (non-transient).
    // The transmissive crystal material uses a `viewportTexture()` node
    // internally, whose `updateBefore` copies the bound framebuffer
    // mid-pass: the WebGPU backend then ends and *resumes* the render pass
    // with `LoadOp::Load`. Resuming a transient (store=false) attachment is
    // a WebGPU validation error. Storing the buffers makes the resume valid;
    // the extra bandwidth cost is acceptable on the MSAA (light-tier) path.
    const msaa = {
      samples,
      storeMultisampledColorBuffer: true,
      storeMultisampledDepthBuffer: true,
      storeMultisampledStencilBuffer: true,
      resolveColorBuffer: true,
      resolveDepthBuffer: false,
      resolveStencilBuffer: false,
    };

    const scenePass = pass(this.scene, this.camera, msaa);
    this.owned.push(scenePass);

    let beauty: Node<'vec4'> = scenePass;

    if (useTemporal) {
      // Opaque pre-pass: packed normal + per-fragment velocity for GTAO/TRAA.
      const prePass = pass(this.scene, this.camera, msaa);
      prePass.transparent = false;
      prePass.setMRT(
        mrt({
          output: packNormalToRGB(normalView),
          velocity,
        }),
      );
      // 8-bit normals are enough for GTAO — big bandwidth saving.
      prePass.getTexture('output').type = UnsignedByteType;
      this.owned.push(prePass);

      const preNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
      const preDepth = prePass.getTextureNode('depth');
      const preVelocity = prePass.getTextureNode('velocity');

      const aoNode: GTAONode = ao(preDepth, preNormal, this.camera);
      aoNode.resolutionScale = 0.5;
      aoNode.scale.value = 0.85;
      aoNode.thickness.value = 1.0;
      aoNode.samples.value = 16;
      aoNode.useTemporalFiltering = true;
      this.owned.push(aoNode);

      // The AO term reaches every PBR material's ambient via a built-in context.
      scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
      scenePass.needsUpdate = true;

      const traaNode: TRAANode = traa(scenePass, preDepth, preVelocity, this.camera);
      traaNode.useSubpixelCorrection = false;
      this.owned.push(traaNode);

      beauty = traaNode;
    }

    // Bloom is the additive part only — the base image is added back by hand.
    const bloomNode: BloomNode = bloom(beauty, 1.05, 0.55, 0.5);
    this.owned.push(bloomNode);

    const image = beauty.add(bloomNode);

    const shiftNode: RGBShiftNode = rgbShift(image, 0.00055);
    this.owned.push(shiftNode);

    const filmNode: FilmNode = film(shiftNode, float(0.12));
    this.owned.push(filmNode);

    this.pipeline.outputNode = filmNode;
    this.pipeline.needsUpdate = true;
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    for (const node of this.owned) node.dispose();
    this.owned.length = 0;
    this.pipeline.dispose();
  }
}
