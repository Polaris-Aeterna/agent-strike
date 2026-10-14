// DOTA 推塔：三路推塔。每个会话是一个英雄，跑命令普攻，测试通过暴击，上网查资料放雷神之怒，压缩上下文就回城。
// 先打同一路的对线英雄，没人守就推塔：一塔 → 高地塔 → 遗迹。拆掉遗迹赢一局；大乱斗里先掉一座塔就输。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, ACTIONS, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, rand, pill, hpBar, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'moba',
  icon: '🏰',
  get name() { return L('DOTA 推塔', 'DOTA Push'); },
  get desc() { return L('三路推塔。跑命令普攻，测试通过暴击，上网查资料放雷神之怒，拆掉对面遗迹赢一局', 'Three-lane push. Commands attack, passing tests crit, web search casts Zeus ult. Destroy the enemy Ancient'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return { start: L('😵 {a} 被控住了', '😵 {a} is stunned'), sub: L('40 秒内回它就是解控，超时就被塔杀', 'Reply within 40s to dispel it, or the tower kills it'), done: L('✨ 解控成功', '✨ Dispelled'), boom: L('💀 {a} 泉水挂机，被塔杀了', '💀 {a} went AFK and got tower-killed') };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('普攻：先打同路英雄，没人守就推塔', 'Attack: hit the lane hero, push if undefended')],
      [L('🎯 测试 / 编译通过 / commit', '🎯 Tests / build pass / commit'), L('暴击', 'Critical strike')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('插眼，下一刀视野暴击（眼插满了就远程消耗）', 'Place a ward: next hit crits (full wards = poke)')],
      [L('🧱 改代码', '🧱 Edit code'), L('补刀，加钱加经验', 'Last hit: gold + XP')],
      [L('🔭 上网查资料', '🔭 Web search'), L('⚡ 雷神之怒，全图大（要蓝，没蓝就普攻）', "⚡ Thundergod's Wrath, global ult (needs mana)")],
      [L('💭 思考', '💭 Thinking'), L('回蓝', 'Mana regen')],
      [L('✅ 任务完成', '✅ Task done'), L('放大招，带跳刀就是跳大', 'Ultimate; with Blink Dagger it is a blink-ult')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('🐻 熊灵带线偷塔，死了也能放', '🐻 Spirit Bear backdoors, even while dead')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('回城：TP 回泉水回满血', 'TP home: back to fountain at full HP')],
      [L('💬 你发消息', '💬 You send a message'), L('死了就买活，活着就回血', 'Buyback if dead, heal if alive')],
      [L('✋ 你打断它', '✋ You interrupt it'), L('被你 GANK 了', 'You ganked it')],
      [L('🐛 报错', '🐛 Error'), L('被小兵 / 塔围殴', 'Beaten up by creeps / tower')],
      [L('😵 它在等你', '😵 It waits for you'), L('被控住了，40 秒内回它就解控', 'Stunned: reply within 40s to dispel')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('偷塔成功', 'Backdoor: tower stolen')],
      [L('💰 token', '💰 Tokens'), L('赚钱出装：假腿 → 跳刀 → BKB → 辉耀 → 圣剑', 'Gold for items: Treads → Blink → BKB → Radiance → Rapier')],
    ];
  },
};

const LANES = ['top', 'mid', 'bot'];
const LANE_ORDER = ['mid', 'top', 'bot']; // 分路顺序：先中单，再上下
// 名字都是函数：每次显示时按当前语言取
const laneName = (lane) => ({ top: L('上路', 'top'), mid: L('中路', 'mid'), bot: L('下路', 'bot') })[lane];
const sideName = (team) => (team === 'claude' ? L('天辉', 'Radiant') : L('夜魇', 'Dire'));
const tierName = (tier) => [L('一塔', 'T1 tower'), L('高地塔', 'high-ground tower'), L('遗迹', 'Ancient')][tier];
/** 「天辉上路一塔」/「Radiant top T1 tower」 */
const whereName = (team, lane, tier) => {
  const [s, l, t] = [sideName(team), laneName(lane), tierName(tier)];
  return L(`${s}${l}${t}`, `${s} ${l} ${t}`);
};

const TOWER_HP = [700, 850]; // 一塔、高地塔
const ANCIENT_HP = 1400;
const PARTY_TOWER = 0.9; // 大乱斗里塔脆一点，回合要短
const BASE_DMG = 70;
// 规则里只存装备 id，名字显示时再翻译，换语言不影响比赛
const ITEMS = [
  { id: 'treads', icon: '👢', cost: 400, mult: 0.1, name: () => L('假腿', 'Power Treads') },
  { id: 'blink', icon: '✨', cost: 800, mult: 0.1, name: () => L('跳刀', 'Blink Dagger') },
  { id: 'bkb', icon: '🛡', cost: 1200, mult: 0.15, name: () => 'BKB' },
  { id: 'radiance', icon: '🌞', cost: 1400, mult: 0.25, name: () => L('辉耀', 'Radiance') },
];
const RAPIER = { id: 'rapier', icon: '⚔️', cost: 1700, mult: 0.8, name: () => L('圣剑', 'Divine Rapier') };
const ITEM = Object.fromEntries([...ITEMS, RAPIER].map((it) => [it.id, it]));
const ULT_COUNT = 8;
const ultName = (i) => [
  L('黑洞', 'Black Hole'),
  L('时间结界', 'Chronosphere'),
  L('两极反转', 'Reverse Polarity'),
  L('回音击', 'Echo Slam'),
  L('月蚀', 'Eclipse'),
  L('极寒领域', 'Freezing Field'),
  L('神灭斩', 'Laguna Blade'),
  L('超新星', 'Supernova'),
][i];
const multiName = (m) => [null, null, L('双杀！', 'Double Kill!'), L('三杀！', 'Triple Kill!'), L('疯狂杀戮！', 'Ultra Kill!'), L('暴走！', 'Rampage!')][m];
const multiSub = (m, an) => [
  null,
  null,
  L(`${an} 一波带走两个`, `${an} takes two at once`),
  L(`${an} 一个人打出三杀`, `${an} gets a one-man triple`),
  L(`${an} 杀到对面快没人了`, `${an} is running out of targets`),
  L(`${an} 五杀！PENTA KILL`, `${an} PENTA KILL!`),
][m];
const streakName = (n) => [
  L('大杀特杀', 'Killing Spree'),
  L('主宰比赛', 'Dominating'),
  L('杀人如麻', 'Mega Kill'),
  L('无人能挡', 'Unstoppable'),
  L('变态杀戮', 'Wicked Sick'),
  L('妖怪般的杀戮', 'Monster Kill'),
  L('如同神一般', 'Godlike'),
  L('超越神的杀戮', 'Beyond Godlike'),
][Math.min(n, 10) - 3];
const MULTI_MS = 18e3;
const ZEUS_MANA = 80;

const hpMax = (p) => 560 + 70 * (p.level - 1);
const xpNeed = (lv) => 70 + 30 * lv;
const respawnMs = (lv) => 10e3 + 3.5e3 * lv;
const short = (s) => (s.length > 10 ? `${s.slice(0, 9)}…` : s);
/** 没有英雄击杀时，播报里算谁的（只看 cause / src，不看翻译后的文字）。 */
const culprit = (info) => {
  if (info.cause === 'human') return L('你', 'You');
  if (info.cause === 'net') return L('网络', 'The network');
  if (info.cause === 'tower' || info.src === 'tower') return L('防御塔', 'The tower');
  return info.cause === 'afk' ? L('泉水', 'The fountain') : L('小兵', 'The creeps');
};

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { gameLen: 40 * 60e3, partyLen: 8 * 60e3 };

  init() {
    this.towerMax = TOWER_HP.map((x) => Math.round(x * (this.opts.party ? PARTY_TOWER : 1)));
    this.ancientMax = ANCIENT_HP;
    this.newGame();
  }

  newGame() {
    const one = () => ({ top: [...this.towerMax], mid: [...this.towerMax], bot: [...this.towerMax], ancient: this.ancientMax });
    this.st = { claude: one(), codex: one() };
    this.kills = { claude: 0, codex: 0 };
    this.firstBlood = false;
    this.pending = null; // 本局已分胜负，等 check() 收尾
    this.ground = []; // 掉在地上没人捡的圣剑
    this.says = []; // 攒着的播报，check() 里挑一条放
    this.alertAt = { claude: -1e15, codex: -1e15 };
    this.deadline = this.now + (this.opts.party ? this.opts.partyLen : this.opts.gameLen);
  }

  /** 这一路最前面还立着的建筑：0 一塔，1 高地塔，2 遗迹。 */
  front(team, lane) {
    const t = this.st[team][lane];
    return t[0] > 0 ? 0 : t[1] > 0 ? 1 : 2;
  }

  initPlayer(p) {
    Object.assign(p, { lane: 'mid', game: -1, level: 1, xp: 0, gold: 0, items: [], rapier: 0, hp: 560, mana: 100, ward: 0,
      summonUntil: 0, baseUntil: 0, stun: false, respawnAt: 0, streak: 0, multi: 0, multiT: -1e15, feed: 0, dmgBy: new Map() });
  }

  /** 新的一局从 1 级出门；大乱斗只打一局，直接从中期开始（6 级，带点钱）。 */
  fresh(p) {
    const party = this.opts.party;
    Object.assign(p, { game: this.round, level: party ? 6 : 1, xp: 0, gold: party ? 1500 : 600, items: [], rapier: 0, streak: 0, multi: 0, feed: 0, summonUntil: 0 });
  }

  spawn(p) {
    Object.assign(p, { alive: true, hp: hpMax(p), mana: 100, ward: 0, stun: this.waiting(p), respawnAt: 0, baseUntil: 0 });
    p.dmgBy.clear();
  }

  onEnter(p) {
    if (p.game !== this.round) this.fresh(p);
    this.spawn(p);
    const n = (lane) => this.field(p.team).filter((q) => q !== p && q.lane === lane).length;
    p.lane = LANE_ORDER.reduce((best, l) => (n(l) < n(best) ? l : best));
  }

  onRoundStart(fx) {
    this.newGame();
    for (const team of TEAMS) this.field(team).forEach((p, i) => (p.lane = LANE_ORDER[i % 3]));
    for (const p of this.field()) {
      this.fresh(p);
      this.spawn(p);
    }
    if (!this.opts.party) fx.push({ type: 'note', text: L('敌军还有 5 秒到达战场 · 全军出击！', 'Minions have spawned · All units, attack!'), sids: [] });
  }

  ghostOk(ev) {
    return ev.k === 'agent' || ev.k === 'prompt' || ev.k === 'pr';
  }

  inBase(p) {
    return p.baseUntil > this.now;
  }

  onTokens(p, n, fx) {
    if (this.phase !== 'live' || !p.onField) return;
    p.gold += Math.round(Math.min(n, 4000) / 40);
    this.shop(p, fx);
  }

  onEvent(p, ev, r, fx) {
    if (this.phase !== 'live' || this.pending) return;
    if (ACTIONS.has(ev.k) && p.alive) {
      p.gold += 10;
      p.mana = Math.min(100, p.mana + 5);
      this.pickup(p, fx);
    }
    if (ev.ok === false && p.alive) return this.selfHurt(p, r, fx);
    // AI 动作 → 游戏效果。读文件是插眼攒暴击（最多 3 个），眼插满了就顺手远程消耗一下
    switch (ev.k) {
      case 'shell': this.attack(p, r, fx, ev.hs ? { mult: 2.4, crit: L('暴击', 'Crit') } : {}); break;
      case 'misc': this.attack(p, r, fx, { mult: 0.7 }); break;
      case 'read': p.ward >= 3 ? this.attack(p, r, fx, { mult: 0.5, weapon: L('远程消耗', 'Poke'), keepWard: true }) : fx.push({ type: 'ward', sid: p.sid, lane: p.lane, n: ++p.ward }); break;
      case 'edit': p.gold += 90; fx.push({ type: 'farm', sid: p.sid, gold: 90 }); break;
      case 'web': p.mana >= ZEUS_MANA ? this.zeus(p, r, fx) : this.attack(p, r, fx, { mult: 0.8, weapon: L('没蓝了', 'No mana') }); break;
      case 'think': p.mana = Math.min(100, p.mana + 34); fx.push({ type: 'mana', sid: p.sid }); break;
      case 'compact': Object.assign(p, { hp: hpMax(p), mana: 100, baseUntil: this.now + 30e3 }); fx.push({ type: 'tp', sid: p.sid }); break;
      case 'done': this.ult(p, r, fx); break;
      case 'agent': this.summon(p, r, fx); break;
      case 'prompt': p.alive ? this.heal(p, 0.2, fx) : this.buyback(p, fx); break;
      case 'abort': fx.push({ type: 'gank', sid: p.sid }); this.kill(null, p, { weapon: L('被你 GANK 了', 'Ganked by you'), cause: 'human' }, fx); break;
      case 'apierr': this.hurt(p, 0.15, { weapon: L('掉线', 'Disconnected'), cause: 'net' }, fx); break;
      case 'pr': this.steal(p, fx); break;
    }
    const xp = { shell: ev.hs ? 30 : 18, misc: 10, read: 10, edit: 40, web: 20, done: 50 }[ev.k];
    if (xp) this.xp(p, xp, fx);
    this.shop(p, fx);
  }

  // ---------------------------------------------------------------- 打人 / 推塔

  power(p) {
    const items = p.items.reduce((s, n) => s + ITEM[n].mult, 0) + p.rapier * RAPIER.mult;
    return BASE_DMG * (1 + 0.06 * (p.level - 1)) * (1 + items) * this.balanceMult(p.team) * this.sizeMult();
  }

  /** 同一路、活着、不在泉水里的敌方英雄。 */
  laneFoes(p) {
    return this.alive(OTHER[p.team]).filter((q) => q.lane === p.lane && !this.inBase(q));
  }

  attack(p, r, fx, o) {
    if (!p.alive) return;
    if (this.inBase(p)) return fx.push({ type: 'idle', sid: p.sid });
    let mult = o.mult || 1;
    let crit = o.crit || null;
    if (p.ward && !o.keepWard) {
      // 有眼就是好打：插过眼的下一刀必暴击，眼插得越多暴得越狠
      const bonus = 1.3 + 0.5 * p.ward;
      p.ward = 0;
      if (crit) mult *= 1 + (bonus - 1) / 2;
      else [mult, crit] = [mult * bonus, L('视野暴击', 'Vision crit')];
    }
    if (crit) p.hs++;
    const dmg = this.power(p) * mult * (0.85 + r() * 0.3);
    const foe = this.laneFoes(p).sort((a, b) => a.hp - b.hp)[0];
    const info = { weapon: crit || o.weapon || L('普攻', 'Attack'), crit, kind: crit ? 'crit' : 'hit' };
    if (foe) this.hitHero(p, foe, dmg, info, fx);
    else this.hitStructure(p, dmg * (p.summonUntil > this.now ? 1.3 : 1), info, r, fx);
  }

  hitHero(att, vic, dmg, info, fx) {
    if (!vic.alive) return;
    if (vic.stun) dmg *= 1.5; // 被控住了，集火
    if (vic.rapier) dmg *= 1.3; // 拿圣剑的人全队都想杀
    if (info.magic && vic.items.includes('bkb')) dmg *= 0.5;
    const d = Math.max(1, Math.round(Math.min(dmg, vic.hp)));
    vic.hp -= d;
    att.dmg += Math.round(d / 6);
    vic.dmgBy.set(att.sid, this.now);
    fx.push({ type: 'atk', from: att.sid, to: vic.sid, dmg: d, crit: info.crit, kind: info.kind });
    if (vic.hp <= 0) this.kill(att, vic, info, fx);
  }

  hitStructure(p, dmg, info, r, fx) {
    const [def, lane] = [OTHER[p.team], p.lane];
    const tier = this.front(def, lane);
    const d = Math.max(1, Math.round(dmg));
    const s = this.st[def];
    const left = tier < 2 ? (s[lane][tier] = Math.max(0, s[lane][tier] - d)) : (s.ancient = Math.max(0, s.ancient - d));
    p.dmg += Math.round(d / 12);
    fx.push({ type: 'atk', from: p.sid, st: { team: def, lane, tier }, dmg: d, crit: info.crit, kind: info.kind });
    if (left <= 0) this.destroyed(p, def, lane, tier, fx);
    else if (tier === 2) this.alert(def);
    else if (!info.noAggro && p.alive && r() < 0.4) {
      // 塔会还手：推塔的人挨一下
      const hit = Math.round(hpMax(p) * (0.08 + 0.03 * tier));
      fx.push({ type: 'thit', team: def, lane, tier, to: p.sid, dmg: Math.min(hit, p.hp) });
      this.hurt(p, hit / hpMax(p), { weapon: L('🗼 防御塔', '🗼 Tower'), cause: 'tower', quiet: true }, fx);
    }
  }

  destroyed(p, def, lane, tier, fx, steal = false) {
    fx.push({ type: 'tower', team: def, lane, tier, by: p.sid });
    if (tier === 2) return (this.pending = { winner: p.team, reason: 'ancient', text: L('摧毁遗迹', 'Ancient destroyed') });
    for (const m of this.field(p.team)) {
      m.gold += 200;
      this.xp(m, 60, fx);
    }
    const [where, n] = [whereName(def, lane, tier), short(p.name)];
    if (this.opts.party) this.pending = { winner: p.team, reason: steal ? 'pr' : 'tower', text: steal ? L(`偷塔成功 · ${where}`, `Backdoor · ${where}`) : L(`推掉${where}`, `Took down ${where}`) };
    else if (steal) this.say(9, L('偷塔成功！', 'Backdoor!'), L(`${n} 趁没人偷掉了${where}`, `${n} sneaked down the ${where}`), 'gold');
    else if (tier === 1) this.say(6, L('高地塔被摧毁！', 'High-ground tower destroyed!'), L(`${n} 破高地了 · ${where}`, `${n} broke high ground · ${where}`), p.team);
    else this.say(5, L('防御塔被摧毁！', 'Tower destroyed!'), L(`${where} · ${n} 推的`, `${where} · pushed by ${n}`), p.team);
  }

  alert(def) {
    if (this.now - this.alertAt[def] < 60e3) return;
    this.alertAt[def] = this.now;
    const [side, team, pct] = [sideName(def), TEAM_NAME[def], Math.round((this.st[def].ancient / this.ancientMax) * 100)];
    this.say(4, L('我方遗迹正在遭受攻击！', 'Our Ancient is under attack!'), L(`${side} · ${team} 遗迹还剩 ${pct}%`, `${side} · ${team} Ancient at ${pct}%`), 'bad');
  }

  /** 报错 / 掉线 / 挨塔：自己掉血，打死了算小兵或塔的。 */
  hurt(p, frac, info, fx) {
    if (!p.alive) return;
    const d = Math.max(1, Math.min(p.hp, Math.round(hpMax(p) * frac)));
    p.hp -= d;
    if (!info.quiet) fx.push({ type: 'self', sid: p.sid, dmg: d, src: info.src || info.cause });
    if (p.hp <= 0) this.kill(null, p, info, fx);
  }

  selfHurt(p, r, fx) {
    const tower = r() < 0.4 && !this.inBase(p);
    this.hurt(p, 0.08 + r() * 0.05, { weapon: tower ? L('塔下送了', 'Fed to the tower') : L('被小兵围殴', 'Mobbed by creeps'), cause: 'bug', src: tower ? 'tower' : 'creep' }, fx);
  }

  heal(p, frac, fx) {
    const amount = Math.min(hpMax(p) - p.hp, Math.round(hpMax(p) * frac));
    p.hp += amount;
    fx.push({ type: 'heal', sid: p.sid, amount });
  }

  // ---------------------------------------------------------------- 技能

  zeus(p, r, fx) {
    p.mana -= ZEUS_MANA;
    const foes = this.alive(OTHER[p.team]);
    fx.push({ type: 'zeus', sid: p.sid, to: foes.map((q) => q.sid) });
    const pow = this.power(p) * 0.6;
    for (const q of foes) this.hitHero(p, q, pow * (0.9 + r() * 0.2), { weapon: L('雷神之怒', "Thundergod's Wrath"), magic: true, kind: 'zeus' }, fx);
  }

  ult(p, r, fx) {
    if (!p.alive || this.inBase(p)) return;
    const name = ultName(hash(p.sid) % ULT_COUNT);
    const blink = p.items.includes('blink');
    const foes = this.laneFoes(p);
    fx.push({ type: 'ult', sid: p.sid, name: blink ? L(`跳刀${name}`, `Blink ${name}`) : name, blink, lane: p.lane, to: foes.map((q) => q.sid) });
    const pow = this.power(p) * 2.2;
    for (const q of foes) this.hitHero(p, q, pow * (0.9 + r() * 0.2), { weapon: name, magic: true, kind: 'ult' }, fx);
    if (!this.pending) this.hitStructure(p, pow, { kind: 'ult', noAggro: true }, r, fx);
  }

  summon(p, r, fx) {
    p.summonUntil = this.now + 60e3;
    fx.push({ type: 'summon', sid: p.sid, team: OTHER[p.team], lane: p.lane, tier: this.front(OTHER[p.team], p.lane), ghost: !p.alive });
    this.hitStructure(p, this.power(p) * 1.6, { kind: 'bear', noAggro: true }, r, fx);
  }

  buyback(p, fx) {
    const cost = 200 + 30 * p.level;
    const lack = cost - p.gold;
    if (lack > 0) return fx.push({ type: 'note', text: L(`💸 {0} 没钱买活（还差 ${lack}）`, `💸 {0} can't afford buyback (${lack} short)`), sids: [p.sid] });
    p.gold -= cost;
    this.spawn(p);
    fx.push({ type: 'buyback', sid: p.sid, cost }, { type: 'note', text: L(`💰 {0} 花 ${cost} 买活了！`, `💰 {0} bought back for ${cost}!`), sids: [p.sid], cls: 'big' });
  }

  steal(p, fx) {
    const def = OTHER[p.team];
    const tier = this.front(def, p.lane);
    const s = this.st[def];
    fx.push({ type: 'steal', sid: p.sid, team: def, lane: p.lane, tier });
    if (tier < 2) {
      s[p.lane][tier] = 0;
      return this.destroyed(p, def, p.lane, tier, fx, true);
    }
    s.ancient = Math.max(0, s.ancient - Math.round(this.ancientMax * 0.35));
    const n = short(p.name);
    if (s.ancient <= 0) this.destroyed(p, def, p.lane, 2, fx);
    else this.say(9, L('偷塔成功！', 'Backdoor!'), L(`${n} 偷了一大口遗迹`, `${n} took a huge bite out of the Ancient`), 'gold');
  }

  // ---------------------------------------------------------------- 等级 / 出装 / 圣剑

  xp(p, n, fx) {
    p.xp += n;
    while (p.level < 25 && p.xp >= xpNeed(p.level)) {
      p.xp -= xpNeed(p.level);
      p.level++;
      if (p.alive) p.hp += 70;
      fx.push({ type: 'lvl', sid: p.sid, level: p.level });
    }
  }

  /** 按顺序出装；队伍落后时出完假腿就直接憋圣剑，赌一把翻盘。 */
  shop(p, fx) {
    for (;;) {
      const next = p.items.length < ITEMS.length ? ITEMS[p.items.length] : null;
      const gamble = !p.rapier && p.items.length >= 1 && next && this.leader() === OTHER[p.team];
      const it = gamble || !next ? (p.rapier < 2 ? RAPIER : null) : next;
      if (!it || p.gold < it.cost) return;
      p.gold -= it.cost;
      if (it === RAPIER) p.rapier++;
      else p.items.push(it.id);
      fx.push({ type: 'buy', sid: p.sid, item: it.id });
      if (it !== RAPIER) continue;
      const n = short(p.name);
      if (p.rapier > 1) this.say(7, L('双圣剑！', 'Double Rapier!'), L(`${n} 带着两把圣剑，谁杀谁发财`, `${n} carries two Rapiers. Kill them, get rich`), 'gold');
      else if (gamble) this.say(7, L('圣剑出世！', 'Divine Rapier!'), L(`${n} 劣势憋出了圣剑，赌一把！`, `${n} is losing and gambles on a Rapier!`), 'gold');
      else this.say(7, L('圣剑出世！', 'Divine Rapier!'), L(`${n} 憋出了圣剑，死了可是要掉的`, `${n} bought a Rapier. Don't die with it`), 'gold');
    }
  }

  pickup(p, fx) {
    const i = this.ground.findIndex((g) => g.lane === p.lane);
    if (i < 0 || this.inBase(p)) return;
    const [g] = this.ground.splice(i, 1);
    p.rapier += g.n;
    fx.push({ type: 'rpick', sid: p.sid, lane: g.lane });
    const n = short(p.name);
    this.say(12, L('圣剑被捡走了！', 'Rapier picked up!'), g.team === p.team ? L(`${n} 把队友的圣剑捡回来了，虚惊一场`, `${n} recovered the team's Rapier. Phew`) : L(`${n} 白捡一把圣剑`, `${n} got a free Rapier`), 'gold');
  }

  // ---------------------------------------------------------------- 击杀与播报

  kill(att, vic, info, fx) {
    if (!vic.alive) return;
    if (att && att.team === vic.team) att = null;
    Object.assign(vic, { alive: false, hp: 0, stun: false, respawnAt: this.now + respawnMs(vic.level) });
    vic.d++;
    this.kills[OTHER[vic.team]]++;
    const vn = short(vic.name);
    const an = att ? short(att.name) : culprit(info);
    const cls = att ? att.team : 'bad';
    if (!this.firstBlood) {
      this.firstBlood = true;
      this.say(8, L('第一滴血！', 'First Blood!'), L(`${an} 拿下了 ${vn} 的一血`, `${an} drew first blood on ${vn}`), cls);
    }
    if (vic.streak >= 3) {
      const sp = streakName(vic.streak);
      this.say(10, L('终结！', 'Shutdown!'), L(`${an} 终结了 ${vn} 的${sp}`, `${an} ended ${vn}'s ${sp}`), cls);
      if (att) att.gold += 100 + 50 * vic.streak;
    }
    let assist = null;
    if (att) {
      att.k++;
      att.streak++;
      att.feed = 0;
      att.multi = this.now - att.multiT <= MULTI_MS ? att.multi + 1 : 1;
      att.multiT = this.now;
      att.gold += 200 + 30 * vic.level;
      this.xp(att, 100 + 15 * vic.level, fx);
      for (const [sid, t] of vic.dmgBy) {
        const a = this.players.get(sid);
        if (sid === att.sid || !a || this.now - t > 20e3) continue;
        a.a++;
        a.gold += 70;
        this.xp(a, 50, fx);
        assist = assist || sid;
      }
      const m = Math.min(att.multi, 5);
      if (m >= 2) this.say(13 + m, multiName(m), multiSub(m, an), att.team);
      if (att.streak >= 3) {
        const [sp, k, god] = [streakName(att.streak), att.streak, att.streak >= 10 ? L(' · 已经超神了！', ' · Legendary!') : ''];
        this.say(3, L(`${sp}！`, `${sp}!`), L(`${an} 已经 ${k} 连杀${god}`, `${an}: ${k} kills in a row${god}`), att.team);
      }
    }
    Object.assign(vic, { streak: 0, multi: 0, feed: vic.feed + 1 });
    const fed = vic.feed;
    const feed = fed === 3 ? L('💀 {0} 已经连送 3 个人头了', '💀 {0} has fed 3 in a row') : fed === 5 ? L('💀 {0} 连送 5 个，对面经济起飞', '💀 {0} fed 5 in a row. Enemy economy skyrocketing') : null;
    const lots = fed >= 8 && fed % 4 === 0 ? L(`💀 {0} 已经送了 ${fed} 个，建议泉水挂机`, `💀 {0} has fed ${fed}. Maybe just AFK in fountain`) : null;
    if (feed || lots) fx.push({ type: 'note', text: feed || lots, sids: [vic.sid] });
    vic.dmgBy.clear();
    fx.push({ type: 'kill', killer: att ? att.sid : null, victim: vic.sid, weapon: info.weapon, hs: !!info.crit, cause: info.cause || 'hero', assist });
    if (vic.rapier) this.dropRapier(att, vic, fx);
    const mates = this.field(vic.team);
    if (mates.length >= 2 && mates.every((q) => !q.alive)) this.say(15, L('团灭！', 'Ace!'), L(`${sideName(vic.team)} · ${TEAM_NAME[vic.team]} 全军覆没`, `${sideName(vic.team)} · ${TEAM_NAME[vic.team]} wiped out`), OTHER[vic.team]);
  }

  /** 圣剑：死了必掉。有人杀的归凶手，没人杀的掉在路上，谁先路过谁捡。 */
  dropRapier(att, vic, fx) {
    const [n, vn] = [vic.rapier, short(vic.name)];
    vic.rapier = 0;
    fx.push({ type: 'rapier', from: vic.sid, to: att && att.alive ? att.sid : null, lane: vic.lane });
    if (att && att.alive) {
      att.rapier += n;
      const an = short(att.name);
      this.say(20, L('圣剑掉了！', 'Rapier dropped!'), L(`${an} 捡走了 ${vn} 的圣剑`, `${an} grabbed ${vn}'s Rapier`), 'gold');
    } else {
      this.ground.push({ lane: vic.lane, n, team: vic.team });
      const ln = laneName(vic.lane);
      this.say(20, L('圣剑掉了！', 'Rapier dropped!'), L(`${vn} 的圣剑掉在${ln}，谁捡到算谁的`, `${vn}'s Rapier lies in ${ln} lane. Finders keepers`), 'gold');
    }
  }

  /** 同一时刻只能放一条大横幅：先攒着，check() 里挑最响的那条，其余拼进副标题。 */
  say(pri, text, sub, cls) {
    this.says.push({ pri, text, sub, cls });
  }

  flushSay(fx) {
    if (!this.says.length) return;
    const [top, ...rest] = this.says.sort((a, b) => b.pri - a.pri);
    this.says = [];
    const extra = rest.slice(0, 2).map((s) => s.text.replace(/[\uff01!]$/, '')).join(' · ');
    fx.push({ type: 'announce', text: top.text, sub: extra ? `${top.sub} · ${extra}` : top.sub, cls: top.cls, ms: top.pri >= 13 ? 2600 : 2000 });
  }

  // ---------------------------------------------------------------- 控制 / 复活 / 计时

  onPause() {
    this.says = [];
  }

  onWait(p, fx) {
    if (this.phase !== 'live' || !p.alive) return;
    p.stun = true;
    fx.push({ type: 'stun', sid: p.sid });
  }

  onAnswer(p, wait, fx) {
    if (!p.stun) return;
    p.stun = false;
    fx.push({ type: 'unstun', sid: p.sid });
    if (p.alive) this.heal(p, 0.3, fx);
  }

  onWaitTimeout(p, fx) {
    p.stun = false;
    if (this.phase !== 'live' || !p.alive || this.pending) return;
    const foe = this.laneFoes(p)[0];
    const base = this.inBase(p);
    const afk = base ? L('💤 泉水挂机', '💤 AFK in fountain') : L('💤 挂机被塔杀', '💤 AFK, tower-killed');
    this.kill(foe || null, p, { weapon: foe ? L('控到死', 'Stunlocked') : afk, cause: foe ? 'hero' : 'afk', src: base ? 'fountain' : 'tower' }, fx);
  }

  onTick(fx) {
    for (const p of this.field()) {
      if (p.alive || !p.respawnAt || this.now < p.respawnAt) continue;
      this.spawn(p);
      fx.push({ type: 'respawn', sid: p.sid });
    }
    if (this.pending || this.now < this.deadline) return;
    const lead = this.leader();
    if (lead) this.pending = { winner: lead, reason: 'time', text: L('时间到 · 推塔进度领先', 'Time up · ahead on towers') };
    else this.deadline = this.now + 10 * 60e3; // 谁也没推动，加时
  }

  /** 推塔进度：拆掉对面多少建筑（遗迹算双份），平了比人头。 */
  leader() {
    const prog = (team) => {
      const s = this.st[OTHER[team]];
      let x = (1 - s.ancient / this.ancientMax) * 2;
      for (const lane of LANES) for (const i of [0, 1]) x += 1 - s[lane][i] / this.towerMax[i];
      return x;
    };
    const [a, b] = [prog('claude'), prog('codex')];
    if (Math.abs(a - b) > 1e-6) return a > b ? 'claude' : 'codex';
    if (this.kills.claude !== this.kills.codex) return this.kills.claude > this.kills.codex ? 'claude' : 'codex';
    return null;
  }

  check(fx) {
    this.flushSay(fx);
    if (!this.pending) return;
    const { winner, reason, text } = this.pending;
    this.pending = null;
    this.endRound(winner, reason, fx, text);
  }
}

// ================================================================ 地图
// 左边天辉（Claude），右边夜魇（Codex）。上下两路绕边，中路直线对冲，河道竖着穿过中间。

const { w: W, h: H } = WORLD;
const TAU = Math.PI * 2;
const TOP_PATH = [[130, 480], [182, 385], [152, 190], [215, 112], [1385, 112], [1448, 190], [1418, 385], [1470, 480]];
const PATHS = { top: TOP_PATH, mid: [[130, 480], [1470, 480]], bot: TOP_PATH.map(([x, y]) => [x, H - y]) };
const TOWER_S = { top: [0.335, 0.085], mid: [0.31, 0.16], bot: [0.335, 0.085] }; // 天辉一侧，夜魇镜像
const TOWER_OFF = { top: -30, mid: -34, bot: 30 }; // 塔立在路边，靠地图外侧
const ANCIENT = { claude: [130, 480], codex: [1470, 480] };
const FOUNTAIN = { claude: [46, 480], codex: [1554, 480] };
const BASE_C = { claude: [92, 480], codex: [1508, 480] };
const BASE_R = 265;
const ROSH = [900, 318];
const DIR = { claude: 1, codex: -1 };
const GOLD = 'rgba(255,211,77,0.95)';
const riverX = (y) => 800 + 28 * Math.sin(y / 150 + 0.6);

const GEO = {};
for (const [lane, pts] of Object.entries(PATHS)) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  GEO[lane] = { pts, cum, len: cum[cum.length - 1] };
}

/** 路上的位置：s=0 天辉遗迹，s=1 夜魇遗迹；off 是垂直于路的偏移。 */
function lanePos(lane, s, off = 0) {
  const { pts, cum, len } = GEO[lane];
  const d = clamp(s, 0, 1) * len;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < d) i++;
  const [[x0, y0], [x1, y1]] = [pts[i - 1], pts[i]];
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (d - cum[i - 1]) / seg;
  return [x0 + (x1 - x0) * k - ((y1 - y0) / seg) * off, y0 + (y1 - y0) * k + ((x1 - x0) / seg) * off];
}

const sOf = (team, lane, tier) => (tier === 2 ? (team === 'claude' ? 0 : 1) : team === 'claude' ? TOWER_S[lane][tier] : 1 - TOWER_S[lane][tier]);
const stPos = (team, lane, tier) => (tier === 2 ? ANCIENT[team] : lanePos(lane, sOf(team, lane, tier), TOWER_OFF[lane]));
const frontS = (R, team, lane) => sOf(team, lane, R.front(team, lane));
const TOWERS = [];
for (const team of TEAMS) for (const lane of LANES) for (const tier of [0, 1]) TOWERS.push({ team, lane, tier, key: `${team}-${lane}-${tier}`, pos: stPos(team, lane, tier) });

function segDist(px, py, [ax, ay], [bx, by]) {
  const [dx, dy] = [bx - ax, by - ay];
  const k = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - dx * k, py - ay - dy * k);
}
const laneDist = (x, y) => Math.min(...Object.values(PATHS).map((pts) => Math.min(...pts.slice(1).map((b, i) => segDist(x, y, pts[i], b)))));

// 画图小工具：实心圆 / 椭圆 / 圆弧描边 / 折线 / 居中文字
function dot(g, x, y, r, color) {
  if (color) g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}
function oval(g, x, y, rx, ry, color) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.fill();
}
function arcLine(g, x, y, r, color, lw, a0 = 0, a1 = TAU) {
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.beginPath();
  g.arc(x, y, r, a0, a1);
  g.stroke();
}
/** 折线：fill 为颜色就填充，stroke 为颜色就描边。 */
function poly(g, pts, { fill, stroke, lw, close = !!fill } = {}) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (close) g.closePath();
  if (fill) (g.fillStyle = fill), g.fill();
  if (stroke) (g.strokeStyle = stroke), (g.lineWidth = lw || g.lineWidth), g.stroke();
}
function word(g, text, x, y, size, color, weight = 800) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, x, y);
}
function glow(g, x, y, r, color, alpha) {
  const grad = g.createRadialGradient(x, y, 1, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha;
  dot(g, x, y, r, grad);
  g.globalAlpha = 1;
}

function drawMapLayer() {
  const S = 2;
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext('2d');
  g.scale(S, S);
  // 地面：天辉一侧青草，夜魇一侧焦土
  const bg = g.createLinearGradient(0, 0, W, 0);
  [[0, '#4d7b3b'], [0.46, '#58733f'], [0.54, '#5b6343'], [1, '#54463f']].forEach(([o, col]) => bg.addColorStop(o, col));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const r = rng(11);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(20,35,10,0.10)' : 'rgba(255,250,200,0.06)';
    const s = 1 + r() * 3;
    g.fillRect(r() * W, r() * H, s, s);
  }
  // 基地高台
  for (const team of TEAMS) {
    const [bx, by] = BASE_C[team];
    dot(g, bx + DIR[team] * 6, by + 8, BASE_R, 'rgba(0,0,0,0.28)');
    dot(g, bx, by, BASE_R, team === 'claude' ? '#8b8971' : '#6a5f63');
    dot(g, bx, by, BASE_R, team === 'claude' ? 'rgba(236,138,95,0.16)' : 'rgba(79,168,255,0.14)');
    for (let rr = 50; rr < BASE_R; rr += 52) arcLine(g, bx, by, rr, 'rgba(0,0,0,0.09)', 2);
    arcLine(g, bx, by, BASE_R, 'rgba(35,25,15,0.45)', 5);
    const [lx, ink] = [team === 'claude' ? 265 : W - 265, team === 'claude' ? 'rgba(154,69,36,0.38)' : 'rgba(30,86,143,0.42)'];
    word(g, sideName(team).toUpperCase(), lx, 330, L(42, 30), ink, 900);
    word(g, TEAM_NAME[team].toUpperCase(), lx, 362, 15, ink);
  }
  // 河道（过河的地方等路画完再罩一层半透明的水）
  const bank = (side) => Array.from({ length: 124 }, (_, i) => [riverX(i * 8 - 10) + side * 44, i * 8 - 10]);
  const river = bank(-1).concat(bank(1).reverse());
  poly(g, river, { fill: '#3a7aa3' });
  for (const side of [-1, 1]) poly(g, bank(side), { stroke: 'rgba(25,45,35,0.55)', lw: 4 });
  g.strokeStyle = 'rgba(190,230,255,0.28)';
  g.lineWidth = 2;
  for (let i = 0; i < 70; i++) {
    const y = r() * H;
    const x = riverX(y) + (r() - 0.5) * 60;
    g.beginPath();
    g.moveTo(x - 7, y);
    g.quadraticCurveTo(x, y - 4, x + 7, y);
    g.stroke();
  }
  // 肉山坑
  dot(g, ROSH[0], ROSH[1], 40, '#2e2924');
  dot(g, ROSH[0], ROSH[1], 32, '#3d3630');
  for (let a = 0; a < TAU; a += 0.5) dot(g, ROSH[0] + Math.cos(a) * 41, ROSH[1] + Math.sin(a) * 41, 5 + r() * 3, '#6e665c');
  // 三条路
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const [lw, color] of [[50, 'rgba(55,40,22,0.55)'], [40, '#a68d5f'], [12, 'rgba(255,240,200,0.12)']]) for (const pts of Object.values(PATHS)) poly(g, pts, { stroke: color, lw });
  g.globalAlpha = 0.38;
  poly(g, river, { fill: '#3a7aa3' });
  g.globalAlpha = 1;
  // 树林：路、河、基地、肉山之外的空地都种上树
  const trees = [];
  for (let i = 0; i < 6000 && trees.length < 420; i++) {
    const [x, y] = [8 + r() * (W - 16), 8 + r() * (H - 16)];
    if (laneDist(x, y) < 42 || Math.abs(x - riverX(y)) < 60 || Math.hypot(x - ROSH[0], y - ROSH[1]) < 60) continue;
    if (TEAMS.some((t) => Math.hypot(x - BASE_C[t][0], y - BASE_C[t][1]) < BASE_R + 18)) continue;
    if (!trees.some(([tx, ty]) => Math.abs(tx - x) < 24 && Math.abs(ty - y) < 24)) trees.push([x, y, 0.8 + r() * 0.5, x > riverX(y)]);
  }
  const PAL = [['#2c6230', '#3d7f3b', '#5ea552'], ['#3b4634', '#57573a', '#7c6a45']];
  for (const [x, y, s, dire] of trees.sort((a, b) => a[1] - b[1])) {
    const pal = PAL[dire ? 1 : 0];
    oval(g, x + 4, y + 7, 13 * s, 8 * s, 'rgba(0,0,0,0.3)');
    dot(g, x, y, 12 * s, pal[0]);
    dot(g, x - 2.5 * s, y - 3 * s, 9 * s, pal[1]);
    dot(g, x - 5 * s, y - 6 * s, 3.5 * s, pal[2]);
  }
  // 肉山（睡着的）和地名
  oval(g, ROSH[0], ROSH[1] + 4, 20, 14, '#6b5a4a');
  for (const s of [-1, 1]) poly(g, [[ROSH[0] + s * 8, ROSH[1] - 6], [ROSH[0] + s * 18, ROSH[1] - 18], [ROSH[0] + s * 13, ROSH[1] - 4]], { fill: '#d8cfc0' });
  for (const [text, x, y] of [[L('上路', 'TOP'), 860, 74], [L('中路', 'MID'), 870, 444], [L('下路', 'BOT'), 860, H - 74], [L('肉山', 'Roshan'), ROSH[0], ROSH[1] + 56]]) word(g, text, x, y, 15, 'rgba(255,245,220,0.55)');
  return c;
}

// ================================================================ 画面

const slotOff = (i) => (i % 2 ? 1 : -1) * (6 + Math.ceil(i / 2) * 9);

class Hero {
  constructor(sid, team, lane) {
    // mode：base 在泉水，lane 在路上（s 是路上的位置）
    Object.assign(this, { sid, team, lane, mode: 'base', s: 0, seed: Math.random() * 10, hitT: 0, tpT: 0, label: null, icon: null });
    this.home();
  }

  home() {
    this.mode = 'base';
    this.dead = false;
    [this.x, this.y] = FOUNTAIN[this.team];
  }
}

const mapLayers = {}; // 地图底图按语言和队名各画一张（上面有地名；内战时队名是 Claude A / B）

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.heroes = new Map();
    this.clear();
  }

  clear() {
    this.fx.clear();
    Object.assign(this, { creeps: [], shots: [], bolts: [], ults: [], wards: [], flying: [], stHit: {}, towerCd: {} });
    Object.assign(this, { flash: 0, waveT: 0, respawnAt: 0, clash: { top: 0.5, mid: 0.5, bot: 0.5 } });
  }

  reset(R) {
    this.clear();
    this.heroes.clear();
    const pres = this.presence(R);
    for (const lane of LANES) this.clash[lane] = this.clashTarget(R, lane, pres);
    for (const p of R.field()) {
      const h = this.hero(R, p.sid);
      if (!p.alive || R.inBase(p)) continue;
      Object.assign(h, { mode: 'lane', s: this.heroTarget(R, h, 0, 0) });
      [h.x, h.y] = lanePos(h.lane, h.s);
    }
    // 兵线：每路先在前线摆两波兵
    for (const lane of LANES) for (const team of TEAMS) for (let i = 0; i < 6; i++) this.spawnCreep(lane, team, this.clash[lane] - DIR[team] * (0.012 + i * 0.012));
  }

  hero(R, sid) {
    let h = this.heroes.get(sid);
    const p = R.players.get(sid);
    if (!h && p && p.onField) this.heroes.set(sid, (h = new Hero(sid, p.team, p.lane)));
    return h;
  }

  spawnCreep(lane, team, s) {
    this.creeps.push({ lane, team, s, off: rand(-13, 13), hp: 4, cd: rand(0, 1), swing: 0, x: 0, y: 0 });
  }

  // ---------------------------------------------------------------- 效果

  apply(list, R, busy) {
    const { app, fx } = this;
    for (const f of list) {
      const h = f.sid ? this.hero(R, f.sid) : null;
      const say = (text, color, size = 14, life = 1.3, dx = 0, dy = -26) => h && fx.text(h.x + dx, h.y + dy, text, color, size, life);
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (h && text && !(busy && f.ev.k === 'read')) h.label = { text, ok: f.ev.ok !== false, life: 1.7, ghost: !f.alive };
          break;
        }
        case 'bench': this.heroes.delete(f.sid); break;
        case 'atk': this.shoot(f, busy); break;
        case 'zeus': this.zeus(f, busy); break;
        case 'ult': this.ult(R, f, busy); break;
        case 'thit': {
          const to = this.heroes.get(f.to);
          if (!to) break;
          const [x, y] = stPos(f.team, f.lane, f.tier);
          this.beam(x, y - 40, to.x, to.y, f.team);
          to.hitT = 0.2;
          if (!busy) fx.text(to.x + rand(-8, 8), to.y - 20, `🗼 -${f.dmg}`, '#ff9a7a', 13);
          break;
        }
        case 'self': {
          // 报错：被小兵围殴 / 被塔点 / 掉线
          if (!h) break;
          h.hitT = 0.2;
          const foe = OTHER[h.team];
          if (f.src === 'tower') this.beam(...stPos(foe, h.lane, Math.min(1, R.front(foe, h.lane))).map((v, i) => v - i * 40), h.x, h.y, foe);
          else if (f.src !== 'net') for (let i = 0; i < 4; i++) fx.sparks(h.x + rand(-14, 14), h.y + rand(-14, 14), COLOR[foe], 3, 80);
          const what = f.src === 'tower' ? L('🗼 塔下挨打', '🗼 Tower hit') : f.src === 'net' ? L('📡 掉线', '📡 Disconnected') : L('🐜 被小兵围殴', '🐜 Creep mob');
          say(`${what} -${f.dmg}`, '#ff8a8a', 14, 1.1, 0, -22);
          app.sfx.bite();
          break;
        }
        case 'ward': {
          if (!h || h.mode !== 'lane') break;
          const [x, y] = lanePos(h.lane, h.s + DIR[h.team] * rand(0.02, 0.06), (Math.random() < 0.5 ? -1 : 1) * rand(48, 80));
          if (this.wards.length > 14) this.wards.shift();
          this.wards.push({ x, y, team: h.team, life: 30 });
          if (!busy) fx.text(x, y - 14, f.n > 1 ? L(`👁 插眼 ×${f.n}`, `👁 Ward ×${f.n}`) : L('👁 插眼', '👁 Ward'), '#ffe27a', 12);
          break;
        }
        case 'farm': if (!busy) say(`🔪 +${f.gold}`, '#ffd34d', 13, 1.1, 34, -4); break;
        case 'mana': if (h && !busy) fx.ring(h.x, h.y, 28, 8, 'rgba(110,170,255,0.85)', 0.5, 3); break;
        case 'heal':
          if (!h || f.amount <= 0) break;
          fx.ring(h.x, h.y, 30, 6, 'rgba(111,211,139,0.9)', 0.5);
          if (!busy) say(`+${f.amount}`, '#6fd38b', 14, 1.1, -32, -4);
          break;
        case 'tp':
          if (!h) break;
          h.tpT = busy ? 0.01 : 0.8;
          say(L('🌀 回城', '🌀 TP home'), '#bfe3ff', 15);
          if (app.sfx.ok?.(1)) app.sfx.tone?.(300, 0.6, 0.08, 'sine', 900);
          break;
        case 'summon': {
          const [x, y] = stPos(f.team, f.lane, f.tier);
          fx.ring(x, y, 4, 60, 'rgba(160,120,70,0.9)', 0.6, 5);
          if (!busy) fx.text(x, y - 56, f.ghost ? L('🐻 人死了熊还在带线', '🐻 Hero dead, bear still pushing') : L('🐻 熊灵偷塔', '🐻 Spirit Bear backdoor'), '#e0b27a', 15, 1.5);
          break;
        }
        case 'buy': {
          if (!h) break;
          const [it, big] = [ITEM[f.item], f.item === 'rapier'];
          say(`${it.icon} ${it.name()}`, big ? '#ffd34d' : '#fff2c0', big ? 18 : 14, 1.5, 0, -34);
          if (big) fx.ring(h.x, h.y, 10, 70, GOLD, 0.8, 4);
          if (app.sfx.ok?.(1)) app.sfx.tone?.(1180, 0.07, 0.12, 'square', 1560);
          break;
        }
        case 'lvl':
          if (!h || busy) break;
          fx.ring(h.x, h.y, 8, 34, 'rgba(255,220,120,0.9)', 0.5, 2);
          say(`LV ${f.level}`, '#ffe08a', 12, 1.1, 30, 8);
          break;
        case 'rapier': {
          // 圣剑从死者身上飞向凶手；没有凶手就掉在地上
          const from = this.heroes.get(f.from);
          if (from) this.flying.push({ x: from.x, y: from.y, to: f.to ? this.heroes.get(f.to) : null, t: 0, dur: 0.9 });
          if (from) fx.ring(from.x, from.y, 10, 80, GOLD, 0.7, 5);
          app.sfx.good?.();
          break;
        }
        case 'rpick': if (h) fx.ring(h.x, h.y, 70, 10, GOLD, 0.6, 4); break;
        case 'buyback':
        case 'respawn': {
          if (!h) break;
          const bb = f.type === 'buyback';
          h.home();
          fx.ring(h.x, h.y, 6, bb ? 60 : 34, bb ? GOLD : COLOR[h.team], 0.6, 3);
          if (bb) say(L('💰 买活！', '💰 Buyback!'), '#ffd34d', 18, 1.6, 30, -30);
          break;
        }
        case 'stun': say(L('😵 被控住了', '😵 Stunned'), '#d9b3ff', 15, 1.5, 0, -30); break;
        case 'unstun':
          if (h) fx.ring(h.x, h.y, 8, 50, 'rgba(255,255,255,0.9)', 0.5, 3);
          say(L('✨ 解控', '✨ Dispelled'), '#fff', 15, 1.3, 0, -30);
          break;
        case 'gank':
          if (h) h.icon = { text: '✋', life: 2 };
          say(L('被你 GANK 了', 'Ganked by you!'), '#ffd0d0', 17, 1.8, 0, -34);
          break;
        case 'idle': if (!busy) say(L('泉水里打不到人', "Can't hit from fountain"), '#cfd8e0', 12, 1.1, 0, -22); break;
        case 'waitBoom': say(L('💤 泉水挂机', '💤 AFK in fountain'), '#ff9a9a', 17, 1.8, 0, -34); break;
        case 'steal': {
          const [x, y] = stPos(f.team, f.lane, f.tier);
          fx.text(x, y - 60, L('🏆 偷塔成功', '🏆 Backdoor!'), '#ffd34d', 20, 2);
          fx.ring(x, y, 10, 120, GOLD, 0.8, 6);
          break;
        }
        case 'tower': {
          const [x, y] = stPos(f.team, f.lane, f.tier);
          const big = f.tier === 2;
          fx.explosion(x, y - 10, !busy);
          if (big && !busy) app.later(0.25, () => fx.explosion(x + rand(-30, 30), y - 30, true));
          const tn = tierName(f.tier).replace(/^./, (c) => c.toUpperCase());
          fx.text(x, y - 50, big ? L('💥 遗迹被摧毁', '💥 Ancient destroyed') : L(`💥 ${tn}倒了`, `💥 ${tn} down`), '#ffcf6b', big ? 22 : 17, 1.8);
          app.shake(big ? 0.8 : 0.45, big ? 14 : 8);
          app.sfx.boom(true);
          break;
        }
        case 'kill': {
          const v = this.heroes.get(f.victim);
          if (!v) break;
          v.dead = true;
          fx.sparks(v.x, v.y, COLOR[v.team], busy ? 6 : 14, 180);
          if (!busy) fx.text(v.x, v.y - 26, '💀', '#fff', 20, 1.2);
          break;
        }
        case 'roundEnd': this.respawnAt = app.rt() + (busy ? 0.4 : 1.6); break;
      }
    }
  }

  /** 普攻是一颗飞行的弹道，打到了才跳伤害；大招 / 雷神之怒 / 熊灵直接跳字。 */
  shoot(f, busy) {
    const from = this.heroes.get(f.from);
    const t = f.to ? this.heroes.get(f.to) : null;
    const [sx, sy] = f.st ? stPos(f.st.team, f.st.lane, f.st.tier) : [0, 0];
    const target = f.st ? () => [sx, sy - (f.st.tier === 2 ? 26 : 20)] : t ? () => [t.x, t.y - 4] : null;
    if (!target) return;
    const big = !!f.crit || f.kind === 'ult';
    const land = () => {
      const [x, y] = target();
      if (f.st) this.stHit[`${f.st.team}-${f.st.lane}-${f.st.tier}`] = 0.2;
      else t.hitT = 0.18;
      if (f.crit) {
        this.fx.text(x, y - 18, `💥 ${f.crit} -${f.dmg}`, '#ff5a3c', 19, 1.3);
        this.fx.sparks(x, y, '#ff8a50', 12, 200);
      } else if (!busy || f.kind !== 'hit') {
        this.fx.text(x + rand(-10, 10), y - 16, `${{ zeus: '⚡', bear: '🐻' }[f.kind] || ''}-${f.dmg}`, big ? '#ffcf6b' : '#fff', big ? 17 : 13);
        this.fx.sparks(x, y, '#ffe2b0', busy ? 2 : 5);
      }
    };
    if ((f.kind !== 'hit' && f.kind !== 'crit') || !from || from.dead || busy) return land();
    const [tx, ty] = target();
    const dur = clamp(Math.hypot(tx - from.x, ty - from.y) / 650, 0.1, 0.45);
    this.shots.push({ x: from.x, y: from.y - 6, target, t: 0, dur, team: from.team, crit: !!f.crit, land });
    if (f.crit) this.app.sfx.headshot();
    else this.app.sfx.shot('Deagle'); // 轻一点的枪声
  }

  beam(x1, y1, x2, y2, team) {
    this.fx.tracer(x1, y1, x2, y2, COLOR[team], 4, 0.22);
    this.fx.tracer(x1, y1, x2, y2, 'rgba(255,255,255,0.9)', 1.5, 0.22);
  }

  zeus(f, busy) {
    const h = this.heroes.get(f.sid);
    if (h) this.fx.text(h.x, h.y - 64, f.to.length ? L('⚡ 雷神之怒', "⚡ Thundergod's Wrath") : L('⚡ 雷神之怒 · 打了个寂寞', "⚡ Thundergod's Wrath · hit nothing"), '#bfe0ff', 18, 1.6);
    for (const t of f.to.map((sid) => this.heroes.get(sid)).filter(Boolean)) {
      // 每个敌人头上劈一道锯齿闪电
      const x0 = t.x + rand(-60, 60);
      const pts = Array.from({ length: 10 }, (_, i) => [x0 + ((t.x - x0) * i) / 9 + (i && i < 9 ? rand(-16, 16) : 0), t.y - 420 * (1 - i / 9)]);
      this.bolts.push({ pts, life: 0.45, max: 0.45 });
      this.fx.ring(t.x, t.y, 4, 46, 'rgba(180,220,255,0.95)', 0.4, 4);
    }
    if (!busy) this.flash = 0.25;
    this.app.sfx.boom(false);
    if (this.app.sfx.ok?.(2)) this.app.sfx.burst?.(0.5, 1800, 0.25, 'highpass');
  }

  ult(R, f, busy) {
    const h = this.heroes.get(f.sid);
    if (!h) return;
    const ts = f.to.map((sid) => this.heroes.get(sid)).filter(Boolean);
    const avg = (k) => ts.reduce((s, t) => s + t[k], 0) / ts.length;
    const [x, y] = ts.length ? [avg('x'), avg('y')] : stPos(OTHER[h.team], f.lane, R.front(OTHER[h.team], f.lane));
    if (f.blink) {
      // 跳大：先闪到人堆里再放
      this.fx.ring(h.x, h.y, 26, 4, 'rgba(190,120,255,0.95)', 0.35, 4);
      this.fx.sparks(h.x, h.y, '#c58bff', 12, 160);
      [h.x, h.y] = [x - DIR[h.team] * 30, y];
      this.fx.ring(h.x, h.y, 4, 30, 'rgba(190,120,255,0.95)', 0.35, 4);
    }
    this.ults.push({ x, y, r: 115, life: 0.9, max: 0.9, team: h.team });
    this.fx.ring(x, y, 10, 130, COLOR[h.team], 0.7, 8);
    this.app.shake(0.35, 7);
    this.app.sfx.boom(false);
    if (!busy) this.fx.text(x, y - 70, `🌀 ${f.name}`, '#fff', 22, 1.6);
  }

  // ---------------------------------------------------------------- 状态推进

  presence(R) {
    const pres = { top: { claude: 0, codex: 0 }, mid: { claude: 0, codex: 0 }, bot: { claude: 0, codex: 0 } };
    for (const p of R.field()) if (p.alive && !R.inBase(p) && pres[p.lane]) pres[p.lane][p.team]++;
    return pres;
  }

  /** 兵线交汇点：两边最前面的建筑中间；只有一边有人在线时一路推到对面塔下。 */
  clashTarget(R, lane, pres) {
    const [cf, xf] = [frontS(R, 'claude', lane), frontS(R, 'codex', lane)];
    const { claude: c, codex: x } = pres[lane];
    return cf + (xf - cf) * (c && !x ? 0.92 : x && !c ? 0.08 : 0.5);
  }

  /** 英雄站在自己这边的前线后面一点，不进对面塔的射程。 */
  heroTarget(R, h, slot, rt) {
    const dir = DIR[h.team];
    const lim = frontS(R, OTHER[h.team], h.lane) - dir * (80 / GEO[h.lane].len);
    const s = this.clash[h.lane] - dir * (0.03 + slot * 0.018);
    return (dir > 0 ? Math.min(s, lim) : Math.max(s, lim)) + Math.sin(rt * 0.6 + h.seed) * 0.008;
  }

  update(dt, R) {
    const rt = this.app.rt();
    this.fx.update(dt);
    const pres = this.presence(R);
    for (const lane of LANES) this.clash[lane] += (this.clashTarget(R, lane, pres) - this.clash[lane]) * Math.min(1, dt * 0.8);
    this.updateCreeps(dt, R);
    // 英雄：在线上就跟着自己这边的前线走，回城 / 刚复活就从泉水出发
    const slots = {};
    const k = Math.min(1, dt * 7);
    for (const h of this.heroes.values()) {
      const p = R.players.get(h.sid);
      h.hitT = Math.max(0, h.hitT - dt);
      if (h.label && (h.label.life -= dt) <= 0) h.label = null;
      if (h.icon && (h.icon.life -= dt) <= 0) h.icon = null;
      if (!p || !p.alive) {
        h.dead = !!p;
        continue;
      }
      if (h.dead) h.home();
      if (h.tpT > 0) {
        if ((h.tpT -= dt) <= 0) h.home(), this.fx.ring(h.x, h.y, 40, 6, 'rgba(190,227,255,0.9)', 0.5, 3);
        continue;
      }
      if (R.inBase(p)) {
        const [fx0, fy0] = FOUNTAIN[h.team];
        h.mode = 'base';
        h.x += (fx0 + DIR[h.team] * 22 - h.x) * k;
        h.y += (fy0 + slotOff(h.seed | 0) - h.y) * k;
        continue;
      }
      if (h.mode === 'base' || h.lane !== p.lane) Object.assign(h, { mode: 'lane', lane: p.lane, s: h.team === 'claude' ? 0 : 1 });
      const key = `${h.team}-${h.lane}`;
      const slot = (slots[key] = (slots[key] ?? -1) + 1);
      const step = (150 / GEO[h.lane].len) * dt;
      h.s += clamp(this.heroTarget(R, h, slot, rt) - h.s, -step, step);
      const [x, y] = lanePos(h.lane, h.s, slotOff(slot) + Math.sin(rt * 1.1 + h.seed) * 4);
      h.x += (x - h.x) * k;
      h.y += (y - h.y) * k;
    }
    for (const s of this.shots) if ((s.t += dt) >= s.dur) s.land();
    this.shots = this.shots.filter((s) => s.t < s.dur);
    for (const key of ['bolts', 'ults', 'wards']) this[key] = this[key].filter((b) => (b.life -= dt) > 0);
    for (const key of Object.keys(this.stHit)) if ((this.stHit[key] -= dt) <= 0) delete this.stHit[key];
    this.flash = Math.max(0, this.flash - dt);
    for (const r of this.flying) if ((r.t += dt) >= r.dur && r.to) this.fx.ring(r.to.x, r.to.y, 60, 8, GOLD, 0.5, 4);
    this.flying = this.flying.filter((r) => r.t < r.dur);
    if (this.respawnAt && rt >= this.respawnAt) {
      // 新的一局：所有人回泉水重新出门
      this.respawnAt = 0;
      for (const [sid] of this.heroes) if (!R.players.get(sid)?.onField) this.heroes.delete(sid);
      for (const p of R.field()) this.hero(R, p.sid).home();
      this.creeps = [];
      this.waveT = 0;
    }
  }

  /** 小兵纯属画面：每 6.5 秒每路出一波，走到交汇点互砍，被塔点死。 */
  updateCreeps(dt, R) {
    if ((this.waveT -= dt) <= 0) {
      this.waveT = 6.5;
      if (this.creeps.length < 160) for (const lane of LANES) for (const team of TEAMS) for (let i = 0; i < 3; i++) this.spawnCreep(lane, team, sOf(team, lane, 1) - DIR[team] * (0.01 + i * 0.01));
    }
    for (const c of this.creeps) {
      const [len, dir] = [GEO[c.lane].len, DIR[c.team]];
      const ef = frontS(R, OTHER[c.team], c.lane);
      const stop = dir > 0 ? Math.min(this.clash[c.lane] + 0.012, ef - 40 / len) : Math.max(this.clash[c.lane] - 0.012, ef + 40 / len);
      let [enemy, ed] = [null, 1e9];
      for (const e of this.creeps) {
        const d = (e.s - c.s) * dir * len;
        if (e.lane === c.lane && e.team !== c.team && e.hp > 0 && d > -8 && d < ed) [enemy, ed] = [e, d];
      }
      const engaged = enemy && ed < 22;
      if (!engaged && (dir > 0 ? c.s < stop : c.s > stop)) c.s += dir * (46 / len) * dt;
      else if ((c.cd -= dt) <= 0) {
        Object.assign(c, { cd: rand(0.8, 1.3), swing: 0.15 });
        if (engaged) enemy.hp -= 1;
      }
      c.swing = Math.max(0, c.swing - dt);
      [c.x, c.y] = lanePos(c.lane, c.s, c.off);
    }
    // 塔打小兵
    for (const t of TOWERS) {
      if (R.st[t.team][t.lane][t.tier] <= 0 || (this.towerCd[t.key] = (this.towerCd[t.key] || 0) - dt) > 0) continue;
      const [tx, ty] = t.pos;
      const c = this.creeps.find((c) => c.team !== t.team && c.lane === t.lane && c.hp > 0 && Math.hypot(c.x - tx, c.y - ty) < 150);
      if (!c) continue;
      this.towerCd[t.key] = 1.3;
      c.hp -= 2;
      this.beam(tx, ty - 40, c.x, c.y, t.team);
    }
    for (const c of this.creeps) if (c.hp <= 0) this.fx.sparks(c.x, c.y, COLOR[c.team], 3, 60);
    this.creeps = this.creeps.filter((c) => c.hp > 0);
  }

  // ---------------------------------------------------------------- 绘制

  render(g, R, scale) {
    const rt = this.app.rt();
    const fs = fontFor(scale);
    g.drawImage((mapLayers[`${L('zh', 'en')}:${TEAM_NAME.claude}:${TEAM_NAME.codex}`] ||= drawMapLayer()), 0, 0, W, H);
    // 肉山在睡觉
    const z = (rt * 0.5) % 1;
    g.globalAlpha = 1 - z;
    word(g, 'z', ROSH[0] + 18 + z * 10, ROSH[1] - 16 - z * 16, 11, 'rgba(255,255,255,0.75)', 700);
    g.globalAlpha = 1;
    for (const team of TEAMS) this.drawFountain(g, team, rt);
    for (const w of this.wards) this.drawWard(g, w, rt);
    for (const t of TOWERS) this.drawTower(g, t, R.st[t.team][t.lane][t.tier], rt);
    for (const team of TEAMS) this.drawAncient(g, team, R.st[team].ancient / R.ancientMax, rt);
    g.lineWidth = 1.5;
    for (const c of this.creeps) {
      g.strokeStyle = DEEP[c.team];
      dot(g, c.x + (c.swing > 0 ? DIR[c.team] * 3 : 0), c.y, 6, c.team === 'claude' ? '#f0a27e' : '#7cbcff');
      g.stroke();
    }
    for (const gr of R.ground) {
      const [x, y] = lanePos(gr.lane, this.clash[gr.lane], 24);
      glow(g, x, y, 22, '#ffd34d', 0.6 + 0.3 * Math.sin(rt * 5));
      this.drawSword(g, x, y, Math.PI / 4, 13);
    }
    const living = [];
    for (const h of this.heroes.values()) {
      const p = R.players.get(h.sid);
      if (p && p.alive && !h.dead) living.push([h, p]);
      else if (p) this.drawGrave(g, h, p, R, fs);
    }
    this.fx.renderUnder(g);
    for (const s of this.shots) {
      const k = s.t / s.dur;
      const [tx, ty] = s.target();
      const [x, y] = [s.x + (tx - s.x) * k, s.y + (ty - s.y) * k - Math.sin(k * Math.PI) * 18];
      dot(g, x, y, s.crit ? 7 : 4.5, s.crit ? '#ff6a3c' : COLOR[s.team]);
      dot(g, x, y, s.crit ? 3 : 2, 'rgba(255,255,255,0.85)');
    }
    for (const [h, p] of living) this.drawHero(g, h, p, R, rt);
    for (const u of this.ults) {
      g.globalAlpha = (u.life / u.max) * 0.45;
      dot(g, u.x, u.y, u.r * (0.4 + 0.6 * Math.min(1, (1 - u.life / u.max) * 3)), COLOR[u.team]);
      g.globalAlpha = 1;
    }
    for (const b of this.bolts) {
      g.globalAlpha = b.life / b.max;
      poly(g, b.pts, { stroke: 'rgba(120,180,255,0.35)', lw: 9 });
      poly(g, b.pts, { stroke: '#eef6ff', lw: 3 });
      g.globalAlpha = 1;
    }
    for (const r of this.flying) {
      const k = r.t / r.dur;
      const [tx, ty] = r.to ? [r.to.x, r.to.y] : [r.x, r.y + 20];
      this.drawSword(g, r.x + (tx - r.x) * k, r.y + (ty - r.y) * k - Math.sin(k * Math.PI) * 70, k * 12, 15);
    }
    this.fx.renderOver(g, scale);
    for (const t of TOWERS) {
      const hp = R.st[t.team][t.lane][t.tier];
      if (hp > 0 && hp < R.towerMax[t.tier]) hpBar(g, t.pos[0], t.pos[1] - 60, 40, hp / R.towerMax[t.tier], 5);
    }
    for (const team of TEAMS) {
      const [[x, y], frac] = [ANCIENT[team], R.st[team].ancient / R.ancientMax];
      if (frac <= 0) continue;
      hpBar(g, x, y - 82, 66, frac, 6);
      const pct = Math.ceil(frac * 100);
      pill(g, x, y - 96, L(`遗迹 ${pct}%`, `Ancient ${pct}%`), { color: COLOR[team], size: fs - 1 });
    }
    const idle = this.app.mode === 'live' ? 60e3 : 90e3;
    for (const [h, p] of living) this.drawTags(g, h, p, rt, fs, R.now - p.lastActive < idle);
    for (const h of this.heroes.values()) if (h.dead && h.label) this.drawLabel(g, h, h.y - 30, fs);
    if (this.flash > 0) {
      g.fillStyle = `rgba(200,225,255,${this.flash * 0.9})`;
      g.fillRect(0, 0, W, H);
    }
  }

  drawFountain(g, team, rt) {
    const [x, y] = FOUNTAIN[team];
    dot(g, x, y, 28, '#5d5a54');
    const grad = g.createRadialGradient(x, y, 2, x, y, 24);
    [[0, '#ffffff'], [0.4, COLOR[team]], [1, DEEP[team]]].forEach(([o, c]) => grad.addColorStop(o, c));
    dot(g, x, y, 21, grad);
    arcLine(g, x, y, 12 + ((rt * 10) % 10), 'rgba(255,255,255,0.5)', 2);
  }

  drawWard(g, w, rt) {
    g.globalAlpha = Math.min(1, w.life / 2);
    arcLine(g, w.x, w.y, 9 + Math.sin(rt * 3 + w.x) * 1.5, COLOR[w.team], 1.5);
    g.fillStyle = '#6b4a2a';
    g.fillRect(w.x - 1.5, w.y - 4, 3, 10);
    dot(g, w.x, w.y - 6, 4.5, '#ffe27a');
    dot(g, w.x, w.y - 6, 1.8, '#3a2a10');
    g.globalAlpha = 1;
  }

  drawTower(g, t, hp, rt) {
    const [x, y] = t.pos;
    oval(g, x + 4, y + 7, 18, 7, 'rgba(0,0,0,0.3)');
    // 塔倒了只剩碎石
    if (hp <= 0) return [[-7, 2, 6], [5, 4, 5], [0, -3, 5], [9, -2, 3]].forEach(([dx, dy, r]) => dot(g, x + dx, y + dy, r, '#6a645c'));
    g.fillStyle = '#58534b';
    g.beginPath();
    g.roundRect(x - 14, y - 6, 28, 12, 4);
    g.fill();
    const body = this.stHit[t.key] > 0 ? '#ffffff' : t.team === 'claude' ? '#d6ccb4' : '#6e6272';
    poly(g, [[x - 10, y], [x - 7, y - 34], [x + 7, y - 34], [x + 10, y]], { fill: body, stroke: DEEP[t.team], lw: 2 });
    glow(g, x, y - 40, 16, COLOR[t.team], 0.55 + 0.25 * Math.sin(rt * 3 + x));
    poly(g, [[x, y - 50], [x + 6, y - 40], [x, y - 33], [x - 6, y - 40]], { fill: COLOR[t.team] });
    if (t.tier === 1) poly(g, [[x - 5, y - 19], [x + 5, y - 19]], { stroke: 'rgba(255,255,255,0.6)', lw: 2 });
  }

  /** 遗迹水晶：被打时闪白，半血以下出裂痕，周围三块碎片绕着转。 */
  drawAncient(g, team, frac, rt) {
    const [x, y] = ANCIENT[team];
    glow(g, x, y - 20, 70, COLOR[team], frac > 0 ? 0.45 + 0.15 * Math.sin(rt * 2) : 0.12);
    oval(g, x, y + 12, 34, 13, '#4e4a44');
    if (frac <= 0) return [[-12, 4, 8], [10, 6, 7], [0, -4, 6], [16, -2, 4], [-18, -3, 4]].forEach(([dx, dy, r]) => dot(g, x + dx, y + dy, r, DEEP[team]));
    const body = g.createLinearGradient(x - 20, y - 60, x + 20, y + 10);
    [[0, '#ffffff'], [0.45, COLOR[team]], [1, DEEP[team]]].forEach(([o, c]) => body.addColorStop(o, c));
    const hit = LANES.some((l) => this.stHit[`${team}-${l}-2`] > 0);
    poly(g, [[x, y - 62], [x + 21, y - 22], [x + 12, y + 8], [x - 12, y + 8], [x - 21, y - 22]], { fill: hit ? '#ffffff' : body, stroke: DEEP[team], lw: 2.5 });
    poly(g, [[x, y - 62], [x - 4, y - 20], [x - 12, y + 8], [x - 4, y - 20], [x + 21, y - 22]], { stroke: 'rgba(255,255,255,0.45)', lw: 1.5 });
    if (frac < 0.5) poly(g, [[x + 6, y - 44], [x + 2, y - 30], [x + 9, y - 18], [x + 4, y - 4]], { stroke: 'rgba(30,20,20,0.7)', lw: 1.5 });
    for (let i = 0; i < 3; i++) {
      const a = rt * 1.2 + (i * TAU) / 3;
      const [sx, sy] = [x + Math.cos(a) * 32, y - 26 + Math.sin(a) * 10];
      poly(g, [[sx, sy - 6], [sx + 3.5, sy], [sx, sy + 6], [sx - 3.5, sy]], { fill: COLOR[team] });
    }
  }

  drawSword(g, x, y, ang, size) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    poly(g, [[0, -size], [0, size * 0.45]], { stroke: '#fff6c8', lw: 3 });
    poly(g, [[-size * 0.4, size * 0.45], [size * 0.4, size * 0.45]], { stroke: '#ffc533', lw: 3 });
    poly(g, [[0, size * 0.45], [0, size * 0.8]], { stroke: '#ffc533', lw: 3 });
    g.restore();
  }

  /** 倒下的英雄：墓碑 + 复活倒计时。 */
  drawGrave(g, h, p, R, fs) {
    g.globalAlpha = 0.75;
    poly(g, [[h.x - 8, h.y + 8], [h.x - 8, h.y - 6], [h.x - 4, h.y - 12], [h.x + 4, h.y - 12], [h.x + 8, h.y - 6], [h.x + 8, h.y + 8]], { fill: '#8d8a86', stroke: '#4b4946', lw: 2 });
    word(g, '✝', h.x, h.y - 2, 11, DEEP[h.team]);
    g.globalAlpha = 1;
    if (p.onField && !p.alive && p.respawnAt > R.now) pill(g, h.x, h.y - 22, `⏱ ${Math.ceil((p.respawnAt - R.now) / 1000)}s`, { color: COLOR[h.team], size: fs - 1 });
  }

  drawHero(g, h, p, R, rt) {
    const { x, y } = h;
    oval(g, x + 3, y + 7, 15, 10, 'rgba(0,0,0,0.3)');
    if (p.items.includes('radiance')) arcLine(g, x, y, 24 + Math.sin(rt * 4) * 2, `rgba(255,200,80,${0.35 + 0.2 * Math.sin(rt * 4)})`, 4);
    if (h.tpT > 0) for (let i = 0; i < 3; i++) arcLine(g, x, y, 20, 'rgba(190,227,255,0.9)', 3, rt * 8 + i * 2.1, rt * 8 + i * 2.1 + 1.2);
    dot(g, x, y, 15, h.hitT > 0 ? '#ff5a5a' : COLOR[h.team]);
    arcLine(g, x, y, 15, p.items.includes('bkb') ? '#e8c24a' : DEEP[h.team], 3);
    word(g, ([...(p.name || '?')][0] || '?').toUpperCase(), x, y + 1, 14, '#fff');
    if (p.rapier) this.drawSword(g, x + DIR[h.team] * 17, y - 2, DIR[h.team] * 0.5, 11);
    if (R.inBase(p)) dot(g, x, y, 19, 'rgba(111,211,139,0.35)');
    // 等你回复：头上转星星 + 倒计时圈
    const w = R.waits.get(h.sid);
    if (!w || w.boom) return;
    for (let i = 0; i < 3; i++) word(g, '★', x + Math.cos(rt * 4 + (i * TAU) / 3) * 14, y - 22 + Math.sin(rt * 4 + (i * TAU) / 3) * 4, 12, '#ffe27a', 400);
    const prog = clamp((R.now - w.t) / (w.deadline - w.t), 0, 1);
    arcLine(g, x, y, 22, 'rgba(210,150,255,0.95)', 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - prog));
  }

  drawLabel(g, h, y, fs) {
    g.globalAlpha = Math.min(1, h.label.life / 0.4) * (h.label.ghost ? 0.45 : 1);
    pill(g, h.x, y - fs - 8 - (1.7 - h.label.life) * 6, h.label.text, { size: fs - 1, max: 190, weight: 500, bg: h.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)' });
    g.globalAlpha = 1;
  }

  /** 名字牌、等级徽章、血条蓝条、装备、动作气泡。 */
  drawTags(g, h, p, rt, fs, active) {
    const y = h.y - 31;
    pill(g, h.x, y, p.name, { color: COLOR[h.team], size: fs, max: 120 });
    dot(g, h.x - 15, h.y - 13, 8, '#1b1d22');
    arcLine(g, h.x - 15, h.y - 13, 8, '#e8c24a', 1.5);
    word(g, String(p.level), h.x - 15, h.y - 12.5, Math.max(9, fs - 3), '#fff');
    hpBar(g, h.x, h.y + 19, 38, p.hp / hpMax(p), 4);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(h.x - 19, h.y + 24, 38, 2.5);
    g.fillStyle = '#5aa2ff';
    g.fillRect(h.x - 19, h.y + 24, 38 * (p.mana / 100), 2.5);
    if (p.items.length) word(g, p.items.map((n) => ITEM[n].icon).join(''), h.x, h.y + 35, Math.max(9, fs - 3), '#fff', 400);
    if (h.label) this.drawLabel(g, h, y, fs);
    if (!active) {
      const k = (rt * 0.6 + h.seed) % 1;
      g.globalAlpha = 1 - k;
      word(g, 'z', h.x + 16 + k * 8, h.y - 12 - k * 18, fs, 'rgba(255,255,255,0.8)', 700);
      g.globalAlpha = 1;
    }
    if (h.icon) word(g, h.icon.text, h.x, h.y - 58, fs + 10, '#fff', 400);
  }

  hud(R) {
    if (R.phase !== 'live') return null;
    const t = Math.max(0, R.now - R.roundStart);
    return { mid: `${Math.floor(t / 60000)}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}`, sub: `${R.kills.claude} : ${R.kills.codex}` };
  }
}
