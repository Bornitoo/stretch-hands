// render-cartoon.js — рендер №1: резиновая «жвачка» на canvas2D.
// Математика тюбика (безье с боковым «пузом», сужение к кончику, истончение по
// «сохранению объёма», блик, скруглённый кончик) портирована из эталона
// gazellecheetah/gum-gum-hand-stretch (draw_rubber). Брендинг — наш, нейтральный.

const GUM = {
  fill: '#ec5446', // тело (резиново-красный)
  shade: '#8c2c24', // тёмный контур/тень
  shine: '#ffc8bf', // блик
  anchor: '#ffd23c', // маркер якоря
};

const px = (p, W, H) => ({ x: p.x * W, y: p.y * H });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function perp(dx, dy) {
  const l = Math.hypot(dx, dy);
  return l < 1e-6 ? { x: 0, y: 0 } : { x: -dy / l, y: dx / l };
}
function quadBezier(p0, p1, p2, t) {
  const mt = 1 - t;
  const a = mt * mt;
  const b = 2 * mt * t;
  const c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

export function drawCartoon(ctx, video, model, band, opts) {
  const W = opts.width;
  const H = opts.height;

  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();

  if (band && band.active) drawRubber(ctx, band, model, W, H);
  if (opts.debug && model && model.lm) drawDebug(ctx, model, W, H);
}

function drawRubber(ctx, band, model, W, H) {
  const a = px(band.a, W, H);
  const b = px(band.b, W, H);
  const length = Math.hypot(b.x - a.x, b.y - a.y);

  // масштаб от размера кисти / кадра
  const baseW = Math.max((model.handLen || 0.15) * H * 0.5, 0.04 * H);
  const MIN_W = 4;
  const TIP_FRAC = 0.35;
  const THIN_LEN = 0.72 * H;
  const BULGE_FRAC = 0.16;
  const BULGE_MAX = 0.097 * H;
  const N = 28;

  const dir = perp(b.x - a.x, b.y - a.y); // перпендикуляр оси (для «пуза»)
  const bulge = Math.min(length * BULGE_FRAC, BULGE_MAX);
  const mid = lerp(a, b, 0.5);
  const ctrl = { x: mid.x + dir.x * bulge, y: mid.y + dir.y * bulge };

  // истончение: длиннее → тоньше (сохранение объёма)
  const thinning = 1 / (1 + length / THIN_LEN);
  const wA = Math.max(baseW * thinning, MIN_W);
  const wT = Math.max(wA * TIP_FRAC, MIN_W);

  const left = [];
  const right = [];
  const centers = [];
  let prev = quadBezier(a, ctrl, b, 0);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const pt = quadBezier(a, ctrl, b, t);
    let tdx = pt.x - prev.x;
    let tdy = pt.y - prev.y;
    if (i === 0) {
      const nxt = quadBezier(a, ctrl, b, 1 / N);
      tdx = nxt.x - pt.x;
      tdy = nxt.y - pt.y;
    }
    const lp = perp(tdx, tdy);
    const w = wA + (wT - wA) * t;
    left.push({ x: pt.x + lp.x * w, y: pt.y + lp.y * w });
    right.push({ x: pt.x - lp.x * w, y: pt.y - lp.y * w });
    centers.push({ pt, w });
    prev = pt;
  }

  // тело (полигон left + reverse(right))
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = GUM.fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = GUM.shade;
  ctx.stroke();

  // блик вдоль центральной линии (смещён к «пузу»)
  ctx.beginPath();
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const hx = c.pt.x + dir.x * c.w * 0.35;
    const hy = c.pt.y + dir.y * c.w * 0.35;
    i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
  }
  ctx.strokeStyle = GUM.shine;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, wT * 0.6);
  ctx.stroke();

  // скруглённый кончик
  ctx.beginPath();
  ctx.arc(b.x, b.y, wT, 0, Math.PI * 2);
  ctx.fillStyle = GUM.fill;
  ctx.fill();

  // маркер якоря
  ctx.beginPath();
  ctx.arc(a.x, a.y, Math.max(5, wA * 0.4), 0, Math.PI * 2);
  ctx.fillStyle = GUM.anchor;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

const HAND_CHAINS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

export function drawDebug(ctx, model, W, H) {
  const lm = model.lm;
  ctx.strokeStyle = '#3f3';
  ctx.lineWidth = 2;
  for (const ch of HAND_CHAINS) {
    ctx.beginPath();
    ctx.moveTo(lm[ch[0]].x * W, lm[ch[0]].y * H);
    for (let i = 1; i < ch.length; i++) ctx.lineTo(lm[ch[i]].x * W, lm[ch[i]].y * H);
    ctx.stroke();
  }
}
