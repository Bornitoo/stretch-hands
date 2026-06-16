// render-cartoon.js — рендер №1: стилизованная «резиновая» конечность на canvas2D.
// Рисует зеркальное видео фоном и поверх — гладкую тянущуюся руку от якоря к кисти.
//
// Координаты landmarks уже зеркалены (x = 1-raw), поэтому видео тоже рисуем
// отзеркаленным — тогда оверлеи в (x*W, y*H) совпадают с картинкой.

const SKIN = { a: '#f3c98b', b: '#dd9a5b', edge: '#7a431d', shine: 'rgba(255,255,255,0.35)' };

function perp(ax, ay, bx, by) {
  const tx = bx - ax;
  const ty = by - ay;
  const len = Math.hypot(tx, ty) || 1;
  return { x: -ty / len, y: tx / len };
}

export function drawCartoon(ctx, video, model, s, opts) {
  const W = opts.width;
  const H = opts.height;

  ctx.save();

  // фон: зеркальное видео
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();

  if (s && s.segments) {
    drawLimb(ctx, s.segments, W, H);
    drawCuff(ctx, s.wrist, s.handLen, W, H);
  }

  if (opts.debug && model && model.lm) drawDebug(ctx, model, W, H);

  ctx.restore();
}

function toPx(p, W, H) {
  return { x: p.x * W, y: p.y * H };
}

function drawLimb(ctx, segs, W, H) {
  const pts = segs.map((sg) => ({ x: sg.x * W, y: sg.y * H, r: (sg.thickness * H) / 2 }));
  const n = pts.length;
  if (n < 2) return;

  // левый и правый контуры по перпендикуляру
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const pp = perp(a.x, a.y, b.x, b.y);
    left.push({ x: pts[i].x + pp.x * pts[i].r, y: pts[i].y + pp.y * pts[i].r });
    right.push({ x: pts[i].x - pp.x * pts[i].r, y: pts[i].y - pp.y * pts[i].r });
  }

  // тело руки
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();

  const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[n - 1].x, pts[n - 1].y);
  grad.addColorStop(0, SKIN.a);
  grad.addColorStop(1, SKIN.b);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(2, pts[0].r * 0.12);
  ctx.strokeStyle = SKIN.edge;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // блик вдоль верхней кромки
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  ctx.strokeStyle = SKIN.shine;
  ctx.lineWidth = Math.max(1.5, pts[0].r * 0.18);
  ctx.lineCap = 'round';
  ctx.stroke();
}

// небольшой «манжет» у запястья — не перекрывает реальную кисть (она видна из видео)
function drawCuff(ctx, wrist, handLen, W, H) {
  if (!wrist) return;
  const c = toPx(wrist, W, H);
  const r = Math.max(6, handLen * H * 0.28);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = SKIN.b;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = SKIN.edge;
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
  if (model.anchor) {
    const a = toPx(model.anchor, W, H);
    ctx.fillStyle = '#f93';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}
