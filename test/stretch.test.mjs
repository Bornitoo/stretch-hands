// Юнит-тесты чистой логики stretch.js — без браузера и камеры.
// Запуск: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CFG,
  StretchSim,
  countExtended,
  isOpenHand,
  isFist,
  thicknessAt,
  handLength,
} from '../public/js/stretch.js';

// Собрать 21 точку кисти. extend∈[0..1] для каждого из 4 пальцев — насколько выпрямлен.
// Кисть «смотрит вверх»: запястье снизу, пальцы тянутся вверх (y уменьшается).
function makeHand(extend = [1, 1, 1, 1]) {
  const lm = new Array(21).fill(0).map(() => ({ x: 0.5, y: 0.9, z: 0 }));
  lm[0] = { x: 0.5, y: 0.9, z: 0 }; // запястье
  lm[9] = { x: 0.5, y: 0.75, z: 0 }; // MCP среднего → handLen 0.15
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  const xs = [0.42, 0.48, 0.54, 0.6];
  for (let i = 0; i < 4; i++) {
    // PIP всегда на умеренной высоте
    lm[pips[i]] = { x: xs[i], y: 0.66, z: 0 };
    // выпрямленный кончик уходит высоко (далеко от запястья), согнутый — близко к запястью
    const tipY = 0.66 - 0.18 * extend[i] + 0.16 * (1 - extend[i]);
    lm[tips[i]] = { x: xs[i], y: tipY, z: 0 };
  }
  return lm;
}

test('handLength = расстояние запястье→MCP среднего', () => {
  assert.ok(Math.abs(handLength(makeHand()) - 0.15) < 1e-6);
});

test('раскрытая ладонь распознаётся', () => {
  const lm = makeHand([1, 1, 1, 1]);
  assert.equal(countExtended(lm).extended, 4);
  assert.equal(isOpenHand(lm), true);
  assert.equal(isFist(lm), false);
});

test('кулак распознаётся', () => {
  const lm = makeHand([0, 0, 0, 0]);
  assert.equal(countExtended(lm).extended, 0);
  assert.equal(isFist(lm), true);
  assert.equal(isOpenHand(lm), false);
});

test('частично раскрытая (2 пальца) — не ладонь и не кулак', () => {
  const lm = makeHand([1, 1, 0, 0]);
  assert.equal(countExtended(lm).extended, 2);
  assert.equal(isOpenHand(lm), false);
  assert.equal(isFist(lm), false);
});

test('thicknessAt: толще у якоря, тоньше у кисти; растяжение утончает', () => {
  assert.ok(thicknessAt(0, 1) > thicknessAt(1, 1));
  assert.ok(thicknessAt(0.5, 3) < thicknessAt(0.5, 1));
});

test('StretchSim: концы привязаны, длина = SEGMENTS+1', () => {
  const sim = new StretchSim();
  const anchor = { x: 0.5, y: 1.0 };
  const lm = makeHand();
  const out = sim.update({ anchor, wrist: { x: 0.5, y: 0.5 }, lm, handLen: 0.15, tMs: 0 });
  assert.equal(out.segments.length, CFG.SEGMENTS + 1);
  assert.deepEqual(
    { x: out.segments[0].x, y: out.segments[0].y },
    { x: anchor.x, y: anchor.y },
  );
  // последний узел совпадает со сглаженной кистью (на 1-м кадре EMA инициализируется значением)
  const lastSeg = out.segments[CFG.SEGMENTS];
  assert.ok(Math.abs(lastSeg.x - out.wrist.x) < 1e-9);
  assert.ok(Math.abs(lastSeg.y - out.wrist.y) < 1e-9);
});

test('StretchSim: резкий бросок кисти → fling срабатывает (один раз за кулдаун)', () => {
  const sim = new StretchSim();
  const anchor = { x: 0.5, y: 1.0 };
  const lm = makeHand();
  let flings = 0;
  let x = 0.2;
  for (let i = 0; i < 8; i++) {
    const out = sim.update({
      anchor,
      wrist: { x, y: 0.5 },
      lm,
      handLen: 0.15,
      tMs: i * 16,
    });
    if (out.fling) flings++;
    x += 0.12; // ~0.12/0.15/0.016 ≈ 50 длин-ладони/сек — заведомо выше порога
  }
  assert.ok(flings >= 1, `ожидался хотя бы один бросок, получено ${flings}`);
  // кулдаун не даёт спамить каждый кадр
  assert.ok(flings <= 2, `слишком много срабатываний: ${flings}`);
});

test('StretchSim: спокойная рука не даёт ложных бросков', () => {
  const sim = new StretchSim();
  const anchor = { x: 0.5, y: 1.0 };
  const lm = makeHand();
  let flings = 0;
  for (let i = 0; i < 20; i++) {
    const out = sim.update({
      anchor,
      wrist: { x: 0.5 + 0.002 * Math.sin(i), y: 0.55 },
      lm,
      handLen: 0.15,
      tMs: i * 16,
    });
    if (out.fling) flings++;
  }
  assert.equal(flings, 0);
});

test('StretchSim: stretchRatio растёт при удалении кисти от якоря', () => {
  const sim = new StretchSim();
  const anchor = { x: 0.5, y: 1.0 };
  const lm = makeHand();
  // прогрев в «покое» рядом
  let out;
  for (let i = 0; i < 5; i++) {
    out = sim.update({ anchor, wrist: { x: 0.5, y: 0.82 }, lm, handLen: 0.15, tMs: i * 16 });
  }
  const near = out.stretchRatio;
  out = sim.update({ anchor, wrist: { x: 0.5, y: 0.2 }, lm, handLen: 0.15, tMs: 200 });
  assert.ok(out.stretchRatio > near, `растяжение должно вырасти: ${near} → ${out.stretchRatio}`);
});
