// 大乱斗：每一关随机换一个游戏，像《瓦里奥制造》。
// 它自己不定义玩法，只是串场：当前游戏分出胜负就记一分，换下一个游戏，把在场的人带过去。
import { hash, rng, summarize, setCivilNames, REAL_TEAM_NAME } from '../core.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'party',
  icon: '🎪',
  get name() { return L('大乱斗', 'Party Mix'); },
  get desc() { return L('每一关随机换一个游戏：上一秒在打 CS，下一秒在跑马里奥赛车', 'A new game every stage: CS one second, Mario Kart the next'); },
  get roundWord() { return L('关', 'stage'); },
};

export class Rules {
  /**
   * opts.modes：可以抽到的游戏模块列表（每个有 meta 和 Rules）。
   * opts.solo：单独玩一个游戏时也用这个外壳——每回合不换游戏，只负责「只有一队在场就内战」。
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.modes = opts.modes || [];
    this.solo = !!opts.solo;
    this._balance = opts.balance ?? true;
    this.titles = { ...(opts.titles || {}) };
    this.modeId = 'party';
    this.reset();
  }

  reset() {
    this.score = { claude: 0, codex: 0 };
    this.round = 0;
    this.history = [];
    this.children = [];
    this.order = [];
    this.cur = this.make(this.pick(0));
  }

  make(mode, civil = null) {
    const r = new mode.Rules({ ...this.opts, titles: this.titles, balance: this._balance, party: !this.solo, stage: true, civil });
    r.mode = mode;
    r.modeId = mode.meta.id;
    r.modeMeta = mode.meta;
    setCivilNames(r.civilNames);
    return r;
  }

  /** 第 i 关玩什么：每轮把所有游戏洗一遍，不连续重复。确定性的，回放拖进度条也一样。 */
  pick(i) {
    const n = this.modes.length;
    while (this.order.length <= i) {
      const r = rng(hash(`party-${this.order.length / n}`));
      const deck = [...this.modes];
      for (let k = deck.length - 1; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        [deck[k], deck[j]] = [deck[j], deck[k]];
      }
      if (this.order.length && deck[0] === this.order[this.order.length - 1] && deck.length > 1) [deck[0], deck[1]] = [deck[1], deck[0]];
      this.order.push(...deck);
    }
    return this.order[i];
  }

  // 下面这些让 app 把大乱斗当成普通规则用，实际都转给当前这一关
  get current() { return this.cur; }
  get now() { return this.cur.now; }
  get phase() { return this.cur.phase; }
  get players() { return this.cur.players; }
  get waits() { return this.cur.waits; }
  get balance() { return this._balance; }
  set balance(v) {
    this._balance = v;
    this.cur.balance = v;
  }
  field(team) { return this.cur.field(team); }

  setTitle(sid, title) {
    this.titles[sid] = title;
    this.cur.setTitle(sid, title);
  }

  /** 一关可能在事件到来之前就结束：那就当场换关，把这个事件交给下一关。 */
  process(ev) {
    const out = [];
    for (let guard = 0; guard < 24; guard++) {
      const child = this.cur;
      const fx = child.process(ev);
      this.settle(child, fx, out);
      if (child.consumed !== false) break;
    }
    return out;
  }

  /** 时间前进到 t：中途换了关，新游戏接着往后走。 */
  advance(t) {
    const out = [];
    for (let guard = 0; guard < 24; guard++) {
      const child = this.cur;
      const fx = child.advance(t);
      const halted = !!child.halted; // 停在半路（分出胜负 / 人不够）就接着往后推
      this.settle(child, fx, out);
      if (this.cur === child && !halted) break;
    }
    return out;
  }

  /** 一关停下来之后：分出胜负就记分换关；只是人不够了就看要不要换成混战游戏。 */
  settle(child, fx, out) {
    const i = fx.findIndex((f) => f.type === 'roundEnd');
    if (i < 0) {
      out.push(...fx);
      if (child.halted === 'pause') child.halted = false;
      this.rescue(out);
      return;
    }
    const end = fx[i];
    out.push(...fx.slice(0, i));
    // 只有一队在场就是「内战」：照打，但不算两队的比分
    const civil = !!child.civil || !(child.field('claude').length && child.field('codex').length);
    const winner = civil ? null : end.winner;
    if (winner) this.score[winner]++;
    this.round++;
    this.history.push({ round: this.round, winner, civil, mode: child.modeId, t: child.now });
    out.push({ ...end, winner, civil, round: this.round, score: { ...this.score }, stageName: this.solo ? '' : child.modeMeta.name });
    if (this.solo) {
      // 单独玩：同一个游戏接着打下一回合（它已经自己开好了）
      out.push(...fx.slice(i + 1));
      child.halted = false;
    } else this.switchTo(this.pick(this.round), out);
    this.rescue(out);
  }

  switchTo(mode, out, note = '', civil = null) {
    const prev = this.cur;
    this.children.push(prev);
    const next = this.make(mode, civil);
    const joined = next.adopt(prev);
    this.cur = next;
    // prev / next：这一段效果属于哪一关（一次调用里可能连着换两次关，画面要分段交给对应的游戏）
    out.push({ type: 'partySwitch', mode: next.modeId, name: next.modeMeta.name, icon: next.modeMeta.icon, stage: this.round + 1, note, civil, prev, next });
    out.push(...joined);
  }

  /** 只有一队在场时，团队游戏永远开不了打：同一个游戏改成内战，把这队的会话分成 A、B 两边。 */
  rescue(out) {
    const c = this.cur;
    // 内战打着打着对面真的来人了：换回正常对战
    if (c.civil && c.field().some((p) => p.realTeam !== c.civil)) {
      this.switchTo(c.mode, out, L('对面来人了，恢复正常对战', 'The other team showed up — back to a real match'));
      return;
    }
    if (c.phase !== 'warmup' || c.ffa || c.civil || c.field().length < 2) return;
    if (c.field('claude').length && c.field('codex').length) return;
    const team = c.field('claude').length ? 'claude' : 'codex';
    const who = REAL_TEAM_NAME[team];
    this.switchTo(c.mode, out, L(`只有 ${who} 在场：分成 A、B 两边内战（不计分）`, `Only ${who} is here — civil war, A vs B (no points)`), team);
  }

  summary() {
    const merged = new Map();
    for (const r of [...this.children, this.cur]) {
      for (const p of r.players.values()) {
        const m = merged.get(p.sid) || { sid: p.sid, team: p.team, name: p.name, k: 0, d: 0, a: 0, hs: 0, dmg: 0, ops: 0, errs: 0, done: 0, tok: 0, waitMax: 0 };
        for (const key of ['k', 'd', 'a', 'hs', 'dmg', 'ops', 'errs', 'done', 'tok']) m[key] += p[key] || 0;
        m.waitMax = Math.max(m.waitMax, p.waitMax || 0);
        m.name = p.name;
        merged.set(p.sid, m);
      }
    }
    const ps = [...merged.values()].filter((p) => p.ops > 0 || p.k || p.d);
    return { ...summarize(ps, this.score, this.round), stages: this.history };
  }
}
