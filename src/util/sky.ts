// Shared TSL sky model. The visible dome, the sea reflection, the horizon
// background and (via a flat ground tint) the fog all agree on this one palette.

import { Vector3, type Node } from 'three/webgpu';
import {
  color,
  dot,
  exp,
  floor,
  fract,
  hash,
  length,
  max,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec3,
} from 'three/tsl';

import { PALETTE } from './palette.js';

/** Direction *towards* the moon (unit vector). Elevation ≈ 55°. */
export const MOON_DIR = new Vector3(-0.34, 0.82, 0.46).normalize();

/** Direction *towards* the set sun, just below the horizon. */
export const SUN_DIR = new Vector3(0.58, -0.09, -0.81).normalize();

export const moonDirection = uniform(MOON_DIR.clone());
export const sunDirection = uniform(SUN_DIR.clone());

const zenith = color(PALETTE.zenithIndigo);
const upper = color(PALETTE.upperIndigo);
const horizon = color(PALETTE.horizonTeal);
const afterglow = color(PALETTE.afterglow);
const moonColor = color(PALETTE.moon);
const starColor = color(0xdcefff);

/**
 * Night sky radiance for a unit view direction. Values above 1 are intentional:
 * they are the bloom drivers (moon disc, star cores, afterglow).
 */
export function skyColor(direction: Node<'vec3'>): Node<'vec3'> {
  const d = normalize(direction);

  const horizonToUpper = smoothstep(-0.02, 0.24, d.y);
  const upperToZenith = smoothstep(0.16, 0.72, d.y);

  const base = mix(mix(horizon, upper, horizonToUpper), zenith, upperToZenith);

  // Afterglow: warm band hugging the horizon around the set sun.
  const sunDot = max(dot(d, sunDirection), 0);
  const band = exp(max(d.y, 0).mul(-7));
  const warm = pow(sunDot, 8).mul(0.7).add(pow(sunDot, 48).mul(0.5));
  const glow = afterglow.mul(warm).mul(band);

  // Sparse star field: hash cells on the direction sphere, keep the bright few.
  const p = d.mul(260);
  const cell = floor(p) as Node<'vec3'>;
  const local = (fract(p) as Node<'vec3'>).sub(0.5);
  const rnd = hash(cell.x.add(cell.y.mul(57.31)).add(cell.z.mul(113.7)));
  const point = vec3(
    hash(rnd.add(1.37)),
    hash(rnd.add(7.71)),
    hash(rnd.add(13.19)),
  ).sub(0.5).mul(0.66);
  const dStar = length(local.sub(point));
  const starCore = smoothstep(0.16, 0.0, dStar);
  const twinkle = sin(time.mul(1.6).add(rnd.mul(97.0))).mul(0.45).add(0.55);
  const starMask = step(0.9955, rnd).mul(starCore).mul(twinkle);
  const starHorizon = smoothstep(0.02, 0.3, d.y);
  const stars = starColor.mul(starMask).mul(starHorizon).mul(2.6);

  // Moon disc + tight halo.
  const md = max(dot(d, moonDirection), 0);
  const disc = smoothstep(0.99984, 0.99994, md);
  const halo = pow(md, 260).mul(0.55).add(pow(md, 24).mul(0.045));
  const moon = moonColor.mul(disc.mul(5.5).add(halo));

  return base.add(glow).add(stars).add(moon);
}

/** Flat sky tint used for distance fog (kept darker than the horizon). */
export const fogTint = color(PALETTE.fog);
