// app.js — сборка всего: трекинг → симуляция → рендер; UI и лайфсайкл камеры.
import { Tracker } from './tracker.js';
import { StretchSim, CFG } from './stretch.js';
import { drawCartoon, drawDebug } from './render-cartoon.js';
import { RealisticRenderer } from './render-realistic.js';
import { Sfx } from './sfx.js';
import { Capture } from './capture.js';

const qs = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';

const canvas = qs('#out');
const ctx = canvas.getContext('2d');
const statusEl = qs('#status');
const hintEl = qs('#hint');

const sim = new StretchSim();
const sfx = new Sfx();
let realistic = null; // WebGL-рендер создаём лениво (только при выборе режима)
function getRealistic() {
  if (!realistic) realistic = new RealisticRenderer();
  return realistic;
}
const capture = new Capture(canvas);

let mode = 'cartoon'; // 'cartoon' | 'realistic'
let sized = false;
let lastStretchSound = 0;

const tracker = new Tracker({
  onStatus: (t) => (statusEl.textContent = t),
  onFrame,
});

function ensureSize(video) {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  if (!sized || canvas.width !== w) {
    canvas.width = w;
    canvas.height = h;
    sized = true;
  }
}

function drawVideoMirrored(video, W, H) {
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();
}

function onFrame(model, video, tMs) {
  ensureSize(video);
  const W = canvas.width;
  const H = canvas.height;

  if (!model.ok) {
    drawVideoMirrored(video, W, H);
    hintEl.textContent = 'Покажите руку в кадр ✋';
    sim.reset();
    return;
  }
  hintEl.textContent = '';

  const s = sim.update({
    anchor: model.anchor,
    wrist: model.wrist,
    lm: model.lm,
    handLen: model.handLen,
    tMs,
  });
  // лёгкий «свист» при заметном растяжении (антидребезг)
  if (s.stretchRatio > 2 && tMs - lastStretchSound > 350 && s.peakVel > 0.8) {
    sfx.stretch(Math.min(1, (s.stretchRatio - 1) / 3));
    lastStretchSound = tMs;
  }

  const opts = { width: W, height: H, debug: DEBUG };

  if (mode === 'realistic') {
    const r = getRealistic();
    const ok = r.draw(video, model, s, opts);
    if (ok) {
      ctx.drawImage(r.canvas, 0, 0, W, H);
      if (DEBUG) drawDebug(ctx, model, W, H);
      hintEl.textContent = '';
    } else {
      // нет позы/WebGL — мягкий фоллбэк на cartoon
      drawCartoon(ctx, video, model, s, opts);
      hintEl.textContent = model.poseOk ? '' : 'Для реалистичного режима встаньте в кадр по пояс';
    }
  } else {
    drawCartoon(ctx, video, model, s, opts);
  }

  // HUD: fps / делегат / поза — видно сразу, что происходит
  statusEl.textContent =
    `${Math.round(tracker.fps)} fps · ${tracker.delegate}` +
    (tracker.pose ? (tracker.poseActive ? ' · поза вкл' : ' · поза выкл (fps)') : '');
}

// ---------- UI ----------
const btnStart = qs('#btnStart');
const btnMode = qs('#btnMode');
const btnSnap = qs('#btnSnap');
const btnRec = qs('#btnRec');
const btnSound = qs('#btnSound');
const camDot = qs('#camDot');

let running = false;

btnStart.addEventListener('click', async () => {
  sfx._ensure(); // разблокировать аудио в жесте пользователя
  if (!running) {
    btnStart.disabled = true;
    try {
      await tracker.start();
      running = true;
      btnStart.textContent = 'Выключить камеру';
      camDot.classList.add('on');
    } catch (e) {
      statusEl.textContent = 'Не удалось включить камеру: ' + e.message;
    } finally {
      btnStart.disabled = false;
    }
  } else {
    tracker.pause();
    running = false;
    btnStart.textContent = 'Включить камеру';
    camDot.classList.remove('on');
    if (capture.recording) {
      capture.stopRecording();
      btnRec.classList.remove('rec');
      btnRec.textContent = '● Запись';
    }
  }
});

btnMode.addEventListener('click', () => {
  mode = mode === 'cartoon' ? 'realistic' : 'cartoon';
  btnMode.textContent = mode === 'cartoon' ? 'Режим: Мультяшный' : 'Режим: Реалистичный';
  if (mode === 'realistic' && !getRealistic().ok) {
    statusEl.textContent = 'WebGL недоступен — остаюсь в мультяшном';
    mode = 'cartoon';
    btnMode.textContent = 'Режим: Мультяшный';
  }
});

btnSnap.addEventListener('click', () => {
  if (running) capture.snapshot();
});

btnRec.addEventListener('click', () => {
  if (!running) return;
  const on = capture.toggleRecording();
  btnRec.classList.toggle('rec', on);
  btnRec.textContent = on ? '■ Стоп' : '● Запись';
});

btnSound.addEventListener('click', () => {
  sfx.enabled = !sfx.enabled;
  btnSound.textContent = sfx.enabled ? '🔊 Звук' : '🔇 Звук';
});

// ползунки настроек эффекта (живой тюнинг CFG)
function bindSlider(id, apply) {
  const el = qs(id);
  if (!el) return;
  el.addEventListener('input', () => apply(parseFloat(el.value)));
}
bindSlider('#sStiff', (v) => (CFG.STIFFNESS = v)); // тягучесть/отзывчивость
bindSlider('#sDamp', (v) => (CFG.DAMPING = v)); // инерция «желе»
bindSlider('#sThick', (v) => (CFG.BASE_THICKNESS = v)); // толщина

if (DEBUG) qs('#settings')?.removeAttribute('hidden');
