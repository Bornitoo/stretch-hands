// render-realistic.js — рендер №2: WebGL-лизквифай реальных пикселей ПАЛЬЦЕВ.
// Для каждого вытянутого/тянущегося пальца строим «ленту» от base к удлинённому кончику,
// текстура берётся из реального участка base→tip и растягивается вдоль удлинённой ленты.
// Рисует в свой offscreen GL-канвас; app блитит его в основной 2D-канвас.

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform int u_mode;       // 0 = фон, 1 = лента
uniform vec2 u_srcA;      // база пальца (display-норм.)
uniform vec2 u_srcB;      // реальный кончик
uniform float u_srcHalf;  // полуширина источника
varying vec2 v_uv;
void main(){
  if (u_mode == 0) { gl_FragColor = texture2D(u_tex, v_uv); return; }
  float u = v_uv.x;
  float v = v_uv.y;
  vec2 c = mix(u_srcA, u_srcB, clamp(u, 0.0, 1.0));
  vec2 d = normalize(u_srcB - u_srcA + vec2(1e-5));
  vec2 perp = vec2(-d.y, d.x);
  vec2 sp = c + perp * (v * u_srcHalf);
  vec2 tc = vec2(1.0 - sp.x, sp.y);            // зеркальная выборка под селфи-вид
  vec4 col = texture2D(u_tex, tc);
  float a = 1.0 - smoothstep(0.78, 1.0, abs(v)); // мягкие края
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

  // band — состояние нити из pinch.js. Тянет реальные пиксели у руки вдоль нити.
  draw(video, band, model, opts) {
    if (!this.ok) return false;
    const gl = this.gl;
    const W = opts.width;
    const H = opts.height;
    this.resize(W, H);
    gl.viewport(0, 0, W, H);

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

    // фон: зеркальное видео
    gl.disable(gl.BLEND);
    gl.uniform1i(this.u_mode, 0);
    this._upload(
      new Float32Array([-1, 1, 1, 0, -1, -1, 1, 1, 1, 1, 0, 0, 1, -1, 0, 1]),
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // нить: тянем кожу/пиксели у руки (b) вдоль всей нити a→b
    if (band && band.active) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(this.u_mode, 1);
      const HL = model.handLen || 0.15;
      const dx = band.b.x - band.a.x;
      const dy = band.b.y - band.a.y;
      const dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl;
      const uy = dy / dl;
      const srcLen = HL * 1.1; // сколько реальной кожи у руки берём в растяжку
      // srcA соответствует u=0 (якорь), srcB — u=1 (рука)
      gl.uniform2f(this.u_srcA, band.b.x - ux * srcLen, band.b.y - uy * srcLen);
      gl.uniform2f(this.u_srcB, band.b.x, band.b.y);
      gl.uniform1f(this.u_srcHalf, Math.max(0.02, HL * 0.32));
      const verts = this._buildStrip(band, model, W, H);
      this._upload(verts);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, verts.length / 4);
    }
    return true;
  }

  _upload(arr) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    const stride = 16;
    gl.enableVertexAttribArray(this.a_pos);
    gl.vertexAttribPointer(this.a_pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.a_uv);
    gl.vertexAttribPointer(this.a_uv, 2, gl.FLOAT, false, stride, 8);
  }

  // Лента a → b; N сегментов, на каждый 2 вершины (±ширина).
  _buildStrip(band, model, W, H) {
    const N = 10;
    const out = new Float32Array((N + 1) * 2 * 4);
    const baseW = (model.handLen || 0.15) * H * 0.55;
    const halfPx = baseW / (1 + band.stretch * 0.5) / 2; // истончение при растяжении
    const dx = (band.b.x - band.a.x) * W;
    const dy = (band.b.y - band.a.y) * H;
    const dl = Math.hypot(dx, dy) || 1;
    const pxn = (-dy / dl) * halfPx;
    const pyn = (dx / dl) * halfPx;
    let o = 0;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const cx = (band.a.x + (band.b.x - band.a.x) * t) * W;
      const cy = (band.a.y + (band.b.y - band.a.y) * t) * H;
      this._vtx(out, o, cx + pxn, cy + pyn, W, H, t, -1);
      o += 4;
      this._vtx(out, o, cx - pxn, cy - pyn, W, H, t, 1);
      o += 4;
    }
    return out;
  }

  _vtx(out, o, px, py, W, H, u, v) {
    out[o] = (px / W) * 2 - 1;
    out[o + 1] = 1 - (py / H) * 2;
    out[o + 2] = u;
    out[o + 3] = v;
  }
}
