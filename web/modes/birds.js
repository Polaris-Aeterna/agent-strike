// 愤怒的小鸟：横版，两边各有一座猪堡和一把弹弓，隔空互射，先把对面的猪全打爆的过关。
// 跑命令弹红鸟，测试通过扔炸弹黑鸟，上网查资料放黄鸟穿一排，派子代理是蓝鸟一分三，任务完成放大红鸟，开 PR 神鹰降临。
// 规则层没有物理引擎，只有格子：每座堡是一张「列 × 行」的格子图，一列从地面往上连续堆（离散重力），
// 打掉下面的，上面的就砸下来；一列比旁边高出 3 格就往旁边倒。画面层再把它演成抛物线和满天的碎木头。
import { Rules as Base, TEAMS, OTHER, COLOR, TEAM_NAME, WORLD, ACTIONS, clamp, rng, hash, actText } from '../core.js';
import { L } from '../i18n.js';
import { Particles, rand, pill, fontFor, FONT } from '../fxkit.js';

export const meta = {
  id: 'birds',
  icon: '🐦',
  get name() { return L('愤怒的小鸟', 'Angry Birds'); },
  get desc() { return L('两座猪堡隔空对射。跑命令弹小鸟，测试通过扔炸弹鸟，开 PR 召唤神鹰', 'Two pig forts, two slingshots. Commands fling birds, passing tests send Bomb, a PR summons the Mighty Eagle'); },
  get roundWord() { return L('关', 'level'); },
  get wait() {
    return {
      start: L('🐷 {a} 在等你回复，对面的猪在笑', '🐷 {a} is waiting for you — the pigs are laughing'),
      sub: L('40 秒内回它：下一只鸟又准又狠；超时 TNT 在自家爆炸', 'Reply within 40s for an aimed, fully drawn shot — or the TNT blows at home'),
      done: L('✂️ 及时回复，瞄准完毕，弓已拉满', '✂️ Replied in time — aimed and fully drawn'),
      boom: L('💥 {a} 等太久，TNT 在自家堡里炸了', '💥 {a} waited too long — TNT went off at home'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('🔴 红鸟，撞一下', '🔴 Red: a small hit')],
      [L('🎯 测试 / 编译通过', '🎯 Tests / build pass'), L('💣 炸弹黑鸟，大爆炸', '💣 Bomb: big blast')],
      [L('🔭 上网查资料', '🔭 Web search'), L('🟡 黄鸟加速，穿透一整排', '🟡 Chuck: speeds through a whole row')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('🔵 蓝鸟一分为三', '🔵 The Blues: split into three')],
      [L('✅ 任务完成', '✅ Task done'), L('🔴 大红鸟，砸塌一片', '🔴 Terence: a huge hit')],
      [L('🧰 其它工具', '🧰 Other tools'), L('⚪ 白鸟下蛋轰炸', '⚪ Matilda drops an egg bomb')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('瞄准：下一发直接砸中猪', 'Aim: the next shot lands right on a pig')],
      [L('🤔 思考', '🤔 Thinking'), L('拉满弓，下一发更狠', 'Full draw: the next shot hits harder')],
      [L('🧱 改代码', '🧱 Edit code'), L('加固自家堡垒，给猪戴头盔', 'Fortify your fort, helmets for pigs')],
      [L('💬 你发了消息', '💬 You sent a message'), L('换一只鸟：下一只红鸟换成炸弹鸟', 'Swap birds: the next Red becomes a Bomb')],
      [L('❌ 报错', '❌ Error'), L('打歪了：飞出画面，或者弹回自家', 'Missed: off-screen, or it bounces back home')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('小鸟睡着了，哑弹', 'The bird fell asleep — a dud')],
      [L('✋ 你打断了它', '✋ You interrupt it'), L('它把自己的塔推倒了', 'It knocks over its own tower')],
      [L('⏳ 它在等你', '⏳ Waiting on you'), L('猪在笑；40 秒不回，TNT 在自家爆炸', 'Pigs laugh; 40s without a reply and the TNT blows at home')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('神鹰降临，整座猪堡夷为平地', 'Mighty Eagle flattens the whole fort')],
    ];
  },
};

// ================================================================ 规则

// 堡垒蓝图，从上往下写；第 0 列是正面（朝着对手的那一面）。
// W 木头  I 冰  S 石头  p 小猪  h 头盔猪  m 胡子工头猪  k 猪王  . 空
// 每一列都从地面连续往上堆，而且相邻两列高度差不超过 2（不然开局就倒了）。
const LAYOUTS = {
  full: ['...k...', '..SWS..', '.hWWWm.', '.WIpIW.', 'SSWWWSS', 'WpIWIhW', 'SSSSSSS'],
  party: ['..m..', '.hWp.', 'WIWIW', 'SSSSS'],
};
// hp 血量 · w 重量（砸下去多疼）· fall 每掉一格摔掉多少 · helm 自带头盔
const MAT = {
  W: { hp: 100, w: 1, fall: 8 }, I: { hp: 60, w: 0.8, fall: 16 }, S: { hp: 170, w: 2, fall: 5 },
  p: { hp: 50, w: 0.6, fall: 16, pig: true }, h: { hp: 55, w: 0.7, fall: 14, pig: true, helm: 70 },
  m: { hp: 90, w: 0.8, fall: 12, pig: true, helm: 40 }, k: { hp: 140, w: 1, fall: 10, pig: true },
};
const CRUSH = 30;
const PTS = { block: 500, pig: 5000 };
// 每种鸟对不同材料的倍率（原版的克制关系：黄鸟克木头，蓝鸟克冰，炸弹鸟克石头）
const BIRDS = {
  red: { W: 1, I: 1, S: 0.6, pig: 1 }, chuck: { W: 2, I: 0.9, S: 0.35, pig: 1.2 }, bomb: { W: 1, I: 1.2, S: 1.5, pig: 1 },
  blues: { W: 0.5, I: 2.2, S: 0.3, pig: 1 }, terence: { W: 1.2, I: 1.2, S: 1, pig: 1 }, matilda: { W: 1, I: 1, S: 0.8, pig: 1.2 },
  tnt: { W: 1, I: 1.2, S: 1.2, pig: 1 },
};
// 撞击范围：[列偏移, 行偏移, 伤害]。列偏移 +1 是撞击点后面那一格（离射手更远）
const blast = (core, rad) => {
  const out = [];
  for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
    const d = Math.hypot(dc, dr);
    if (d <= rad) out.push([dc, dr, core * (1 - d / (rad + 0.7))]);
  }
  return out;
};
const HIT = {
  red: [[0, 0, 75], [1, 0, 28], [-1, 0, 18], [0, 1, 22], [0, -1, 22]],
  matilda: [[0, 0, 105], [0, -1, 55], [1, 0, 30], [-1, 0, 30]],
  terence: [[0, 0, 210], [1, 0, 110], [-1, 0, 70], [0, 1, 95], [0, -1, 95], [1, 1, 50], [1, -1, 50], [-1, 1, 35], [-1, -1, 35], [2, 0, 60]],
  blues: [[0, 0, 55], [1, 0, 12]],
  bomb: blast(150, 2.1),
  tnt: blast(140, 1.8),
};
const isPig = (t) => !!MAT[t]?.pig;
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const birdName = (k) => ({
  red: L('红鸟', 'Red'), chuck: L('黄鸟', 'Chuck'), bomb: L('炸弹鸟', 'Bomb'), blues: L('蓝鸟三兄弟', 'The Blues'),
  terence: L('大红鸟', 'Terence'), matilda: L('白鸟', 'Matilda'), eagle: L('神鹰', 'Mighty Eagle'),
})[k] || k;
const newCtx = () => ({ dealt: 0, pigs: [], blocks: 0 });

/** 格子图压平成一张表，fx 里带给画面（画面对比前后两张表就知道哪块碎了、哪块掉下来了）。 */
function entsOf(grid) {
  const out = [];
  grid.forEach((col, c) => col.forEach((e, r) => e && out.push({ id: e.id, t: e.t, c, r, hp: e.hp, max: e.max, helm: e.helm })));
  return out;
}

export class Rules extends Base {
  // power：整体火力。调到一天大约 8～10 关、一关 40 个动作上下；大乱斗里一关 10～20 个动作
  static defaults = { roundLen: 20 * 60e3, partyRoundLen: 6 * 60e3, power: 0.55, partyPower: 0.45 };

  init() {
    const o = this.opts;
    this.layout = LAYOUTS[o.party ? 'party' : 'full'];
    this.cols = this.layout[0].length;
    this.rows = this.layout.length + 3; // 头顶留 3 格给加固
    this.roundLen = o.party ? o.partyRoundLen : o.roundLen;
    this.power = o.party ? o.partyPower : o.power;
    this.actCap = o.party ? 80 : 240;
    this.snapSeq = 0;
    this.setup();
  }

  setup() {
    this.fort = { claude: this.build(), codex: this.build() };
    this.pts = { claude: 0, codex: 0 };
    this.miss = { claude: 0, codex: 0 };
    this.acts = 0;
    this.dealt = 0;
    this.lastBird = null;
  }

  build() {
    const f = { grid: [], nextId: 1, credit: 0, blocks0: 0, pigs0: 0 };
    for (let c = 0; c < this.cols; c++) f.grid.push(new Array(this.rows).fill(null));
    const n = this.layout.length;
    this.layout.forEach((row, i) => [...row].forEach((ch, c) => {
      if (ch === '.') return;
      f.grid[c][n - 1 - i] = this.ent(f, ch);
      f[isPig(ch) ? 'pigs0' : 'blocks0']++;
    }));
    return f;
  }

  ent(f, t) {
    return { id: f.nextId++, t, hp: MAT[t].hp, max: MAT[t].hp, helm: MAT[t].helm || 0 };
  }

  snap(team) {
    return { seq: ++this.snapSeq, round: this.round, ents: entsOf(this.fort[team].grid) };
  }

  initPlayer(p) {
    Object.assign(p, { aim: false, draw: false, swap: false });
  }

  onRoundStart(fx) {
    this.setup();
    for (const p of this.players.values()) this.initPlayer(p);
    fx.push({ type: 'birdLevel', snaps: { claude: this.snap('claude'), codex: this.snap('codex') } });
  }

  // ---------------------------------------------------------------- 格子工具

  pigsOf(f) {
    const out = [];
    f.grid.forEach((col, c) => col.forEach((e, r) => e && isPig(e.t) && out.push({ c, r, e })));
    return out;
  }

  pigs(team) {
    return this.pigsOf(this.fort[team]);
  }

  blocksOf(f) {
    return f.grid.reduce((n, col) => n + col.filter((e) => e && !isPig(e.t)).length, 0);
  }

  height(f, c) {
    let h = 0;
    while (h < this.rows && f.grid[c][h]) h++;
    return h;
  }

  /** 从天上砸下来：落在这一列最上面那个东西上（空列就砸地面）。 */
  topAt(f, c) {
    const h = this.height(f, c);
    return h ? { c, r: h - 1 } : { c, r: 0, ground: true };
  }

  /** 平着飞过来：从正面数，这一行第一个挡路的东西；一路没东西就落到目标那一列顶上。 */
  scanRow(f, row, toC) {
    for (let c = 0; c <= toC; c++) if (f.grid[c][row]) return { c, r: row };
    return this.topAt(f, toC);
  }

  /** 扣血：头盔先挡掉大半，挡到碎为止。 */
  damage(e, d, ctx) {
    if (!e || e.hp <= 0 || d <= 0) return;
    const a = Math.min(e.helm, d * 0.8);
    e.helm -= a;
    ctx.dealt += Math.min(e.hp, d - a);
    e.hp = Math.max(0, e.hp - (d - a));
  }

  hurt(f, c, r, dmg, bird, ctx) {
    const e = f.grid[c]?.[r];
    if (e) this.damage(e, dmg * ((isPig(e.t) ? BIRDS[bird].pig : BIRDS[bird][e.t]) ?? 1), ctx);
  }

  splash(f, at, pattern, bird, mult, ctx) {
    for (const [dc, dr, dmg] of pattern) this.hurt(f, at.c + dc, at.r + dr, dmg * mult, bird, ctx);
  }

  fallHurt(e, d, ctx) {
    this.damage(e, MAT[e.t].fall * Math.min(d, 4), ctx);
  }

  /** 上面掉下来的东西砸在 e 头上。猪最怕这个。 */
  crush(e, weight, d, ctx) {
    if (e) this.damage(e, CRUSH * weight * Math.min(d, 4) * (isPig(e.t) ? 1 : 0.4), ctx);
  }

  /** 清掉碎了的方块和爆掉的猪。 */
  sweep(f, ctx) {
    for (const col of f.grid) col.forEach((e, r) => {
      if (!e || e.hp > 0) return;
      col[r] = null;
      if (isPig(e.t)) ctx.pigs.push(e.t);
      else ctx.blocks++;
    });
  }

  /** 离散重力：每一列往下压实，悬空的整段砸在下面那个东西上。 */
  compact(f, ctx) {
    let moved = false;
    for (const col of f.grid) {
      const list = [];
      col.forEach((e, r) => e && list.push([e, r]));
      if (list.every(([, r], i) => r === i)) continue;
      col.fill(null);
      let prevD = 0;
      list.forEach(([e, r], i) => {
        const d = r - i;
        if (d > 0) {
          moved = true;
          this.fallHurt(e, d, ctx);
          if (d > prevD && i > 0) this.crush(list[i - 1][0], list.slice(i).reduce((s, [x]) => s + MAT[x.t].w, 0), d - prevD, ctx);
        }
        prevD = d;
        col[i] = e;
      });
    }
    return moved;
  }

  /** 一列比旁边高出 3 格以上，最上面那块就往矮的那边倒。 */
  topple(f, ctx) {
    const h = f.grid.map((_, c) => this.height(f, c));
    for (let c = 0; c < this.cols; c++) {
      const to = [c + 1, c - 1].filter((n) => n >= 0 && n < this.cols && h[c] - h[n] >= 3).sort((a, b) => h[a] - h[b])[0];
      if (to == null) continue;
      const e = f.grid[c][h[c] - 1];
      f.grid[c][h[c] - 1] = null;
      f.grid[to][h[to]] = e;
      this.fallHurt(e, h[c] - 1 - h[to], ctx);
      if (h[to] > 0) this.crush(f.grid[to][h[to] - 1], MAT[e.t].w, h[c] - 1 - h[to], ctx);
      return true;
    }
    return false;
  }

  /** 撞完之后一直塌，塌到稳住为止。每一步都让东西变低，所以一定会停。 */
  settle(f, ctx) {
    for (let i = 0; i < 200; i++) {
      this.sweep(f, ctx);
      if (!this.compact(f, ctx) && !this.topple(f, ctx)) return;
    }
  }

  // ---------------------------------------------------------------- 事件

  onEvent(p, ev, r, fx) {
    if (this.phase !== 'live') return;
    // 一边特别忙、一边几乎不动时：鸟打完了就比谁剩的猪多
    if (ACTIONS.has(ev.k) && ++this.acts >= this.actCap) {
      const w = this.leader();
      if (w) return this.endRound(w, 'birds', fx, L('鸟用完了 · 剩下的猪更多', 'Out of birds · more pigs standing'));
    }
    const bad = ev.ok === false;
    const say = (type) => fx.push({ type, sid: p.sid, team: p.team });
    switch (ev.k) {
      case 'shell':
        if (bad) this.whiff(p, r() < 0.5 ? 'off' : 'back', fx);
        else this.shoot(p, ev.hs ? 'bomb' : 'red', r, fx);
        break;
      case 'web':
      case 'misc':
        if (bad) this.whiff(p, 'off', fx);
        else this.shoot(p, ev.k === 'web' ? 'chuck' : 'matilda', r, fx);
        break;
      case 'agent': this.shoot(p, 'blues', r, fx); break;
      case 'done': this.shoot(p, 'terence', r, fx); break;
      case 'pr':
        fx.push({ type: 'announce', text: L('神鹰降临！', 'Mighty Eagle!'), sub: L(`${p.name} 开了 PR，扔出沙丁鱼罐头`, `${p.name} opened a PR and threw the sardine can`), cls: 'gold', ms: 1800 });
        this.shoot(p, 'eagle', r, fx);
        break;
      case 'read': // 看走眼了就白瞄
        if ((p.aim = !bad)) say('birdAim');
        break;
      case 'think': p.draw = true; say('birdDraw'); break;
      case 'edit':
        if (bad) fx.push({ type: 'birdBuild', sid: p.sid, team: p.team, kind: 'fail' });
        else this.fortify(p, r, fx);
        break;
      case 'prompt': p.swap = true; say('birdSwap'); break;
      case 'compact': p.swap = false; this.whiff(p, 'dud', fx); break;
      case 'abort': this.pushOver(p, fx); break;
      case 'apierr': this.whiff(p, 'wind', fx); break;
    }
  }

  /** 弹一只鸟到对面堡上。 */
  shoot(p, bird, r, fx) {
    const foe = OTHER[p.team];
    const f = this.fort[foe];
    const pigs = this.pigsOf(f);
    if (!pigs.length) return;
    if (bird === 'red' && p.swap) [bird, p.swap] = ['bomb', false];
    const aimed = p.aim;
    const mult = this.balanceMult(p.team) * this.sizeMult() * this.power * (p.draw ? 1.35 : 1);
    p.aim = p.draw = false;
    [this.miss[p.team], this.lastBird] = [0, bird];
    // 瞄准过就正中那只猪；没瞄准就在它附近散开，可能被前面的墙挡住
    const pig = pigs[Math.floor(r() * pigs.length)];
    const spread = (k) => Math.round((r() + r() - 1) * k);
    const tc = aimed ? pig.c : clamp(pig.c + spread(2.2), 0, this.cols - 1);
    const tr = aimed ? pig.r : clamp(pig.r + spread(1.6), 0, this.rows - 1);
    const lob = bird === 'matilda' || (bird !== 'chuck' && bird !== 'blues' && r() < 0.45);
    const exact = { c: pig.c, r: pig.r };
    const ctx = newCtx();
    const hits = [];
    if (bird === 'eagle') {
      for (let c = 0; c < this.cols; c++) for (let row = 0; row < this.rows; row++) this.hurt(f, c, row, 1e4, 'terence', ctx);
      hits.push({ c: this.cols >> 1, r: 0, ground: true });
    } else if (bird === 'chuck') {
      // 黄鸟：半空加速，沿一整排冲过去，撞碎一块接着冲，撞不动就停
      const at = aimed ? exact : this.scanRow(f, tr, this.cols - 1);
      let power = 170 * mult;
      let c = at.c;
      for (let n = 0; c < this.cols && n < 4 && power > 12; c++) {
        const e = f.grid[c][at.r];
        if (!e) continue;
        n++;
        this.hurt(f, c, at.r, power, 'chuck', ctx);
        if (e.hp > 0) break;
        power *= 0.65;
      }
      hits.push(at, { c: Math.min(c, this.cols - 1), r: at.r });
    } else if (bird === 'blues') {
      // 蓝鸟：半空一分为三，上中下三行各撞一下（克冰）
      for (const dr of [-1, 0, 1]) {
        const at = aimed && dr === 0 ? exact : this.scanRow(f, clamp(tr + dr, 0, this.rows - 1), tc);
        hits.push(at);
        this.splash(f, at, HIT.blues, 'blues', mult, ctx);
      }
    } else {
      const at = aimed ? exact : lob ? this.topAt(f, tc) : this.scanRow(f, tr, tc);
      hits.push(at);
      this.splash(f, at, HIT[bird], bird, mult, ctx);
    }
    this.settle(f, ctx);
    this.dealt += ctx.dealt;
    fx.push({ type: 'birdLaunch', sid: p.sid, team: p.team, foe, bird, hits, aimed, lob, snap: this.snap(foe), st: foe });
    this.credit(p, bird, ctx, fx);
  }

  credit(p, bird, ctx, fx) {
    const n = ctx.pigs.length;
    p.k += n;
    p.dmg += Math.round(ctx.dealt / 4);
    this.pts[p.team] += n * PTS.pig + ctx.blocks * PTS.block + Math.round(ctx.dealt / 10) * 10;
    if (bird === 'eagle') return;
    const bn = birdName(bird);
    if (n >= 3) fx.push({ type: 'announce', text: L('三连！', 'Triple pop!'), sub: L(`${p.name} 的${bn}一下打爆 ${n} 只猪`, `${p.name}'s ${bn} popped ${n} pigs at once`), cls: p.team, ms: 1400 });
    else if (ctx.pigs.includes('k')) fx.push({ type: 'note', text: L(`👑 猪王倒了！{0} 的${bn}掀翻了猪王`, `👑 King Pig down! {0}'s ${bn} toppled the King`), sids: [p.sid], cls: 'big' });
    else if (n === 2) fx.push({ type: 'note', text: L(`🐷🐷 {0} 的${bn}一下打爆两只猪`, `🐷🐷 {0}'s ${bn} popped two pigs`), sids: [p.sid] });
    else if (n === 1) fx.push({ type: 'note', text: L(`🐷 {0} 的${bn}打爆了一只猪`, `🐷 {0}'s ${bn} popped a pig`), sids: [p.sid] });
  }

  /** 打歪了：飞出画面 / 弹回自家 / 睡着了 / 被风吹走。 */
  whiff(p, how, fx) {
    p.aim = p.draw = false;
    let snap = null;
    const hits = [];
    if (how === 'back') {
      // 弹回来，砸在自家正面最上面那块
      const f = this.fort[p.team];
      const at = this.topAt(f, 0);
      const ctx = newCtx();
      this.hurt(f, at.c, at.r, 30, 'red', ctx);
      this.settle(f, ctx);
      p.d += ctx.pigs.length;
      hits.push(at);
      snap = this.snap(p.team);
    }
    fx.push({ type: 'birdLaunch', sid: p.sid, team: p.team, foe: OTHER[p.team], bird: 'red', miss: how, hits, snap, st: p.team });
    if (how !== 'dud' && ++this.miss[p.team] === 3) {
      fx.push({ type: 'birdLaugh', team: OTHER[p.team] });
      fx.push({ type: 'announce', text: L('猪猪在嘲笑你', 'The pigs are laughing'), sub: L(`${TEAM_NAME[p.team]} 连着打歪 3 次`, `${TEAM_NAME[p.team]} missed 3 in a row`), cls: 'bad', ms: 1300 });
    }
  }

  /** 🧱 改代码：给自家堡加固。攒够一块才动手，忙的一边攒得慢。 */
  fortify(p, r, fx) {
    const f = this.fort[p.team];
    f.credit = Math.min(2, f.credit + 0.9 * this.balanceMult(p.team) * this.sizeMult());
    let first = null;
    for (let i = 0; i < 2 && f.credit >= 1; i++) {
      f.credit -= 1;
      const what = this.fortifyOnce(f, r);
      first ||= what;
    }
    fx.push({ type: 'birdBuild', sid: p.sid, team: p.team, kind: first ? first.kind : 'wait', c: first?.c, r: first?.r, snap: first ? this.snap(p.team) : null });
  }

  fortifyOnce(f, r) {
    const h = f.grid.map((_, c) => this.height(f, c));
    const stable = (c) => h[c] < this.rows && [c - 1, c + 1].every((n) => n < 0 || n >= this.cols || h[c] + 1 - h[n] <= 2);
    const pigs = this.pigsOf(f);
    const put = (c, kind) => {
      f.grid[c][h[c]] = this.ent(f, r() < 0.3 ? 'S' : r() < 0.7 ? 'W' : 'I');
      return { kind, c, r: h[c] };
    };
    // 给露天的猪盖屋顶 / 给猪戴头盔 / 修最破的那块 / 往最矮的一列加一块
    const roof = () => {
      const pg = pigs.find((q) => q.r === h[q.c] - 1 && stable(q.c));
      return pg ? put(pg.c, 'roof') : null;
    };
    const helmet = () => {
      const pg = pigs.find((q) => q.e.t !== 'k' && q.e.helm < 30);
      if (pg) pg.e.helm = 60;
      return pg ? { kind: 'helmet', c: pg.c, r: pg.r } : null;
    };
    const repair = () => {
      let best = null;
      f.grid.forEach((col, c) => col.forEach((e, row) => {
        if (e && !isPig(e.t) && e.hp < e.max * 0.75 && (!best || e.hp / e.max < best.e.hp / best.e.max)) best = { e, c, r: row };
      }));
      if (best) best.e.hp = Math.min(best.e.max, best.e.hp + best.e.max * 0.5);
      return best ? { kind: 'repair', c: best.c, r: best.r } : null;
    };
    const wall = () => {
      let best = -1;
      for (let c = 0; c < this.cols; c++) if (stable(c) && (best < 0 || h[c] < h[best])) best = c;
      return best >= 0 ? put(best, 'block') : null;
    };
    for (const fn of r() < 0.5 ? [roof, helmet, repair, wall] : [helmet, roof, repair, wall]) {
      const x = fn();
      if (x) return x;
    }
    return null;
  }

  /** ✋ 你打断了它：自家最高的那座塔朝正面倒下去，掉出堡外的直接没了。 */
  pushOver(p, fx) {
    const f = this.fort[p.team];
    const ctx = newCtx();
    let best = 0;
    for (let c = 1; c < this.cols; c++) if (this.height(f, c) > this.height(f, best)) best = c;
    const col = f.grid[best];
    const h = this.height(f, best);
    for (let row = 1; row < h; row++) {
      const e = col[row];
      col[row] = null;
      const tc = best - row;
      const th = tc >= 0 ? this.height(f, tc) : this.rows;
      if (th >= this.rows) {
        if (isPig(e.t)) ctx.pigs.push(e.t); // 掉出堡外，直接没了
        else ctx.blocks++;
        continue;
      }
      f.grid[tc][th] = e;
      const d = clamp(row - th, 1, 4);
      this.damage(e, MAT[e.t].fall * 2 * d, ctx);
      if (th > 0) this.crush(f.grid[tc][th - 1], MAT[e.t].w, d, ctx);
    }
    this.settle(f, ctx);
    p.d += ctx.pigs.length;
    fx.push({ type: 'birdTopple', sid: p.sid, team: p.team, c: best, snap: this.snap(p.team) });
    fx.push({ type: 'note', text: L('✋ 你打断了 {0}，它把自己的塔推倒了', '✋ You interrupted {0} — it knocked over its own tower'), sids: [p.sid], cls: 'big' });
  }

  // ---------------------------------------------------------------- 它在等你：猪在笑

  onWait(p, fx) {
    if (this.phase !== 'live') return;
    fx.push({ type: 'birdLaugh', team: OTHER[p.team] });
    fx.push({ type: 'announce', text: L('猪猪在嘲笑你', 'The pigs are laughing'), sub: L(`${p.name} 在等你回复`, `${p.name} is waiting for you`), cls: 'bad', ms: 1400 });
  }

  onAnswer(p, wait, fx) {
    if (this.phase !== 'live') return;
    p.aim = p.draw = true;
    fx.push({ type: 'birdAim', sid: p.sid, team: p.team, locked: true });
    fx.push({ type: 'birdDraw', sid: p.sid, team: p.team });
  }

  /** 等太久：TNT 在自家堡里爆了，炸在一只猪旁边。 */
  onWaitTimeout(p, fx) {
    if (this.phase !== 'live') return;
    const r = rng(hash(`${p.sid}:tnt:${this.now}`));
    const f = this.fort[p.team];
    const pigs = this.pigsOf(f);
    const at = pigs.length ? pigs[Math.floor(r() * pigs.length)] : this.topAt(f, this.cols >> 1);
    const ctx = newCtx();
    this.splash(f, at, HIT.tnt, 'tnt', 1, ctx);
    this.settle(f, ctx);
    p.d += ctx.pigs.length;
    fx.push({ type: 'birdTnt', sid: p.sid, team: p.team, c: at.c, r: at.r, snap: this.snap(p.team) });
  }

  // ---------------------------------------------------------------- 回合

  timers() {
    return [this.roundStart + this.roundLen];
  }

  onTick(fx) {
    if (this.now - this.roundStart < this.roundLen) return;
    const w = this.dealt > 0 ? this.leader() : null;
    if (w) this.endRound(w, 'time', fx, L('时间到 · 剩下的猪更多', 'Time up · more pigs standing'));
    else this.roundStart = this.now;
  }

  leader() {
    const a = this.pigs('claude').length;
    const b = this.pigs('codex').length;
    if (a !== b) return a > b ? 'claude' : 'codex';
    const hp = (f) => f.grid.reduce((s, col) => s + col.reduce((t, e) => t + (e ? e.hp + e.helm : 0), 0), 0);
    const x = hp(this.fort.claude);
    const y = hp(this.fort.codex);
    return Math.abs(x - y) > 1 ? (x > y ? 'claude' : 'codex') : null;
  }

  check(fx) {
    const a = this.pigs('claude').length;
    const b = this.pigs('codex').length;
    if (a && b) return;
    const winner = a ? 'claude' : b ? 'codex' : null;
    if (!winner) return this.endRound(null, 'draw', fx, L('两边的猪同归于尽', 'Both forts wiped out'));
    // 星星：看赢家自己的猪和堡还剩多少（原版看剩几只鸟）
    const f = this.fort[winner];
    const k = (0.5 * Math.max(a, b)) / f.pigs0 + 0.5 * Math.min(1, this.blocksOf(f) / f.blocks0);
    const stars = k >= 0.85 ? 3 : k >= 0.55 ? 2 : 1;
    const s = '⭐'.repeat(stars);
    fx.push({ type: 'birdClear', winner, stars });
    fx.push({ type: 'announce', text: L('关卡完成！', 'Level cleared!'), sub: `${s}${'☆'.repeat(3 - stars)}  ${TEAM_NAME[winner]} · ${fmt(this.pts[winner])}`, cls: winner, ms: 1700 });
    if (stars === 3) fx.push({ type: 'announce', text: '⭐⭐⭐', sub: L(`${TEAM_NAME[winner]} 三星通关`, `${TEAM_NAME[winner]}: three-star clear`), cls: 'gold', ms: 1300 });
    this.endRound(winner, this.lastBird === 'eagle' ? 'eagle' : 'clear', fx, L(`关卡完成 ${s}`, `Level cleared ${s}`));
  }
}

// ================================================================ 画面

const { w: W, h: H } = WORLD;
const TAU = Math.PI * 2;
const GROUND = 800;
const FRONT = { claude: 505, codex: 1095 }; // 堡垒正面那条边
const SLING = { claude: 655, codex: 945 }; // 弹弓
const DIR = { claude: 1, codex: -1 }; // 朝对面飞的方向
const MAT_COL = { W: ['#c98b47', '#8f5d28', '#e8b673'], I: ['rgba(188,232,250,0.82)', '#78bfdc', '#f4fdff'], S: ['#9ea2a8', '#6c7076', '#c6c9cd'] };
const BIRD_COL = { red: '#d9262e', chuck: '#f7d22d', bomb: '#2b2b30', blues: '#5aaaea', terence: '#9c1c22', matilda: '#f6f3ec' };
const BIRD_R = { red: 12, chuck: 13, bomb: 14, blues: 8, terence: 21, matilda: 14 };
const QUEUE = ['chuck', 'red', 'blues']; // 弹弓后面排队的鸟，纯装饰
const cellSize = (R) => (R.cols > 5 ? 50 : 62);
const pouchRest = (team) => [SLING[team], GROUND - 108];
const akey = (team, id) => `${team}${id}`;
const toShown = (snap) => ({ seq: snap.seq, round: snap.round, ents: new Map(snap.ents.map((e) => [e.id, e])) });
const newSling = () => ({ pull: 0, snapT: 9, tension: 0, reload: 0, next: 'red' });

function cellXY(R, team, c, r) {
  const s = cellSize(R);
  return [team === 'claude' ? FRONT.claude - (c + 1) * s : FRONT.codex + c * s, GROUND - (r + 1) * s];
}
function cellMid(R, team, c, r) {
  const s = cellSize(R);
  const [x, y] = cellXY(R, team, c, r);
  return [x + s / 2, y + s / 2];
}
function fortMid(R, team) {
  const w = R.cols * cellSize(R);
  return team === 'claude' ? FRONT.claude - w / 2 : FRONT.codex + w / 2;
}

// 画图小工具：一行一个形状
function dot(g, x, y, r, col) {
  if (col) g.fillStyle = col;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}
function oval(g, x, y, rx, ry, rot, col) {
  if (col) g.fillStyle = col;
  g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill();
}
function poly(g, pts, col, stroke) {
  g.fillStyle = col;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath(); g.fill();
  if (stroke) g.stroke();
}
function segs(g, list, col, w) {
  g.strokeStyle = col; g.lineWidth = w;
  g.beginPath();
  for (const [x1, y1, ...rest] of list) {
    g.moveTo(x1, y1);
    for (let i = 0; i < rest.length; i += 2) g.lineTo(rest[i], rest[i + 1]);
  }
  g.stroke();
}

let backdrop = null;
function drawBackdrop() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = rng(31);
  const sky = g.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#5fbdf0'); sky.addColorStop(0.55, '#a9def5'); sky.addColorStop(1, '#eaf8e2');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, GROUND);
  // 远处两层圆滚滚的山丘
  for (const [base, amp, col, k, ph] of [[610, 70, '#b7e0a4', 0.0042, 1.3], [700, 52, '#8fcc70', 0.0071, 4.1]]) {
    const pts = [[0, GROUND]];
    for (let x = 0; x <= W; x += 16) pts.push([x, base - Math.sin(x * k + ph) * amp - Math.sin(x * k * 2.7 + ph) * amp * 0.35]);
    poly(g, [...pts, [W, GROUND]], col);
  }
  // 远处的小树
  for (let i = 0; i < 24; i++) {
    const [x, y, s] = [r() * W, 715 + r() * 60, 10 + r() * 14];
    g.fillStyle = '#6a4a2a';
    g.fillRect(x - 2, y, 4, s);
    dot(g, x, y - s * 0.2, s * 0.8, r() < 0.5 ? '#5aa83a' : '#6cbb45');
  }
  // 泥土 + 草皮
  g.fillStyle = '#7d5130';
  g.fillRect(0, GROUND, W, H - GROUND);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(60,35,15,0.35)' : 'rgba(170,120,70,0.3)';
    g.fillRect(r() * W, GROUND + 24 + r() * (H - GROUND - 24), 2 + r() * 5, 2 + r() * 4);
  }
  g.fillStyle = '#5fb43a'; g.fillRect(0, GROUND, W, 20);
  g.fillStyle = '#80d150'; g.fillRect(0, GROUND, W, 6);
  for (let x = 0; x < W; x += 9) poly(g, [[x, GROUND + 19], [x + 4, GROUND + 25 + r() * 7], [x + 8, GROUND + 19]], '#4e9a2e');
  // 弹弓脚下的小石头
  for (const x of Object.values(SLING)) {
    oval(g, x, GROUND + 2, 34, 12, 0, '#8b8f94');
    oval(g, x - 8, GROUND - 3, 16, 4, 0, 'rgba(255,255,255,0.25)');
  }
  return c;
}

export class View {
  constructor(app) {
    this.app = app;
    backdrop ||= drawBackdrop();
    this.fx = new Particles();
    this.clouds = Array.from({ length: 7 }, (_, i) => ({ x: i * 250 + rand(0, 120), y: rand(40, 250), s: rand(0.7, 1.3), v: rand(6, 14) }));
    this.busy = false;
    this.reset();
  }

  reset(R) {
    this.fx.clear();
    Object.assign(this, { flights: [], debris: [], feathers: [], puffs: [], spent: [], aims: [], stars: null, pendingLevel: null });
    this.anim = new Map(); // 正在掉落 / 晃动的格子
    this.trails = { claude: [], codex: [] };
    this.sling = { claude: newSling(), codex: newSling() };
    this.tags = { claude: null, codex: null };
    this.laugh = { claude: 0, codex: 0 };
    // shown：画面上现在的样子；latest：规则层最新的样子。鸟落地时才把 shown 换成新的
    this.shown = {};
    this.latest = {};
    if (R?.fort) for (const team of TEAMS) {
      this.latest[team] = { seq: R.snapSeq, round: R.round, ents: entsOf(R.fort[team].grid) };
      this.shown[team] = toShown(this.latest[team]);
    }
  }

  setLatest(team, snap) {
    if (snap && (!this.latest[team] || snap.seq > this.latest[team].seq)) this.latest[team] = snap;
  }

  /** 新关卡还没落下来之前，只放上一关的画面。 */
  canApply(snap) {
    return !this.pendingLevel || snap.round < this.pendingLevel.round;
  }

  /** 把一张新的格子表换上去：对比前后，碎掉的放碎片 / 猪爆成绿烟，挪了位置的从原处掉下来。 */
  applySnap(R, team, snap, by) {
    if (!this.canApply(snap)) return;
    let old = this.shown[team];
    if (old && (snap.seq <= old.seq || snap.round < old.round)) return;
    if (old && snap.round > old.round) old = null;
    const next = toShown(snap);
    const s = cellSize(R);
    if (old) for (const [id, e] of old.ents) {
      const n = next.ents.get(id);
      const [x, y] = cellXY(R, team, e.c, e.r);
      const k = akey(team, id);
      const a = this.anim.get(k) || { ox: 0, oy: 0, vy: 0, rot: 0, wob: 0 };
      if (!n) this.breakFx(e, x, y, s, by);
      else if (n.c !== e.c || n.r !== e.r) {
        const [nx, ny] = cellXY(R, team, n.c, n.r);
        this.anim.set(k, { ox: a.ox + x - nx, oy: a.oy + y - ny, vy: 0, rot: n.c !== e.c ? rand(-0.8, 0.8) : 0, wob: 0 });
      } else if (n.hp < e.hp - 0.5 || n.helm < e.helm - 0.5) this.anim.set(k, { ...a, wob: 0.35 });
    }
    // 新出现的：加固的块从头顶掉下来；新关卡整座堡从天而降，下面的先落地
    for (const [id, n] of next.ents) {
      if (!old?.ents.has(id)) this.anim.set(akey(team, id), { ox: 0, oy: old ? -150 : -(320 + n.r * 45 + rand(0, 40)), vy: 0, rot: 0, wob: 0 });
    }
    this.shown[team] = next;
  }

  apply(list, R, busy) {
    const { fx, app } = this;
    this.busy = busy;
    for (const f of list) {
      switch (f.type) {
        case 'act': {
          const p = R.players.get(f.sid);
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (p && text && !(busy && f.ev.k === 'read')) this.tags[p.team] = { sid: f.sid, text, ok: f.ev.ok !== false, life: 1.8 };
          break;
        }
        case 'birdLaunch': this.setLatest(f.st, f.snap); this.launch(R, f, busy); break;
        case 'birdAim': {
          // 原版的白点瞄准线 + 准星，落在对面随便一只猪身上
          const foe = OTHER[f.team];
          const pigs = [...(this.shown[foe]?.ents.values() || [])].filter((e) => isPig(e.t));
          if (busy || !pigs.length) break;
          const e = pigs[Math.floor(Math.random() * pigs.length)];
          const [x, y] = cellMid(R, foe, e.c, e.r);
          this.aims = this.aims.filter((a) => a.team !== f.team).concat({ team: f.team, x, y, life: f.locked ? 1.6 : 1, locked: !!f.locked });
          if (f.locked) fx.text(x, y - 34, L('🎯 锁定', '🎯 Locked on'), '#ffd23f', 15, 1.3);
          break;
        }
        case 'birdDraw': this.sling[f.team].tension = 1.1; break;
        case 'birdSwap': // 弹弓上的红鸟换成炸弹鸟
          this.sling[f.team].next = 'bomb';
          if (!busy) fx.text(SLING[f.team], GROUND - 150, L('换鸟！', 'Bird swap!'), '#fff', 15, 1.2);
          break;
        case 'birdBuild': {
          this.setLatest(f.team, f.snap);
          if (busy) break;
          const text = { roof: L('🔨 加盖屋顶', '🔨 Roof up'), block: L('🧱 加一块', '🧱 Extra block'), helmet: L('⛑️ 猪戴上头盔', '⛑️ Helmet on'), repair: L('🔧 修好了', '🔧 Patched up'), fail: L('盖歪了…', 'Oops, it fell off…'), wait: L('🔨 叮叮当当', '🔨 Hammering…') }[f.kind];
          const [x, y] = f.c != null ? cellMid(R, f.team, f.c, f.r) : [fortMid(R, f.team), GROUND - 200];
          fx.text(x, y - 34, text, f.kind === 'fail' ? '#ffb0a0' : '#ffe9a8', 14, 1.2);
          break;
        }
        case 'birdTopple':
          this.setLatest(f.team, f.snap);
          fx.text(fortMid(R, f.team), GROUND - 380, L('✋ 塔倒了！', '✋ Timber!'), '#ff9a8a', 22, 1.8);
          app.shake(0.4, 8);
          this.sound('thud', true);
          break;
        case 'birdTnt': {
          // TNT 先在猪旁边闪一会儿，再炸（炸完才换上新样子）
          const [x, y] = cellMid(R, f.team, f.c, f.r);
          this.flights.push({ team: f.team, kind: 'tnt', t: 0, released: true, legs: [{ x0: x, y0: y, x1: x, y1: y, apex: 0, dur: busy ? 0.05 : 0.8 }], snap: f.snap, st: f.team, by: null, busy });
          break;
        }
        case 'birdLaugh': this.laugh[f.team] = 3.5; this.sound('oink'); break;
        case 'birdLevel':
          this.pendingLevel = { at: app.rt() + (busy ? 0.25 : 1.8), round: f.snaps.claude.round };
          for (const team of TEAMS) this.setLatest(team, f.snaps[team]);
          break;
        case 'birdClear':
          this.stars = { team: f.winner, n: f.stars, t: 0 };
          if (app.sfx.ok(2)) [523, 659, 784].forEach((hz, i) => app.sfx.tone(hz, 0.16, 0.1, 'triangle', null, i * 0.3));
          break;
      }
    }
  }

  /** 一只（或三只）鸟出手：先拉弓，再沿抛物线飞过去。 */
  launch(R, f, busy) {
    const dir = DIR[f.team];
    const [px, py] = pouchRest(f.team);
    const pull = busy ? 0 : 0.22;
    const speed = busy ? 0.6 : 1;
    const at = (cell) => cellMid(R, f.st, cell.c, cell.r);
    const arc = (x1, y1, k = 1, dur = null) => ({ x0: px, y0: py, x1, y1, apex: (130 + Math.abs(x1 - px) * 0.25) * k, dur: (dur ?? clamp(0.45 + Math.abs(x1 - px) / 1500, 0.5, 1)) * speed });
    const base = { team: f.team, kind: f.bird, t: -pull, pull, snap: f.snap, st: f.st, by: f.miss ? null : f.team, miss: f.miss, busy, aimed: f.aimed };
    const out = [];
    if (f.miss === 'off') out.push({ ...base, legs: [arc(px + dir * 1250, 160, 1.5, 1.1)] });
    else if (f.miss === 'wind') out.push({ ...base, legs: [arc(px - dir * 260, -140, 0.6, 1)] });
    else if (f.miss === 'dud') out.push({ ...base, legs: [arc(px + dir * 36, GROUND - 10, 0.12, 0.45)] });
    else if (f.miss === 'back') out.push({ ...base, legs: [arc(...at(f.hits[0]), 3.2, 1.2)] });
    else if (f.bird === 'eagle') out.push({ ...base, kind: 'can', legs: [arc(fortMid(R, f.foe), GROUND - 14)] });
    else if (f.bird === 'chuck') {
      // 黄鸟：飞到跟前突然加速，一路冲到底
      const [x1, y1] = at(f.hits[0]);
      const [x2, y2] = at(f.hits[1]);
      const x0 = x1 - dir * 60;
      out.push({ ...base, legs: [arc(x0, y1, f.lob ? 1.4 : 0.8), { x0, y0: y1, x1: x2, y1: y2, apex: 0, dur: 0.16 * speed }] });
    } else if (f.bird === 'blues') f.hits.forEach((h, i) => out.push({ ...base, snap: i === 1 ? f.snap : null, split: i !== 1, legs: [arc(...at(h), 0.85 + i * 0.12)] }));
    else out.push({ ...base, legs: [arc(...at(f.hits[0]), f.lob ? 1.7 : 0.85)] });
    this.flights.push(...out);
  }

  flightPos(fl) {
    let t = fl.t;
    for (const leg of fl.legs) {
      if (t <= leg.dur) {
        const q = t / leg.dur;
        const vx = leg.x1 - leg.x0;
        const vy = leg.y1 - leg.y0 - leg.apex * 4 * (1 - 2 * q);
        return [leg.x0 + vx * q, leg.y0 + (leg.y1 - leg.y0) * q - leg.apex * 4 * q * (1 - q), Math.atan2(vy, Math.abs(vx) + 1)];
      }
      t -= leg.dur;
    }
    return null;
  }

  stepFlights(dt, R) {
    for (const fl of this.flights) {
      fl.t += dt;
      if (fl.t < 0) {
        if (!fl.split) this.sling[fl.team].pull = Math.max(this.sling[fl.team].pull, 1 + fl.t / fl.pull);
        continue;
      }
      if (!fl.released) {
        fl.released = true;
        if (!fl.split) this.release(fl); // 松手，皮筋弹回去
      }
      const pos = this.flightPos(fl);
      if (!pos) {
        fl.done = true;
        this.land(R, fl);
        continue;
      }
      [fl.x, fl.y, fl.ang] = pos;
      fl.spin = (fl.spin || 0) + dt * 8;
      if (fl.kind === 'swoop' && !fl.hit && fl.t >= fl.legs[0].dur * 0.5) {
        fl.hit = true; // 神鹰飞到正中间：整座堡没了
        this.eagleHit(R, fl);
      }
      if (!fl.busy && !fl.split && fl.kind !== 'tnt' && fl.kind !== 'swoop' && (fl.dot = (fl.dot || 0) - dt) <= 0) {
        fl.dot = 0.032;
        const tr = this.trails[fl.team];
        if (tr.length < 120) tr.push([fl.x, fl.y, tr.length % 3 === 0 ? 3.4 : 2]);
      }
    }
    this.flights = this.flights.filter((fl) => !fl.done);
  }

  release(fl) {
    Object.assign(this.sling[fl.team], { snapT: 0, reload: 0.5, next: 'red' });
    if (!fl.busy) this.trails[fl.team] = [];
    this.sound('twang');
  }

  land(R, fl) {
    const { fx, app } = this;
    const x = fl.x ?? fl.legs.at(-1).x1;
    const y = fl.y ?? fl.legs.at(-1).y1;
    if (fl.kind === 'can') {
      // 沙丁鱼罐头落地，神鹰从天边俯冲下来
      fx.text(x, y - 30, L('🥫 沙丁鱼罐头', '🥫 Sardine can'), '#fff', 15, 1.2);
      const d = DIR[fl.team];
      this.flights.push({ ...fl, kind: 'swoop', t: 0, done: false, x: undefined, legs: [{ x0: x - d * 900, y0: 30, x1: x + d * 900, y1: 30, apex: -650, dur: fl.busy ? 0.5 : 1.6 }] });
      return;
    }
    if (fl.kind === 'swoop') return;
    if (fl.snap) this.applySnap(R, fl.st, fl.snap, fl.by);
    if (fl.kind === 'tnt') {
      fx.explosion(x, y, true);
      fx.text(x, y - 50, L('TNT 在自家炸了！', 'TNT went off at home!'), '#ff8a6a', 18, 1.6);
      app.shake(0.45, 9);
      return app.sfx.boom(true);
    }
    const sx = clamp(x, 120, W - 120);
    if (fl.miss === 'off') {
      this.laugh[OTHER[fl.team]] = Math.max(this.laugh[OTHER[fl.team]], 1.5); // 对面的猪笑了
      return fx.text(sx, 140, L('打歪了！', 'Missed!'), '#fff', 18);
    }
    if (fl.miss === 'wind') return fx.text(sx, 80, L('被风吹跑了', 'Gone with the wind'), '#dfe8ff', 16);
    if (fl.miss === 'dud') {
      fx.text(x, y - 34, 'Zzz…', '#dfe8ff', 18, 1.6);
      this.featherPuff(x, y, 'red', 3);
      this.spent.push({ kind: 'red', x, y, vx: 0, vy: 0, rot: 1.4, vr: 0, life: 1.4, dir: DIR[fl.team] });
      return;
    }
    if (fl.miss === 'back') fx.text(x, y - 46, L('弹回来了！', 'It bounced back!'), '#ffb0a0', 17, 1.4);
    this.puff(x, y, fl.kind === 'terence' ? 9 : 4, 'rgba(255,255,255,0.9)');
    if (fl.kind === 'bomb') {
      fx.explosion(x, y, true);
      app.shake(0.35, 8);
      app.sfx.boom(true);
    } else if (fl.kind === 'terence') {
      fx.ring(x, y, 10, 120, 'rgba(255,255,255,0.9)', 0.45, 8);
      app.shake(0.3, 7);
    }
    this.sound('thud', fl.kind === 'terence');
    if (fl.aimed && !fl.busy && !fl.split) fx.text(x, y - 40, L('正中！', 'Bullseye!'), '#ffe27a', 15, 1);
    this.featherPuff(x, y, fl.kind, fl.busy ? 3 : 8);
    // 撞完的鸟弹回来，在地上滚两下，「噗」地散成羽毛
    if (!fl.busy && fl.kind !== 'bomb') this.spent.push({ kind: fl.kind, x, y, vx: -DIR[fl.team] * rand(40, 150), vy: rand(-300, -140), rot: 0, vr: rand(-9, 9), life: 1.4, dir: DIR[fl.team] });
  }

  eagleHit(R, fl) {
    if (fl.snap) this.applySnap(R, fl.st, fl.snap, fl.by);
    const x = fortMid(R, fl.st);
    this.fx.explosion(x, GROUND - 120, true);
    this.fx.text(x, GROUND - 340, L('全部摧毁！', 'TOTAL DESTRUCTION!'), '#ffe27a', 30, 2.2);
    this.app.shake(0.7, 12);
    this.app.sfx.boom(true);
  }

  breakFx(e, x, y, s, by) {
    const [cx, cy, busy] = [x + s / 2, y + s / 2, this.busy];
    if (isPig(e.t)) {
      // 猪「噗」地变成一团绿烟
      for (let i = 0; i < (busy ? 3 : 8); i++) this.puffs.push({ x: cx + rand(-s * 0.4, s * 0.4), y: cy + rand(-s * 0.4, s * 0.3), r: rand(6, 13), grow: rand(30, 60), life: rand(0.5, 0.9), max: 0.9, col: '#b5e88a' });
      this.fx.text(cx, cy - s * 0.7, '5000', by ? COLOR[by] : '#fff', 26, 1.4);
      if (!busy) this.fx.text(cx + rand(-16, 16), cy, L('哼！', 'Oink!'), '#e8ffd6', 13, 0.8);
      return this.sound('pop');
    }
    const wood = e.t === 'W';
    for (let i = 0; i < (busy ? 2 : 6); i++) {
      this.debris.push({
        x: cx + rand(-s / 3, s / 3), y: cy + rand(-s / 3, s / 3), vx: rand(-240, 240) + (by ? DIR[by] * 140 : 0), vy: rand(-480, -120),
        rot: rand(0, 6), vr: rand(-12, 12), w: wood ? rand(14, 26) : rand(7, 15), h: wood ? rand(4, 7) : rand(6, 12), col: MAT_COL[e.t][i % 2], tri: e.t === 'I', life: rand(1.1, 1.7),
      });
    }
    if (!busy) this.fx.text(cx, cy - 8, '500', '#fff', 14, 0.9);
    this.sound('crack', e.t);
  }

  featherPuff(x, y, kind, n) {
    const col = BIRD_COL[kind] || BIRD_COL.red;
    for (let i = 0; i < n; i++) this.feathers.push({ x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-90, 90), vy: rand(-150, -20), rot: rand(0, 6), vr: rand(-4, 4), col: i % 3 === 2 ? '#fff' : col, life: rand(1, 1.8), ph: rand(0, 6) });
  }

  puff(x, y, n, col) {
    for (let i = 0; i < n; i++) this.puffs.push({ x: x + rand(-14, 14), y: y + rand(-14, 14), r: rand(5, 11), grow: rand(25, 50), life: rand(0.35, 0.6), max: 0.6, col });
  }

  // 声音都是自己合成的，先问 ok() 免得太吵
  sound(kind, arg) {
    const { sfx } = this.app;
    if (!sfx.ok(kind === 'pop' ? 2 : 1)) return;
    if (kind === 'twang') {
      sfx.tone(220, 0.12, 0.12, 'triangle', 520);
      sfx.tone(950, 0.16, 0.05, 'square', 1500, 0.03); // 小鸟「呀——」
    } else if (kind === 'thud') sfx.burst(arg ? 0.3 : 0.12, arg ? 320 : 650, arg ? 0.55 : 0.3);
    else if (kind === 'pop') sfx.tone(640, 0.08, 0.11, 'square', 1300);
    else if (kind === 'crack') sfx.burst(0.08, arg === 'I' ? 3200 : arg === 'S' ? 700 : 1400, 0.2, arg === 'I' ? 'highpass' : 'lowpass');
    else if (kind === 'oink') [250, 235].forEach((hz, i) => sfx.tone(hz, 0.1, 0.09, 'sawtooth', hz - 60, i * 0.14));
  }

  // ---------------------------------------------------------------- 每帧

  update(dt, R) {
    this.fx.update(dt);
    if (this.pendingLevel && this.app.rt() >= this.pendingLevel.at) {
      Object.assign(this, { pendingLevel: null, shown: {}, trails: { claude: [], codex: [] } });
      this.anim.clear();
    }
    for (const team of TEAMS) {
      const st = this.sling[team];
      Object.assign(st, { snapT: st.snapT + dt, tension: Math.max(0, st.tension - dt), reload: Math.max(0, st.reload - dt), pull: st.tension > dt ? 0.35 : 0 });
      this.laugh[team] = Math.max(0, this.laugh[team] - dt);
      if (this.tags[team] && (this.tags[team].life -= dt) <= 0) this.tags[team] = null;
    }
    this.stepFlights(dt, R);
    // 没有鸟正往这边飞时，把最新的样子换上去（加固、推倒的塔、新关卡）
    for (const team of TEAMS) {
      const s = this.latest[team];
      if (!s || !this.canApply(s) || (this.shown[team] && s.seq <= this.shown[team].seq)) continue;
      if (!this.flights.some((fl) => fl.st === team && fl.snap && !fl.hit)) this.applySnap(R, team, s, null);
    }
    const damp = Math.pow(0.004, dt);
    for (const [k, a] of this.anim) {
      if (a.oy < 0) a.oy = Math.min(0, a.oy + (a.vy += 2200 * dt) * dt); // 往下掉：有重力
      else a.oy = a.oy < 0.5 ? 0 : a.oy * damp; // 倒向更高的一列时是往上挪的，慢慢归位
      a.ox = Math.abs(a.ox) < 0.5 ? 0 : a.ox * damp;
      a.rot = Math.abs(a.rot) < 0.01 ? 0 : a.rot * damp;
      a.wob = Math.max(0, a.wob - dt);
      if (!a.ox && !a.oy && !a.rot && !a.wob) this.anim.delete(k);
    }
    // 碎片、用完的鸟：有重力，落地弹一下；用完的鸟最后「噗」地散成一团羽毛
    for (const d of this.debris.concat(this.spent)) {
      d.vy += (d.kind ? 1100 : 1300) * dt;
      Object.assign(d, { x: d.x + d.vx * dt, y: d.y + d.vy * dt, rot: d.rot + d.vr * dt, life: d.life - dt });
      const floor = d.kind ? GROUND - 10 : GROUND + 6;
      if (d.y > floor && d.vy > 0) Object.assign(d, { y: floor, vy: d.vy * -0.35, vx: d.vx * 0.6, vr: d.vr * 0.5 });
      if (d.kind && d.life <= 0) this.featherPuff(d.x, d.y, d.kind, 4);
    }
    // 羽毛左右飘着慢慢落下
    for (const q of this.feathers) {
      q.ph += dt * 5;
      q.vy = Math.min(50, q.vy + 120 * dt);
      Object.assign(q, { vx: q.vx * 0.97, x: q.x + (q.vx + Math.sin(q.ph) * 30) * dt, y: q.y + q.vy * dt, rot: q.rot + q.vr * dt, life: q.life - dt });
    }
    for (const q of this.puffs) Object.assign(q, { r: q.r + q.grow * dt, life: q.life - dt });
    for (const a of this.aims) a.life -= dt;
    this.debris = this.debris.filter((d) => d.life > 0).slice(-260);
    this.spent = this.spent.filter((b) => b.life > 0);
    this.feathers = this.feathers.filter((q) => q.life > 0 && q.y < GROUND + 10).slice(-200);
    this.puffs = this.puffs.filter((q) => q.life > 0);
    this.aims = this.aims.filter((a) => a.life > 0);
    if (this.stars && (this.stars.t += dt) > 3.4) this.stars = null;
    for (const c of this.clouds) if ((c.x += c.v * dt) > W + 160) c.x = -220;
  }

  pouch(team) {
    const st = this.sling[team];
    const [rx, ry] = pouchRest(team);
    const osc = st.snapT < 1.2 ? Math.sin(st.snapT * 38) * Math.exp(-st.snapT * 7) * 18 : 0;
    return [rx - DIR[team] * (st.pull * 54 - osc), ry + st.pull * 16];
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    const s = cellSize(R);
    g.drawImage(backdrop, 0, 0, W, H);
    for (const c of this.clouds) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      for (const [dx, dy, r] of [[0, 0, 26], [30, -14, 32], [64, 0, 24], [32, 8, 26]]) g.arc(c.x + dx * c.s, c.y + dy * c.s, r * c.s, 0, TAU);
      g.fill();
    }
    // 上一发留下的白点弹道（原版就这样）
    for (const team of TEAMS) for (const [x, y, r] of this.trails[team]) dot(g, x, y, r, 'rgba(255,255,255,0.85)');
    for (const a of this.aims) this.drawAim(g, a);
    for (const team of TEAMS) this.drawSling(g, team, true);
    if (!this.pendingLevel && R.fort) for (const team of TEAMS) if (!this.shown[team]) this.applySnap(R, team, this.latest[team] || { seq: R.snapSeq, round: R.round, ents: entsOf(R.fort[team].grid) }, null);
    for (const team of TEAMS) {
      this.drawFort(g, R, team, s, rt);
      // 弹弓后面排队的鸟，时不时蹦一下
      QUEUE.forEach((k, i) => {
        const hop = Math.max(0, Math.sin(rt * 2.3 + i * 2.1 + (team === 'codex' ? 1 : 0))) ** 6 * 14;
        this.drawBird(g, k, SLING[team] - DIR[team] * (52 + i * 32), GROUND - BIRD_R[k] - hop, DIR[team]);
      });
    }
    // 碎片：木头是长条，冰是三角碴子，石头是小方块
    for (const d of this.debris) {
      g.globalAlpha = Math.min(1, d.life / 0.4);
      g.save();
      g.translate(d.x, d.y);
      g.rotate(d.rot);
      poly(g, d.tri ? [[-d.w / 2, d.h / 2], [d.w / 2, d.h / 2], [0, -d.h / 2]] : [[-d.w / 2, -d.h / 2], [d.w / 2, -d.h / 2], [d.w / 2, d.h / 2], [-d.w / 2, d.h / 2]], d.col);
      g.restore();
    }
    for (const b of this.spent) {
      g.globalAlpha = Math.min(1, b.life / 0.3);
      this.drawBird(g, b.kind, b.x, b.y, b.dir, b.rot);
    }
    g.globalAlpha = 1;
    // 弹弓上：正在拉的鸟，或者下一只装好的鸟
    for (const team of TEAMS) {
      const pulling = this.flights.find((fl) => fl.team === team && fl.t < 0 && !fl.split);
      const [px, py] = this.pouch(team);
      if (pulling) this.drawBody(g, pulling.kind, px, py - 4, DIR[team], 0, 0, rt);
      else if (this.sling[team].reload <= 0) this.drawBird(g, this.sling[team].next, px, py - 4, DIR[team]);
    }
    for (const fl of this.flights) {
      if (fl.t < 0 || fl.x == null || (fl.split && fl.t < fl.legs[0].dur * 0.35)) continue; // 蓝鸟飞到一半才分成三只
      const dir = DIR[fl.team];
      if (fl.kind === 'chuck' && fl.t > fl.legs[0].dur) segs(g, [-7, 0, 7].map((k) => [fl.x - dir * 18, fl.y + k, fl.x - dir * 52, fl.y + k]), 'rgba(255,255,255,0.85)', 2);
      this.drawBody(g, fl.kind, fl.x, fl.y, dir, fl.kind === 'chuck' ? fl.ang : fl.ang * 0.5, fl.spin, rt);
    }
    for (const team of TEAMS) this.drawSling(g, team, false);
    for (const q of this.puffs) {
      g.globalAlpha = (q.life / q.max) * 0.85;
      dot(g, q.x, q.y, q.r, q.col);
    }
    for (const q of this.feathers) {
      g.globalAlpha = Math.min(1, q.life / 0.5);
      oval(g, q.x, q.y, 6, 2.4, q.rot, q.col);
    }
    g.globalAlpha = 1;
    this.fx.renderOver(g, scale);
    this.drawLabels(g, R, s, scale);
    if (this.stars) {
      // 过关的三颗星，一颗一颗蹦出来
      const { team, n, t } = this.stars;
      const cx = fortMid(R, team);
      for (let i = 0; i < 3; i++) {
        const k = clamp((t - 0.3 * i) / 0.25, 0, 1);
        if (k > 0) this.drawStar(g, cx + (i - 1) * 74, GROUND - R.rows * s - 110 - (i === 1 ? 18 : 0), 30 * (k < 1 ? k * 1.25 : 1) * (i === 1 ? 1.25 : 1), i < n);
      }
    }
  }

  drawLabels(g, R, s, scale) {
    const fs = fontFor(scale);
    const big = fontFor(scale, 15);
    for (const team of TEAMS) {
      const cx = fortMid(R, team);
      const left = [...(this.shown[team]?.ents.values() || [])].filter((e) => isPig(e.t)).length;
      const top = GROUND - R.rows * s - 34;
      pill(g, cx, top, `${TEAM_NAME[team]} · 🐷 ${left}/${R.fort[team].pigs0}`, { color: COLOR[team], size: big, max: 300 });
      pill(g, cx, top + big + 10, L(`得分 ${fmt(R.pts[team])}`, `Score ${fmt(R.pts[team])}`), { size: fs, max: 200, bg: 'rgba(10,12,16,0.45)' });
      // 刚出手的人：名字 + 在干什么
      const tg = this.tags[team];
      if (tg) {
        const p = R.players.get(tg.sid);
        g.globalAlpha = Math.min(1, tg.life / 0.4);
        pill(g, SLING[team], GROUND - 172, p ? p.name : tg.sid.slice(0, 8), { color: COLOR[team], size: fs, max: 150 });
        pill(g, SLING[team], GROUND - 181 - fs, tg.text, { size: fs - 1, max: 210, weight: 500, bg: tg.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)' });
        g.globalAlpha = 1;
      }
      // 地底下的名单：谁在这一边，打爆了几只猪
      const ps = R.field(team);
      const step = Math.min(fs + 9, (H - GROUND - 46) / Math.max(1, ps.length));
      ps.forEach((p, i) => pill(g, cx, GROUND + 42 + i * step, `${p.name}  🐷×${p.k}`, { color: COLOR[team], size: fs - 1, max: 280, bg: 'rgba(30,18,8,0.6)' }));
    }
  }

  drawFort(g, R, team, s, rt) {
    const sh = this.shown[team];
    if (!sh) return;
    for (const pass of [false, true]) for (const e of sh.ents.values()) {
      if (isPig(e.t) !== pass) continue; // 先画方块，再画猪
      const [x, y] = cellXY(R, team, e.c, e.r);
      const a = this.anim.get(akey(team, e.id));
      g.save();
      g.translate(x + s / 2 + (a ? a.ox + (a.wob > 0 ? Math.sin(a.wob * 70) * 10 * a.wob : 0) : 0), y + s / 2 + (a ? a.oy : 0));
      if (a?.rot) g.rotate(a.rot);
      if (pass) this.drawPig(g, s, e, rt, this.laugh[team] > 0);
      else this.drawBlock(g, s, e);
      g.restore();
    }
  }

  drawBlock(g, s, e) {
    const [m, h] = [MAT_COL[e.t], s / 2];
    g.fillStyle = m[0];
    g.fillRect(-h, -h, s, s);
    if (e.t === 'W') {
      // 三块木板 + 木纹 + 四颗钉子
      segs(g, [[-h, -h / 3, h, -h / 3], [-h, h / 3, h, h / 3]], m[1], 2);
      segs(g, [-h * 0.66, 0, h * 0.66].map((k) => [-h + 5, k + 2, 0, k - 2, h - 6, k + 1]), 'rgba(110,60,20,0.3)', 1);
      g.fillStyle = m[1];
      for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.fillRect(nx * (h - 5) - 1.5, ny * (h - 5) - 1.5, 3, 3);
    } else if (e.t === 'I') segs(g, [[-h + 6, h * 0.2, -h * 0.1, -h + 6], [-h + 6, h * 0.7, h * 0.35, -h + 6]], m[2], 3); // 冰：两道高光
    else {
      // 石头：砖缝 + 斑点
      g.fillStyle = m[1];
      g.fillRect(-h, -1, s, 2); g.fillRect(-1, -h, 2, h); g.fillRect(-h * 0.5, 0, 2, h);
      g.fillStyle = m[2];
      g.fillRect(-h + 6, -h + 6, 6, 4); g.fillRect(h * 0.3, h * 0.35, 7, 4);
    }
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(-h, -h, s, 3);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(-h, h - 3, s, 3);
    g.strokeStyle = e.t === 'I' ? 'rgba(60,130,170,0.8)' : 'rgba(40,25,10,0.55)';
    g.lineWidth = 1.5;
    g.strokeRect(-h + 0.75, -h + 0.75, s - 1.5, s - 1.5);
    // 裂纹：越打越多（形状由 id 决定，不会每帧乱跳）
    const frac = e.hp / e.max;
    if (frac >= 0.8) return;
    const r = rng(e.id * 977 + 13);
    const cracks = [];
    for (let i = 0, n = frac < 0.35 ? 4 : frac < 0.6 ? 2 : 1; i < n; i++) {
      const pts = [(r() - 0.5) * s * 0.5, (r() - 0.5) * s * 0.5];
      for (let k = 0; k < 3; k++) pts.push(clamp(pts.at(-2) + (r() - 0.5) * s * 0.5, -h, h), clamp(pts.at(-1) + (r() - 0.5) * s * 0.5, -h, h));
      cracks.push(pts);
    }
    segs(g, cracks, e.t === 'I' ? 'rgba(255,255,255,0.95)' : 'rgba(30,18,8,0.7)', 1.4);
  }

  drawPig(g, s, e, rt, laugh) {
    const R0 = s * { p: 0.3, h: 0.33, m: 0.4, k: 0.44 }[e.t];
    const cy = s / 2 - R0 * 1.02 + (laugh ? -Math.abs(Math.sin(rt * 13 + e.id)) * 7 : Math.sin(rt * 2.2 + e.id) * 1.2);
    const P = (x, y) => [x * R0, cy + y * R0];
    g.lineWidth = 2;
    g.strokeStyle = '#3d7a1c';
    g.fillStyle = '#82d042';
    for (const [x, y, rx, ry] of [[-0.55, -0.82, 0.2, 0.2], [0.55, -0.82, 0.2, 0.2], [0, 0, 1.06, 1]]) {
      g.beginPath(); g.ellipse(x * R0, cy + y * R0, rx * R0, ry * R0, 0, 0, TAU); g.fill(); g.stroke(); // 耳朵 + 圆滚滚的身子
    }
    if (e.hp < e.max * 0.6) for (const [x, y, r] of [[-0.5, 0.35, 0.2], [0.6, -0.05, 0.13]]) dot(g, ...P(x, y), r * R0, 'rgba(60,100,35,0.5)'); // 被打过的淤青
    for (const sx of [-1, 1]) {
      dot(g, ...P(sx * 0.42, -0.3), R0 * 0.21, '#fff');
      dot(g, ...P(sx * 0.42 + 0.04, -0.28), R0 * 0.09, '#111');
    }
    // 大鼻子
    g.strokeStyle = '#4c8c25';
    g.lineWidth = 1.5;
    oval(g, ...P(0, 0.08), R0 * 0.36, R0 * 0.26, 0, '#a9e46c');
    g.stroke();
    for (const sx of [-1, 1]) oval(g, ...P(sx * 0.13, 0.08), R0 * 0.07, R0 * 0.11, 0, '#2d5a16');
    // 嘴：在笑的时候张得老大
    if (laugh) oval(g, ...P(0, 0.56), R0 * 0.3, R0 * 0.17, 0, '#2b4a14');
    else {
      g.strokeStyle = '#2b4a14';
      g.beginPath(); g.arc(...P(0, 0.38), R0 * 0.22, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    }
    if (e.t === 'm') {
      // 胡子工头：大胡子 + 粗眉毛
      for (const sx of [-1, 1]) oval(g, ...P(sx * 0.28, 0.4), R0 * 0.32, R0 * 0.12, sx * 0.3, '#6b4a2b');
      segs(g, [[...P(-0.68, -0.62), ...P(-0.2, -0.52)], [...P(0.68, -0.62), ...P(0.2, -0.52)]], '#6b4a2b', R0 * 0.13);
    }
    if (e.helm > 0) {
      // 头盔：越打越瘪
      g.fillStyle = e.helm > 30 ? '#a9adb3' : '#8a8d92';
      g.strokeStyle = '#55585d';
      g.beginPath(); g.arc(...P(0, -0.38), R0 * 0.95, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fill(); g.stroke();
      g.fillRect(-R0, cy - R0 * 0.45, R0 * 2, R0 * 0.14);
      if (e.helm < 35) segs(g, [[...P(-0.25, -1.2), ...P(0, -0.9), ...P(0.18, -1.12)]], '#3c3e42', 1.5);
    }
    if (e.t === 'k') {
      // 猪王的王冠
      g.strokeStyle = '#b8860b';
      poly(g, [[-0.5, 0], [-0.58, -0.5], [-0.25, -0.25], [0, -0.62], [0.25, -0.25], [0.58, -0.5], [0.5, 0]].map(([x, y]) => P(x, y - 0.85)), '#ffd23f', true);
      dot(g, ...P(0, -1.03), R0 * 0.08, '#e03b3b');
    }
    if (laugh && Math.sin(rt * 6 + e.id) > -0.2) {
      const t = L('哈哈', 'Haha');
      g.font = `800 ${Math.round(s * 0.26)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.strokeText(t, 0, cy - R0 * 1.6);
      g.fillStyle = '#fff';
      g.fillText(t, 0, cy - R0 * 1.6);
    }
  }

  /** 飞在天上的东西：鸟、沙丁鱼罐头、神鹰、TNT。 */
  drawBody(g, kind, x, y, dir, ang, spin, rt) {
    if (kind === 'swoop') return this.drawEagle(g, x, y, dir, rt);
    if (kind !== 'tnt' && kind !== 'can') return this.drawBird(g, kind, x, y, dir, ang);
    const tnt = kind === 'tnt';
    const flash = tnt && Math.floor(rt * 10) % 2 === 0;
    const [w, h] = tnt ? [34, 34] : [26, 14];
    g.save();
    g.translate(x, y);
    g.rotate(tnt ? 0 : spin);
    g.fillStyle = tnt ? (flash ? '#fff2c0' : '#c9302c') : '#9aa4ad';
    g.strokeStyle = tnt ? '#6a1a12' : '#5b636b';
    g.lineWidth = 2;
    g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, tnt ? 2 : 5); g.fill(); g.stroke();
    g.fillStyle = tnt ? (flash ? '#c9302c' : '#fff') : '#3d8fd1';
    if (tnt) {
      g.font = `900 12px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('TNT', 0, 1);
    } else g.fillRect(-9, -3, 18, 6); // 罐头上的小鱼标签
    g.restore();
  }

  drawBird(g, kind, x, y, dir = 1, ang = 0) {
    const r = BIRD_R[kind] || 12;
    const col = BIRD_COL[kind] || BIRD_COL.red;
    g.save();
    g.translate(x, y);
    g.scale(dir, 1);
    g.rotate(ang);
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    poly(g, [[-r * 0.8, -r * 0.1], [-r * 1.45, -r * 0.42], [-r * 1.35, r * 0.15]], kind === 'matilda' ? '#d8d2c4' : '#1d1d20'); // 尾巴
    // 身子：黄鸟是三角形，白鸟是蛋形，其它是圆的
    if (kind === 'chuck') poly(g, [[r * 1.15, r * 0.85], [-r * 1.1, r * 0.85], [-r * 0.05, -r * 1.15]], col, true);
    else {
      oval(g, 0, 0, kind === 'matilda' ? r * 0.95 : r, kind === 'matilda' ? r * 1.12 : r, 0, col);
      g.stroke();
    }
    if (kind !== 'chuck' && kind !== 'bomb') oval(g, r * 0.15, r * 0.52, r * 0.6, r * 0.36, 0, kind === 'blues' ? '#cfe8fb' : '#f1d9bd');
    if (kind === 'bomb') {
      // 炸弹鸟头顶的引线
      g.strokeStyle = '#8a6a3a';
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * 0.35, -r * 1.5, r * 0.1, -r * 1.7); g.stroke();
      dot(g, r * 0.1, -r * 1.75, 3, '#ffcf40');
    } else for (const a of [-0.3, 0.2]) oval(g, a * r - r * 0.05, -r * (kind === 'chuck' ? 1.25 : 1.05), r * 0.15, r * 0.36, a, kind === 'chuck' ? '#1d1d20' : kind === 'matilda' ? '#ff8fb0' : col);
    const ey = kind === 'chuck' ? r * 0.05 : -r * 0.18;
    for (const ex of [r * 0.18, r * 0.55]) dot(g, ex, ey, r * 0.2, '#fff');
    for (const ex of [r * 0.24, r * 0.6]) dot(g, ex, ey + r * 0.02, r * 0.09, '#111');
    // 愤怒的眉毛（灵魂所在）
    g.lineCap = 'round';
    segs(g, [[-r * 0.02, ey - r * 0.4, r * 0.37, ey - r * 0.17, r * 0.78, ey - r * 0.36]], kind === 'bomb' ? '#77777e' : '#111', Math.max(1.5, r * 0.17));
    g.lineCap = 'butt';
    poly(g, [[r * 0.5, ey + r * 0.2], [r * 1.22, ey + r * 0.36], [r * 0.5, ey + r * 0.56]], '#f5a623');
    g.restore();
  }

  /** 神鹰：比整座堡还大，翅膀一扇就全没了。 */
  drawEagle(g, x, y, dir, rt) {
    g.save();
    g.translate(x, y);
    g.scale(dir * 3, 3);
    const flap = Math.sin(rt * 9);
    g.fillStyle = '#6b4423';
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(-8, 0);
      g.quadraticCurveTo(-4, sgn * (26 + flap * 10), -30, sgn * (30 + flap * 12));
      g.quadraticCurveTo(-14, sgn * 10, 8, 0);
      g.fill();
    }
    oval(g, 0, 0, 26, 11, 0, '#7a4e28');
    poly(g, [[-24, -4], [-40, -10], [-40, 8], [-24, 4]], '#f5f2ea');
    dot(g, 24, -4, 10);
    g.fillStyle = '#f2b51d';
    g.beginPath(); g.moveTo(31, -7); g.quadraticCurveTo(43, -4, 36, 5); g.lineTo(31, 1); g.fill();
    dot(g, 27, -6, 1.6, '#111');
    segs(g, [[21, -11, 30, -8.5]], '#333', 1.5);
    g.restore();
  }

  drawSling(g, team, back) {
    const [x, dir] = [SLING[team], DIR[team]];
    const [px, py] = this.pouch(team);
    g.lineCap = 'round';
    if (back) {
      // 树杈主干 + 后面那根叉；后面那根皮筋画在鸟后面
      const [tx, ty] = [x - dir * 16, GROUND - 120];
      segs(g, [[x, GROUND + 2, x, GROUND - 72, tx, ty]], '#6b4220', 13);
      segs(g, [[tx, ty, px, py]], '#4b2c12', 5);
    } else {
      const [tx, ty] = [x + dir * 16, GROUND - 118];
      segs(g, [[px, py, tx, ty]], '#3a210c', 5);
      segs(g, [[x, GROUND - 70, tx, ty]], '#7a4c25', 12);
      oval(g, px - dir * 6, py + 2, 6, 10, 0, '#4a2a10');
    }
    g.lineCap = 'butt';
  }

  drawAim(g, a) {
    const [x0, y0] = pouchRest(a.team);
    const apex = 130 + Math.abs(a.x - x0) * 0.25;
    g.globalAlpha = Math.min(1, a.life / 0.4) * 0.85;
    for (let q = 1 / 18; q < 1; q += 1 / 18) dot(g, x0 + (a.x - x0) * q, y0 + (a.y - y0) * q - apex * 4 * q * (1 - q), 2.4, '#fff');
    segs(g, [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [a.x + dx * 8, a.y + dy * 8, a.x + dx * 24, a.y + dy * 24]), a.locked ? '#ffd23f' : '#ff5a4a', 2.5);
    g.beginPath(); g.arc(a.x, a.y, 16, 0, TAU); g.stroke();
    g.globalAlpha = 1;
  }

  drawStar(g, x, y, r, filled) {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return [x + Math.cos(a) * r * (i % 2 ? 0.45 : 1), y + Math.sin(a) * r * (i % 2 ? 0.45 : 1)];
    });
    g.lineWidth = 3;
    g.strokeStyle = filled ? '#a8730a' : 'rgba(0,0,0,0.35)';
    poly(g, pts, filled ? '#ffd23f' : 'rgba(255,255,255,0.35)', true);
  }

  hud(R) {
    if (R.phase !== 'live' || !R.fort) return null;
    const left = (t) => R.pigs(t).length;
    const pips = (t) => Array.from({ length: R.fort[t].pigs0 }, (_, i) => i < left(t));
    return { mid: L(`第 1-${R.round} 关`, `Level 1-${R.round}`), sub: `🐷 ${left('claude')} : ${left('codex')}`, pips: { claude: pips('claude'), codex: pips('codex') } };
  }
}
