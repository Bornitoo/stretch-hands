// Юнит-тесты ядра pinch.js — без браузера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinchStretch } from '../public/js/pinch.js';

function makeHand(thumb, index) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9 }));
  lm[0] = { x: 0.5, y: 0.9 };
  lm[9] = { x: 0.5, y: 0.75 }; // handLen 0.15
  lm[4] = { ...thumb };
  lm[8] = { ...index };
  lm[12] = { x: 0.95, y: 0.95 };
  lm[16] = { x: 0.98, y: 0.95 };
  lm[20] = { x: 0.99, y: 0.95 };
  return lm;
}
const HL = 0.15;

test('щипок распознаётся, появляется активная нить', () => {
  const p = new PinchStretch();
  const pt = { x: 0.5, y: 0.4 };
  const out = p.update(makeHand(pt, pt), HL, 0);
  assert.equal(out.active, true);
  assert.equal(out.state, 'stretching');
});

test('разведённые пальцы — нет нити', () => {
  const p = new PinchStretch();
  const out = p.update(makeHand({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }), HL, 0);
  assert.equal(out.active, false);
});

test('тянем руку при защипе — длина нити растёт (якорь заморожен)', () => {
  const p = new PinchStretch();
  p.update(makeHand({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), HL, 0);
  let out;
  let y = 0.5;
  for (let i = 1; i <= 8; i++) {
    y -= 0.05;
    out = p.update(makeHand({ x: 0.5, y }, { x: 0.5, y }), HL, i * 16);
  }
  assert.equal(out.state, 'stretching');
  assert.ok(out.len > 0.15, `нить должна вытянуться, len=${out.len}`);
  // якорь остался у точки защипа (~0.5), не уехал с рукой
  assert.ok(Math.abs(out.a.y - 0.5) < 0.05, `якорь заморожен, a.y=${out.a.y}`);
});

test('отпускание → кончик возвращается к якорю с overshoot, затем гаснет', () => {
  const p = new PinchStretch();
  p.update(makeHand({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), HL, 0);
  let y = 0.5;
  for (let i = 1; i <= 8; i++) {
    y -= 0.05;
    p.update(makeHand({ x: 0.5, y }, { x: 0.5, y }), HL, i * 16);
  }
  // отпустили — разводим пальцы
  const thumb = { x: 0.42, y };
  const index = { x: 0.58, y };
  let out = p.update(makeHand(thumb, index), HL, 9 * 16);
  assert.equal(out.state, 'snapping');
  const anchor = out.a;
  const v0 = { x: out.b.x - anchor.x, y: out.b.y - anchor.y }; // направление от якоря к старту отскока

  let overshoot = false;
  let gone = false;
  for (let i = 10; i < 40; i++) {
    out = p.update(makeHand(thumb, index), HL, i * 16);
    if (out.active) {
      const w = { x: out.b.x - anchor.x, y: out.b.y - anchor.y };
      if (w.x * v0.x + w.y * v0.y < -1e-4) overshoot = true; // кончик проскочил якорь
    } else {
      gone = true;
      break;
    }
  }
  assert.ok(overshoot, 'ожидался overshoot (кончик проскакивает якорь)');
  assert.ok(gone, 'нить должна погаснуть после возврата');
});
