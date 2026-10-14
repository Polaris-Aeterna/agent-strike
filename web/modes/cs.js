// CS 爆破：俯视角回合制枪战。跑命令开枪，测试通过爆头，报错被 Bug 咬，等你回复就装 C4。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, WORLD, clamp, rng, actText } from '../core.js';
import { L } from '../i18n.js';
import { Particles, rand, pill, hpBar, fontFor, FONT } from '../fxkit.js';

export const meta = {
  id: 'cs',
  icon: '🔫',
  get name() { return L('CS 爆破', 'CS: Defuse'); },
  get desc() { return L('回合制枪战。跑命令开枪，测试通过爆头，等你回复就装 C4', 'Round-based shootout. Commands fire, passing tests are headshots, waiting on you plants the C4'); },
  get roundWord() { return L('回合', 'round'); },
  get wait() {
    return {
      start: L('💣 {a} 在等你回复', '💣 {a} is waiting for you'),
      sub: L('40 秒内回它就算拆弹成功，超时就炸', 'Reply within 40s to defuse — or it blows'),
      done: L('✂️ 拆弹成功', '✂️ Bomb defused'),
      boom: L('💥 {a} 等你等到爆炸了', '💥 {a} waited so long it exploded'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('开枪（Bash / exec）', 'Fire (Bash / exec)')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('爆头', 'Headshot')],
      [L('🐛 命令报错', '🐛 Command fails'), L('被 Bug 咬一口', 'Bitten by a bug')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('侦察射击，下一枪更准', 'Recon shot, next shot hits harder')],
      [L('🧱 改代码', '🧱 Edit code'), L('垒沙袋，加护甲', 'Sandbags, more armor')],
      [L('🔭 上网查资料', '🔭 Web search'), L('AWP 狙击', 'AWP snipe')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('救起倒下的队友', 'Revive a fallen teammate')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('被闪光弹闪白', 'Flashbanged')],
      [L('✅ 任务完成', '✅ Task done'), L('扔手雷', 'Throw a grenade')],
      [L('💣 它在等你', '💣 Waiting on you'), L('装 C4，40 秒内回它就是拆弹', 'C4 planted — reply within 40s to defuse')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('直接赢下这回合', 'Win the round outright')],
      [L('💰 token', '💰 Tokens'), L('赚钱买枪', 'Money for guns')],
    ];
  },
};

const ARSENAL = {
  claude: [{ name: 'USP-S', cost: 0, mult: 0.65 }, { name: 'MP9', cost: 1250, mult: 0.82 }, { name: 'M4A4', cost: 2900, mult: 1 }],
  codex: [{ name: 'Glock-18', cost: 0, mult: 0.65 }, { name: 'MAC-10', cost: 1050, mult: 0.82 }, { name: 'AK-47', cost: 2700, mult: 1 }],
};
const MONEY_CAP = 16000;

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { roundLen: 15 * 60e3 };

  init() {
    this.roundLen = this.opts.roundLen;
    this.roundDamage = 0;
    this.loss = { claude: 0, codex: 0 };
  }

  initPlayer(p) {
    Object.assign(p, { hp: 100, armor: 0, money: 800, weapon: ARSENAL[p.team][0], focus: 0, blindUntil: 0, dmgBy: new Map() });
  }

  onEnter(p) {
    p.hp = 100;
    p.focus = 0;
    p.dmgBy.clear();
  }

  onTokens(p, n) {
    p.money = Math.min(MONEY_CAP, p.money + Math.round(n / 4));
  }

  ghostOk(ev) {
    return ev.k === 'agent' || ev.k === 'pr';
  }

  onEvent(p, ev, r, fx) {
    switch (ev.k) {
      case 'shell':
        if (ev.ok === false) this.hurt(p, 10 + r() * 5, 'Bug', fx);
        else this.shoot(p, ev, r, { min: 14, max: 22, hs: 0.08, gun: true }, fx);
        break;
      case 'read':
        if (ev.ok === false) this.hurt(p, 6, 'Bug', fx);
        else {
          this.shoot(p, ev, r, { min: 6, max: 9, hs: 0.03, weapon: L('侦察', 'Recon') }, fx);
          p.focus = 1;
        }
        break;
      case 'misc':
        if (ev.ok === false) this.hurt(p, 6, 'Bug', fx);
        else this.shoot(p, ev, r, { min: 5, max: 8, hs: 0.03, weapon: 'Deagle' }, fx);
        break;
      case 'edit':
        if (ev.ok === false) this.hurt(p, 8, 'Bug', fx);
        else {
          const amount = Math.min(20, 100 - p.armor);
          p.armor += amount;
          fx.push({ type: 'armor', sid: p.sid, amount });
        }
        break;
      case 'web':
        if (ev.ok === false) fx.push({ type: 'shot', from: p.sid, to: null, weapon: 'AWP', miss: true });
        else this.shoot(p, ev, r, { min: 50, max: 70, hs: 0.25, weapon: 'AWP' }, fx);
        break;
      case 'agent':
        this.reinforce(p, fx);
        break;
      case 'think':
        p.focus = 1;
        fx.push({ type: 'think', sid: p.sid });
        break;
      case 'compact':
        p.blindUntil = ev.t + 8000;
        fx.push({ type: 'flash', sid: p.sid });
        break;
      case 'done':
        p.money = Math.min(MONEY_CAP, p.money + 500);
        fx.push({ type: 'done', sid: p.sid });
        this.grenade(p, r, fx);
        break;
      case 'prompt':
        p.hp = Math.min(100, p.hp + 10);
        break;
      case 'abort':
        fx.push({ type: 'abort', sid: p.sid });
        this.kill(null, p, { weapon: L('打断', 'interrupt'), cause: 'human' }, fx);
        break;
      case 'apierr':
        this.hurt(p, 10, 'net', fx);
        break;
      case 'pr':
        this.endRound(p.team, 'pr', fx, L('PR 已提交 · 直接拿下', 'PR opened · round won'));
        break;
    }
  }

  shoot(p, ev, r, w, fx) {
    const weapon = w.weapon || p.weapon.name;
    const foes = this.alive(OTHER[p.team]);
    if (!foes.length) {
      fx.push({ type: 'shot', from: p.sid, to: null, weapon });
      return;
    }
    const target = foes[Math.floor(r() * foes.length)];
    if (ev.t < p.blindUntil) {
      fx.push({ type: 'shot', from: p.sid, to: target.sid, weapon, miss: true });
      return;
    }
    let dmg = (w.min + r() * (w.max - w.min)) * (w.gun ? p.weapon.mult : 1) + (p.focus ? 4 : 0);
    p.focus = 0;
    const hs = (w.gun && !!ev.hs) || r() < w.hs;
    if (hs) dmg = Math.max(100, dmg * 4);
    dmg *= this.balanceMult(p.team) * this.sizeMult();
    fx.push({ type: 'shot', from: p.sid, to: target.sid, weapon, hs });
    this.damage(p, target, dmg, { hs, weapon, cause: 'gun' }, fx);
  }

  hurt(p, dmg, weapon, fx) {
    this.damage(null, p, dmg, { weapon, cause: weapon === 'Bug' ? 'bug' : 'net' }, fx);
  }

  damage(att, vic, dmg, info, fx) {
    if (!vic.alive) return;
    let toHp = Math.round(dmg);
    if (vic.armor > 0 && !info.hs) {
      const absorbed = Math.min(vic.armor, Math.round(toHp * 0.5));
      vic.armor -= absorbed;
      toHp -= absorbed;
    }
    toHp = clamp(toHp, 0, vic.hp);
    vic.hp -= toHp;
    this.roundDamage += toHp;
    if (att && att.team !== vic.team) {
      att.dmg += toHp;
      vic.dmgBy.set(att.sid, (vic.dmgBy.get(att.sid) || 0) + toHp);
    }
    fx.push({ type: 'hit', from: att ? att.sid : null, to: vic.sid, dmg: toHp, hs: !!info.hs, cause: info.cause });
    if (vic.hp <= 0) this.kill(att, vic, info, fx);
  }

  kill(att, vic, info, fx) {
    if (!vic.alive) return;
    vic.alive = false;
    vic.hp = 0;
    vic.d++;
    let assist = null;
    if (att && att.team !== vic.team) {
      att.k++;
      if (info.hs) att.hs++;
      att.money = Math.min(MONEY_CAP, att.money + 300);
      for (const [sid, d] of vic.dmgBy) {
        const a = this.players.get(sid);
        if (sid !== att.sid && d >= 30 && a) {
          a.a++;
          assist = assist || sid;
        }
      }
    }
    fx.push({ type: 'kill', killer: att ? att.sid : null, victim: vic.sid, weapon: info.weapon, hs: !!info.hs, cause: info.cause, assist });
  }

  reinforce(p, fx) {
    const mates = this.field(p.team);
    const target = !p.alive ? p : mates.find((m) => !m.alive);
    if (target) {
      Object.assign(target, { alive: true, hp: 50, armor: 0 });
      fx.push({ type: 'revive', sid: target.sid, by: p.sid });
      return;
    }
    const low = mates.filter((m) => m.alive).sort((a, b) => a.hp - b.hp)[0];
    if (low) {
      const amount = Math.min(30, 100 - low.hp);
      low.hp += amount;
      fx.push({ type: 'heal', sid: low.sid, amount, by: p.sid });
    }
  }

  grenade(p, r, fx) {
    const foes = this.alive(OTHER[p.team]);
    if (!foes.length) return;
    for (let i = foes.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [foes[i], foes[j]] = [foes[j], foes[i]];
    }
    const picks = foes.slice(0, 2);
    fx.push({ type: 'nade', from: p.sid, to: picks.map((f) => f.sid) });
    for (const f of picks) this.damage(p, f, (15 + r() * 10) * this.balanceMult(p.team) * this.sizeMult(), { weapon: 'HE', cause: 'nade' }, fx);
  }

  // C4：它在等你。及时回 = 拆弹，全队回血；超时 = 爆炸
  onAnswer(p) {
    for (const m of this.field(p.team)) if (m.alive) m.hp = Math.min(100, m.hp + 20);
  }

  onWaitTimeout(p, fx) {
    if (p.alive) this.damage(null, p, 999, { weapon: 'C4', cause: 'c4', hs: true }, fx);
    for (const m of this.field(p.team)) if (m !== p && m.alive) this.damage(null, m, 40, { weapon: 'C4', cause: 'c4' }, fx);
  }

  timers() {
    return [this.roundStart + this.roundLen];
  }

  onTick(fx) {
    if (this.now - this.roundStart < this.roundLen) return;
    if (this.roundDamage > 0) this.endRound(this.leader(), 'time', fx, L('时间到 · 存活优势', 'Time up · more survivors'));
    else this.roundStart = this.now;
  }

  leader() {
    const power = (team) => {
      const alive = this.alive(team);
      return [alive.length, alive.reduce((s, p) => s + p.hp + p.armor / 2, 0)];
    };
    const [a, b] = [power('claude'), power('codex')];
    if (a[0] !== b[0]) return a[0] > b[0] ? 'claude' : 'codex';
    if (a[1] !== b[1]) return a[1] > b[1] ? 'claude' : 'codex';
    return null;
  }

  check(fx) {
    for (const team of TEAMS) {
      const f = this.field(team);
      if (f.length && f.every((p) => !p.alive)) {
        this.endRound(OTHER[team], 'elim', fx, L('全歼对手', 'Team wiped'));
        return;
      }
    }
  }

  onRoundEnd(winner) {
    for (const team of TEAMS) {
      const won = team === winner;
      const bonus = won ? 3250 : 1400 + 500 * Math.min(this.loss[team], 4);
      for (const p of this.field(team)) p.money = Math.min(MONEY_CAP, p.money + bonus);
      this.loss[team] = won ? 0 : this.loss[team] + 1;
    }
  }

  onRoundStart() {
    this.roundDamage = 0;
    for (const p of this.field()) {
      if (!p.alive) {
        p.armor = 0;
        p.weapon = ARSENAL[p.team][0];
      }
      Object.assign(p, { alive: true, hp: 100, focus: 0, blindUntil: 0 });
      p.dmgBy.clear();
      this.buy(p);
    }
  }

  buy(p) {
    const tiers = ARSENAL[p.team];
    for (let i = tiers.length - 1; i > 0; i--) {
      if (tiers[i].mult <= p.weapon.mult) break;
      if (tiers[i].cost <= p.money) {
        p.money -= tiers[i].cost;
        p.weapon = tiers[i];
        break;
      }
    }
    if (p.armor < 100 && p.money >= 650) {
      p.money -= 650;
      p.armor = 100;
    }
  }
}

// ================================================================ 地图
// 三条路的对称地图：上路通 A 点，下路通 B 点，中路对冲。左边 Claude 家，右边 Codex 家。

const { w: W, h: H } = WORLD;
const OUTER = [[0, 0, W, 40], [0, H - 40, W, 40], [0, 0, 40, H], [W - 40, 0, 40, H]];
const WALLS = [
  [300, 160, 300, 240], [1000, 160, 300, 240], [300, 560, 300, 240], [1000, 560, 300, 240],
  [730, 310, 140, 85], [730, 565, 140, 85],
  [40, 300, 80, 25], [40, 635, 80, 25], [1480, 300, 80, 25], [1480, 635, 80, 25],
];
const CRATES = [
  [650, 45, 45, 45], [905, 190, 55, 55], [905, 870, 45, 45], [640, 715, 55, 55],
  [500, 415, 40, 40], [1060, 505, 40, 40],
  [540, 40, 45, 40], [1015, 880, 45, 40], [1015, 40, 45, 40], [540, 880, 45, 40],
];
const SOLID = WALLS.concat(CRATES);
export const NODES = {
  S1: [150, 480], S1a: [170, 150], S1b: [170, 810], T1: [450, 95], A1: [800, 140], A2: [800, 235], T2: [1150, 95],
  CAL: [655, 330], CAR: [945, 330], M1: [450, 480], M2: [660, 480], MC: [800, 480], M3: [940, 480], M4: [1150, 480],
  CBL: [655, 630], CBR: [945, 630], B2: [800, 725], B1: [800, 820], U1: [450, 865], U2: [1150, 865],
  S2: [1450, 480], S2a: [1430, 150], S2b: [1430, 810],
};
const EDGES = [
  'S1-S1a', 'S1-S1b', 'S1-M1', 'S1a-T1', 'S1b-U1', 'T1-A1', 'A1-T2', 'A1-A2', 'A2-CAL', 'A2-CAR', 'CAL-M2', 'CAR-M3',
  'M1-M2', 'M2-MC', 'MC-M3', 'M3-M4', 'M4-S2', 'CBL-M2', 'CBR-M3', 'CBL-B2', 'CBR-B2', 'B2-B1', 'U1-B1', 'B1-U2',
  'T2-S2a', 'U2-S2b', 'S2-S2a', 'S2-S2b',
];
const HOT = ['T1', 'A1', 'A2', 'T2', 'CAL', 'CAR', 'M1', 'M2', 'MC', 'M3', 'M4', 'CBL', 'CBR', 'B2', 'B1', 'U1', 'U2'];
const SPAWN = { claude: [90, 390, 160, 180], codex: [1350, 390, 160, 180] };
const ADJ = {};
for (const e of EDGES) {
  const [a, b] = e.split('-');
  (ADJ[a] ||= []).push(b);
  (ADJ[b] ||= []).push(a);
}

function bfs(from, to) {
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    if (n === to) break;
    for (const m of ADJ[n]) if (!(m in prev)) {
      prev[m] = n;
      queue.push(m);
    }
  }
  const path = [];
  for (let n = to; n; n = prev[n]) path.unshift(n);
  return path;
}

function nearestNode(x, y) {
  let best = null;
  let bd = Infinity;
  for (const [k, [nx, ny]] of Object.entries(NODES)) {
    const d = (nx - x) ** 2 + (ny - y) ** 2;
    if (d < bd) [best, bd] = [k, d];
  }
  return best;
}

function segHitsRect(x1, y1, x2, y2, [rx, ry, rw, rh]) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, x1 - rx) && clip(dx, rx + rw - x1) && clip(-dy, y1 - ry) && clip(dy, ry + rh - y1);
}
const wallbang = (a, b) => SOLID.some((r) => segHitsRect(a.x, a.y, b.x, b.y, r));

function drawMapLayer() {
  const S = 2;
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext('2d');
  g.scale(S, S);
  g.fillStyle = '#d3b07a';
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  for (let i = 0; i < 12000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(120,80,30,0.08)' : 'rgba(255,240,200,0.09)';
    const s = 1 + r() * 3;
    g.fillRect(r() * W, r() * H, s, s);
  }
  g.strokeStyle = 'rgba(90,60,25,0.07)';
  g.lineWidth = 1;
  for (let x = 40; x < W; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 40; y < H; y += 80) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  for (const team of TEAMS) {
    const x = team === 'claude' ? 40 : 1300;
    g.fillStyle = team === 'claude' ? 'rgba(236,138,95,0.13)' : 'rgba(79,168,255,0.13)';
    g.fillRect(x, 40, 260, 880);
  }

  for (const [letter, y] of [['A', 55], ['B', 670]]) {
    g.save();
    g.strokeStyle = 'rgba(170,40,30,0.45)';
    g.setLineDash([14, 10]);
    g.lineWidth = 4;
    g.strokeRect(615, y, 370, 235);
    g.restore();
    g.fillStyle = 'rgba(170,40,30,0.2)';
    g.font = `900 150px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 800, y + 122);
  }

  g.fillStyle = 'rgba(40,25,10,0.3)';
  for (const [x, y, w, h] of SOLID) g.fillRect(x + 9, y + 11, w, h);
  for (const [x, y, w, h] of WALLS) {
    g.fillStyle = '#a7814f';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(70,45,15,0.14)';
    g.lineWidth = 1.5;
    for (let yy = y + 18; yy < y + h; yy += 18) {
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
    }
    for (let yy = y, row = 0; yy < y + h; yy += 18, row++) {
      for (let xx = x + (row % 2 ? 18 : 36); xx < x + w; xx += 36) {
        g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, Math.min(yy + 18, y + h)); g.stroke();
      }
    }
    g.fillStyle = 'rgba(255,240,210,0.25)';
    g.fillRect(x, y, w, 4);
    g.fillRect(x, y, 4, h);
    g.fillStyle = 'rgba(60,35,10,0.3)';
    g.fillRect(x, y + h - 4, w, 4);
    g.fillRect(x + w - 4, y, 4, h);
  }
  for (const [x, y, w, h] of OUTER) {
    g.fillStyle = '#7a5d3b';
    g.fillRect(x, y, w, h);
  }
  for (const [x, y, w, h] of CRATES) {
    g.fillStyle = '#b07a40';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#6e4620';
    g.lineWidth = 3;
    g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    g.strokeStyle = 'rgba(110,70,32,0.8)';
    g.beginPath();
    g.moveTo(x + 5, y + 5); g.lineTo(x + w - 5, y + h - 5);
    g.moveTo(x + w - 5, y + 5); g.lineTo(x + 5, y + h - 5);
    g.stroke();
    g.fillStyle = 'rgba(255,235,200,0.18)';
    g.fillRect(x, y, w, 3);
  }
  return c;
}

// ================================================================ 画面

function spawnPoint(team) {
  const [x, y, w, h] = SPAWN[team];
  return [x + Math.random() * w, y + Math.random() * h];
}

class Bot {
  constructor(sid, team) {
    this.sid = sid;
    this.team = team;
    [this.x, this.y] = spawnPoint(team);
    this.angle = team === 'claude' ? 0 : Math.PI;
    this.path = [];
    this.hold = Math.random() * 1.5;
    this.aim = 0;
    this.hitT = 0;
    this.muzzle = 0;
    this.bubble = 0;
    this.label = null;
    this.icon = null;
    this.awp = 0;
    this.dead = false; // 回合结束动画期间，倒下的人先保持倒地
  }

  respawn() {
    this.dead = false;
    [this.x, this.y] = spawnPoint(this.team);
    this.path = [];
    this.hold = Math.random() * 1.2;
    this.angle = this.team === 'claude' ? 0 : Math.PI;
  }

  update(dt, p, active) {
    this.hitT = Math.max(0, this.hitT - dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.bubble = Math.max(0, this.bubble - dt);
    this.awp = Math.max(0, this.awp - dt);
    if (this.label && (this.label.life -= dt) <= 0) this.label = null;
    if (this.icon && (this.icon.life -= dt) <= 0) this.icon = null;
    if (!p.alive || this.dead) return;
    if (this.aim > 0) {
      this.aim -= dt;
      return;
    }
    if (!active) return;
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    if (!this.path.length) {
      const dest = HOT[Math.floor(Math.random() * HOT.length)];
      this.path = bfs(nearestNode(this.x, this.y), dest).map((n) => [NODES[n][0] + rand(-16, 16), NODES[n][1] + rand(-16, 16)]);
      return;
    }
    const [tx, ty] = this.path[0];
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = 105 * dt;
    if (dist <= step) {
      this.x = tx;
      this.y = ty;
      this.path.shift();
      if (!this.path.length) this.hold = rand(0.6, 2.8);
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      let diff = Math.atan2(dy, dx) - this.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.angle += diff * Math.min(1, dt * 8);
    }
  }
}

let mapLayer = null;

export class View {
  constructor(app) {
    this.app = app;
    mapLayer ||= drawMapLayer();
    this.fx = new Particles();
    this.bots = new Map();
    this.bugs = [];
    this.nades = [];
    this.bags = [];
    this.respawnAt = 0;
  }

  reset(R) {
    this.fx.clear();
    this.bots.clear();
    this.bugs = [];
    this.nades = [];
    this.bags = [];
    this.respawnAt = 0;
    for (const p of R.field()) this.bot(R, p.sid);
  }

  bot(R, sid) {
    let b = this.bots.get(sid);
    const p = R.players.get(sid);
    if (!b && p && p.onField) {
      b = new Bot(sid, p.team);
      this.bots.set(sid, b);
    }
    return b;
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    for (const f of list) {
      const b = f.sid ? this.bot(R, f.sid) : null;
      switch (f.type) {
        case 'act': {
          if (f.ev.k === 'think') break;
          const text = actText(f.ev);
          if (b && text && !(busy && f.ev.k === 'read')) b.label = { text, ok: f.ev.ok !== false, life: 1.7, ghost: !f.alive };
          break;
        }
        case 'bench':
          this.bots.delete(f.sid);
          break;
        case 'shot': {
          const from = this.bot(R, f.from);
          if (!from) break;
          const to = f.to ? this.bot(R, f.to) : null;
          let tx;
          let ty;
          if (to && !f.miss) [tx, ty] = [to.x, to.y];
          else if (to) {
            const a = Math.atan2(to.y - from.y, to.x - from.x) + rand(-0.5, 0.5);
            [tx, ty] = [from.x + Math.cos(a) * 160, from.y + Math.sin(a) * 160];
          } else [tx, ty] = [from.x + Math.cos(from.angle) * 140, from.y + Math.sin(from.angle) * 140];
          from.angle = Math.atan2(ty - from.y, tx - from.x);
          from.aim = busy ? 0 : 0.15;
          from.muzzle = 0.07;
          const awp = f.weapon === 'AWP';
          if (awp) from.awp = 0.5;
          fx.tracer(from.x + Math.cos(from.angle) * 22, from.y + Math.sin(from.angle) * 22, tx, ty,
            awp ? 'rgba(255,255,255,0.95)' : COLOR[from.team], awp ? 3.5 : 2, awp ? 0.4 : 0.16);
          app.sfx.shot(f.weapon);
          break;
        }
        case 'hit': {
          const to = this.bot(R, f.to);
          if (!to) break;
          const show = () => {
            to.hitT = 0.18;
            if (f.cause === 'bug') {
              const a = Math.random() * Math.PI * 2;
              this.bugs.push({ x: to.x + Math.cos(a) * 70, y: to.y + Math.sin(a) * 70, tx: to.x, ty: to.y, life: 0.9, max: 0.9 });
              fx.text(to.x + rand(-8, 8), to.y - 18, `🐛 -${f.dmg}`, '#a6e05a', 14);
              app.sfx.bite();
            } else if (f.cause === 'nade') {
              fx.explosion(to.x, to.y, false);
              fx.text(to.x, to.y - 18, `-${f.dmg}`, '#ffcf6b', 16);
            } else if (f.cause === 'c4' || f.cause === 'net') {
              fx.text(to.x, to.y - 18, `-${f.dmg}`, '#ff8a8a', 15);
            } else if (f.hs) {
              fx.text(to.x, to.y - 22, L('🎯 爆头', '🎯 HEADSHOT'), '#f5c451', 18, 1.3);
              app.sfx.headshot();
            } else {
              if (!busy) fx.text(to.x + rand(-10, 10), to.y - 18, `-${f.dmg}`, '#fff', 14);
              fx.sparks(to.x, to.y, '#ffe2b0', busy ? 2 : 5);
            }
          };
          if (f.cause === 'nade') app.later(0.45, show);
          else show();
          break;
        }
        case 'kill': {
          const victim = this.bot(R, f.victim);
          if (victim) {
            victim.path = [];
            victim.dead = true;
            fx.sparks(victim.x, victim.y, COLOR[victim.team], 12, 180);
            const killer = f.killer ? this.bot(R, f.killer) : null;
            if (killer && f.cause === 'gun' && wallbang(killer, victim)) f.wallbang = true;
          }
          break;
        }
        case 'armor':
          if (b) {
            const a = b.angle + rand(-0.6, 0.6);
            if (this.bags.length > 50) this.bags.shift();
            this.bags.push({ x: b.x + Math.cos(a) * 26, y: b.y + Math.sin(a) * 26, a: a + Math.PI / 2 });
            if (!busy) fx.text(b.x, b.y - 20, `🛡 +${f.amount}`, '#9fd0ff', 13);
          }
          break;
        case 'heal':
          if (b) {
            fx.ring(b.x, b.y, 30, 6, 'rgba(111,211,139,0.9)', 0.5);
            fx.text(b.x, b.y - 20, `+${f.amount}`, '#6fd38b', 15);
          }
          break;
        case 'revive':
          if (b) {
            b.dead = false;
            fx.ring(b.x, b.y, 90, 10, 'rgba(255,255,255,0.9)', 0.6, 4);
            fx.text(b.x, b.y - 24, L('🪂 援军救起', '🪂 Revived'), '#6fd38b', 15, 1.4);
          }
          break;
        case 'think':
          if (b) b.bubble = 1.2;
          break;
        case 'flash':
          if (b) {
            fx.ring(b.x, b.y, 10, 150, 'rgba(255,255,255,0.95)', 0.6, 30);
            fx.text(b.x, b.y - 26, L('💫 记忆被闪了', '💫 Memory flashed'), '#fff', 15, 1.5);
          }
          break;
        case 'prompt':
          if (b) fx.ring(b.x, b.y, 8, 46, 'rgba(160,210,255,0.9)', 0.6);
          break;
        case 'abort':
          if (b) b.icon = { text: '✋', life: 2 };
          break;
        case 'done':
          if (b) fx.ring(b.x, b.y, 6, 40, 'rgba(245,196,81,0.9)', 0.5);
          break;
        case 'nade': {
          const from = this.bot(R, f.from);
          if (!from) break;
          for (const sid of f.to) {
            const to = this.bot(R, sid);
            if (to) this.nades.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, t: 0, dur: 0.45 });
          }
          break;
        }
        case 'waitBoom':
          if (b) {
            fx.explosion(b.x, b.y, true);
            app.shake(0.45, 9);
          }
          break;
        case 'roundEnd':
          this.respawnAt = app.rt() + (busy ? 0.4 : 1.6);
          break;
      }
    }
  }

  update(dt, R) {
    const live = this.app.mode === 'live';
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      if (p) b.update(dt, p, R.now - p.lastActive < (live ? 60e3 : 90e3));
    }
    this.fx.update(dt);
    for (const g of this.bugs) g.life -= dt;
    this.bugs = this.bugs.filter((g) => g.life > 0);
    for (const n of this.nades) n.t += dt;
    this.nades = this.nades.filter((n) => n.t < n.dur);
    if (this.respawnAt && this.app.rt() >= this.respawnAt) {
      this.respawnAt = 0;
      this.bags = [];
      for (const [sid] of this.bots) if (!R.players.get(sid)?.onField) this.bots.delete(sid);
      for (const p of R.field()) this.bot(R, p.sid);
      for (const b of this.bots.values()) b.respawn();
    }
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(mapLayer, 0, 0, W, H);
    // 出生点地上的队名每帧画：内战时会变成「CLAUDE A / CLAUDE B」
    for (const team of TEAMS) {
      g.save();
      g.translate(team === 'claude' ? 170 : 1430, 480);
      g.rotate(team === 'claude' ? -Math.PI / 2 : Math.PI / 2);
      g.fillStyle = team === 'claude' ? 'rgba(154,69,36,0.22)' : 'rgba(30,86,143,0.22)';
      g.font = `900 ${TEAM_NAME[team].length > 6 ? 52 : 64}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(TEAM_NAME[team].toUpperCase(), 0, 0);
      g.restore();
    }
    for (const s of this.bags) {
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.a);
      g.fillStyle = '#b89a6a';
      g.strokeStyle = '#6f5733';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(-13, -5, 26, 10, 5);
      g.fill();
      g.stroke();
      g.restore();
    }
    const up = (b, p) => p.alive && !b.dead;
    const living = [];
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      if (!p) continue;
      if (!up(b, p)) this.drawBot(g, R, b, p, false);
      else living.push([b, p]);
    }
    this.fx.renderUnder(g);
    for (const [b, p] of living) this.drawBot(g, R, b, p, true);
    for (const [sid, w] of R.waits) {
      const b = this.bots.get(sid);
      if (b && !w.boom) this.drawC4(g, R, b, w, rt);
    }
    this.drawBugs(g, rt);
    for (const n of this.nades) {
      const k = n.t / n.dur;
      g.fillStyle = '#3e4a2c';
      g.beginPath();
      g.arc(n.x1 + (n.x2 - n.x1) * k, n.y1 + (n.y2 - n.y1) * k - Math.sin(k * Math.PI) * 60, 5, 0, Math.PI * 2);
      g.fill();
    }
    this.fx.renderOver(g, scale);
    const fs = fontFor(scale);
    const live = this.app.mode === 'live';
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      if (p) this.drawTags(g, b, p, up(b, p), R.now - p.lastActive < (live ? 60e3 : 90e3), fs, rt);
    }
  }

  drawBot(g, R, b, p, alive) {
    if (!alive) {
      g.globalAlpha = 0.6;
      g.strokeStyle = DEEP[b.team];
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(b.x - 10, b.y - 10); g.lineTo(b.x + 10, b.y + 10);
      g.moveTo(b.x + 10, b.y - 10); g.lineTo(b.x - 10, b.y + 10);
      g.stroke();
      g.globalAlpha = 1;
      return;
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(b.x + 3, b.y + 6, 15, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.angle);
    g.fillStyle = '#26262a';
    const len = b.awp > 0 ? 34 : p.weapon.mult >= 1 ? 25 : p.weapon.mult >= 0.8 ? 20 : 15;
    g.fillRect(6, -3.5, len, 7);
    if (b.muzzle > 0) {
      g.fillStyle = '#fff3a0';
      g.beginPath();
      g.arc(8 + len, 0, 7, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.fillStyle = b.hitT > 0 ? '#ff5a5a' : COLOR[b.team];
    g.beginPath();
    g.arc(b.x, b.y, 14, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = DEEP[b.team];
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.arc(b.x - 4, b.y - 4, 5, 0, Math.PI * 2);
    g.fill();
    if (p.armor > 0) {
      g.strokeStyle = `rgba(160,210,255,${0.25 + p.armor / 200})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(b.x, b.y, 18, -Math.PI * 0.8, -Math.PI * 0.2);
      g.stroke();
    }
    if (R.now < p.blindUntil) {
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.arc(b.x, b.y, 20, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawTags(g, b, p, alive, active, fs, rt) {
    const y = b.y - 30;
    g.globalAlpha = alive ? 1 : 0.5;
    pill(g, b.x, y, p.name, { color: COLOR[b.team], size: fs, max: 120 });
    if (alive) hpBar(g, b.x, b.y + 19, 36, p.hp / 100);
    g.globalAlpha = 1;
    if (b.label) {
      g.globalAlpha = Math.min(1, b.label.life / 0.4) * (b.label.ghost ? 0.45 : 1);
      pill(g, b.x, y - fs - 8 - (1.7 - b.label.life) * 6, b.label.text, {
        size: fs - 1, max: 190, weight: 500, bg: b.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)',
      });
      g.globalAlpha = 1;
    }
    if (b.bubble > 0 && alive) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.roundRect(b.x + 12, b.y - 24, 28, 16, 8);
      g.fill();
      g.fillStyle = '#333';
      g.font = '700 12px sans-serif';
      g.fillText('•'.repeat(1 + (Math.floor(rt * 4) % 3)), b.x + 26, b.y - 16);
    }
    if (!active && alive) {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.font = `700 ${fs}px sans-serif`;
      const k = (rt * 0.6 + b.x) % 1;
      g.globalAlpha = 1 - k;
      g.fillText('z', b.x + 16 + k * 8, b.y - 12 - k * 18);
      g.globalAlpha = 1;
    }
    if (b.icon) {
      g.font = `${fs + 10}px sans-serif`;
      g.fillText(b.icon.text, b.x, b.y - 56);
    }
  }

  drawC4(g, R, b, w, rt) {
    g.fillStyle = '#3b3f2a';
    g.fillRect(b.x + 10, b.y + 6, 16, 11);
    g.fillStyle = Math.floor(rt * 4) % 2 === 0 ? '#ff3b3b' : '#5a1a1a';
    g.beginPath();
    g.arc(b.x + 22, b.y + 11, 2.5, 0, Math.PI * 2);
    g.fill();
    const prog = clamp((R.now - w.t) / (w.deadline - w.t), 0, 1);
    g.strokeStyle = 'rgba(255,80,80,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(b.x, b.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - prog));
    g.stroke();
  }

  drawBugs(g, rt) {
    for (const s of this.bugs) {
      const k = clamp(1 - (s.life - 0.35) / (s.max - 0.35), 0, 1);
      const x = s.x + (s.tx - s.x) * k;
      const y = s.y + (s.ty - s.y) * k;
      g.globalAlpha = Math.min(1, s.life / 0.3);
      g.save();
      g.translate(x, y);
      g.rotate(Math.atan2(s.ty - s.y, s.tx - s.x));
      g.strokeStyle = '#2f4a12';
      g.lineWidth = 1.5;
      const wig = Math.sin(rt * 40) * 2;
      for (const side of [-1, 1]) for (const lx of [-4, 0, 4]) {
        g.beginPath();
        g.moveTo(lx, 0);
        g.lineTo(lx + wig * side, side * 8);
        g.stroke();
      }
      g.fillStyle = '#7bc043';
      g.beginPath();
      g.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2f4a12';
      g.beginPath();
      g.arc(7, 0, 3, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  hud(R) {
    if (R.phase !== 'live') return null;
    const left = Math.max(0, R.roundLen - (R.now - R.roundStart));
    return { mid: L(`第 ${R.round} 回合`, `Round ${R.round}`), sub: `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` };
  }
}
