/**
 * Synthesized ambience — no audio files, all generated with WebAudio:
 *  - wind: looped filtered noise with a slow LFO on the filter
 *  - pad: three detuned low oscillators through a dark low-pass
 *  - chimes: proximity-triggered pentatonic pings, panned by bearing
 *  - underwater: a muffle filter + wind duck when below sea level
 *
 * Starts on the first user gesture (autoplay policy).
 */

const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.7, 1318.5]; // C-major pentatonic-ish

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private lastChime = -10;

  get started(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.started) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.6;
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 18000;
    master.connect(muffle);
    muffle.connect(ctx.destination);
    this.master = master;
    this.muffle = muffle;

    // --- wind -------------------------------------------------------------
    const seconds = 4;
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, seconds * rate, rate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // brown-ish noise
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    src.connect(lp);
    lp.connect(windGain);
    windGain.connect(master);
    src.start();
    lfo.start();
    this.windGain = windGain;

    // --- pad --------------------------------------------------------------
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 340;
    padLp.Q.value = 0.6;
    padGain.connect(padLp);
    padLp.connect(master);
    for (const [freq, detune, g] of [
      [55, -6, 0.5],
      [82.41, 4, 0.34],
      [110, 8, 0.22],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = g;
      const trem = ctx.createOscillator();
      trem.frequency.value = 0.05 + Math.random() * 0.05;
      const tremGain = ctx.createGain();
      tremGain.gain.value = g * 0.5;
      trem.connect(tremGain);
      tremGain.connect(og.gain);
      osc.connect(og);
      og.connect(padGain);
      osc.start();
      trem.start();
    }
    this.padGain = padGain;
  }

  /** Crystal proximity ping. `proximity` 0..1, `bearing` -1..1 (left..right). */
  chime(proximity: number, bearing: number, now: number): void {
    if (!this.ctx || !this.master || proximity <= 0) return;
    if (now - this.lastChime < 1.3) return;
    this.lastChime = now;

    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const freq = PENTA[Math.floor(Math.random() * PENTA.length)];

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = freq * 2.01;

    const g = ctx.createGain();
    const peak = 0.05 + proximity * 0.1;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);

    const shimmerG = ctx.createGain();
    shimmerG.gain.value = 0.3;

    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.max(-1, Math.min(1, bearing));

    osc.connect(g);
    shimmer.connect(shimmerG);
    shimmerG.connect(g);
    if (pan) {
      g.connect(pan);
      pan.connect(this.master);
    } else {
      g.connect(this.master);
    }
    osc.start(t0);
    shimmer.start(t0);
    osc.stop(t0 + 1.8);
    shimmer.stop(t0 + 1.8);
  }

  private under = false;

  /** Flight speed in m/s — the wind swells with velocity (ducks when underwater). */
  setWind(speed: number): void {
    if (!this.ctx || !this.windGain) return;
    const t = this.ctx.currentTime;
    const base = this.under ? 0.05 : 0.16;
    const target = base * (0.55 + Math.min(speed / 90, 1) * 0.9);
    this.windGain.gain.setTargetAtTime(target, t, 0.8);
  }

  setUnderwater(under: boolean): void {
    this.under = under;
    if (!this.ctx || !this.muffle || !this.windGain) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.linearRampToValueAtTime(under ? 320 : 18000, t + 1.2);
    this.windGain.gain.setTargetAtTime(under ? 0.05 : 0.16, t, 1.2);
  }

  suspend(): void {
    this.ctx?.suspend();
  }

  resume(): void {
    this.ctx?.resume();
  }
}
