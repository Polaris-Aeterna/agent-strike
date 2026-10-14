// 各个游戏共用的画面小工具：飘字、光环、火花、爆炸、弹道、名字牌、血条。
// 坐标一律用世界坐标（1600×960），app 已经把画布变换设好了。

export const rand = (a, b) => a + Math.random() * (b - a);
export const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';

export class Particles {
  constructor() {
    this.clear();
  }

  clear() {
    this.texts = [];
    this.rings = [];
    this.parts = [];
    this.tracers = [];
  }

  text(x, y, text, color = '#fff', size = 15, life = 1.1) {
    if (this.texts.length > 80) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life, max: life });
  }

  ring(x, y, r0, r1, color, life = 0.5, lw = 3) {
    this.rings.push({ x, y, r0, r1, color, life, max: life, lw });
  }

  sparks(x, y, color, n = 6, speed = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * rand(0.4, 1);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.5), max: 0.5, color, size: rand(1.5, 3.5) });
    }
  }

  smoke(x, y, n = 8, size = 14, color = 'rgba(80,70,60,0.5)') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(15, 60);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.8, 1.6), max: 1.6, color, size: rand(size / 2, size), smoke: true });
    }
  }

  explosion(x, y, big = false) {
    this.ring(x, y, 4, big ? 170 : 70, 'rgba(255,170,60,0.9)', big ? 0.7 : 0.45, big ? 10 : 6);
    this.ring(x, y, 0, big ? 120 : 50, 'rgba(255,240,180,0.9)', 0.25, 14);
    this.smoke(x, y, big ? 26 : 10, big ? 22 : 14);
    this.sparks(x, y, '#ffcf6b', big ? 24 : 10, big ? 260 : 160);
  }

  tracer(x1, y1, x2, y2, color, w = 2, life = 0.16) {
    if (this.tracers.length > 80) return;
    this.tracers.push({ x1, y1, x2, y2, color, w, life, max: life });
  }

  update(dt) {
    const tick = (arr) => {
      for (const x of arr) x.life -= dt;
      return arr.filter((x) => x.life > 0);
    };
    this.texts = tick(this.texts);
    this.rings = tick(this.rings);
    this.tracers = tick(this.tracers);
    for (const q of this.parts) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.92;
      q.vy *= 0.92;
    }
    this.parts = tick(this.parts);
  }

  /** 弹道画在人物下面，其它画在上面：先 renderUnder，画完人物再 renderOver。 */
  renderUnder(g) {
    for (const t of this.tracers) {
      g.globalAlpha = t.life / t.max;
      g.strokeStyle = t.color;
      g.lineWidth = t.w;
      g.beginPath();
      g.moveTo(t.x1, t.y1);
      g.lineTo(t.x2, t.y2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  renderOver(g, scale = 1) {
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      g.globalAlpha = r.life / r.max;
      g.strokeStyle = r.color;
      g.lineWidth = r.lw;
      g.beginPath();
      g.arc(r.x, r.y, Math.max(0.1, r.r0 + (r.r1 - r.r0) * k), 0, Math.PI * 2);
      g.stroke();
    }
    for (const q of this.parts) {
      g.globalAlpha = (q.life / q.max) * (q.smoke ? 0.6 : 1);
      g.fillStyle = q.color;
      g.beginPath();
      g.arc(q.x, q.y, q.size * (q.smoke ? 1 + (1 - q.life / q.max) : 1), 0, Math.PI * 2);
      g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = 1 - t.life / t.max;
      g.globalAlpha = Math.min(1, t.life / 0.35);
      g.font = `800 ${Math.max(t.size, (t.size / scale) * 0.9)}px ${FONT}`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.strokeText(t.text, t.x, t.y - k * 26);
      g.fillStyle = t.color;
      g.fillText(t.text, t.x, t.y - k * 26);
    }
    g.globalAlpha = 1;
  }
}

export function fitText(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** 深色圆角小牌子，名字或动作气泡都用它。 */
export function pill(g, x, y, text, { color = '#fff', bg = 'rgba(10,12,16,0.65)', size = 12, max = 140, weight = 600 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const t = fitText(g, text, max);
  const w = g.measureText(t).width + 10;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(x - w / 2, y - size / 2 - 3, w, size + 6, 5);
  g.fill();
  g.fillStyle = color;
  g.fillText(t, x, y);
  return w;
}

export function hpBar(g, x, y, w, frac, h = 4) {
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(x - w / 2, y, w, h);
  g.fillStyle = frac > 0.6 ? '#6fd38b' : frac > 0.3 ? '#f5c451' : '#ff6b6b';
  g.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), h);
}

export function emoji(g, ch, x, y, size) {
  g.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, x, y);
}

/** 世界坐标里，至少在屏幕上有 min 像素大的字号。 */
export const fontFor = (scale, base = 12) => Math.max(base, base / scale);
