/**
 * Adaptive quality: watches the smoothed frame time and steps the world
 * through tiers. Applying a tier is delegated to callbacks (the world
 * rebuilds its heavy resources, the renderer changes pixel ratio).
 */

export interface QualityTier {
  name: 'MAX' | 'HIGH' | 'MED' | 'LOW';
  /** device-pixel-ratio multiplier */
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  particles: number;
  clouds: number;
  seaSegments: number;
  /** 0 = full post stack, 1 = light post stack */
  postLevel: 0 | 1;
}

export const TIERS: QualityTier[] = [
  { name: 'MAX', pixelRatio: 2.0, shadows: true, shadowSize: 2048, particles: 15000, clouds: 40, seaSegments: 256, postLevel: 0 },
  { name: 'HIGH', pixelRatio: 1.5, shadows: true, shadowSize: 1024, particles: 8000, clouds: 28, seaSegments: 192, postLevel: 0 },
  { name: 'MED', pixelRatio: 1.0, shadows: false, shadowSize: 0, particles: 4000, clouds: 18, seaSegments: 160, postLevel: 1 },
  { name: 'LOW', pixelRatio: 0.75, shadows: false, shadowSize: 0, particles: 2000, clouds: 10, seaSegments: 128, postLevel: 1 },
];

export class QualityManager {
  tier = 0;
  private ema = 16.7; // ms

  onTierChange: ((tier: QualityTier) => void) | null = null;
  onTierChangeStart: ((name: string) => void) | null = null;

  private downTimer = 0;
  private upTimer = 0;

  /** Call once per frame with the frame duration in ms. */
  sample(dtMs: number): void {
    this.ema = this.ema * 0.94 + dtMs * 0.06;
    if (this.ema > 22) {
      this.downTimer += dtMs / 1000;
      this.upTimer = 0;
      if (this.downTimer > 3 && this.tier < TIERS.length - 1) this.step(1);
    } else if (this.ema < 14) {
      this.upTimer += dtMs / 1000;
      this.downTimer = 0;
      if (this.upTimer > 10 && this.tier > 0) this.step(-1);
    } else {
      this.downTimer = 0;
      this.upTimer = 0;
    }
  }

  private step(delta: number): void {
    const next = Math.min(TIERS.length - 1, Math.max(0, this.tier + delta));
    if (next === this.tier) return;
    this.tier = next;
    this.downTimer = 0;
    this.upTimer = 0;
    this.ema = 16.7; // re-baseline so we don't oscillate
    this.onTierChangeStart?.(TIERS[next].name);
    this.onTierChange?.(TIERS[next]);
  }

  setTier(index: number): void {
    const next = Math.min(TIERS.length - 1, Math.max(0, index));
    if (next === this.tier) return;
    this.tier = next;
    this.onTierChange?.(TIERS[next]);
  }

  get current(): QualityTier {
    return TIERS[this.tier];
  }
}
