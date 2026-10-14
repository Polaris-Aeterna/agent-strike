// 植物大战僵尸 · 对战：一队当植物守家，一队当僵尸进攻，每局交换。
// 两队每做一个动作，草坪上的僵尸就往前挪一步。僵尸冲进房子 =「僵尸吃掉了你的脑子！」
import { Rules as Base, OTHER, COLOR, TEAM_NAME, WORLD, rng, hash, clamp, actText } from '../core.js';
import { Particles, rand, pill, hpBar, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'pvz',
  icon: '🌻',
  get name() { return L('植物大战僵尸', 'Plants vs. Zombies'); },
  get desc() { return L('一队种植物守家，一队放僵尸进攻，每局交换。冲进房子就是吃掉你的脑子', 'One team plants, the other sends zombies; swap every game. Reach the house and they eat your brains'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('⏳ {a} 在等你回复', '⏳ {a} is waiting for you'),
      sub: L('40 秒内不回，僵尸会趁机往前冲', 'No reply in 40s and the zombies push forward'),
      done: L('✂️ 及时回复', '✂️ Replied in time'),
      boom: L('🧟 {a} 等太久，僵尸趁机冲上来了', '🧟 {a} waited too long — the zombies surged'),
    };
  },
  get legend() {
    return [
      [L('🌱 植物方 · 跑命令', '🌱 Plants · run a command'), L('豌豆射手开火', 'Peashooters fire')],
      [L('🌱 植物方 · 改代码', '🌱 Plants · edit code'), L('种植物（豌豆射手 / 坚果墙）', 'Plant (Peashooter / Wall-nut)')],
      [L('🍒 植物方 · 测试通过', '🍒 Plants · tests pass'), L('樱桃炸弹', 'Cherry Bomb')],
      [L('🌽 植物方 · 上网查资料', '🌽 Plants · web search'), L('玉米加农炮', 'Cob Cannon')],
      [L('🎃 植物方 · 任务完成', '🎃 Plants · task done'), L('窝瓜压扁最前面的僵尸', 'Squash the closest zombie')],
      [L('🧟 僵尸方 · 跑命令', '🧟 Zombies · run a command'), L('放一只僵尸', 'Send a zombie')],
      [L('🪣 僵尸方 · 改代码', '🪣 Zombies · edit code'), L('路障 / 铁桶僵尸', 'Conehead / Buckethead')],
      [L('🏈 僵尸方 · 测试通过', '🏈 Zombies · tests pass'), L('橄榄球僵尸', 'Football Zombie')],
      [L('🦍 僵尸方 · 任务完成', '🦍 Zombies · task done'), L('巨人僵尸', 'Gargantuar')],
      [L('🕺 僵尸方 · 派出子代理', '🕺 Zombies · spawn a subagent'), L('舞王僵尸带一群伴舞', 'Dancing Zombie + backup dancers')],
      [L('🏆 僵尸方 · 开 PR', '🏆 Zombies · open a PR'), L('一大波僵尸即将来袭！', 'A huge wave of zombies is approaching!')],
      [L('🐛 报错', '🐛 Error'), L('手滑铲掉自己的植物 / 僵尸自己摔倒', 'Shovel your own plant / a zombie trips')],
    ];
  },
};

const ROWS = 5;
const COLS = 9;
const PLANT = {
  pea: { hp: 60 }, // 豌豆射手
  rep: { hp: 70 }, // 双发射手
  nut: { hp: 320 }, // 坚果墙
  sun: { hp: 50 }, // 向日葵
};
const ZOMBIE = {
  normal: { hp: 100, speed: 1, bite: 18 }, // 普通僵尸
  cone: { hp: 190, speed: 1, bite: 18 }, // 路障
  bucket: { hp: 330, speed: 1, bite: 18 }, // 铁桶
  football: { hp: 300, speed: 1.9, bite: 26 }, // 橄榄球
  pole: { hp: 150, speed: 1.6, bite: 18 }, // 撑杆跳
  giant: { hp: 800, speed: 0.6, bite: 999 }, // 巨人
  dancer: { hp: 160, speed: 1, bite: 18 }, // 舞王
  backup: { hp: 60, speed: 1, bite: 14 }, // 伴舞
};

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { roundLen: 20 * 60e3 };

  init() {
    this.goal = this.opts.party ? 4 : 14;
    this.roundLen = this.opts.party ? 10 * 60e3 : this.opts.roundLen;
    this.setup();
  }

  setup() {
    this.plants = [];
    this.zombies = [];
    // 大乱斗里没有小推车，僵尸也出生得更近：几十个动作内就要分胜负
    this.mowers = new Array(ROWS).fill(!this.opts.party);
    this.kills = 0;
    this.nextId = 1;
    this.plantTeam = this.round % 2 === 1 || this.round === 0 ? 'claude' : 'codex';
    this.zombieTeam = OTHER[this.plantTeam];
  }

  onRoundStart(fx) {
    this.setup();
    fx.push({ type: 'sides', plants: this.plantTeam, zombies: this.zombieTeam });
    fx.push({
      type: 'announce',
      text: L(`${TEAM_NAME[this.plantTeam]} 种植物 · ${TEAM_NAME[this.zombieTeam]} 放僵尸`, `${TEAM_NAME[this.plantTeam]} plants · ${TEAM_NAME[this.zombieTeam]} zombies`),
      sub: L('僵尸冲进房子就算赢', 'Zombies win by reaching the house'),
      cls: 'gold',
    });
  }

  plantAt(row, col) {
    return this.plants.find((p) => p.row === row && p.col === col);
  }

  /** 最危险的僵尸：离房子最近的那只。 */
  front() {
    let best = null;
    for (const z of this.zombies) if (!best || z.x < best.x) best = z;
    return best;
  }

  addPlant(owner, row, col, kind, fx) {
    if (col < 0 || col >= COLS || this.plantAt(row, col)) return null;
    const p = { id: this.nextId++, row, col, kind, hp: PLANT[kind].hp, max: PLANT[kind].hp, owner: owner.sid };
    this.plants.push(p);
    fx.push({ type: 'plant', id: p.id, row, col, kind, sid: owner.sid });
    return p;
  }

  addZombie(owner, row, kind, fx, x = this.opts.party ? COLS - 1 : COLS + 0.3) {
    const base = ZOMBIE[kind];
    const hp = Math.round(base.hp * this.balanceMult(owner.team) * this.sizeMult() * 0.8);
    const z = { id: this.nextId++, row, x, kind, hp, max: hp, owner: owner.sid, jumped: false };
    this.zombies.push(z);
    fx.push({ type: 'zombie', id: z.id, row, x, kind, sid: owner.sid });
    return z;
  }

  hurtZombie(z, dmg, by, fx, how) {
    if (!this.zombies.includes(z)) return;
    z.hp -= Math.round(dmg);
    fx.push({ type: 'zhit', id: z.id, dmg: Math.round(dmg), how });
    if (z.hp > 0) return;
    this.zombies = this.zombies.filter((o) => o !== z);
    this.kills++;
    const killer = this.players.get(by);
    if (killer) {
      killer.k++;
      killer.dmg += z.max;
    }
    const owner = this.players.get(z.owner);
    if (owner) owner.d++;
    fx.push({ type: 'zdead', id: z.id, how });
    if (this.kills >= this.goal) this.endRound(this.plantTeam, 'hold', fx, L(`守住了！消灭 ${this.kills} 只僵尸`, `Held the line! ${this.kills} zombies down`));
  }

  // ---------------------------------------------------------------- 植物方

  plantMove(p, ev, r, fx) {
    const mult = this.balanceMult(p.team) * this.sizeMult();
    const z = this.front();
    switch (ev.k) {
      case 'shell':
      case 'read':
      case 'misc': {
        if (ev.ok === false) return this.oops(p, r, fx);
        if (ev.k === 'shell' && ev.hs) return this.cherry(p, z, fx);
        if (!z) return this.buildDefense(p, r, fx);
        const shooters = this.plants.filter((q) => q.row === z.row && (q.kind === 'pea' || q.kind === 'rep') && q.col < z.x);
        if (!shooters.length) return this.addPlant(p, z.row, this.freeCol(z.row, Math.max(0, Math.floor(z.x) - 3)), 'pea', fx);
        const per = ev.k === 'shell' ? 20 : 10;
        for (const s of shooters) {
          const n = s.kind === 'rep' ? 2 : 1;
          fx.push({ type: 'pea', from: s.id, to: z.id, n });
          this.hurtZombie(z, per * n * mult, p.sid, fx, 'pea');
        }
        break;
      }
      case 'edit':
        if (ev.ok === false) return this.oops(p, r, fx);
        return this.buildDefense(p, r, fx);
      case 'web':
        if (!z) return this.buildDefense(p, r, fx);
        fx.push({ type: 'cob', row: z.row, x: z.x, sid: p.sid });
        for (const o of [...this.zombies]) if (Math.abs(o.row - z.row) <= 1 && Math.abs(o.x - z.x) <= 1.3) this.hurtZombie(o, 300 * mult, p.sid, fx, 'boom');
        break;
      case 'done':
        if (!z) return this.buildDefense(p, r, fx);
        fx.push({ type: 'squash', id: z.id, row: z.row, x: z.x, sid: p.sid });
        this.hurtZombie(z, 1000, p.sid, fx, 'squash');
        break;
      case 'agent': {
        const peas = this.plants.filter((q) => q.kind === 'pea').slice(0, 2);
        for (const q of peas) {
          q.kind = 'rep';
          q.hp = q.max = PLANT.rep.hp;
          fx.push({ type: 'upgrade', id: q.id });
        }
        if (!peas.length) this.buildDefense(p, r, fx);
        break;
      }
      case 'compact':
        fx.push({ type: 'dazed', team: p.team, sid: p.sid });
        for (const o of this.zombies) o.x -= 0.4;
        break;
      case 'prompt':
        for (const q of this.plants) q.hp = q.max;
        fx.push({ type: 'heal', team: p.team, sid: p.sid });
        break;
      case 'abort':
        for (let i = 0; i < 3; i++) this.oops(p, r, fx, L('你把植物铲了', 'You shoveled it'));
        break;
      case 'pr':
        this.mowers.fill(true);
        fx.push({ type: 'mowers' });
        break;
    }
  }

  freeCol(row, from) {
    for (let c = clamp(from, 0, COLS - 1); c >= 0; c--) if (!this.plantAt(row, c)) return c;
    for (let c = from + 1; c < COLS; c++) if (!this.plantAt(row, c)) return c;
    return -1;
  }

  buildDefense(p, r, fx) {
    const z = this.front();
    // 有僵尸逼近又没人挡：在它前面放一颗坚果
    if (z && z.x < 6 && !this.plants.some((q) => q.row === z.row && q.col < z.x && q.col >= z.x - 2)) {
      const col = Math.max(0, Math.floor(z.x) - 1);
      if (this.addPlant(p, z.row, this.freeCol(z.row, col), 'nut', fx)) return;
    }
    // 否则找豌豆射手最少的一行，往后排种
    const count = (row) => this.plants.filter((q) => q.row === row && (q.kind === 'pea' || q.kind === 'rep')).length;
    const rows = [...Array(ROWS).keys()].sort((a, b) => count(a) - count(b) || r() - 0.5);
    for (const row of rows) {
      const col = this.freeCol(row, 2);
      if (col >= 0) {
        this.addPlant(p, row, col, r() < 0.2 ? 'sun' : 'pea', fx);
        return;
      }
    }
  }

  cherry(p, z, fx) {
    if (!z) return;
    fx.push({ type: 'cherry', row: z.row, x: z.x, sid: p.sid });
    for (const o of [...this.zombies]) if (Math.abs(o.row - z.row) <= 1 && Math.abs(o.x - z.x) <= 1.5) this.hurtZombie(o, 400, p.sid, fx, 'boom');
  }

  oops(p, r, fx, why = L('手滑铲掉了', 'Oops, shoveled')) {
    const mine = this.plants.filter((q) => q.owner === p.sid);
    const pool = mine.length ? mine : this.plants;
    if (!pool.length) return;
    const q = pool[Math.floor(r() * pool.length)];
    this.plants = this.plants.filter((o) => o !== q);
    fx.push({ type: 'shovel', id: q.id, why, sid: p.sid });
  }

  // ---------------------------------------------------------------- 僵尸方

  zombieMove(p, ev, r, fx) {
    // 偏向植物少的行
    const weak = () => {
      const w = [...Array(ROWS).keys()].map((row) => 1 / (1 + this.plants.filter((q) => q.row === row).length));
      let t = r() * w.reduce((a, b) => a + b, 0);
      for (let row = 0; row < ROWS; row++) if ((t -= w[row]) <= 0) return row;
      return ROWS - 1;
    };
    switch (ev.k) {
      case 'shell':
        if (ev.ok === false) return this.trip(p, r, fx);
        this.addZombie(p, weak(), ev.hs ? 'football' : 'normal', fx);
        break;
      case 'read':
      case 'misc':
        if (ev.ok === false) return this.trip(p, r, fx);
        for (const z of this.zombies) z.x -= 0.15;
        fx.push({ type: 'smell', sid: p.sid });
        break;
      case 'edit':
        if (ev.ok === false) return this.trip(p, r, fx);
        this.addZombie(p, weak(), r() < 0.55 ? 'cone' : 'bucket', fx);
        break;
      case 'web':
        this.addZombie(p, weak(), 'pole', fx);
        break;
      case 'done':
        this.addZombie(p, weak(), 'giant', fx);
        fx.push({ type: 'announce', text: L('巨人僵尸来了！', 'Gargantuar incoming!'), cls: 'bad' });
        break;
      case 'agent': {
        const row = weak();
        this.addZombie(p, row, 'dancer', fx);
        for (const dr of [-1, 1]) if (row + dr >= 0 && row + dr < ROWS) this.addZombie(p, row + dr, 'backup', fx, COLS + 0.6);
        this.addZombie(p, row, 'backup', fx, COLS + 1);
        fx.push({ type: 'announce', text: L('🕺 舞王僵尸带着伴舞来了', '🕺 Dancing Zombie brought backup'), cls: 'bad', ms: 1400 });
        break;
      }
      case 'compact':
        for (const z of this.zombies) z.x += 0.5;
        fx.push({ type: 'lost', sid: p.sid });
        break;
      case 'prompt':
        this.addZombie(p, weak(), 'normal', fx);
        this.addZombie(p, weak(), 'normal', fx);
        break;
      case 'abort':
        for (let i = 0; i < 2; i++) this.trip(p, r, fx, L('被你叫回家吃饭了', 'Called home for dinner'));
        break;
      case 'pr':
        fx.push({ type: 'announce', text: L('一大波僵尸即将来袭！', 'A huge wave of zombies is approaching!'), cls: 'bad', ms: 2200 });
        for (let i = 0; i < 5; i++) this.addZombie(p, i % ROWS, i % 2 ? 'cone' : 'normal', fx, COLS + 0.3 + i * 0.2);
        break;
    }
  }

  trip(p, r, fx, why = L('自己摔倒了', 'Tripped over')) {
    const mine = this.zombies.filter((z) => z.owner === p.sid);
    const pool = mine.length ? mine : this.zombies;
    if (!pool.length) return;
    const z = pool.reduce((a, b) => (b.hp < a.hp ? b : a));
    this.zombies = this.zombies.filter((o) => o !== z);
    fx.push({ type: 'zdead', id: z.id, how: 'trip', why });
  }

  // ---------------------------------------------------------------- 每个动作都让僵尸往前挪一步

  step(fx) {
    for (const z of [...this.zombies]) {
      if (!this.zombies.includes(z)) continue;
      const base = ZOMBIE[z.kind];
      const block = this.plants.filter((q) => q.row === z.row && q.col + 0.6 >= z.x - 0.35 && q.col <= z.x).sort((a, b) => b.col - a.col)[0];
      if (block) {
        if (z.kind === 'pole' && !z.jumped) {
          z.jumped = true;
          z.x = block.col - 0.5;
          fx.push({ type: 'vault', id: z.id, x: z.x });
          continue;
        }
        block.hp -= base.bite;
        fx.push({ type: 'bite', id: z.id, plant: block.id });
        if (block.hp <= 0) {
          this.plants = this.plants.filter((q) => q !== block);
          fx.push({ type: 'eaten', id: block.id, by: z.id });
        }
        continue;
      }
      z.x -= 0.34 * base.speed;
      if (z.x < -0.2) {
        if (this.mowers[z.row]) {
          this.mowers[z.row] = false;
          fx.push({ type: 'mower', row: z.row });
          for (const o of [...this.zombies]) if (o.row === z.row) this.hurtZombie(o, 9999, null, fx, 'mower');
        } else {
          fx.push({ type: 'brains', row: z.row, id: z.id });
          this.endRound(this.zombieTeam, 'brains', fx, L('僵尸吃掉了你的脑子！', 'The zombies ate your brains!'));
          return;
        }
      }
    }
  }

  onEvent(p, ev, r, fx) {
    if (ev.k === 'think' || ev.k === 'apierr') return;
    if (p.team === this.plantTeam) this.plantMove(p, ev, r, fx);
    else this.zombieMove(p, ev, r, fx);
    if (this.phase === 'live' && ['shell', 'read', 'edit', 'web', 'misc', 'agent'].includes(ev.k)) this.step(fx);
  }

  onWaitTimeout(p, fx) {
    const r = rng(hash(p.sid + this.now));
    if (p.team === this.plantTeam) {
      for (const z of this.zombies) z.x -= 1;
      fx.push({ type: 'announce', text: L('僵尸趁你不在冲上来了！', 'The zombies rushed while you were away!'), cls: 'bad' });
    } else {
      this.trip(p, r, fx, L('等太久，僵尸睡着了', 'Waited so long it fell asleep'));
    }
  }

  timers() {
    return [this.roundStart + this.roundLen];
  }

  onTick(fx) {
    if (this.now - this.roundStart >= this.roundLen) this.endRound(this.plantTeam, 'time', fx, L('天亮了，僵尸退走了', 'Dawn — the zombies retreat'));
  }
}

// ================================================================ 画面

const { w: W, h: H } = WORLD;
const LX = 270;
const LY = 210;
const CW = 132;
const RH = 138;
const cellX = (col) => LX + col * CW + CW / 2;
const rowY = (row) => LY + row * RH + RH / 2;

let lawn = null;
function drawLawn() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#3d6b2a';
  g.fillRect(0, 0, W, H);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      g.fillStyle = (row + col) % 2 ? '#6cbf45' : '#5fb03c';
      g.fillRect(LX + col * CW, LY + row * RH, CW, RH);
    }
  }
  const r = rng(5);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = 'rgba(30,80,20,0.18)';
    g.fillRect(LX + r() * CW * COLS, LY + r() * RH * ROWS, 2, 5);
  }
  // 房子
  g.fillStyle = '#c9b48a';
  g.fillRect(0, LY - 40, 150, RH * ROWS + 80);
  g.fillStyle = '#8f4a3a';
  g.beginPath();
  g.moveTo(0, LY - 40);
  g.lineTo(190, LY - 40);
  g.lineTo(150, LY - 120);
  g.lineTo(0, LY - 120);
  g.fill();
  g.fillStyle = '#6b4a2c';
  g.fillRect(60, LY + RH * 2 + 20, 70, 110);
  g.fillStyle = '#e0c060';
  g.fillRect(118, LY + RH * 2 + 75, 6, 6);
  for (const y of [LY + 30, LY + RH * 4 + 10]) {
    g.fillStyle = '#9fd7ff';
    g.fillRect(40, y, 70, 60);
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.strokeRect(40, y, 70, 60);
  }
  // 围栏和马路
  g.fillStyle = '#e8dcc2';
  for (let y = LY - 20; y < LY + RH * ROWS + 20; y += 26) g.fillRect(200, y, 14, 20);
  g.fillStyle = '#5b5f66';
  g.fillRect(LX + CW * COLS + 10, 0, W, H);
  g.fillStyle = '#f2d34f';
  for (let y = 20; y < H; y += 80) g.fillRect(LX + CW * COLS + 70, y, 10, 44);
  // 顶部卡槽
  g.fillStyle = 'rgba(70,40,20,0.85)';
  g.fillRect(0, 0, W, 150);
  return c;
}

export class View {
  constructor(app) {
    this.app = app;
    lawn ||= drawLawn();
    this.fx = new Particles();
    this.reset();
  }

  reset(R) {
    this.fx.clear();
    this.sprites = new Map(); // id -> { kind, row, x, y, hit, plant? }
    this.peas = [];
    this.mowerRun = [];
    this.labels = new Map();
    this.drops = [];
    if (!R || !R.plants) return;
    for (const p of R.plants) this.sprites.set(p.id, { plant: true, kind: p.kind, row: p.row, x: cellX(p.col), y: rowY(p.row), hit: 0, pop: 0 });
    for (const z of R.zombies) this.sprites.set(z.id, { plant: false, kind: z.kind, row: z.row, x: LX + z.x * CW, y: rowY(z.row), hit: 0, eat: 0 });
  }

  apply(list, R, busy) {
    const { fx, app } = this;
    for (const f of list) {
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (text && !(busy && f.ev.k === 'read')) this.labels.set(f.sid, { text, ok: f.ev.ok !== false, life: 1.7 });
          break;
        }
        case 'roundStart':
        case 'sides':
          this.reset(R);
          break;
        case 'plant':
          this.sprites.set(f.id, { plant: true, kind: f.kind, row: f.row, x: cellX(f.col), y: rowY(f.row), hit: 0, pop: 0.3 });
          if (!busy) fx.ring(cellX(f.col), rowY(f.row), 10, 50, 'rgba(180,255,140,0.9)', 0.4);
          if (app.sfx.ok()) app.sfx.tone(520, 0.06, 0.08, 'triangle', 780);
          break;
        case 'zombie':
          this.sprites.set(f.id, { plant: false, kind: f.kind, row: f.row, x: LX + f.x * CW + 40, y: rowY(f.row), hit: 0, eat: 0 });
          if (!busy && app.sfx.ok()) app.sfx.tone(120, 0.25, 0.08, 'sawtooth', 90);
          break;
        case 'pea': {
          const a = this.sprites.get(f.from);
          const b = this.sprites.get(f.to);
          if (a && b) for (let i = 0; i < f.n; i++) this.peas.push({ x: a.x + 30, y: a.y - 22, tx: b.x - 10, ty: b.y - 30, t: -i * 0.08, dur: busy ? 0.12 : 0.3 });
          if (app.sfx.ok()) app.sfx.tone(380, 0.04, 0.06, 'square');
          break;
        }
        case 'zhit': {
          const s = this.sprites.get(f.id);
          if (s) {
            s.hit = 0.15;
            if (!busy && f.how !== 'mower') fx.text(s.x, s.y - 80, `-${f.dmg}`, '#fff', 14);
          }
          break;
        }
        case 'zdead': {
          const s = this.sprites.get(f.id);
          if (s) {
            if (f.how === 'boom') fx.smoke(s.x, s.y - 40, 6, 18, 'rgba(30,30,30,0.6)');
            else fx.sparks(s.x, s.y - 40, '#9aa88a', 8, 140);
            if (f.why) fx.text(s.x, s.y - 100, f.why, '#ddd', 14, 1.3);
            this.drops.push({ ...s, life: 0.6, max: 0.6 });
          }
          this.sprites.delete(f.id);
          break;
        }
        case 'cherry':
        case 'cob': {
          const x = LX + f.x * CW;
          const y = rowY(f.row);
          if (f.type === 'cob') this.peas.push({ x, y: -40, tx: x, ty: y - 30, t: 0, dur: 0.4, corn: true });
          app.later(f.type === 'cob' ? 0.4 : 0.1, () => {
            fx.explosion(x, y - 30, true);
            app.shake(0.3, 8);
            app.sfx.boom(true);
          });
          fx.text(x, y - 120, f.type === 'cob' ? L('🌽 玉米加农炮！', '🌽 Cob Cannon!') : L('🍒 樱桃炸弹！', '🍒 Cherry Bomb!'), '#ffcf6b', 20, 1.4);
          break;
        }
        case 'squash': {
          const x = LX + f.x * CW;
          this.drops.push({ squash: true, x, y: rowY(f.row), life: 0.7, max: 0.7 });
          fx.text(x, rowY(f.row) - 130, L('🎃 窝瓜！', '🎃 Squash!'), '#b6e36b', 20, 1.3);
          app.later(0.25, () => app.shake(0.2, 6));
          break;
        }
        case 'upgrade': {
          const s = this.sprites.get(f.id);
          if (s) {
            s.kind = 'rep';
            fx.ring(s.x, s.y - 20, 10, 60, 'rgba(120,255,120,0.9)', 0.5);
          }
          break;
        }
        case 'shovel': {
          const s = this.sprites.get(f.id);
          if (s) {
            fx.text(s.x, s.y - 70, `🥄 ${f.why}`, '#ffd28a', 14, 1.4);
            this.drops.push({ ...s, life: 0.5, max: 0.5 });
          }
          this.sprites.delete(f.id);
          break;
        }
        case 'bite': {
          const s = this.sprites.get(f.id);
          const q = this.sprites.get(f.plant);
          if (s) s.eat = 0.4;
          if (q) q.hit = 0.12;
          if (!busy && app.sfx.ok()) app.sfx.tone(260, 0.05, 0.05, 'square', 180);
          break;
        }
        case 'eaten': {
          const q = this.sprites.get(f.id);
          if (q) fx.text(q.x, q.y - 60, L('啊呜', 'Chomp'), '#fff', 14);
          this.sprites.delete(f.id);
          break;
        }
        case 'vault': {
          const s = this.sprites.get(f.id);
          if (s) fx.text(s.x, s.y - 110, L('撑杆跳！', 'Pole vault!'), '#ffe08a', 15);
          break;
        }
        case 'mower':
          this.mowerRun.push({ row: f.row, x: LX - 40 });
          app.sfx.boom(false);
          break;
        case 'brains':
          fx.text(120, rowY(f.row) - 60, '🧠', '#fff', 40, 2);
          app.shake(0.6, 10);
          break;
        case 'dazed':
          fx.text(W / 2, LY - 20, L('💫 植物被闪晕了，僵尸趁机前进', '💫 Plants dazed — zombies advance'), '#fff', 18, 1.4);
          break;
        case 'lost':
          fx.text(W / 2, LY - 20, L('🌀 僵尸迷路了，往回走了几步', '🌀 Zombies got lost and backed off'), '#fff', 18, 1.4);
          break;
        case 'smell':
          if (!busy) fx.text(LX + CW * COLS - 60, LY - 20, L('👃 闻到脑子的味道了', '👃 Smells like brains'), '#c8ffb0', 14);
          break;
        case 'heal':
          for (const s of this.sprites.values()) if (s.plant) fx.ring(s.x, s.y - 20, 30, 6, 'rgba(111,211,139,0.9)', 0.5);
          break;
      }
    }
  }

  update(dt, R) {
    this.fx.update(dt);
    if (!R.zombies) return;
    for (const z of R.zombies) {
      const s = this.sprites.get(z.id);
      if (!s) continue;
      const tx = LX + z.x * CW;
      s.x += (tx - s.x) * Math.min(1, dt * 4);
      s.hit = Math.max(0, s.hit - dt);
      s.eat = Math.max(0, s.eat - dt);
    }
    for (const s of this.sprites.values()) {
      if (s.plant) {
        s.hit = Math.max(0, s.hit - dt);
        s.pop = Math.max(0, s.pop - dt);
      }
    }
    for (const p of this.peas) p.t += dt;
    this.peas = this.peas.filter((p) => p.t < p.dur);
    for (const m of this.mowerRun) m.x += dt * 900;
    this.mowerRun = this.mowerRun.filter((m) => m.x < W + 100);
    for (const d of this.drops) d.life -= dt;
    this.drops = this.drops.filter((d) => d.life > 0);
    for (const [sid, l] of this.labels) if ((l.life -= dt) <= 0) this.labels.delete(sid);
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(lawn, 0, 0, W, H);
    if (!R.zombies) return;
    // 小推车
    for (let row = 0; row < ROWS; row++) if (R.mowers[row]) this.mower(g, LX - 40, rowY(row) + 20);
    for (const m of this.mowerRun) this.mower(g, m.x, rowY(m.row) + 20);

    // 按行从上往下画，下面的挡住上面的
    const sprites = [...this.sprites.entries()].sort((a, b) => a[1].y - b[1].y || b[1].x - a[1].x);
    for (const [id, s] of sprites) {
      if (s.plant) this.plantSprite(g, s, rt, R.plants.find((p) => p.id === id));
      else this.zombieSprite(g, s, rt, R.zombies.find((z) => z.id === id));
    }
    for (const d of this.drops) {
      g.globalAlpha = d.life / d.max;
      if (d.squash) {
        const k = 1 - d.life / d.max;
        const y = d.y - 200 + Math.min(1, k * 3) * 160;
        g.fillStyle = '#7fb83e';
        g.beginPath();
        g.ellipse(d.x, y, 46, 40, 0, 0, Math.PI * 2);
        g.fill();
      } else if (d.plant) this.plantSprite(g, d, rt);
      else this.zombieSprite(g, { ...d, y: d.y + (1 - d.life / d.max) * 30 }, rt, null, true);
    }
    g.globalAlpha = 1;
    for (const p of this.peas) {
      if (p.t < 0) continue;
      const k = p.t / p.dur;
      const x = p.x + (p.tx - p.x) * k;
      const y = p.y + (p.ty - p.y) * k;
      if (p.corn) {
        g.fillStyle = '#f2d34f';
        g.beginPath();
        g.ellipse(x, y, 14, 26, 0, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = '#7ed957';
        g.strokeStyle = '#3c8a26';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 9, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    this.fx.renderOver(g, scale);
    this.cards(g, R, scale);
  }

  /** 顶部卡槽：左边植物方的人，右边僵尸方的人。 */
  cards(g, R, scale) {
    const fs = fontFor(scale, 13);
    for (const team of [R.plantTeam, R.zombieTeam]) {
      const plants = team === R.plantTeam;
      const ps = R.field(team);
      g.font = `900 ${fontFor(scale, 20)}px ${FONT}`;
      g.textAlign = plants ? 'left' : 'right';
      g.textBaseline = 'middle';
      g.fillStyle = COLOR[team];
      g.fillText(`${plants ? '🌻' : '🧟'} ${TEAM_NAME[team]}${plants ? L(' 植物方', ' · Plants') : L(' 僵尸方', ' · Zombies')}`, plants ? 24 : W - 24, 28);
      ps.slice(0, 6).forEach((p, i) => {
        const x = plants ? 24 + i * 128 : W - 24 - 118 - i * 128;
        g.fillStyle = plants ? '#d9c08a' : '#7d8a74';
        g.beginPath();
        g.roundRect(x, 50, 118, 88, 10);
        g.fill();
        g.font = `${fontFor(scale, 34)}px "Apple Color Emoji", sans-serif`;
        g.textAlign = 'center';
        g.fillText(plants ? ['🌱', '🌻', '🥜', '🍒', '🌽', '🎃'][i] : ['🧟', '🧟‍♂️', '🧟‍♀️', '🪣', '🏈', '🕺'][i], x + 59, 82);
        pill(g, x + 59, 122, p.name, { color: COLOR[team], size: fs, max: 110 });
        const l = this.labels.get(p.sid);
        if (l) {
          g.globalAlpha = Math.min(1, l.life / 0.4);
          pill(g, x + 59, 158 + (i % 2) * 22, l.text, { size: fs - 1, max: 200, weight: 500, bg: l.ok ? 'rgba(10,12,16,0.8)' : 'rgba(120,20,20,0.85)' });
          g.globalAlpha = 1;
        }
      });
    }
    // 进度：还要消灭多少只
    const mowers = R.mowers.filter(Boolean).length;
    pill(g, W / 2, 28, L(`已消灭 ${R.kills} / ${R.goal} 只僵尸 · 小推车 ${mowers}/5`, `Zombies down ${R.kills} / ${R.goal} · Mowers ${mowers}/5`), { size: fontFor(scale, 15), max: 500, bg: 'rgba(0,0,0,0.45)' });
  }

  mower(g, x, y) {
    g.fillStyle = '#d33b2f';
    g.fillRect(x - 22, y - 16, 44, 22);
    g.fillStyle = '#333';
    g.beginPath();
    g.arc(x - 12, y + 8, 7, 0, Math.PI * 2);
    g.arc(x + 12, y + 8, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#999';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x - 20, y - 16);
    g.lineTo(x - 34, y - 40);
    g.stroke();
  }

  plantSprite(g, s, rt, p) {
    const x = s.x;
    const y = s.y + 30;
    const sway = Math.sin(rt * 3 + x) * 3;
    const scale = s.pop ? 1 - s.pop * 1.5 : 1;
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.ellipse(0, 4, 30, 9, 0, 0, Math.PI * 2);
    g.fill();
    const hit = s.hit > 0;
    if (s.kind === 'nut') {
      const crack = p ? 1 - p.hp / p.max : 0;
      g.fillStyle = hit ? '#e8b080' : '#b07a3e';
      g.beginPath();
      g.ellipse(0, -40, 34, 42, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(-10, -48, 5, 0, Math.PI * 2);
      g.arc(10, -48, 5, 0, Math.PI * 2);
      g.fill();
      if (crack > 0.4) {
        g.strokeStyle = '#4a2e14';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-20, -70);
        g.lineTo(-5, -50);
        g.lineTo(-18, -30);
        g.stroke();
      }
    } else if (s.kind === 'sun') {
      g.strokeStyle = '#3c8a26';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(sway, -40);
      g.stroke();
      g.fillStyle = '#ffd23f';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + rt;
        g.beginPath();
        g.ellipse(sway + Math.cos(a) * 26, -62 + Math.sin(a) * 26, 12, 7, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#8a5a1e';
      g.beginPath();
      g.arc(sway, -62, 20, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.fillRect(sway - 8, -68, 4, 6);
      g.fillRect(sway + 4, -68, 4, 6);
    } else {
      g.strokeStyle = '#3c8a26';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(sway, -36);
      g.stroke();
      g.fillStyle = '#4fae2e';
      g.beginPath();
      g.ellipse(-16, -8, 16, 7, -0.4, 0, Math.PI * 2);
      g.ellipse(16, -8, 16, 7, 0.4, 0, Math.PI * 2);
      g.fill();
      const head = s.kind === 'rep' ? '#3d9a2a' : '#6fd04a';
      g.fillStyle = hit ? '#d8ffb0' : head;
      g.beginPath();
      g.arc(sway, -58, 26, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(sway + 30, -58, 14, 12, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1f4d12';
      g.beginPath();
      g.arc(sway + 40, -58, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(sway + 6, -66, 5, 0, Math.PI * 2);
      g.fill();
      if (s.kind === 'rep') {
        g.fillStyle = '#2f7a1e';
        g.beginPath();
        g.ellipse(sway - 24, -78, 12, 6, -0.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
    if (p && p.hp < p.max) hpBar(g, x, y + 10, 50, p.hp / p.max);
  }

  zombieSprite(g, s, rt, z, dying = false) {
    const x = s.x;
    const y = s.y + 34;
    const big = s.kind === 'giant' ? 1.6 : s.kind === 'backup' ? 0.85 : 1;
    const walk = dying ? 0 : Math.sin(rt * (s.kind === 'football' ? 10 : 5) + x) * 6;
    const lean = s.eat > 0 ? Math.sin(rt * 20) * 4 : 0;
    g.save();
    g.translate(x, y);
    g.scale(big, big);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.ellipse(0, 2, 26, 8, 0, 0, Math.PI * 2);
    g.fill();
    // 腿
    g.strokeStyle = '#4a4033';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(-4, -30);
    g.lineTo(-8 + walk, 0);
    g.moveTo(6, -30);
    g.lineTo(10 - walk, 0);
    g.stroke();
    // 身体
    const coat = s.kind === 'dancer' || s.kind === 'backup' ? '#f2f2f2' : s.kind === 'football' ? '#c0392b' : '#6b5440';
    g.fillStyle = s.hit > 0 ? '#ffdddd' : coat;
    g.fillRect(-16 + lean, -74, 32, 46);
    g.fillStyle = '#b33';
    g.fillRect(-3 + lean, -72, 6, 26);
    // 伸出去的手
    g.strokeStyle = '#9fae8f';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(-14 + lean, -66);
    g.lineTo(-40 + lean, -62 + walk * 0.4);
    g.stroke();
    // 头
    g.fillStyle = s.hit > 0 ? '#e9f2dd' : '#a9b996';
    g.beginPath();
    g.arc(-4 + lean, -92, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(-12 + lean, -96, 6, 0, Math.PI * 2);
    g.arc(0 + lean, -95, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(-13 + lean, -96, 2.5, 0, Math.PI * 2);
    g.arc(-1 + lean, -95, 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a3a2a';
    g.fillRect(-16 + lean, -82, 14, 4);
    // 帽子
    if (s.kind === 'cone') {
      g.fillStyle = '#f08a24';
      g.beginPath();
      g.moveTo(-24 + lean, -104);
      g.lineTo(16 + lean, -104);
      g.lineTo(-4 + lean, -146);
      g.fill();
    } else if (s.kind === 'bucket') {
      g.fillStyle = '#9aa3ab';
      g.fillRect(-24 + lean, -132, 40, 30);
      g.fillStyle = '#c3cbd2';
      g.fillRect(-24 + lean, -132, 40, 6);
    } else if (s.kind === 'football') {
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.arc(-4 + lean, -98, 22, Math.PI, 0);
      g.fill();
    } else if (s.kind === 'pole' && !(z && z.jumped)) {
      g.strokeStyle = '#d9b26a';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(-40, -120);
      g.lineTo(30, -10);
      g.stroke();
    } else if (s.kind === 'dancer') {
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(-4 + lean, -110, 22, Math.PI, 0);
      g.fill();
    } else if (s.kind === 'giant') {
      g.strokeStyle = '#6b4a2c';
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(20, -70);
      g.lineTo(44, -130);
      g.stroke();
    }
    g.restore();
    if (z && z.hp < z.max) hpBar(g, x, y + 8, 50, z.hp / z.max);
  }

  hud(R) {
    if (R.phase !== 'live' || !R.zombies) return null;
    return { mid: L(`第 ${R.round} 局`, `Game ${R.round}`), sub: `${TEAM_NAME[R.plantTeam]}🌻 vs ${TEAM_NAME[R.zombieTeam]}🧟` };
  }
}
