// 我的世界 · 盖楼大赛：两队各盖一栋楼，先盖完的赢。
// 改代码 / 跑命令放方块，上网查资料往对面扔 TNT，报错就有苦力怕在自己楼下「嘶嘶嘶……砰！」
import { Rules as Base, OTHER, COLOR, DEEP, TEAM_NAME, WORLD, rng, hash, clamp, actText } from '../core.js';
import { Particles, rand, pill, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'mc',
  icon: '⛏️',
  get name() { return L('我的世界盖楼', 'Minecraft Build-Off'); },
  get desc() { return L('两队比赛盖楼。上网查资料往对面扔 TNT，报错就有苦力怕来炸你', 'Race to build a castle. Web searches lob TNT at the rival build; errors summon a Creeper'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('⏳ {a} 蹲在楼下等你', '⏳ {a} is waiting for you at the door'),
      sub: L('40 秒内回它，不然苦力怕趁机来炸楼', 'Reply within 40s or a Creeper sneaks in'),
      done: L('✂️ 及时回复，接着盖', '✂️ Replied in time — keep building'),
      boom: L('💥 {a} 等太久，苦力怕把楼炸了', '💥 {a} waited too long — Creeper blew the build'),
    };
  },
  get legend() {
    return [
      [L('🧱 改代码', '🧱 Edit code'), L('放 2 块方块', 'Place 2 blocks')],
      [L('⛏️ 跑命令', '⛏️ Run a command'), L('放 1 块石头', 'Place 1 stone')],
      [L('💎 测试 / 编译通过', '💎 Tests / build pass'), L('钻石块，一次放 3 块', 'Diamond blocks, 3 at once')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('捡材料，偶尔多放一块', 'Gather, sometimes an extra block')],
      [L('🧨 上网查资料', '🧨 Web search'), L('往对面楼上扔 TNT', 'Throw TNT at the rival build')],
      [L('🟩 报错', '🟩 Error'), L('苦力怕在自己楼下爆炸', 'A Creeper explodes at your own build')],
      [L('🗿 派出子代理', '🗿 Spawn a subagent'), L('召唤铁傀儡，挡下一次爆炸', 'Iron Golem blocks the next blast')],
      [L('✅ 任务完成', '✅ Task done'), L('直接盖好一整层', 'Build a whole floor')],
      [L('🌙 上下文压缩', '🌙 Context compaction'), L('天黑了，掉了两块', 'Night falls, lose 2 blocks')],
      [L('✋ 你打断了它', '✋ You interrupt it'), L('你按了 Alt+F4，拆掉 6 块', 'You hit Alt+F4 — 6 blocks gone')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('一口气放 8 块', 'Place 8 blocks at once')],
    ];
  },
};

// 蓝图从下往上写。字符：# 石砖  P 木板  G 玻璃  B 红砖  W 队伍羊毛  L 原木  D 门  . 空
const BLUEPRINTS = {
  // 大约 80 块：两层小城堡
  full: [
    'LBBBBBBBL',
    'LBGGBDBGL',
    'LBGGBDBGL',
    'LBBBBBBBL',
    'PPPPPPPPP',
    '#GG###GG#',
    '#GG###GG#',
    '#########',
    'WWWWWWWWW',
    'W.W.W.W.W',
  ],
  // 大约 34 块：大乱斗里的小木屋
  party: [
    'L#####L',
    'LGG#DGL',
    'LGG#DGL',
    'PPPPPPP',
    '.WWWWW.',
    '..W.W..',
  ],
};
const MATERIAL = {
  '#': ['#8d8d8d', '#6f6f6f', '#a7a7a7'],
  P: ['#b08a4e', '#8b6a37', '#c9a263'],
  G: ['rgba(190,230,255,0.55)', 'rgba(255,255,255,0.65)', 'rgba(150,200,230,0.6)'],
  B: ['#a4493b', '#7d3328', '#c0624f'],
  L: ['#6b4f2c', '#4d3820', '#82603a'],
  D: ['#8b6a37', '#5c4423', '#a07a43'],
  W: null, // 队伍颜色
  X: ['#5fe0d8', '#2fb3ab', '#b8fff9'], // 钻石块
};

function cellsOf(rows) {
  const out = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && out.push({ x, y, ch })));
  // 从下往上、从中间往两边盖，看起来像真的在盖
  const mid = (rows[0].length - 1) / 2;
  out.sort((a, b) => a.y - b.y || Math.abs(a.x - mid) - Math.abs(b.x - mid) || a.x - b.x);
  return out;
}

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { roundLen: 30 * 60e3 };

  init() {
    this.rows = BLUEPRINTS[this.opts.party ? 'party' : 'full'];
    this.cells = cellsOf(this.rows);
    this.roundLen = this.opts.party ? 15 * 60e3 : this.opts.roundLen;
    this.plot = { claude: this.blankPlot(), codex: this.blankPlot() };
  }

  blankPlot() {
    return { built: new Array(this.cells.length).fill(null), count: 0, credit: 0, golem: 0 };
  }

  onRoundStart() {
    this.plot = { claude: this.blankPlot(), codex: this.blankPlot() };
    this.acts = 0;
  }

  /** 往自己楼上放 n 块（n 可以是小数，攒够一块才放）。 */
  place(p, n, fx, kind = null) {
    const plot = this.plot[p.team];
    plot.credit += n * this.balanceMult(p.team) * this.sizeMult() * 1.25;
    const placed = [];
    while (plot.credit >= 1 && plot.count < this.cells.length) {
      plot.credit -= 1;
      const i = plot.built.indexOf(null);
      plot.built[i] = { sid: p.sid, diamond: kind === 'diamond' };
      plot.count++;
      placed.push(i);
    }
    if (placed.length) fx.push({ type: 'place', sid: p.sid, team: p.team, cells: placed, diamond: kind === 'diamond' });
    if (plot.count >= this.cells.length) this.endRound(p.team, 'built', fx, L(`${p.name} 封顶了！`, `${p.name} topped out!`));
  }

  /** 炸掉某队楼上的一片。center 为空就挑一块已经盖好的。 */
  blast(team, size, r, fx, info) {
    const plot = this.plot[team];
    if (plot.golem > 0) {
      plot.golem--;
      fx.push({ type: 'golemBlock', team, by: info.by });
      return 0;
    }
    const filled = plot.built.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
    if (!filled.length) {
      fx.push({ type: 'blast', team, cells: [], center: null, ...info });
      return 0;
    }
    // 偏向上半部分：TNT 一般砸在楼顶附近
    filled.sort((a, b) => this.cells[b].y - this.cells[a].y);
    const pick = filled[Math.floor(r() * r() * filled.length)];
    const c = this.cells[pick];
    const hit = filled
      .map((i) => ({ i, d: Math.hypot(this.cells[i].x - c.x, (this.cells[i].y - c.y) * 1.1) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, size)
      .map((o) => o.i);
    for (const i of hit) {
      plot.built[i] = null;
      plot.count--;
    }
    fx.push({ type: 'blast', team, cells: hit, center: pick, ...info });
    return hit.length;
  }

  onEvent(p, ev, r, fx) {
    const foe = OTHER[p.team];
    // 一边特别忙、一边几乎不动时，两栋楼都会盖得很慢：动作数到上限就比谁的楼高
    if (this.phase === 'live' && ['shell', 'read', 'edit', 'web', 'misc', 'agent'].includes(ev.k) && ++this.acts >= (this.opts.party ? 90 : 260)) {
      const a = this.plot.claude.count;
      const b = this.plot.codex.count;
      if (a !== b) {
        this.endRound(a > b ? 'claude' : 'codex', 'time', fx, L('收工了 · 楼更高的赢', 'Time to clock out · the taller build wins'));
        return;
      }
    }
    switch (ev.k) {
      case 'edit':
        if (ev.ok === false) this.creeper(p, r, fx, 4);
        else this.place(p, 2, fx);
        break;
      case 'shell':
        if (ev.ok === false) this.creeper(p, r, fx, 5 + Math.floor(r() * 3));
        else if (ev.hs) this.place(p, 3, fx, 'diamond');
        else this.place(p, 1, fx);
        break;
      case 'read':
      case 'misc':
        if (ev.ok === false) this.creeper(p, r, fx, 3);
        else this.place(p, r() < 0.25 ? 1 : 0.35, fx);
        break;
      case 'web': {
        if (ev.ok === false) {
          fx.push({ type: 'tnt', from: p.sid, team: foe, dud: true });
          break;
        }
        fx.push({ type: 'tnt', from: p.sid, team: foe });
        const n = this.blast(foe, Math.max(1, Math.round((3 + r() * 3) * this.balanceMult(p.team))), r, fx, { by: p.sid, cause: 'tnt' });
        p.dmg += n;
        if (n) p.k++;
        break;
      }
      case 'agent':
        this.plot[p.team].golem++;
        fx.push({ type: 'golem', sid: p.sid, team: p.team });
        break;
      case 'done': {
        const width = this.rows[0].length;
        this.place(p, width / (this.balanceMult(p.team) * this.sizeMult() * 1.25), fx);
        fx.push({ type: 'floor', sid: p.sid });
        break;
      }
      case 'compact':
        fx.push({ type: 'night', sid: p.sid });
        this.blast(p.team, 2, r, fx, { by: p.sid, cause: 'night' });
        break;
      case 'abort':
        fx.push({ type: 'altf4', sid: p.sid });
        this.blast(p.team, 6, r, fx, { by: null, cause: 'human' });
        break;
      case 'apierr':
        this.creeper(p, r, fx, 3);
        break;
      case 'prompt':
        this.place(p, 1.5, fx);
        break;
      case 'pr':
        this.place(p, 8 / (this.balanceMult(p.team) * this.sizeMult() * 1.25), fx);
        break;
    }
  }

  creeper(p, r, fx, size) {
    fx.push({ type: 'creeper', sid: p.sid, team: p.team });
    const n = this.blast(p.team, size, r, fx, { by: null, cause: 'creeper', victim: p.sid });
    if (n) p.d++;
  }

  onWaitTimeout(p, fx) {
    this.creeper(p, rng(hash(p.sid + this.now)), fx, 8);
  }

  timers() {
    return [this.roundStart + this.roundLen];
  }

  onTick(fx) {
    if (this.now - this.roundStart < this.roundLen) return;
    const a = this.plot.claude.count;
    const b = this.plot.codex.count;
    if (a === b) this.roundStart = this.now;
    else this.endRound(a > b ? 'claude' : 'codex', 'time', fx, L('天亮了 · 楼更高的赢', 'Dawn · the taller build wins'));
  }

  progress(team) {
    return this.plot[team].count / this.cells.length;
  }
}

// ================================================================ 画面

const { w: W, h: H } = WORLD;
const GROUND = 780;
const CENTER = { claude: 420, codex: 1180 };

function shade(hex, k) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => clamp(Math.round(v * k), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

let backdrop = null;
function drawBackdrop() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = rng(11);
  // 草方块、泥土、石头
  for (let x = 0; x < W; x += 32) {
    g.fillStyle = '#5da03c';
    g.fillRect(x, GROUND, 32, 12);
    g.fillStyle = '#4a8a2f';
    for (let k = 0; k < 4; k++) g.fillRect(x + r() * 28, GROUND + 6 + r() * 6, 4, 4);
    for (let y = GROUND + 12; y < H; y += 32) {
      const deep = y > GROUND + 90;
      g.fillStyle = deep ? '#7b7b7b' : '#8a5f3c';
      g.fillRect(x, y, 32, 32);
      g.fillStyle = deep ? '#6a6a6a' : '#76502f';
      for (let k = 0; k < 5; k++) g.fillRect(x + r() * 28, y + r() * 28, 4, 4);
      if (deep && r() < 0.05) {
        g.fillStyle = '#5fe0d8';
        g.fillRect(x + 10, y + 10, 6, 6);
        g.fillRect(x + 18, y + 16, 5, 5);
      }
    }
  }
  // 中间的岩浆坑
  g.fillStyle = '#ff7a1a';
  g.fillRect(736, GROUND, 128, 40);
  g.fillStyle = '#ffb347';
  for (let k = 0; k < 12; k++) g.fillRect(740 + r() * 116, GROUND + r() * 34, 8, 4);
  return c;
}

const BS = 38; // 方块大小

export class View {
  constructor(app) {
    this.app = app;
    backdrop ||= drawBackdrop();
    this.fx = new Particles();
    this.reset();
  }

  reset(R) {
    this.fx.clear();
    this.pop = new Map(); // 刚放下的方块：缩放动画
    this.debris = [];
    this.tnts = [];
    this.creepers = [];
    this.steves = new Map();
    this.clouds = Array.from({ length: 6 }, (_, i) => ({ x: i * 290 + rand(0, 120), y: rand(60, 220), w: rand(90, 170) }));
    this.flashNight = 0;
    this.golems = { claude: 0, codex: 0 };
    if (R) for (const p of R.field()) this.steve(R, p.sid);
  }

  /** 方块在世界里的位置（左上角）。 */
  cellPos(R, team, i) {
    const c = R.cells[i];
    const width = R.rows[0].length;
    return [CENTER[team] - (width * BS) / 2 + c.x * BS, GROUND - (c.y + 1) * BS];
  }

  steve(R, sid) {
    let s = this.steves.get(sid);
    const p = R.players.get(sid);
    if (!s && p && p.onField) {
      const mates = [...this.steves.values()].filter((o) => o.team === p.team).length;
      const x = CENTER[p.team] + (p.team === 'claude' ? -1 : 1) * (230 + mates * 34);
      s = { sid, team: p.team, x, y: GROUND, tx: x, ty: GROUND, swing: 0, label: null, hop: 0 };
      this.steves.set(sid, s);
    }
    return s;
  }

  apply(list, R, busy) {
    const { fx, app } = this;
    for (const f of list) {
      const s = f.sid ? this.steve(R, f.sid) : null;
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (s && text && !(busy && f.ev.k === 'read')) s.label = { text, ok: f.ev.ok !== false, life: 1.7 };
          break;
        }
        case 'bench':
          this.steves.delete(f.sid);
          break;
        case 'place': {
          for (const i of f.cells) this.pop.set(`${f.team}:${i}`, 0.25);
          const last = f.cells[f.cells.length - 1];
          if (s) {
            const [x, y] = this.cellPos(R, f.team, last);
            s.tx = x + BS / 2 + (s.team === 'claude' ? -BS : BS) * 0.2;
            s.ty = y;
            s.swing = 0.3;
            s.hop = 0.25;
          }
          if (f.diamond) {
            const [x, y] = this.cellPos(R, f.team, last);
            fx.sparks(x + BS / 2, y + BS / 2, '#b8fff9', 14, 140);
            fx.text(x + BS / 2, y - 10, L('💎 钻石块！', '💎 Diamonds!'), '#5fe0d8', 16);
          }
          if (app.sfx.ok()) app.sfx.tone(rand(180, 240), 0.05, 0.12, 'square');
          break;
        }
        case 'tnt': {
          const from = this.steve(R, f.from);
          const width = R.rows[0].length;
          const top = GROUND - Math.max(2, R.plot[f.team].count / width) * BS;
          this.tnts.push({ x1: from ? from.x : CENTER[OTHER[f.team]], y1: from ? from.y - 60 : GROUND - 100, x2: CENTER[f.team] + rand(-80, 80), y2: top, t: 0, dur: 0.55, dud: f.dud });
          if (f.dud) fx.text(CENTER[f.team], top - 40, L('哑火了…', 'A dud…'), '#ccc', 14);
          break;
        }
        case 'creeper': {
          const dir = f.team === 'claude' ? -1 : 1;
          this.creepers.push({ x: CENTER[f.team] + dir * 260, y: GROUND, tx: CENTER[f.team] + dir * rand(20, 120), t: 0, life: busy ? 0.3 : 1.1 });
          if (!busy) fx.text(CENTER[f.team] + dir * 200, GROUND - 90, L('嘶嘶嘶……', 'Sssss…'), '#7bd35a', 16, 1);
          break;
        }
        case 'blast': {
          const at = () => {
            if (f.center == null) return;
            const [cx, cy] = this.cellPos(R, f.team, f.center);
            fx.explosion(cx + BS / 2, cy + BS / 2, f.cells.length >= 6);
            for (const i of f.cells) {
              const [x, y] = this.cellPos(R, f.team, i);
              const ch = R.cells[i].ch;
              const col = ch === 'W' ? COLOR[f.team] : (MATERIAL[ch] || MATERIAL['#'])[0];
              for (let k = 0; k < 3; k++) this.debris.push({ x: x + rand(0, BS), y: y + rand(0, BS), vx: rand(-220, 220), vy: rand(-420, -120), s: rand(8, 14), col, life: 1.4 });
            }
            fx.text(cx + BS / 2, cy - 14, `-${f.cells.length}`, '#ffcf6b', 18);
            if (f.cells.length >= 6) app.shake(0.3, 7);
            app.sfx.boom(f.cells.length >= 6);
          };
          if (f.cause === 'tnt') app.later(busy ? 0 : 0.55, at);
          else if (f.cause === 'creeper') app.later(busy ? 0 : 1.0, at);
          else at();
          break;
        }
        case 'golem':
          this.golems[f.team]++;
          if (s) fx.text(s.x, s.y - 90, L('🗿 铁傀儡来了', '🗿 Iron Golem here'), '#ddd', 15, 1.4);
          break;
        case 'golemBlock':
          this.golems[f.team] = Math.max(0, this.golems[f.team] - 1);
          fx.text(CENTER[f.team], GROUND - 160, L('🗿 铁傀儡挡住了！', '🗿 Golem blocked it!'), '#fff', 18, 1.4);
          fx.ring(CENTER[f.team] + (f.team === 'claude' ? -170 : 170), GROUND - 60, 10, 90, 'rgba(255,255,255,0.8)', 0.5, 6);
          break;
        case 'floor':
          if (s) fx.text(s.x, s.y - 100, L('✅ 一整层！', '✅ A whole floor!'), '#f5c451', 18, 1.4);
          break;
        case 'night':
          this.flashNight = 1.6;
          if (s) fx.text(s.x, s.y - 90, L('🌙 天黑了', '🌙 Night falls'), '#c9d3ff', 16, 1.4);
          break;
        case 'altf4':
          if (s) fx.text(s.x, s.y - 100, L('你按了 Alt+F4', 'You pressed Alt+F4'), '#ff8a8a', 18, 1.8);
          break;
        case 'roundStart':
          this.pop.clear();
          break;
      }
    }
  }

  update(dt, R) {
    this.fx.update(dt);
    for (const s of this.steves.values()) {
      s.x += (s.tx - s.x) * Math.min(1, dt * 6);
      s.y += (s.ty - s.y) * Math.min(1, dt * 6);
      s.swing = Math.max(0, s.swing - dt);
      s.hop = Math.max(0, s.hop - dt);
      if (s.label && (s.label.life -= dt) <= 0) s.label = null;
      // 闲下来就慢慢走回地面
      const p = R.players.get(s.sid);
      if (p && R.now - p.lastActive > 60e3) {
        s.ty = GROUND;
      }
    }
    for (const [k, v] of this.pop) {
      if (v - dt <= 0) this.pop.delete(k);
      else this.pop.set(k, v - dt);
    }
    for (const d of this.debris) {
      d.vy += 900 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt;
    }
    this.debris = this.debris.filter((d) => d.life > 0 && d.y < H);
    for (const t of this.tnts) t.t += dt;
    this.tnts = this.tnts.filter((t) => t.t < t.dur);
    for (const c of this.creepers) {
      c.t += dt;
      c.x += (c.tx - c.x) * Math.min(1, dt * 3);
    }
    this.creepers = this.creepers.filter((c) => c.t < c.life);
    this.flashNight = Math.max(0, this.flashNight - dt);
    for (const c of this.clouds) {
      c.x += dt * 12;
      if (c.x > W + 100) c.x = -200;
    }
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    // 天空：按本回合进行的时间从白天慢慢变到黄昏
    const k = R.phase === 'live' ? clamp((R.now - R.roundStart) / R.roundLen, 0, 1) : 0;
    const night = Math.max(k > 0.75 ? (k - 0.75) * 3 : 0, this.flashNight > 0 ? 0.8 : 0);
    const sky = g.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, `rgb(${Math.round(110 - 90 * night)},${Math.round(170 - 140 * night)},${Math.round(255 - 170 * night)})`);
    sky.addColorStop(1, `rgb(${Math.round(190 - 150 * night)},${Math.round(225 - 180 * night)},${Math.round(255 - 160 * night)})`);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, GROUND);
    // 太阳 / 月亮
    const sx = 120 + k * (W - 240);
    const sy = 140 + Math.sin(k * Math.PI) * -60 + 60;
    g.fillStyle = night > 0.4 ? '#e8ecff' : '#fff27a';
    g.fillRect(sx - 34, sy - 34, 68, 68);
    for (const c of this.clouds) {
      g.fillStyle = `rgba(255,255,255,${0.85 - night * 0.5})`;
      g.fillRect(c.x, c.y, c.w, 26);
      g.fillRect(c.x + 20, c.y - 16, c.w - 50, 18);
    }
    g.drawImage(backdrop, 0, 0, W, H);

    // 两栋楼：先画淡淡的蓝图，再画已经盖好的方块
    for (const team of ['claude', 'codex']) {
      const plot = R.plot[team];
      for (let i = 0; i < R.cells.length; i++) {
        const [x, y] = this.cellPos(R, team, i);
        const b = plot.built[i];
        if (!b) {
          g.strokeStyle = 'rgba(255,255,255,0.18)';
          g.setLineDash([4, 4]);
          g.strokeRect(x + 2, y + 2, BS - 4, BS - 4);
          g.setLineDash([]);
          continue;
        }
        const popT = this.pop.get(`${team}:${i}`);
        const s = popT ? 1 - popT * 2 : 1;
        this.block(g, x + (BS * (1 - s)) / 2, y + (BS * (1 - s)) / 2, BS * s, b.diamond ? 'X' : R.cells[i].ch, team);
      }
      // 楼名和进度
      const width = R.rows[0].length;
      const pct = Math.round(R.progress(team) * 100);
      const label = L(`${TEAM_NAME[team]} 的楼 · ${pct}%`, `${TEAM_NAME[team]}'s build · ${pct}%`);
      pill(g, CENTER[team], GROUND - (R.rows.length + 1) * BS - 20, label, { color: COLOR[team], size: fontFor(scale, 15), max: 300, bg: 'rgba(10,12,16,0.6)' });
      if (this.golems[team] > 0 || plot.golem > 0) this.golem(g, CENTER[team] + (team === 'claude' ? -(width * BS) / 2 - 40 : (width * BS) / 2 + 40), GROUND);
    }

    for (const c of this.creepers) this.creeper(g, c.x, c.y, c.t, c.life, rt);
    for (const t of this.tnts) {
      const q = t.t / t.dur;
      const x = t.x1 + (t.x2 - t.x1) * q;
      const y = t.y1 + (t.y2 - t.y1) * q - Math.sin(q * Math.PI) * 180;
      g.save();
      g.translate(x, y);
      g.rotate(q * 8);
      g.fillStyle = '#d9342b';
      g.fillRect(-14, -14, 28, 28);
      g.fillStyle = '#f2f2f2';
      g.fillRect(-14, -5, 28, 10);
      g.fillStyle = '#222';
      g.font = `900 8px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('TNT', 0, 0);
      g.restore();
    }
    for (const d of this.debris) {
      g.globalAlpha = Math.min(1, d.life / 0.4);
      g.fillStyle = d.col;
      g.fillRect(d.x, d.y, d.s, d.s);
    }
    g.globalAlpha = 1;

    const fs = fontFor(scale);
    for (const s of this.steves.values()) {
      const p = R.players.get(s.sid);
      if (p) this.steveSprite(g, s, p, fs);
    }
    this.fx.renderOver(g, scale);

    // 中间的 VS
    g.font = `900 ${fontFor(scale, 56)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 6;
    g.strokeText('VS', W / 2, GROUND - 150);
    g.fillText('VS', W / 2, GROUND - 150);
  }

  block(g, x, y, s, ch, team) {
    const m = ch === 'W' ? [COLOR[team], DEEP[team], shade(COLOR[team], 1.2)] : MATERIAL[ch] || MATERIAL['#'];
    g.fillStyle = m[0];
    g.fillRect(x, y, s, s);
    if (s < 8) return;
    const q = s / 4;
    g.fillStyle = m[1];
    if (ch === '#' || ch === 'B') {
      g.fillRect(x, y + s / 2 - 1.5, s, 3);
      g.fillRect(x + s / 2 - 1.5, y, 3, s / 2);
      g.fillRect(x + q - 1.5, y + s / 2, 3, s / 2);
    } else if (ch === 'P' || ch === 'D') {
      for (let k = 1; k < 4; k++) g.fillRect(x, y + k * q - 1, s, 2);
      if (ch === 'D') {
        g.fillStyle = '#e0c060';
        g.fillRect(x + s * 0.72, y + s * 0.45, 4, 4);
      }
    } else if (ch === 'L') {
      for (let k = 1; k < 4; k++) g.fillRect(x + k * q - 1, y, 2, s);
    } else if (ch === 'G') {
      g.fillStyle = m[1];
      g.fillRect(x + q, y + q, 3, q);
      g.fillRect(x + q + 4, y + q, 3, 3);
    } else if (ch === 'X') {
      g.fillStyle = m[2];
      g.fillRect(x + q, y + q, q, q);
      g.fillRect(x + 2 * q, y + 2 * q, q, q);
    } else {
      g.fillRect(x + q, y + q, q, q);
      g.fillRect(x + 2.4 * q, y + 2 * q, q * 0.8, q * 0.8);
    }
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(x, y, s, 3);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x, y + s - 3, s, 3);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }

  steveSprite(g, s, p, fs) {
    const bob = s.hop > 0 ? -Math.sin((s.hop / 0.25) * Math.PI) * 14 : 0;
    const x = s.x;
    const y = s.y + bob;
    // 腿
    g.fillStyle = '#3b3f8a';
    g.fillRect(x - 9, y - 26, 8, 26);
    g.fillRect(x + 1, y - 26, 8, 26);
    // 身体：队伍颜色的衣服
    g.fillStyle = COLOR[s.team];
    g.fillRect(x - 11, y - 56, 22, 30);
    // 手臂（放方块时挥一下）
    const arm = s.swing > 0 ? Math.sin((s.swing / 0.3) * Math.PI) * 1.2 : 0;
    g.save();
    g.translate(x + (s.team === 'claude' ? 11 : -11), y - 54);
    g.rotate((s.team === 'claude' ? -1 : 1) * arm);
    g.fillStyle = '#c69c72';
    g.fillRect(-4, 0, 8, 26);
    g.restore();
    g.fillStyle = '#c69c72';
    g.fillRect(x + (s.team === 'claude' ? -15 : 7), y - 54, 8, 24);
    // 方脑袋
    g.fillStyle = '#c69c72';
    g.fillRect(x - 12, y - 80, 24, 24);
    g.fillStyle = '#4a3420';
    g.fillRect(x - 12, y - 80, 24, 7);
    g.fillStyle = '#fff';
    g.fillRect(x - 7, y - 70, 5, 4);
    g.fillRect(x + 2, y - 70, 5, 4);
    g.fillStyle = '#3a5bd1';
    g.fillRect(x - 5, y - 70, 3, 4);
    g.fillRect(x + 4, y - 70, 3, 4);
    pill(g, x, y - 96, p.name, { color: COLOR[s.team], size: fs, max: 120 });
    if (s.label) {
      g.globalAlpha = Math.min(1, s.label.life / 0.4);
      pill(g, x, y - 96 - fs - 8, s.label.text, { size: fs - 1, max: 190, weight: 500, bg: s.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)' });
      g.globalAlpha = 1;
    }
  }

  creeper(g, x, y, t, life, rt) {
    const flash = t > life * 0.55 && Math.floor(rt * 14) % 2 === 0;
    const swell = 1 + Math.max(0, (t - life * 0.55) / (life * 0.45)) * 0.25;
    g.save();
    g.translate(x, y);
    g.scale(swell, swell);
    g.fillStyle = flash ? '#ffffff' : '#5bb33f';
    g.fillRect(-14, -64, 28, 46);
    g.fillRect(-14, -18, 12, 18);
    g.fillRect(2, -18, 12, 18);
    g.fillStyle = flash ? '#dddddd' : '#3f8a2a';
    g.fillRect(-10, -58, 6, 6);
    g.fillRect(4, -50, 6, 6);
    g.fillStyle = '#111';
    g.fillRect(-9, -56, 6, 6);
    g.fillRect(3, -56, 6, 6);
    g.fillRect(-3, -48, 6, 8);
    g.fillRect(-6, -42, 3, 6);
    g.fillRect(3, -42, 3, 6);
    g.restore();
  }

  golem(g, x, y) {
    g.fillStyle = '#d8d3c8';
    g.fillRect(x - 16, y - 70, 32, 44);
    g.fillRect(x - 24, y - 66, 8, 40);
    g.fillRect(x + 16, y - 66, 8, 40);
    g.fillRect(x - 13, y - 26, 10, 26);
    g.fillRect(x + 3, y - 26, 10, 26);
    g.fillRect(x - 10, y - 92, 20, 22);
    g.fillStyle = '#7da34b';
    g.fillRect(x - 12, y - 56, 8, 6);
    g.fillStyle = '#b02020';
    g.fillRect(x - 6, y - 84, 4, 4);
    g.fillRect(x + 2, y - 84, 4, 4);
  }

  hud(R) {
    if (R.phase !== 'live') return null;
    return { mid: L(`第 ${R.round} 局`, `Game ${R.round}`), sub: `${Math.round(R.progress('claude') * 100)}% : ${Math.round(R.progress('codex') * 100)}%` };
  }
}
