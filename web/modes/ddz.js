// 斗地主：一副 54 张牌、三个座位。每局一队当地主（多拿三张底牌），另一队的两个会话当农民，每局交换。
// 每个动作让牌桌往下走一手：轮到的座位是动作这一方自己的，就打出最好的牌；是对面的，它就更可能「要不起」。
// 测试通过是炸弹，开 PR 是王炸，任务完成是飞机；你发消息就加倍，打断它就是你把牌桌掀了。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, rand, pill, emoji, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'ddz',
  icon: '🃏',
  get name() { return L('斗地主', 'Dou Dizhu (Fight the Landlord)'); },
  get desc() { return L('一队当地主，一队当农民，每局交换。测试通过是炸弹，开 PR 是王炸，等太久就自动托管', 'One team is the Landlord, the other the Farmers; swap every hand. Passing tests are bombs, a PR is the Rocket, keep it waiting and it goes auto-play'); },
  get roundWord() { return L('局', 'hand'); },
  get wait() {
    return {
      start: L('⏳ {a}：快点啊，我等到花儿都谢了', '⏳ {a}: Hurry up, the flowers have withered!'),
      sub: L('40 秒内回它就接着出牌，超时就自动托管', 'Reply within 40s — or it switches to auto-play'),
      done: L('🃏 来了来了，出牌！', '🃏 Coming, coming — my turn!'),
      boom: L('🤖 {a} 等太久，已自动托管', '🤖 {a} waited too long — auto-play on'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('出一手牌：轮到自己这边就打最好的，轮到对面它更容易「要不起」', "Play a turn: your own seat plays its best, the foe's seat is more likely to pass")],
      [L('🎯 测试 / 编译通过', '🎯 Tests / build pass'), L('炸弹！倍数 ×2', 'BOMB! Multiplier ×2')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('王炸！没有双王就扔炸弹或最大的一手', 'ROCKET! No jokers? A bomb or the biggest combo')],
      [L('✅ 任务完成', '✅ Task done'), L('飞机 / 顺子：一口气甩一大串', 'Airplane / straight: dump a long combo')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('记牌：下一手出最优解', 'Card counting: next play is optimal')],
      [L('🧱 改代码', '🧱 Edit code'), L('理牌：下一手更稳', 'Sort the hand: next play is stronger')],
      [L('🔭 上网查资料', '🔭 Web search'), L('偷看对手的牌', "Peek at the foes' cards")],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('队友配合：农民给队友喂牌', 'Teamwork: a farmer feeds its partner')],
      [L('🤔 思考', '🤔 Thinking'), L('思考中…（头像上转一圈倒计时）', 'Thinking… (a countdown ring on the avatar)')],
      [L('🐛 报错', '🐛 Error'), L('出错牌：拆对子、乱扔大牌、压队友', 'Misplay: splits pairs, wastes big cards, beats its partner')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('忘了出了啥：下一手乱出', 'Forgot what was played: next play is random')],
      [L('💬 你发消息', '💬 You send a message'), L('加倍 / 超级加倍', 'Double / Super double')],
      [L('⏳ 它在等你', '⏳ Waiting on you'), L('「快点啊，我等到花儿都谢了」，超时自动托管', '"Hurry up, the flowers have withered!" — too late and it goes auto-play')],
      [L('✋ 你打断它', '✋ You interrupt it'), L('你把牌桌掀了：这一局判负', 'You flipped the table: the hand is forfeited')],
      [L('⏰ 闹钟走完还没人动', '⏰ The alarm clock runs out'), L('超时：能不要就自动「不要」', 'Time out: auto-pass if it can')],
    ];
  },
};

// ================================================================ 牌
// 一张牌是 0..53 的整数：0..51 是 3 到 2（每个点数四种花色），52 小王，53 大王。
// 点数 r：0..12 = 3 4 5 6 7 8 9 10 J Q K A 2，13 小王，14 大王。

const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS = ['♠', '♥', '♣', '♦'];
const rankOf = (c) => (c < 52 ? c >> 2 : c - 39);
const byBig = (a, b) => rankOf(b) - rankOf(a) || b - a; // 手牌从大到小排，跟游戏里一样
const isBoom = (c) => c.t === 'bomb' || c.t === 'rocket';

const countOf = (cards) => cards.reduce((n, c) => (n[rankOf(c)]++, n), new Array(15).fill(0));
const byRank = (cards) => cards.reduce((by, c) => (by[rankOf(c)].push(c), by), Array.from({ length: 15 }, () => []));
const without = (cards, out) => cards.filter((c) => !out.includes(c));

// 每个点数要几张、最少连几个：顺子 5 张起，连对 3 对起，飞机 2 个三张起（都不能带 2 和王）
const SEQ = [['straight', 1, 5], ['pairs', 2, 3], ['plane', 3, 2]];

/** 一手牌能出的所有牌型。带牌只挑最不值钱的几种，免得组合爆炸。 */
function combos(cards) {
  const by = byRank(cards);
  const n = by.map((g) => g.length);
  const out = [];
  const add = (t, r, len, cs) => out.push({ t, r, n: len, cards: cs });
  for (let r = 0; r < 15; r++) {
    if (n[r] >= 1) add('single', r, 1, by[r].slice(0, 1));
    if (n[r] >= 2) add('pair', r, 1, by[r].slice(0, 2));
    if (n[r] >= 3) {
      const tri = by[r].slice(0, 3);
      add('triple', r, 1, tri);
      for (const k of kick(by, n, [r], 1, 3)) add('triple1', r, 1, tri.concat(k));
      for (const k of kick(by, n, [r], 2, 3)) add('triple2', r, 1, tri.concat(k));
    }
    if (n[r] === 4) add('bomb', r, 1, by[r].slice());
  }
  if (n[13] && n[14]) add('rocket', 13, 1, [by[13][0], by[14][0]]);
  for (const [t, per, min] of SEQ) {
    for (let s = 0; s < 12; s++) {
      for (let e = s; e < 12 && n[e] >= per; e++) {
        const len = e - s + 1;
        if (len < min) continue;
        const body = [];
        for (let r = s; r <= e; r++) body.push(...by[r].slice(0, per));
        add(t, s, len, body);
        if (t !== 'plane') continue;
        const ranks = Array.from({ length: len }, (_, i) => s + i);
        const w1 = kick(by, n, ranks, 1, len, true);
        const w2 = kick(by, n, ranks, 2, len, true);
        if (w1) add('plane1', s, len, body.concat(w1));
        if (w2) add('plane2', s, len, body.concat(w2));
      }
    }
  }
  return out;
}

/** 带牌：先用正好凑数的散牌，再用小点数；拆对子、用 2 和王都尽量往后。all = 飞机一次挑够 count 组。 */
function kick(by, n, excl, size, count, all = false) {
  const rocket = n[13] && n[14];
  const rs = [];
  for (let r = 0; r < 15; r++) if (!excl.includes(r) && n[r] >= size && n[r] < 4) rs.push(r);
  const score = (r) => (n[r] === size ? 0 : 15) + r + (r >= 12 ? 8 : 0) + (r >= 13 && rocket ? 40 : 0);
  rs.sort((a, b) => score(a) - score(b));
  if (!all) return rs.slice(0, count).map((r) => by[r].slice(0, size));
  return rs.length < count ? null : rs.slice(0, count).flatMap((r) => by[r].slice(0, size));
}

/** a 能不能管上 b：王炸最大，炸弹管一切普通牌，其余要同牌型、同长度、点数更大。 */
function beats(a, b) {
  if (!b || a.t === 'rocket') return true;
  if (b.t === 'rocket') return false;
  if (a.t === 'bomb') return b.t !== 'bomb' || a.r > b.r;
  return a.t === b.t && a.n === b.n && a.r > b.r;
}

/** 粗略估计这手牌还要出几次才能走完（越少越好）：顺子、连对、飞机各算一手，三张能带走一张散牌或一对。 */
function movesLeft(cards) {
  if (!cards.length) return 0;
  const n = countOf(cards);
  let moves = 0;
  let planes = 0;
  for (const [per, min] of [[1, 5], [2, 3], [3, 2]]) {
    for (let s = 0; s < 12; ) {
      let e = s;
      while (e < 12 && n[e] === per) e++;
      if (e - s >= min) {
        for (let r = s; r < e; r++) n[r] = 0;
        moves++;
        if (per === 3) planes += e - s;
        s = e;
      } else s++;
    }
  }
  const many = (k) => n.filter((x) => x === k).length;
  let [ones, twos, threes] = [many(1), many(2), many(3)];
  moves += many(4);
  if (n[13] && n[14]) [ones, moves] = [ones - 2, moves + 1]; // 王炸算一手
  return moves + threes + ones + twos - Math.min(threes + planes, ones + twos);
}

// ================================================================ 规则

const TURNS = new Set(['shell', 'read', 'edit', 'web', 'misc', 'agent', 'done', 'pr']); // 这些动作让牌桌走一手
const LEVEL = { rocket: 6, bomb: 5, big: 4, optimal: 3, feed: 2 }; // 攒着的加成，大的盖掉小的
const better = (a, b) => ((LEVEL[a] || 0) >= (LEVEL[b] || 0) ? a : b) || null;
const PRESSURE = 0.45; // 对面动了一下，你这边座位被吓得「要不起」的基础概率（再乘均衡火力）
const MAX_TIMEOUTS = 2; // 闹钟连着超时两次就不再自动出了，等有人动
const BEAN = 100; // 底分：欢乐豆

function kindLevel(ev) {
  if (!ev || ev.ok === false) return null;
  if (ev.k === 'pr') return 'rocket';
  if (ev.hs) return 'bomb';
  if (ev.k === 'done') return 'big';
  if (ev.k === 'read' || ev.k === 'web') return 'optimal';
  if (ev.k === 'agent') return 'feed';
  return null;
}

const recent = (a, b) => b.lastActive - a.lastActive || (a.sid < b.sid ? -1 : 1);

export class Rules extends Base {
  static defaults = { maxPerTeam: 6 };

  init() {
    this.handLen = this.opts.party ? 8 * 60e3 : 20 * 60e3;
    this.clock = this.opts.party ? 20e3 : 30e3;
    this.deal = this.opts.party ? 7 : 17; // 大乱斗：每人 7 张，地主 10 张，十几个动作就分胜负
    this.hand = null;
  }

  initPlayer(p) {
    p.beans = 0;
  }

  seatName(s) {
    return s.sid ? this.players.get(s.sid)?.name || s.sid.slice(0, 8) : s.role === 'lord' ? L('托管', 'Auto') : L('路人农民', 'Random farmer');
  }

  // ---------------------------------------------------------------- 发牌

  pickLord() {
    // 大乱斗每关是新的一局：按时刻抽；正赛每局交换
    if (this.party) return rng(hash(`ddz-lord-${this.now}`))() < 0.5 ? 'claude' : 'codex';
    return this.round % 2 ? 'claude' : 'codex';
  }

  onRoundStart(fx) {
    const lord = this.pickLord();
    const farm = OTHER[lord];
    const boss = this.field(lord).sort(recent)[0];
    const peasants = this.field(farm).sort(recent);
    const r = rng(hash(`ddz-deal-${this.round}-${this.now}-${boss?.sid}`));
    const deck = [...Array(54).keys()];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const d = this.deal;
    const hands = [0, 1, 2].map((i) => deck.slice(i * d, i * d + d)); // 谁拿哪手牌全看洗牌：抢最好那手的话地主赢太多
    const hole = deck.slice(3 * d, 3 * d + 3);
    const seat = (id, role, team, sid, cards) => ({ id, role, team, sid: sid || null, cards: cards.sort(byBig), plays: 0, out: null });
    this.hand = {
      lord, farm, hole, turn: 0, lead: null, mult: 1, bombs: 0, turns: 0, timeouts: 0, clockAt: this.now + this.clock,
      seats: [seat(0, 'lord', lord, boss?.sid, hands[0].concat(hole)), seat(1, 'farm', farm, peasants[0]?.sid, hands[1]), seat(2, 'farm', farm, peasants[1]?.sid, hands[2])],
      doubled: { claude: 0, codex: 0 }, buff: { claude: null, codex: null }, curse: { claude: null, codex: null }, auto: { claude: 0, codex: 0 },
    };
    fx.push({ type: 'ddzDeal', hand: snapshot(this.hand) });
    fx.push({ type: 'announce', text: L('👲 我是地主我先出！', "👲 I'm the Landlord — I lead!"), sub: L(`${TEAM_NAME[lord]} 抢到地主 · 底牌亮出来了`, `${TEAM_NAME[lord]} grabs the Landlord seat · hole cards revealed`), cls: lord, ms: 1400 });
  }

  // ---------------------------------------------------------------- 座位：有人挂机就换人，农民不够就请路人

  onEnter(p, fx) {
    const h = this.hand;
    if (!h || this.phase !== 'live') return;
    const s = h.seats.find((q) => q.team === p.team && (!q.sid || !this.players.get(q.sid)?.onField));
    if (!s) return;
    const npc = !s.sid;
    s.sid = p.sid;
    fx.push({ type: 'ddzSeat', seat: s.id, sid: p.sid });
    fx.push({ type: 'note', text: npc ? L('🪑 {0} 换下了路人农民', '🪑 {0} replaced the random farmer') : L('🪑 {0} 接手了这个座位', '🪑 {0} took over the seat'), sids: [p.sid] });
  }

  onLeave(p, fx) {
    const h = this.hand;
    const s = h && h.seats.find((q) => q.sid === p.sid);
    if (!s) return;
    const seated = new Set(h.seats.map((q) => q.sid));
    const sub = this.field(p.team).filter((q) => !seated.has(q.sid)).sort(recent)[0];
    s.sid = sub ? sub.sid : null;
    fx.push({ type: 'ddzSeat', seat: s.id, sid: s.sid });
    if (sub && this.phase === 'live') fx.push({ type: 'note', text: L('🪑 {0} 挂机了，{1} 接着打', '🪑 {0} went AFK, {1} takes the seat'), sids: [p.sid, sub.sid] });
  }

  // ---------------------------------------------------------------- 动作

  onEvent(p, ev, r, fx) {
    const h = this.hand;
    if (this.phase !== 'live' || !h) return;
    const A = p.team;
    switch (ev.k) {
      case 'think':
        return fx.push({ type: 'ddzThink', sid: p.sid, team: A });
      case 'prompt':
        return this.double(h, p, fx);
      case 'compact':
        h.curse[A] = 'random';
        return fx.push({ type: 'ddzSay', team: A, sid: p.sid, say: 'forgot' });
      case 'apierr':
        h.auto[A] = Math.max(h.auto[A], 1);
        return fx.push({ type: 'ddzAuto', team: A, on: true, why: 'net' });
      case 'abort':
        return this.flip(h, p, fx);
    }
    if (!TURNS.has(ev.k)) return;
    if (h.auto[A] > 0) {
      h.auto[A] = 0; // 人回来了：取消托管
      fx.push({ type: 'ddzAuto', team: A, on: false });
    }
    if (ev.ok !== false) {
      if (ev.k === 'edit') fx.push({ type: 'ddzSort', team: A, sid: p.sid });
      if (ev.k === 'read') fx.push({ type: 'ddzCount', team: A, sid: p.sid });
      const foe = ev.k === 'web' && h.seats.find((q) => q.team !== A && q.cards.length);
      if (foe) fx.push({ type: 'ddzPeek', team: A, sid: p.sid, seat: foe.id, cards: foe.cards.slice(0, 5) });
    }
    this.turn(p, ev, r, fx);
  }

  /** 牌桌走一手：轮到的座位出牌或者不要。p 为空表示闹钟超时。 */
  turn(p, ev, r, fx) {
    const h = this.hand;
    const s = h.seats[h.turn];
    const { lvl, q } = this.level(h, s, p, ev);
    let { c, why, oops, feed, press } = this.choose(h, s, lvl, q, r);
    if (!c && !h.lead) c = combos(s.cards).find((x) => x.t === 'single' && x.cards[0] === s.cards[s.cards.length - 1]); // 自己的轮次不能不出
    h.timeouts = p ? 0 : h.timeouts + 1;
    h.clockAt = h.timeouts < MAX_TIMEOUTS ? this.now + this.clock : null;
    if (c) this.play(h, s, c, p, { lvl, oops, feed }, fx);
    else this.pass(h, s, why, p, !!press, fx);
  }

  /** 这一手打得多好：自己这边的座位 → 最好（再看事件给的加成）；对面的座位 → 被压制，更容易要不起。 */
  level(h, s, p, ev) {
    if (!p) return { lvl: 'timeout' };
    const A = p.team;
    if (s.team !== A) {
      const pend = kindLevel(ev);
      if (pend) h.buff[A] = better(pend, h.buff[A]); // 攒到自己下一次出牌
      if (h.auto[s.team] > 0) return h.auto[s.team]--, { lvl: 'auto' };
      // 均衡火力：动作多的一方每次的压制力小一点，比的是效率不是人多
      return ev.ok === false ? { lvl: 'normal' } : { lvl: 'weak', q: clamp(PRESSURE * this.balanceMult(A), 0.05, 0.92) };
    }
    if (ev.ok === false) return { lvl: 'misplay' };
    const lvl = h.curse[A] || better(kindLevel(ev), h.buff[A]) || 'best';
    if (h.curse[A]) h.curse[A] = null;
    else h.buff[A] = null;
    return { lvl };
  }

  /** 出什么：返回 { c: 牌型 } 或 { c: null, why: 'cant' 要不起 | 'pass' 不要 }。 */
  choose(h, s, lvl, q, r) {
    const lead = h.lead && h.lead.seat !== s.id ? h.lead : null;
    const all = combos(s.cards);
    const cands = lead ? all.filter((c) => beats(c, lead.combo)) : all;
    if (!cands.length) return { c: null, why: 'cant' };
    const mate = !!lead && h.seats[lead.seat].team === s.team;
    const out = cands.find((c) => c.cards.length === s.cards.length);
    if (out && !['misplay', 'random', 'auto', 'timeout'].includes(lvl)) return { c: out }; // 一手走完
    const low = (xs) => xs.slice().sort((a, b) => a.r - b.r || b.cards.length - a.cards.length)[0];
    const calm = cands.filter((c) => !isBoom(c));
    const singles = cands.filter((c) => c.t === 'single');
    switch (lvl) {
      case 'timeout':
        return lead ? { c: null, why: 'pass' } : { c: low(singles) };
      case 'auto': // 托管：能不要就不要，要出就出最小的
        if (lead && (mate || r() < 0.6)) return { c: null, why: 'pass' };
        return { c: low(lead ? (calm.length ? calm : cands) : singles) };
      case 'random':
        if (lead && r() < 0.3) return { c: null, why: 'pass' };
        return { c: cands[Math.floor(r() * cands.length)] };
      case 'misplay':
        return { c: this.misplay(s, cands, lead, r), oops: true };
      case 'weak':
        if (lead && r() < q) return { c: null, why: 'cant', press: true };
      // 没被吓住：照常出
      // falls through
      case 'normal':
        if (mate) return { c: null, why: 'pass' };
        if (!lead) return { c: low(calm.length ? calm : cands) };
        if (calm.length) return { c: low(calm) };
        return h.seats[lead.seat].cards.length <= 4 ? { c: low(cands) } : { c: null, why: 'pass' };
    }
    return this.smart(h, s, cands, lead, mate, lvl);
  }

  misplay(s, cands, lead, r) {
    const n = countOf(s.cards);
    if (!lead) {
      // 首出：拆对子，或者先把大牌扔了
      const split = cands.filter((c) => c.t === 'single' && n[c.r] >= 2);
      const pool = (split.length ? split : cands.filter((c) => c.t === 'single')).sort((a, b) => b.r - a.r);
      return pool[Math.floor(r() * Math.min(2, pool.length))];
    }
    // 跟牌：拿最大的去压，队友的牌也压（王炸留到最后才扔）
    return cands.slice().sort((a, b) => (a.t === 'rocket') - (b.t === 'rocket') || b.r - a.r || a.cards.length - b.cards.length)[0];
  }

  /** 认真打：挑出完之后剩下的牌最好走的那一手。optimal = 记牌，知道对面管不管得上。 */
  smart(h, s, cands, lead, mate, lvl) {
    if (mate) return { c: null, why: 'pass' }; // 队友的牌不压
    if (lvl === 'bomb' || lvl === 'rocket') {
      const booms = cands.filter(isBoom).sort((a, b) => (a.t === 'rocket') - (b.t === 'rocket') || a.r - b.r);
      const pick = (lvl === 'rocket' && booms.find((c) => c.t === 'rocket')) || booms[0];
      if (pick) return { c: pick };
      if (lvl === 'rocket') return { c: cands.slice().sort((a, b) => b.cards.length - a.cards.length || a.r - b.r)[0] };
    }
    const foes = h.seats.filter((x) => x.team !== s.team);
    const minFoe = Math.min(...foes.map((x) => x.cards.length));
    const pal = h.seats.find((x) => x !== s && x.team === s.team);
    if (lvl === 'feed' && !lead && pal && pal.cards.length <= 2) {
      // 队友配合：队友只剩一两张，喂一张最小的单张 / 对子让它走
      const want = pal.cards.length === 2 && rankOf(pal.cards[0]) === rankOf(pal.cards[1]) ? 'pair' : 'single';
      const c = cands.filter((x) => x.t === want).sort((a, b) => a.r - b.r)[0];
      if (c) return { c, feed: pal.id };
    }
    // 记牌：对面每种牌型最大能出到几
    let top = null;
    if (lvl === 'optimal') {
      top = new Map();
      for (const f of foes) for (const x of combos(f.cards)) if (!isBoom(x)) top.set(x.t + x.n, Math.max(top.get(x.t + x.n) ?? -1, x.r));
    }
    const n = countOf(s.cards);
    const leaderLeft = lead ? h.seats[lead.seat].cards.length : 99;
    let best = null;
    let bestCost = Infinity;
    for (const c of cands) {
      let cost = movesLeft(without(s.cards, c.cards)) * 10 + c.r * 0.8 - c.cards.length * 0.4;
      const used = countOf(c.cards);
      for (let k = 0; k < 15; k++) if (used[k] && used[k] < n[k]) cost += n[k] === 4 ? 30 : 4; // 拆牌扣分，拆炸弹扣更多
      if (isBoom(c)) cost += lead && (minFoe <= 4 || leaderLeft <= 4) ? 2 : 28;
      else if (c.r >= 12) cost += lead ? 1 : 4; // 2 和王留着控场
      if (c.t === 'single' && minFoe === 1) cost += (14 - c.r) * 2.5; // 对面报单：别放小单张
      if (c.t === 'pair' && minFoe === 2) cost += (13 - c.r) * 1.5;
      if (lvl === 'big') cost -= c.cards.length * 3;
      if (top && !isBoom(c) && (top.get(c.t + c.n) ?? -1) <= c.r) cost -= 8; // 对面管不上
      if (cost < bestCost) [best, bestCost] = [c, cost];
    }
    if (lead && bestCost > movesLeft(s.cards) * 10 + 12 && leaderLeft > 5) return { c: null, why: 'pass' };
    return { c: best };
  }

  play(h, s, c, p, info, fx) {
    const fresh = !h.lead;
    if (fresh) for (const x of h.seats) x.out = null; // 新的一轮：桌上清空
    const mate = !!h.lead && h.seats[h.lead.seat].team === s.team;
    s.cards = without(s.cards, c.cards);
    s.plays++;
    s.out = { t: c.t, r: c.r, n: c.n, cards: c.cards.slice() };
    h.lead = { seat: s.id, combo: c };
    h.turns++;
    const owner = this.players.get(s.sid);
    if (owner) owner.dmg += c.cards.length;
    const boom = isBoom(c);
    if (boom) {
      h.mult *= 2;
      h.bombs++;
      if (owner) owner.hs++;
    }
    fx.push({
      type: 'ddzPlay', seat: s.id, sid: s.sid, by: p ? p.sid : null, combo: s.out, fresh, mate, lvl: info.lvl, oops: !!info.oops,
      feed: info.feed ?? null, left: s.cards.length, first: s.role === 'lord' && s.plays === 1, mult: h.mult,
    });
    if (boom) fx.push({ type: 'announce', text: c.t === 'rocket' ? L('🚀 王炸！', '🚀 ROCKET!') : L('💣 炸弹！', '💣 BOMB!'), sub: L(`${this.seatName(s)} · 倍数 ×${h.mult}`, `${this.seatName(s)} · Multiplier ×${h.mult}`), cls: s.team, ms: 1500 });
    else if (c.t.startsWith('plane')) fx.push({ type: 'announce', text: L('✈️ 飞机！', '✈️ AIRPLANE!'), sub: this.seatName(s), cls: s.team, ms: 1200 });
    if (mate && info.oops) fx.push({ type: 'note', text: L('🐷 {0} 压了自己队友的牌', '🐷 {0} just beat its own partner'), sids: [s.sid || p?.sid] });
    if (!s.cards.length) return this.finish(h, s, fx);
    if (s.cards.length <= 2) fx.push({ type: 'ddzWarn', seat: s.id, left: s.cards.length });
    this.next(h);
  }

  pass(h, s, why, p, press, fx) {
    s.out = { pass: why };
    h.turns++;
    fx.push({ type: 'ddzPass', seat: s.id, why, by: p ? p.sid : null, press });
    this.next(h);
  }

  next(h) {
    h.turn = (h.turn + 1) % 3;
    if (h.lead && h.lead.seat === h.turn) h.lead = null; // 两家都不要：这一轮归他，重新出
  }

  // ---------------------------------------------------------------- 结算

  finish(h, s, fx) {
    const lordWin = s.role === 'lord';
    let spring = null;
    if (lordWin && h.seats.every((x) => x.role === 'lord' || !x.plays)) spring = 'spring'; // 农民一张没出
    if (!lordWin && h.seats[0].plays === 1) spring = 'anti'; // 地主只出了第一手
    if (spring) {
      h.mult *= 2;
      fx.push({ type: 'announce', text: spring === 'spring' ? L('🌸 春天！', '🌸 SPRING!') : L('🌸 反春！', '🌸 ANTI-SPRING!'), sub: L(`倍数 ×${h.mult}`, `Multiplier ×${h.mult}`), cls: 'gold', ms: 1800 });
    }
    this.settle(h, s.team, s, fx, { spring });
    const why = lordWin ? L(`地主赢了 · ×${h.mult}`, `Landlord wins · ×${h.mult}`) : L(`农民赢了 · ×${h.mult}`, `Farmers win · ×${h.mult}`);
    const pre = spring === 'spring' ? L('春天！', 'Spring! ') : spring ? L('反春！', 'Anti-spring! ') : '';
    this.endRound(s.team, spring || (lordWin ? 'lord' : 'farm'), fx, pre + why);
  }

  /** 发欢乐豆、记战绩：赢的座位 k+1，输的 d+1；农民赢了没走完的那个算助攻。炸弹记在 hs 上。 */
  settle(h, win, outSeat, fx, extra = {}) {
    for (const x of h.seats) {
      x.delta = (x.team === win ? 1 : -1) * BEAN * h.mult * (x.role === 'lord' ? 2 : 1);
      const o = this.players.get(x.sid);
      if (!o) continue;
      o.beans += x.delta;
      if (x.team !== win) o.d++;
      else if (outSeat && x !== outSeat && x.role === 'farm') o.a++;
      else o.k++;
    }
    fx.push({ type: 'ddzEnd', hand: snapshot(h), winner: win, lordWin: win === h.lord, out: outSeat ? outSeat.id : null, ...extra });
  }

  double(h, p, fx) {
    const n = h.doubled[p.team];
    if (n >= 2) return;
    h.doubled[p.team]++;
    h.mult *= 2;
    fx.push({ type: 'ddzMult', mult: h.mult, team: p.team, sid: p.sid, why: n ? 'super' : 'double' });
    fx.push({ type: 'announce', text: n ? L('🔥 超级加倍！', '🔥 SUPER DOUBLE!') : L('🔥 加倍！', '🔥 DOUBLE!'), sub: L(`${TEAM_NAME[p.team]} · 倍数 ×${h.mult}`, `${TEAM_NAME[p.team]} · Multiplier ×${h.mult}`), cls: p.team, ms: 1300 });
  }

  flip(h, p, fx) {
    fx.push({ type: 'ddzFlip', team: p.team, sid: p.sid });
    fx.push({ type: 'kill', killer: null, victim: p.sid, weapon: L('掀桌', 'Table flip'), hs: false, cause: 'human', assist: null });
    this.settle(h, OTHER[p.team], null, fx, { flip: p.team });
    this.endRound(OTHER[p.team], 'flip', fx, L('你把牌桌掀了 · 这局判负', 'You flipped the table · hand forfeited'));
  }

  // 它在等你：「快点啊，我等到花儿都谢了」。及时回 → 下一手记牌；超时 → 自动托管三手
  onWait(p, fx) {
    if (this.hand) fx.push({ type: 'ddzSay', team: p.team, sid: p.sid, say: 'flowers' });
  }

  onAnswer(p, wait, fx) {
    if (!this.hand) return;
    this.hand.buff[p.team] = better('optimal', this.hand.buff[p.team]);
    fx.push({ type: 'ddzSay', team: p.team, sid: p.sid, say: 'back' });
  }

  onWaitTimeout(p, fx) {
    if (!this.hand || this.phase !== 'live') return;
    this.hand.auto[p.team] = 3;
    fx.push({ type: 'ddzAuto', team: p.team, on: true, why: 'wait' });
    fx.push({ type: 'note', text: L('🤖 {0} 等太久，自动托管了', '🤖 {0} waited too long — auto-play on'), sids: [p.sid] });
  }

  // ---------------------------------------------------------------- 时间：闹钟超时自动不要；一局太久就比剩牌

  timers() {
    const h = this.hand;
    return h && h.clockAt != null ? [this.roundStart + this.handLen, h.clockAt] : [this.roundStart + this.handLen];
  }

  onTick(fx) {
    const h = this.hand;
    if (!h) return;
    if (this.now - this.roundStart >= this.handLen) {
      if (!h.turns) return void (this.roundStart = this.now);
      const win = this.leader();
      this.settle(h, win, null, fx, { time: true });
      return this.endRound(win, 'time', fx, L('时间到 · 剩牌少的一方赢', 'Time up · fewer cards left wins'));
    }
    if (h.clockAt != null && this.now >= h.clockAt) this.turn(null, null, rng(hash(`ddz-clock-${this.now}-${h.turns}`)), fx);
  }

  onPause() {
    if (this.hand) this.hand.clockAt = null;
  }

  /** 比剩牌：地主的牌比农民里最少的那家还少才算地主领先（一样多算农民）。 */
  leader() {
    const h = this.hand;
    return h && (h.seats[0].cards.length < Math.min(h.seats[1].cards.length, h.seats[2].cards.length) ? h.lord : h.farm);
  }
}

/** 画面用的拷贝：结算画面要在新的一局发牌之后继续显示上一局。 */
function snapshot(h) {
  return {
    lord: h.lord, farm: h.farm, mult: h.mult, hole: h.hole.slice(), turn: h.turn,
    seats: h.seats.map((s) => ({ id: s.id, role: s.role, team: s.team, sid: s.sid, cards: s.cards.slice(), plays: s.plays, out: s.out, delta: s.delta || 0 })),
  };
}

// ================================================================ 画面
// 俯视的绿色牌桌：地主坐下方（手牌正面朝上摊开，就像游戏里的「我」），两个农民坐左右（牌背 + 剩几张）。
// 每家出的牌摆在自己面前，「要不起」「不要」冒气泡；炸弹炸开、王炸升空、飞机从桌上飞过、春天下花瓣。

const { w: W, h: H } = WORLD;
const SEATS = [
  { ax: 150, ay: 800, px: 800, py: 600, hx: 830, hy: 850, bub: [150, 688], lab: [150, 640], clock: [800, 724] }, // 地主：下方
  { ax: 1450, ay: 380, px: 1090, py: 400, hx: 1330, hy: 380, bub: [1450, 286], lab: [1450, 522], clock: [1330, 232] }, // 下家：右
  { ax: 150, ay: 380, px: 510, py: 400, hx: 270, hy: 380, bub: [150, 286], lab: [150, 522], clock: [270, 232] }, // 上家：左
];
const CW = 78; // 桌上出的牌
const CH = 110;
const HOLD = 2.8; // 结算画面停几秒
const COUNTER = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]; // 记牌器：大王 小王 2 A K … 3

const rankName = (r) => (r === 14 ? L('大王', 'Big Joker') : r === 13 ? L('小王', 'Little Joker') : RANKS[r]);
function comboName(c) {
  const k = RANKS[c.r];
  return {
    single: rankName(c.r), pair: L(`对${k}`, `Pair of ${k}s`), triple: L(`三个${k}`, `Three ${k}s`),
    triple1: L('三带一', 'Trio + 1'), triple2: L('三带一对', 'Trio + pair'), straight: L('顺子', 'Straight'),
    pairs: L('连对', 'Pair chain'), plane: L('飞机', 'Airplane'), plane1: L('飞机带翅膀', 'Airplane + wings'),
    plane2: L('飞机带翅膀', 'Airplane + wings'), bomb: L('炸弹', 'Bomb'), rocket: L('王炸', 'Rocket'),
  }[c.t];
}
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

let tableLayer = null;
function drawTableLayer() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  rr(g, 0, 0, W, H, 0, '#2e1c11'); // 木地板
  for (let y = 0; y < H; y += 48) rr(g, 0, y, W, 46, 0, (y / 48) % 2 ? 'rgba(0,0,0,0.14)' : 'rgba(255,220,180,0.03)');
  rr(g, 20, 12, W - 40, H - 24, 130, '#5a3316'); // 桌沿
  rr(g, 32, 24, W - 64, H - 48, 120, '#8a5428');
  const felt = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 900);
  felt.addColorStop(0, '#2fa05a');
  felt.addColorStop(1, '#145a2c');
  rr(g, 50, 42, W - 100, H - 84, 104, felt);
  const r = rng(11);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.035)';
    g.fillRect(60 + r() * (W - 120), 50 + r() * (H - 100), 2, 2);
  }
  Object.assign(g, { strokeStyle: 'rgba(255,255,255,0.07)', lineWidth: 3 });
  g.beginPath();
  g.ellipse(W / 2, 480, 430, 235, 0, 0, Math.PI * 2);
  g.stroke();
  return c;
}

export class View {
  constructor(app) {
    this.app = app;
    tableLayer ||= drawTableLayer();
    this.fx = new Particles();
    this.reset(null);
  }

  reset() {
    this.fx.clear();
    Object.assign(this, {
      snap: null, age: [9, 9, 9], bubs: [null, null, null], byTag: [null, null, null], warn: [0, 0, 0], sortT: [0, 0, 0],
      labels: new Map(), thinks: new Map(), rockets: [], planes: [], petals: [], flyers: [], shine: [],
      peek: null, countT: 0, countTeam: null, multPop: 0, dealT: 9, flipT: 0,
    });
  }

  /** 这个会话坐在哪个座位（没坐就是 -1，在旁边吃瓜）。 */
  seatOf(h, sid) {
    return h && sid ? h.seats.findIndex((s) => s.sid === sid) : -1;
  }

  /** 第 i 个座位头上冒一句话。 */
  say(i, text, color = '#222', life = 1.8) {
    if (i >= 0) this.bubs[i] = { text, color, life };
  }

  // ---------------------------------------------------------------- 效果进来

  apply(list, R, busy) {
    const { app, fx } = this;
    const rt = app.rt();
    const h = R.hand;
    for (const f of list) {
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (text && !(busy && f.ev.k === 'read')) this.labels.set(f.sid, { text, ok: f.ev.ok !== false, life: 1.8 });
          break;
        }
        case 'ddzEnd':
          this.snap = busy ? null : { ...f, until: rt + HOLD };
          if (!busy) this.endTalk(f);
          break;
        case 'ddzDeal':
          Object.assign(this, { age: [9, 9, 9], byTag: [null, null, null], warn: [0, 0, 0], peek: null });
          if (!this.snap) this.bubs = [null, null, null];
          this.dealT = busy ? 9 : this.snap ? rt - this.snap.until : 0;
          if (!busy && app.sfx.ok(1)) app.sfx.burst(0.3, 2600, 0.06, 'highpass');
          break;
        case 'ddzPlay':
          this.onPlay(f, R, busy);
          break;
        case 'ddzPass':
          this.age[f.seat] = 0;
          this.say(f.seat, null);
          this.byTag[f.seat] = f.press ? { sid: f.by, kind: 'press' } : f.by ? null : { sid: null, kind: 'clock' };
          if (!busy && app.sfx.ok(0)) app.sfx.tone(260, 0.09, 0.04, 'triangle', 200);
          break;
        case 'ddzWarn':
          this.warn[f.seat] = 2.5;
          this.say(f.seat, f.left === 1 ? L('我只剩一张牌啦！', 'Only one card left!') : L('我只剩两张牌啦！', 'Only two cards left!'), '#c0202a', 2.2);
          if (!busy && app.sfx.ok(1)) [0, 0.16].forEach((d) => app.sfx.tone(988, 0.1, 0.07, 'square', 988, d));
          break;
        case 'ddzMult':
          this.multPop = 0.5;
          if (!busy) app.sfx.tone(660, 0.16, 0.08, 'square', 990);
          break;
        case 'ddzThink':
          if (!busy) this.thinks.set(f.sid, rt);
          break;
        case 'ddzSort':
          if (this.seatOf(h, f.sid) >= 0 && !busy) this.sortT[this.seatOf(h, f.sid)] = 0.7;
          break;
        case 'ddzCount':
          Object.assign(this, { countT: 1.2, countTeam: f.team });
          break;
        case 'ddzPeek':
          if (!busy) this.peek = { seat: f.seat, cards: f.cards, life: 1.6 };
          break;
        case 'ddzSay': {
          // 说话的人没坐在桌上：让他那一队的座位替他说
          const at = this.seatOf(h, f.sid) >= 0 ? this.seatOf(h, f.sid) : h ? h.seats.findIndex((s) => s.team === f.team) : -1;
          const text = { flowers: L('快点啊，我等到花儿都谢了', 'Hurry up! The flowers have withered!'), back: L('来了来了！', 'Coming, coming!'), forgot: L('我刚才出了啥来着……', 'Wait, what did I just play…') }[f.say];
          this.say(at, text, f.say === 'flowers' ? '#a03060' : '#222', 2.6);
          break;
        }
        case 'ddzAuto':
          if (!h || busy) break;
          for (const s of h.seats) if (s.team === f.team) this.say(s.id, f.on ? (f.why === 'net' ? L('掉线了……托管中', 'Disconnected… auto-play') : L('🤖 托管中', '🤖 Auto-play')) : L('取消托管', 'Auto-play off'), '#335', 1.6);
          break;
        case 'ddzFlip':
          if (busy || !h) break;
          this.flipT = 1.4; // 牌飞得满桌都是
          for (const s of h.seats) for (const c of s.cards.slice(0, 8)) this.flyers.push({ c, x: SEATS[s.id].hx, y: SEATS[s.id].hy, vx: rand(-700, 700), vy: rand(-900, -300), rot: 0, vr: rand(-9, 9), life: 1.6 });
          app.shake(0.7, 14);
          app.sfx.boom(false);
          break;
      }
    }
  }

  onPlay(f, R, busy) {
    const { app, fx } = this;
    const S = SEATS[f.seat];
    const c = f.combo;
    this.age[f.seat] = 0;
    if (f.fresh) for (let i = 0; i < 3; i++) if (i !== f.seat) this.age[i] = 9;
    const h = R.hand;
    const owner = h && h.seats[f.seat]?.sid;
    // 不是坐在这里的人出的这手：吃瓜的队友支招，或者闹钟超时
    this.byTag[f.seat] = !f.by ? { sid: null, kind: 'clock' } : f.by !== owner ? { sid: f.by, kind: 'call' } : null;
    let voice = isBoom(c) ? comboName(c) + L('！', '!') : comboName(c);
    if (f.first) voice = L('我是地主我先出', "I'm the Landlord, I lead!");
    else if (!f.fresh && !isBoom(c) && Math.random() < 0.45) voice = pick([L('大你', 'Beat that!'), L('管上', 'Covered!'), L('压死', 'Crushed!')]);
    if (f.oops) voice = L('手滑了……', 'Oops, misclick…');
    this.say(f.seat, voice, isBoom(c) ? '#c0202a' : '#222');
    if (f.mate && f.oops && h) this.say(h.seats.findIndex((s, i) => i !== f.seat && s.team === h.seats[f.seat].team), L('猪队友！', 'Worst teammate ever!'), '#c0202a', 2.2);
    if (f.feed != null) this.say(f.feed, L('队友给力！', 'Thanks, partner!'), '#226', 2);
    if (busy) return;
    if (app.sfx.ok(0)) app.sfx.burst(0.05, 2200, 0.08, 'highpass');
    if (c.t === 'bomb') {
      app.later(0.2, () => {
        fx.explosion(S.px, S.py, true);
        fx.text(S.px, S.py - 90, '💣', '#fff', 60, 1.2);
        app.shake(0.5, 12);
        app.sfx.boom(true);
      });
    } else if (c.t === 'rocket') {
      this.rockets.push({ x: S.px, y: S.py, t: 0, boomed: false });
      app.sfx.burst(0.9, 600, 0.1, 'bandpass');
    } else if (c.t.startsWith('plane')) {
      this.planes.push({ t: 0, y: 300 + rand(-40, 40) });
      app.sfx.tone(300, 1.4, 0.05, 'sawtooth', 900);
    } else if (c.t === 'straight' || c.t === 'pairs') {
      this.shine.push({ seat: f.seat, t: 0 });
      if (app.sfx.ok(1)) [0, 0.06, 0.12, 0.18].forEach((d, i) => app.sfx.tone(520 + i * 130, 0.07, 0.05, 'triangle', 520 + i * 130, d));
    }
  }

  /** 一局结束：快捷语，跟游戏里一样；春天下一场花瓣雨。 */
  endTalk(f) {
    const hs = f.hand.seats;
    this.app.sfx.round(true);
    if (f.spring) for (let i = 0; i < 46; i++) this.petals.push({ x: rand(80, W - 80), y: rand(-400, -20), vy: rand(90, 170), sw: rand(0, 6), life: 3.4 });
    if (f.flip) return hs.forEach((s) => this.say(s.id, s.team === f.flip ? L('（掀桌）', '(flips the table)') : L('？？？', '???'), '#c0202a', 2.6));
    for (const s of hs) {
      if (s.team === f.winner) {
        const other = hs.some((x) => x !== s && x.team === s.team);
        if (other && f.out !== s.id) this.say(s.id, L('和你合作真是太愉快了', 'A pleasure working with you!'), '#226', 2.6);
        else if (f.out === s.id) this.say(s.id, f.spring === 'spring' ? L('春天来啦～', 'Spring is here~') : L('走完了！', "I'm out!"), '#226', 2.6);
      } else this.say(s.id, f.lordWin ? L('你的牌打得也太好了', 'Your cards are just too good!') : L('不要走，决战到天亮！', "Don't go! Fight till dawn!"), '#a03060', 2.6);
    }
  }

  // ---------------------------------------------------------------- 每帧

  update(dt, R) {
    const rt = this.app.rt();
    this.fx.update(dt);
    if (this.snap && rt >= this.snap.until) this.snap = null;
    const dec = (x) => Math.max(0, x - dt);
    Object.assign(this, { dealT: this.dealT + dt, countT: dec(this.countT), multPop: dec(this.multPop), flipT: dec(this.flipT), warn: this.warn.map(dec), sortT: this.sortT.map(dec), age: this.age.map((a) => a + dt) });
    this.bubs = this.bubs.map((b) => (b && (b.life -= dt) > 0 ? b : null));
    for (const [sid, l] of this.labels) if ((l.life -= dt) <= 0) this.labels.delete(sid);
    for (const [sid, t] of this.thinks) if (rt - t > 2.4) this.thinks.delete(sid);
    if (this.peek && (this.peek.life -= dt) <= 0) this.peek = null;
    this.shine = this.shine.filter((s) => (s.t += dt) < 0.6);
    this.planes = this.planes.filter((p) => (p.t += dt) < 1.6);
    for (const p of this.planes) if (Math.random() < 0.6) this.fx.smoke(planeX(p) - 60, p.y + 10, 1, 9, 'rgba(255,255,255,0.45)');
    for (const k of this.rockets) {
      k.t += dt;
      if (k.t < 0.9) this.fx.sparks(k.x, rocketY(k) + 40, Math.random() < 0.5 ? '#ffcf6b' : '#ff7b2e', 2, 90);
      if (!k.boomed && k.t >= 0.75) {
        k.boomed = true;
        this.fx.explosion(W / 2, 150, true);
        this.fx.text(W / 2, 170, L('王炸！', 'ROCKET!'), '#ffcf6b', 54, 1.4);
        this.app.shake(0.6, 14);
        this.app.sfx.boom(true);
      }
    }
    this.rockets = this.rockets.filter((k) => k.t < 1.2);
    this.petals = this.petals.filter((p) => ((p.y += p.vy * dt), (p.life -= dt) > 0));
    for (const c of this.flyers) Object.assign(c, { x: c.x + c.vx * dt, y: c.y + c.vy * dt, vy: c.vy + 1400 * dt, rot: c.rot + c.vr * dt });
    this.flyers = this.flyers.filter((c) => (c.life -= dt) > 0);
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(tableLayer, 0, 0, W, H);
    txt(g, L('斗地主', 'DOU DIZHU'), W / 2, 470, 120, 'rgba(255,255,255,0.045)', 'center', 900);
    const h = this.snap ? this.snap.hand : R.hand;
    if (h) {
      g.save();
      if (this.flipT > 0) {
        // 掀桌：整张桌子歪一下
        const k = Math.sin((1.4 - this.flipT) * 9) * this.flipT * 0.03;
        g.translate(W / 2, H / 2);
        g.rotate(k);
        g.translate(-W / 2, -H / 2);
      }
      this.drawTop(g, R, h, scale);
      for (let i = 0; i < 3; i++) this.drawSeat(g, R, h, i, scale, rt);
      for (let i = 0; i < 3; i++) this.drawOut(g, R, h, i, scale);
      g.restore();
    }
    for (const c of this.flyers) drawCard(g, c.c, c.x, c.y, CW, CH, c.rot);
    for (const p of this.planes) {
      emo(g, '✈️', planeX(p), p.y + Math.sin(p.t * 6) * 10, 120, Math.PI / 4); // ✈️ 本来朝右上，转成朝右飞
      txt(g, L('飞机！', 'AIRPLANE!'), planeX(p) - 150, p.y - 70, 40, '#fff', 'center', 900);
    }
    for (const k of this.rockets) if (k.t < 0.9) emo(g, '🚀', k.x, rocketY(k), 90, -Math.PI / 4); // 🚀 转成朝上
    for (const p of this.petals) emo(g, '🌸', p.x + Math.sin(rt * 2 + p.sw) * 30, p.y, 26);
    this.fx.renderOver(g, scale);
    if (h) this.drawTalk(g, R, h, scale);
    if (this.snap) this.drawResult(g, R, scale);
    if (R.phase !== 'live' && !this.snap) {
      rr(g, W / 2 - 330, H / 2 - 50, 660, 100, 20, 'rgba(10,20,14,0.78)');
      txt(g, L('⏳ 二缺一……等对面来人入座', '⏳ Two seats empty — waiting for the other team'), W / 2, H / 2, fontFor(scale, 30), '#fff', 'center', 800);
    }
  }

  /** 顶上：两队的队名和吃瓜群众、底牌、倍数、记牌器。 */
  drawTop(g, R, h, scale) {
    const fs = fontFor(scale, 14);
    for (const team of [h.lord, h.farm]) {
      const left = team === h.lord;
      const x = left ? 92 : W - 92;
      const label = left ? L(`👲 ${TEAM_NAME[team]} · 地主`, `👲 ${TEAM_NAME[team]} · Landlord`) : L(`${TEAM_NAME[team]} · 农民 👨‍🌾`, `${TEAM_NAME[team]} · Farmers 👨‍🌾`);
      txt(g, label, x, 76, fontFor(scale, 24), COLOR[team], left ? 'left' : 'right', 900);
      const seated = new Set(h.seats.map((s) => s.sid));
      R.field(team).filter((p) => !seated.has(p.sid)).slice(0, 4).forEach((p, i) => {
        const kx = left ? 118 + i * 100 : W - 118 - i * 100;
        emo(g, '🍉', kx, 122, 30); // 吃瓜群众：没坐上桌的队友
        this.drawThink(g, p.sid, kx, 122, 24);
        pill(g, kx, 152, p.name, { color: COLOR[team], size: fs - 2, max: 94 });
        this.drawLabel(g, p.sid, kx, 178, fs - 2, 190);
      });
    }
    // 底牌：发完牌翻开
    const k = this.snap ? 1 : clamp((this.dealT - 0.7) / 0.4, 0, 1);
    txt(g, L('底牌', 'Hole'), 690, 92, fontFor(scale, 18), 'rgba(255,255,255,0.75)', 'right', 800);
    h.hole.forEach((c, i) => {
      g.save();
      g.translate(735 + i * 66, 92);
      g.scale(Math.max(0.04, Math.abs(Math.cos(k * Math.PI))), 1);
      if (k < 0.5) drawBack(g, 0, 0, 58, 82);
      else drawCard(g, c, 0, 0, 58, 82);
      g.restore();
    });
    const pop = 1 + this.multPop * 0.8; // 倍数变了就蹦一下
    rr(g, 985 - 54 * pop, 92 - 32 * pop, 108 * pop, 64 * pop, 14, 'rgba(0,0,0,0.4)', '#f5c451', 3);
    txt(g, `×${h.mult}`, 985, 94, 36 * pop, '#f5c451', 'center', 900);
    txt(g, L('倍数', 'Mult'), 1068, 92, fontFor(scale, 16), 'rgba(255,255,255,0.7)', 'left', 700);
    // 记牌器：每种点数还剩几张没出
    const left = countOf(h.seats.flatMap((s) => s.cards));
    const [x0, y0, cw] = [512, 192, 39];
    const lit = this.countT > 0 && this.countTeam;
    rr(g, x0 - 92, y0 - 24, cw * 15 + 102, 48, 12, 'rgba(0,0,0,0.3)', lit ? COLOR[this.countTeam] : null, 2 + this.countT * 3);
    txt(g, L('记牌器', 'Counter'), x0 - 50, y0, fontFor(scale, 14), lit ? '#fff' : 'rgba(255,255,255,0.7)', 'center', 800);
    COUNTER.forEach((r, i) => {
      g.globalAlpha = left[r] ? 1 : 0.3; // 出完了的点数变暗
      txt(g, r === 14 ? L('大', 'BJ') : r === 13 ? L('小', 'LJ') : RANKS[r], x0 + i * cw + cw / 2, y0 - 9, 15, r === 14 ? '#ffb0a0' : '#fff', 'center', 800);
      txt(g, String(left[r]), x0 + i * cw + cw / 2, y0 + 11, 15, '#f5c451', 'center', 900);
    });
    g.globalAlpha = 1;
  }

  drawSeat(g, R, h, i, scale, rt) {
    const S = SEATS[i];
    const s = h.seats[i];
    const lord = s.role === 'lord';
    const live = !this.snap && R.phase === 'live' && h === R.hand;
    const p = s.sid ? R.players.get(s.sid) : null;
    const fs = fontFor(scale, 15);
    if (live && h.turn === i) {
      // 轮到他：头像一圈金光 + 闹钟倒计时
      arc(g, S.ax, S.ay, 62, `rgba(255,214,90,${0.55 + 0.35 * Math.sin(rt * 6)})`, 7);
      const left = h.clockAt != null ? Math.max(0, Math.ceil((h.clockAt - R.now) / 1000)) : null;
      emo(g, '⏰', S.clock[0] - 22, S.clock[1] + (left != null && left <= 5 ? Math.sin(rt * 40) * 2 : 0), 36);
      txt(g, left != null ? String(left) : '…', S.clock[0] + 14, S.clock[1] + 2, 28, left != null && left <= 5 ? '#ff6b6b' : '#fff', 'left', 900);
    }
    dot(g, S.ax, S.ay, 52, DEEP[s.team]);
    arc(g, S.ax, S.ay, 52, this.warn[i] > 0 && Math.floor(rt * 6) % 2 ? '#ff4040' : COLOR[s.team], 5); // 报单 / 报双：头像框闪红
    emo(g, lord ? '👲' : s.sid ? '👨‍🌾' : '🧑‍🌾', S.ax, S.ay + 4, 60);
    if (lord) emo(g, '👑', S.ax, S.ay - 60, 34);
    if ((live && R.hand.auto[s.team] > 0) || (lord && !s.sid)) emo(g, '🤖', S.ax + 44, S.ay - 40, 32);
    const w = s.sid && R.waits.get(s.sid);
    if (w && !w.boom) {
      // 在等你：花儿慢慢谢了
      const k = clamp((R.now - w.t) / (w.deadline - w.t), 0, 1);
      emo(g, k < 0.5 ? '🌹' : '🥀', S.ax - 46, S.ay - 40, 32);
      arc(g, S.ax, S.ay, 70, 'rgba(255,90,120,0.9)', 4, 1 - k);
    }
    if (s.sid) this.drawThink(g, s.sid, S.ax, S.ay, 60);
    pill(g, S.ax, S.ay + 70, s.sid ? p?.name || this.app.nameOf(s.sid) : lord ? L('托管', 'Auto') : L('路人农民', 'Random farmer'), { color: s.sid ? COLOR[s.team] : '#ccc', size: fs, max: 210 });
    pill(g, S.ax, S.ay + 96, `${lord ? L('地主', 'Landlord') : L('农民', 'Farmer')} · ${p ? `🫘 ${p.beans}` : 'NPC'}`, { color: lord ? '#f5c451' : '#cfe8c0', size: fs - 2, max: 210 });
    if (s.sid) this.drawLabel(g, s.sid, S.lab[0], S.lab[1], fs - 1, 300);
    // 手牌：发牌动画里一张张变多；结算时农民的牌也翻过来
    const n = this.snap ? s.cards.length : Math.round(s.cards.length * clamp(this.dealT / 0.8, 0, 1));
    const cards = s.cards.slice(0, n);
    const wave = (j) => (this.sortT[i] > 0 ? Math.sin(j * 0.8 + rt * 20) * 10 * this.sortT[i] : 0);
    const peek = this.peek && this.peek.seat === i ? this.peek : null;
    if (i === 0) {
      // 地主的牌本来就亮着：被偷看的几张往上抽一点
      const step = Math.min(48, 960 / Math.max(1, n));
      cards.forEach((c, j) => drawCard(g, c, S.hx - ((n - 1) * step) / 2 + j * step, S.hy + wave(j) - (peek && peek.cards.includes(c) ? 26 : 0), 84, 118));
      if (peek && n) emo(g, '👀', S.hx - ((n - 1) * step) / 2 - 20, S.hy - 92, 40);
    } else if (this.snap) {
      cards.forEach((c, j) => drawCard(g, c, S.hx, S.hy - ((n - 1) * 22) / 2 + j * 22, 60, 84));
    } else {
      cards.forEach((c, j) => drawBack(g, S.hx + wave(j) * 0.5, S.hy - ((n - 1) * 10) / 2 + j * 10, 58, 82));
      dot(g, S.hx, S.hy, 26, 'rgba(0,0,0,0.6)');
      txt(g, String(n), S.hx, S.hy + 1, 26, this.warn[i] > 0 ? '#ff6b6b' : '#fff', 'center', 900);
    }
    if (peek && i > 0) {
      // 偷看：农民的几张牌翻过来亮一下
      const dir = i === 1 ? -1 : 1;
      g.globalAlpha = Math.min(1, peek.life / 0.3);
      peek.cards.forEach((c, j) => drawCard(g, c, S.hx + dir * (90 + j * 26), S.hy - 40 + j * 6, 54, 76, dir * 0.08));
      emo(g, '👀', S.hx + dir * 110, S.hy - 110, 40);
      g.globalAlpha = 1;
    }
  }

  /** 每家面前出的牌：从手里飞出来；当前最大的那一手底下垫一道金边。 */
  drawOut(g, R, h, i, scale) {
    const S = SEATS[i];
    const s = h.seats[i];
    // 轮到他了：上一圈留在面前的牌收起来（跟游戏里一样）
    if (!s.out || (!this.snap && R.phase === 'live' && h === R.hand && h.turn === i && this.age[i] > 0.6)) return;
    const fs = fontFor(scale, 14);
    if (s.out.pass) {
      g.globalAlpha = Math.min(1, this.age[i] / 0.15);
      bubble(g, S.px, S.py, s.out.pass === 'cant' ? L('要不起', "Can't beat it") : L('不要', 'Pass'), fontFor(scale, 30), '#555');
      g.globalAlpha = 1;
      const t = this.byTag[i];
      if (t && !this.snap) pill(g, S.px, S.py + 44, t.kind === 'press' ? L(`被 ${R.players.get(t.sid)?.name || '?'} 压住了`, `Pressured by ${R.players.get(t.sid)?.name || '?'}`) : L('⏰ 超时', '⏰ Time out'), { size: fs - 2, max: 260, bg: 'rgba(0,0,0,0.5)' });
      return;
    }
    const cards = s.out.cards;
    const m = cards.length;
    const step = Math.min(34, 520 / m);
    const k = easeOut(clamp(this.age[i] / 0.22, 0, 1));
    const top = R.hand === h && R.hand.lead && R.hand.lead.seat === i;
    if (top && k >= 1) rr(g, S.px - ((m - 1) * step) / 2 - CW / 2 - 6, S.py - CH / 2 - 6, (m - 1) * step + CW + 12, CH + 12, 12, 'rgba(255,214,90,0.35)');
    cards.forEach((c, j) => drawCard(g, c, S.hx + (S.px - ((m - 1) * step) / 2 + j * step - S.hx) * k, S.hy + (S.py - S.hy) * k, CW, CH));
    // 顺子 / 连对：一道光从左扫到右
    for (const sh of this.shine) if (sh.seat === i) rr(g, S.px - ((m - 1) * step) / 2 - CW / 2 + ((m - 1) * step + CW) * (sh.t / 0.6) - 10, S.py - CH / 2, 20, CH, 0, 'rgba(255,255,255,0.45)');
    if (m > 2 || isBoom(s.out)) pill(g, S.px, S.py + CH / 2 + 16, comboName(s.out), { size: fs - 1, color: isBoom(s.out) ? '#ff8a6b' : '#f5c451', max: 200 });
    const t = this.byTag[i];
    if (t && !this.snap && k >= 1) pill(g, S.px, S.py - CH / 2 - 16, t.kind === 'call' ? L(`${R.players.get(t.sid)?.name || '?'} 支招`, `${R.players.get(t.sid)?.name || '?'}'s call`) : L('⏰ 超时自动出', '⏰ Auto-played'), { size: fs - 2, max: 240, bg: 'rgba(0,0,0,0.5)' });
  }

  /** 头上的快捷语气泡。 */
  drawTalk(g, R, h, scale) {
    this.bubs.forEach((b, i) => {
      if (!b || !b.text) return;
      g.globalAlpha = Math.min(1, b.life / 0.3);
      bubble(g, clamp(SEATS[i].bub[0], 170, W - 170), SEATS[i].bub[1], b.text, fontFor(scale, 20), b.color);
      g.globalAlpha = 1;
    });
  }

  drawThink(g, sid, x, y, r) {
    const t0 = this.thinks.get(sid);
    if (t0 == null) return;
    arc(g, x, y, r + 8, 'rgba(160,210,255,0.9)', 4, 1 - clamp((this.app.rt() - t0) / 2.4, 0, 1));
    emo(g, '💭', x + r * 0.8, y - r * 0.8, r > 40 ? 30 : 18);
  }

  drawLabel(g, sid, x, y, size, max) {
    const l = this.labels.get(sid);
    if (!l) return;
    g.globalAlpha = Math.min(1, l.life / 0.4);
    pill(g, x, y, l.text, { size, max, weight: 500, bg: l.ok ? 'rgba(10,12,16,0.75)' : 'rgba(130,20,20,0.85)' });
    g.globalAlpha = 1;
  }

  /** 结算：谁赢了、倍数、每家的欢乐豆。 */
  drawResult(g, R, scale) {
    const f = this.snap;
    const k = clamp((HOLD - (f.until - this.app.rt())) / 0.3, 0, 1);
    g.globalAlpha = k;
    rr(g, W / 2 - 330, 404, 660, 150, 24, 'rgba(12,16,12,0.82)', f.flip ? '#ff6b6b' : COLOR[f.winner], 4);
    const title = f.flip ? L('你把牌桌掀了！', 'You flipped the table!') : f.lordWin ? L('地主赢了！', 'Landlord wins!') : L('农民赢了！', 'Farmers win!');
    txt(g, title, W / 2, 452, 52, f.flip ? '#ff8a8a' : COLOR[f.winner], 'center', 900);
    const extra = f.spring === 'spring' ? L(' · 春天', ' · Spring') : f.spring === 'anti' ? L(' · 反春', ' · Anti-spring') : f.time ? L(' · 时间到', ' · Time up') : '';
    txt(g, L(`${TEAM_NAME[f.winner]} · 倍数 ×${f.hand.mult}${extra}`, `${TEAM_NAME[f.winner]} · ×${f.hand.mult}${extra}`), W / 2, 512, fontFor(scale, 24), '#f5c451', 'center', 800);
    for (const s of f.hand.seats) {
      // 欢乐豆盖在头像上
      const S = SEATS[s.id];
      dot(g, S.ax, S.ay, 52, 'rgba(0,0,0,0.6)');
      txt(g, `${s.delta > 0 ? '+' : ''}${s.delta}`, S.ax, S.ay - 8, 34, s.delta > 0 ? '#ffd76a' : '#c0c0c0', 'center', 900);
      txt(g, L('欢乐豆', 'beans'), S.ax, S.ay + 24, 15, '#fff', 'center', 700);
    }
    g.globalAlpha = 1;
  }

  hud(R) {
    const h = R.hand;
    if (R.phase !== 'live' || !h) return null;
    return { mid: L(`第 ${R.round} 局`, `Hand ${R.round}`), sub: L(`地主 ${TEAM_NAME[h.lord]} · ×${h.mult}`, `Landlord ${TEAM_NAME[h.lord]} · ×${h.mult}`) };
  }
}

// ================================================================ 小工具

const easeOut = (k) => 1 - (1 - k) ** 3;
const planeX = (p) => -100 + (W + 200) * (p.t / 1.6);
const rocketY = (k) => k.y - (k.y + 120) * Math.min(1, k.t / 0.9) ** 2;

/** 一张牌（正面）：左上角点数和花色，中间大花色；王是竖着的 JOKER，红的大王、黑的小王。 */
function drawCard(g, c, x, y, w, h, rot = 0) {
  const r = rankOf(c);
  const red = r === 14 || (r < 13 && (c & 3) % 2 === 1);
  const col = red ? '#d0202a' : '#1d1d1d';
  const s = w / 78;
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  rr(g, -w / 2 + 2, -h / 2 + 4, w, h, 8 * s, 'rgba(0,0,0,0.28)');
  rr(g, -w / 2, -h / 2, w, h, 8 * s, '#fffdf6', '#b9b4a4', 1.5);
  if (r >= 13) {
    [...'JOKER'].forEach((ch, i) => txt(g, ch, -w / 2 + 10 * s, -h / 2 + (13 + i * 13) * s, 12 * s, col, 'center', 900));
    txt(g, '★', 6 * s, -6 * s, 40 * s, col, 'center', 400);
    txt(g, r === 14 ? L('大王', 'BIG') : L('小王', 'LITTLE'), 6 * s, 30 * s, 13 * s, col, 'center', 900);
  } else {
    txt(g, RANKS[r], -w / 2 + (r === 7 ? 3 : 7) * s, -h / 2 + 15 * s, (r === 7 ? 19 : 22) * s, col, 'left', 800);
    txt(g, SUITS[c & 3], -w / 2 + 7 * s, -h / 2 + 35 * s, 18 * s, col, 'left', 400);
    txt(g, SUITS[c & 3], 6 * s, 14 * s, 44 * s, col, 'center', 400);
  }
  g.restore();
}

/** 牌背：红底格子花纹。 */
function drawBack(g, x, y, w, h) {
  rr(g, x - w / 2 + 2, y - h / 2 + 3, w, h, 6, 'rgba(0,0,0,0.25)');
  rr(g, x - w / 2, y - h / 2, w, h, 6, '#fdfaf0', '#b9b4a4', 1.2);
  rr(g, x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8, 4, '#b8323a');
  g.save();
  g.beginPath();
  g.rect(x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8);
  g.clip();
  Object.assign(g, { strokeStyle: 'rgba(255,215,160,0.35)', lineWidth: 1.5 });
  g.beginPath();
  for (let t = -h; t < w + h; t += 9) {
    g.moveTo(x - w / 2 + t, y - h / 2);
    g.lineTo(x - w / 2 + t - h, y + h / 2);
    g.moveTo(x - w / 2 + t - h, y - h / 2);
    g.lineTo(x - w / 2 + t, y + h / 2);
  }
  g.stroke();
  g.restore();
  dot(g, x, y, w * 0.16, '#f5c451');
}

/** 白色对话气泡，下面带个小尖。 */
function bubble(g, x, y, text, size, color) {
  g.font = `800 ${size}px ${FONT}`;
  const w = g.measureText(text).width + size * 1.2;
  const h = size * 1.7;
  rr(g, x - w / 2, y - h / 2, w, h, h / 2, 'rgba(255,255,255,0.95)', 'rgba(0,0,0,0.25)', 2);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); // 小尖
  g.moveTo(x - 8, y + h / 2 - 1);
  g.lineTo(x + 8, y + h / 2 - 1);
  g.lineTo(x, y + h / 2 + 12);
  g.fill();
  txt(g, text, x, y + 1, size, color, 'center', 800);
}

/** 彩色 emoji 会跟着 fillStyle 的透明度变淡：先换成不透明的再画。rot = 转个角度。 */
function emo(g, ch, x, y, size, rot = 0) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.fillStyle = '#000';
  emoji(g, ch, 0, 0, size);
  g.restore();
}

/** 一圈（或一段）弧线：frac = 从 12 点钟顺时针画多少。 */
function arc(g, x, y, r, color, lw, frac = 1) {
  Object.assign(g, { strokeStyle: color, lineWidth: lw });
  g.beginPath();
  g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  g.stroke();
}

function rr(g, x, y, w, h, r, fill, stroke, lw = 3) {
  g.beginPath();
  g.roundRect(x, y, Math.max(0, w), h, r);
  if (fill) (g.fillStyle = fill), g.fill();
  if (stroke) (g.strokeStyle = stroke), (g.lineWidth = lw), g.stroke();
}
function dot(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  g.fill();
}
function txt(g, s, x, y, size, color, align = 'left', weight = 800) {
  Object.assign(g, { font: `${weight} ${size}px ${FONT}`, textAlign: align, textBaseline: 'middle', fillStyle: color });
  g.fillText(s, x, y);
}
