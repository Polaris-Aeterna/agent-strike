import { L } from './i18n.js';

// 所有游戏共用的规则底座：会话上场 / 挂机下场、均衡火力、「它在等你」计时、统计。
// 规则层不画画、不看时钟，同样的事件序列永远打出同样的结果，回放才能随便拖。
// 每个游戏继承 Rules，实现 onEvent 等钩子；画面在各自的 View 里。

export const TEAMS = ['claude', 'codex'];
export const OTHER = { claude: 'codex', codex: 'claude' };
export const COLOR = { claude: '#ec8a5f', codex: '#4fa8ff' };
export const DEEP = { claude: '#9a4524', codex: '#1e568f' };
export const REAL_TEAM_NAME = { claude: 'Claude', codex: 'Codex' };
// 内战（只有一队在场，分成 A、B 两边打）时，两边显示成「Claude A / Claude B」。各个游戏照常用 TEAM_NAME 就行。
let civilNames = null;
export const TEAM_NAME = new Proxy(REAL_TEAM_NAME, { get: (t, k) => civilNames?.[k] ?? t[k] });
export function setCivilNames(names) {
  civilNames = names;
}
export const ACTIONS = new Set(['shell', 'read', 'edit', 'web', 'misc', 'agent']);
export const WORLD = { w: 1600, h: 960 };

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export { L } from './i18n.js';

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 气泡里显示的动作文字，比如「Bash · npm test ✗」。 */
export function actText(ev) {
  const sub = ev.sub ? '🤖' : '';
  const bad = ev.ok === false ? ' ✗' : '';
  switch (ev.k) {
    case 'shell': return `${sub}${ev.hs ? '🎯 ' : ''}${ev.tool} · ${ev.tgt || ''}${bad}`;
    case 'read': return `${sub}🔍 ${ev.tgt || ev.tool}${bad}`;
    case 'edit': return `${sub}🧱 ${ev.tgt || ev.tool}${bad}`;
    case 'web': return `${sub}🔭 ${ev.tgt || ev.tool}${bad}`;
    case 'misc': return `${sub}${ev.tool}${bad}`;
    case 'agent': return L('🪂 派出子代理', '🪂 Subagent out');
    case 'compact': return L('💫 上下文压缩', '💫 Context compacted');
    case 'done': return L('✅ 任务完成', '✅ Task done');
    case 'prompt': return L('💬 收到新指令', '💬 New orders');
    case 'abort': return L('✋ 被打断', '✋ Interrupted');
    case 'apierr': return L('📡 API 报错', '📡 API error');
    case 'ask': return L('⏳ 在等你回复', '⏳ Waiting for you');
    case 'answer': return L('✂️ 你回复了', '✂️ You replied');
    case 'pr': return L('🏆 提交 PR', '🏆 PR opened');
    default: return null;
  }
}

/**
 * 规则底座。子类可以覆盖的钩子（都可选）：
 *   init()                       重置时初始化自己的状态（reset 会调用）
 *   initPlayer(p)                新玩家创建时加自己的字段
 *   onEnter(p, fx) / onLeave(p, fx)   上场 / 下场
 *   onRoundStart(fx) / onRoundEnd(winner, fx)
 *   onPause(fx)                  人不够了，回到热身
 *   onTick(fx)                   每次时间前进（比赛进行中）
 *   onEvent(p, ev, r, fx)        核心：一个 AI 动作发生了。r() 是确定性的随机数
 *   onTokens(p, n, fx)           烧了 n 个输出 token
 *   onWait(p, fx) / onAnswer(p, wait, fx) / onWaitTimeout(p, fx)   它在等你 / 你及时回了 / 等太久
 *   check(fx)                    判断这回合是不是结束了，结束就调用 this.endRound(winner, reason, fx)
 *   timers()                     返回游戏自己的定时器时刻（比如 [this.roundStart + this.roundLen]），时钟会准点停下来
 *   ghostOk(ev)                  倒下的玩家还能处理哪些事件（默认只有派子代理）
 *   leader()                     超时等情况下谁领先（返回队伍或 null）
 */
export class Rules {
  static defaults = {};

  constructor(opts = {}) {
    const o = { titles: {}, balance: true, idleLimit: 5 * 60e3, maxPerTeam: 5, waitLimit: 40e3, party: false, ffa: false, ...this.constructor.defaults, ...opts };
    this.opts = o;
    this.balance = o.balance;
    this.idleLimit = o.idleLimit;
    this.maxPerTeam = o.maxPerTeam;
    this.waitLimit = o.waitLimit;
    this.party = o.party;
    this.stage = o.stage ?? o.party; // 由外壳（大乱斗 / 内战切换）管理：一回合结束就停下来交给外壳
    this.ffa = o.ffa;
    this.civil = o.civil || null; // 内战：只有这一队（'claude' / 'codex'）的会话，分成两边打
    this.titles = { ...o.titles };
    this.reset();
  }

  reset() {
    this.now = 0;
    this.phase = 'warmup';
    this.round = 0;
    this.roundStart = 0;
    this.score = { claude: 0, codex: 0 };
    this.players = new Map();
    this.waits = new Map();
    this.rates = { claude: [], codex: [] };
    this.history = [];
    this.seq = 0;
    this.halted = false;
    this.consumed = true;
    this.init();
  }

  setTitle(sid, title) {
    this.titles[sid] = title;
    const p = this.players.get(sid);
    if (p) p.name = title;
  }

  field(team) {
    const out = [];
    for (const p of this.players.values()) if (p.onField && (!team || p.team === team)) out.push(p);
    return out;
  }

  alive(team) {
    return this.field(team).filter((p) => p.alive);
  }

  /** 混战模式里的「敌人」：两队都在时打对面，只有一队时自己人互打。 */
  foes(p) {
    if (!this.ffa) return this.alive(OTHER[p.team]);
    const both = this.field('claude').length && this.field('codex').length;
    return this.alive().filter((q) => q !== p && (!both || q.team !== p.team));
  }

  ready() {
    if (this.ffa) return this.field().length >= 2;
    return this.field('claude').length > 0 && this.field('codex').length > 0;
  }

  rand(ev) {
    return rng(hash(ev.sid + ev.k + (ev.tgt || '')) ^ ev.t ^ this.seq++);
  }

  // ---------------------------------------------------------------- 主入口

  process(ev) {
    const fx = [];
    this.consumed = true;
    this._clock(ev.t, fx);
    // 大乱斗里这一关在事件到来之前就结束了：事件留给下一关
    if (this.halted) {
      this.consumed = false;
      return fx;
    }
    const p = this._player(ev, fx);
    if (ev.k === 'tokens') {
      p.tok += ev.n || 0;
      this.onTokens(p, ev.n || 0, fx);
      this._check(fx);
      return fx;
    }
    p.lastActive = Math.max(p.lastActive, ev.t);
    if (ACTIONS.has(ev.k)) {
      p.ops++;
      if (p.onField) this.rates[p.team].push(ev.t);
    }
    if (ev.ok === false) p.errs++;
    if (ev.k === 'prompt') p.prompts++;
    if (ev.k === 'done') p.done++;
    fx.push({ type: 'act', sid: p.sid, ev, alive: p.alive && p.onField });
    if (ev.k === 'prompt') fx.push({ type: 'prompt', sid: p.sid });
    if (ev.k === 'pr') fx.push({ type: 'pr', sid: p.sid });
    if (ev.k === 'ask') this._wait(p, ev, fx);
    else if (ev.k === 'answer') this._answer(p, ev, fx);
    if (p.onField && (p.alive || this.ghostOk(ev))) this.onEvent(p, ev, this.rand(ev), fx);
    this._check(fx);
    return fx;
  }

  advance(t) {
    const fx = [];
    this._clock(t, fx);
    this._check(fx);
    return fx;
  }

  // ---------------------------------------------------------------- 上场 / 下场

  newPlayer(sid, team, t) {
    const p = {
      sid, team: this.civil ? this.civilSide() : team, realTeam: team, name: this.titles[sid] || sid.slice(0, 8), onField: false, alive: true, lastActive: t,
      k: 0, d: 0, a: 0, hs: 0, dmg: 0, ops: 0, errs: 0, done: 0, tok: 0, asks: 0, prompts: 0, waitMax: 0,
    };
    this.initPlayer(p);
    this.players.set(sid, p);
    return p;
  }

  /** 内战里新来的人分到人少的那一边。 */
  civilSide() {
    const n = { claude: 0, codex: 0 };
    for (const q of this.players.values()) n[q.team]++;
    return n.claude <= n.codex ? 'claude' : 'codex';
  }

  /** 内战时两边的显示名字。 */
  get civilNames() {
    return this.civil ? { claude: `${REAL_TEAM_NAME[this.civil]} A`, codex: `${REAL_TEAM_NAME[this.civil]} B` } : null;
  }

  _player(ev, fx) {
    const p = this.players.get(ev.sid) || this.newPlayer(ev.sid, ev.src, ev.t);
    if (!p.onField && ev.k !== 'tokens') this._enter(p, fx);
    return p;
  }

  _enter(p, fx) {
    const mates = this.field(p.team);
    if (mates.length >= this.maxPerTeam) {
      const idle = mates
        .filter((m) => this.now - m.lastActive > this.idleLimit / 2 && !this.waiting(m))
        .sort((a, b) => a.lastActive - b.lastActive)[0];
      if (!idle) return;
      this._leave(idle, fx, false);
    }
    p.onField = true;
    p.alive = true;
    fx.push({ type: 'join', sid: p.sid });
    this.onEnter(p, fx);
    if (this.phase === 'warmup' && this.ready()) {
      this.phase = 'live';
      fx.push({ type: 'phase', phase: 'live' });
      this.startRound(fx);
    }
  }

  _leave(p, fx, idle) {
    p.onField = false;
    fx.push({ type: 'bench', sid: p.sid, idle });
    this.onLeave(p, fx);
  }

  // ---------------------------------------------------------------- 它在等你

  waiting(p) {
    const w = this.waits.get(p.sid);
    return !!w && !w.boom;
  }

  _wait(p, ev, fx) {
    if (this.waiting(p)) return;
    this.waits.set(p.sid, { t: ev.t, deadline: ev.t + this.waitLimit, boom: false });
    p.asks++;
    fx.push({ type: 'wait', sid: p.sid, t: ev.t, deadline: ev.t + this.waitLimit });
    if (p.onField) this.onWait(p, fx);
  }

  _answer(p, ev, fx) {
    const w = this.waits.get(p.sid);
    if (!w) return;
    this.waits.delete(p.sid);
    const wait = Math.max(0, ev.t - w.t);
    p.waitMax = Math.max(p.waitMax, wait);
    if (!w.boom && ev.t <= w.deadline) {
      fx.push({ type: 'waitDone', sid: p.sid, wait });
      if (p.onField) this.onAnswer(p, wait, fx);
      return;
    }
    if (!w.boom) this._boom(p, w, fx);
    fx.push({ type: 'waitLate', sid: p.sid, wait });
  }

  _boom(p, w, fx) {
    w.boom = true;
    fx.push({ type: 'waitBoom', sid: p.sid });
    if (p.onField) this.onWaitTimeout(p, fx);
  }

  // ---------------------------------------------------------------- 时间与回合

  /**
   * 时间前进到 t。中间如果有「该发生的时刻」（有人该挂机下场、等你超时、游戏自己的定时器），
   * 先一步步推进到那些时刻，这样结果和时钟推进得多密无关：一路播过来和拖进度条看到的是同一场比赛。
   */
  _clock(t, fx) {
    for (let guard = 0; guard < 512; guard++) {
      const at = this._nextMoment(t);
      if (at == null) break;
      if (at - 1 > this.now) {
        this._step(at - 1, fx);
        this._check(fx);
        if (this.halted) return;
      }
      this._step(at, fx);
      this._check(fx);
      if (this.halted) return;
    }
    this._step(t, fx);
  }

  _nextMoment(t) {
    let best = null;
    const consider = (at) => {
      if (at > this.now && at < t && (best == null || at < best)) best = at;
    };
    for (const p of this.players.values()) if (p.onField && !this.waiting(p)) consider(p.lastActive + this.idleLimit + 1);
    for (const w of this.waits.values()) if (!w.boom) consider(w.deadline + 1);
    if (this.phase === 'live') for (const at of this.timers()) consider(at);
    return best;
  }

  _step(t, fx) {
    if (t > this.now) this.now = t;
    for (const [sid, w] of this.waits) {
      if (!w.boom && this.now > w.deadline) this._boom(this.players.get(sid), w, fx);
      else if (w.boom && this.now - w.t > 6 * 3600e3) this.waits.delete(sid);
    }
    // 一段时间没动静的会话先下场（挂机），有动作了再回来
    for (const p of this.players.values()) {
      if (p.onField && this.now - p.lastActive > this.idleLimit && !this.waiting(p)) this._leave(p, fx, true);
    }
    if (this.phase === 'live' && !this.ready()) {
      this.phase = 'warmup';
      fx.push({ type: 'phase', phase: 'warmup' });
      this.onPause(fx);
      if (this.stage) this.halted ||= 'pause';
    }
    if (this.phase === 'live') this.onTick(fx);
  }

  _check(fx) {
    if (this.phase === 'live') this.check(fx);
  }

  startRound(fx) {
    this.round++;
    this.roundStart = this.now;
    fx.push({ type: 'roundStart', round: this.round });
    this.onRoundStart(fx);
  }

  /** reason 是简短的原因代码；reasonText 会显示在横幅上。 */
  endRound(winner, reason, fx, reasonText = '') {
    if (this.phase !== 'live') return;
    if (winner) this.score[winner]++;
    this.history.push({ round: this.round, winner, reason, t: this.now });
    fx.push({ type: 'roundEnd', round: this.round, winner, reason, reasonText, score: { ...this.score } });
    this.onRoundEnd(winner, fx);
    // 由外壳管理时，一回合分出胜负就停在这一刻，由外壳当场决定接下来怎么打
    if (this.stage) this.halted = 'round';
    this.startRound(fx);
  }

  // ---------------------------------------------------------------- 平衡

  /** 均衡火力：让两队「打倒对方所需时间」相等。比的是效率，不是谁开的会话多。 */
  balanceMult(team) {
    if (!this.balance) return 1;
    const o = OTHER[team];
    if (!this.field(o).length || !this.field(team).length) return 1;
    const cutoff = this.now - 10 * 60e3;
    for (const t of TEAMS) {
      const q = this.rates[t];
      let i = 0;
      while (i < q.length && q[i] < cutoff) i++;
      if (i) q.splice(0, i);
    }
    const rate = (t) => this.rates[t].length + 10;
    const pool = (t) => Math.max(1, this.field(t).length);
    return clamp(Math.sqrt((rate(o) * pool(o)) / (rate(team) * pool(team))), 0.05, 20);
  }

  /** 人少的时候单发更痛，1v1 和 5v5 节奏差不多。 */
  sizeMult() {
    const n = this.ffa ? this.field().length / 2 : (this.field('claude').length + this.field('codex').length) / 2;
    return Math.sqrt(this.maxPerTeam / Math.max(1, n));
  }

  // ---------------------------------------------------------------- 大乱斗：接手上一个游戏的阵容

  adopt(prev) {
    const fx = [];
    this.now = prev.now;
    this.titles = { ...prev.titles };
    for (const [sid, w] of prev.waits) this.waits.set(sid, { ...w });
    const actives = [...prev.players.values()].filter((p) => p.onField).sort((a, b) => b.lastActive - a.lastActive);
    for (const q of actives) {
      const p = this.newPlayer(q.sid, q.realTeam || q.team, q.lastActive);
      p.lastActive = q.lastActive;
      this._enter(p, fx);
    }
    return fx;
  }

  // ---------------------------------------------------------------- 总结

  summary() {
    const ps = [...this.players.values()].filter((p) => p.ops > 0 || p.k || p.d);
    return summarize(ps, this.score, this.history.length);
  }

  // ---------------------------------------------------------------- 默认钩子

  init() {}
  initPlayer() {}
  onEnter() {}
  onLeave() {}
  onRoundStart() {}
  onRoundEnd() {}
  onPause() {}
  onTick() {}
  onEvent() {}
  onTokens() {}
  onWait() {}
  onAnswer() {}
  onWaitTimeout() {}
  check() {}
  ghostOk(ev) {
    return ev.k === 'agent';
  }
  /** 游戏自己的定时器（绝对时间，毫秒），比如「回合时间到」。时钟会准点停在这些时刻。 */
  timers() {
    return [];
  }
  leader() {
    return null;
  }
}

export function summarize(ps, score, rounds) {
  const best = (f) => ps.reduce((b, p) => (!b || f(p) > f(b) ? p : b), null);
  const team = (t) => {
    const xs = ps.filter((p) => p.team === t);
    const sum = (f) => xs.reduce((s, p) => s + f(p), 0);
    return { players: xs.length, k: sum((p) => p.k), ops: sum((p) => p.ops), errs: sum((p) => p.errs), done: sum((p) => p.done), tok: sum((p) => p.tok), hs: sum((p) => p.hs) };
  };
  return {
    score: { ...score },
    rounds,
    mvp: best((p) => p.k * 3 + p.a + p.done * 2 + p.dmg / 60),
    buggiest: best((p) => p.errs),
    waited: best((p) => p.waitMax),
    sharpshooter: best((p) => p.hs),
    teams: { claude: team('claude'), codex: team('codex') },
  };
}
