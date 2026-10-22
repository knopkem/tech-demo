/**
 * HUD — start card, pause card, crosshair, and the live telemetry line.
 * Plain DOM + CSS; no frameworks.
 */

export class Hud {
  private start: HTMLElement;
  private pause: HTMLElement;
  private crosshair: HTMLElement;
  private info: HTMLElement;
  private toast: HTMLElement;
  private underwater: HTMLElement;
  private badge: HTMLElement;
  private gpuLost: HTMLElement;

  constructor() {
    this.start = document.getElementById('start-card')!;
    this.pause = document.getElementById('pause-card')!;
    this.crosshair = document.getElementById('crosshair')!;
    this.info = document.getElementById('info-line')!;
    this.toast = document.getElementById('tier-toast')!;
    this.underwater = document.getElementById('underwater')!;
    this.badge = document.getElementById('backend-badge')!;
    this.gpuLost = document.getElementById('gpu-lost')!;
  }

  showGpuLost(): void {
    this.gpuLost.style.display = 'flex';
  }

  hideGpuLost(): void {
    this.gpuLost.style.display = 'none';
  }

  setBackend(api: string): void {
    this.badge.textContent = api === 'WebGPU' ? 'WEBGPU' : 'WEBGL2 Fallback';
    this.badge.classList.toggle('fallback', api !== 'WebGPU');
  }

  showStart(): void {
    this.start.style.display = 'flex';
    this.pause.style.display = 'none';
    this.crosshair.style.opacity = '0';
  }

  showPause(): void {
    this.start.style.display = 'none';
    this.pause.style.display = 'flex';
    this.crosshair.style.opacity = '0';
  }

  hideCards(): void {
    this.start.style.display = 'none';
    this.pause.style.display = 'none';
    this.crosshair.style.opacity = '1';
  }

  setUnderwater(under: boolean): void {
    this.underwater.classList.toggle('on', under);
  }

  setTierName(name: string): void {
    this.toast.textContent = `QUALITY ${name}`;
    this.toast.classList.add('show');
    window.setTimeout(() => this.toast.classList.remove('show'), 1800);
  }

  /** fps: smoothed frames-per-second; alt: camera altitude in metres. */
  updateFrame(fps: number, alt: number, tierName: string, api: string): void {
    this.info.textContent = `${Math.round(fps)} FPS  ·  ALT ${Math.max(0, Math.round(alt))} M  ·  ${tierName}  ·  ${api}`;
  }
}
