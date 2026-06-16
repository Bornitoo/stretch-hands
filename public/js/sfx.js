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

  // «бдыщь» удара: короткий шумовой всплеск + низкий тон
  punch() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t = ctx.currentTime;
    // шум
    const dur = 0.18;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(ng).connect(ctx.destination);
    noise.start(t);
    // низкий «бум»
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.16);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.24);
  }

  // «чпок» возврата руки
  snap() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.08);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.12);
  }
}
