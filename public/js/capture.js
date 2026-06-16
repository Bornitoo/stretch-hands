// capture.js — снимок (PNG) и запись видео (webm) с выходного канваса.
// Всё локально: ничего не уходит на сервер, только скачивание файла в браузере.
export class Capture {
  constructor(canvas) {
    this.canvas = canvas;
    this.rec = null;
    this.chunks = [];
    this.recording = false;
  }

  _download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  snapshot() {
    this.canvas.toBlob((blob) => {
      if (blob) this._download(blob, `stretch-hands-${stamp()}.png`);
    }, 'image/png');
  }

  startRecording() {
    if (this.recording) return false;
    const stream = this.canvas.captureStream(30);
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mime) return false;
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: 'video/webm' });
      this._download(blob, `stretch-hands-${stamp()}.webm`);
    };
    this.rec.start();
    this.recording = true;
    return true;
  }

  stopRecording() {
    if (!this.recording) return;
    this.recording = false;
    try {
      this.rec.stop();
    } catch (e) {
      /* noop */
    }
  }

  toggleRecording() {
    if (this.recording) {
      this.stopRecording();
      return false;
    }
    return this.startRecording();
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}
