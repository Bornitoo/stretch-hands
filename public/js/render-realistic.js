// render-realistic.js — рендер №2: WebGL-лизквифай реальных пикселей предплечья.
// Рисует в собственный offscreen GL-канвас: зеркальное видео фоном + «ленту»-предплечье,
// чья текстура берётся из реального участка локоть→кисть и растягивается вдоль
// удлинённой оси (приём Snapchat-линз). app блитит этот канвас в основной 2D-канвас.
//
// Требует позу (локоть). Если локтя нет — draw() возвращает false, и app падает на cartoon.

const VERT = `
attribute vec2 a_pos;   // clip space
attribute vec2 a_uv;    // bg: texcoord; strip: (u, v)
varying vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform int u_mode;       // 0 = фон, 1 = лента
uniform vec2 u_srcA;      // локоть (display-норм. координаты)
uniform vec2 u_srcB;      // кисть
uniform float u_srcHalf;  // полуширина источника-предплечья
varying vec2 v_uv;
void main(){
  if (u_mode == 0) { gl_FragColor = texture2D(u_tex, v_uv); return; }
  float u = v_uv.x;
  float v = v_uv.y;
  vec2 c = mix(u_srcA, u_srcB, clamp(u, 0.0, 1.0));
  vec2 d = normalize(u_srcB - u_srcA + vec2(1e-5));
  vec2 perp = vec2(-d.y, d.x);
  vec2 sp = c + perp * (v * u_srcHalf);
  vec2 tc = vec2(1.0 - sp.x, sp.y);          // зеркальная выборка под селфи-вид
  vec4 col = texture2D(u_tex, tc);
  float a = 1.0 - smoothstep(0.72, 1.0, abs(v)); // мягкие края ленты
  gl_FragColor = vec4(col.rgb, col.a * a);
}
`;

export class RealisticRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = null;
    this.ok = false;
    this._init();
  }

  _init() {
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: false });
    if (!gl) return;
    this.gl = gl;
    const prog = this._program(VERT, FRAG);
    if (!prog) return;
    this.prog = prog;
    this.a_pos = gl.getAttribLocation(prog, 'a_pos');
    this.a_uv = gl.getAttribLocation(prog, 'a_uv');
    this.u_tex = gl.getUniformLocation(prog, 'u_tex');
    this.u_mode = gl.getUniformLocation(prog, 'u_mode');
    this.u_srcA = gl.getUniformLocation(prog, 'u_srcA');
    this.u_srcB = gl.getUniformLocation(prog, 'u_srcB');
    this.u_srcHalf = gl.getUniformLocation(prog, 'u_srcHalf');
    this.buf = gl.createBuffer();
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.ok = true;
  }

  _program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('shader:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const v = sh(gl.VERTEX_SHADER, vs);
    const f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('link:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // Возвращает true при успешной отрисовке (тогда app блитит this.canvas).
  draw(video, model, s, opts) {
    if (!this.ok || !s || !s.segments) return false;
    if (!model.elbow) return false; // нужен реальный локоть из позы
    const gl = this.gl;
    const W = opts.width;
    const H = opts.height;
    this.resize(W, H);
    gl.viewport(0, 0, W, H);

    // загрузка кадра видео в текстуру
    try {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    } catch (e) {
      return false;
    }

    gl.useProgram(this.prog);
    gl.uniform1i(this.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    // ----- фон: зеркальное видео на весь экран -----
    gl.disable(gl.BLEND);
    gl.uniform1i(this.u_mode, 0);
    // display-углы (nx,ny) → clip; texcoord = (1-nx, ny)
    const bg = new Float32Array([
      -1, 1, 1, 0, // top-left
      -1, -1, 1, 1, // bottom-left
      1, 1, 0, 0, // top-right
      1, -1, 0, 1, // bottom-right
    ]);
    this._upload(bg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ----- лента предплечья -----
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.u_mode, 1);
    gl.uniform2f(this.u_srcA, model.elbow.x, model.elbow.y);
    gl.uniform2f(this.u_srcB, model.wrist.x, model.wrist.y);
    gl.uniform1f(this.u_srcHalf, Math.max(0.04, model.handLen * 0.6));

    const verts = this._buildStrip(s.segments, W, H);
    this._upload(verts);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, verts.length / 4);
    return true;
  }

  _upload(arr) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    const stride = 16; // 4 floats
    gl.enableVertexAttribArray(this.a_pos);
    gl.vertexAttribPointer(this.a_pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.a_uv);
    gl.vertexAttribPointer(this.a_uv, 2, gl.FLOAT, false, stride, 8);
  }

  // Triangle-strip лента: на каждый сегмент 2 вершины (лево/право).
  // pos = clip(display), uv = (u вдоль, v поперёк ±1).
  _buildStrip(segs, W, H) {
    const n = segs.length;
    const out = new Float32Array(n * 2 * 4);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const a = segs[Math.max(0, i - 1)];
      const b = segs[Math.min(n - 1, i + 1)];
      // перпендикуляр в пиксельном пространстве
      const tx = (b.x - a.x) * W;
      const ty = (b.y - a.y) * H;
      const len = Math.hypot(tx, ty) || 1;
      const half = (segs[i].thickness * H) / 2;
      const pxn = (-ty / len) * half; // px смещение
      const pyn = (tx / len) * half;
      const cx = segs[i].x * W;
      const cy = segs[i].y * H;
      const u = i / (n - 1);
      // левая вершина
      this._vtx(out, o, cx + pxn, cy + pyn, W, H, u, -1);
      o += 4;
      // правая вершина
      this._vtx(out, o, cx - pxn, cy - pyn, W, H, u, 1);
      o += 4;
    }
    return out;
  }

  _vtx(out, o, px, py, W, H, u, v) {
    out[o] = (px / W) * 2 - 1; // clip x
    out[o + 1] = 1 - (py / H) * 2; // clip y
    out[o + 2] = u;
    out[o + 3] = v;
  }
}
