// pinch.js — «жвачка» как у Луффи (Gomu-Gomu). Механика и фил подсмотрены у эталонной
// реализации gazellecheetah/gum-gum-hand-stretch (OpenCV+MediaPipe), адаптировано в JS.
//
// Щипок (большой палец + ближайший из остальных) ставит ЯКОРЬ в точке защипа (заморожен
// в кадре). Тянешь руку — нить тянется от якоря к «живой» точке защипа. Отпускаешь —
// кончик летит ОБРАТНО К ЯКОРЮ по кривой ease-out-back (overshoot) за SNAP_DURATION, и нить гаснет.
//
// Чистая логика без DOM. Координаты нормализованы [0..1], x уже зеркалён.

export const PCFG = {
  PINCH_ON: 0.4, // защип: dist(thumb,finger)/handLen ниже → схвачено
  PINCH_OFF: 0.6, // выше → отпущено (гистерезис, чтобы не дребезжало)
  TIP_SMOOTH: 0.5, // сглаживание «живой» точки защипа (EMA)
  SNAP_DURATION: 0.3, // сек на упругий возврат
  OVERSHOOT: 1.9, // «перелёт» ease-out-back за якорь
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Перелёт за 1.0 и возврат — кривая упругого отскока.
function easeOutBack(t, k) {
  const c1 = k;
  const c3 = k + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

const TIPS = [8, 12, 16, 20];
const TIP_NAMES = ['index', 'middle', 'ring', 'pinky'];

export class PinchStretch {
  constructor(cfg = PCFG) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.state = 'idle'; // 'idle' | 'stretching' | 'snapping'
    this.pinched = false;
    this.anchor = null;
    this.tip = null;
    this.snapFrom = null;
    this.snapStart = 0;
    this.finger = null;
  }

  _latch(pinchDist) {
    if (!this.pinched && pinchDist <= this.cfg.PINCH_ON) this.pinched = true;
    else if (this.pinched && pinchDist >= this.cfg.PINCH_OFF) this.pinched = false;
    return this.pinched;
  }

  update(lm, handLen, tMs) {
    const cfg = this.cfg;
    if (!lm) {
      this.reset();
      return { active: false, state: 'idle' };
    }
    const HL = handLen || 0.15;

    // ближайший к большому пальцу кончик
    const thumb = lm[4];
    let best = Infinity;
    let bestI = 0;
    for (let i = 0; i < TIPS.length; i++) {
      const d = dist(thumb, lm[TIPS[i]]);
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    const pinchDist = best / HL;
    const fingerTip = lm[TIPS[bestI]];
    const pinchPoint = { x: (thumb.x + fingerTip.x) / 2, y: (thumb.y + fingerTip.y) / 2 };

    // сглаживаем «живую» точку защипа
    if (!this.tip) this.tip = { ...pinchPoint };
    else {
      this.tip.x += (pinchPoint.x - this.tip.x) * cfg.TIP_SMOOTH;
      this.tip.y += (pinchPoint.y - this.tip.y) * cfg.TIP_SMOOTH;
    }

    const pinched = this._latch(pinchDist);

    // конечный автомат
    if (this.state === 'idle') {
      if (pinched) {
        this.anchor = { ...pinchPoint };
        this.tip = { ...pinchPoint };
        this.finger = TIP_NAMES[bestI];
        this.state = 'stretching';
      }
    } else if (this.state === 'stretching') {
      if (!pinched) {
        this.snapFrom = { ...this.tip };
        this.snapStart = tMs;
        this.state = 'snapping';
      }
    } else if (this.state === 'snapping') {
      const elapsed = (tMs - this.snapStart) / 1000;
      if (elapsed >= cfg.SNAP_DURATION) {
        this.state = 'idle';
        this.anchor = null;
      } else if (pinched) {
        this.anchor = this.anchor || { ...pinchPoint };
        this.tip = { ...pinchPoint };
        this.state = 'stretching';
      }
    }

    // где рисовать кончик нити
    let renderTip = null;
    if (this.state === 'stretching') renderTip = this.tip;
    else if (this.state === 'snapping') {
      const t = clamp((tMs - this.snapStart) / 1000 / cfg.SNAP_DURATION, 0, 1);
      renderTip = lerpP(this.snapFrom, this.anchor, easeOutBack(t, cfg.OVERSHOOT));
    }

    if ((this.state === 'stretching' || this.state === 'snapping') && this.anchor && renderTip) {
      const a = { ...this.anchor };
      const b = { ...renderTip };
      const len = dist(a, b);
      return {
        active: true,
        state: this.state,
        a,
        b,
        len,
        stretch: len / HL,
        pinched: this.state === 'stretching' && this.pinched,
        finger: this.finger,
      };
    }
    return { active: false, state: this.state, pinchDist };
  }
}
