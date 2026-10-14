// 吃豆人：一队当吃豆人吃豆子，一队当鬼抓人，每局交换。
// 吃豆方每做一个动作，自己的吃豆人就沿迷宫走几格、一路吃豆（wakka wakka）；鬼方每做一个动作，自己操控的鬼就按性格追几格。
// 豆子吃光 = 吃豆方赢；命被抓光 =「GAME OVER」，鬼方赢。所有位置都在格子上，用 BFS 走，同样的事件永远走出同样的路。
import { Rules as Base, OTHER, COLOR, TEAM_NAME, WORLD, ACTIONS, hash, clamp, actText } from '../core.js';
import { Particles, pill, fontFor, FONT, emoji } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'pac',
  icon: '👻',
  get name() { return L('吃豆人', 'Pac-Man'); },
  get desc() { return L('一队当吃豆人吃豆子，一队当鬼抓人，每局交换。豆子吃光就赢，命被抓光就 GAME OVER', 'One team eats dots as Pac-Man, the other hunts as ghosts; swap every game. Clear the board to win, run out of lives and it\'s GAME OVER'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('⏳ {a} 在等你回复', '⏳ {a} is waiting for you'),
      sub: L('40 秒内不回：吃豆人会被鬼抓住，鬼会被吃回鬼屋', 'No reply in 40s: Pac-Man gets caught, a ghost gets eaten home'),
      done: L('✂️ 及时回复', '✂️ Replied in time'),
      boom: L('👻 {a} 等太久，被逮了个正着', '👻 {a} waited too long and got caught napping'),
    };
  },
  get legend() {
    return [
      [L('🟡 吃豆方 · 跑命令 / 读 / 改代码', '🟡 Pac side · run / read / edit'), L('往前走几格，一路吃豆（wakka wakka）', 'Move a few tiles, eating dots (wakka wakka)')],
      [L('🎯 吃豆方 · 测试 / 编译通过', '🎯 Pac side · tests / build pass'), L('能量豆！鬼变蓝逃跑，吃鬼 200/400/800/1600', 'Power Pellet! Ghosts turn blue: 200/400/800/1600')],
      [L('✋ 吃豆方 · 被你打断', '✋ Pac side · you interrupt'), L('你按了暂停……丢一条命', 'You hit PAUSE… lose a life')],
      [L('👻 鬼方 · 跑命令 / 读', '👻 Ghosts · run / read'), L('按性格追：红追、粉堵、青包抄、橙犯傻', 'Chase by personality: Blinky, Pinky, Inky, Clyde')],
      [L('🧱 鬼方 · 改代码', '🧱 Ghosts · edit code'), L('埋伏：堵吃豆人前面 4 格', 'Ambush 4 tiles ahead of Pac-Man')],
      [L('🔭 鬼方 · 上网查资料', '🔭 Ghosts · web search'), L('冲刺直追（Cruise Elroy）', 'Sprint straight at him (Cruise Elroy)')],
      [L('✅ 任务完成', '✅ Task done'), L('吃豆方出水果 🍒🍓🍊 / 鬼方所有鬼一起动', 'Pac: bonus fruit 🍒🍓🍊 / Ghosts: all move')],
      [L('🪂 派出子代理', '🪂 Subagent'), L('吃豆方加速 / 鬼方从鬼屋放出下一只鬼', 'Pac: speed boost / Ghosts: release the next ghost')],
      [L('🐛 报错', '🐛 Error'), L('吃豆人撞墙变慢 / 鬼散开回各自角落', 'Pac: bonk, slower / Ghosts: scatter to corners')],
      [L('💫 上下文压缩', '💫 Compaction'), L('吃豆人迷路乱拐 / 鬼全部回鬼屋', 'Pac: lost, random turns / Ghosts: back to the house')],
      [L('⏳ 它在等你', '⏳ Waiting on you'), L('原地发呆；超时吃豆人被抓 / 鬼被吃回家', 'Stands still; time out = caught / eaten home')],
    ];
  },
};

// ================================================================ 迷宫
// # 墙  . 豆  o 能量豆  空格 没豆的路  - 鬼屋门  _ 鬼屋里面。中间那行左右两头通着：隧道，钻进去从另一边出来。

const MAZES = {
  big: {
    rows: [
      '#######################################',
      '#.................###.................#',
      '#o###.#######.###.###.###.#######.###o#',
      '#.###.#######.###.###.###.#######.###.#',
      '#.....................................#',
      '#.###.###.###.###########.###.###.###.#',
      '#.###.###.###.###########.###.###.###.#',
      '#.....###                     ###.....#',
      '#####.### ##### ###-### ##### ###.#####',
      '#####.### ##### #_____# ##### ###.#####',
      '      ###       #_____#       ###      ',
      '#####.### ##### #_____# ##### ###.#####',
      '#####.### ##### ####### ##### ###.#####',
      '#.....###                     ###.....#',
      '#.###.###.#########.#########.###.###.#',
      '#.###.###.#########.#########.###.###.#',
      '#.................. ..................#',
      '#o###.###.###.#####.#####.###.###.###o#',
      '#.###.###.###.#####.#####.###.###.###.#',
      '#.....................................#',
      '#######################################',
    ],
    blinky: [19, 7], pen: [[19, 10], [17, 10], [21, 10], [19, 9]],
    spawn: [[19, 16], [13, 16], [25, 16], [9, 16], [29, 16]],
    fruit: [19, 13], elroy: 24,
  },
  // 大乱斗用的小迷宫：一回合几十个动作就要分胜负
  small: {
    rows: [
      '#######################',
      '#.........###.........#',
      '#o###.###.###.###.###o#',
      '#.....           .....#',
      '### #.# ###-### #.# ###',
      '### #.# #_____# #.# ###',
      '      # #_____# #      ',
      '#####.# #_____# #.#####',
      '#####.# ####### #.#####',
      '#.....           .....#',
      '#o###.###.###.###.###o#',
      '#.........###.........#',
      '#######################',
    ],
    blinky: [11, 3], pen: [[11, 6], [9, 6], [13, 6], [11, 5]],
    spawn: [[11, 9], [7, 9], [15, 9], [3, 9], [19, 9]],
    fruit: [11, 9], elroy: 10,
  },
};

const DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]]; // 上、左、下、右：原版的鬼碰到平局也按这个顺序选
const PREF = [[0, 1, 2, 3], [3, 2, 1, 0], [2, 3, 0, 1], [1, 0, 3, 2]]; // 几只吃豆人各有偏好，别挤成一串
const GHOST_COLOR = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852', '#b26bff'];
const ghostName = (i) => [L('红', 'Blinky'), L('粉', 'Pinky'), L('青', 'Inky'), L('橙', 'Clyde'), L('紫', 'Sue')][Math.min(i, 4)];
const FRUITS = [['🍒', 100], ['🍓', 300], ['🍊', 500], ['🍎', 700], ['🍈', 1000], ['👾', 2000], ['🔔', 3000], ['🔑', 5000]];
const PACE = { big: 2.4, small: 2.2 }; // 每个动作走几格的总节奏（调平衡用；小迷宫一回合几十个动作）
const GHOST_PACE = { big: 0.68, small: 0.8 }; // 鬼比吃豆人慢一些（原版也是）：四只鬼围一只吃豆人，太快就没得玩了
const POWER = { big: 10, small: 6 }; // 能量豆管几个动作
const EXTRA_LIVES = { big: 2, small: 1 }; // 命 = 吃豆人只数 + 这个数（单独玩一只吃豆人就是原版的 3 条命）
const PAC_STEPS = { shell: 3, edit: 3, web: 3, agent: 3, compact: 3, pr: 4, read: 2, misc: 2, done: 2, prompt: 0 }; // 吃豆方每种动作的基础步数
const WARY = 3; // 吃豆人离鬼几格以内就绕开
const DODGE = 0.5; // 鬼扑过来时，被盯上的吃豆人能躲开几成的步数
const BAL = [0.5, 2]; // 均衡倍数的上下限：一个动作不至于一步跨半个迷宫
const MAXSTEP = 16;
const EYES = 3; // 被吃掉的鬼只剩眼睛，每个动作往回飞几格
const FRUIT_TICKS = 16;
// 原版的豆子计数器：豆子吃掉多少比例后第 i 只鬼出门；丢命之后重新关进去，再按吃掉的豆子一只只放
const RELEASE = [0, 0, 0.08, 0.2, 0.3];
const AFTER_DEATH = [0, 0.03, 0.07, 0.13, 0.16];

const parsed = {};
/** 把字符画变成格子：墙、豆、邻居表（隧道两头互为邻居）。规则和画面共用，算一次就缓存。 */
function maze(key) {
  if (parsed[key]) return parsed[key];
  const def = MAZES[key];
  const [w, h] = [def.rows[0].length, def.rows.length];
  const n = w * h;
  const at = (x, y) => y * w + x;
  const wall = new Uint8Array(n);
  const any = new Uint8Array(n); // 鬼能走（含鬼屋）
  const out = new Uint8Array(n); // 鬼屋外面的路：吃豆人、在外面的鬼
  const dots = new Uint8Array(n);
  let [door, total] = [-1, 0];
  def.rows.forEach((row, y) => [...row].forEach((c, x) => {
    const i = at(x, y);
    [wall[i], any[i], out[i]] = [c === '#' ? 1 : 0, c === '#' ? 0 : 1, '#_-'.includes(c) ? 0 : 1];
    dots[i] = c === '.' ? 1 : c === 'o' ? 2 : 0;
    if (dots[i]) total++;
    if (c === '-') door = i;
  }));
  const nb = new Int16Array(n * 4).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 4; d++) {
      const [nx, ny] = [((i % w) + DIRS[d][0] + w) % w, ((i / w) | 0) + DIRS[d][1]];
      if (ny >= 0 && ny < h && any[i] && any[at(nx, ny)]) nb[i * 4 + d] = at(nx, ny);
    }
  }
  // 目标点落在墙里（比如粉鬼瞄的「前面 4 格」）时，换成离它最近的路
  const near = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let bd = Infinity;
    for (let j = 0; j < n; j++) {
      const dd = out[j] ? manhattan({ w }, i, j) : Infinity;
      if (dd < bd) [near[i], bd] = [j, dd];
    }
  }
  const P = ([x, y]) => at(x, y);
  parsed[key] = {
    key, w, h, n, wall, any, out, dots, nb, near, door, total, exit: door - w, elroy: def.elroy,
    home: P(def.pen[0]), start: [P(def.blinky), ...def.pen.map(P)], spawn: def.spawn.map(P), fruit: P(def.fruit),
    corners: [at(w - 2, 1), at(1, 1), at(w - 2, h - 2), at(1, h - 2)],
  };
  return parsed[key];
}

/** 多源 BFS：从 sources 出发，只走 mask 里的格子，返回每格的距离（走不到是 -1）。 */
function bfs(M, sources, mask) {
  const dist = new Int16Array(M.n).fill(-1);
  const q = [];
  for (const s of sources) if (s >= 0 && dist[s] < 0) dist[s] = 0, q.push(s);
  for (let i = 0; i < q.length; i++) {
    for (let d = 0; d < 4; d++) {
      const m = M.nb[q[i] * 4 + d];
      if (m >= 0 && mask[m] && dist[m] < 0) dist[m] = dist[q[i]] + 1, q.push(m);
    }
  }
  return dist;
}

function manhattan(M, a, b) {
  return Math.abs((a % M.w) - (b % M.w)) + Math.abs(((a / M.w) | 0) - ((b / M.w) | 0));
}

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { roundLen: 15 * 60e3 };

  init() {
    // gen：每丢一条命大家回起点就加一，走到一半的循环看到它变了就停
    Object.assign(this, { roundLen: this.opts.party ? 8 * 60e3 : this.opts.roundLen, hi: 0, idSeq: 0, gen: 0, trails: new Map() });
    this.setup();
  }

  setup() {
    const key = this.opts.party ? 'small' : 'big';
    const M = (this.M = maze(key));
    // 每局交换；大乱斗里每关都是第 1 局，按开局时刻抽一边，免得永远是 Claude 先吃豆
    const flip = this.opts.party ? hash(`pac-${this.now}`) & 1 : 0;
    this.pacTeam = (Math.max(1, this.round) + flip) % 2 === 1 ? 'claude' : 'codex';
    this.ghostTeam = OTHER[this.pacTeam];
    this.trails.clear();
    Object.assign(this, { pace: PACE[key], powerLen: POWER[key], dots: M.dots.slice(), dotsTotal: M.total, dotsLeft: M.total });
    Object.assign(this, { pacs: [], ghosts: [], power: 0, powerMax: this.powerLen, combo: 0, fruit: null, fruitNo: 0, fruits: [], points: 0, oneUp: false, elroy: false, livesLost: 0 });
    for (const p of this.field(this.pacTeam)) this.addPac(p);
    this.seen = new Set(this.pacs.map((c) => c.sid)); // 这局领过命的会话：挂机回来不再白送一条
    // 命是全队共用的：单独玩 3 条起（原版），每多一只吃豆人多一条；大乱斗少一条
    this.lives = this.livesMax = EXTRA_LIVES[key] + Math.max(1, this.pacs.length);
    for (let i = 0; i < Math.max(4, this.field(this.ghostTeam).length); i++) this.addGhost(i);
  }

  addPac(p, fx) {
    const had = this.pacOf(p);
    if (had) return had;
    let n = 0;
    while (this.pacs.some((c) => c.n === n)) n++;
    const c = { id: ++this.idSeq, sid: p.sid, n, cell: this.M.spawn[n % this.M.spawn.length], dir: 1, slow: 0, boost: 0 };
    this.pacs.push(c);
    fx?.push({ type: 'pacAdd', id: c.id, cell: c.cell });
    return c;
  }

  addGhost(i, fx) {
    const freeAt = Math.round(RELEASE[Math.min(i, 4)] * this.dotsTotal);
    const g = { id: ++this.idSeq, i, cell: 0, dir: 0, state: 'house', fright: false, released: freeAt <= 0, freeAt, restless: 0, rev: false };
    this.homeGhost(g);
    this.ghosts.push(g);
    fx?.push({ type: 'ghostAdd', id: g.id, cell: g.cell });
  }

  /** 回到开局位置：红鬼在门口，其它在鬼屋里。 */
  homeGhost(g) { Object.assign(g, { cell: this.M.start[Math.min(g.i, this.M.start.length - 1)], state: g.i === 0 ? 'out' : 'house', fright: false, dir: g.i === 0 ? 1 : 0 }); }

  /** 鬼由谁操控：鬼方的会话轮流分。一个人的时候四只鬼都归他。 */
  ctrl(g) {
    const f = this.field(this.ghostTeam);
    return f.length ? f[g.i % f.length] : null;
  }

  ghostsOf(p) {
    const f = this.field(this.ghostTeam);
    return f.includes(p) ? this.ghosts.filter((g) => g.i % f.length === f.indexOf(p)) : [];
  }
  pacOf(p) { return this.pacs.find((c) => c.sid === p.sid); }

  onEnter(p, fx) {
    if (this.phase !== 'live') return;
    if (p.team !== this.pacTeam) return void (this.field(this.ghostTeam).length > this.ghosts.length && this.addGhost(this.ghosts.length, fx));
    this.addPac(p, fx);
    if (!this.seen.has(p.sid)) this.seen.add(p.sid), this.lives++, this.livesMax++;
  }

  onLeave(p, fx) {
    const c = this.pacOf(p);
    if (!c) return;
    this.pacs = this.pacs.filter((x) => x !== c);
    fx.push({ type: 'pacGone', id: c.id });
  }

  onRoundStart(fx) {
    this.setup();
    fx.push({ type: 'pacRound' });
    const sub = L(`${TEAM_NAME[this.pacTeam]} 当吃豆人 · ${TEAM_NAME[this.ghostTeam]} 当鬼`, `${TEAM_NAME[this.pacTeam]} = Pac-Man · ${TEAM_NAME[this.ghostTeam]} = ghosts`);
    fx.push({ type: 'announce', text: L('READY!', 'READY!'), sub, cls: 'gold', ms: 1500 }); // 街机原文，两种语言都保留
  }

  /** 这个动作走几格：基础步数 × 均衡（有上下限）× 人少加速 × 节奏，随机取整（3.4 格 = 六成 3 格、四成 4 格）。 */
  steps(p, base, r) {
    const pace = this.pace * (p.team === this.ghostTeam ? GHOST_PACE[this.M.key] : 1);
    const m = clamp(this.balanceMult(p.team), BAL[0], BAL[1]) * this.sizeMult();
    return clamp(Math.floor(base * m * pace + r()), 0, MAXSTEP);
  }

  // ---------------------------------------------------------------- 走过的路：攒起来一次发给画面

  track(id, cell, eat) {
    const t = this.trails.get(id) || { cells: [], eat: [] };
    t.cells.push(cell);
    if (eat) t.eat.push(cell);
    this.trails.set(id, t);
  }

  flush(fx) {
    for (const [id, t] of this.trails) fx.push({ type: 'path', id, cells: t.cells, eat: t.eat });
    this.trails.clear();
  }

  // 先把路发出去，再发别的效果：画面里吃豆人先走到那儿，再被抓
  put(fx, f) { this.flush(fx), fx.push(f); }
  finish(winner, reason, fx, text) { this.flush(fx), this.endRound(winner, reason, fx, text); }

  // ---------------------------------------------------------------- 吃豆方

  pacMove(p, ev, r, fx) {
    const c = this.pacOf(p) || this.addPac(p, fx);
    const k = ev.k;
    if ((ev.ok === false && ACTIONS.has(k) && k !== 'agent') || k === 'apierr') return this.bonk(c, fx);
    if (k === 'abort') return this.put(fx, { type: 'announce', text: L('你按了暂停……', 'You pressed PAUSE…'), sub: L('吃豆人原地愣住，被鬼抓了', 'Pac-Man froze and got caught'), cls: 'bad' }), this.caught(c, null, fx, 'pause');
    if (k === 'shell' && ev.hs) p.hs++;
    if ((k === 'shell' && ev.hs) || k === 'pr') this.powerUp(c, fx);
    if (k === 'agent') c.boost = 3;
    if (k === 'agent' || k === 'compact') this.put(fx, { type: k === 'agent' ? 'boost' : 'lost', id: c.id });
    if (k === 'done') this.spawnFruit(fx);
    if (k in PAC_STEPS) this.walk(c, PAC_STEPS[k] ? this.steps(p, PAC_STEPS[k], r) : 1, r, fx, k === 'compact');
  }

  walk(c, n, r, fx, lost = false) {
    if (c.boost > 0) [n, c.boost] = [Math.round(n * 1.6) + 1, c.boost - 1];
    if (c.slow) [n, c.slow] = [Math.ceil(n / 2), 0];
    const [round, gen] = [this.round, this.gen];
    if (this.dots[c.cell]) this.eatAt(c, fx); // 刚出生就站在豆子上
    for (let k = 0; k < n && this.round === round && this.gen === gen; k++) {
      const d = lost ? this.randomDir(c, r) : this.pacDir(c, r);
      if (d < 0) break;
      this.stepPac(c, d, fx);
      if (this.round !== round || this.halted) break;
      this.collide(fx);
    }
  }

  stepPac(c, d, fx) {
    [c.cell, c.dir] = [this.M.nb[c.cell * 4 + d], d];
    this.track(c.id, c.cell, this.dots[c.cell]), this.eatAt(c, fx);
  }

  /** 吃豆人的脑子：先绕开鬼找目标；实在没有安全的豆子，就冒点险贴着鬼走；还不行才逃。 */
  pacDir(c, r) {
    const prey = new Set(this.ghosts.filter((g) => g.state === 'out' && g.fright).map((g) => g.cell));
    const danger = this.danger();
    const pref = PREF[(c.n + (r() < 0.25 ? 1 : 0)) % 4];
    for (const wary of danger ? [WARY, 1] : [0]) {
      const d = this.seek(c, prey, danger, wary, pref);
      if (d >= 0) return d;
    }
    return this.fleeDir(c, danger, pref);
  }

  /** BFS 找最近的目标：能吃的鬼 > 水果 > 被追时的能量豆 > 豆子。离鬼 wary 格以内当墙。 */
  seek(c, prey, danger, wary, pref) {
    const M = this.M;
    const safe = (i) => !danger || danger[i] < 0 || danger[i] > wary;
    const scared = danger && danger[c.cell] >= 0 && danger[c.cell] <= 7;
    const dist = new Int16Array(M.n).fill(-1);
    const first = new Int8Array(M.n).fill(-1);
    dist[c.cell] = 0;
    const q = [c.cell];
    let [hunt, fruit, pellet, dot] = [-1, -1, -1, -1];
    for (let qi = 0; qi < q.length && hunt < 0; qi++) {
      const cur = q[qi];
      if (qi > 0) {
        if (prey.has(cur) && dist[cur] <= 8) hunt = cur;
        if (this.fruit && cur === this.fruit.cell && fruit < 0 && dist[cur] <= 12) fruit = cur;
        if (this.dots[cur] === 2 && scared && pellet < 0 && dist[cur] <= 10) pellet = cur;
        if (this.dots[cur] && dot < 0) dot = cur;
        if (dot >= 0 && dist[cur] > 12 && !prey.size) break;
      }
      for (const d of pref) {
        const m = M.nb[cur * 4 + d];
        if (m < 0 || !M.out[m] || dist[m] >= 0 || !safe(m)) continue;
        [dist[m], first[m]] = [dist[cur] + 1, qi === 0 ? d : first[cur]];
        q.push(m);
      }
    }
    const goal = [hunt, fruit, pellet, dot].find((x) => x >= 0);
    return goal == null ? -1 : first[goal];
  }

  randomDir(c, r) {
    const opts = [0, 1, 2, 3].filter((d) => this.M.out[this.M.nb[c.cell * 4 + d]] && this.M.nb[c.cell * 4 + d] >= 0);
    return opts.length ? opts[Math.floor(r() * opts.length)] : -1;
  }

  /** 离不怕的鬼有多远（只算在外面、没变蓝的鬼）。 */
  danger() {
    const threats = this.ghosts.filter((g) => g.state === 'out' && !g.fright).map((g) => g.cell);
    return threats.length ? bfs(this.M, threats, this.M.out) : null;
  }

  /** 往离鬼最远的方向走一步；strict 时只在真能拉开距离时才走。 */
  fleeDir(c, danger, pref, strict = false) {
    let [best, bd] = [-1, danger ? danger[c.cell] : -1];
    for (const d of pref) {
      const m = this.M.nb[c.cell * 4 + d];
      if (m < 0 || !this.M.out[m]) continue;
      const dd = !danger || danger[m] < 0 ? 999 : danger[m];
      if (dd > bd || (!strict && best < 0 && dd > 0 && dd === bd)) [best, bd] = [d, dd];
    }
    return best;
  }

  eatAt(c, fx) {
    const k = this.dots[c.cell];
    if (k) {
      [this.dots[c.cell], this.dotsLeft] = [0, this.dotsLeft - 1];
      this.addPoints(c, k === 2 ? 50 : 10, fx);
      if (k === 2) this.powerUp(c, fx);
      if (this.dotsLeft === 0) return this.put(fx, { type: 'clear' }), this.finish(this.pacTeam, 'clear', fx, L('豆子吃光了！', 'Board cleared!'));
      if (this.dotsLeft === 1) this.put(fx, { type: 'announce', text: L('最后一颗豆！', 'Last dot!'), cls: 'gold', ms: 1400 });
      if (!this.elroy && this.dotsLeft <= this.M.elroy) {
        this.elroy = true; // 原版的 Cruise Elroy：豆子快没了，红鬼变快
        this.put(fx, { type: 'announce', text: L('🔴 红鬼发飙了！', '🔴 Cruise Elroy!'), sub: L('豆子快没了，红鬼加速', 'Few dots left, Blinky speeds up'), cls: 'bad', ms: 1400 });
      }
    }
    const f = this.fruit;
    if (!f || c.cell !== f.cell) return;
    [this.fruit, this.fruits] = [null, [...this.fruits, f.e]];
    this.addPoints(c, f.pts, fx);
    this.put(fx, { type: 'fruitEat', cell: c.cell, e: f.e, pts: f.pts });
  }

  addPoints(c, pts, fx) {
    this.points += pts;
    this.hi = Math.max(this.hi, this.points);
    const p = this.players.get(c.sid);
    if (p) p.dmg += pts / 10;
    if (this.oneUp || this.points < 10000) return;
    [this.oneUp, this.lives, this.livesMax] = [true, this.lives + 1, this.livesMax + 1];
    this.put(fx, { type: 'announce', text: L('1UP！奖励一条命', '1UP!'), sub: L('满一万分', '10,000 points: extra life'), cls: 'gold' });
  }

  powerUp(c, fx) {
    [this.power, this.powerMax, this.combo] = [this.powerLen, this.powerLen, 0];
    for (const g of this.ghosts) if (g.state !== 'eyes') [g.fright, g.rev] = [true, true]; // 原版：鬼一受惊就掉头
    this.put(fx, { type: 'power', id: c.id });
    this.put(fx, { type: 'announce', text: L('能量豆！', 'Power Pellet!'), sub: L('鬼变蓝了，快吃！', 'Ghosts turned blue, eat them!'), cls: 'gold', ms: 900 });
  }

  spawnFruit(fx) {
    if (this.fruit) return void (this.fruit.ticks = FRUIT_TICKS);
    const [e, pts] = FRUITS[Math.min(this.fruitNo++, FRUITS.length - 1)];
    this.fruit = { e, pts, cell: this.M.fruit, ticks: FRUIT_TICKS };
    this.put(fx, { type: 'fruit', cell: this.fruit.cell, e });
  }

  bonk(c, fx) { c.slow = 1, this.put(fx, { type: 'bonk', id: c.id }); }

  // ---------------------------------------------------------------- 碰撞：被抓 / 吃鬼

  collide(fx) {
    for (const c of this.pacs) {
      for (const g of this.ghosts) {
        if (g.state !== 'out' || g.cell !== c.cell) continue;
        if (!g.fright) return this.caught(c, g, fx, 'ghost');
        this.eatGhost(c, g, fx);
      }
    }
  }

  caught(c, g, fx, why) {
    const killer = g ? this.ctrl(g) : null;
    const victim = this.players.get(c.sid);
    const pause = why === 'pause';
    this.flush(fx);
    [this.lives, this.livesLost] = [this.lives - 1, this.livesLost + 1];
    if (victim) victim.d++;
    if (killer) [killer.k, killer.dmg] = [killer.k + 1, killer.dmg + 50];
    fx.push({ type: 'kill', killer: killer ? killer.sid : null, victim: c.sid, weapon: pause ? L('⏸ 暂停', '⏸ PAUSE') : `👻 ${ghostName(g.i)}`, cause: pause ? 'human' : 'ghost' });
    fx.push({ type: 'pacDie', id: c.id, cell: c.cell });
    if (this.lives <= 0) {
      fx.push({ type: 'announce', text: L('GAME OVER', 'GAME OVER'), sub: L(`${TEAM_NAME[this.ghostTeam]} 的鬼抓光了所有命`, `${TEAM_NAME[this.ghostTeam]}'s ghosts took every life`), cls: 'bad', ms: 2000 });
      return this.finish(this.ghostTeam, 'caught', fx, L('命被抓光了', 'Out of lives'));
    }
    // 跟原版一样：被抓之后吃豆人回起点、鬼回鬼屋重新排队出门，再来一次 READY!
    this.gen++;
    Object.assign(c, { cell: this.M.spawn[c.n % this.M.spawn.length], dir: 1, slow: 0, boost: 0 });
    fx.push({ type: 'warp', id: c.id, cell: c.cell, die: true });
    const eaten = this.dotsTotal - this.dotsLeft;
    for (const gh of this.ghosts) {
      this.homeGhost(gh);
      Object.assign(gh, { freeAt: eaten + Math.round(AFTER_DEATH[Math.min(gh.i, 4)] * this.dotsTotal), released: gh.i === 0, restless: 0 });
      fx.push({ type: 'warp', id: gh.id, cell: gh.cell });
    }
    this.power = 0;
    fx.push({ type: 'ready' });
  }

  eatGhost(c, g, fx) {
    this.flush(fx);
    this.combo = Math.min(this.combo + 1, 4);
    const pts = 200 * 2 ** (this.combo - 1);
    [g.state, g.fright] = ['eyes', false];
    const [eater, victim] = [this.players.get(c.sid), this.ctrl(g)];
    if (eater) eater.k++;
    if (victim) victim.d++;
    this.addPoints(c, pts, fx);
    if (victim) fx.push({ type: 'kill', killer: c.sid, victim: victim.sid, weapon: `👻 ${pts}`, cause: 'eat' });
    fx.push({ type: 'eatGhost', id: g.id, cell: g.cell, pts });
    if (pts === 1600) fx.push({ type: 'announce', text: '1600!', sub: L('一颗能量豆吃掉四只鬼', 'Four ghosts, one pellet'), cls: 'gold', ms: 1800 });
  }

  // ---------------------------------------------------------------- 鬼方

  ghostMove(p, ev, r, fx) {
    const mine = this.ghostsOf(p);
    if (!mine.length) return;
    const k = ev.k;
    // 一个人管好几只鬼时，每只分到的步数少一些（除以根号只数），不然一个动作四只鬼一起扑上来
    const share = 1 / Math.sqrt(mine.length);
    const n = (base) => this.steps(p, base * share, r);
    const all = (base) => this.steps(p, base / Math.sqrt(this.ghosts.length), r);
    const shout = (type, list = mine) => this.put(fx, { type, ids: list.map((g) => g.id) });
    if ((ev.ok === false && ACTIONS.has(k) && k !== 'agent') || k === 'apierr') return shout('scatter'), this.drive(mine, n(2), 'scatter', r, fx);
    switch (k) {
      case 'shell': case 'read': case 'misc': return this.drive(mine, n(k === 'shell' ? 3 : 2), 'chase', r, fx);
      // 埋伏 / 冲刺只让领头那只鬼做，其它照性格追：不然几只鬼瞄同一格，叠成一坨
      case 'edit': return this.drive(mine, n(3), (g) => (g === mine[0] ? 'ambush' : 'chase'), r, fx);
      case 'web': return shout('sprint', mine.slice(0, 1)), this.drive(mine, n(4.5), (g) => (g === mine[0] ? 'direct' : 'chase'), r, fx);
      case 'agent': {
        const caged = this.ghosts.find((g) => g.state === 'house' && !g.released);
        if (caged) this.release(caged, fx);
        return this.drive(mine, n(caged ? 2 : 4), 'chase', r, fx);
      }
      case 'done': return this.put(fx, { type: 'allMove' }), this.drive(this.ghosts, all(2), 'chase', r, fx);
      case 'prompt': return this.drive(mine, 1, 'chase', r, fx);
      case 'compact':
        for (const g of mine.filter((x) => x.state !== 'eyes')) this.homeGhost(g), (g.released = true), this.put(fx, { type: 'warp', id: g.id, cell: g.cell });
        return this.put(fx, { type: 'ghostHome' });
      case 'abort': return mine.filter((g) => g.state === 'out').forEach((g) => this.sendHome(g, fx));
      case 'pr': return shout('sprint', this.ghosts), this.drive(this.ghosts, all(4), 'chase', r, fx);
    }
  }

  release(g, fx) { g.released = true, this.put(fx, { type: 'release', id: g.id, i: g.i }); }
  sendHome(g, fx) { [g.state, g.fright] = ['eyes', false], this.put(fx, { type: 'eyes', id: g.id, cell: g.cell }); }

  /** 让一批鬼每只走 n 格（交替走，谁先碰到吃豆人算谁的）。受惊的鬼走一半，发飙的红鬼多走一半。 */
  drive(list, n, mode, r, fx) {
    const [round, gen] = [this.round, this.gen];
    for (const g of list) if (g.state === 'house' && !g.released && ++g.restless >= 3) this.release(g, fx); // 在鬼屋里待不住了
    const quota = (g) => (g.fright ? Math.ceil(n / 2) : g.i === 0 && this.elroy ? Math.ceil(n * 1.5) : n);
    const most = Math.max(0, ...list.map(quota));
    // 吃豆人也不是木头：鬼扑过来时，被盯上的吃豆人能躲开几步（实时游戏里两边是同时动的）
    const dodge = new Map(this.pacs.map((c) => [c.id, Math.floor(most * DODGE)]));
    const stop = () => this.round !== round || this.gen !== gen || this.halted;
    for (let k = 0; k < most; k++) {
      for (const g of list) {
        if (k >= quota(g)) continue;
        this.ghostStep(g, typeof mode === 'function' ? mode(g) : mode, r, fx);
        this.collide(fx);
        if (stop()) return;
        if (g.state === 'out' && !g.fright) this.evade(g, dodge, fx);
        if (stop()) return;
      }
    }
  }

  /** 鬼离吃豆人只剩两格：吃豆人往离鬼最远的方向闪一步（被两头夹住就闪不掉了）。 */
  evade(g, dodge, fx) {
    const near = this.pacs.filter((c) => dodge.get(c.id) > 0 && manhattan(this.M, g.cell, c.cell) <= 3);
    const danger = near.length ? this.danger() : null;
    if (!danger) return;
    const [round, gen] = [this.round, this.gen];
    for (const c of near) {
      if (!(danger[c.cell] >= 0 && danger[c.cell] <= 2)) continue;
      const d = this.fleeDir(c, danger, PREF[c.n % 4], true);
      if (d < 0) continue;
      dodge.set(c.id, dodge.get(c.id) - 1);
      this.stepPac(c, d, fx);
      if (this.round !== round) return;
      this.collide(fx);
      if (this.round !== round || this.gen !== gen) return;
    }
  }

  ghostStep(g, mode, r, fx) {
    const M = this.M;
    let [target, mask, forbid] = [g.i ? M.start[Math.min(g.i, M.start.length - 1)] : M.home, M.any, -1]; // 眼睛回自己在鬼屋里的位置
    if (g.state === 'house' && !g.released) return;
    if (g.state === 'house') target = M.exit;
    else if (g.state === 'out') {
      if (g.fright) return this.fleeStep(g, r);
      [target, mask, forbid] = [this.target(g, mode, r), M.out, g.rev ? -1 : g.dir ^ 2]; // 原版的鬼不许掉头
    }
    const dist = bfs(M, [target], mask);
    let [best, back, bd] = [-1, -1, Infinity];
    for (const d of PREF[g.i % 4]) {
      const m = M.nb[g.cell * 4 + d];
      if (m < 0 || !mask[m] || dist[m] < 0) continue;
      if (d === forbid) back = d;
      else if (dist[m] < bd) [best, bd] = [d, dist[m]];
    }
    if (best < 0) best = back;
    if (best < 0) return;
    this.stepGhost(g, best);
    if (g.state === 'eyes' && g.cell === target) [g.state, g.released] = ['house', true], this.put(fx, { type: 'revive', id: g.id });
    else if (g.state === 'house' && g.cell === M.exit) g.state = 'out';
  }

  stepGhost(g, d) { Object.assign(g, { cell: this.M.nb[g.cell * 4 + d], dir: d, rev: false }), this.track(g.id, g.cell, 0); }

  /** 受惊的鬼：大多往离吃豆人远的方向跑，偶尔乱拐（原版是伪随机）。 */
  fleeStep(g, r) {
    const M = this.M;
    const far = bfs(M, this.pacs.map((c) => c.cell), M.out);
    const opts = [];
    for (const d of PREF[g.i % 4]) {
      const m = M.nb[g.cell * 4 + d];
      if (m >= 0 && M.out[m] && (g.rev || d !== (g.dir ^ 2))) opts.push([d, far[m] < 0 ? 999 : far[m]]);
    }
    if (!opts.length) return void (M.out[M.nb[g.cell * 4 + (g.dir ^ 2)]] && M.nb[g.cell * 4 + (g.dir ^ 2)] >= 0 && this.stepGhost(g, g.dir ^ 2));
    const pick = r() < 0.3 ? opts[Math.floor(r() * opts.length)] : opts.reduce((a, b) => (b[1] > a[1] ? b : a));
    this.stepGhost(g, pick[0]);
  }

  /** 四只鬼的性格（原版）：红直追，粉堵前面 4 格，青拿红当尺子包抄，橙离近了就犯怂回角落。 */
  target(g, mode, r) {
    const M = this.M;
    const corner = M.corners[g.i % 4];
    let [pac, pd] = [null, Infinity];
    for (const c of this.pacs) {
      const d = manhattan(M, g.cell, c.cell);
      if (d < pd) [pac, pd] = [c, d];
    }
    if (!pac || mode === 'scatter') return corner;
    const [px, py] = [pac.cell % M.w, (pac.cell / M.w) | 0];
    // 原版的溢出 bug：吃豆人朝上的时候，「前面 k 格」还会往左偏 k 格
    const ahead = (k) => [px + DIRS[pac.dir][0] * k - (pac.dir === 0 ? k : 0), py + DIRS[pac.dir][1] * k];
    const cellAt = ([x, y]) => M.near[clamp(y, 0, M.h - 1) * M.w + clamp(x, 0, M.w - 1)];
    if (mode === 'direct') return pac.cell;
    if (mode === 'ambush') return cellAt(ahead(4));
    const [ax, ay] = ahead(2);
    const b = this.ghosts[0].cell;
    switch (g.i) {
      case 0: return pac.cell;
      case 1: return cellAt(ahead(4));
      case 2: return cellAt([2 * ax - (b % M.w), 2 * ay - ((b / M.w) | 0)]);
      case 3: return pd > 8 ? pac.cell : corner;
      default: return r() < 0.5 ? pac.cell : cellAt([ax, ay]);
    }
  }

  // ---------------------------------------------------------------- 每个动作：能量豆倒计时、水果、眼睛飞回家、放鬼出门

  tick(fx) {
    const round = this.round;
    if (this.power > 0 && --this.power === 0) for (const g of this.ghosts) g.fright = false;
    if (this.fruit && --this.fruit.ticks <= 0) this.fruit = null, this.put(fx, { type: 'fruitGone' });
    for (let k = 0; k < EYES; k++) for (const g of this.ghosts) if (g.state === 'eyes') this.ghostStep(g, 'home', null, fx);
    const eaten = this.dotsTotal - this.dotsLeft;
    for (const g of this.ghosts) if (g.state === 'house' && !g.released && eaten >= g.freeAt) this.release(g, fx);
    if (this.round === round) this.flush(fx);
  }

  onEvent(p, ev, r, fx) {
    if (this.phase !== 'live' || ev.k === 'think' || ev.k === 'ask' || ev.k === 'answer') return;
    const round = this.round;
    if (p.team === this.pacTeam) this.pacMove(p, ev, r, fx);
    else this.ghostMove(p, ev, r, fx);
    if (this.round !== round || this.halted || this.phase !== 'live') return;
    if (ACTIONS.has(ev.k)) this.tick(fx);
    this.flush(fx);
  }

  // 它在等你：吃豆人站着发呆，超时被最近的鬼抓；鬼打瞌睡，超时被吃回鬼屋
  onWaitTimeout(p, fx) {
    if (this.phase !== 'live') return;
    if (p.team !== this.pacTeam) {
      for (const g of this.ghostsOf(p)) if (g.state === 'out') this.sendHome(g, fx);
      return this.flush(fx);
    }
    const c = this.pacOf(p);
    const d = (g) => manhattan(this.M, g.cell, c.cell);
    const g = c && (this.ghosts.filter((x) => x.state === 'out').sort((a, b) => d(a) - d(b) || a.i - b.i)[0] || this.ghosts[0]);
    if (g) this.caught(c, g, fx, 'nap');
  }

  timers() { return [this.roundStart + this.roundLen]; }

  onTick(fx) {
    if (this.now - this.roundStart < this.roundLen) return;
    const eaten = this.dotsTotal - this.dotsLeft;
    if (!eaten && !this.livesLost) return void (this.roundStart = this.now); // 谁都没动：接着等
    // 时间到：比谁离赢更近（豆子吃掉的比例 vs 命丢掉的比例）
    const pct = Math.round((eaten / this.dotsTotal) * 100);
    const win = eaten / this.dotsTotal > this.livesLost / this.livesMax ? this.pacTeam : this.ghostTeam;
    this.finish(win, 'time', fx, L(`时间到 · 吃了 ${pct}% 的豆 · 丢了 ${this.livesLost}/${this.livesMax} 条命`, `Time! ${pct}% eaten · ${this.livesLost}/${this.livesMax} lives lost`));
  }
}

// ================================================================ 画面

const { w: W, h: H } = WORLD;
const AREA = { x: 30, y: 150, w: 1540, h: 790 };
const BLUE = '#2121de';
const YELLOW = '#ffe600';
const TAU = Math.PI * 2;

function layout(M) {
  const cs = Math.floor(Math.min(AREA.w / M.w, AREA.h / M.h));
  return { cs, x0: Math.round((W - M.w * cs) / 2), y0: Math.round(AREA.y + (AREA.h - M.h * cs) / 2) };
}

/** 经典的蓝色描边墙：每个墙格按四个角分别画直线 / 外圆角 / 内圆角，拼起来就是圆角双线。 */
function drawMaze(M, color) {
  const c = document.createElement('canvas');
  [c.width, c.height] = [W * 2, H * 2];
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const { cs, x0, y0 } = layout(M);
  const [h, d] = [cs / 2, cs * 0.32];
  const e = h - d;
  const isWall = (x, y) => x >= 0 && y >= 0 && x < M.w && y < M.h && M.wall[y * M.w + x] === 1;
  Object.assign(g, { strokeStyle: color, lineWidth: Math.max(2, cs * 0.08), lineCap: 'round' });
  g.beginPath();
  for (let y = 0; y < M.h; y++) {
    for (let x = 0; x < M.w; x++) {
      if (!isWall(x, y)) continue;
      const [cx, cy] = [x0 + (x + 0.5) * cs, y0 + (y + 0.5) * cs];
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const [v, hz] = [isWall(x, y + sy), isWall(x + sx, y)];
        if (!v && !hz) g.moveTo(cx, cy + sy * e), g.arcTo(cx + sx * e, cy + sy * e, cx + sx * e, cy, e); // 外圆角
        else if (!v) g.moveTo(cx, cy + sy * e), g.lineTo(cx + sx * h, cy + sy * e);
        else if (!hz) g.moveTo(cx + sx * e, cy), g.lineTo(cx + sx * e, cy + sy * h);
        else if (!isWall(x + sx, y + sy)) g.moveTo(cx + sx * h, cy + sy * e), g.arcTo(cx + sx * e, cy + sy * e, cx + sx * e, cy + sy * h, d); // 内圆角
      }
    }
  }
  g.stroke();
  // 鬼屋的粉色小门
  g.fillStyle = '#ffb8de';
  g.fillRect(x0 + (M.door % M.w) * cs - 2, y0 + ((M.door / M.w) | 0) * cs + h - cs * 0.07, cs + 4, cs * 0.14);
  return c;
}

const layers = {};

function poly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.fill();
}

function drawPac(g, x, y, r, dir, mouth, n) {
  const a = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][dir];
  g.fillStyle = YELLOW;
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a + mouth, a + TAU - mouth);
  g.fill();
  // 第二只起换装：吃豆小姐的蝴蝶结、小吃豆的螺旋桨帽、墨镜、皇冠
  const P = (dx, dy) => [x + r * dx, y + r * dy];
  if (n === 1) {
    g.fillStyle = '#ff2050';
    poly(g, [P(-0.15, -0.85), P(-0.75, -1.2), P(-0.65, -0.5), P(-0.15, -0.85), P(0.3, -1.25), P(0.4, -0.6)]);
  } else if (n === 2) {
    poly(Object.assign(g, { fillStyle: '#3a6cff', strokeStyle: '#ff3030', lineWidth: Math.max(1.5, r * 0.12) }), [P(-0.6, -0.55), P(-0.4, -1), P(0.4, -1), P(0.6, -0.55)]);
    g.beginPath();
    g.moveTo(...P(-0.55, -1.25)), g.lineTo(...P(0.55, -1.25)), g.moveTo(...P(0, -1)), g.lineTo(...P(0, -1.25));
    g.stroke();
  } else if (n === 3) {
    g.fillStyle = '#111';
    g.fillRect(x - r * 0.7, y - r * 0.5, r * 1.4, r * 0.3);
  } else if (n >= 4) {
    g.fillStyle = '#ffcc33';
    poly(g, [P(-0.5, -0.8), P(-0.5, -1.3), P(-0.2, -1.05), P(0, -1.4), P(0.2, -1.05), P(0.5, -1.3), P(0.5, -0.8)]);
  }
}

/** 鬼：圆顶 + 会抖的锯齿裙边；眼睛看着要去的方向。受惊是蓝身子波浪嘴，快结束时闪白。 */
function drawGhost(g, x, y, r, body, dir, t, look) {
  if (look !== 'eyes') {
    g.fillStyle = look === 'blue' ? '#2121ff' : look === 'white' ? '#f4f4ff' : body;
    g.beginPath();
    g.arc(x, y - r * 0.1, r, Math.PI, 0);
    const base = y + r * 0.95;
    const wob = Math.floor(t * 8) % 2;
    g.lineTo(x + r, base);
    for (let i = 0; i < 6; i++) g.lineTo(x + r - (2 * r * (i + 1)) / 6, (i + wob) % 2 === 0 ? base - r * 0.32 : base);
    g.closePath();
    g.fill();
  }
  if (look === 'blue' || look === 'white') {
    const face = look === 'blue' ? '#ffb8ae' : '#ff2020';
    Object.assign(g, { fillStyle: face, strokeStyle: face, lineWidth: Math.max(1.5, r * 0.1) });
    g.fillRect(x - r * 0.42, y - r * 0.4, r * 0.24, r * 0.24);
    g.fillRect(x + r * 0.18, y - r * 0.4, r * 0.24, r * 0.24);
    g.beginPath();
    for (let i = 0; i <= 6; i++) g[i ? 'lineTo' : 'moveTo'](x - r * 0.6 + (r * 1.2 * i) / 6, y + r * (i % 2 ? 0.2 : 0.38));
    g.stroke();
    return;
  }
  const [dx, dy] = DIRS[dir];
  for (const ex of [-0.38, 0.38]) {
    const [ox, oy] = [x + ex * r, y - r * 0.22];
    g.fillStyle = '#fff';
    g.beginPath(), g.ellipse(ox + dx * r * 0.1, oy + dy * r * 0.1, r * 0.27, r * 0.33, 0, 0, TAU), g.fill();
    g.fillStyle = BLUE;
    g.beginPath(), g.arc(ox + dx * r * 0.22, oy + dy * r * 0.22, r * 0.14, 0, TAU), g.fill();
  }
}

// 小字飘在角色头上：[文字, 颜色]
const BLURB = {
  bonk: () => [L('咚！撞墙了', 'Bonk!'), '#ff9a9a'],
  lost: () => [L('🌀 迷路了', '🌀 Lost!'), '#fff'],
  boost: () => [L('⚡ 加速！', '⚡ Speed up!'), YELLOW],
  sprint: () => [L('冲！', 'Sprint!'), '#ff8080'],
  scatter: () => [L('散开！', 'Scatter!'), '#9ad0ff'],
  release: (f) => [L(`${ghostName(f.i)}出门了`, `${ghostName(f.i)} is out`), GHOST_COLOR[Math.min(f.i, 4)]],
  revive: () => [L('复活', 'Back!'), '#ccc'],
  eyes: () => [L('被吃回老家', 'Sent home'), '#fff'],
};
// 写在鬼屋门口 / 水果位置的小字：[文字, 颜色, 位置]
const SIGN = {
  allMove: () => [L('👻 全体出动！', '👻 All ghosts move!'), '#ff8080', 'door'],
  ghostHome: () => [L('💫 失忆了，全部回鬼屋', '💫 Memory wiped, back to the house'), '#ccc', 'door'],
  fruit: (f) => [L(`水果出现了 ${f.e}`, `Bonus fruit ${f.e}`), '#ffb8ff', 'fruit'],
  fruitGone: () => [L('水果没了', 'Fruit gone'), '#aaa', 'fruit'],
};

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.sprites = new Map(); // id -> { x, y（格子坐标，小数）, q: 还要走的格子, dir, cell, mouth }
    this.labels = new Map();
    this.pending = new Map(); // 吃豆人还没走到、但规则里已经吃掉的豆：cell -> 吃豆人 id
    Object.assign(this, { dying: [], splash: [], flash: 0, wk: 0, M: null });
  }

  reset(R) {
    this.fx.clear();
    this.labels.clear();
    [this.splash, this.flash] = [[], 0];
    this.rebuild(R);
  }

  rebuild(R) {
    this.sprites.clear();
    this.pending.clear();
    [this.dying, this.M] = [[], R && R.M ? R.M : null];
    if (!this.M) return;
    this.lay = layout(this.M);
    layers[this.M.key] ||= drawMaze(this.M, BLUE);
    layers[`${this.M.key}:w`] ||= drawMaze(this.M, '#f4f4ff'); // 过关时迷宫闪白
    for (const e of [...R.pacs, ...R.ghosts]) this.sprite(e.id, e.cell);
  }

  sprite(id, cell) {
    let s = this.sprites.get(id);
    if (!s && this.M && cell != null) this.sprites.set(id, (s = { id, x: cell % this.M.w, y: (cell / this.M.w) | 0, cell, q: [], dir: 1, mouth: 0, moving: 0, hide: 0 }));
    return s;
  }

  snap(s, cell) {
    Object.assign(s, { q: [], cell, x: cell % this.M.w, y: (cell / this.M.w) | 0 });
    for (const [k, v] of this.pending) if (v === s.id) this.pending.delete(k);
  }

  // 格子 → 世界坐标（格子中心）；READY! / GAME OVER 排队写在鬼屋下面
  at(x, y) { return [this.lay.x0 + (x + 0.5) * this.lay.cs, this.lay.y0 + (y + 0.5) * this.lay.cs]; }
  atCell(cell) { return this.at(cell % this.M.w, (cell / this.M.w) | 0); }
  say(text, color, life) { if (this.splash.length < 3) this.splash.push({ text, color, life }); }

  apply(list, R, busy) {
    const { app, fx } = this;
    if (R.M !== this.M) this.rebuild(R);
    const tone = (...a) => app.sfx.ok(2) && app.sfx.tone(...a);
    for (const f of list) {
      const s = f.id != null ? this.sprites.get(f.id) : null;
      const [x, y] = f.cell != null ? this.atCell(f.cell) : [0, 0];
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (text && !(busy && f.ev.k === 'read')) this.labels.set(f.sid, { text, ok: f.ev.ok !== false, life: 1.7 });
          break;
        }
        case 'pacRound':
          this.rebuild(R);
          if (!busy) this.say('READY!', YELLOW, 1.8), app.sfx.ok(2) && [494, 988, 740, 622, 988, 740, 622].forEach((fq, i) => app.sfx.tone(fq, 0.11, 0.05, 'square', null, i * 0.12));
          break;
        case 'pacAdd': case 'ghostAdd': this.sprite(f.id, f.cell); break;
        case 'pacGone': this.sprites.delete(f.id); break;
        case 'path': {
          const sp = this.sprite(f.id, f.cells[0]);
          if (sp && busy) this.snap(sp, f.cells[f.cells.length - 1]);
          else if (sp) sp.q.push(...f.cells), f.eat.forEach((c) => this.pending.set(c, f.id));
          break;
        }
        case 'warp': {
          const sp = this.sprite(f.id, f.cell);
          if (sp) this.snap(sp, f.cell);
          if (sp && f.die && !busy) sp.hide = 1.4; // 等死亡动画放完再出来
          break;
        }
        case 'pacDie':
          if (s) this.snap(s, f.cell);
          if (!busy) this.dying.push({ x, y, t: 0, dur: 1.4 }), app.shake(0.3, 5), tone(900, 1.1, 0.07, 'square', 110);
          break;
        case 'ready': if (!busy) this.say('READY!', YELLOW, 1.4); break;
        case 'eatGhost':
          if (s) this.snap(s, f.cell);
          fx.text(x, y - 6, String(f.pts), '#00ffff', f.pts >= 1600 ? 30 : 20, 1.3);
          if (!busy) fx.ring(x, y, 4, this.lay.cs, 'rgba(0,255,255,0.8)', 0.4);
          tone(220, 0.3, 0.07, 'square', 1500);
          break;
        case 'power':
          if (s && !busy) fx.ring(...this.at(s.x, s.y), 6, this.lay.cs * 2.2, 'rgba(255,230,0,0.9)', 0.5, 4);
          tone(130, 0.5, 0.06, 'sawtooth', 260);
          break;
        case 'fruitEat':
          fx.text(x, y - 6, String(f.pts), '#ffb8ff', 20, 1.4);
          tone(700, 0.18, 0.07, 'square', 1400);
          break;
        case 'clear': this.flash = busy ? 0 : 1.6; break; // 过关：迷宫闪白
        case 'roundEnd': if (!busy && f.reason === 'caught') this.say('GAME OVER', '#ff2020', 2.2); break;
        default: if (!busy) this.blurb(f);
      }
    }
  }

  blurb(f) {
    if (SIGN[f.type]) {
      const [text, color, where] = SIGN[f.type](f);
      const c = where === 'door' ? this.M.door : this.M.fruit;
      return this.fx.text(...this.at(c % this.M.w, ((c / this.M.w) | 0) - 0.8), text, color, 15, 1.4);
    }
    if (!BLURB[f.type]) return;
    const [text, color] = BLURB[f.type](f);
    for (const s of (f.ids || [f.id]).map((id) => this.sprites.get(id)).filter(Boolean)) this.fx.text(...this.at(s.x, s.y - 0.8), text, color, 14, 1.2);
    if (f.type === 'bonk' && this.app.sfx.ok()) this.app.sfx.tone(140, 0.12, 0.08, 'square', 70);
  }

  update(dt, R) {
    this.fx.update(dt);
    for (const [sid, l] of this.labels) if ((l.life -= dt) <= 0) this.labels.delete(sid);
    this.dying = this.dying.filter((d) => (d.t += dt) < d.dur);
    if (this.splash.length && (this.splash[0].life -= dt) <= 0) this.splash.shift();
    this.flash = Math.max(0, this.flash - dt);
    if (!R.M) return;
    if (R.M !== this.M) this.rebuild(R);
    const alive = new Set();
    for (const c of R.pacs) alive.add(c.id) && this.follow(this.sprite(c.id, c.cell), c.cell, dt, 1);
    for (const g of R.ghosts) alive.add(g.id) && this.follow(this.sprite(g.id, g.cell), g.cell, dt, g.state === 'eyes' ? 2.5 : 1);
    for (const id of this.sprites.keys()) if (!alive.has(id)) this.sprites.delete(id);
  }

  /** 平滑地一格一格走过去：落后越多走得越快；隧道两头直接从另一边钻出来。 */
  follow(s, cell, dt, speed) {
    if (!s) return;
    const w = this.M.w;
    s.hide = Math.max(0, s.hide - dt);
    s.moving = Math.max(0, s.moving - dt);
    if (s.q.length > 30) this.snap(s, s.q[s.q.length - 1]);
    if (!s.q.length && s.cell !== cell) s.q.push(cell);
    let budget = dt * speed * (5 + s.q.length * 2.5);
    while (budget > 0 && s.q.length) {
      const t = s.q[0];
      const [tx, ty] = [t % w, (t / w) | 0];
      if (Math.abs(tx - s.x) > w / 2) s.x += tx > s.x ? w : -w;
      const [dx, dy] = [tx - s.x, ty - s.y];
      const d = Math.hypot(dx, dy);
      if (d > 2.5) { this.snap(s, t); continue; } // 不相邻：被传送了
      if (d > 0.01) s.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : dy > 0 ? 2 : 0;
      s.moving = 0.12;
      if (d > budget) { [s.x, s.y] = [s.x + (dx / d) * budget, s.y + (dy / d) * budget]; break; }
      Object.assign(s, { x: tx, y: ty, cell: t });
      budget -= d;
      s.q.shift();
      if (this.pending.get(t) === s.id) this.pending.delete(t), this.wakka();
    }
    if (s.moving > 0) s.mouth += dt * 14;
  }

  wakka() {
    if (this.app.sfx.ok()) this.wk ^= 1, this.app.sfx.tone(this.wk ? 480 : 260, 0.07, 0.05, 'triangle', this.wk ? 260 : 480);
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (!R.M) return;
    if (R.M !== this.M) this.rebuild(R);
    const M = this.M;
    const { cs, x0, y0 } = this.lay;
    g.drawImage(layers[this.flash > 0 && Math.floor(this.flash * 6) % 2 === 0 ? `${M.key}:w` : M.key], 0, 0, W, H);

    // 豆子和闪烁的能量豆
    const blink = Math.floor(rt * 3.3) % 2 === 0;
    g.fillStyle = '#ffb8ae';
    for (let i = 0; i < M.n; i++) {
      const k = R.dots[i] || (this.pending.has(i) ? M.dots[i] : 0);
      const [x, y] = k ? this.atCell(i) : [];
      if (k === 1) g.fillRect(x - cs * 0.09, y - cs * 0.09, cs * 0.18, cs * 0.18);
      else if (k === 2 && blink) g.beginPath(), g.arc(x, y, cs * 0.3, 0, TAU), g.fill();
    }
    if (R.fruit) emoji(g, R.fruit.e, ...this.atCell(R.fruit.cell), cs * 0.85);

    // 角色（裁在迷宫里，隧道两头才像钻进去）
    g.save();
    g.beginPath(), g.rect(x0, y0, M.w * cs, M.h * cs), g.clip();
    const flashBlue = R.power > 0 && R.power <= 2 && Math.floor(rt * 5) % 2 === 0;
    const crowd = new Map(); // 几只鬼挤在同一格时错开一点，不然看着像一只
    for (const gh of R.ghosts) {
      const s = this.sprites.get(gh.id);
      if (!s) continue;
      const key = `${Math.round(s.x * 2)},${Math.round(s.y * 2)}`;
      const k = crowd.get(key) || 0;
      crowd.set(key, k + 1);
      const bob = gh.state === 'house' && !s.moving ? Math.sin(rt * 7 + gh.i) * cs * 0.15 : 0; // 鬼屋里上下晃
      const [x, y] = this.at(s.x + k * 0.22, s.y - k * 0.12);
      const look = gh.state === 'eyes' ? 'eyes' : gh.fright ? (flashBlue ? 'white' : 'blue') : 'normal';
      drawGhost(g, x, y + bob, cs * 0.46, GHOST_COLOR[Math.min(gh.i, 4)], s.dir, rt + gh.i * 0.3, look);
    }
    for (const c of R.pacs) {
      const s = this.sprites.get(c.id);
      if (s && !(s.hide > 0)) drawPac(g, ...this.at(s.x, s.y), cs * 0.45, s.dir, s.moving > 0 ? 0.05 + Math.abs(Math.sin(s.mouth)) * 0.75 : 0.45, c.n);
    }
    // 死亡动画：嘴越张越大，整个瘪掉，最后啪一下
    for (const d of this.dying) {
      const k = d.t / d.dur;
      const m = 0.1 + (k / 0.8) * (Math.PI - 0.1);
      Object.assign(g, { fillStyle: YELLOW, strokeStyle: YELLOW, lineWidth: 2 });
      g.beginPath();
      if (k < 0.8) g.moveTo(d.x, d.y), g.arc(d.x, d.y, cs * 0.45, -Math.PI / 2 + m, -Math.PI / 2 + TAU - m), g.closePath(), g.fill();
      else {
        for (let i = 0; i < 8; i++) {
          const [cx, cy] = [Math.cos((i / 8) * TAU) * cs, Math.sin((i / 8) * TAU) * cs];
          g.moveTo(d.x + cx * 0.2, d.y + cy * 0.2), g.lineTo(d.x + cx * 0.45, d.y + cy * 0.45);
        }
        g.stroke();
      }
    }
    g.restore();
    this.fx.renderOver(g, scale);
    this.tags(g, R, scale, rt);
    this.band(g, R, scale, rt);

    // READY! / GAME OVER 写在鬼屋下面（原版的位置）
    const sp = this.splash[0];
    if (!sp) return;
    Object.assign(g, { font: `900 ${Math.max(cs * 0.9, fontFor(scale, 22))}px "Courier New", monospace`, textAlign: 'center', textBaseline: 'middle', fillStyle: sp.color });
    g.fillText(sp.text, ...this.atCell(M.fruit));
  }

  /** 名字牌和动作气泡：吃豆人跟着自己的吃豆人，鬼方的会话跟着它操控的第一只鬼。 */
  tags(g, R, scale, rt) {
    const fs = fontFor(scale, 11);
    const cs = this.lay.cs;
    const anchor = new Map();
    for (const c of R.pacs) {
      const s = this.sprites.get(c.id);
      if (s && !s.hide) anchor.set(c.sid, this.at(s.x, s.y));
    }
    for (const gh of R.ghosts) {
      const [p, s] = [R.ctrl(gh), this.sprites.get(gh.id)];
      if (!p || !s) continue;
      const [x, y] = this.at(s.x, s.y);
      // 一个会话只在它的第一只鬼下面写全名，其它鬼只写鬼名；鬼屋里并排的鬼名字牌上下错开
      const head = !anchor.has(p.sid);
      if (head) anchor.set(p.sid, [x, y]);
      g.globalAlpha = gh.state === 'house' ? 0.6 : 0.85;
      pill(g, x, y + cs * 0.78 + (gh.state === 'house' && gh.i % 2 ? fs * 1.4 : 0), head ? `${ghostName(gh.i)} · ${p.name}` : ghostName(gh.i), { color: COLOR[p.team], size: fs - 1, max: head ? 120 : 60 });
      g.globalAlpha = 1;
    }
    for (const c of R.pacs) {
      const [p, a] = [R.players.get(c.sid), anchor.get(c.sid)];
      if (p && a) pill(g, a[0], a[1] + cs * 0.78, p.name, { color: COLOR[p.team], size: fs, max: 130 });
    }
    for (const [sid, [x, y]] of anchor) {
      const [p, l] = [R.players.get(sid), this.labels.get(sid)];
      if (l) {
        g.globalAlpha = Math.min(1, l.life / 0.4);
        pill(g, x, y - cs * 0.85 - (1.7 - l.life) * 6, l.text, { size: fs, max: 190, weight: 500, bg: l.ok ? 'rgba(10,12,16,0.8)' : 'rgba(120,20,20,0.85)' });
      }
      if (p && R.waiting(p)) {
        const k = (rt * 0.7) % 1;
        Object.assign(g, { globalAlpha: 1 - k, font: `700 ${fs + 4}px ${FONT}`, textAlign: 'center', fillStyle: '#fff' });
        g.fillText(p.team === R.pacTeam ? '⏳' : 'z', x + cs * 0.5 + k * 6, y - cs * 0.5 - k * 14);
      }
      g.globalAlpha = 1;
    }
  }

  /** 顶上一排：左边吃豆方和剩几条命，中间 1UP / 最高分，右边鬼方和它的鬼。 */
  band(g, R, scale, rt) {
    const fs = fontFor(scale, 13);
    Object.assign(g, { textBaseline: 'middle', font: `900 ${fontFor(scale, 19)}px ${FONT}`, textAlign: 'left', fillStyle: COLOR[R.pacTeam] });
    g.fillText(`${TEAM_NAME[R.pacTeam]}${L(' · 吃豆人', ' · Pac-Man')}`, 40, 96);
    for (let i = 0; i < Math.min(R.lives, 8); i++) drawPac(g, 52 + i * 30, 128, 11, 1, 0.5, -1);
    Object.assign(g, { textAlign: 'right', fillStyle: COLOR[R.ghostTeam] });
    g.fillText(`${TEAM_NAME[R.ghostTeam]}${L(' · 鬼', ' · Ghosts')}`, W - 40, 96);
    R.ghosts.forEach((gh, i) => drawGhost(g, W - 52 - (R.ghosts.length - 1 - i) * 32, 128, 11, GHOST_COLOR[Math.min(gh.i, 4)], 1, rt, gh.state === 'eyes' ? 'eyes' : gh.fright ? 'blue' : 'normal'));
    // 中间：街机分数板
    const mono = (size) => `900 ${size}px "Courier New", monospace`;
    Object.assign(g, { textAlign: 'center', font: mono(fs), fillStyle: '#fff' });
    if (Math.floor(rt * 2.5) % 2 === 0) g.fillText('1UP', W / 2 - 170, 90);
    g.fillText(L('最高分', 'HIGH SCORE'), W / 2, 90);
    g.font = mono(fontFor(scale, 17));
    g.fillText(String(R.points || '00'), W / 2 - 170, 114);
    g.fillText(String(R.hi || '00'), W / 2, 114);
    pill(g, W / 2 + 200, 102, L(`剩 ${R.dotsLeft} 颗豆`, `${R.dotsLeft} dots left`), { size: fs, max: 200, bg: 'rgba(33,33,222,0.35)' });
    R.fruits.slice(-6).forEach((e, i) => emoji(g, e, W / 2 + 140 + i * 22, 134, 16));
    if (R.power <= 0) return;
    g.fillStyle = 'rgba(33,33,255,0.85)'; // 能量豆还剩多久
    g.fillRect(W / 2 - 110, 136, 220 * (R.power / R.powerMax), 6);
  }

  hud(R) {
    if (R.phase !== 'live' || !R.M) return null;
    return {
      mid: L(`第 ${R.round} 局`, `Game ${R.round}`),
      sub: L(`剩 ${R.dotsLeft} 颗豆 · ${TEAM_NAME[R.pacTeam]} 吃豆`, `${R.dotsLeft} dots · ${TEAM_NAME[R.pacTeam]} = Pac`),
      pips: { [R.pacTeam]: Array.from({ length: Math.min(R.livesMax, 8) }, (_, i) => i < R.lives), [R.ghostTeam]: R.ghosts.map((gh) => gh.state !== 'eyes') },
    };
  }
}
