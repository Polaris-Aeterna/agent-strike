// 贪吃蛇大作战：slither.io 式的混战竞技场。每个动作让自己的蛇往前爬几格，吃豆子变长。
// 上网查资料是加速冲刺，横插到别人脑袋前面；一头撞上别人身子的蛇当场暴毙，变成一地豆子。
// 最后一条活着的蛇赢；时间到了就看谁最长。
import { Rules as Base, COLOR, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, pill, emoji, fitText, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

// meta 在 import 时就求值，文字都写成 getter，切换语言后读到的是新语言
export const meta = {
  id: 'snake',
  icon: '🐍',
  get name() { return L('贪吃蛇大作战', 'Slither Snake'); },
  get desc() { return L('slither.io 式混战。每个动作往前爬、吃豆子变长；上网查资料加速冲刺，横插到别人脑袋前面截杀它', 'slither.io-style brawl. Every action slithers and eats; web searches boost you across a rival\'s head to cut it off'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('🌀 {a} 盘成一圈等你回复', '🌀 {a} coiled up, waiting for you'),
      sub: L('40 秒内回它，不然要饿瘦一大圈', 'Reply within 40s or it starves thin'),
      done: L('🐍 回得及时，舒展身子接着吃', '🐍 Replied in time, back to munching'),
      boom: L('🦴 {a} 等太久，饿瘦了一大圈', '🦴 {a} waited too long and starved thin'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('往前爬几格，吃掉路上的豆子', 'Slither forward, eat pellets on the way')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('吞噬：远距离截杀，一定会去截人', 'Devour: long-range cut-off, always goes for a kill')],
      [L('🔍 读文件、搜代码', '🔍 Read or search code'), L('嗅觉：认准最肥的豆子，接下来几步不乱撞', 'Sniff: steer to the juiciest food, no careless crashes')],
      [L('🧱 改代码', '🧱 Edit code'), L('吃大豆，多长几节', 'Big bean: grow extra')],
      [L('🔭 上网查资料', '🔭 Search the web'), L('加速冲刺：横插到对手脑袋前面截杀（加速会掉肉）', 'Boost: dash across a rival\'s head to cut it off (boosting costs mass)')],
      [L('✅ 任务完成', '✅ Task done'), L('金色食物，一口长一大截', 'Golden food: big growth')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('磁铁：把附近的豆子全吸过来', 'Magnet: suck in all nearby food')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('迷路：乱拐几下，可能一头撞上别人', 'Lost: random turns, may crash into someone')],
      [L('🐛 动作报错', '🐛 Action fails'), L('撞墙 / 咬到自己：掉几节，太短就死', 'Hit the wall / bit own tail: shrink, die if tiny')],
      [L('💰 烧 token', '💰 Burn tokens'), L('慢慢消化，长一点点', 'Digest: grow a little')],
      [L('✋ 被你打断', '✋ You interrupt it'), L('被你一刀砍了', 'Slashed by you')],
      [L('🌀 它在等你', '🌀 Waiting for you'), L('盘成一圈：杀不死也不动，40 秒不回饿瘦一大圈', 'Coils up: unkillable but frozen; 40s and it starves thin')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('变成巨蟒：长一大截，还带护盾', 'Mega snake: huge growth plus a shield')],
      [L('💀 头撞上别人的身子', '💀 Head into a body'), L('当场暴毙，变成一地豆子', 'Instant death, bursts into food')],
    ];
  },
};

// ================================================================ 竞技场（规则层和画面层共用同一套格子）

const { w: W, h: H } = WORLD;
const [GW, GH, CELL] = [48, 28, 32]; // 48 × 28 格，每格 32 像素
const [OX, OY] = [(W - GW * CELL) / 2, (H - GH * CELL) / 2];
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // 上右下左
const START_LEN = 5;
const FOOD_N = 44; // 场上至少保持这么多豆子
const FOOD_CAP = 260; // 尸体变的豆子再多也就这么多
const MAX_LEN = 150;
const MEGA = 32; // 长到这么长就是巨蟒
const TOK_GROW = 3000; // 每烧这么多 token 消化出一节
const SLIP = 0.15; // 不专心的时候没看见前面有人、一头撞上去的概率
const DASH = 8; // 加速冲刺最远冲几格（乘倍率前），吞噬是 1.6 倍
const DODGE = 0.3; // 被截的蛇最后一刻拐开的概率（嗅觉灵翻倍，吞噬减半）
const STEP = { shell: 3, read: 2, edit: 2, misc: 2, prompt: 2, agent: 2 }; // 每个动作爬几格（乘倍率前）
const ACT = new Set(['shell', 'read', 'edit', 'web', 'misc', 'agent']);
const OUCH = new Set(['shell', 'read', 'edit', 'web', 'misc']); // 这些动作报错 = 撞墙 / 咬到自己

const cx = (c) => c % GW;
const cy = (c) => (c / GW) | 0;
const at = (x, y) => y * GW + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;
const man = (a, b) => Math.abs(cx(a) - cx(b)) + Math.abs(cy(a) - cy(b));
const dirTo = (a, b) => (cy(b) < cy(a) ? 0 : cx(b) > cx(a) ? 1 : cy(b) > cy(a) ? 2 : 3);

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { ffa: true, maxPerTeam: 6 };

  init() {
    this.roundLen = (this.party ? 2 : 5) * 60e3; // 时间到了最长的蛇赢（源时间）
    this.reachK = this.party ? 1.3 : 1; // 大乱斗：冲得更远，截杀更容易
    this.food = new Map(); // 格子 → 豆子大小（1～5）
    Object.assign(this, { arena: false, t0: 0, acts: 0, cuts: 0, lastDead: null, lastKiller: null });
    // 障碍图（>0 对手身子，撞上就死；-1 自己身子）和最短路用的格子数组
    [this.own, this.dist, this.prev] = [new Int16Array(GW * GH), new Int16Array(GW * GH), new Int32Array(GW * GH)];
  }

  initPlayer(p) {
    Object.assign(p, { body: [], dir: 1, grow: 0, sniff: 0, shield: 0, coil: false, mega: false, rk: 0, wins: 0, tokAcc: 0, gen: 0, fresh: 0 });
  }

  /** 蛇的长度：身子 + 还没长出来的部分。 */
  len(p) {
    return p.body.length + Math.floor(p.grow);
  }

  /** 倍率：均衡火力 × 人少时单发更痛。 */
  pow(p) {
    return clamp(this.balanceMult(p.team) * this.sizeMult(), 0.5, 3);
  }

  steps(p, base) {
    return Math.max(1, Math.round(base * Math.sqrt(this.pow(p))));
  }

  /** 所有在场的蛇占着的格子。 */
  taken() {
    const t = new Uint8Array(GW * GH);
    for (const q of this.field()) for (const c of q.body) t[c] = 1;
    return t;
  }

  /** 出生：一条直直的小蛇，离别人的头远一点。位置按会话、这一局、第几条命确定，回放拖进度条也一样。 */
  spawn(p) {
    p.gen++;
    const r = rng(hash(`${p.sid}:${this.round}:${p.gen}`) ^ (Math.floor(this.roundStart / 1000) | 0));
    const t = this.taken();
    const heads = this.field().filter((q) => q !== p && q.body.length).map((q) => q.body[0]);
    let [body, dir] = [null, 1];
    for (let i = 0; i < 80; i++) {
      const [x, y, d] = [4 + Math.floor(r() * (GW - 8)), 4 + Math.floor(r() * (GH - 8)), Math.floor(r() * 4)];
      const cells = [];
      for (let k = 0; k < START_LEN; k++) cells.push(at(x - DIRS[d][0] * k, y - DIRS[d][1] * k));
      const ok = cells.every((c) => !t[c]) && heads.every((h) => man(h, cells[0]) >= 6);
      if (ok || !body) [body, dir] = [cells, d];
      if (ok) break;
    }
    // fresh：刚出生的小蛇自己动两下之前截不到（不然一开局就被秒）
    Object.assign(p, { alive: true, body, dir, grow: 0, sniff: 0, shield: 0, coil: this.waiting(p), mega: false, rk: 0, fresh: 2 });
  }

  /** 撒豆子：找空格子，大多是小豆子，偶尔一颗大的。 */
  sprinkle(r, n) {
    const t = this.taken();
    for (let i = 0; i < n && this.food.size < FOOD_CAP; i++) {
      for (let k = 0; k < 20; k++) {
        const c = Math.floor(r() * GW * GH);
        if (t[c] || this.food.has(c)) continue;
        this.food.set(c, r() < 0.12 ? 2 : 1);
        break;
      }
    }
  }

  // 半路上场：直接投胎一条小蛇；挂机下场：身子消失
  onEnter(p) {
    this.spawn(p);
  }

  onLeave(p) {
    [p.body, p.coil] = [[], false];
  }

  onRoundStart(fx) {
    Object.assign(this, { t0: this.now, acts: 0, cuts: 0, lastDead: null, lastKiller: null, arena: true });
    this.food = new Map();
    for (const p of this.field()) p.body = [];
    for (const p of this.field()) this.spawn(p);
    this.sprinkle(rng(hash(`snake-${this.round}`) ^ (Math.floor(this.roundStart / 1000) | 0)), FOOD_N);
    fx.push({ type: 'arena', round: this.round });
  }

  ghostOk() {
    return false; // 死了就是死了，等下一局
  }

  onTokens(p, n, fx) {
    if (!p.onField || !p.alive || this.phase !== 'live') return;
    for (p.tokAcc += n; p.tokAcc >= TOK_GROW; p.tokAcc -= TOK_GROW) this.gain(p, 1, fx);
  }

  onEvent(p, ev, r, fx) {
    if (!p.body.length) this.spawn(p);
    if (ACT.has(ev.k)) this.acts++;
    if (p.coil && ev.k !== 'ask' && ev.k !== 'answer' && !this.waiting(p)) p.coil = false;
    this.act(p, ev, r, fx);
    if (p.sniff > 0 && ACT.has(ev.k) && ev.k !== 'read') p.sniff--;
    if (p.fresh > 0 && ACT.has(ev.k)) p.fresh--;
    if (this.food.size < FOOD_N) this.sprinkle(r, FOOD_N - this.food.size);
  }

  act(p, ev, r, fx) {
    const g = Math.sqrt(this.pow(p));
    if (ev.ok === false && OUCH.has(ev.k)) return this.oops(p, r, fx);
    const say = (type) => fx.push({ type, sid: p.sid });
    switch (ev.k) {
      case 'shell': return ev.hs ? this.devour(p, r, fx) : this.crawl(p, this.steps(p, STEP.shell), r, fx); // 测试通过 = 吞噬
      case 'misc': return this.crawl(p, this.steps(p, STEP.misc), r, fx);
      case 'prompt': return this.crawl(p, this.steps(p, STEP.prompt), r, fx, { smart: true });
      case 'web': return this.dash(p, r, fx);
      case 'read': // 嗅觉：接下来几步认准最肥的豆子、不乱撞
        p.sniff = 3;
        say('sniff');
        return this.crawl(p, this.steps(p, STEP.read), r, fx, { smart: true });
      case 'edit': // 吃大豆
        this.crawl(p, this.steps(p, STEP.edit), r, fx);
        if (p.alive) say('bean');
        return this.gain(p, 3 * g, fx);
      case 'agent':
        this.magnet(p, g, fx);
        return this.crawl(p, this.steps(p, STEP.agent), r, fx, { smart: true });
      case 'done': // 金色食物
        say('golden');
        return this.gain(p, 6 * g, fx);
      case 'compact': // 迷路：乱拐几下
        say('dizzy');
        return this.crawl(p, 3, r, fx, { wild: true });
      case 'abort':
        say('abort');
        return this.die(p, null, { weapon: L('被你一刀砍了', 'Slashed by you'), cause: 'human' }, fx);
      case 'apierr':
        say('lag');
        return this.shrink(p, 1, fx, { weapon: L('卡成 PPT', 'Lag spike'), cause: 'net' });
      case 'pr':
        p.shield = 3;
        this.gain(p, 12 * g, fx, true);
        return this.mega(p, fx, L('PR 合体：长一大截 + 护盾', 'PR power-up: huge growth + shield'));
    }
  }

  // ---------------------------------------------------------------- 爬

  /** p 眼里的障碍图：对手的身子（撞上就死）和自己的身子（不会死，能躲就躲）。队友的身子可以穿过去。 */
  scan(p) {
    const own = this.own;
    own.fill(0);
    const list = [null];
    for (const q of this.foes(p)) {
      if (!q.body.length) continue;
      list.push(q);
      for (const c of q.body) own[c] = list.length - 1;
    }
    for (const c of p.body) if (!own[c]) own[c] = -1;
    return { own, list };
  }

  /** 认准一颗豆子：嗅觉好的时候挑最肥的，平时挑最近的。 */
  target(p, smart) {
    const h = p.body[0];
    let [best, bs] = [at(GW >> 1, GH >> 1), Infinity];
    for (const [c, v] of this.food) {
      const s = man(c, h) - v * (smart ? 2.5 : 0.6);
      if (s < bs) [best, bs] = [c, s];
    }
    return best;
  }

  /** 选方向：只能直走、左拐、右拐。离目标越近越好；对手的身子能躲就躲（不专心时偶尔没看见）。 */
  choose(p, S, tgt, smart, r) {
    const h = p.body[0];
    const [hx, hy, tx, ty] = [cx(h), cy(h), cx(tgt), cy(tgt)];
    let [best, bs] = [p.dir, Infinity];
    for (const turn of [0, 1, 3]) {
      const d = (p.dir + turn) % 4;
      const [x, y] = [hx + DIRS[d][0], hy + DIRS[d][1]];
      if (!inside(x, y)) continue;
      const o = S.own[at(x, y)];
      let s = Math.abs(x - tx) + Math.abs(y - ty) + (turn ? 0.25 : 0) + r() * 0.6;
      if (o > 0 && !(p.shield > 0)) s += smart || r() > SLIP ? 1000 : 0;
      else if (o < 0) s += 4;
      // 嗅觉好的时候还会躲开死胡同：周围几面是墙或对手的身子
      if (smart) for (const [dx, dy] of DIRS) if (!inside(x + dx, y + dy) || S.own[at(x + dx, y + dy)] > 0) s += 1.5;
      if (s < bs) [best, bs] = [d, s];
    }
    return best;
  }

  /** 往 d 方向爬一格，路上的豆子吃掉。撞上对手的身子返回 { by: 对手 }，没事返回 null。 */
  step(p, d, S, path, eat) {
    const h = p.body[0];
    const [x, y] = [cx(h) + DIRS[d][0], cy(h) + DIRS[d][1]];
    if (!inside(x, y)) return { wall: true };
    const c = at(x, y);
    const o = S.own[c];
    if (o > 0) {
      if (!(p.shield > 0)) return { by: S.list[o], cell: c };
      p.shield--; // 巨蟒护体：硬穿过去
      S.shielded = true;
    }
    p.dir = d;
    p.body.unshift(c);
    path.push(c);
    if (!o) S.own[c] = -1;
    const v = this.food.get(c);
    if (v) {
      this.food.delete(c);
      p.grow = Math.min(p.grow + v, MAX_LEN);
      eat.push(c);
    }
    if (p.grow >= 1 && p.body.length < MAX_LEN) p.grow -= 1;
    else {
      const t = p.body.pop();
      if (S.own[t] === -1 && !p.body.includes(t)) S.own[t] = 0;
    }
    return null;
  }

  /**
   * 爬 n 格。smart：嗅觉好，挑最肥的豆子、不乱撞；wild：迷路，随便乱拐；goal：朝某一格冲。
   * 一头撞上对手的身子就死，算对手截杀的。
   */
  crawl(p, n, r, fx, { smart = false, wild = false, goal = null, kind = 'crawl' } = {}) {
    if (p.coil || !p.alive) return;
    const S = this.scan(p);
    const sharp = smart || p.sniff > 0;
    const [path, eat] = [[], []];
    let crash = null;
    for (let i = 0; i < n && !crash; i++) {
      let d;
      if (wild) {
        const ok = [0, 1, 3].map((t) => (p.dir + t) % 4).filter((k) => inside(cx(p.body[0]) + DIRS[k][0], cy(p.body[0]) + DIRS[k][1]));
        d = ok[Math.floor(r() * ok.length)];
      } else d = this.choose(p, S, goal ?? this.target(p, sharp), sharp, r);
      crash = this.step(p, d, S, path, eat);
    }
    if (crash?.by) path.push(crash.cell); // 画面上让脑袋撞进去
    this.moved(p, path, eat, kind, S, fx);
    if (crash?.by) this.die(p, crash.by, { weapon: L('🐍 拦腰截住', '🐍 Body-blocked'), cause: 'crash' }, fx);
  }

  moved(p, path, eat, kind, S, fx) {
    if (path.length) fx.push({ type: 'slither', sid: p.sid, cells: path, eat, kind });
    if (S.shielded) fx.push({ type: 'shield', sid: p.sid, left: p.shield });
    S.shielded = false;
    this.gain(p, 0, fx);
  }

  /** 长肉。第一次长到 MEGA 节就是巨蟒。 */
  gain(p, v, fx, quiet = false) {
    if (!p.alive) return;
    p.grow = clamp(p.grow + v, 0, Math.max(0, MAX_LEN - p.body.length));
    if (!p.mega && this.len(p) >= MEGA && !quiet) this.mega(p, fx, L(`长到 ${this.len(p)} 节`, `Length ${this.len(p)}`));
  }

  mega(p, fx, why) {
    p.mega = true;
    fx.push({ type: 'mega', sid: p.sid });
    fx.push({ type: 'announce', text: L('🐉 变成巨蟒！', '🐉 Mega snake!'), sub: `${p.name} · ${why}`, cls: p.team, ms: 2000 });
  }

  /** 掉肉：先扣没长出来的，再从尾巴往回缩。只剩一个头就死。 */
  shrink(p, n, fx, info) {
    if (!p.alive) return;
    const g = Math.min(Math.floor(p.grow), n);
    p.grow -= g;
    for (let i = g; i < n && p.body.length; i++) p.body.pop();
    fx.push({ type: 'shrink', sid: p.sid });
    if (p.body.length < 2) this.die(p, null, info, fx);
  }

  oops(p, r, fx) {
    const wall = r() < 0.5;
    fx.push({ type: 'oops', sid: p.sid, wall });
    this.shrink(p, 2, fx, { weapon: wall ? L('撞墙了', 'Hit the wall') : L('咬到自己了', 'Bit its own tail'), cause: 'bug' });
  }

  // ---------------------------------------------------------------- 截杀

  /** 从蛇头出发的最短路（不穿对手身子、不穿自己身子），最多 reach 格。 */
  bfs(p, S, reach) {
    const { dist, prev } = this;
    dist.fill(-1);
    const queue = [p.body[0]];
    dist[queue[0]] = 0;
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      if (dist[c] >= reach) continue;
      for (const [dx, dy] of DIRS) {
        const [x, y] = [cx(c) + dx, cy(c) + dy];
        const n = at(x, y);
        if (!inside(x, y) || dist[n] >= 0 || S.own[n] !== 0) continue;
        [dist[n], prev[n]] = [dist[c] + 1, c];
        queue.push(n);
      }
    }
    return dist;
  }

  /**
   * 截杀：冲到对手脑袋正前方那一格，再往旁边一拐，身子横在它面前——它一头撞上来，当场暴毙。
   * 够不着就返回 false。盘成一圈（在等你）的蛇杀不死；巨蟒的护盾能挡一次。
   */
  cutoff(p, reach, r, fx, kind) {
    if (p.coil || !p.alive) return false;
    const S = this.scan(p);
    const foes = this.foes(p).filter((q) => q.body.length && !q.coil && !q.fresh);
    if (!foes.length) return false;
    const dist = this.bfs(p, S, reach);
    let best = null;
    for (const q of foes) {
      const [x, y] = [cx(q.body[0]) + DIRS[q.dir][0], cy(q.body[0]) + DIRS[q.dir][1]];
      if (!inside(x, y)) continue;
      const X = at(x, y);
      const d = S.own[X] < 0 ? 0 : dist[X]; // 自己的身子已经横在它面前了
      if (d < 0 || d > reach) continue;
      if (!best || d < best.d || (d === best.d && this.len(q) > this.len(best.q))) best = { q, X, d };
    }
    if (!best) return false;
    const [path, eat] = [[], []];
    if (best.d > 0) {
      const route = [];
      for (let c = best.X; c !== p.body[0]; c = this.prev[c]) route.unshift(c);
      for (const c of route) if (this.step(p, dirTo(p.body[0], c), S, path, eat)) break;
      // 再往旁边拐一步，让身子横在它脑袋前面
      for (const turn of [1, 3]) {
        const d = (best.q.dir + turn) % 4;
        const [x, y] = [cx(p.body[0]) + DIRS[d][0], cy(p.body[0]) + DIRS[d][1]];
        if (d === (p.dir + 2) % 4 || !inside(x, y) || S.own[at(x, y)] !== 0) continue;
        this.step(p, d, S, path, eat);
        break;
      }
    }
    this.moved(p, path, eat, kind, S, fx);
    const q = best.q;
    // 对手嗅觉灵（刚读过代码）就更容易在最后一刻拐开
    if (r() < (q.sniff > 0 ? DODGE * 2 : DODGE) * (kind === 'devour' ? 0.5 : 1)) {
      fx.push({ type: 'swerve', from: p.sid, to: q.sid, cell: best.X });
      return true;
    }
    fx.push({ type: 'snip', from: p.sid, to: q.sid, cell: best.X, hs: kind === 'devour' });
    if (q.shield > 0) {
      q.shield--;
      fx.push({ type: 'shield', sid: q.sid, left: q.shield }, { type: 'note', text: L('🛡️ {0} 想截杀 {1}，被巨蟒护盾弹开了', '🛡️ {0} tried to cut off {1} — bounced off the mega shield'), sids: [p.sid, q.sid] });
      return true;
    }
    this.die(q, p, { weapon: L('✂️ 截杀', '✂️ cut off'), cause: 'cut', hs: kind === 'devour' }, fx);
    return true;
  }

  /** 加速冲刺：能截杀就截杀，够不着就朝最近的对手冲过去。加速会掉肉：尾巴掉下一颗豆子。 */
  dash(p, r, fx) {
    if (p.coil) return;
    const reach = Math.round(DASH * this.reachK * this.pow(p) ** 0.25);
    if (!this.cutoff(p, reach, r, fx, 'dash')) {
      const near = this.foes(p).filter((q) => q.body.length).sort((a, b) => man(a.body[0], p.body[0]) - man(b.body[0], p.body[0]))[0];
      this.crawl(p, Math.max(3, Math.round(reach * 0.6)), r, fx, { smart: true, goal: near ? near.body[0] : null, kind: 'dash' });
    }
    if (p.alive && p.body.length >= 7) {
      const t = p.body.pop();
      this.food.set(t, Math.min(5, (this.food.get(t) || 0) + 1));
      fx.push({ type: 'shed', sid: p.sid, cell: t });
    }
  }

  /** 吞噬（测试通过）：截杀距离翻倍还不掉肉；实在够不着就猛吃一口。 */
  devour(p, r, fx) {
    if (p.coil) return;
    const reach = Math.round(DASH * 1.6 * this.reachK * this.pow(p) ** 0.25);
    if (this.cutoff(p, reach, r, fx, 'devour')) return;
    fx.push({ type: 'bean', sid: p.sid, big: true });
    this.gain(p, 2 * Math.sqrt(this.pow(p)), fx);
    this.crawl(p, this.steps(p, STEP.shell), r, fx, { smart: true });
  }

  /** 磁铁（派子代理）：附近 5 格内的豆子全吸过来。 */
  magnet(p, g, fx) {
    if (p.coil) return;
    const h = p.body[0];
    const got = [...this.food.keys()].filter((c) => Math.max(Math.abs(cx(c) - cx(h)), Math.abs(cy(c) - cy(h))) <= 5);
    const v = got.reduce((s, c) => s + this.food.get(c), 0);
    for (const c of got) this.food.delete(c);
    fx.push({ type: 'magnet', sid: p.sid, cells: got });
    this.gain(p, v * g, fx);
  }

  /** 死了：身子变成一路豆子，长度记到计分板的「伤害」那一栏。 */
  die(q, killer, info, fx) {
    if (!q.alive) return;
    const len = this.len(q);
    const cells = q.body.slice();
    cells.forEach((c, i) => {
      if (this.food.size >= FOOD_CAP && !this.food.has(c)) return;
      this.food.set(c, Math.min(5, (this.food.get(c) || 0) + 1 + (len >= 16 && i % 3 === 0 ? 1 : 0)));
    });
    Object.assign(q, { alive: false, body: [], grow: 0, coil: false, shield: 0, d: q.d + 1, dmg: q.dmg + len });
    this.lastDead = q;
    const k = killer && killer !== q ? killer : null;
    if (k) {
      [k.k, k.rk, k.hs] = [k.k + 1, k.rk + 1, k.hs + (info.hs ? 1 : 0)];
      this.lastKiller = k;
    }
    fx.push({ type: 'kill', killer: k ? k.sid : null, victim: q.sid, weapon: info.weapon, hs: !!info.hs, cause: info.cause, cells, len });
    if (!k) return;
    // 这局第一次截杀、截杀了一条大蛇、以小博大，才值得全场广播
    const kl = this.len(k);
    const [first, upset] = [!this.cuts++, len >= 10 && kl * 2 <= len];
    if (!first && len < 18 && !upset) return;
    const sub = upset ? L(`${k.name}（${kl} 节）干掉了 ${q.name}（${len} 节）`, `${k.name} (${kl}) took down ${q.name} (${len})`)
      : len >= 18 ? L(`${q.name} 变成了 ${cells.length} 颗豆子`, `${q.name} burst into ${cells.length} pellets`)
        : L(`${q.name} 被 ${k.name} 截杀了`, `${q.name} got cut off by ${k.name}`);
    fx.push({ type: 'announce', text: L('✂️ 截杀！', '✂️ Cut off!'), sub, cls: k.team, ms: 1600 });
  }

  // ---------------------------------------------------------------- 它在等你：盘成一圈

  onWait(p, fx) {
    if (!p.alive) return;
    p.coil = true;
    fx.push({ type: 'coil', sid: p.sid }, { type: 'note', text: L('🌀 {0} 盘成一圈等你回复，这时候谁也杀不了它', '🌀 {0} coiled up waiting for you — unkillable for now'), sids: [p.sid] });
  }

  onAnswer(p, wait, fx) {
    p.coil = false;
    if (p.alive) fx.push({ type: 'uncoil', sid: p.sid });
    this.gain(p, 1, fx);
  }

  /** 等太久：饿瘦一半，本来就小的直接饿死。 */
  onWaitTimeout(p, fx) {
    p.coil = false;
    if (p.alive) fx.push({ type: 'starve', sid: p.sid });
    this.shrink(p, Math.ceil(this.len(p) / 2), fx, { weapon: L('饿死了', 'Starved'), cause: 'zone' });
  }

  // ---------------------------------------------------------------- 回合

  /** 时间到的那一刻：时钟准点停下来，最长的蛇赢，和推进频率无关。 */
  timers() {
    return this.arena ? [this.t0 + this.roundLen] : [];
  }

  onTick(fx) {
    if (!this.arena || this.now - this.t0 < this.roundLen) return;
    const best = this.ranking()[0];
    if (this.acts >= 3 && best) this.win(best, 'time', fx);
    else this.t0 = this.now; // 这一局几乎没人动：再等一轮
  }

  ranking() {
    return this.alive().sort((a, b) => this.len(b) - this.len(a) || b.rk - a.rk || (a.sid < b.sid ? -1 : 1));
  }

  /** 只剩一条蛇（两队都在：只剩一队的蛇）就结束。 */
  check(fx) {
    if (!this.arena) return;
    const up = this.alive();
    const both = this.field('claude').length && this.field('codex').length;
    if ((both ? new Set(up.map((q) => q.team)).size : up.length) > 1) return;
    const best = this.ranking()[0] || this.lastKiller || this.lastDead;
    if (best) this.win(best, 'last', fx);
  }

  win(p, why, fx) {
    p.wins++;
    const len = this.len(p);
    fx.push({ type: 'winner', sid: p.sid });
    const text = why === 'time' ? L('🏆 最长的蛇！', '🏆 Longest snake!') : L('🐍 最后一条蛇！', '🐍 Last snake slithering!');
    const sub = L(`${p.name} · ${len} 节 · 截杀 ${p.rk}`, `${p.name} · length ${len} · ${p.rk} cut-offs`);
    fx.push({ type: 'announce', text, sub, cls: 'gold', ms: 2600 });
    this.endRound(p.team, why, fx, why === 'time' ? L(`时间到 · 最长的蛇 ${len} 节`, `Time up · longest snake: ${len}`) : L('最后一条活着的蛇', 'Last snake alive'));
  }

  onRoundEnd() {
    for (const p of this.alive()) p.dmg += this.len(p); // 活到最后的长度也记上
  }
}

// ================================================================ 画面

const TAU = Math.PI * 2;
const px = (c) => OX + (cx(c) + 0.5) * CELL;
const py = (c) => OY + (cy(c) + 0.5) * CELL;
const PANEL = { x: 14, y: 14, w: 250 }; // 左上角排行榜

const disc = (g, x, y, r, color) => {
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, TAU); g.fill();
};

/** 每条蛇一个颜色：队伍的色相，按会话微调色相和深浅。 */
function paint(sid, team) {
  const k = hash(sid);
  const [hue, sat, lit] = [(team === 'claude' ? 20 : 212) + ((k % 7) - 3) * 7, 72 + ((k >> 3) % 20), 52 + ((k >> 6) % 12)];
  const hsl = (l, a = 1) => `hsla(${hue},${sat}%,${l}%,${a})`;
  return { body: hsl(lit), stripe: hsl(lit + 15), edge: hsl(lit - 30), dot: hsl(lit + 6), glow: `hsla(${hue},100%,62%,0.32)`, boom: `hsla(${hue},100%,62%,0.9)` };
}

/** 蛇的粗细：越长越粗。 */
const girth = (len) => 9 + Math.min(7, Math.sqrt(Math.max(0, len)) * 0.95);

/** 深色六边形地砖 + 红色边界，像 slither.io。 */
function drawArena() {
  const c = document.createElement('canvas');
  [c.width, c.height] = [W * 2, H * 2];
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.fillStyle = '#0b0e13';
  g.fillRect(0, 0, W, H);
  const [R, hw] = [24, 24 * Math.sqrt(3)];
  for (let row = -1; row * R * 1.5 < H + R; row++) {
    for (let col = -1; col * hw < W + hw; col++) {
      const [x, y] = [col * hw + (row % 2 ? hw / 2 : 0), row * R * 1.5];
      const gr = g.createRadialGradient(x - 3, y - 5, 2, x, y, R);
      [['#222a36', 0], ['#12171e', 1]].forEach(([col, k]) => gr.addColorStop(k, col));
      g.fillStyle = gr;
      g.beginPath();
      for (let k = 0; k < 6; k++) g.lineTo(x + Math.cos(-Math.PI / 2 + (k * TAU) / 6) * (R - 2), y + Math.sin(-Math.PI / 2 + (k * TAU) / 6) * (R - 2));
      g.fill();
    }
  }
  // 场外发暗发红，边界一圈红光
  const [aw, ah] = [GW * CELL, GH * CELL];
  g.fillStyle = 'rgba(70,0,12,0.6)';
  g.beginPath(); g.rect(0, 0, W, H); g.rect(OX, OY, aw, ah); g.fill('evenodd');
  for (const [col, lw] of [['rgba(255,40,70,0.12)', 16], ['rgba(255,50,80,0.35)', 6], ['#ff4d64', 2]]) {
    [g.strokeStyle, g.lineWidth] = [col, lw];
    g.beginPath(); g.roundRect(OX, OY, aw, ah, 6); g.stroke();
  }
  return c;
}

/** 沿轨迹取第 s 格处的位置（s 可以是小数）。轨迹是头在前的点列。 */
function along(track, s) {
  const n = track.length;
  if (s <= 0 || n === 1) return track[0];
  if (s >= n - 1) return track[n - 1];
  const [a, b, k] = [track[Math.floor(s)], track[Math.floor(s) + 1], s % 1];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** 穿过一串点的平滑曲线（格子上的直角弯会被抹圆）。 */
function smoothPath(g, pts) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  const last = pts[pts.length - 1];
  g.lineTo(last.x + (pts.length === 1 ? 0.1 : 0), last.y);
}

// 飘字：type → [文字, 颜色]（写成函数，显示的时候才按当前语言取）
const SAY = {
  bean: (f) => [f.big ? L('😋 吞噬！', '😋 Devour!') : L('🫘 吃大豆', '🫘 Big bean'), '#ffd27a'],
  golden: () => [L('🌟 金色食物', '🌟 Golden food'), '#ffe45a'],
  sniff: () => [L('👃 嗅到了', '👃 Sniff sniff'), '#bfe8ff'],
  dizzy: () => [L('💫 迷路了', '💫 Lost!'), '#d6c2ff'],
  lag: () => [L('📡 卡成 PPT', '📡 Lag spike'), '#ff8a8a'],
  oops: (f) => [f.wall ? L('🧱 撞墙了', '🧱 Bonk! Wall') : L('😵 咬到自己', '😵 Bit own tail'), '#ffb38a'],
  coil: () => [L('🌀 盘成一圈', '🌀 Coiled up'), '#bfe8ff'],
  uncoil: () => [L('🐍 舒展开了', '🐍 Uncoiled'), '#9fe07a'],
  starve: () => [L('🦴 饿瘦了', '🦴 Starved thin'), '#ff9a8a'],
  mega: () => [L('🐉 巨蟒！', '🐉 MEGA!'), '#ffd75a'],
  shield: () => [L('🛡️ 护盾挡住了', '🛡️ Shield held'), '#ffd75a'],
  shed: () => [L('掉肉', '-mass'), '#aab'],
};
const QUIET = new Set(['sniff', 'shed', 'bean']); // 倍速很高时不飘这些字
const ICON = { lag: '📡', abort: '✋', starve: '🦴' };
// 光环：type → [起始半径, 结束半径, 颜色, 时长, 线宽]
const RING = {
  bean: [4, 34, 'rgba(255,190,120,0.8)', 0.45, 3],
  golden: [4, 40, 'rgba(255,220,80,0.95)', 0.5, 4],
  shield: [10, 46, 'rgba(255,215,90,0.95)', 0.5, 4],
  mega: [10, 90, 'rgba(255,215,90,0.9)', 0.7, 6],
  magnet: [5 * CELL, 12, 'rgba(160,220,255,0.7)', 0.5, 3],
};

class Worm {
  constructor(sid, team) {
    Object.assign(this, { sid, team, track: [], q: 0, len: 0, gen: -1, ang: 0, dash: 0, hit: 0, dead: 0, label: null, icon: null });
    this.col = paint(sid, team);
  }

  /** 直接对齐到规则层的身子（新一局、拖进度条、跟丢了）。 */
  snap(p, len = p.body.length) {
    this.track = p.body.map((c) => ({ x: px(c), y: py(c) }));
    Object.assign(this, { q: 0, len, gen: p.gen, dead: 0 });
    const [a, b] = this.track;
    this.ang = b ? Math.atan2(a.y - b.y, a.x - b.x) : (p.dir - 1) * (Math.PI / 2);
  }

  /** 规则层爬了几格：新格子接到轨迹前面，脑袋再慢慢爬过去。 */
  push(cells, busy) {
    for (const c of cells) this.track.unshift({ x: px(c), y: py(c) });
    this.q = busy ? 0 : Math.min(this.q + cells.length, 24);
  }

  head() {
    return this.track.length ? along(this.track, this.q) : null;
  }

  /** 画面上的身子：从脑袋往后取 len 格。 */
  points() {
    const t = this.track;
    if (!t.length) return [];
    const end = Math.min(t.length - 1, this.q + Math.max(1, this.len) - 1);
    const pts = [along(t, this.q)];
    for (let i = Math.floor(this.q) + 1; i < end; i++) pts.push(t[i]);
    if (end > this.q) pts.push(along(t, end));
    return pts;
  }

  update(dt, p, frozen) {
    [this.dash, this.hit] = [Math.max(0, this.dash - dt), Math.max(0, this.hit - dt)];
    if (this.label && (this.label.life -= dt) <= 0) this.label = null;
    if (this.icon && (this.icon.life -= dt) <= 0) this.icon = null;
    this.q = Math.max(0, this.q - dt * (5 + this.q * 3.5)); // 落后越多爬得越快
    if (this.dead || frozen || !p) return;
    if (p.gen !== this.gen) return this.snap(p);
    const n = p.body.length;
    this.len += (n - this.len) * Math.min(1, dt * 5);
    // 爬完了就和规则层核对一下：头尾对不上（漏了动作）就直接对齐
    const same = (pt, c) => pt && pt.x === px(c) && pt.y === py(c);
    if (this.q === 0 && n && p.alive && !(same(this.track[0], p.body[0]) && same(this.track[n - 1], p.body[n - 1]))) this.snap(p, this.len);
    this.track.length = Math.min(this.track.length, Math.ceil(this.q + Math.max(this.len, n)) + 2);
    const [a, b] = [this.head(), along(this.track, this.q + 0.6)];
    if (!a || !b || (a.x === b.x && a.y === b.y)) return;
    let diff = Math.atan2(a.y - b.y, a.x - b.x) - this.ang;
    diff -= Math.round(diff / TAU) * TAU;
    this.ang += diff * Math.min(1, dt * 14);
  }
}

let arenaLayer = null;

export class View {
  constructor(app) {
    this.app = app;
    arenaLayer ||= drawArena();
    this.fx = new Particles();
    [this.worms, this.pellets, this.born] = [new Map(), new Map(), new Set()];
    this.reset(null);
  }

  reset(R) {
    for (const x of [this.fx, this.worms, this.pellets]) x.clear();
    Object.assign(this, { sucked: [], frozen: 0, winner: null });
    if (!R) return;
    for (const p of R.field()) this.worm(R, p.sid);
    this.syncFood(R, this.app.rt() - 5);
  }

  worm(R, sid) {
    let w = this.worms.get(sid);
    const p = R.players.get(sid);
    if (!w && p && p.onField) {
      w = new Worm(sid, p.team);
      w.snap(p);
      if (!p.alive) w.dead = -1;
      this.worms.set(sid, w);
      this.born.add(sid); // 同一批效果里刚建出来的：身子已经是爬完的样子，这批的 move 不用再接
    }
    return w;
  }

  /** 豆子跟着规则层走；新冒出来的豆子有个弹出来的动画。 */
  syncFood(R, rt) {
    for (const [c, v] of R.food) {
      const f = this.pellets.get(c);
      if (f) f.v = v;
      else this.addPellet(c, v, rt);
    }
    for (const c of this.pellets.keys()) if (!R.food.has(c)) this.pellets.delete(c);
  }

  addPellet(c, v, rt) {
    const k = hash(`f${c}`);
    this.pellets.set(c, { v, x: px(c) + ((k & 15) - 7.5) * 0.8, y: py(c) + (((k >> 4) & 15) - 7.5) * 0.8, hue: (k >> 8) % 360, ph: (k % 100) / 16, born: rt });
  }

  /** 豆子被吸进嘴里。 */
  suck(cells, w, dur) {
    for (const c of cells) {
      const f = this.pellets.get(c);
      if (!f) continue;
      this.pellets.delete(c);
      if (this.sucked.length < 120) this.sucked.push({ ...f, w, t: 0, dur });
    }
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    this.born.clear();
    for (const f of list) {
      const w = f.sid ? this.worm(R, f.sid) : null;
      const h = w?.head();
      const show = h && !this.frozen;
      if (show && SAY[f.type] && !(busy && QUIET.has(f.type))) fx.text(h.x, h.y - 30, ...SAY[f.type](f), 14, 1.3);
      if (show && RING[f.type]) fx.ring(h.x, h.y, ...RING[f.type]);
      if (w && ICON[f.type]) w.icon = { text: ICON[f.type], life: 2.2 };
      switch (f.type) {
        case 'act': // 头顶的动作气泡（死了的蛇不显示）
          if (w && f.alive && f.ev.k !== 'think' && !(busy && f.ev.k === 'read')) w.label = actText(f.ev) && { text: actText(f.ev), ok: f.ev.ok !== false, life: 1.7 };
          break;
        case 'slither':
          if (!w || this.frozen || w.dead || this.born.has(f.sid) || !Array.isArray(f.cells)) break; // 别的游戏也有 move，认准自己的
          w.push(f.cells, busy);
          if (f.kind !== 'crawl') w.dash = busy ? 0.3 : 0.9;
          this.suck(f.eat, w, 0.25);
          if (busy) break;
          if (f.eat.length && app.sfx.ok(0)) app.sfx.tone(620 + f.eat.length * 90, 0.06, 0.04, 'sine', 980); // 吃豆子的「啵」
          if (f.kind !== 'crawl' && app.sfx.ok(1)) app.sfx.tone(240, 0.25, 0.05, 'sawtooth', 720); // 加速的「咻」
          break;
        case 'magnet':
          if (!show) break;
          this.suck(f.cells || [], w, 0.5);
          if (!busy) fx.text(h.x, h.y - 30, L(`🧲 磁铁 +${f.cells.length}`, `🧲 Magnet +${f.cells.length}`), '#bfe8ff', 14, 1.3);
          break;
        case 'golden':
        case 'mega':
          if (show) fx.sparks(h.x, h.y, '#ffd75a', busy ? 4 : 18, 200);
          if (f.type === 'mega') app.sfx.good();
          else if (app.sfx.ok(1)) [784, 988, 1319].forEach((hz, i) => app.sfx.tone(hz, 0.08, 0.05, 'square', null, i * 0.06));
          break;
        case 'snip':
        case 'swerve': {
          // 截杀：被截的蛇头上一声「截杀！」；没截到就是「躲开了」
          const bh = this.worm(R, f.to)?.head();
          if (!bh || this.frozen || f.cell == null || (busy && f.type === 'swerve')) break;
          const [text, col] = f.type === 'swerve' ? [L('😎 躲开了', '😎 Dodged!'), '#bfe8ff'] : f.hs ? [L('😋 吞噬截杀！', '😋 Devoured!'), '#ffd75a'] : [L('✂️ 截杀！', '✂️ Cut off!'), '#fff'];
          fx.text(bh.x, bh.y - 36, text, col, f.type === 'snip' ? 17 : 15, 1.4);
          if (!busy && f.type === 'snip') fx.ring(px(f.cell), py(f.cell), 4, 40, 'rgba(255,255,255,0.9)', 0.4, 4);
          break;
        }
        case 'bench': this.worms.delete(f.sid); break;
        case 'shrink': if (w) w.hit = 0.25; break;
        case 'kill': this.burst(R, f, busy); break;
        case 'winner': this.winner = f.sid; break;
        case 'roundEnd': this.frozen = app.rt() + (busy ? 0.4 : 2.2); break; // 定格一会儿，看清谁赢了
      }
    }
  }

  /** 死亡：身子炸成一圈彩色的光点，留下一地豆子。 */
  burst(R, f, busy) {
    const w = this.worm(R, f.victim);
    if (!w || w.dead || this.frozen || !f.cells) return;
    const { fx, app } = this;
    w.dead = app.rt();
    const pts = w.points();
    const every = Math.ceil(pts.length / (busy ? 4 : 40));
    for (const pt of pts.filter((_, i) => i % every === 0)) fx.sparks(pt.x, pt.y, w.col.stripe, busy ? 1 : 3, 120);
    if (pts[0]) {
      fx.ring(pts[0].x, pts[0].y, 6, 70, w.col.boom, 0.5, 5);
      const why = { human: L('✋ 被你一刀砍了', '✋ Slashed by you'), zone: L('🦴 饿死了', '🦴 Starved'), bug: L('💥 撞死了', '💥 Wrecked') }[f.cause] || L('💀 暴毙', '💀 Burst!');
      fx.text(pts[0].x, pts[0].y - 34, why, '#fff', 16, 1.6);
    }
    // 尸体豆子马上冒出来（规则层可能已经开了新的一局，所以直接用 fx 里的格子）
    for (const c of f.cells) if (!this.pellets.has(c)) this.addPellet(c, 1, app.rt());
    if (f.cause === 'cut' || f.cause === 'crash') app.sfx.headshot();
    app.sfx.boom(false);
    if (!busy && f.len >= 18) app.shake(0.3, 6);
  }

  update(dt, R) {
    const rt = this.app.rt();
    if (this.frozen && rt >= this.frozen) {
      // 新的一局：所有蛇对齐到新的出生点
      Object.assign(this, { frozen: 0, winner: null, sucked: [] });
      for (const [sid] of this.worms) if (!R.players.get(sid)?.onField) this.worms.delete(sid);
      for (const p of R.field()) this.worm(R, p.sid)?.snap(p);
      for (const w of this.worms.values()) if (!R.players.get(w.sid)?.alive) w.dead = -1;
      this.pellets.clear();
    }
    const frozen = !!this.frozen;
    if (!frozen) this.syncFood(R, rt);
    for (const w of this.worms.values()) {
      const p = R.players.get(w.sid);
      if (p && w.dead && p.alive && !frozen && p.gen !== w.gen) w.snap(p); // 下一条命
      w.update(dt, p, frozen);
      const h = w.dash > 0 && !w.dead && Math.random() < dt * 30 ? w.head() : null;
      if (h) this.fx.sparks(h.x - Math.cos(w.ang) * 14, h.y - Math.sin(w.ang) * 14, w.col.stripe, 1, 60); // 加速时尾焰
    }
    for (const s of this.sucked) s.t += dt;
    this.sucked = this.sucked.filter((s) => s.t < s.dur);
    this.fx.update(dt);
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(arenaLayer, 0, 0, W, H);
    this.drawFood(g, rt);
    // 活着的蛇 + 刚死还在消散的蛇；短的先画，长的压在上面
    const order = [...this.worms.values()].filter((w) => R.players.get(w.sid) && (w.dead === 0 || (w.dead > 0 && rt - w.dead < 0.5))).sort((a, b) => a.len - b.len);
    this.fx.renderUnder(g);
    const king = this.king(R);
    for (const w of order) this.drawWorm(g, w, R.players.get(w.sid), rt, king);
    this.fx.renderOver(g, scale);
    const fs = fontFor(scale);
    for (const w of order) if (!w.dead) this.drawTags(g, R, w, R.players.get(w.sid), fs, rt, king);
    this.drawBoard(g, R, fs);
  }

  /** 场上最长的那条蛇（头上戴王冠）。 */
  king(R) {
    const best = R.ranking()[0];
    return best && R.len(best) > START_LEN ? best.sid : null;
  }

  /** 发光的豆子：外面一圈晕，里面一颗亮点，轻轻呼吸。被吃的豆子飞进嘴里。 */
  drawFood(g, rt) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const f of this.pellets.values()) {
      const r = (3 + f.v * 1.5) * (0.4 + 0.6 * Math.min(1, (rt - f.born) / 0.35)) * (1 + 0.12 * Math.sin(rt * 3 + f.ph));
      disc(g, f.x, f.y, r * 2.4, `hsla(${f.hue},100%,60%,0.16)`);
      disc(g, f.x, f.y, r, `hsl(${f.hue},100%,62%)`);
      disc(g, f.x - r * 0.25, f.y - r * 0.25, r * 0.4, 'rgba(255,255,255,0.8)');
    }
    for (const s of this.sucked) {
      const [h, k] = [s.w.head() || s, (s.t / s.dur) ** 2];
      const [x, y, r] = [s.x + (h.x - s.x) * k, s.y + (h.y - s.y) * k, (3 + s.v * 1.5) * (1 - k * 0.7)];
      disc(g, x, y, r * 2, `hsla(${s.hue},100%,60%,0.2)`);
      disc(g, x, y, r, `hsl(${s.hue},100%,65%)`);
    }
    g.restore();
  }

  /** 一条又粗又滑的蛇：发光（冲刺 / 护盾 / 巨蟒）→ 深色描边 → 身子 → 条纹 → 高光 → 脑袋和眼睛。 */
  drawWorm(g, w, p, rt, king) {
    const pts = w.points();
    if (!pts.length) return;
    const dying = w.dead > 0 ? clamp((rt - w.dead) / 0.5, 0, 1) : 0; // 死了：0.5 秒里变粗、变淡、散掉
    const [c, r] = [w.col, girth(w.len) * (1 + dying * 0.4)];
    const body = w.hit > 0 ? '#ff6a6a' : c.body;
    g.save();
    g.globalAlpha = 1 - dying;
    [g.lineCap, g.lineJoin] = ['round', 'round'];
    smoothPath(g, pts);
    const stroke = (color, width, cap = 'round') => {
      [g.strokeStyle, g.lineWidth, g.lineCap] = [color, width, cap];
      g.stroke();
    };
    if (w.dash > 0 || p.shield > 0 || p.mega) stroke(p.shield > 0 ? `rgba(255,215,90,${0.25 + 0.12 * Math.sin(rt * 6)})` : c.glow, r * 2 + (w.dash > 0 ? 22 : 12));
    stroke(c.edge, r * 2 + 3);
    stroke(body, r * 2);
    g.setLineDash([r * 0.8, r * 0.8]);
    stroke(c.stripe, r * 1.45, 'butt'); // 条纹用平头，圆头会把缝隙填满
    g.setLineDash([]);
    g.globalAlpha = (1 - dying) * 0.35;
    stroke('rgba(255,255,255,0.5)', r * 0.35); // 一道高光，看着像管子
    g.globalAlpha = 1 - dying;
    // 脑袋：比身子大一圈，眼睛看着前进方向
    const [{ x, y }, a, rh] = [pts[0], w.ang, r * 1.12];
    disc(g, x, y, rh + 1.5, c.edge);
    disc(g, x, y, rh, body);
    for (const s of [-1, 1]) {
      const [ex, ey] = [x + Math.cos(a + s * 0.75) * rh * 0.58, y + Math.sin(a + s * 0.75) * rh * 0.58];
      disc(g, ex, ey, rh * 0.38, '#fff');
      if (!w.dead) disc(g, ex + Math.cos(a) * rh * 0.15, ey + Math.sin(a) * rh * 0.15, rh * 0.22, '#111');
      else {
        [g.strokeStyle, g.lineWidth] = ['#111', 2]; // 死了：叉叉眼
        g.beginPath(); g.moveTo(ex - 3, ey - 3); g.lineTo(ex + 3, ey + 3); g.moveTo(ex + 3, ey - 3); g.lineTo(ex - 3, ey + 3); g.stroke();
      }
    }
    if (p.coil && !w.dead) {
      g.setLineDash([5, 5]); // 盘成一圈：头上一圈呼吸的虚线光环
      [g.strokeStyle, g.lineWidth] = [`rgba(170,220,255,${0.5 + 0.3 * Math.sin(rt * 4)})`, 3];
      g.beginPath(); g.arc(x, y, rh + 10 + 3 * Math.sin(rt * 4), 0, TAU); g.stroke();
      g.setLineDash([]);
    }
    if (p.shield > 0 && !w.dead) {
      [g.strokeStyle, g.lineWidth] = ['rgba(255,215,90,0.9)', 2.5]; // 护盾：剩几层就转几段金圈
      g.beginPath(); g.arc(x, y, rh + 6, rt * 3, rt * 3 + TAU * (p.shield / 3)); g.stroke();
    }
    g.restore();
    if (!w.dead && king === w.sid) emoji(g, '👑', x, y - rh - 8, 18);
    if (this.winner === w.sid && this.frozen) emoji(g, '🏆', x, y - rh - 34 - Math.abs(Math.sin(rt * 5)) * 8, 30);
  }

  /** 名字牌、动作气泡、挂机的 zzz、状态图标。 */
  drawTags(g, R, w, p, fs, rt, king) {
    const h = w.head();
    if (!h) return;
    const active = R.now - p.lastActive < (this.app.mode === 'live' ? 60e3 : 90e3);
    const y = h.y - girth(w.len) - (king === w.sid ? 30 : 18);
    pill(g, h.x, y, p.name, { color: COLOR[w.team], size: fs, max: 120 });
    if (w.label) {
      g.globalAlpha = Math.min(1, w.label.life / 0.4);
      pill(g, h.x, y - fs - 8 - (1.7 - w.label.life) * 6, w.label.text, {
        size: fs - 1, max: 190, weight: 500, bg: w.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)',
      });
    }
    if (!active && !p.coil) {
      [g.fillStyle, g.font] = ['rgba(255,255,255,0.8)', `700 ${fs}px sans-serif`];
      const k = (rt * 0.6 + h.x) % 1;
      g.globalAlpha = 1 - k;
      g.fillText('z', h.x + 16 + k * 8, h.y - 10 - k * 18);
    }
    g.globalAlpha = 1;
    const icon = p.coil ? '🌀' : w.icon?.text;
    if (icon) emoji(g, icon, h.x + girth(w.len) + 12, h.y - 6, fs + 8);
  }

  /** 左上角排行榜：名次、名字、长度、这局截杀数。死了的排在最后。 */
  drawBoard(g, R, fs) {
    const order = R.field().sort((a, b) => Number(b.alive) - Number(a.alive) || R.len(b) - R.len(a) || (a.sid < b.sid ? -1 : 1));
    if (!order.length) return;
    const [rowH, { x, y, w }] = [fs * 1.7, PANEL];
    g.fillStyle = 'rgba(10,12,16,0.6)';
    g.beginPath(); g.roundRect(x, y, w, rowH * (order.length + 1) + 10, 10); g.fill();
    [g.textBaseline, g.font, g.textAlign, g.fillStyle] = ['middle', `800 ${fs}px ${FONT}`, 'left', '#fff'];
    g.fillText(R.phase === 'live' ? L('🏆 排行榜', '🏆 Leaderboard') : L('🏆 排行榜 · 热身中', '🏆 Leaderboard · warm-up'), x + 12, y + rowH / 2 + 5);
    order.forEach((p, i) => {
      const yy = y + rowH * (i + 1.5) + 5;
      g.globalAlpha = p.alive ? 1 : 0.45;
      [g.font, g.textAlign, g.fillStyle] = [`900 ${fs}px ${FONT}`, 'left', (p.alive && ['#ffd75a', '#d9dde3', '#e0a065'][i]) || '#9aa0a8'];
      g.fillText(p.alive ? `#${i + 1}` : '💀', x + 10, yy);
      [g.font, g.fillStyle] = [`700 ${fs}px ${FONT}`, this.worms.get(p.sid)?.col.dot || COLOR[p.team]];
      g.fillText(fitText(g, p.name, w - 130), x + 46, yy);
      [g.textAlign, g.fillStyle] = ['right', '#fff'];
      const st = p.coil ? '🌀 ' : p.shield > 0 ? '🛡️ ' : p.rk ? `✂️${p.rk} ` : '';
      g.fillText(`${st}${p.alive ? R.len(p) : 0}`, x + w - 10, yy);
    });
    g.globalAlpha = 1;
  }

  hud(R) {
    if (R.phase !== 'live' || !R.arena) return null;
    const [up, left] = [R.ranking(), Math.max(0, R.roundLen - (R.now - R.t0))];
    const [top, t] = [up[0], `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`];
    return {
      mid: L(`剩余 ${up.length} 条`, `${up.length} snakes left`),
      sub: top ? L(`最长：${top.name} ${R.len(top)} 节 · ${t}`, `Longest: ${top.name} (${R.len(top)}) · ${t}`) : t,
    };
  }
}
