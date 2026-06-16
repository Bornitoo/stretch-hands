// sfx.js — звуки на Web Audio API, синтезируются на лету (без бинарных файлов).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // «свист» растяжения: восходящий тон, громкость зависит от силы [0..1]
  stretch(amount = 0.5) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(220 + 600 * amount, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 * amount + 0.01, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.2);
  }

  // «бойнг» упругого отскока при отпускании щипка
  snap() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(680, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.22);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.28);
  }
}
