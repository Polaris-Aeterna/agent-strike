// 街霸 KOF：横版格斗车轮战。每队一个人在场上打，其余在场边等着援护；倒下了下一个队友跳进来接着打。
// 跑命令拳脚连打，上网放波动拳，任务完成升龙拳，气满了放超必杀，你打断它就是拔了手柄。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, WORLD, clamp, rng, actText } from '../core.js';
import { Particles, rand, pill, fitText, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'fight',
  icon: '🥊',
  get name() { return L('街霸 KOF', 'Street Fighter × KOF'); },
  get desc() { return L('横版格斗车轮战。跑命令拳脚连打，上网放波动拳，任务完成升龙拳，气满了放超必杀', 'Side-view tag-team brawl. Commands are punches, web searches are Hadoukens, finished tasks are Shoryukens, full meter means a super'); },
  get roundWord() { return L('回合', 'round'); },
  get wait() {
    return {
      start: L('😤 {a} 在挑衅：来啊，快活啊！', '😤 {a} is taunting: come on, bring it!'),
      sub: L('40 秒内回它就是「玩家回来了」，超时它就被连段打爆', 'Reply within 40s and the player is back — or it gets comboed to death'),
      done: L('🕹 玩家回来了！', '🕹 Player is back!'),
      boom: L('💥 {a} 没人操作，被连段打爆了', '💥 Nobody on the stick — {a} got comboed to death'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('拳脚连打（连着打有连段：7 HITS!）', 'Rush combo (keep hitting: 7 HITS!)')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('重踢；气满了就是超必杀「真空波动拳」', 'Roundhouse; with full meter: Shinku Hadouken super')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('轻拳', 'Jab')],
      [L('🧱 改代码', '🧱 Edit code'), L('防御：下一下伤害大减，还涨气', 'Guard: blocks most of the next hit, gains meter')],
      [L('🔭 上网查资料', '🔭 Web search'), L('波动拳（阿杜根！）', 'Hadouken!')],
      [L('✅ 任务完成', '✅ Task done'), L('升龙拳；气满了就是超必杀「真·升龙拳」', 'Shoryuken; with full meter: Shin Shoryuken super')],
      [L('🤔 思考', '🤔 Thinking'), L('蓄气', 'Charge meter')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('援护攻击：队友冲进来踹一脚', 'Striker: a teammate jumps in with a kick')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('眩晕：头上冒星星，接下来两下动不了', 'Dizzy: stars circle its head, next 2 actions wasted')],
      [L('🐛 报错', '🐛 Error'), L('被对面反击（COUNTER）', 'Eats a COUNTER from the enemy')],
      [L('💬 你发消息', '💬 You send a message'), L('场外加油，涨气', 'The crowd cheers, meter up')],
      [L('⏳ 它在等你', '⏳ Waiting on you'), L('挑衅：来啊，快活啊！超时被连段打爆', 'Taunt: bring it! Too slow and it gets comboed to death')],
      [L('✋ 你打断它', '✋ You interrupt it'), L('你拔了手柄（直接 K.O.）', 'You unplugged the controller (instant K.O.)')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('瞬狱杀「天」', 'Shun Goku Satsu (天)')],
      [L('📣 场边的队友', '📣 Benched teammates'), L('攒援护，攒够了冲进来打一下', 'Build up assist, then jump in for a hit')],
    ];
  },
};

const SWITCH_IDLE = 60e3; // 场上的人 60 秒没动静，队友一动就换人
const COMBO_GAP = 20e3; // 同一个人 20 秒内接着打中才算连段
const MOVES = new Set(['shell', 'read', 'edit', 'web', 'misc', 'agent', 'think', 'done', 'compact']);
const DMG = 0.8; // 总伤害系数：调回合节奏用
const MOVE = {
  rush: [6, 9], jab: [3, 5], heavy: [15, 19], throw: [9, 12], fireball: [13, 17], uppercut: [20, 26],
  striker: [12, 16], super1: [48, 58], super2: [44, 54], sky: [60, 75],
};
const BANK = { shell: 7, web: 9, misc: 5, read: 2 }; // 场边队友每个动作攒多少援护伤害
const BANK_FULL = 18; // 攒够就冲进来打一下
// 招式名（击杀播报里显示）：用的时候再按当前语言取
const NAMES = () => ({
  rush: L('拳脚连打', 'Rush Combo'), jab: L('轻拳', 'Jab'), heavy: L('重踢', 'Roundhouse'), throw: L('投技', 'Throw'),
  fireball: L('波动拳', 'Hadouken'), uppercut: L('升龙拳', 'Shoryuken'), striker: L('援护攻击', 'Striker'),
  super1: L('真·升龙拳', 'Shin Shoryuken'), super2: L('真空波动拳', 'Shinku Hadouken'), sky: L('瞬狱杀', 'Shun Goku Satsu'),
  counter: L('反击', 'Counter'), self: L('掉线', 'Disconnected'), unplug: L('拔手柄', 'Unplugged'), beatdown: L('无限连', 'Infinite Combo'),
});
const nameCache = {};
const tr = (id) => (nameCache[L('zh', 'en')] ||= NAMES())[id] || id;

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { roundLen: 6 * 60e3 };

  init() {
    this.roundLen = this.opts.party ? 4 * 60e3 : this.opts.roundLen;
    this.act = { claude: null, codex: null };
    this.clearRound();
  }

  // 每回合清零：K.O. 数、挨打总量（判 PERFECT）、场边攒的援护
  clearRound() {
    Object.assign(this, { kos: { claude: 0, codex: 0 }, hurt: { claude: 0, codex: 0 }, bank: { claude: 0, codex: 0 }, dealt: 0 });
  }

  initPlayer(p) {
    Object.assign(p, { hp: 100, pow: 0, combo: 0, comboT: 0, guard: false, stun: 0 });
  }

  onEnter(p, fx) {
    Object.assign(p, { hp: 100, combo: 0, guard: false, stun: 0 });
    if (this.phase === 'live' && !this.cur(p.team)) this.tagIn(p, null, fx);
  }

  onLeave(p, fx) {
    if (this.act[p.team] !== p.sid) return;
    this.act[p.team] = null;
    if (this.phase === 'live') this.tagNext(p.team, fx);
  }

  // ---------------------------------------------------------------- 车轮战：谁在场上

  cur(team) {
    const p = this.players.get(this.act[team]);
    return p && p.onField && p.alive ? p : null;
  }

  /** 替补：最近动过的、还没倒下的队友。 */
  nextUp(team) {
    return this.alive(team).sort((a, b) => b.lastActive - a.lastActive)[0] || null;
  }

  tagNext(team, fx) {
    const nx = this.nextUp(team);
    if (nx) this.tagIn(nx, null, fx);
    return nx;
  }

  foe(p, fx) {
    return this.cur(OTHER[p.team]) || this.tagNext(OTHER[p.team], fx);
  }

  /** 是场上那位 / 场上没人 / 场上那位发呆太久 → 这个动作是招式；否则是场边援护。 */
  claim(p, fx) {
    const c = this.cur(p.team);
    if (c === p) return true;
    if (c && (this.now - c.lastActive <= SWITCH_IDLE || this.waiting(c))) return false;
    this.tagIn(p, c, fx);
    return true;
  }

  tagIn(p, prev, fx) {
    this.act[p.team] = p.sid;
    Object.assign(p, { combo: 0, guard: false });
    if (prev) Object.assign(prev, { combo: 0, guard: false, stun: 0 });
    if (prev) fx.push({ type: 'note', text: L('{0} 下场喘口气，换 {1} 上！', '{0} tags out, {1} tags in!'), sids: [prev.sid, p.sid] });
    fx.push({ type: 'tag', team: p.team, sid: p.sid, prev: prev ? prev.sid : null });
  }

  onRoundStart(fx) {
    this.clearRound();
    this.act = { claude: null, codex: null };
    // 气会留到下一回合（KOF 就是这样），血和状态清空
    for (const p of this.field()) Object.assign(p, { alive: true, hp: 100, combo: 0, guard: false, stun: 0 });
    for (const team of TEAMS) this.tagNext(team, fx);
    fx.push({ type: 'announce', text: `ROUND ${this.round}`, sub: 'FIGHT!', cls: 'gold', ms: 1500 });
  }

  // ---------------------------------------------------------------- 动作

  ghostOk() {
    return false; // 被 K.O. 的人这回合什么都做不了
  }

  onEvent(p, ev, r, fx) {
    if (this.phase !== 'live') return;
    if (ev.k === 'prompt') return this.gain(p, 25, L('加油！', 'Go go go!'), fx);
    if (ev.k === 'abort') return this.unplug(p, fx);
    if (ev.k === 'apierr') return this.hit(null, p, 8, { kind: 'self', cause: 'net' }, fx);
    if (ev.k === 'pr') {
      // 开 PR：不管在不在场上，冲上来就是瞬狱杀
      const c = this.cur(p.team);
      if (c !== p) this.tagIn(p, c, fx);
      return this.superMove(p, 'sky', r, fx);
    }
    if (!MOVES.has(ev.k)) return;
    if (this.claim(p, fx)) this.move(p, ev, r, fx);
    else this.support(p, ev, r, fx);
  }

  move(p, ev, r, fx) {
    if (ev.k === 'think') return this.gain(p, 6, null, fx);
    if (ev.k === 'compact') {
      Object.assign(p, { stun: 2, combo: 0 });
      return fx.push({ type: 'dizzy', sid: p.sid, n: 2 });
    }
    if (p.stun > 0) return fx.push({ type: 'dizzy', sid: p.sid, n: --p.stun });
    if (ev.ok === false) return this.counter(p, r, fx);
    const full = p.pow >= 100;
    if (ev.k === 'shell' && ev.hs && full) return this.superMove(p, 'super2', r, fx);
    if (ev.k === 'shell') return this.strike(p, ev.hs ? 'heavy' : 'rush', r, fx);
    if (ev.k === 'read') return this.strike(p, 'jab', r, fx);
    if (ev.k === 'misc') return this.strike(p, 'throw', r, fx);
    if (ev.k === 'web') return this.strike(p, 'fireball', r, fx);
    if (ev.k === 'done') return full ? this.superMove(p, 'super1', r, fx) : this.strike(p, 'uppercut', r, fx);
    if (ev.k === 'agent') return this.striker(p, null, MOVE.striker[0] + r() * 4, r, fx);
    p.guard = true; // 改代码：防御
    fx.push({ type: 'guard', sid: p.sid });
    this.gain(p, 10, null, fx);
  }

  gain(p, n, text, fx) {
    if (!p.alive) return;
    const was = p.pow;
    p.pow = Math.min(100, p.pow + n);
    if (text || (was < 100 && p.pow >= 100)) fx.push({ type: 'pow', sid: p.sid, text, max: was < 100 && p.pow >= 100 });
  }

  /** 连段：同一个人短时间内接着打中就 +1，挨一下就断。连段越长每下越痛一点。 */
  chain(p) {
    p.combo = this.now - p.comboT < COMBO_GAP ? p.combo + 1 : 1;
    p.comboT = this.now;
    return 1 + 0.04 * Math.min(p.combo - 1, 12);
  }

  strike(p, kind, r, fx) {
    const foe = this.foe(p, fx);
    const [lo, hi] = MOVE[kind];
    if (!foe) return fx.push({ type: 'atk', sid: p.sid, to: null, kind });
    const dmg = (lo + r() * (hi - lo)) * this.chain(p);
    fx.push({ type: 'atk', sid: p.sid, to: foe.sid, kind });
    this.hit(p, foe, this.power(p, dmg), { kind }, fx);
  }

  superMove(p, kind, r, fx) {
    const foe = this.foe(p, fx);
    const [lo, hi] = MOVE[kind];
    if (kind !== 'sky') p.pow = 0;
    if (!foe) return;
    const dmg = (lo + r() * (hi - lo)) * this.chain(p);
    fx.push({ type: 'super', sid: p.sid, to: foe.sid, kind, name: tr(kind), kanji: kind === 'sky' ? L('天', '天') : null });
    this.hit(p, foe, this.power(p, dmg), { kind, super: true }, fx);
  }

  /** 援护攻击：mate 为空就从场边随便叫一个队友，一个都没有就来个路人。 */
  striker(c, mate, base, r, fx) {
    const foe = this.foe(c, fx);
    if (!foe) return;
    if (!mate) {
      const mates = this.alive(c.team).filter((q) => q !== c);
      mate = mates.length ? mates[Math.floor(r() * mates.length)] : null;
    }
    fx.push({ type: 'striker', sid: mate ? mate.sid : null, team: c.team, to: foe.sid });
    this.hit(mate || c, foe, this.power(c, base), { kind: 'striker', combo: 0 }, fx);
  }

  /** 均衡火力 × 人少更痛 × 车轮战系数。 */
  power(p, dmg) {
    return dmg * DMG * this.relay(p.team) * this.balanceMult(p.team) * this.sizeMult();
  }

  /**
   * 车轮战系数：一次只有一个人在打，人多时一回合要 K.O. 好几个人，单下再痛一点。
   * 大乱斗 K.O. 一个就结束，所以抵掉底座均衡火力里的人数项。
   */
  relay(team) {
    const n = (this.field('claude').length + this.field('codex').length) / 2 || 1;
    if (!this.party) return n ** 0.75;
    return Math.sqrt((n * Math.max(1, this.field(team).length)) / Math.max(1, this.field(OTHER[team]).length));
  }

  hit(att, vic, dmg, info, fx) {
    if (!vic || !vic.alive) return;
    const guard = vic.guard && info.kind !== 'self';
    if (guard) Object.assign(vic, { guard: false });
    const d = clamp(Math.round(guard ? dmg * (info.super ? 0.6 : 0.35) : dmg), 1, vic.hp);
    vic.hp -= d;
    this.dealt += d;
    this.hurt[vic.team] += d;
    vic.combo = 0;
    vic.pow = Math.min(100, vic.pow + 4); // 挨打也涨气
    if (att && att.team !== vic.team) Object.assign(att, { dmg: att.dmg + d, pow: Math.min(100, att.pow + 3) });
    const combo = info.combo ?? (att ? att.combo : 0);
    fx.push({ type: 'hit', from: att ? att.sid : null, to: vic.sid, dmg: d, kind: info.kind, combo, guard, hp: vic.hp, super: !!info.super });
    if (vic.hp <= 0) this.ko(vic, att, info, fx);
  }

  ko(vic, att, info, fx) {
    Object.assign(vic, { alive: false, hp: 0, d: vic.d + 1 });
    this.kos[vic.team]++;
    const killer = att && att.team !== vic.team ? att : null;
    if (killer) killer.k++;
    fx.push({ type: 'kill', killer: killer ? killer.sid : null, victim: vic.sid, weapon: tr(info.kind), hs: !!info.super, cause: info.cause || 'hit', assist: null });
    fx.push({ type: 'ko', sid: vic.sid, team: vic.team });
    if (this.act[vic.team] !== vic.sid) return;
    this.act[vic.team] = null;
    // 大乱斗一个 K.O. 就结束；正赛下一个队友跳进来（全队倒下 check 会收尾）
    const nx = this.party ? null : this.nextUp(vic.team);
    if (nx) fx.push({ type: 'note', text: L('{0} 倒下了！{1} 跳进来接着打！', '{0} is down! {1} jumps in!'), sids: [vic.sid, nx.sid] });
    if (nx) this.tagIn(nx, null, fx);
  }

  // 报错 = 破绽被对面反击（固定伤害，不吃均衡火力，跟 CS 里被 Bug 咬一样）
  counter(p, r, fx) {
    p.combo = 0;
    const foe = this.cur(OTHER[p.team]);
    if (!foe) return fx.push({ type: 'atk', sid: p.sid, to: null, kind: 'rush' });
    fx.push({ type: 'atk', sid: foe.sid, to: p.sid, kind: 'counter' });
    this.hit(foe, p, 9 + r() * 4, { kind: 'counter', combo: 0 }, fx);
  }

  unplug(p, fx) {
    fx.push({ type: 'unplug', sid: p.sid });
    if (p.alive) this.ko(p, null, { kind: 'unplug', cause: 'human' }, fx);
  }

  // 场边的队友：攒援护，攒够了冲进来踹一脚。均衡火力按全队动作算，所以场边动作也要变成伤害
  support(p, ev, r, fx) {
    const c = this.cur(p.team);
    if (!c || ev.ok === false) return;
    if (ev.k === 'agent' || ev.k === 'done') return this.striker(c, p, MOVE.striker[0] + r() * 4, r, fx);
    if (ev.k === 'edit' || ev.k === 'think') return void (c.pow = Math.min(100, c.pow + 1));
    if (!BANK[ev.k]) return;
    c.pow = Math.min(100, c.pow + 2);
    this.bank[p.team] += BANK[ev.k];
    if (this.bank[p.team] < BANK_FULL) return fx.push({ type: 'cheer', sid: p.sid });
    const base = this.bank[p.team];
    this.bank[p.team] = 0;
    this.striker(c, p, base, r, fx);
  }

  // 它在等你 = 挑衅；及时回 = 玩家回来了（涨气）；超时 = 没人操作被连段打爆
  onWait(p, fx) {
    if (!p.alive) return;
    const foe = this.cur(OTHER[p.team]);
    if (foe) foe.pow = Math.max(0, foe.pow - 15);
    fx.push({ type: 'taunt', sid: p.sid });
  }

  onAnswer(p, wait, fx) {
    this.gain(p, 30, L('玩家回来了！', 'Player is back!'), fx);
  }

  onWaitTimeout(p, fx) {
    if (!p.alive) return;
    const foe = this.cur(OTHER[p.team]);
    fx.push({ type: 'beatdown', sid: p.sid, by: foe ? foe.sid : null });
    this.hit(foe, p, 35, { kind: 'beatdown', cause: 'c4', combo: 15 }, fx);
  }

  // ---------------------------------------------------------------- 胜负

  check(fx) {
    for (const team of TEAMS) {
      const f = this.field(team);
      if (!f.length || (this.party ? !this.kos[team] : f.some((p) => p.alive))) continue;
      const w = OTHER[team];
      fx.push({ type: 'announce', text: 'K.O.', cls: 'bad', ms: 1300 });
      if (!this.hurt[w]) fx.push({ type: 'announce', text: 'PERFECT!', sub: L(`${TEAM_NAME[w]} 一滴血都没掉`, `${TEAM_NAME[w]} took zero damage`), cls: 'gold', ms: 1600 });
      return this.endRound(w, 'ko', fx, 'K.O.!');
    }
  }

  timers() {
    return [this.roundStart + this.roundLen];
  }

  // 时间到：比剩余血量（按人数平均）
  onTick(fx) {
    if (this.now - this.roundStart < this.roundLen) return;
    if (!this.dealt) return void (this.roundStart = this.now);
    const w = this.leader();
    const sub = w ? L(`${TEAM_NAME[w]} 血多获胜`, `${TEAM_NAME[w]} wins on health`) : L('血量一样，平局', 'Dead even — draw');
    fx.push({ type: 'announce', text: 'TIME OVER', sub, cls: 'gold', ms: 1600 });
    this.endRound(w, 'time', fx, L('TIME OVER · 血多者胜', 'TIME OVER · more HP wins'));
  }

  leader() {
    const hp = (t) => this.field(t).reduce((s, p) => s + (p.alive ? p.hp : 0), 0) / Math.max(1, this.field(t).length);
    const [a, b] = [hp('claude'), hp('codex')];
    return a === b ? null : a > b ? 'claude' : 'codex';
  }
}

// ================================================================ 场景
// 黄昏的街头：远处楼群、近处霓虹招牌、栏杆后面一排围观群众。几层按不同速度跟着镜头动。

const { w: W, h: H } = WORLD;
const GROUND = 820;
const HOME_X = { claude: 560, codex: 1040 };
const SC = 1.3; // 小人放大倍数
const SIGNS = () => [L('街机厅', 'ARCADE'), L('拉面', 'RAMEN'), 'KOF 98', L('投币', 'INSERT COIN'), L('大排档', 'NOODLES'), L('游戏厅', 'GAME CENTER'), L('烧烤', 'BBQ'), L('网吧', 'NET CAFE'), L('老板来两个币', '2 COINS PLS')];
const SCENE = (() => {
  const r = rng(98);
  const far = [];
  for (let x = -260; x < W + 260; x += 6 + r() * 14) {
    const [w, h] = [70 + r() * 110, 140 + r() * 250];
    const wins = [];
    for (let wy = 18; wy < h - 20; wy += 26) for (let wx = 12; wx < w - 14; wx += 22) if (r() < 0.35) wins.push([wx, wy]);
    far.push({ x, w, h, wins });
    x += w;
  }
  const neon = ['#ff4fa0', '#4ff0ff', '#ffe14f', '#7cff6a', '#ff7a3d'];
  const signs = [];
  for (let i = 0, x = -200; x < W + 240; i++, x += 20 + r() * 40) {
    const w = 170 + r() * 120;
    signs.push({ x, w, h: 150 + r() * 70, word: i % 9, c: neon[Math.floor(r() * neon.length)], body: r() < 0.5 ? '#2c2440' : '#33284a' });
    x += w;
  }
  const crowd = [];
  for (let x = -180; x < W + 180; x += 22 + r() * 16) crowd.push({ x, h: 56 + r() * 34, hue: Math.floor(r() * 360), sat: 20 + r() * 25, lit: 18 + r() * 14, ph: r() * 6, back: r() < 0.45 });
  return { far, signs, crowd };
})();

// ================================================================ 小人
// 骨架：所有角度从「竖直向下」算起，正值朝自己面对的方向。[大臂, 小臂]、[大腿, 小腿]。

const POSES = {
  idle: { lean: 0.12, fa: [0.9, 2.3], ba: [0.5, 2.1], fl: [0.45, -0.05], bl: [-0.35, -0.45] },
  punch: { lean: 0.3, fa: [1.6, 1.6], ba: [0.2, 1.9], fl: [0.6, 0.1], bl: [-0.5, -0.5] },
  kick: { lean: -0.35, fa: [0.6, 2.2], ba: [-0.4, 0.8], fl: [1.65, 1.6], bl: [-0.15, -0.15] },
  fireball: { lean: 0.3, fa: [1.5, 1.55], ba: [1.35, 1.5], fl: [0.7, 0.1], bl: [-0.6, -0.6] },
  upper: { lean: 0.15, fa: [2.9, 3.05], ba: [0.3, 1.2], fl: [1.4, 0.2], bl: [-0.15, -0.1] },
  hit: { lean: -0.45, fa: [-0.3, 0.6], ba: [-0.8, -0.2], fl: [0.3, 0.1], bl: [-0.4, -0.3] },
  guard: { lean: -0.05, fa: [1.0, 2.7], ba: [0.8, 2.6], fl: [0.35, -0.05], bl: [-0.4, -0.5] },
  taunt: { lean: 0.05, fa: [1.5, 2.6], ba: [0.2, 0.6], fl: [0.25, 0], bl: [-0.25, -0.2] },
  win: { lean: 0, fa: [3.0, 3.1], ba: [0.4, 1.0], fl: [0.2, 0], bl: [-0.2, 0] },
  charge: { lean: 0, fa: [0.5, 1.4], ba: [0.5, 1.4], fl: [0.6, 0.15], bl: [-0.6, -0.15] },
  throw: { lean: 0.4, fa: [1.4, 1.2], ba: [1.3, 1.1], fl: [0.5, 0], bl: [-0.6, -0.6] },
};
const LIMB = { th: 46, sh: 46, to: 60, ua: 34, fa: 32, hr: 19 };
const KEYS = ['fa', 'ba', 'fl', 'bl'];
const clonePose = (name) => JSON.parse(JSON.stringify(POSES[name]));
const reach = (x, y, a, len) => [x + Math.sin(a) * len, y + Math.cos(a) * len];
// 出招动作：[姿势, 时长, 往前冲多少（按两人间距的比例）]
const ATK = { rush: ['punch', 0.24, 0.6], jab: ['punch', 0.16, 0.4], heavy: ['kick', 0.36, 0.7], throw: ['throw', 0.4, 0.8], fireball: ['fireball', 0.5, 0], uppercut: ['upper', 0.55, 0.8], counter: ['punch', 0.26, 0.7] };
const SHOUT = () => ({ throw: L('抓！', 'Gotcha!'), fireball: L('阿杜根！', 'Hadouken!'), uppercut: L('升龙拳！', 'Shoryuken!'), super1: L('真·升龙拳！', 'Shin Shoryuken!'), super2: L('真空——波动拳！', 'Shinku… Hadouken!'), sky: L('瞬狱杀！', 'Shun Goku Satsu!') });

class Fighter {
  constructor(sid, team, enter) {
    Object.assign(this, { sid, team, face: team === 'claude' ? 1 : -1, homeX: HOME_X[team], y: 0, pose: 'idle', poseT: 0, ang: clonePose('idle') });
    this.x = this.from = enter ? (team === 'claude' ? -140 : W + 140) : this.homeX;
    Object.assign(this, { enterT: enter ? 0 : 9, dash: null, push: 0, jumpT: 0, flash: 0, ko: false, koT: 0, leaving: false, leaveT: 0, label: null, shout: null });
  }

  act(pose, t, dash = 0) {
    if (this.ko) return;
    Object.assign(this, { pose, poseT: t });
    if (dash) this.dash = { t: 0, dur: t, dist: dash };
    if (pose === 'upper') this.jumpT = 0.55;
  }

  say(text, life = 1.1) {
    this.shout = { text, life, max: life };
  }

  update(dt, rt) {
    this.poseT -= dt;
    if (this.poseT <= 0 && !this.ko) this.pose = 'idle';
    const target = POSES[this.ko ? 'hit' : this.pose];
    const k = 1 - Math.exp(-dt * 20); // 关节角度往目标姿势平滑过渡
    this.ang.lean += (target.lean - this.ang.lean) * k;
    for (const key of KEYS) for (let i = 0; i < 2; i++) this.ang[key][i] += (target[key][i] - this.ang[key][i]) * k;
    this.flash = Math.max(0, this.flash - dt);
    this.push *= Math.exp(-dt * 5);
    if (this.label && (this.label.life -= dt) <= 0) this.label = null;
    if (this.shout && (this.shout.life -= dt) <= 0) this.shout = null;
    let off = 0;
    if (this.dash) {
      this.dash.t += dt;
      off = this.dash.dist * Math.sin(Math.min(1, this.dash.t / this.dash.dur) * Math.PI);
      if (this.dash.t >= this.dash.dur) this.dash = null;
    }
    this.jumpT = Math.max(0, this.jumpT - dt);
    this.y = this.jumpT > 0 ? 150 * Math.sin((1 - this.jumpT / 0.55) * Math.PI) : 0;
    if (this.enterT < 0.55) {
      // 跳进场：从边上一个大跳落到站位
      const q = Math.min(1, (this.enterT += dt) / 0.55);
      this.x = this.from + (this.homeX - this.from) * q;
      this.y = 220 * Math.sin(q * Math.PI);
      return;
    }
    if (this.leaving) {
      // 下场：没倒下的往后一跳出画面；倒下的躺着淡出
      this.leaveT += dt;
      if (!this.ko) this.x -= this.face * 900 * dt;
      if (!this.ko) this.y = 180 * Math.sin(Math.min(1, this.leaveT / 0.5) * Math.PI);
      return;
    }
    if (this.ko && (this.koT += dt) < 0.5) this.y = 120 * Math.sin((this.koT / 0.5) * Math.PI);
    this.push = Math.min(this.push, Math.abs(this.homeX - (this.face > 0 ? 90 : W - 90))); // 别被打出画面
    this.x = this.homeX + this.face * off - this.face * this.push;
  }

  done() {
    return this.leaving && this.leaveT > (this.ko ? 1.4 : 0.6);
  }
}

/** 画一个小人：道服是队伍色，红头带飘带往后飘。dim 是场边的队友。 */
function drawFighter(g, f, rt, { scale = SC, alpha = 1, dim = false, dizzy = false, max = false } = {}) {
  const a = f.ang;
  const [col, deep, skin] = [dim ? DEEP[f.team] : COLOR[f.team], DEEP[f.team], '#f0c49a'];
  g.save();
  g.globalAlpha = alpha * (f.leaving && f.ko ? Math.max(0, 1 - (f.leaveT - 0.6) / 0.8) : 1);
  oval(g, f.x, GROUND + 4, 60 * scale * (1 - Math.min(0.5, f.y / 400)), 10 * scale, 'rgba(0,0,0,0.35)');
  g.translate(f.x, GROUND - f.y);
  g.scale(f.face * scale, scale);
  if (f.ko) g.rotate((-Math.min(1, f.koT / 0.4) * Math.PI) / 2); // 往后倒
  const ext = (q) => LIMB.th * Math.cos(q[0]) + LIMB.sh * Math.cos(q[1]);
  const bob = f.pose === 'idle' && !f.ko ? Math.sin(rt * 6 + f.face) * 3 : 0;
  const hip = [0, -Math.max(ext(a.fl), ext(a.bl)) + bob];
  const neck = reach(hip[0], hip[1], Math.PI - a.lean, LIMB.to);
  const head = reach(neck[0], neck[1], Math.PI - a.lean, LIMB.hr + 6);
  const limb = (from, q, l1, l2, c1, c2, w1, w2, end) => {
    const mid = reach(from[0], from[1], q[0], l1);
    const tip = reach(mid[0], mid[1], q[1], l2);
    seg(g, from, mid, c1, w1);
    seg(g, mid, tip, c2, w2);
    dot(g, tip[0], tip[1], w2 * 0.62, end);
  };
  if (max) oval(g, 0, -110, 90, 140, `rgba(255,220,90,${0.18 + 0.12 * Math.sin(rt * 14)})`); // 气满了：一圈金光
  limb(neck, a.ba, LIMB.ua, LIMB.fa, deep, '#c99a72', 15, 12, '#c99a72');
  limb(hip, a.bl, LIMB.th, LIMB.sh, deep, deep, 19, 16, '#2a2a2a');
  seg(g, hip, neck, col, 34); // 道服
  seg(g, [hip[0] - 17, hip[1] - 4], [hip[0] + 17, hip[1] - 4], '#1c1c1c', 7); // 黑腰带
  limb(hip, a.fl, LIMB.th, LIMB.sh, col, col, 19, 16, '#2a2a2a');
  dot(g, head[0], head[1], LIMB.hr, skin);
  g.fillStyle = '#1e1a18';
  g.beginPath();
  g.arc(head[0], head[1] - 3, LIMB.hr, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();
  rr(g, head[0] - LIMB.hr, head[1] - 8, LIMB.hr * 2, 7, 0, '#d8282e');
  Object.assign(g, { strokeStyle: '#d8282e', lineWidth: 5 });
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    g.moveTo(head[0] - LIMB.hr, head[1] - 5);
    for (let s = 1; s <= 4; s++) g.lineTo(head[0] - LIMB.hr - s * 9, head[1] - 5 + i * 6 + Math.sin(rt * 12 + s + i) * 4 + s * 2);
    g.stroke();
  }
  dot(g, head[0] + 9, head[1] + 1, 2.6, '#111');
  limb(neck, a.fa, LIMB.ua, LIMB.fa, col, skin, 16, 13, skin);
  g.restore();
  if (f.flash > 0) dot(g, f.x, GROUND - f.y - 120 * scale, 70 * scale, `rgba(255,255,255,${f.flash * 4})`);
  // 眩晕：头上转三颗星
  for (let i = 0; dizzy && !f.ko && i < 3; i++) {
    const t = rt * 5 + (i * Math.PI * 2) / 3;
    star(g, f.x + Math.cos(t) * 40, GROUND - f.y - 205 * scale + Math.sin(t) * 10, 11, '#ffe24a');
  }
}

// ================================================================ 画面

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    this.main = { claude: null, codex: null };
    this.extras = []; // 下场 / 倒下的人，播完动画就删
    this.combo = { claude: null, codex: null };
    this.bars = new Map(); // sid → { v: 显示血量, trail: 红色残影 }
    this.cheers = new Map();
    Object.assign(this, { strikers: [], balls: [], timers: [], sup: null, freeze: 0, hype: 0, cam: 0, challenger: 0 });
    if (R) this.sync(R, true);
  }

  /** 场上该站谁就让谁站上来：换人时旧的跳出去（倒下的躺着淡出），新的从边上跳进来。 */
  sync(R, hard) {
    for (const team of TEAMS) {
      const p = R.players.get(R.act[team]);
      const want = p && p.onField && p.alive ? p.sid : null;
      const m = this.main[team];
      if ((m && m.sid === want && !m.ko) || (!want && m && m.ko && !hard)) continue; // 倒下了还没人接：先躺着
      if (m && !hard) this.extras.push(Object.assign(m, { leaving: true }));
      this.main[team] = want ? new Fighter(want, team, !hard) : null;
    }
  }

  fighter(sid) {
    return TEAMS.map((t) => this.main[t]).find((m) => sid && m && m.sid === sid) || null;
  }

  after(sec, fn) {
    if (sec <= 0) fn();
    else this.timers.push({ t: sec, fn });
  }

  // ---------------------------------------------------------------- 效果进来

  apply(list, R, busy) {
    const { app, fx } = this;
    let delay = 0; // 波动拳要飞一会儿、超必杀要先黑屏，后面的命中晚一点播
    for (const f of list) {
      const a = this.fighter(f.sid);
      switch (f.type) {
        case 'act': {
          const text = actText(f.ev);
          if (a && text && f.ev.k !== 'think' && !busy) a.label = { text, ok: f.ev.ok !== false, life: 1.6 };
          break;
        }
        case 'join':
          if (R.phase === 'live' && !busy) this.challenger = 2.2;
          break;
        case 'atk':
          delay = busy ? 0 : f.kind === 'fireball' ? 0.32 : 0.1;
          if (a) this.attackFx(a, this.fighter(f.to), f, busy);
          break;
        case 'super':
          delay = busy ? 0 : 0.75;
          if (a) this.superFx(a, f, busy);
          break;
        case 'striker':
          delay = busy ? 0 : 0.38;
          if (!busy) this.strikerFx(f, R);
          break;
        case 'hit':
          this.after(delay, () => this.hitFx(f, busy));
          break;
        case 'ko':
          this.after(delay, () => {
            const v = this.fighter(f.sid);
            if (!v) return;
            Object.assign(v, { ko: true, koT: 0, push: v.push + 150 });
            fx.text(v.x, GROUND - 320, 'K.O.', '#ff3a3a', 44, 1.6);
            app.shake(0.5, 10);
            app.sfx.boom(false);
          });
          break;
        case 'dizzy':
          if (a && f.n === 2 && !busy) a.say(L('眼冒金星……', 'Seeing stars…'), 1.2);
          break;
        case 'guard':
          if (a) a.act('guard', 0.6);
          break;
        case 'pow':
          if (!a || busy) break;
          if (f.text) a.say(f.text, 1.2);
          if (!f.max) break;
          fx.text(a.x, GROUND - 330, 'MAX!!', '#ffd84a', 34, 1.3);
          a.act('charge', 0.6);
          if (app.sfx.ok(1)) app.sfx.tone(220, 0.4, 0.07, 'square', 880);
          break;
        case 'taunt':
          a?.act('taunt', 1.4);
          a?.say(L('来啊，快活啊！', 'Come on, bring it!'), 2.2);
          break;
        case 'beatdown':
          a?.say(L('被连段打爆……', 'Comboed to death…'), 1.6);
          for (let i = 0; a && !busy && i < 8; i++) this.after(i * 0.07, () => this.spark(a.x - a.face * 10, GROUND - 120 * SC - rand(-40, 40), '#fff3b0', false));
          break;
        case 'unplug':
          a?.say(L('你拔了手柄！？', 'You unplugged me?!'), 2);
          if (a && !busy) fx.text(a.x, GROUND - 380, '🎮 ✂', '#fff', 40, 1.8);
          break;
        case 'cheer':
          this.cheers.set(f.sid, 0.5);
          this.hype = Math.min(1, this.hype + 0.08);
          break;
        case 'roundEnd': {
          this.freeze = busy ? 0.3 : 1.9; // 先让 K.O. 和胜利姿势播完再换下一回合
          const w = f.winner && this.main[f.winner];
          if (w) this.after(busy ? 0 : 0.6, () => w.act('win', 1.6));
          break;
        }
      }
    }
  }

  attackFx(a, v, f, busy) {
    const [pose, t, dash] = ATK[f.kind] || ATK.rush;
    const gap = v ? Math.max(0, Math.abs(v.x - a.x) - 190) : 60;
    a.act(f.kind === 'rush' && Math.random() < 0.5 ? 'kick' : pose, t, gap * dash);
    if (busy) return;
    if (SHOUT()[f.kind]) a.say(SHOUT()[f.kind], f.kind === 'throw' ? 0.6 : 1.1);
    if (f.kind === 'counter') this.fx.text(a.x, GROUND - 300, 'COUNTER!', '#ff5a5a', 30, 1);
    if (f.kind !== 'fireball') return;
    this.balls.push({ x: a.x + a.face * 100, face: a.face, to: v ? v.x : a.x + a.face * 700, t: 0, dur: 0.32 });
    if (this.app.sfx.ok(1)) this.app.sfx.tone(300, 0.3, 0.08, 'sawtooth', 120);
  }

  superFx(a, f, busy) {
    a.act({ super2: 'fireball', super1: 'upper' }[f.kind] || 'punch', 0.9);
    if (busy) return;
    this.sup = { t: 0, dur: 1.2, sid: f.sid, team: a.team, name: f.name, kanji: f.kanji };
    a.say(SHOUT()[f.kind], 1.4);
    if (f.kind === 'super2') this.after(0.45, () => this.balls.push({ x: a.x + a.face * 100, face: a.face, to: (this.fighter(f.to) || a).x, t: 0, dur: 0.3, big: true }));
    this.app.sfx.boom(true);
  }

  // 援护：队友从后面飞身一脚踹过来，再弹出画面
  strikerFx(f, R) {
    const c = this.main[f.team];
    const v = this.fighter(f.to);
    if (!c || !v) return;
    const s = new Fighter(f.sid || 'cpu', f.team, false);
    s.x = c.x - c.face * 380;
    s.act('kick', 1.2);
    this.strikers.push({ f: s, t: 0, x0: s.x, x1: v.x - c.face * 110, name: f.sid ? R.players.get(f.sid)?.name || L('队友', 'Teammate') : L('路人', 'Passerby') });
  }

  hitFx(f, busy) {
    const { app, fx } = this;
    const v = this.fighter(f.to);
    if (!v || v.ko) return;
    const [x, y] = [v.x - v.face * 14, GROUND - v.y - 125 * SC];
    if (f.guard) {
      v.act('guard', 0.35);
      v.push += 18;
      fx.sparks(x, y, '#8fd0ff', busy ? 3 : 10, 220);
      if (!busy) fx.text(v.x, GROUND - 300, 'GUARD', '#8fd0ff', 26, 0.8);
      return;
    }
    const heavy = f.super || ['heavy', 'uppercut', 'striker', 'beatdown'].includes(f.kind);
    v.act('hit', f.super ? 0.6 : 0.3);
    v.flash = 0.12;
    v.push += f.super ? 130 : heavy ? 60 : 26;
    this.spark(x, y, f.super ? '#ffe46a' : '#fff6d0', f.super || f.kind === 'heavy' || f.kind === 'uppercut');
    this.hype = Math.min(1, this.hype + (f.super ? 0.6 : 0.12));
    if (f.combo >= 2) this.combo[OTHER[v.team]] = { n: f.combo, t: 1.8 };
    if (heavy) app.shake(f.super || f.kind === 'beatdown' ? 0.45 : 0.2, f.super || f.kind === 'beatdown' ? 12 : 6);
    if (f.combo >= 5 && f.combo % 5 === 0 && !busy) this.main[OTHER[v.team]]?.say(L('嗒嗒嗒嗒嗒！', 'Tatsumaki Senpukyaku!'), 0.9);
    if (app.sfx.ok(f.super ? 2 : 0)) app.sfx.burst(f.super ? 0.4 : 0.09, f.super ? 300 : 900, f.super ? 0.3 : 0.18, 'lowpass');
  }

  spark(x, y, color, big) {
    this.fx.sparks(x, y, color, big ? 18 : 8, big ? 320 : 200);
    this.fx.ring(x, y, 6, big ? 90 : 46, color, big ? 0.35 : 0.22, big ? 8 : 5);
  }

  // ---------------------------------------------------------------- 每帧

  update(dt, R) {
    const rt = this.app.rt();
    this.fx.update(dt);
    for (const t of this.timers) t.t -= dt;
    const due = this.timers.filter((t) => t.t <= 0);
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const t of due) t.fn();
    if (this.freeze > 0) this.freeze -= dt;
    else this.sync(R, false);
    for (const team of TEAMS) {
      this.main[team]?.update(dt, rt);
      if (this.combo[team] && (this.combo[team].t -= dt) <= 0) this.combo[team] = null;
    }
    for (const e of this.extras) e.update(dt, rt);
    this.extras = this.extras.filter((e) => !e.done());
    for (const s of this.strikers) {
      const q = Math.min(1, (s.t += dt) / 0.38);
      s.f.x = s.t < 0.38 ? s.x0 + (s.x1 - s.x0) * q : s.f.x - s.f.face * 700 * dt;
      s.f.y = s.t < 0.38 ? 160 * Math.sin(q * Math.PI * 0.9) + 40 : 40 + 300 * (s.t - 0.38);
      s.f.update(0, rt);
    }
    this.strikers = this.strikers.filter((s) => s.t < 0.9);
    for (const b of this.balls) b.t += dt;
    this.balls = this.balls.filter((b) => b.t < b.dur);
    if (this.sup && (this.sup.t += dt) > this.sup.dur) this.sup = null;
    for (const [sid, t] of this.cheers) if (t <= dt) this.cheers.delete(sid);
    else this.cheers.set(sid, t - dt);
    this.hype = Math.max(0, this.hype - dt * 0.25);
    this.challenger = Math.max(0, this.challenger - dt);
    // 血条：黄的快速跟上，红色残影慢慢退
    for (const p of R.field()) {
      if (!this.bars.has(p.sid)) this.bars.set(p.sid, { v: p.hp, trail: p.hp });
      const b = this.bars.get(p.sid);
      b.v += (p.hp - b.v) * Math.min(1, dt * 10);
      b.trail = b.trail > b.v ? Math.max(b.v, b.trail - dt * 25) : b.v;
    }
    // 镜头跟着两个人的中点轻轻晃
    const [a, c] = [this.main.claude, this.main.codex];
    const mid = a && c ? (a.x + c.x) / 2 : W / 2;
    this.cam += (clamp(mid - W / 2, -160, 160) + Math.sin(rt * 0.15) * 30 - this.cam) * Math.min(1, dt * 3);
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    this.drawStage(g, rt);
    this.drawBench(g, R, rt);
    for (const e of this.extras) drawFighter(g, e, rt);
    const supF = this.sup ? this.fighter(this.sup.sid) : null;
    const mains = TEAMS.map((t) => this.main[t]).filter(Boolean);
    for (const m of mains) if (m !== supF) this.drawMain(g, R, m, rt);
    for (const s of this.strikers) {
      drawFighter(g, s.f, rt, { scale: SC * 0.85, alpha: 0.92 });
      pill(g, s.f.x, GROUND - s.f.y - 260, L(`援护！${s.name}`, `Assist! ${s.name}`), { color: COLOR[s.f.team], size: fontFor(scale, 14), max: 220 });
    }
    for (const b of this.balls) {
      // 波动拳：蓝白色的气团，超必杀版是橙色的大团
      const [x, y, r] = [b.x + (b.to - b.x) * (b.t / b.dur), GROUND - 150 * SC * 0.82, b.big ? 70 : 34];
      oval(g, x - b.face * r * 0.6, y, r * 1.6, r * 0.8, b.big ? 'rgba(255,180,60,0.35)' : 'rgba(90,170,255,0.35)');
      dot(g, x, y, r, b.big ? '#ffd27a' : '#7cc4ff');
      dot(g, x, y, r * 0.5 + Math.sin(rt * 40) * 3, '#fff');
    }
    if (this.sup) this.drawSuper(g, R, rt, supF);
    this.fx.renderOver(g, scale);
    for (const m of mains) this.drawTags(g, m, scale);
    for (const team of TEAMS) this.drawCombo(g, team);
    this.drawHud(g, R, rt, scale);
    if (this.challenger <= 0) return;
    g.globalAlpha = Math.min(1, this.challenger * 2) * (Math.floor(rt * 6) % 2 ? 1 : 0.75);
    outline(g, 'HERE COMES A NEW CHALLENGER!', W / 2, 330, 'italic 900 56px', '#ffd84a', '#3a0a0a', 8);
    g.globalAlpha = 1;
  }

  drawMain(g, R, m, rt) {
    const p = R.players.get(m.sid);
    drawFighter(g, m, rt, { dizzy: !!(p && p.stun > 0), max: !!(p && p.pow >= 100 && p.alive) });
  }

  drawStage(g, rt) {
    const cam = this.cam;
    const sky = g.createLinearGradient(0, 0, 0, 700);
    sky.addColorStop(0, '#24163f');
    sky.addColorStop(0.55, '#a24a78');
    sky.addColorStop(1, '#f2a56a');
    rr(g, 0, 0, W, 700, 0, sky);
    dot(g, 1240 - cam * 0.05, 470, 120, 'rgba(255,214,140,0.85)'); // 夕阳
    for (const b of SCENE.far) {
      // 远处楼群 + 亮着的窗户
      const x = b.x - cam * 0.15;
      if (x > W + 20 || x + b.w < -20) continue;
      rr(g, x, 600 - b.h, b.w, b.h + 100, 0, '#2d2048');
      g.fillStyle = 'rgba(255,220,130,0.55)';
      for (const [wx, wy] of b.wins) g.fillRect(x + wx, 600 - b.h + wy, 8, 11);
    }
    const words = SIGNS();
    for (const s of SCENE.signs) {
      // 近处霓虹招牌，偶尔闪一下
      const x = s.x - cam * 0.4;
      if (x > W + 20 || x + s.w < -20) continue;
      const on = Math.sin(rt * 3 + s.x) > -0.85;
      const top = 640 - s.h;
      rr(g, x, top, s.w, s.h + 60, 0, s.body);
      rr(g, x + 12, top + 14, s.w - 24, 50, 0, null, on ? s.c : 'rgba(120,120,140,0.5)', 3);
      g.font = `900 30px ${FONT}`;
      Object.assign(g, { textAlign: 'center', textBaseline: 'middle', fillStyle: on ? s.c : 'rgba(120,120,140,0.6)' });
      g.fillText(words[s.word], x + s.w / 2, top + 40, s.w - 34);
      rr(g, x + 20, top + 82, s.w - 40, s.h - 100, 0, 'rgba(255,230,160,0.18)');
    }
    for (const back of [true, false]) {
      // 围观群众：打得越热闹越起劲，hype 高了还举手
      for (const c of SCENE.crowd) {
        const x = c.x - cam * 0.7;
        if (c.back !== back || x < -30 || x > W + 30) continue;
        const jump = Math.max(0, Math.sin(rt * (5 + this.hype * 6) + c.ph)) * (4 + this.hype * 16);
        const top = (back ? 668 : 692) - c.h - jump;
        const color = `hsl(${c.hue},${c.sat}%,${c.lit + (back ? 0 : 6)}%)`;
        rr(g, x - 11, top + 18, 22, c.h, 8, color);
        dot(g, x, top + 10, 10, color);
        if (this.hype > 0.35) {
          seg(g, [x - 8, top + 24], [x - 16, top - 4], color, 6);
          seg(g, [x + 8, top + 24], [x + 16, top - 4], color, 6);
        }
      }
    }
    rr(g, 0, 676, W, 8, 0, '#5d566e'); // 栏杆
    for (let x = ((-cam * 0.85) % 80) - 80; x < W + 80; x += 80) g.fillRect(x, 676, 6, 34);
    const gr = g.createLinearGradient(0, 700, 0, H);
    gr.addColorStop(0, '#4a4258');
    gr.addColorStop(1, '#2a2434');
    rr(g, 0, 706, W, H - 706, 0, gr);
    for (let i = -14; i <= 14; i++) seg(g, [W / 2 + i * 60 - cam * 0.9, 706], [W / 2 + i * 220 - cam * 1.4, H], 'rgba(255,255,255,0.07)', 2);
    g.fillStyle = 'rgba(255,235,140,0.35)';
    for (let x = ((-cam * 1.1) % 160) - 160; x < W + 160; x += 160) g.fillRect(x, 890, 80, 8);
  }

  // 场边等着上场的队友：小一号、颜色暗一点，攒援护时会举手
  drawBench(g, R, rt) {
    for (const team of TEAMS) {
      const m = this.main[team];
      R.field(team).filter((p) => p.alive && (!m || p.sid !== m.sid)).slice(0, 4).forEach((p, i) => {
        const f = new Fighter(p.sid, team, false);
        const cheer = this.cheers.get(p.sid);
        f.x = team === 'claude' ? 110 + i * 64 : W - 110 - i * 64;
        f.ang = clonePose(cheer ? 'win' : 'idle');
        f.y = cheer ? Math.sin((cheer / 0.5) * Math.PI) * 30 : 0;
        drawFighter(g, f, rt, { scale: SC * 0.62, alpha: 0.85, dim: true });
      });
    }
  }

  // 超必杀：全屏变暗、出招的人亮着、斜着一条切入横幅 + 大字
  drawSuper(g, R, rt, f) {
    const s = this.sup;
    const fade = Math.min(1, s.t / 0.12, (s.dur - s.t) / 0.25);
    rr(g, 0, 0, W, H, 0, `rgba(0,0,0,${0.72 * fade})`);
    if (s.kanji) {
      g.globalAlpha = 0.85 * fade;
      outline(g, s.kanji, W / 2, 470, '900 520px', '#c8101a');
      g.globalAlpha = 1;
    }
    if (f) this.drawMain(g, R, f, rt);
    g.save();
    g.globalAlpha = fade;
    g.translate(W / 2, 470);
    g.rotate(-0.08);
    const slide = (1 - Math.min(1, (s.t / s.dur) * 4)) * W;
    const band = g.createLinearGradient(-W, 0, W, 0);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.5, DEEP[s.team]);
    band.addColorStop(1, 'rgba(0,0,0,0)');
    rr(g, -W + slide, -70, W * 2, 140, 0, band);
    outline(g, s.name, slide * 0.3, 0, 'italic 900 92px', '#ffd84a', '#2a0800', 10);
    outline(g, L('超 必 杀', 'SUPER COMBO'), slide * 0.3, -88, '900 30px', '#fff');
    g.restore();
  }

  drawTags(g, m, scale) {
    const top = GROUND - m.y - 250 * SC;
    if (m.label) {
      g.globalAlpha = Math.min(1, m.label.life / 0.4);
      pill(g, m.x, top - 8, m.label.text, { size: fontFor(scale, 14), max: 260, weight: 500, bg: m.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.85)' });
      g.globalAlpha = 1;
    }
    if (!m.shout) return;
    // 喊招式名的对话框，刚喊出来时弹一下
    const s = m.shout;
    const pop = 1 + 0.25 * Math.max(0, 1 - (s.max - s.life) / 0.15);
    g.save();
    g.translate(m.x + m.face * 40, top - 56);
    g.scale(pop, pop);
    g.globalAlpha = Math.min(1, s.life / 0.3);
    g.font = `900 34px ${FONT}`;
    const w = g.measureText(s.text).width + 34;
    rr(g, -w / 2, -30, w, 60, 22, '#fff', '#111', 4);
    outline(g, s.text, 0, 1, '900 34px', '#c8101a');
    g.restore();
  }

  drawCombo(g, team) {
    const c = this.combo[team];
    if (!c) return;
    const pop = 1 + 0.4 * Math.max(0, (c.t - 1.6) / 0.2);
    g.save();
    g.translate(team === 'claude' ? 200 : W - 200, 330);
    g.scale(pop, pop);
    g.globalAlpha = Math.min(1, c.t / 0.4);
    outline(g, String(c.n), 0, 0, 'italic 900 110px', '#ffcf3a', '#5a0a00', 9);
    outline(g, 'HITS!', 0, 70, 'italic 900 44px', '#ff7a2a', '#5a0a00', 9);
    g.restore();
  }

  // KOF 风格：顶部两条血条（从中间往外扣）+ 中间计时器，名字和队伍人头在血条下面，底部气槽
  drawHud(g, R, rt, scale) {
    const [BW, top] = [640, 54];
    for (const team of TEAMS) {
      const left = team === 'claude';
      const m = this.main[team];
      const p = m ? R.players.get(m.sid) : null;
      const x0 = left ? 80 : W - 80 - BW;
      rr(g, x0 - 6, top - 6, BW + 12, 44, 8, '#1a1420');
      rr(g, x0, top, BW, 32, 0, '#5a1010');
      if (p) {
        const b = this.bars.get(p.sid) || { v: p.hp, trail: p.hp };
        const [v, tr] = [clamp(b.v / 100, 0, 1), clamp(b.trail / 100, 0, 1)];
        const at = (fr) => (left ? x0 + BW * (1 - fr) : x0); // 左边的条贴着右端，右边的贴着左端
        rr(g, at(tr), top, BW * tr, 32, 0, '#ff3b2f');
        const bar = g.createLinearGradient(0, top, 0, top + 32);
        bar.addColorStop(0, v > 0.3 ? '#fff38a' : '#ffb0a0');
        bar.addColorStop(1, v > 0.3 ? '#f2b21a' : '#e8402a');
        rr(g, at(v), top, BW * v, 32, 0, bar);
      }
      g.font = `900 ${Math.max(26, fontFor(scale, 18))}px ${FONT}`;
      const name = p ? fitText(g, p.name, 420) : L('等待挑战者……', 'Waiting for a challenger…');
      outline(g, name, left ? x0 : x0 + BW, top + 62, `900 ${Math.max(26, fontFor(scale, 18))}px`, COLOR[team], '#120c18', 5, left ? 'left' : 'right');
      R.field(team).slice(0, 6).forEach((q, i) => {
        // 队伍人头：场上的亮，倒下的打叉
        const [hx, hy] = [left ? x0 + 18 + i * 40 : x0 + BW - 18 - i * 40, top + 104];
        dot(g, hx, hy, 15, q.alive ? (m && q.sid === m.sid ? COLOR[team] : DEEP[team]) : '#444');
        rr(g, hx - 15, hy - 6, 30, 5, 0, '#d8282e');
        if (!q.alive) seg(g, [hx - 11, hy - 11], [hx + 11, hy + 11], '#ff4040', 4);
        if (!q.alive) seg(g, [hx + 11, hy - 11], [hx - 11, hy + 11], '#ff4040', 4);
      });
      const [pw, py, pow] = [420, 918, p ? p.pow / 100 : 0];
      const px = left ? 80 : W - 80 - pw;
      rr(g, px - 4, py - 4, pw + 8, 30, 0, '#120c18');
      rr(g, left ? px : px + pw * (1 - pow), py, pw * pow, 22, 0, pow >= 1 ? (Math.floor(rt * 8) % 2 ? '#ffe14a' : '#ff8a2a') : '#3ab0ff');
      outline(g, pow >= 1 ? 'MAX' : 'POW', left ? px + pw + 14 : px - 14, py + 11, 'italic 900 28px', pow >= 1 ? '#ffe14a' : '#fff', null, 0, left ? 'left' : 'right');
    }
    rr(g, W / 2 - 62, top - 16, 124, 92, 12, '#120c18', '#ffd84a', 3);
    const left = R.phase === 'live' ? Math.max(0, R.roundLen - (R.now - R.roundStart)) : -1;
    const num = left < 0 ? '∞' : String(Math.ceil((99 * left) / R.roundLen));
    outline(g, num, W / 2, top + 30, '900 64px', left >= 0 && +num <= 10 && Math.floor(rt * 4) % 2 ? '#ff5040' : '#ffd84a');
  }

  hud(R) {
    if (R.phase !== 'live') return null;
    const nm = (t) => R.players.get(R.act[t])?.name || '…';
    return { mid: L(`第 ${R.round} 回合`, `Round ${R.round}`), sub: `${nm('claude')} vs ${nm('codex')}` };
  }
}

// ================================================================ 小工具

function star(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    g.lineTo(x + Math.cos(a) * (i % 2 ? r * 0.45 : r), y + Math.sin(a) * (i % 2 ? r * 0.45 : r));
  }
  g.fill();
}

function rr(g, x, y, w, h, r, fillStyle, stroke, lw = 4) {
  g.beginPath();
  g.roundRect(x, y, Math.max(0, w), h, r);
  if (fillStyle) (g.fillStyle = fillStyle), g.fill();
  if (stroke) (g.strokeStyle = stroke), (g.lineWidth = lw), g.stroke();
}
const dot = (g, x, y, r, color) => oval(g, x, y, r, r, color);
function oval(g, x, y, rx, ry, color) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  g.fill();
}
function seg(g, [x1, y1], [x2, y2], color, w) {
  Object.assign(g, { strokeStyle: color, lineWidth: w, lineCap: 'round' });
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}
/** 描边大字（格斗游戏的字都是这样）。font 不带字体名，比如 'italic 900 56px'。 */
function outline(g, s, x, y, font, color, stroke = null, lw = 0, align = 'center') {
  Object.assign(g, { font: `${font} ${FONT}`, textAlign: align, textBaseline: 'middle', lineWidth: lw, strokeStyle: stroke || 'transparent', fillStyle: color });
  if (stroke) g.strokeText(s, x, y);
  g.fillText(s, x, y);
}
