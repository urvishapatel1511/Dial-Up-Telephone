/**
 * Live spectrum of the ghost's frequencies. ggwave's audible protocols use
 * about 1.9-6.4 kHz, so we draw roughly 1.5-7 kHz. Connect any node to `input`.
 */
export type ScopeMode = 'idle' | 'send' | 'listen';

const LOW_HZ = 1500;
const HIGH_HZ = 7000;
const BARS = 48;

export class Visualizer {
  readonly input: AnalyserNode;
  private readonly data: Uint8Array<ArrayBuffer>;
  private mode: ScopeMode = 'idle';
  private raf = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.input = ctx.createAnalyser();
    this.input.fftSize = 2048;
    this.input.smoothingTimeConstant = 0.6;
    this.data = new Uint8Array(this.input.frequencyBinCount);
    this.drawIdle();
  }

  setMode(mode: ScopeMode) {
    this.mode = mode;
    cancelAnimationFrame(this.raf);
    if (mode === 'idle') this.drawIdle();
    else this.loop();
  }

  private colors() {
    return this.mode === 'send' ? '#7cf7c6' : '#b99cff';
  }

  private size() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth * dpr;
    const h = this.canvas.clientHeight * dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h, g: this.canvas.getContext('2d')! };
  }

  private drawIdle() {
    const { w, h, g } = this.size();
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(185,156,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
  }

  private loop = () => {
    const { w, h, g } = this.size();
    this.input.getByteFrequencyData(this.data);
    const binHz = this.ctx.sampleRate / this.input.fftSize;
    const lo = Math.floor(LOW_HZ / binHz);
    const hi = Math.ceil(HIGH_HZ / binHz);
    const per = Math.max(1, Math.floor((hi - lo) / BARS));
    const bw = w / BARS;
    g.clearRect(0, 0, w, h);
    g.fillStyle = this.colors();
    g.shadowColor = this.colors();
    g.shadowBlur = 12;
    for (let i = 0; i < BARS; i++) {
      let v = 0;
      for (let j = 0; j < per; j++) v = Math.max(v, this.data[lo + i * per + j] ?? 0);
      const bh = Math.max(2, (v / 255) * h * 0.95);
      g.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh);
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}
