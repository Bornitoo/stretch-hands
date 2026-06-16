// tracker.js — камера + гибридный трекинг: HandLandmarker (21 точка кисти) +
// PoseLandmarker (плечо/локоть как «якорь» руки). Выдаёт единый объект кадра.
//
// Всё зеркалится по X для естественного селфи-вида (как в doom-hands).
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '../vendor/mediapipe/vision_bundle.mjs';

const MP_DIR = '../vendor/mediapipe';

// Индексы Pose (33-точечная модель)
const POSE = { LSH: 11, RSH: 12, LEL: 13, REL: 14, LWR: 15, RWR: 16 };

const mirror = (p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0, v: p.visibility ?? 1 });

export class Tracker {
  constructor({ onFrame, onStatus } = {}) {
    this.onFrame = onFrame || (() => {});
    this.onStatus = onStatus || (() => {});
    this.video = null;
    this.hand = null;
    this.pose = null;
    this.running = false;
    this.usePose = true; // можно выключить ради fps
    this.poseActive = true; // адаптивно гасится на слабых машинах
    this._minGap = 33;
    this._nextAt = 0;
    // поза гоняется редко и кешируется (плечо/локоть двигаются медленно)
    this.POSE_EVERY_MS = 150;
    this._lastPoseAt = -1e9;
    this._lastPoseLm = null;
    // телеметрия производительности
    this.delegate = '?';
    this.fps = 0;
    this._emaDur = 0;
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

    const mk = async (Cls, file, extra) => {
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: `${MP_DIR}/${file}`, delegate },
        runningMode: 'VIDEO',
        ...extra,
      });
      try {
        const m = await Cls.createFromOptions(fileset, opts('GPU'));
        this.delegate = 'GPU';
        return m;
      } catch (e) {
        console.warn(`${file}: GPU не завёлся, падаю на CPU`, e);
        this.delegate = 'CPU';
        return await Cls.createFromOptions(fileset, opts('CPU'));
      }
    };

    this.onStatus('Загружаю модель кисти…');
    this.hand = await mk(HandLandmarker, 'hand_landmarker.task', {
      numHands: 1,
      // пониже пороги — чтобы кисть подхватывалась легче (в т.ч. на широком кадре)
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });

    if (this.usePose) {
      this.onStatus('Загружаю модель позы…');
      try {
        this.pose = await mk(PoseLandmarker, 'pose_landmarker_lite.task', { numPoses: 1 });
      } catch (e) {
        console.warn('Поза недоступна — работаю только по кисти', e);
        this.pose = null;
      }
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
        this._minGap = Math.max(16, Math.min(120, dur * 1.2));
        this._nextAt = performance.now() + this._minGap;

        // телеметрия fps (по интервалу между обработанными кадрами)
        if (this._lastFrameTs) {
          const inst = 1000 / Math.max(1, now - this._lastFrameTs);
          this.fps = this.fps ? this.fps * 0.8 + inst * 0.2 : inst;
        }
        this._lastFrameTs = now;

        // адаптивно гасим позу, если кадр обработки тяжёлый (слабая машина/CPU-делегат)
        this._emaDur = this._emaDur ? this._emaDur * 0.85 + dur * 0.15 : dur;
        if (this.poseActive && this._emaDur > 60) {
          this.poseActive = false;
          this._lastPoseLm = null;
          console.warn('Поза отключена ради fps (тяжёлый кадр).');
        }
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

    // Поза тяжёлая — гоняем её РЕДКО (раз в ~POSE_EVERY_MS) и кешируем плечо/локоть.
    // Иначе два инференса на кадр роняют fps до ~2 (выглядит как «нет анимации»).
    if (this.pose && this.poseActive && lm && tMs - this._lastPoseAt >= this.POSE_EVERY_MS) {
      this._lastPoseAt = tMs;
      try {
        const pres = this.pose.detectForVideo(this.video, tMs);
        this._lastPoseLm =
          pres.landmarks && pres.landmarks.length > 0 ? pres.landmarks[0].map(mirror) : null;
      } catch (e) {
        /* поза опциональна */
      }
    }
    if (!lm) this._lastPoseLm = null; // нет кисти — сбрасываем кеш позы

    const model = this._buildModel(lm, this._lastPoseLm);
    this.onFrame(model, this.video, tMs);
  }

  // Единый объект кадра для рендеров и геймплея.
  _buildModel(lm, poseLm) {
    if (!lm) return { ok: false, lm: null };

    const wrist = { x: lm[0].x, y: lm[0].y };
    const indexTip = { x: lm[8].x, y: lm[8].y };
    const handLen = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 0.15;

    // Якорь: плечо из позы, ближайшее по X к кисти (= та же сторона тела).
    // Видимость низкая / позы нет → якорь у нижнего края под кистью.
    let anchor = { x: wrist.x, y: 1.06 };
    let shoulder = null;
    let elbow = null;
    let poseOk = false;

    if (poseLm) {
      const lsh = poseLm[POSE.LSH];
      const rsh = poseLm[POSE.RSH];
      const cand = [lsh, rsh].filter((p) => p && p.v > 0.4);
      if (cand.length) {
        const sh = cand.reduce((a, b) =>
          Math.abs(a.x - wrist.x) <= Math.abs(b.x - wrist.x) ? a : b,
        );
        shoulder = { x: sh.x, y: sh.y };
        // локоть той же стороны
        const el = sh === lsh ? poseLm[POSE.LEL] : poseLm[POSE.REL];
        if (el && el.v > 0.3) elbow = { x: el.x, y: el.y };
        anchor = shoulder;
        poseOk = true;
      }
    }

    return { ok: true, lm, wrist, indexTip, handLen, anchor, shoulder, elbow, poseOk };
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
