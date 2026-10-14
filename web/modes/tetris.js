// 俄罗斯方块对战：每个动作往自己队的井里落一块，AI 自动摆放。消行给对面送垃圾行，先堆到顶的输。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, ACTIONS, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, rand, pill, fitText, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'tetris',
  icon: '🧱',
  get name() { return L('俄罗斯方块对战', 'Tetris Battle'); },
  get desc() { return L('每个动作落一块方块，消行给对面送垃圾行，先堆到顶的输', 'Every action drops a piece. Clear lines to send garbage; first to top out loses'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('⏳ {a} 在等你回复', '⏳ {a} is waiting for you'),
      sub: L('40 秒内回它，不然井底涌上 4 行垃圾', 'Reply within 40s or 4 garbage rows rise'),
      done: L('✅ 及时回复，消掉一行垃圾', '✅ Quick reply: one garbage row cleared'),
      boom: L('💥 {a} 等太久，涌上 4 行垃圾', '💥 {a} waited too long: +4 garbage rows'),
    };
  },
  get legend() {
    return [
      [L('🧱 任何动作', '🧱 Any action'), L('往自己队的井里落一块', 'Drops a piece into your team’s well')],
      [L('🧹 一次消 2 / 3 / 4 行', '🧹 Clear 2 / 3 / 4 lines'), L('给对面送 1 / 2 / 4 行垃圾', 'Sends 1 / 2 / 4 garbage rows')],
      [L('🔥 连续消行', '🔥 Consecutive clears'), L('连击，多送垃圾', 'Combo: extra garbage')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('T-SPIN！多送 2 行', 'T-SPIN! +2 rows')],
      [L('✅ 任务完成', '✅ Task done'), L('TETRIS！自己消 2 行，再送对面 4 行', 'TETRIS! Clear 2 of yours, send 4')],
      [L('🐛 命令报错', '🐛 Command error'), L('自己井底涌上一行 Bug', 'A Bug row rises in your own well')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('帮手：送来最合适的那块', 'Helper: the perfect piece')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('记忆被闪，下一块乱放', 'Flashbanged: next piece lands randomly')],
      [L('✋ 被打断', '✋ Interrupted'), L('方块被打乱，涌上 3 行', 'Stack scrambled: +3 rows')],
      [L('💬 收到新指令', '💬 New prompt'), L('消掉一行垃圾', 'Clears one garbage row')],
      [L('⏳ 它在等你', '⏳ Waiting for you'), L('40 秒不回，涌上 4 行', 'No reply in 40s: +4 rows')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('PR 消除：底部 4 行清空', 'PR Clear: bottom 4 rows wiped')],
    ];
  },
};

// ================================================================ 方块

const COLS = 10;
const ROWS = 20;
const FULL = (1 << COLS) - 1;
const T = 3;
const GARBAGE = 8;
const BUG = 9;
const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']; // 格子编号 1..7，8 = 垃圾，9 = Bug
const SHAPES = { I: ['####'], O: ['##', '##'], T: ['.#.', '###'], S: ['.##', '##.'], Z: ['##.', '.##'], J: ['#..', '###'], L: ['..#', '###'] };
const LINE_SEND = [0, 0, 1, 2, 4];
const COMBO_SEND = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
const DANGER = 14; // 堆到这么高就喊「危险」（预埋得多就再往上提）
const MAX_SEND = 6; // 一次最多送这么多行
const MAX_PENDING = 12; // 来袭槽最多攒这么多

// 一种方块的所有朝向。cells 是 [dx, dy]（y 朝上），bot 是每列最低格，masks 是每行的位图
function buildRots(lines) {
  let cells = [];
  lines.forEach((line, i) => [...line].forEach((ch, x) => ch === '#' && cells.push([x, lines.length - 1 - i])));
  const out = new Map();
  for (let k = 0; k < 4; k++, cells = cells.map(([x, y]) => [y, -x])) {
    const [mx, my] = [Math.min(...cells.map((c) => c[0])), Math.min(...cells.map((c) => c[1]))];
    const norm = cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const key = norm.join(';');
    if (out.has(key)) continue;
    const [w, h] = [Math.max(...norm.map((c) => c[0])) + 1, Math.max(...norm.map((c) => c[1])) + 1];
    const [bot, masks] = [Array(w).fill(9), Array(h).fill(0)];
    for (const [x, y] of norm) [bot[x], masks[y]] = [Math.min(bot[x], y), masks[y] | (1 << x)];
    out.set(key, { cells: norm, w, h, bot, masks });
  }
  return [...out.values()];
}
const ROTS = KINDS.map((k) => buildRots(SHAPES[k]));

// ---------------------------------------------------------------- 井的格子（一维数组，第 0 行在最底下）

function masksOf(grid) {
  const m = new Int32Array(ROWS);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y * COLS + x]) m[y] |= 1 << x;
  return m;
}

function stackHeight(grid) {
  for (let y = ROWS - 1; y >= 0; y--) for (let x = 0; x < COLS; x++) if (grid[y * COLS + x]) return y + 1;
  return 0;
}

function removeRows(grid, rows) {
  let to = 0;
  for (let y = 0; y < ROWS; y++) {
    if (rows.includes(y)) continue;
    if (to !== y) grid.copyWithin(to * COLS, y * COLS, y * COLS + COLS);
    to++;
  }
  grid.fill(0, to * COLS);
}

/** 井底涌上 n 行，第 y 行在 holes[y] 留个洞。顶上被挤出去就算堆到顶，返回 true。 */
function addRows(grid, n, holes, cell) {
  const over = grid.subarray((ROWS - n) * COLS).some((c) => c);
  grid.copyWithin(n * COLS, 0, (ROWS - n) * COLS);
  for (let y = 0; y < n; y++) for (let x = 0; x < COLS; x++) grid[y * COLS + x] = x === holes[y] ? 0 : cell;
  return over;
}

// ---------------------------------------------------------------- 摆放 AI
// 每个朝向 × 每一列都试一遍，给局面打分取最高的。平时留最矮的一列当「井」攒 TETRIS，
// 1～3 行的小消除算浪费；堆高了（算上来袭的垃圾）就切成保命模式，能消就消。

const AI = { agg: 0.1, holes: 6, bump: 0.35, wells: 1, mid: 0.5, tall: 0.3, calm: 9, land: 0.2, panic: 13, save: 3, tetris: 10, burn: -1.5 };
const SCRATCH = new Int32Array(ROWS);
const HEIGHTS = new Int32Array(COLS);
const POP = Uint8Array.from({ length: 1 << COLS }, (_, v) => v.toString(2).replace(/0/g, '').length); // 位图里几个 1

function moves(grid, type) {
  const m = masksOf(grid);
  const h = new Int32Array(COLS);
  for (let y = 0; y < ROWS; y++) for (let x = 0, v = m[y]; v; x++, v >>= 1) if (v & 1) h[x] = y + 1;
  const out = [];
  ROTS[type - 1].forEach((rot, ri) => {
    for (let x = 0; x <= COLS - rot.w; x++) {
      let y = 0;
      for (let c = 0; c < rot.w; c++) y = Math.max(y, h[x + c] - rot.bot[c]);
      if (y + rot.h <= ROWS) out.push({ ri, x, y, score: 0 });
    }
  });
  return { m, out };
}

function scoreMove(m, rot, x, y, extra) {
  // 先放进去、把满行拿掉
  let lines = 0;
  let n = 0;
  for (let yy = 0; yy < ROWS; yy++) {
    const dy = yy - y;
    const v = dy >= 0 && dy < rot.h ? m[yy] | (rot.masks[dy] << x) : m[yy];
    if (v === FULL) lines++;
    else SCRATCH[n++] = v;
  }
  // 从上往下扫一遍：某列第一次出现方块就是它的高度，上面盖着东西的空格就是空洞
  HEIGHTS.fill(0);
  let covered = 0;
  let holes = 0;
  for (let yy = n - 1; yy >= 0; yy--) {
    const v = SCRATCH[yy];
    for (let cx = 0, top = v & ~covered; top; cx++, top >>= 1) if (top & 1) HEIGHTS[cx] = yy + 1;
    covered |= v;
    holes += POP[covered & ~v];
  }
  let agg = 0;
  let maxH = 0;
  for (let cx = 0; cx < COLS; cx++) {
    agg += HEIGHTS[cx];
    if (HEIGHTS[cx] > maxH) maxH = HEIGHTS[cx];
  }
  // 最矮的一列当井（一样矮取最右边），凹凸不算它；别处再有深坑要扣分
  let wc = COLS - 1;
  for (let cx = COLS - 2; cx >= 0; cx--) if (HEIGHTS[cx] < HEIGHTS[wc]) wc = cx;
  let bump = 0;
  let wells = 0;
  let prev = -1;
  for (let cx = 0; cx < COLS; cx++) {
    if (cx === wc) continue;
    if (prev >= 0) bump += Math.abs(HEIGHTS[cx] - prev);
    prev = HEIGHTS[cx];
    const d = Math.min(cx > 0 ? HEIGHTS[cx - 1] : 99, cx < COLS - 1 ? HEIGHTS[cx + 1] : 99) - HEIGHTS[cx];
    if (d >= 2) wells += d - 1;
  }
  const lineScore = maxH + extra >= AI.panic ? lines * AI.save : lines === 4 ? AI.tetris : lines * AI.burn;
  const tall = Math.max(0, maxH + extra - AI.calm);
  return lineScore - AI.agg * agg - AI.holes * holes - AI.bump * bump - AI.wells * wells - AI.tall * tall * tall - AI.land * y
    - (wc === 0 || wc === COLS - 1 ? 0 : AI.mid);
}

/** extra = 已经在路上的垃圾行，算进高度里，快被淹了就保命。 */
function bestMove(grid, type, extra = 0) {
  const { m, out } = moves(grid, type);
  let best = null;
  for (const mv of out) {
    mv.score = scoreMove(m, ROTS[type - 1][mv.ri], mv.x, mv.y, extra);
    if (!best || mv.score > best.score) best = mv;
  }
  return best;
}

/** 帮手：七种方块里挑一块摆进去最舒服的。 */
function bestFit(grid, extra) {
  let best = null;
  for (let type = 1; type <= 7; type++) {
    const mv = bestMove(grid, type, extra);
    if (mv && (!best || mv.score > best.mv.score)) best = { type, mv };
  }
  return best;
}

// ---------------------------------------------------------------- 一口井

function draw(w) {
  if (!w.bag.length) {
    w.bag = [1, 2, 3, 4, 5, 6, 7];
    for (let i = 6; i > 0; i--) {
      const j = Math.floor(w.rnd() * (i + 1));
      [w.bag[i], w.bag[j]] = [w.bag[j], w.bag[i]];
    }
  }
  return w.bag.pop();
}

function newWell(team, round, prefill) {
  const w = {
    team, grid: new Uint8Array(COLS * ROWS), bag: [], rnd: rng(hash(team + round)), grnd: rng(hash(`\u5783\u573e${team}${round}`)),
    next: 0, pending: 0, pendingT: 0, frac: 0, lines: 0, sent: 0, combo: -1, b2b: false, blind: 0, danger: false, dead: false, last: null,
  };
  w.next = draw(w);
  // 开局预埋的垃圾行：两边一模一样，两三行一组共用一个洞，挖得开
  // 种子字符串就是「预埋」「垃圾」，写成转义只是为了不被当成界面文字；和语言无关
  const r = rng(hash(`\u9884\u57cb${round}`));
  const holes = [];
  for (let i = 0, col = 0; i < prefill; i++) {
    if (i % 3 === 0 || r() < 0.25) col = Math.floor(r() * COLS);
    holes.push(col);
  }
  if (prefill) addRows(w.grid, prefill, holes, GARBAGE);
  return w;
}

const snap = (wells) => ({ claude: wells.claude.grid.slice(), codex: wells.codex.grid.slice() });

// ================================================================ 规则

export class Rules extends Base {
  static defaults = {
    roundLen: 10 * 60e3, tideEvery: 20e3, prefill: 5, attack: 1.5,
    partyRoundLen: 3 * 60e3, partyTideEvery: 8e3, partyPrefill: 13, partyAttack: 1.8,
    garbageDelay: 15e3,
  };

  init() {
    const o = this.opts;
    this.roundLen = o.party ? o.partyRoundLen : o.roundLen;
    this.tideEvery = o.party ? o.partyTideEvery : o.tideEvery;
    this.prefill = o.party ? o.partyPrefill : o.prefill;
    this.attack = o.party ? o.partyAttack : o.attack;
    this.dangerAt = Math.max(DANGER, this.prefill + 4);
    this.tide = 0;
    this.wells = { claude: newWell('claude', 0, 0), codex: newWell('codex', 0, 0) };
  }

  initPlayer(p) {
    Object.assign(p, { pieces: 0, tetris: 0 });
  }

  // 人不够回到热身：堆死的井清空，热身时接着练手
  onPause(fx) {
    if (!TEAMS.some((t) => this.wells[t].dead)) return;
    for (const team of TEAMS) if (this.wells[team].dead) this.wells[team] = newWell(team, this.round, 0);
    fx.push({ type: 'wells', grids: snap(this.wells) });
  }

  onRoundStart(fx) {
    this.tide = 0;
    for (const team of TEAMS) this.wells[team] = newWell(team, this.round, this.prefill);
    fx.push({ type: 'wells', grids: snap(this.wells) });
  }

  onEvent(p, ev, r, fx) {
    const w = this.wells[p.team];
    if (w.dead) return;
    if (ACTIONS.has(ev.k)) this.drop(p, w, ev, r, fx);
    if (ev.k === 'compact') {
      w.blind = 1; // 记忆被闪：下一块乱放
      fx.push({ type: 'blind', team: p.team, sid: p.sid });
    } else if (ev.k === 'abort') {
      this.rise(w, 3, GARBAGE, true, 'abort', fx);
      fx.push({ type: 'note', text: L('✋ 你打断了 {0}，方块被打乱了', '✋ You interrupted {0} and scrambled the stack'), sids: [p.sid] });
    } else if (ev.k === 'done') this.tetrisBonus(p, w, fx);
    else if (ev.k === 'prompt') this.helpRow(w, 'prompt', fx);
    else if (ev.k === 'apierr') this.rise(w, 1, GARBAGE, false, 'net', fx);
    else if (ev.k === 'pr') this.cut(w, [0, 1, 2, 3], 'pr', fx);
    this.dangerCheck(w, fx);
  }

  /** 落一块：先决定是哪块、怎么摆，再算消行和垃圾。 */
  drop(p, w, ev, r, fx) {
    const live = this.phase === 'live';
    let type = w.next;
    let how = 'ai';
    let mv = null;
    const fit = ev.k === 'agent' && bestFit(w.grid, w.pending);
    if (ev.k === 'shell' && ev.hs) [type, how] = [T, 'tspin'];
    else if (fit) [type, mv, how] = [fit.type, fit.mv, 'helper'];
    else w.next = draw(w);
    if (w.blind > 0) {
      // 记忆被闪：随便找个位置扔下去
      w.blind--;
      const { out } = moves(w.grid, type);
      [mv, how] = [out.length ? out[Math.floor(r() * out.length)] : null, 'blind'];
    } else if (!mv) mv = bestMove(w.grid, type, w.pending);
    if (!mv) return this.topout(w, fx);
    const pre = w.grid.slice();
    const cells = ROTS[type - 1][mv.ri].cells.map(([dx, dy]) => [mv.x + dx, mv.y + dy]);
    for (const [x, y] of cells) w.grid[y * COLS + x] = type;
    const cleared = [];
    const m = masksOf(w.grid);
    for (let y = 0; y < ROWS; y++) if (m[y] === FULL) cleared.push(y);
    removeRows(w.grid, cleared);
    const lines = cleared.length;
    const tspin = how === 'tspin';
    const hard = tspin || lines === 4;
    const b2b = hard && w.b2b;
    if (hard || lines) w.b2b = hard;
    w.combo = lines ? w.combo + 1 : -1;
    w.lines += lines;
    w.last = { sid: p.sid, ev, cells };
    if (live) {
      p.pieces++;
      p.dmg += lines;
      if (tspin) p.hs++;
      if (lines === 4) p.tetris++;
      if (how === 'helper') p.a++;
    }
    fx.push({ type: 'drop', team: p.team, sid: p.sid, ev, kind: type, cells, cleared, pre, post: w.grid.slice(), how, combo: w.combo, b2b });
    if (live && lines === 4) fx.push({ type: 'announce', text: 'TETRIS!', sub: L(`${p.name} 一口气消 4 行`, `${p.name} cleared 4 at once`), cls: 'gold', ms: 1500 });
    else if (live && tspin) fx.push({ type: 'announce', text: 'T-SPIN!', sub: L(`${p.name} 测试通过，多送 2 行`, `${p.name}: tests pass, +2 rows`), cls: p.team, ms: 1300 });
    if (live && b2b) fx.push({ type: 'announce', text: 'Back-to-Back', sub: L(`${TEAM_NAME[p.team]} 连续大招，再加 1 行`, `${TEAM_NAME[p.team]} chains another, +1 row`), cls: 'gold', ms: 1300 });
    const out = LINE_SEND[lines] + (lines ? COMBO_SEND[Math.min(w.combo, COMBO_SEND.length - 1)] : 0) + (tspin ? 2 : 0) + (b2b ? 1 : 0);
    if (out) this.send(p, w, out, fx);
    if (!lines) this.receive(w, fx);
    if (ev.ok === false) this.rise(w, 1, BUG, false, 'bug', fx);
  }

  /** 送垃圾：按均衡火力缩放，零头攒着；先抵消自己这边攒着的，剩下的进对面的「来袭」槽。 */
  send(p, w, amount, fx) {
    if (this.phase !== 'live') return;
    // 均衡火力夹在 0.3～3 倍之间：人少的队一个「任务完成」不至于直接把对面淹死
    w.frac += amount * this.attack * clamp(this.balanceMult(p.team), 0.3, 3);
    let n = Math.min(MAX_SEND, Math.floor(w.frac + 1e-9));
    if (n <= 0) return;
    w.frac = Math.min(w.frac - n, 1);
    p.k += n;
    w.sent += n;
    const cancel = Math.min(n, w.pending);
    [w.pending, n] = [w.pending - cancel, n - cancel];
    const foe = this.wells[OTHER[p.team]];
    if (n > 0 && !foe.pending) foe.pendingT = this.now;
    if (n > 0) foe.pending = Math.min(MAX_PENDING, foe.pending + n);
    fx.push({ type: 'send', from: p.team, to: OTHER[p.team], sid: p.sid, n, cancel });
  }

  /** 攒着的垃圾行涌上来（一次最多 8 行）。at = 这一波算在哪个时刻，剩下的从这时起重新计时。 */
  receive(w, fx, at = this.now) {
    const n = Math.min(8, w.pending);
    [w.pending, w.pendingT] = [w.pending - n, at];
    this.rise(w, n, GARBAGE, false, 'attack', fx);
  }

  /** 井底涌上 n 行。messy = 每行的洞各不相同（更难挖）。 */
  rise(w, n, cell, messy, why, fx) {
    if (w.dead || n <= 0) return;
    n = Math.min(n, ROWS);
    const col = Math.floor(w.grnd() * COLS);
    const holes = Array.from({ length: n }, () => (messy ? Math.floor(w.grnd() * COLS) : col));
    const pre = w.grid.slice();
    const over = addRows(w.grid, n, holes, cell);
    w.combo = -1;
    fx.push({ type: 'rise', team: w.team, n, why, pre, post: w.grid.slice() });
    if (over) this.topout(w, fx);
  }

  /** 直接清掉几行（PR、任务完成、新指令）。 */
  cut(w, rows, why, fx) {
    const pre = w.grid.slice();
    removeRows(w.grid, rows);
    fx.push({ type: 'cut', team: w.team, rows, why, pre, post: w.grid.slice() });
  }

  /** 消掉最底下那行垃圾；没有垃圾就抵消一行来袭的。 */
  helpRow(w, why, fx) {
    for (let y = 0; y < ROWS; y++) if (w.grid.subarray(y * COLS, y * COLS + COLS).some((c) => c >= GARBAGE)) return this.cut(w, [y], why, fx);
    if (!w.pending) return;
    w.pending--;
    fx.push({ type: 'send', from: w.team, to: OTHER[w.team], n: 0, cancel: 1 });
  }

  /** 任务完成 = TETRIS：自己底部消 2 行，再给对面送 4 行。 */
  tetrisBonus(p, w, fx) {
    this.cut(w, [0, 1], 'done', fx);
    const b2b = w.b2b;
    w.b2b = true;
    if (this.phase === 'live') {
      p.tetris++;
      fx.push({ type: 'announce', text: 'TETRIS!', sub: L(`${p.name} 任务完成 · 送对面 4 行`, `${p.name} task done · 4 rows sent`), cls: 'gold', ms: 1400 });
      if (b2b) fx.push({ type: 'announce', text: 'Back-to-Back', sub: L(`${TEAM_NAME[p.team]} 连续大招，再加 1 行`, `${TEAM_NAME[p.team]} chains another, +1 row`), cls: 'gold', ms: 1300 });
    }
    this.send(p, w, 4 + (b2b ? 1 : 0), fx);
  }

  topout(w, fx) {
    if (this.phase === 'live') {
      if (!w.dead) fx.push({ type: 'topout', team: w.team, grid: w.grid.slice() });
      w.dead = true;
      return;
    }
    // 热身时堆满了就清空重来，不算输赢
    [w.pending, w.danger] = [0, false];
    fx.push({ type: 'wipe', team: w.team, post: w.grid.fill(0).slice() });
  }

  dangerCheck(w, fx) {
    if (w.dead) return;
    const h = stackHeight(w.grid) + w.pending;
    if (!w.danger && h >= this.dangerAt) {
      w.danger = true;
      if (this.phase === 'live') fx.push({ type: 'announce', text: L('危险！', 'Danger!'), sub: L(`${TEAM_NAME[w.team]} 快堆到顶了`, `${TEAM_NAME[w.team]} is about to top out`), cls: 'bad', ms: 1200 });
    } else if (w.danger && h <= this.dangerAt - 4) w.danger = false;
  }

  // 它在等你：及时回 = 消一行垃圾；超时 = 涌上 4 行
  onAnswer(p, wait, fx) {
    this.helpRow(this.wells[p.team], 'answer', fx);
  }

  onWaitTimeout(p, fx) {
    this.rise(this.wells[p.team], 4, GARBAGE, false, 'timeout', fx);
    this.dangerCheck(this.wells[p.team], fx);
  }

  /** 自己的定时器：来袭垃圾到点涌上来、下一次涨潮、最后的时间线。底座会让时钟准点停在这些时刻。 */
  timers() {
    const out = [this.roundStart + this.roundLen * 2, this.roundStart + this.roundLen + this.tide * this.tideEvery];
    for (const w of Object.values(this.wells)) if (w.pending && !w.dead) out.push(w.pendingT + this.opts.garbageDelay);
    return out;
  }

  // 到点的定时器按「该发生的时刻」结算，不看现在几点，所以时钟推进得多勤都打出一样的结果
  onTick(fx) {
    for (const w of Object.values(this.wells)) {
      const due = w.pendingT + this.opts.garbageDelay;
      if (w.pending && !w.dead && this.now >= due) {
        this.receive(w, fx, due);
        this.dangerCheck(w, fx);
      }
    }
    if (this.now >= this.roundStart + this.roundLen * 2) return this.endRound(this.leader(), 'time', fx, L('时间到 · 堆得低的赢', 'Time’s up · lower stack wins'));
    // 拖太久就涨潮：两边井底一起涨，每 tideEvery 一行，谁先顶到头谁输
    while (this.tide < ROWS && this.now >= this.roundStart + this.roundLen + this.tide * this.tideEvery) {
      if (this.tide === 0) fx.push({ type: 'announce', text: L('涨潮了！', 'Rising tide!'), sub: L('两边井底一起往上涨', 'Both wells start rising'), cls: 'bad', ms: 1600 });
      this.tide++;
      for (const w of Object.values(this.wells)) {
        this.rise(w, 1, GARBAGE, false, 'tide', fx);
        this.dangerCheck(w, fx);
      }
    }
  }

  /** 两边都顶到头 / 时间到：堆得低的赢，一样高看消行。 */
  leader() {
    const [a, b] = TEAMS.map((t) => this.wells[t]);
    const [ha, hb] = [stackHeight(a.grid) + a.pending, stackHeight(b.grid) + b.pending];
    if (ha !== hb) return ha < hb ? 'claude' : 'codex';
    if (a.lines !== b.lines) return a.lines > b.lines ? 'claude' : 'codex';
    return null;
  }

  check(fx) {
    const dead = TEAMS.filter((t) => this.wells[t].dead);
    if (!dead.length) return;
    for (const p of this.field()) if (dead.includes(p.team)) p.d++;
    if (dead.length === 2) this.endRound(this.leader(), 'topout', fx, L('两边一起堆到顶了', 'Both sides topped out'));
    else this.endRound(OTHER[dead[0]], 'topout', fx, L('对面堆到顶了', 'The other side topped out'));
  }
}

// ================================================================ 画面
// 两口井居中，中间一个大 VS。规则层的每个效果都带着变化前后的整口井，画面只负责把变化演出来。

const { w: W, h: H } = WORLD;
const CELL = 36;
const WELL_W = COLS * CELL;
const WELL_H = ROWS * CELL;
const WELL_Y = 176;
const WELL_X = { claude: 800 - 150 - WELL_W, codex: 800 + 150 };
const BOTTOM = WELL_Y + WELL_H;
const FALL = 0.2;
const FLASH = 0.24;
const PIECE_COLOR = [null, '#2ad0ea', '#f8d23a', '#a65ee6', '#52d86a', '#ff5468', '#3f7ff5', '#ff9b30', '#666d7c', '#7f9f3a'];
const LINE_WORD = [null, null, 'DOUBLE', 'TRIPLE', 'TETRIS!'];
const riseText = (why) => ({
  bug: [L('🐛 Bug 行', '🐛 Bug row'), '#a6e05a'],
  abort: [L('✋ 方块被打乱 +3', '✋ You scrambled it +3'), '#ff8a8a'],
  timeout: [L('⏳ 等太久 +4', '⏳ Waited too long +4'), '#ff8a8a'],
  net: [L('📡 网络卡了 +1', '📡 Lag spike +1'), '#ff8a8a'],
})[why];
const cutText = (why) => ({
  pr: [L('🏆 PR 消除', '🏆 PR Clear'), '#ffd166'],
  done: ['TETRIS!', '#ffd166'],
  prompt: [L('💬 消一行', '💬 Row cleared'), '#9fd0ff'],
  answer: [L('✅ 及时回复', '✅ Quick reply'), '#6fd38b'],
})[why];
const ease = (k) => 1 - (1 - k) * (1 - k);
const rowY = (y) => WELL_Y + (ROWS - 1 - y) * CELL;
const meterX = (team) => (team === 'claude' ? WELL_X.claude + WELL_W + 12 : WELL_X.codex - 26);

function mix(a, b, k) {
  const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
  const ch = (s) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

function rr(g, x, y, w, h, r, fill) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
}

/** 线性渐变，颜色均匀分布。 */
function lin(g, x0, y0, x1, y1, ...stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

function txt(g, s, x, y, font, color, align = 'center') {
  g.font = `${font} ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

// 每种格子 × 每个队伍预先画好一张小图：经典配色 + 一圈淡淡的队伍色边
const SPRITES = {};
function sprite(team, type) {
  const key = team + type;
  if (SPRITES[key]) return SPRITES[key];
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 2;
  const g = c.getContext('2d');
  const [z, base] = [CELL, PIECE_COLOR[type]];
  g.scale(2, 2);
  rr(g, 0.5, 0.5, z - 1, z - 1, 6, mix(mix(COLOR[team], base, 0.45), '#000000', 0.25));
  rr(g, 2.5, 2.5, z - 5, z - 5, 4.5, lin(g, 0, 2, 0, z - 2, mix(base, '#ffffff', 0.3), base, mix(base, '#000000', 0.28)));
  rr(g, 6, 5, z - 12, 3.5, 2, 'rgba(255,255,255,0.4)');
  g.fillStyle = 'rgba(255,255,255,0.09)';
  g.fillRect(10, 11, z - 20, z - 21);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(6, z - 8, z - 12, 3);
  // Bug 行上点几个虫斑
  if (type === BUG) for (const [x, y, r] of [[12, 14, 3], [23, 13, 2.4], [18, 23, 3.2]]) rr(g, x - r, y - r, r * 2, r * 2, r, 'rgba(30,45,10,0.75)');
  return (SPRITES[key] = c);
}

/** 一口井的画面：显示中的格子 + 排队等着演的变化（落块、涌垃圾、清行）。 */
class WellView {
  constructor(team) {
    this.team = team;
    this.x = WELL_X[team];
    this.set(new Uint8Array(COLS * ROWS));
  }

  set(grid) {
    this.grid = grid.slice();
    this.queue = [];
    this.cur = null;
    this.label = null;
    this.flash = 0;
  }

  /** 排队演出。busy 就直接跳到结果；积压太多就把最早的几段跳过。返回是否要演。 */
  push(step, busy) {
    if (busy) {
      [this.queue, this.cur, this.grid] = [[], null, step.post];
      return false;
    }
    this.queue.push(step);
    while (this.queue.length > 3) [this.cur, this.grid] = [null, this.queue.shift().post];
    return true;
  }

  target() {
    return this.queue.length ? this.queue[this.queue.length - 1].post : this.cur ? this.cur.post : this.grid;
  }
}

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.wells = { claude: new WellView('claude'), codex: new WellView('codex') };
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    [this.shots, this.bigs, this.over, this.lastSid, this.meter] = [[], [], null, {}, {}];
    this.inflight = { claude: 0, codex: 0 };
    for (const team of TEAMS) {
      const w = R?.wells?.[team];
      this.wells[team].set(w ? w.grid : new Uint8Array(COLS * ROWS));
      this.meter[team] = w ? w.pending : 0;
      if (w?.last) this.label(R, this.wells[team], (this.lastSid[team] = w.last.sid), w.last.ev, w.last.cells, 1.2);
    }
  }

  /** 方块旁边的小牌子：谁落的、用的什么动作。 */
  label(R, wv, sid, ev, cells, life = 1.8) {
    const text = ev && actText(ev);
    if (!text) return;
    const name = R?.players.get(sid)?.name || this.app.nameOf?.(sid) || sid.slice(0, 6);
    let [x, y] = [wv.x + WELL_W / 2, WELL_Y + 60];
    if (cells) [x, y] = [wv.x + (cells.reduce((s, c) => s + c[0], 0) / cells.length + 0.5) * CELL, rowY(Math.max(...cells.map((c) => c[1]))) - 24];
    wv.label = { name, text, x: clamp(x, wv.x + 80, wv.x + WELL_W - 80), y: clamp(y, WELL_Y + 56, BOTTOM - 30), life, max: life, bad: ev.ok === false };
  }

  big(team, text, color, size = 46, dy = 0, life = 1.3) {
    if (this.bigs.length > 10) this.bigs.shift();
    this.bigs.push({ x: WELL_X[team] + WELL_W / 2, y: WELL_Y + WELL_H * 0.4 + dy, text, color, size, t: 0, life });
  }

  targets() {
    return { claude: this.wells.claude.target(), codex: this.wells.codex.target() };
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    const dur = busy ? 0.5 : 2.6;
    for (const f of list) {
      const wv = f.team ? this.wells[f.team] : null;
      switch (f.type) {
        case 'act': {
          // 落块的动作等方块落地再出牌子；任务完成、新指令这些直接在井口出
          const p = R.players.get(f.sid);
          if (!ACTIONS.has(f.ev.k) && f.ev.k !== 'think' && p?.onField) this.label(R, this.wells[p.team], f.sid, f.ev, null, 1.5);
          break;
        }
        case 'drop': {
          const mid = f.pre.slice();
          for (const [x, y] of f.cells) mid[y * COLS + x] = f.kind;
          const step = { ...f, kind: 'drop', type: f.kind, mid, rows: f.cleared, minY: Math.min(...f.cells.map((c) => c[1])), t: 0, dur: FALL + (f.cleared.length ? FLASH : 0) };
          this.lastSid[f.team] = f.sid;
          if (!wv.push(step, busy)) this.label(R, wv, f.sid, f.ev, f.cells, 1.2);
          break;
        }
        case 'rise':
          wv.push({ kind: 'rise', pre: f.pre, post: f.post, n: f.n, why: f.why, t: 0, dur: 0.28 }, busy);
          break;
        case 'cut':
          wv.push({ kind: 'cut', pre: f.pre, post: f.post, rows: f.rows, why: f.why, t: 0, dur: 0.38 }, busy);
          break;
        case 'wipe':
          wv.set(f.post);
          break;
        case 'wells':
          for (const team of TEAMS) this.wells[team].set(f.grids[team]);
          this.shots = [];
          this.inflight = { claude: 0, codex: 0 };
          break;
        case 'send':
          if (f.n > 0 && !busy) {
            this.inflight[f.to] += f.n;
            this.shots.push({ from: f.from, to: f.to, n: f.n, k: Math.min(f.n, 6), t: -FALL, dur: 0.55 });
          }
          if (f.cancel && !busy) fx.text(meterX(f.from) + 7, BOTTOM - 30, L(`🛡 抵消 ${f.cancel}`, `🛡 Blocked ${f.cancel}`), '#9fd0ff', 15, 1.2);
          break;
        case 'blind':
          wv.flash = 0.7;
          if (!busy) this.big(f.team, L('💫 记忆被闪', '💫 Flashbanged!'), '#ffffff', 34, -60);
          break;
        case 'topout':
          this.over = { grids: { ...this.targets(), [f.team]: f.grid }, winner: OTHER[f.team], gray: true, t: 0, dur };
          if (busy) break;
          app.shake(0.5, 10);
          app.sfx.boom(true);
          fx.explosion(wv.x + WELL_W / 2, WELL_Y + 50, true);
          break;
        case 'roundEnd':
          if (this.over?.t === 0) this.over.winner = f.winner;
          else this.over = { grids: this.targets(), winner: f.winner, gray: false, t: 0, dur };
          break;
      }
    }
  }

  /** 一段演出开始：涌垃圾 / 清行的字和声音。 */
  start(wv, s) {
    const { app, fx } = this;
    if (s.kind === 'rise') {
      const [text, color] = riseText(s.why) || [`+${s.n}`, '#ff7a5c'];
      fx.text(wv.x + WELL_W / 2, BOTTOM - 40 - s.n * CELL, text, color, 18, 1.2);
      for (let i = 0; i < 6; i++) fx.sparks(wv.x + rand(0, WELL_W), BOTTOM, s.why === 'bug' ? '#a6e05a' : '#ff8a5c', 2, 90);
      if (app.sfx.ok(1)) app.sfx.burst(0.18, s.n >= 3 ? 220 : 380, 0.22 + Math.min(s.n, 6) * 0.04);
    } else if (s.kind === 'cut') {
      const [text, color] = cutText(s.why) || ['', '#fff'];
      if (s.why === 'pr' || s.why === 'done') this.big(wv.team, text, color, s.why === 'done' ? 58 : 46);
      else fx.text(wv.x + WELL_W / 2, BOTTOM - 60, text, color, 17, 1.2);
      if (app.sfx.ok(2)) [523, 784, 1047].forEach((f, i) => app.sfx.tone(f, 0.16, 0.09, 'triangle', null, i * 0.06));
    }
  }

  /** 方块落地：名字牌、火花、消行大字、声音。 */
  land(R, wv, s) {
    const { app, fx } = this;
    const lines = s.rows.length;
    this.label(R, wv, s.sid, s.ev, s.cells);
    for (const [x, y] of s.cells) fx.sparks(wv.x + (x + 0.5) * CELL, rowY(y) + CELL, PIECE_COLOR[s.type], 1, 60);
    if (s.how === 'tspin') this.big(wv.team, 'T-SPIN!', '#c98bff', 54, -70);
    else if (s.how === 'helper') this.big(wv.team, L('🪂 帮手送来完美一块', '🪂 Perfect piece!'), '#6fd38b', 26, -70, 1.1);
    else if (s.how === 'blind') this.big(wv.team, L('💫 乱放了', '💫 Dropped blind'), '#ffffff', 28, -70, 1);
    if (LINE_WORD[lines]) this.big(wv.team, LINE_WORD[lines], lines === 4 ? '#ffd166' : '#ffffff', lines === 4 ? 64 : 40);
    if (s.combo >= 1) this.big(wv.team, L(`🔥 ${s.combo + 1} 连击`, `🔥 ${s.combo + 1} Combo`), '#ff9b30', 28, 60, 1);
    if (s.b2b) this.big(wv.team, 'BACK-TO-BACK', '#ffd166', 26, -120, 1.2);
    for (const y of s.rows) fx.sparks(wv.x + WELL_W / 2, rowY(y) + CELL / 2, '#ffffff', 8, 260);
    if (lines === 4) app.shake(0.3, 6);
    if (lines && app.sfx.ok(2)) [523, 659, 784, 1047].slice(0, lines).forEach((f, i) => app.sfx.tone(f, 0.14, 0.1, lines === 4 ? 'square' : 'triangle', null, i * 0.05));
    else if (!lines && app.sfx.ok(1)) app.sfx.tone(180, 0.06, 0.07, 'triangle', 110);
  }

  update(dt, R) {
    for (const team of TEAMS) {
      const wv = this.wells[team];
      wv.flash = Math.max(0, wv.flash - dt);
      if (wv.label && (wv.label.life -= dt) <= 0) wv.label = null;
      if (!wv.cur && wv.queue.length) this.start(wv, (wv.cur = wv.queue.shift()));
      const s = wv.cur;
      if (s) {
        s.t += dt * (1 + wv.queue.length); // 有积压就演快一点
        if (s.kind === 'drop' && !s.landed && s.t >= FALL) this.land(R, wv, Object.assign(s, { landed: true }));
        if (s.t >= s.dur) [wv.grid, wv.cur] = [s.post, null];
      }
      // 来袭槽：飞在半路的垃圾先不算，落到槽里再涨
      const target = Math.max(0, (R.wells?.[team]?.pending || 0) - this.inflight[team]);
      this.meter[team] += (target - this.meter[team]) * Math.min(1, dt * 8);
    }
    for (const s of this.shots) {
      if ((s.t += dt) < s.dur) continue;
      s.done = true;
      this.inflight[s.to] = Math.max(0, this.inflight[s.to] - s.n);
      this.fx.sparks(meterX(s.to) + 7, BOTTOM - 10, COLOR[s.from], 10, 160);
      this.fx.text(meterX(s.to) + 7, BOTTOM - 40 - s.n * 6, `+${s.n}`, '#ff6b6b', 20, 1);
      if (this.app.sfx.ok(1)) this.app.sfx.burst(0.12, 900, 0.18, 'bandpass');
    }
    this.shots = this.shots.filter((s) => !s.done);
    for (const b of this.bigs) b.t += dt;
    this.bigs = this.bigs.filter((b) => b.t < b.life);
    if (this.over && (this.over.t += dt) >= this.over.dur) this.over = null;
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    this.drawBack(g);
    for (const team of TEAMS) this.drawWell(g, R, team, rt, scale);
    this.drawShots(g);
    this.fx.renderOver(g, scale);
    for (const b of this.bigs) {
      const k = b.t / b.life;
      g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      this.bigText(g, b.x, b.y - k * 36, b.text, b.color, b.size, k < 0.12 ? 0.5 + (k / 0.12) * 0.7 : k < 0.22 ? 1.2 - ((k - 0.12) / 0.1) * 0.2 : 1);
    }
    g.globalAlpha = 1;
    this.drawCenter(g, R, rt);
  }

  bigText(g, x, y, text, color, size, s = 1, glow = color) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.font = `italic 900 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, size / 7);
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, 0, 0);
    g.shadowColor = glow;
    g.shadowBlur = size / 3;
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  }

  drawBack(g) {
    g.fillStyle = lin(g, 0, 0, 0, H, '#121622', '#07080c');
    g.fillRect(0, 0, W, H);
    for (const team of TEAMS) {
      const cx = WELL_X[team] + WELL_W / 2;
      const rg = g.createRadialGradient(cx, 540, 40, cx, 540, 600);
      rg.addColorStop(0, team === 'claude' ? 'rgba(236,138,95,0.17)' : 'rgba(79,168,255,0.17)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    }
  }

  /** 画一整口井的格子。offY 往下偏（涌垃圾动画），grayFrom 往上的行画成灰色（堆到顶），skip 的行不画。 */
  cells(g, team, grid, offY = 0, grayFrom = ROWS, skip = null) {
    for (let y = 0; y < ROWS; y++) {
      const py = rowY(y) + offY;
      if (py >= BOTTOM || skip?.includes(y)) continue;
      for (let x = 0; x < COLS; x++) {
        const c = grid[y * COLS + x];
        if (c) g.drawImage(sprite(team, y >= grayFrom ? GARBAGE : c), WELL_X[team] + x * CELL, py, CELL, CELL);
      }
    }
  }

  /** 消行闪光：先整行变白，再从两头往中间收。 */
  flashRows(g, team, rows, k, rgb) {
    for (const y of rows) {
      const w = WELL_W * (k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65);
      g.fillStyle = `rgba(${rgb},${Math.min(1, k * 4) * 0.9})`;
      g.fillRect(WELL_X[team] + (WELL_W - w) / 2, rowY(y) + 2, w, CELL - 4);
    }
  }

  drawLive(g, team, wv) {
    const s = wv.cur;
    if (!s) return this.cells(g, team, wv.grid);
    const k = clamp(s.t / s.dur, 0, 1);
    if (s.kind === 'rise') return this.cells(g, team, s.post, (1 - ease(k)) * s.n * CELL);
    if (s.kind === 'cut') {
      this.cells(g, team, s.pre, 0, ROWS, k > 0.35 ? s.rows : null);
      return this.flashRows(g, team, s.rows, k, '255,214,102');
    }
    if (s.t >= FALL) {
      const kk = (s.t - FALL) / FLASH;
      this.cells(g, team, s.mid, 0, ROWS, kk > 0.35 ? s.rows : null);
      return this.flashRows(g, team, s.rows, kk, '255,255,255');
    }
    // 下落中：落点虚影 + 从井口掉下来的方块 + 身后的拖影
    this.cells(g, team, s.pre);
    const x0 = WELL_X[team];
    const off = (ROWS - s.minY) * (1 - (s.t / FALL) ** 2) * CELL;
    g.strokeStyle = PIECE_COLOR[s.type];
    g.lineWidth = 2;
    g.globalAlpha = 0.45;
    for (const [x, y] of s.cells) g.strokeRect(x0 + x * CELL + 3, rowY(y) + 3, CELL - 6, CELL - 6);
    g.globalAlpha = 1;
    const top = rowY(Math.max(...s.cells.map((c) => c[1]))) - off;
    g.fillStyle = lin(g, 0, top - 110, 0, top, 'rgba(255,255,255,0)', 'rgba(255,255,255,0.16)');
    for (const x of new Set(s.cells.map((c) => c[0]))) g.fillRect(x0 + x * CELL + 4, top - 110, CELL - 8, 110);
    for (const [x, y] of s.cells) g.drawImage(sprite(team, s.type), x0 + x * CELL, rowY(y) - off, CELL, CELL);
  }

  drawWell(g, R, team, rt, scale) {
    const wv = this.wells[team];
    const x0 = wv.x;
    const w = R.wells?.[team];
    const over = this.over;
    const frozen = over?.grids[team];
    // 危险程度：显示中的高度 + 来袭槽，越高红光闪得越急
    const danger = clamp((stackHeight(frozen || wv.grid) + this.meter[team] - (R.dangerAt || DANGER) + 3) / 7, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(rt * (4 + danger * 6));
    g.save();
    g.shadowColor = danger > 0 ? `rgba(255,50,50,${0.4 + 0.6 * pulse * danger})` : COLOR[team];
    g.shadowBlur = 18 + danger * 34 * pulse;
    rr(g, x0 - 6, WELL_Y - 6, WELL_W + 12, WELL_H + 12, 10, 'rgba(7,9,14,0.93)');
    g.restore();
    g.strokeStyle = danger > 0.2 ? `rgb(255,${Math.round(110 - 80 * pulse)},90)` : COLOR[team];
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.045)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < COLS; i++) g.moveTo(x0 + i * CELL, WELL_Y), g.lineTo(x0 + i * CELL, BOTTOM);
    for (let i = 1; i < ROWS; i++) g.moveTo(x0, WELL_Y + i * CELL), g.lineTo(x0 + WELL_W, WELL_Y + i * CELL);
    g.stroke();
    if (danger > 0) {
      g.fillStyle = lin(g, 0, WELL_Y, 0, WELL_Y + WELL_H * 0.55, `rgba(255,40,40,${0.3 * danger * (0.6 + 0.4 * pulse)})`, 'rgba(255,40,40,0)');
      g.fillRect(x0, WELL_Y, WELL_W, WELL_H * 0.55);
    }
    g.save();
    g.beginPath();
    g.rect(x0, WELL_Y, WELL_W, WELL_H);
    g.clip();
    // 一局结束：定格最后的画面，输的那边从上往下变灰
    if (frozen) this.cells(g, team, frozen, 0, over.gray && over.winner !== team ? Math.floor(ROWS * (1 - clamp(over.t / 0.7, 0, 1))) : ROWS);
    else this.drawLive(g, team, wv);
    g.restore();
    if (wv.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${Math.min(0.85, wv.flash)})`;
      g.fillRect(x0, WELL_Y, WELL_W, WELL_H);
    }
    const fs = fontFor(scale, 12);
    if (wv.label && !frozen) {
      const L = wv.label;
      const y = L.y - (L.max - L.life) * 10;
      g.globalAlpha = Math.min(1, L.life / 0.35);
      pill(g, L.x, y - fs - 6, L.name, { color: COLOR[team], size: fs, max: 200, weight: 700 });
      pill(g, L.x, y, L.text, { size: fs - 1, max: 230, weight: 500, bg: L.bad ? 'rgba(130,20,20,0.88)' : 'rgba(10,12,16,0.8)' });
      g.globalAlpha = 1;
    }
    if (frozen) {
      const win = over.winner === team;
      const text = !over.winner ? L('平局', 'DRAW') : win ? L('胜！', 'WIN!') : over.gray ? L('堆到顶了', 'TOP OUT') : L('输了', 'LOSE');
      g.globalAlpha = clamp((over.dur - over.t) / 0.3, 0, 1);
      this.bigText(g, x0 + WELL_W / 2, WELL_Y + WELL_H * 0.45, text, win ? '#ffd166' : over.winner ? '#ff5a5a' : '#fff', win ? 92 : 56, 0.6 + 0.4 * ease(clamp(over.t / 0.35, 0, 1)));
      g.globalAlpha = 1;
    }
    if (!R.field?.(team).length) {
      g.fillStyle = 'rgba(5,6,10,0.6)';
      g.fillRect(x0, WELL_Y, WELL_W, WELL_H);
      pill(g, x0 + WELL_W / 2, WELL_Y + WELL_H / 2, L(`等待 ${TEAM_NAME[team]} 上场…`, `Waiting for ${TEAM_NAME[team]}…`), { size: 18, max: 300, color: COLOR[team] });
    }
    this.drawWait(g, R, team, x0, rt);
    this.drawMeter(g, team, w, rt);
    this.drawPanel(g, R, team, w, rt, fs);
  }

  /** 「它在等你」：井口一条倒计时。 */
  drawWait(g, R, team, x0, rt) {
    for (const [sid, wt] of R.waits || []) {
      const p = R.players.get(sid);
      if (wt.boom || !p || p.team !== team || !p.onField) continue;
      const left = Math.max(0, wt.deadline - R.now);
      rr(g, x0 + 10, WELL_Y + 10, WELL_W - 20, 30, 8, `rgba(150,20,20,${0.7 + 0.2 * Math.sin(rt * 8)})`);
      g.fillStyle = 'rgba(255,120,120,0.6)';
      g.fillRect(x0 + 14, WELL_Y + 34, (WELL_W - 28) * (left / (wt.deadline - wt.t)), 3);
      g.font = `700 15px ${FONT}`;
      const [name, sec] = [fitText(g, p.name, 170), Math.ceil(left / 1000)];
      txt(g, L(`⏳ ${name} 在等你 · ${sec} 秒`, `⏳ ${name} is waiting · ${sec}s`), x0 + WELL_W / 2, WELL_Y + 24, '700 15px', '#fff');
      return;
    }
  }

  /** 来袭槽：攒着还没涌上来的垃圾行，一格一行。 */
  drawMeter(g, team, w, rt) {
    const mx = meterX(team);
    rr(g, mx, BOTTOM - MAX_PENDING * CELL, 14, MAX_PENDING * CELL, 5, 'rgba(255,255,255,0.06)');
    const m = Math.min(this.meter[team], MAX_PENDING);
    if (m > 0.03) {
      const hh = m * CELL;
      g.globalAlpha = 0.75 + 0.25 * Math.sin(rt * 10);
      rr(g, mx + 1, BOTTOM - hh, 12, hh, 4, lin(g, 0, BOTTOM - hh, 0, BOTTOM, m >= 6 ? '#ff3030' : '#ffc23b', '#ff6a2b'));
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      for (let i = 1; i < m; i++) g.fillRect(mx + 1, BOTTOM - i * CELL - 1, 12, 2);
      if (w?.pending) pill(g, mx + 7, BOTTOM - hh - 14, `+${w.pending}`, { color: '#ff8a7a', size: 13, weight: 800 });
    }
    txt(g, L('来袭', 'Garbage'), mx + 7, BOTTOM + 16, '600 12px', 'rgba(255,255,255,0.4)');
  }

  /** 井外侧的侧栏：下一块、消行数、在场的人。 */
  drawPanel(g, R, team, w, rt, fs) {
    const px = team === 'claude' ? WELL_X.claude - 196 : WELL_X.codex + WELL_W + 46;
    const pw = 150;
    const cx = px + pw / 2;
    for (const [y, h, title] of [[WELL_Y, 118, w?.blind ? L('下一块 · 💫 会乱放', 'Next · 💫 random') : L('下一块', 'Next')], [WELL_Y + 132, 128, L('消行', 'Lines')]]) {
      rr(g, px, y, pw, h, 10, 'rgba(12,14,20,0.82)');
      g.strokeStyle = mix(COLOR[team], '#000000', 0.45);
      g.lineWidth = 2;
      g.stroke();
      txt(g, title, px + 12, y + 16, '600 13px', 'rgba(255,255,255,0.5)', 'left');
    }
    if (w?.next) {
      const rot = ROTS[w.next - 1][0];
      const z = 26;
      for (const [x, y] of rot.cells) g.drawImage(sprite(team, w.next), cx - (rot.w * z) / 2 + x * z, WELL_Y + 70 + (rot.h * z) / 2 - (y + 1) * z, z, z);
    }
    txt(g, String(w?.lines ?? 0), cx, WELL_Y + 192, '900 46px', '#fff');
    txt(g, L(`送出 ${w?.sent ?? 0} 行垃圾`, `Sent ${w?.sent ?? 0} garbage`), cx, WELL_Y + 228, '700 13px', COLOR[team]);
    const tags = [w?.combo >= 1 && L(`🔥${w.combo + 1}连`, `🔥 Combo ${w.combo + 1}`), w?.b2b && 'B2B'].filter(Boolean);
    if (tags.length) pill(g, cx, WELL_Y + 248, tags.join(' · '), { color: '#ffd166', size: 12, weight: 800 });
    // 在场的人：最近落块的那个高亮，在等你的显示倒计时，挂机的变淡
    (R.field ? R.field(team) : []).forEach((p, i) => {
      const wt = R.waits?.get(p.sid);
      const waiting = wt && !wt.boom;
      const idle = R.now - p.lastActive > 90e3;
      const hot = this.lastSid[team] === p.sid;
      g.globalAlpha = idle ? 0.5 : 1;
      const text = waiting ? `⏳${Math.ceil(Math.max(0, wt.deadline - R.now) / 1000)}s ${p.name}` : `${idle ? '💤 ' : ''}${p.name}`;
      const bg = waiting ? `rgba(150,20,20,${0.7 + 0.25 * Math.sin(rt * 8)})` : hot ? DEEP[team] : 'rgba(10,12,16,0.7)';
      pill(g, cx, WELL_Y + 290 + i * 34, text, { color: hot || waiting ? '#fff' : COLOR[team], size: fs, max: pw, bg });
      g.globalAlpha = 1;
    });
  }

  /** 送出去的垃圾：一串发光小方块从自己井里飞过 VS，落进对面的来袭槽。 */
  drawShots(g) {
    for (const s of this.shots) {
      if (s.t < 0) continue;
      const [x1, y1, x2, y2] = [WELL_X[s.from] + WELL_W / 2, WELL_Y + WELL_H * 0.5, meterX(s.to) + 7, BOTTOM - 12];
      g.save();
      g.shadowColor = COLOR[s.from];
      g.shadowBlur = 14;
      for (let i = 0; i < s.k; i++) {
        const k = clamp(s.t / s.dur - i * 0.06, 0, 1);
        if (k <= 0) continue;
        const e = k * k * (3 - 2 * k);
        const u = 1 - e;
        rr(g, u * u * x1 + 2 * u * e * 800 + e * e * x2 - 8, u * u * y1 + 2 * u * e * (WELL_Y + 40) + e * e * y2 - 8, 16, 16, 4, COLOR[s.from]);
      }
      g.restore();
    }
  }

  drawCenter(g, R, rt) {
    for (const team of TEAMS) {
      const cx = WELL_X[team] + WELL_W / 2;
      const n = R.field ? R.field(team).length : 0;
      g.save();
      g.shadowColor = COLOR[team];
      g.shadowBlur = 20;
      txt(g, TEAM_NAME[team].toUpperCase(), cx, WELL_Y - 52, '900 42px', COLOR[team]);
      g.restore();
      txt(g, n ? L(`${n} 个会话在场`, `${n} in play`) : L('还没人上场', 'Nobody here yet'), cx, WELL_Y - 20, '600 14px', 'rgba(255,255,255,0.55)');
    }
    const vy = WELL_Y + WELL_H * 0.42;
    this.bigText(g, 800, vy, 'VS', lin(g, -80, 0, 80, 0, COLOR.claude, COLOR.codex), 124, 1 + 0.035 * Math.sin(rt * 2.2), 'rgba(255,255,255,0.35)');
    if (R.phase !== 'live') return txt(g, L('热身中', 'Warm-up'), 800, vy + 92, '800 22px', '#fff');
    txt(g, L(`第 ${R.round} 局`, `Game ${R.round}`), 800, vy + 92, '800 22px', '#fff');
    // 涨潮倒计时：拖太久两边井底一起涨
    const left = R.roundLen - (R.now - R.roundStart);
    const clock = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    txt(g, left > 0 ? L(`涨潮倒计时 ${clock}`, `Rising tide in ${clock}`) : L('🌊 涨潮中', '🌊 Tide rising'), 800, vy + 122, '600 15px', left > 0 ? 'rgba(255,255,255,0.55)' : `rgba(255,110,110,${0.7 + 0.3 * Math.sin(rt * 6)})`);
  }

  hud(R) {
    if (R.phase !== 'live' || !R.wells) return null;
    const { claude, codex } = R.wells;
    return { mid: L(`第 ${R.round} 局`, `Game ${R.round}`), sub: L(`消行 ${claude.lines} : ${codex.lines}`, `Lines ${claude.lines} : ${codex.lines}`) };
  }
}
