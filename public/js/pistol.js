// pistol.js — «гам-гам пистолет»: резкий бросок кисти = удар с импакт-вспышкой,
// тряской кадра и звуком. Жесты: кулак = режим втягивания, ладонь = тянуть/бить.
//
// Чистая механика поверх состояния из stretch.js. Рендер импактов рисует app/renderer.
export const PCFG = {
  PUNCH_MIN_STRETCH: 1.4, // удар засчитываем только если рука реально вытянута
  IMPACT_MS: 420, // время жизни вспышки
  SHAKE_START: 14, // пиксели тряски (для канваса целевой высоты ~720)
  SHAKE_DECAY: 0.86, // затухание тряски за кадр
};

export class Pistol {
  constructor({ sfx, cfg = PCFG } = {}) {
    this.sfx = sfx || null;
    this.cfg = cfg;
    this.impacts = []; // {x,y,t,strength}
    this.shake = 0;
    this._wasFist = false;
    this._lastState = 'idle';
  }

  reset() {
    this.impacts.length = 0;
    this.shake = 0;
  }

  // s — объект из StretchSim.update(); tMs — текущее время.
  update(s, tMs) {
    if (!s || !s.wrist) {
      this._state = 'idle';
      this._decay();
      return this.fx(tMs);
    }

    // конечный автомат (для UI/подсказок)
    let state = 'idle';
    if (s.fist) state = 'charging';
    if (s.stretchRatio > this.cfg.PUNCH_MIN_STRETCH) state = s.fist ? 'retract' : 'extended';

    // удар: резкий бросок при достаточном растяжении
    if (s.fling && s.stretchRatio >= this.cfg.PUNCH_MIN_STRETCH) {
      this._punch(s, tMs);
      state = 'punch';
    }

    this._wasFist = s.fist;
    this._state = state;
    this._decay();
    return this.fx(tMs);
  }

  _punch(s, tMs) {
    const strength = Math.min(1, (s.stretchRatio - 1) / 3 + 0.3);
    this.impacts.push({ x: s.wrist.x, y: s.wrist.y, t: tMs, strength });
    if (this.impacts.length > 8) this.impacts.shift();
    this.shake = this.cfg.SHAKE_START * strength;
    if (this.sfx) this.sfx.punch();
  }

  _decay() {
    this.shake *= this.cfg.SHAKE_DECAY;
    if (this.shake < 0.2) this.shake = 0;
  }

  // Текущие эффекты для рендера: импакты с прогрессом [0..1] и величина тряски.
  fx(tMs) {
    const live = [];
    for (const im of this.impacts) {
      const age = (tMs - im.t) / this.cfg.IMPACT_MS;
      if (age <= 1) live.push({ x: im.x, y: im.y, progress: age, strength: im.strength });
    }
    this.impacts = this.impacts.filter((im) => tMs - im.t <= this.cfg.IMPACT_MS);
    return { impacts: live, shake: this.shake, state: this._state };
  }
}
