// tracker.js — камера + трекинг кисти (HandLandmarker, 21 точка). Без позы.
// Якорь «резиновой руки» уходит вниз за кадр вдоль направления реального предплечья.
//
// Всё зеркалится по X для естественного селфи-вида (как в doom-hands).
import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const MP_DIR = '../vendor/mediapipe';

const mirror = (p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Tracker {
  constructor({ onFrame, onStatus } = {}) {
    this.onFrame = onFrame || (() => {});
    this.onStatus = onStatus || (() => {});
    this.video = null;
    this.hand = null;
    this.running = false;
    this._minGap = 16;
    this._nextAt = 0;
    // телеметрия производительности
    this.delegate = '?';
    this.fps = 0;
    this._lastFrameTs = 0;
  }

  async _acquireCamera() {
    this.onStatus('Запрашиваю камеру…');
    // 640x480 (как в doom-hands) — заметно быстрее инференса, чем 720p
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.playsInline = true;
      this.video.muted = true;
    }
    this.video.srcObject = stream;
    await this.video.play();
  }

  async _loadModels() {
    const fileset = await FilesetResolver.forVisionTasks(MP_DIR);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: `${MP_DIR}/hand_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      // пониже пороги — чтобы кисть подхватывалась легче (в т.ч. на широком кадре)
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
    this.onStatus('Загружаю модель кисти…');
    try {
      this.hand = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('hand: GPU не завёлся, падаю на CPU', e);
      this.hand = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
      this.delegate = 'CPU';
    }
  }

  async start() {
    await this._acquireCamera();
    if (!this.hand) await this._loadModels();
    this._startLoop();
  }

  _startLoop() {
    this.running = true;
    this.onStatus('');
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      if (now >= this._nextAt) {
        const t0 = performance.now();
        try {
          this._processFrame(now);
        } catch (e) {
          console.warn('processFrame:', e);
        }
        const dur = performance.now() - t0;
        // адаптивный троттлинг: тяжёлый инференс → реже (паттерн doom-hands)
        this._minGap = Math.max(8, Math.min(100, dur * 1.2));
        this._nextAt = performance.now() + this._minGap;
        // телеметрия fps
        if (this._lastFrameTs) {
          const inst = 1000 / Math.max(1, now - this._lastFrameTs);
          this.fps = this.fps ? this.fps * 0.8 + inst * 0.2 : inst;
        }
        this._lastFrameTs = now;
      }
      if (this.video?.requestVideoFrameCallback) this.video.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };
    loop();
  }

  _processFrame(tMs) {
    let lm = null;
    try {
      const hres = this.hand.detectForVideo(this.video, tMs);
      if (hres.landmarks && hres.landmarks.length > 0) {
        lm = hres.landmarks[0].map(mirror);
      }
    } catch (e) {
      /* кадр мог быть не готов */
    }
    this.onFrame(this._buildModel(lm), this.video, tMs);
  }

  // Единый объект кадра. Якорь и «локоть» считаются ТОЛЬКО из точек кисти.
  _buildModel(lm) {
    if (!lm) return { ok: false, lm: null };

    const wrist = { x: lm[0].x, y: lm[0].y };
    const indexTip = { x: lm[8].x, y: lm[8].y };
    const mcp = lm[9]; // основание среднего пальца
    const handLen = Math.hypot(wrist.x - mcp.x, wrist.y - mcp.y) || 0.15;

    // Направление предплечья ≈ от пальцев к запястью (вниз от ладони).
    let dx = wrist.x - mcp.x;
    let dy = wrist.y - mcp.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;

    // «Локоть» — точка чуть ниже запястья вдоль предплечья (для забора текстуры).
    const elbow = { x: clamp(wrist.x + dx * handLen * 1.6, 0, 1), y: clamp(wrist.y + dy * handLen * 1.6, 0, 1) };

    // Якорь — продолжение предплечья до низа кадра (y≈1.06). Если рука «смотрит»
    // вверх (dy<=0), просто ставим якорь под запястьем по вертикали.
    let anchor;
    if (dy > 0.05) {
      const t = (1.06 - wrist.y) / dy;
      anchor = { x: clamp(wrist.x + dx * t, -0.1, 1.1), y: 1.06 };
    } else {
      anchor = { x: wrist.x, y: 1.06 };
    }

    return { ok: true, lm, wrist, indexTip, handLen, anchor, elbow };
  }

  pause() {
    this.running = false;
    this.video?.srcObject?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
  }

  async resume() {
    if (this.running) return;
    await this._acquireCamera();
    this._startLoop();
  }
}
