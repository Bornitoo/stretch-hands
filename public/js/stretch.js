// stretch.js — чистое ядро эффекта «резиновой» руки.
// Никаких обращений к DOM / браузеру: всё на входных данных, чтобы гонять в Node-тестах.
//
// Система координат: нормализованные [0..1] (x уже зеркалён трекером для селфи-вида).
// Рендер сам масштабирует в пиксели канваса.

export const CFG = {
  // геометрия «верёвки» руки
  SEGMENTS: 24, // число узлов ломаной (node0 = якорь, nodeN = кисть)
  STIFFNESS: 0.55, // насколько узел тянется к своей точке покоя за кадр (0..1)
  DAMPING: 0.72, // затухание скорости узла (резиновая инерция)
  WOBBLE_DECAY: 0.9, // гашение поперечных колебаний
  MAX_DT: 0.05, // кламп шага интегрирования, сек (защита от скачков времени)

  // толщина (доля высоты кадра)
  BASE_THICKNESS: 0.14, // у якоря
  TIP_THICKNESS: 0.07, // у кисти
  THIN_ON_STRETCH: 0.45, // насколько утончается при сильном растяжении (сохранение «объёма»)

  // сглаживание кисти
  WRIST_SMOOTH: 0.55, // EMA (выше = отзывчивее)

  // жесты (по 21 точке кисти MediaPipe)
  EXT_RATIO: 1.12, // палец «выпрямлен», если tip дальше PIP в EXT_RATIO раз
  OPEN_FINGERS_FOR_OPEN: 3, // сколько выпрямленных пальцев = раскрытая ладонь
  OPEN_FINGERS_FOR_FIST: 1, // <= столько = кулак

  // бросок (гам-гам пистолет)
  FLING_WINDOW_MS: 160, // окно анализа скорости
  FLING_MIN_VEL: 2.2, // порог пиковой скорости кисти, длин-ладони/сек
  FLING_COOLDOWN_MS: 450, // антидребезг между бросками
};

// ---- мелкие геом-хелперы ----
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => a + (b - a) * t;
const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Длина «ладони» как единица масштаба: запястье(0) → MCP среднего(9).
export function handLength(lm) {
  if (!lm || lm.length < 10) return 0.15;
  const l = dist(lm[0], lm[9]);
  return l > 1e-4 ? l : 0.15;
}

// Кончики и PIP-суставы четырёх пальцев (без большого — он шумный для openness).
const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];

// Доля выпрямленных пальцев [0..1] и их число. Палец выпрямлен, если
// его кончик дальше от запястья, чем PIP, в EXT_RATIO раз.
export function countExtended(lm, cfg = CFG) {
  if (!lm || lm.length < 21) return { extended: 0, openness: 0 };
  const wrist = lm[0];
  let ext = 0;
  for (let i = 0; i < FINGER_TIPS.length; i++) {
    const tipD = dist(lm[FINGER_TIPS[i]], wrist);
    const pipD = dist(lm[FINGER_PIPS[i]], wrist);
    if (pipD > 1e-5 && tipD / pipD > cfg.EXT_RATIO) ext++;
  }
  return { extended: ext, openness: ext / FINGER_TIPS.length };
}

export function isOpenHand(lm, cfg = CFG) {
  return countExtended(lm, cfg).extended >= cfg.OPEN_FINGERS_FOR_OPEN;
}
export function isFist(lm, cfg = CFG) {
  return countExtended(lm, cfg).extended <= cfg.OPEN_FINGERS_FOR_FIST;
}

// Толщина руки вдоль оси t∈[0..1] (0 у якоря, 1 у кисти) с учётом растяжения.
export function thicknessAt(t, stretchRatio, cfg = CFG) {
  const thin = 1 - clamp((stretchRatio - 1) * cfg.THIN_ON_STRETCH, 0, 0.6);
  return lerp(cfg.BASE_THICKNESS, cfg.TIP_THICKNESS, t) * thin;
}

// ---- основная симуляция ----
// Резиновая «верёвка» из N узлов. Узел 0 жёстко в якоре, последний ведётся кистью,
// промежуточные интегрируются пружиной к своей точке покоя на отрезке якорь→кисть,
// отчего возникает инерционное колыхание (желе).
export class StretchSim {
  constructor(cfg = CFG) {
    this.cfg = cfg;
    this.nodes = null; // [{x,y,vx,vy}]
    this.smWrist = null; // сглаженная кисть
    this.lastMs = null;
    this.hist = []; // история кисти для детекта броска: {x,y,t}
    this.lastFlingMs = -1e9;
    this.restLen = 0.2; // «естественная» длина руки (якорь→кисть в покое)
  }

  reset() {
    this.nodes = null;
    this.smWrist = null;
    this.lastMs = null;
    this.hist.length = 0;
    this._restInit = false;
  }

  _initNodes(anchor, wrist) {
    const n = this.cfg.SEGMENTS;
    this.nodes = [];
    for (let i = 0; i <= n; i++) {
      const p = lerpPt(anchor, wrist, i / n);
      this.nodes.push({ x: p.x, y: p.y, vx: 0, vy: 0 });
    }
  }

  // input: { anchor:{x,y}, wrist:{x,y}, lm?:landmarks, handLen?:number, tMs:number }
  // Возвращает состояние для рендера и геймплея.
  update(input) {
    const cfg = this.cfg;
    const { anchor, wrist, lm, tMs } = input;
    const handLen = input.handLen || handLength(lm);

    // dt
    let dt = this.lastMs == null ? 1 / 60 : (tMs - this.lastMs) / 1000;
    this.lastMs = tMs;
    dt = clamp(dt, 1e-3, cfg.MAX_DT);

    // сглаживание кисти (EMA)
    if (!this.smWrist) this.smWrist = { ...wrist };
    else {
      this.smWrist.x = lerp(this.smWrist.x, wrist.x, cfg.WRIST_SMOOTH);
      this.smWrist.y = lerp(this.smWrist.y, wrist.y, cfg.WRIST_SMOOTH);
    }
    const w = this.smWrist;

    if (!this.nodes) this._initNodes(anchor, w);
    const n = cfg.SEGMENTS;

    // концы фиксируем; промежуточные интегрируем
    this.nodes[0].x = anchor.x;
    this.nodes[0].y = anchor.y;
    this.nodes[0].vx = this.nodes[0].vy = 0;
    const last = this.nodes[n];
    last.x = w.x;
    last.y = w.y;

    const stepK = 1 - Math.pow(1 - cfg.STIFFNESS, dt * 60); // нормировка к dt
    for (let i = 1; i < n; i++) {
      const rest = lerpPt(anchor, w, i / n);
      const nd = this.nodes[i];
      // ускорение к точке покоя
      nd.vx += (rest.x - nd.x) * stepK;
      nd.vy += (rest.y - nd.y) * stepK;
      // затухание
      const damp = Math.pow(cfg.DAMPING, dt * 60);
      nd.vx *= damp;
      nd.vy *= damp;
      nd.x += nd.vx;
      nd.y += nd.vy;
    }

    // длина и коэффициент растяжения
    const curLen = dist(anchor, w);
    if (!this._restInit) {
      this.restLen = curLen || 0.2;
      this._restInit = true;
    }
    // «Естественная» длина руки = адаптивная база: быстро падает к сближению (рука в покое),
    // медленно подрастает при удержании вытянутой — так разовый стретч читается сильно,
    // а статичная поза постепенно перестаёт считаться растяжением.
    const rate = curLen < this.restLen ? 0.06 : 0.004;
    this.restLen = lerp(this.restLen, curLen, rate);
    this.restLen = clamp(this.restLen, 0.1, 0.5);
    const stretchRatio = clamp(curLen / Math.max(this.restLen, 1e-3), 1, 6);

    // история кисти и детект броска (в длинах-ладони/сек)
    this.hist.push({ x: w.x, y: w.y, t: tMs });
    while (this.hist.length > 2 && tMs - this.hist[0].t > cfg.FLING_WINDOW_MS) this.hist.shift();
    let peakVel = 0;
    for (let i = 1; i < this.hist.length; i++) {
      const a = this.hist[i - 1];
      const b = this.hist[i];
      const ddt = (b.t - a.t) / 1000;
      if (ddt > 1e-4) {
        const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(handLen, 1e-3) / ddt;
        if (v > peakVel) peakVel = v;
      }
    }
    let fling = false;
    if (peakVel >= cfg.FLING_MIN_VEL && tMs - this.lastFlingMs > cfg.FLING_COOLDOWN_MS) {
      fling = true;
      this.lastFlingMs = tMs;
    }

    // жесты
    const ext = countExtended(lm, cfg);
    const openHand = ext.extended >= cfg.OPEN_FINGERS_FOR_OPEN;
    const fist = ext.extended <= cfg.OPEN_FINGERS_FOR_FIST;

    // узлы с толщиной для рендера
    const segments = this.nodes.map((nd, i) => ({
      x: nd.x,
      y: nd.y,
      thickness: thicknessAt(i / n, stretchRatio, cfg),
    }));

    return {
      segments,
      anchor: { ...anchor },
      wrist: { ...w },
      stretchRatio,
      peakVel,
      fling,
      openness: ext.openness,
      openHand,
      fist,
      handLen,
    };
  }
}
