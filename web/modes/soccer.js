// 足球 · 实况足球 / FIFA：俯视角足球赛。每个在场会话是一名外场球员，两边各有一个 NPC 门将。
// 跑命令传球推进，测试通过来一脚世界波，改代码铲球，任务完成打门；它在等你的时候，门将就在场上发呆。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, ACTIONS, WORLD, clamp, hash, rng, actText } from '../core.js';
import { L } from '../i18n.js';
import { Particles, rand, pill, emoji, fontFor, FONT } from '../fxkit.js';

export const meta = {
  id: 'soccer',
  icon: '⚽',
  get name() { return L('足球 · 实况足球', 'Football (FIFA)'); },
  get desc() { return L('俯视角足球赛。跑命令传球推进，测试通过来一脚世界波，改代码铲球，等你回复时门将在发呆', 'Top-down football. Commands pass and dribble, passing tests are worldies, edits are slide tackles, and the keeper waits on you'); },
  get roundWord() { return L('场', 'match'); },
  get wait() {
    return {
      start: L('🧤 {a} 的门将在等你', '🧤 {a}’s keeper is waiting on you'),
      sub: L('40 秒内回它门将就归位，超时门将脱手丢球', 'Reply within 40s, or the keeper fumbles one in'),
      done: L('🧤 门将归位', '🧤 Keeper back on his line'),
      boom: L('🧈 {a} 的门将等太久，黄油手丢球了', '🧈 Butterfingers! {a}’s keeper waited too long'),
    };
  },
  get legend() {
    return [
      [L('🏃 跑命令', '🏃 Run a command'), L('有球：传球 / 带球推进；无球：逼抢', 'On the ball: pass & dribble; off it: press')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('远射世界波，大概率破门', 'Long-range worldie, usually a goal')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('观察全场：下一脚传球断不掉', 'Scan the pitch: next pass can’t be cut out')],
      [L('🧱 改代码', '🧱 Edit code'), L('有球过人；无球滑铲抢断', 'Skill move on the ball; slide tackle off it')],
      [L('🔭 上网查资料', '🔭 Web search'), L('长传冲吊，一脚越过两个区域', 'Long ball over the top, skips two zones')],
      [L('✅ 任务完成', '✅ Task done'), L('射门：越靠近球门越容易进', 'Shoot: the closer, the likelier')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('撞墙配合 / 换人上生力军', 'One-two / fresh legs off the bench')],
      [L('🐛 报错', '🐛 Error'), L('传球失误、越位、犯规；禁区里送点甚至乌龙', 'Misplaced pass, offside, foul — even an own goal')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('抽筋倒地，丢掉球权', 'Cramp — possession lost')],
      [L('✋ 被打断', '✋ Interrupted'), L('红牌！本场罚下', 'Red card! Off for the match')],
      [L('💬 收到新指令', '💬 New prompt'), L('教练喊话：接下来 3 个动作更猛', 'Coach yells: next 3 actions hit harder')],
      [L('🧤 它在等你', '🧤 Waiting on you'), L('门将在发呆，40 秒不回就黄油手', 'Keeper zones out; 40s and he fumbles')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('倒挂金钩，直接进球', 'Bicycle kick — straight in')],
      [L('⚽ 一场比赛', '⚽ A match'), L('先进 3 球赢；时间到平局就点球大战', 'First to 3; level at full time → penalties')],
    ];
  },
};

// ================================================================ 规则
// 球的位置只记「在哪个区域」：0 本方禁区 · 1 后场 · 2 中场 · 3 前场 · 4 对方禁区（按控球方的进攻方向算）。
// 控球方的动作攒「推进」，满 1 前进一个区域，在对方禁区里满 1 就打门；防守方的动作攒「逼抢」，满 1 就把球抢回来。

const BOX = 4;
const PUSH = { shell: 0.7, read: 0.6, edit: 0.8, web: 0.7, misc: 0.6, agent: 1, done: 1 };
const PRESS = { shell: 0.22, read: 0.2, edit: 0.6, web: 0.35, misc: 0.2, agent: 0.8, done: 0.4 };
const CONV = { box: 0.5, worldie: 0.7, header: 0.38, pen: 0.78 };
const FAR = [0, 0, 0.15, 0.3, 0.5]; // 任务完成直接打门：离球门越近越容易进
const count = (xs) => xs.filter(Boolean).length;

export class Rules extends Base {
  static defaults = { matchLen: 6 * 60e3, partyLen: 4 * 60e3, goalsToWin: 3 };

  init() {
    const o = this.opts;
    this.matchLen = o.party ? o.partyLen : o.matchLen;
    this.target = o.party ? 1 : o.goalsToWin;
    this.pace = o.party ? 0.6 : 1; // 大乱斗只要一个球：节奏放慢一点，不然几个动作就结束
    this.setup();
  }

  setup() {
    for (const k of ['goals', 'possN', 'boost']) this[k] = { claude: 0, codex: 0 };
    this.alert = { claude: false, codex: false };
    this.shootout = null;
    this.acts = 0;
    this.kickoff('claude');
  }

  initPlayer(p) { Object.assign(p, { rg: 0, yc: 0, red: -1, tk: 0 }); }
  onEnter(p) { if (p.red === this.round) p.alive = false; } // 被红牌罚下的人这场回不来，挂机再回来也一样
  onPause() { this.setup(); }
  ghostOk() { return false; } // 罚下场的人什么都做不了
  say(fx, text, sub, cls, ms) { fx.push({ type: 'announce', text, sub, cls, ms }); }
  keeperAway(team) { return this.field(team).some((q) => this.waiting(q)); }

  onLeave(p) { for (const k of ['carrier', 'passer']) if (this[k] === p.sid) this[k] = null; }

  onRoundStart(fx) {
    this.setup();
    for (const p of this.players.values()) Object.assign(p, { alive: true, rg: 0, yc: 0 });
    // 掷硬币决定谁开球（只看回合号和时间，回放永远一样）
    this.kickoff(rng(hash(`kickoff:${this.round}:${this.roundStart}`))() < 0.5 ? 'claude' : 'codex', fx);
    if (this.party) this.say(fx, L('金球制胜', 'Golden goal'), L('加时赛 · 先进球的赢', 'Extra time · next goal wins'), 'gold', 1300);
    else this.say(fx, L('开球！', 'Kick-off!'), L(`先进 ${this.target} 球获胜`, `First to ${this.target} wins`), 'gold', 1100);
  }

  /** 球现在在哪个区域（按 Claude 一方往右攻的绝对坐标，画面用）。 */
  abs() { return this.poss === 'claude' ? this.zone : BOX - this.zone; }

  /** 比赛分钟：一场按 90 分钟折算；大乱斗是金球制胜的加时赛，从 90' 走到 120'。 */
  minute() {
    const k = clamp((this.now - this.roundStart) / this.matchLen, 0, 1);
    return this.party ? 90 + Math.round(k * 30) : Math.max(1, Math.round(k * 90));
  }

  /** 这一下有多猛：均衡火力 × 人少更痛，再按两边人数拉平（人多不等于脚下活多）。教练喊过话再加成。 */
  power(team) {
    const nT = Math.max(1, this.field(team).length);
    const nO = Math.max(1, this.field(OTHER[team]).length);
    let w = this.balanceMult(team) * this.sizeMult() * Math.sqrt(nT / nO) * this.pace;
    if (this.boost[team] > 0) [this.boost[team], w] = [this.boost[team] - 1, w * 1.5];
    return clamp(w, 0.1, 6);
  }

  pick(team, r) {
    const xs = this.alive(team);
    const pool = xs.length ? xs : this.field(team);
    return pool.length ? pool[Math.floor(r() * pool.length)] : null;
  }

  // ---------------------------------------------------------------- 球权

  kickoff(team, fx = null) {
    Object.assign(this, { poss: team, zone: 2, carrier: null, passer: null, drive: 0, press: 0, passes: 0 });
    this.scan = { claude: false, codex: false };
    if (fx) fx.push({ type: 'kickoff', team });
  }

  turnover(team, zone, sid, how, fx, culprit = null) {
    Object.assign(this, { poss: team, zone, carrier: sid, passer: null, drive: 0, press: 0, passes: 0 });
    fx.push({ type: 'turn', team, sid, how, zone: this.abs(), culprit });
  }

  moved(p, from, how, fx) { fx.push({ type: 'move', team: p.team, from, to: p.sid, zone: this.abs(), how }); }

  // ---------------------------------------------------------------- 动作

  onEvent(p, ev, r, fx) {
    if (this.phase !== 'live') return; // 热身时只是颠球
    if (ev.k === 'abort') return this.sendOff(p, 'abort', fx);
    if (this.shootout) return this.kick(p, ev, r, fx);
    const T = p.team;
    if (ev.k === 'prompt') {
      this.boost[T] = 3;
      return void fx.push({ type: 'shout', sid: p.sid, team: T });
    }
    if (ev.k === 'pr') return this.bicycle(p, fx);
    if (ev.k === 'compact' || ev.k === 'apierr') return this.cramp(p, ev.k, fx);
    if (!ACTIONS.has(ev.k) && ev.k !== 'done') return;
    const w = this.power(T);
    this.possN[this.poss]++;
    this.acts++;
    if (ev.ok === false) return this.blunder(p, r, w, fx);
    if (this.poss === T) this.attack(p, ev, r, w, fx);
    else this.defend(p, ev, r, w, fx);
  }

  /** 有球：球先传到这个人脚下，再按动作推进 / 打门。大招按火力折算触发概率，人多的队不能靠刷动作取胜。 */
  attack(p, ev, r, w, fx) {
    const T = p.team;
    const big = r() < Math.min(1, w);
    const from = this.carrier;
    if (from !== p.sid) {
      if (from && this.players.get(from)?.team === T) {
        this.passer = from;
        if (++this.passes === 6) {
          fx.push({ type: 'tiki', team: T, sid: p.sid });
          fx.push({ type: 'note', text: L(`🔁 ${TEAM_NAME[T]} 连续 6 脚传递 · Tiki-taka！{0} 接球`, `🔁 ${TEAM_NAME[T]}: 6 passes in a row · Tiki-taka! {0} on the ball`), sids: [p.sid] });
        }
      }
      this.carrier = p.sid;
    }
    switch (ev.k) {
      case 'shell':
        if (ev.hs && big) return this.shoot(p, 'worldie', r, fx);
        return this.push(p, (ev.hs ? 1.5 : PUSH.shell) * w, r, fx, from, 'pass');
      case 'done':
        if (big && this.zone >= 2) return this.shoot(p, 'far', r, fx); // 过了中场才起脚
        break;
      case 'read':
        this.scan[T] = true;
        return this.push(p, PUSH.read * w, r, fx, from, 'scan');
      case 'edit':
        return this.push(p, PUSH.edit * w, r, fx, from, 'skill');
      case 'web':
        if (big && this.zone >= 3) return this.shoot(p, 'header', r, fx); // 已经在前场：传中，头球攻门
        if (big) {
          this.zone = Math.min(BOX, this.zone + 2);
          return this.moved(p, from, 'long', fx);
        }
        break;
      case 'agent':
        if (big) {
          // 撞墙配合：和队友一传一递，助攻算队友的
          const mates = this.alive(T).filter((q) => q !== p);
          if (mates.length) this.passer = mates[Math.floor(r() * mates.length)].sid;
          this.zone = Math.min(BOX, this.zone + 2);
          return this.moved(p, from, 'onetwo', fx);
        }
        break;
    }
    this.push(p, (PUSH[ev.k] ?? PUSH.misc) * w, r, fx, from, 'pass');
  }

  push(p, amount, r, fx, from, how) {
    this.drive += amount;
    while (this.drive >= 1) {
      this.drive -= 1;
      if (this.zone < BOX) this.zone++;
      else {
        this.drive = 0;
        return this.shoot(p, 'box', r, fx);
      }
    }
    this.moved(p, from, how, fx);
  }

  /** 无球：逼抢攒满就断下来；改代码是滑铲（不管对面看没看清都能铲下来）。 */
  defend(p, ev, r, w, fx) {
    const O = this.poss;
    const big = r() < Math.min(1, w);
    if (ev.k === 'shell' && ev.hs && big) return this.win(p, 'clean', fx);
    if (ev.k === 'done' && big) {
      this.win(p, 'counter', fx);
      return this.push(p, PUSH.done * w, r, fx, p.sid, 'counter');
    }
    // 禁区里滑铲，偶尔 VAR 判点球
    if (ev.k === 'edit' && this.zone === BOX && r() < 0.06 * Math.min(1, w)) return this.penalty(O, p, r, fx);
    const how = { edit: 'tackle', agent: 'sub', web: 'header' }[ev.k] || 'press';
    this.press += PRESS[ev.k] * w * (ev.k === 'agent' && !big ? 0.5 : 1);
    if (this.press < 1) return void fx.push({ type: 'press', sid: p.sid, on: this.carrier, how });
    if (this.scan[O] && how !== 'tackle') {
      // 对面早就看清了传球线路：一脚出球，断不掉
      this.scan[O] = false;
      this.press = 0.5;
      return void fx.push({ type: 'dodge', sid: this.carrier, by: p.sid });
    }
    this.win(p, how, fx);
  }

  win(p, how, fx) {
    [p.tk, p.dmg] = [p.tk + 1, p.dmg + 30];
    this.turnover(p.team, BOX - this.zone, p.sid, how, fx);
  }

  /** 报错：有球是传球失误 / 越位，无球是犯规；在自家禁区里犯错就是点球，运气差直接乌龙。 */
  blunder(p, r, w, fx) {
    const O = OTHER[p.team];
    if (r() > Math.min(1, 0.3 + w)) return void fx.push({ type: 'fumble', sid: p.sid });
    if (this.poss === p.team) {
      const offside = this.zone >= 3 && r() < 0.45;
      if (offside) this.say(fx, L('越位！', 'Offside!'), L(`${p.name} 越位了 · 边裁举旗`, `${p.name} is offside · flag up`), 'bad', 1000);
      return this.turnover(O, BOX - this.zone, null, offside ? 'offside' : 'misplaced', fx, p.sid);
    }
    if (this.zone === BOX) {
      const x = r();
      if (x < 0.15) return this.ownGoal(p, fx);
      if (x < 0.5) return this.penalty(O, p, r, fx);
      this.drive += 0.5;
      return void fx.push({ type: 'corner', team: O, sid: p.sid });
    }
    this.drive += 0.5; // 任意球
    fx.push({ type: 'foul', sid: p.sid });
    if (r() < 0.3) this.card(p, fx);
  }

  card(p, fx) {
    if (++p.yc >= 2) return this.sendOff(p, 'second', fx);
    fx.push({ type: 'card', sid: p.sid, color: 'yellow' });
    fx.push({ type: 'note', text: L('🟨 {0} 吃到黄牌', '🟨 Yellow card for {0}'), sids: [p.sid] });
  }

  /** 红牌：被你打断 = 你把他罚下场了；两黄变一红也一样。本场不能再上。 */
  sendOff(p, why, fx) {
    if (!p.alive || this.phase !== 'live') return;
    Object.assign(p, { alive: false, red: this.round, d: p.d + 1 });
    const human = why === 'abort';
    fx.push({ type: 'card', sid: p.sid, color: 'red' });
    fx.push({ type: 'kill', killer: null, victim: p.sid, weapon: human ? L('🟥 红牌', '🟥 Red card') : L('🟨🟨 两黄变一红', '🟨🟨 Second yellow'), cause: human ? 'human' : 'card' });
    this.say(fx, L('红牌！', 'Red card!'), human ? L(`你把 ${p.name} 罚下场了`, `You sent ${p.name} off`) : L(`${p.name} 两黄变一红`, `${p.name}: second yellow`), 'bad', 1500);
    if (this.carrier === p.sid) this.carrier = null;
    if (this.shootout) return;
    if (this.poss === p.team) this.turnover(OTHER[p.team], BOX - this.zone, null, 'red', fx, p.sid);
    else this.drive += 0.5;
  }

  cramp(p, kind, fx) {
    fx.push({ type: 'cramp', sid: p.sid, kind });
    if (this.poss === p.team) this.turnover(OTHER[p.team], BOX - this.zone, null, 'cramp', fx, p.sid);
    else this.drive += 0.4;
  }

  penalty(T, fouler, r, fx) {
    const shooter = (this.poss === T && this.players.get(this.carrier)) || this.pick(T, r);
    Object.assign(this, { poss: T, zone: BOX, carrier: shooter?.sid ?? null, passer: null });
    fx.push({ type: 'penalty', team: T, sid: shooter?.sid ?? null, by: fouler?.sid ?? null });
    this.say(fx, L('点球！', 'Penalty!'), L('VAR 确认 · 禁区内犯规', 'VAR confirms · foul in the box'), 'bad', 1300);
    this.shoot(shooter, 'pen', r, fx, T);
  }

  // ---------------------------------------------------------------- 射门与进球

  shoot(p, kind, r, fx, T = p.team) {
    const G = OTHER[T];
    let conv = kind === 'far' ? FAR[this.zone] : CONV[kind];
    if (this.keeperAway(G)) conv = 1 - (1 - conv) * 0.45; // 门将在等你，球门大开
    else if (this.alert[G]) [this.alert[G], conv] = [false, conv * 0.6]; // 刚被你及时回复过，门将正兴奋
    if (p) p.dmg += 10;
    const x = r();
    const res = x < conv ? 'goal' : x < conv + (1 - conv) * 0.5 ? 'save' : x < conv + (1 - conv) * 0.62 ? 'post' : 'wide';
    fx.push({ type: 'shot', team: T, sid: p?.sid ?? null, kind, res });
    if (res === 'goal') return this.goal(T, p, kind, fx);
    if (res === 'save' && kind !== 'far') this.say(fx, L('精彩扑救！', 'What a save!'), L(`${TEAM_NAME[G]} 门将飞身扑出`, `${TEAM_NAME[G]} keeper at full stretch`), 'gold', 1000);
    this.turnover(G, 1, null, res, fx); // 门球 / 门将开出来
  }

  bicycle(p, fx) {
    this.say(fx, L('倒挂金钩！', 'Bicycle kick!'), L(`${p.name} 提交了 PR · 世界级进球`, `${p.name} opened a PR · golazo`), 'gold', 1600);
    fx.push({ type: 'shot', team: p.team, sid: p.sid, kind: 'bicycle', res: 'goal' });
    if (this.poss !== p.team) this.passer = null;
    this.goal(p.team, p, 'bicycle', fx);
  }

  ownGoal(p, fx) {
    this.say(fx, L('乌龙球！', 'Own goal!'), L(`${p.name} 把球送进了自家球门`, `${p.name} turns it into their own net`), 'bad', 1500);
    this.goal(OTHER[p.team], null, 'own', fx, p);
  }

  goal(T, p, kind, fx, own = null) {
    this.goals[T]++;
    const min = this.minute();
    let assist = null;
    if (p) {
      [p.k, p.rg] = [p.k + 1, p.rg + 1];
      if (kind === 'worldie' || kind === 'bicycle') p.hs++;
      const a = this.passer ? this.players.get(this.passer) : null;
      if (a && a !== p && a.team === T && kind !== 'pen' && kind !== 'butter') [a.a, assist] = [a.a + 1, a.sid];
    }
    if (own) own.d++;
    fx.push({ type: 'goal', team: T, sid: p?.sid ?? null, own: own?.sid ?? null, assist, kind, score: { ...this.goals }, min });
    const flavor = {
      worldie: L('世界波！', 'What a worldie!'), header: L('头球破门', 'Header!'), pen: L('点球命中', 'Penalty scored'),
      bicycle: L('倒挂金钩', 'Bicycle kick'), butter: L('门将黄油手', 'Butterfingers'), own: L('乌龙球', 'Own goal'),
    }[kind];
    const who = p ? p.name : own ? own.name : TEAM_NAME[T];
    this.say(fx, L('球进了！GOOOOAL!', 'GOOOOAL!'), `${flavor ? `${flavor} · ` : ''}${who} ${min}' · ${this.goals.claude}–${this.goals.codex}`, T, 1700);
    if (own) fx.push({ type: 'note', text: L(`⚽ {0} 乌龙球 ${min}'`, `⚽ Own goal by {0} ${min}'`), sids: [own.sid], cls: 'big' });
    else if (p && assist) fx.push({ type: 'note', text: L(`⚽ {0} 破门（{1} 助攻）${min}'`, `⚽ {0} scores, assist {1} ${min}'`), sids: [p.sid, assist], cls: 'big' });
    else if (p) fx.push({ type: 'note', text: L(`⚽ {0} 破门 ${min}'`, `⚽ {0} scores ${min}'`), sids: [p.sid], cls: 'big' });
    if (p && p.rg === 3) this.say(fx, L('帽子戏法！', 'Hat-trick!'), L(`${p.name} 本场第 3 球`, `${p.name} bags a third`), 'gold', 1800);
    if (this.goals[T] >= this.target) return this.finish(T, this.party ? 'golden' : 'goals', fx);
    this.kickoff(OTHER[T], fx);
  }

  finish(winner, reason, fx) {
    const { claude: a, codex: b } = this.goals;
    const min = this.minute();
    const so = this.shootout;
    const pens = so && { claude: count(so.kicks.claude), codex: count(so.kicks.codex) };
    let text;
    if (reason === 'golden') text = L(`金球制胜 · ${min}'`, `Golden goal · ${min}'`);
    else if (reason === 'goals') text = L(`${a}–${b} · 先进 ${this.target} 球`, `${a}–${b} · first to ${this.target}`);
    else if (reason === 'time') text = L(`全场结束 ${a}–${b}`, `Full time ${a}–${b}`);
    else text = L(`点球大战 ${pens.claude}–${pens.codex}`, `Penalties ${pens.claude}–${pens.codex}`);
    fx.push({ type: 'ft', goals: { ...this.goals }, pens, winner });
    this.endRound(winner, reason, fx, text);
  }

  // ---------------------------------------------------------------- 点球大战：接下来每个动作罚一个点球

  startShootout(fx) {
    const first = rng(hash(`pens:${this.round}:${this.now}`))() < 0.5 ? 'claude' : 'codex';
    const n = this.party ? 1 : 3;
    this.shootout = { turn: first, n, kicks: { claude: [], codex: [] } };
    fx.push({ type: 'shootout', first });
    const { claude: a, codex: b } = this.goals;
    this.say(fx, L('点球大战！', 'Penalty shootout!'), L(`${a}–${b} 战平 · 各罚 ${n} 轮`, `Level at ${a}–${b} · ${n} kick${n > 1 ? 's' : ''} each`), 'gold', 1800);
  }

  /** 轮到罚球的队自己出手：测试通过稳进，报错踢飞（巴乔附体）；对面出手就是门将扑救：测试通过扑出，报错扑反方向。 */
  kick(p, ev, r, fx) {
    if (!ACTIONS.has(ev.k) && ev.k !== 'done') return;
    const so = this.shootout;
    const K = so.turn;
    const mine = p.team === K;
    const shooter = mine ? p : this.pick(K, r);
    const sharp = ev.hs || ev.k === 'done';
    const conv = mine ? (sharp ? 0.95 : ev.ok === false ? 0.15 : 0.75) : sharp ? 0.35 : ev.ok === false ? 0.95 : 0.75;
    const scored = r() < conv;
    so.kicks[K].push(scored);
    so.turn = OTHER[K];
    fx.push({ type: 'pk', team: K, sid: shooter?.sid ?? null, scored, skied: !scored && mine && ev.ok === false });
    const win = this.shootWinner();
    if (win) this.finish(win, 'pens', fx);
  }

  shootWinner() {
    const { kicks, n } = this.shootout;
    const [a, b] = [kicks.claude, kicks.codex];
    const [sa, sb] = [count(a), count(b)];
    if (a.length <= n && b.length <= n) {
      // 常规轮：已经追不上就提前结束
      if (sa > sb + n - b.length) return 'claude';
      if (sb > sa + n - a.length) return 'codex';
      if (a.length < n || b.length < n) return null;
    }
    // 突然死亡：罚的次数一样、比分不同
    return a.length === b.length && sa !== sb ? (sa > sb ? 'claude' : 'codex') : null;
  }

  // ---------------------------------------------------------------- 门将在等你

  onWait(p, fx) { if (this.phase === 'live') fx.push({ type: 'gkwait', team: p.team }); }

  // 及时回复：门将归位，下一脚射门他扑得更凶
  onAnswer(p, wait, fx) {
    if (this.phase !== 'live') return;
    this.alert[p.team] = true;
    fx.push({ type: 'gkback', team: p.team });
  }

  /** 等太久：门将脱手，送对面一球（门将黄油手）。 */
  onWaitTimeout(p, fx) {
    if (this.phase !== 'live' || this.shootout) return;
    const O = OTHER[p.team];
    const r = rng(hash(`butter:${this.round}:${this.now}:${p.sid}`));
    const scorer = (this.poss === O && this.players.get(this.carrier)) || this.pick(O, r);
    this.passer = null;
    this.say(fx, L('门将黄油手！', 'Butterfingers!'), L(`${TEAM_NAME[p.team]} 门将等你等到脱手`, `${TEAM_NAME[p.team]} keeper got bored waiting`), 'bad', 1500);
    fx.push({ type: 'shot', team: O, sid: scorer?.sid ?? null, kind: 'butter', res: 'goal' });
    this.goal(O, scorer, 'butter', fx);
  }

  // ---------------------------------------------------------------- 时间

  timers() { return this.shootout ? [] : [this.roundStart + this.matchLen]; }

  // 全场结束：领先的赢，打平就点球大战
  onTick(fx) {
    if (this.shootout || this.now < this.roundStart + this.matchLen) return;
    const lead = this.leader();
    if (lead) return this.finish(lead, 'time', fx);
    this.startShootout(fx);
  }

  // 大乱斗里拖太久（按动作数）也直接点球
  check(fx) { if (this.party && !this.shootout && this.acts >= 45) this.startShootout(fx); }
  leader() { return this.goals.claude === this.goals.codex ? null : this.goals.claude > this.goals.codex ? 'claude' : 'codex'; }
}

// ================================================================ 球场
// 左边 Claude 守，右边 Codex 守（内战时是 A / B 两边）。上下是看台和 LED 广告牌。

const { w: W, h: H } = WORLD;
const [PX, PY, PW, PH] = [100, 130, 1400, 720];
const MY = PY + PH / 2;
const GH = 60; // 球门半宽
const ZX = [215, 520, 800, 1080, 1385]; // 五个区域的中心（绝对坐标）
const DIR = { claude: 1, codex: -1 }; // Claude 往右攻
const KEEPER = { claude: '#d8f23a', codex: '#ff6fb5' };
const NUMS = [10, 7, 9, 11, 8, 6, 4, 5];
const goalX = (team) => (team === 'claude' ? PX : PX + PW); // 这个队守的球门
const ease = (k) => 1 - (1 - k) * (1 - k);
const pickOne = (xs) => xs[Math.floor(Math.random() * xs.length)];
const abbr = (team) => {
  const n = TEAM_NAME[team];
  return (n.includes(' ') ? n.slice(0, 2) + n.split(' ').pop()[0] : n.slice(0, 3)).toUpperCase();
};

// 几个画图小工具：实心圆 / 椭圆影子 / 文字 / 折线
function disc(g, x, y, r, fill, stroke = null, lw = 2) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function oval(g, x, y, rx, ry, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}
function txt(g, s, x, y, font, color, align = 'center') {
  Object.assign(g, { font: `${font} ${FONT}`, fillStyle: color, textAlign: align, textBaseline: 'middle' });
  g.fillText(s, x, y);
}
function path(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
}
function line(g, pts, color, lw) {
  path(g, pts);
  Object.assign(g, { strokeStyle: color, lineWidth: lw });
  g.stroke();
}
function layer(w, h, draw) {
  const c = document.createElement('canvas');
  [c.width, c.height] = [w * 2, h * 2];
  const g = c.getContext('2d');
  g.scale(2, 2);
  draw(g);
  return c;
}
/** 俯视角的一个人：影子 + 圆身子 + 号码。[sx, sy] 用来演倒地、飞扑；extra 在同一个坐标系里补画手套之类。 */
function man(g, x, y, [sx, sy], fill, edge, num, numColor, extra = null) {
  oval(g, x + 3, y + 9, 15 * sx, 7 * sy, 'rgba(0,0,0,0.28)');
  g.save();
  g.translate(x, y);
  g.scale(sx, sy);
  disc(g, 0, 0, 15, fill, edge, 3);
  txt(g, String(num), 0, 1, '900 14px', numColor);
  extra?.();
  g.restore();
}

const drawPitch = () => layer(W, H, (g) => {
  // 看台台阶、草皮割草条纹、一点噪点
  g.fillStyle = '#1b1f27';
  g.fillRect(0, 0, W, H);
  for (let y = 4; y < H; y += 12) if (y < 94 || y > 900) { g.fillStyle = y % 24 ? '#232833' : '#1e232c'; g.fillRect(0, y, W, 10); }
  g.fillStyle = '#3b8a37';
  g.fillRect(0, 122, W, 760);
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#418f3b' : '#4b9c44'; g.fillRect(PX + (PW / 16) * i, PY - 8, PW / 16, PH + 16); }
  const r = rng(5);
  for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(20,60,15,0.08)' : 'rgba(200,255,170,0.06)'; g.fillRect(r() * W, 122 + r() * 760, 1.5, 2.5); }
  // 白线：边线、中线、中圈、禁区、小禁区、点球点、弧顶、角球弧
  const white = 'rgba(255,255,255,0.88)';
  Object.assign(g, { strokeStyle: white, lineWidth: 3 });
  g.strokeRect(PX, PY, PW, PH);
  line(g, [[800, PY], [800, PY + PH]], white, 3);
  disc(g, 800, MY, 95, null, white, 3);
  disc(g, 800, MY, 4, white);
  const a = Math.acos(75 / 95);
  for (const side of [1, -1]) {
    const x0 = side > 0 ? PX : PX + PW;
    g.strokeStyle = white;
    g.strokeRect(side > 0 ? x0 : x0 - 225, MY - 215, 225, 430);
    g.strokeRect(side > 0 ? x0 : x0 - 75, MY - 95, 75, 190);
    disc(g, x0 + side * 150, MY, 3.5, white);
    g.beginPath();
    g.arc(x0 + side * 150, MY, 95, side > 0 ? -a : Math.PI - a, side > 0 ? a : Math.PI + a);
    g.stroke();
    for (const cy of [PY, PY + PH]) {
      const a0 = side > 0 ? (cy === PY ? 0 : -Math.PI / 2) : cy === PY ? Math.PI / 2 : Math.PI;
      g.beginPath();
      g.arc(x0, cy, 14, a0, a0 + Math.PI / 2);
      g.stroke();
      path(g, [[x0, cy], [x0, cy - 22], [x0 + side * 14, cy - 16]]); // 角旗
      g.fillStyle = side > 0 ? COLOR.claude : COLOR.codex;
      g.fill();
    }
    // 技术区域
    g.setLineDash([8, 6]);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.strokeRect(800 - side * 170 - 60, 856, 120, 26);
    g.setLineDash([]);
  }
});

// 观众：一张图，画的时候切成竖条，每条单独上下跳（进球时那半边跳得最欢，平时偶尔来一次人浪）
const drawCrowd = (y0, h, seed) => ({
  y0,
  c: layer(W, h + 8, (g) => {
    const r = rng(seed);
    const skin = ['#e8d5c0', '#c99a78', '#8a5a3c', '#f2e0cc', '#5b3b28'];
    for (let y = 6; y < h; y += 10) {
      for (let x = 4; x < W; x += 9 + r() * 3) {
        const home = x < 800 ? 'claude' : 'codex';
        g.fillStyle = r() < 0.62 ? COLOR[home] : r() < 0.5 ? DEEP[home] : ['#ddd', '#555', '#f5c451'][Math.floor(r() * 3)];
        g.fillRect(x - 3, y + 3, 7, 5);
        disc(g, x, y + 1, 2.8, skin[Math.floor(r() * skin.length)]);
      }
    }
  }),
});

let layers = null;
const buildLayers = () => ({ pitch: drawPitch(), top: drawCrowd(0, 92, 21), bottom: drawCrowd(910, 50, 22) });

// ================================================================ 画面

class Bot {
  constructor(sid, team) {
    Object.assign(this, { sid, team, label: null, icon: null, down: 0, slide: 0, dash: 0, kickT: 0, lane: rand(-30, 30) });
    [this.x, this.y] = [goalX(team) + DIR[team] * rand(250, 520), rand(PY + 80, PY + PH - 80)];
    [this.tx, this.ty] = [this.x, this.y];
  }
}

export class View {
  constructor(app) {
    this.app = app;
    layers ||= buildLayers();
    this.fx = new Particles();
    this.bots = new Map();
    this.reset({ field: () => [] });
  }

  reset(R) {
    this.fx.clear();
    this.bots.clear();
    this.keepers = {};
    for (const team of TEAMS) this.keepers[team] = { team, x: goalX(team) + DIR[team] * 24, y: MY, dive: null, down: 0, say: null };
    this.ref = { x: 760, y: MY - 120, card: null };
    this.coach = { claude: null, codex: null };
    this.ripple = { claude: 0, codex: 0 }; // 哪边的球网在抖（按守门的一方）
    this.cheer = { claude: 0, codex: 0 }; // 哪边看台在跳
    Object.assign(this, { flight: null, queue: [], ft: null });
    const live = R.goals && R.phase === 'live' && !R.shootout;
    this.spot = live ? { x: ZX[R.abs()], y: MY + rand(-110, 110) } : { x: 800, y: MY };
    this.ball = { x: this.spot.x, y: this.spot.y, h: 0 };
    for (const p of R.field()) this.bot(R, p.sid);
    this.formation(R);
    for (const b of this.bots.values()) [b.x, b.y] = [b.tx, b.ty];
  }

  bot(R, sid) {
    let b = this.bots.get(sid);
    const p = R.players.get(sid);
    if (!b && p && p.onField) this.bots.set(sid, (b = new Bot(sid, p.team)));
    return b;
  }

  /** 球飞出去：普通传球贴地，长传和射门有弧线。射门（big）要演完——进网、扑救——才轮到下一脚。 */
  launch(f, busy) {
    const k = busy ? 0.45 : 1;
    [f.dur, f.hold] = [f.dur * k, (f.hold || 0) * k];
    if (!this.flight?.big) this.start(f);
    else if (this.queue.length < 3) this.queue.push(f);
  }

  start(f) {
    Object.assign(f, { x0: this.ball.x, y0: this.ball.y, t: 0, landed: false });
    this.flight = f;
    f.onStart?.();
    const { sfx } = this.app;
    if (f.kick && sfx.ok(f.big ? 2 : 1)) sfx.tone(f.big ? 120 : 160, f.big ? 0.12 : 0.06, f.big ? 0.22 : 0.12, 'sine', 60);
  }

  whistle(times = 1) {
    const { sfx } = this.app;
    if (sfx.ok(2)) for (let i = 0; i < times; i++) sfx.tone(2900, i === times - 1 ? 0.4 : 0.14, 0.045, 'square', 2700, i * 0.2);
  }

  float(sid, text, color = '#fff', size = 14, life = 1.3) {
    const b = this.bots.get(sid);
    if (b) this.fx.text(b.x, b.y - 26, text, color, size, life);
  }

  apply(list, R, busy) {
    const { fx } = this;
    for (const f of list) {
      const b = f.sid ? this.bot(R, f.sid) : null;
      switch (f.type) {
        case 'act': {
          const text = f.ev.k !== 'think' && actText(f.ev);
          if (b && text && !(busy && f.ev.k === 'read')) b.label = { text, ok: f.ev.ok !== false, life: 1.7, ghost: !f.alive };
          break;
        }
        case 'move': {
          const to = this.bot(R, f.to);
          if (!to) break;
          const long = f.how === 'long' || f.how === 'onetwo';
          this.spot = { x: ZX[f.zone] + rand(-50, 50), y: clamp(to.y + rand(-50, 50), PY + 50, PY + PH - 50) };
          this.launch({ x1: this.spot.x, y1: this.spot.y, h: long ? 120 : f.how === 'counter' ? 40 : 10, dur: long ? 0.8 : 0.35, kick: true }, busy);
          const say = {
            long: [L('长传冲吊！', 'Long ball!'), '#ffe08a'], onetwo: [L('撞墙配合', 'One-two!'), '#9fd0ff'], counter: [L('打反击！', 'Counter!'), '#ffb86b'],
            skill: [pickOne([L('马赛回旋', 'Marseille turn'), L('彩虹过人', 'Rainbow flick'), L('踩单车', 'Step-overs'), L('穿裆！', 'Nutmeg!')]), '#e0c8ff'],
          }[f.how];
          if (say && !busy) this.float(f.to, ...say);
          break;
        }
        case 'turn': {
          if (['save', 'wide', 'post'].includes(f.how)) this.spot = { x: goalX(f.team) + DIR[f.team] * 40, y: MY }; // 门将拿球
          else {
            this.spot = b ? { x: b.x, y: b.y } : { x: ZX[f.zone], y: clamp(this.ball.y + rand(-60, 60), PY + 50, PY + PH - 50) };
            if (!this.flight?.big) this.launch({ x1: this.spot.x, y1: this.spot.y, h: f.how === 'header' ? 50 : 6, dur: 0.3 }, busy);
          }
          if (b && f.how === 'tackle') b.slide = 0.5;
          const say = {
            tackle: [L('滑铲！', 'Slide tackle!'), '#ffd166'], press: [L('断球', 'Intercepted'), '#fff'], clean: [L('完美抢断', 'Clean tackle!'), '#ffd166'],
            counter: [L('抢断反击', 'Win it & go'), '#ffb86b'], sub: [L('🔁 换人 · 生力军', '🔁 Fresh legs'), '#9fd0ff'], header: [L('头球解围', 'Headed clear'), '#fff'],
          }[f.how];
          if (say && !busy) this.float(f.sid, ...say);
          const oops = { misplaced: L('传丢了', 'Misplaced!'), offside: L('🚩 越位', '🚩 Offside') }[f.how];
          if (oops && f.culprit) this.float(f.culprit, oops, '#ff9a9a');
          if (f.how === 'offside') this.whistle();
          break;
        }
        case 'press': if (b) b.dash = 0.5; break;
        case 'dodge': if (!busy) this.float(f.sid, L('👀 一脚出球', '👀 One-touch, gone'), '#9fd0ff', 13); break;
        case 'shot': this.shot(f, busy); break;
        case 'goal':
          if (f.own) {
            const o = this.bots.get(f.own);
            const G = OTHER[f.team];
            if (o) [this.ball.x, this.ball.y] = [o.x, o.y];
            this.launch({ x1: goalX(G) - DIR[G] * 20, y1: MY + rand(-40, 40), h: 16, dur: 0.45, big: true, kick: true, hold: 1.4, onLand: () => this.celebrate(f.team, null) }, busy);
            this.float(f.own, L('乌龙…', 'Oops…'), '#ff9a9a', 16);
          }
          break;
        case 'kickoff':
          this.spot = { x: 800, y: MY };
          if (!this.flight) this.launch({ x1: 800, y1: MY, h: 30, dur: 0.5 }, busy);
          break;
        case 'card':
          this.ref.card = { color: f.color, sid: f.sid, life: 2 };
          if (b) b.icon = { text: f.color === 'red' ? '🟥' : '🟨', life: 2.2 };
          this.whistle();
          break;
        case 'foul': this.float(f.sid, L('犯规！', 'Foul!'), '#ff9a9a'); this.whistle(); break;
        case 'corner': this.float(f.sid, L('角球', 'Corner')); break;
        case 'fumble': if (!busy) this.float(f.sid, L('停球太大', 'Heavy touch'), '#ffc9a0', 12); break;
        case 'tiki': if (!busy) this.float(f.sid, 'Tiki-taka!', '#ffd166', 17, 1.6); break;
        case 'gkwait': this.keepers[f.team].say = { text: L('⏳ 等你回复…', '⏳ Waiting on you…'), life: 2.5 }; break;
        case 'gkback': this.keepers[f.team].say = { text: L('🧤 收到！', '🧤 On it!'), life: 1.8 }; break;
        case 'cramp':
          if (b) b.down = 1.8;
          this.float(f.sid, f.kind === 'apierr' ? L('📡 滑倒了', '📡 Slipped!') : L('💫 抽筋了', '💫 Cramp!'), '#ff9a9a', 15);
          break;
        case 'shout':
          this.coach[f.team] = { text: `📣 ${pickOne([L('压上去！', 'PRESS!'), L('传起来！', 'Pass it!'), L('射门啊！', 'SHOOT!'), L('高位逼抢！', 'Gegenpress!')])}`, life: 2.2 };
          for (const o of this.bots.values()) if (o.team === f.team) fx.ring(o.x, o.y, 8, 34, 'rgba(160,210,255,0.8)', 0.5);
          break;
        case 'penalty':
        case 'pk': {
          // 球摆上点球点，罚球的人站到球后面；点球大战每一脚都在守门那一方自己的球门前
          const G = OTHER[f.team];
          const x = goalX(G) + DIR[G] * 150;
          if (b) [b.x, b.y] = [x - DIR[f.team] * 24, MY];
          [this.ball.x, this.ball.y, this.ball.h, this.flight, this.queue] = [x, MY, 0, null, []];
          if (f.type === 'penalty') this.whistle();
          else this.shot({ ...f, kind: f.skied ? 'skied' : 'pk', res: f.scored ? 'goal' : f.skied ? 'wide' : 'save' }, busy);
          break;
        }
        case 'shootout': this.whistle(2); break;
        case 'ft':
          this.ft = { goals: f.goals, pens: f.pens, until: this.app.rt() + (busy ? 1.2 : 3.5) };
          this.whistle(3);
          break;
      }
    }
  }

  /** 射门：球飞向球门，门将扑救；落地时才演结果——进网抖动、扑出、中柱还是打飞。 */
  shot(f, busy) {
    const G = OTHER[f.team];
    const gx = goalX(G);
    const into = -DIR[G];
    const k = this.keepers[G];
    const s = this.bots.get(f.sid);
    const butter = f.kind === 'butter';
    if (s && !butter) s.kickT = 0.3;
    const side = Math.random() < 0.5 ? -1 : 1;
    const [x1, y1] = {
      goal: [gx + into * 22, MY + rand(-GH + 12, GH - 12)], save: [gx - into * 26, MY + rand(-45, 45)],
      post: [gx, MY + side * GH], wide: [gx + into * 40, MY + side * (GH + rand(25, 110))],
    }[f.res];
    if (butter) [this.ball.x, this.ball.y] = [gx - into * 30, MY];
    // 进球时门将扑反方向（或者扑晚了）
    const dy = f.res === 'goal' ? (Math.random() < 0.6 ? -1 : 1) * Math.sign(y1 - MY || 1) * 55 : y1 - k.y;
    const loft = { bicycle: 60, worldie: 70, header: 30, skied: 160 }[f.kind] || 18;
    this.launch({
      x1, y1, h: loft, dur: butter ? 0.6 : loft > 50 ? 0.55 : 0.4, big: true, kick: !butter, hold: f.res === 'goal' ? 1.6 : 0.6,
      onStart: () => {
        if (!butter) k.dive = { t: 0, dur: 0.3, dy: clamp(dy, -70, 70) };
        else {
          k.down = 1.5;
          this.fx.text(k.x, k.y - 28, L('🧈 脱手了', '🧈 Fumbled!'), '#ffe08a', 17, 1.6);
        }
        if (s && f.kind === 'bicycle') this.fx.text(s.x, s.y - 30, L('倒挂金钩！', 'Bicycle kick!'), '#ffd166', 19, 1.5);
        if (s && f.kind === 'worldie' && !busy) this.fx.text(s.x, s.y - 30, L('🚀 远射！', '🚀 From distance!'), '#ffd166', 16);
      },
      onLand: () => {
        if (f.res === 'goal') return this.celebrate(f.team, f.sid, f.kind === 'pk');
        if (f.res === 'wide') return this.fx.text(x1, y1, f.kind === 'skied' ? L('踢飞了 · 巴乔附体', 'Skied it · Baggio ’94') : L('打飞了', 'Wide!'), '#ffb3b3', 15);
        if (f.res === 'save') this.fx.text(k.x, k.y - 30, L('🧤 扑出！', '🧤 Saved!'), '#9fe8a0', 16);
        else {
          this.fx.text(x1, y1 - 20, L('中柱！', 'Off the post!'), '#fff', 16);
          if (this.app.sfx.ok(2)) this.app.sfx.tone(1250, 0.35, 0.08, 'triangle');
        }
        this.fx.sparks(x1, y1, '#ffffff', 8, 130);
      },
    }, busy);
  }

  celebrate(team, sid, pk = false) {
    const { app, fx } = this;
    const G = OTHER[team];
    [this.ripple[G], this.cheer[team]] = [1, pk ? 1.5 : 3.2];
    if (pk) return fx.text(goalX(G) - DIR[G] * 60, MY - 60, L('罚进！', 'Scored!'), COLOR[team], 18, 1.4);
    fx.text(goalX(G) - DIR[G] * 10, MY - 70, L('球进了！', 'GOAL!'), COLOR[team], 30, 1.8);
    fx.ring(goalX(G), MY, 10, 140, COLOR[team], 0.7, 6);
    // 看台上闪光灯一片
    for (let i = 0; i < 26; i++) fx.ring(team === 'claude' ? rand(10, 790) : rand(810, 1590), Math.random() < 0.7 ? rand(6, 88) : rand(914, 956), 1, 5, '#fff', rand(0.2, 1.4), 3);
    const s = sid && this.bots.get(sid);
    if (s) fx.text(s.x, s.y - 44, pickOne(['SIUUU!', L('🕺 滑跪庆祝', '🕺 Knee slide!'), '🤫', L('冷静 · Calma', 'Calma, calma'), 'Why always me?', L('🍼 摇篮庆祝', '🍼 Cradle rock')]), '#fff', 18, 2);
    app.shake(0.3, 6);
    if (app.sfx.ok(2)) app.sfx.burst(1.6, 900, 0.3, 'bandpass');
    app.sfx.good();
  }

  // ---------------------------------------------------------------- 站位与动画

  /** 按规则状态算站位：持球人带球去球该在的地方，进攻方前插，防守方退到球和球门之间，刚逼抢过的人扑向球。 */
  formation(R) {
    const live = R.goals && R.phase === 'live';
    const { x: bx, y: by } = this.ball;
    for (const team of TEAMS) {
      const xs = R.field(team).map((p) => [p, this.bots.get(p.sid)]).filter(([p, b]) => b && p.alive);
      const [n, d] = [xs.length, DIR[team]];
      xs.forEach(([p, b], i) => {
        const laneY = PY + (PH * (i + 1)) / (n + 1) + b.lane;
        if (!live) [b.tx, b.ty] = [goalX(team) + d * (300 + (i % 2) * 140), laneY];
        else if (R.shootout) [b.tx, b.ty] = [800 + (i - (n - 1) / 2) * 36, MY - d * 30];
        else if (p.sid === R.carrier) [b.tx, b.ty] = [this.spot.x - d * 12, this.spot.y];
        else if (R.poss === team) [b.tx, b.ty] = [bx + d * (110 + (i % 3) * 80), laneY];
        else if (b.dash > 0) [b.tx, b.ty] = [bx - d * 16, by];
        else [b.tx, b.ty] = [bx - d * (70 + (i % 3) * 70), laneY * 0.6 + by * 0.4];
        [b.tx, b.ty] = [clamp(b.tx, PX + 30, PX + PW - 30), clamp(b.ty, PY + 20, PY + PH - 20)];
      });
    }
  }

  update(dt, R) {
    for (const p of R.field()) this.bot(R, p.sid);
    for (const [sid] of this.bots) if (!R.players.get(sid)?.onField) this.bots.delete(sid);
    this.formation(R);
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      for (const key of ['down', 'slide', 'dash', 'kickT']) b[key] = Math.max(0, b[key] - dt);
      if (b.label && (b.label.life -= dt) <= 0) b.label = null;
      if (b.icon && (b.icon.life -= dt) <= 0) b.icon = null;
      if (!p.alive) [b.tx, b.ty] = [800 - DIR[b.team] * 24, 880]; // 罚下场：低头走向球员通道
      if (b.down > 0) continue;
      const [dx, dy] = [b.tx - b.x, b.ty - b.y];
      const d = Math.hypot(dx, dy);
      const step = Math.min(d, (b.dash > 0 || b.slide > 0 ? 340 : p.alive ? 200 : 70) * dt);
      if (d > 1) [b.x, b.y] = [b.x + (dx / d) * step, b.y + (dy / d) * step];
    }
    this.moveBall(dt, R);
    this.moveKeepers(dt, R);
    // 裁判跟着球跑，出牌时跑到那个人跟前
    const { ref } = this;
    const tb = ref.card && this.bots.get(ref.card.sid);
    const [rx, ry] = tb ? [tb.x + 40, tb.y - 30] : [this.ball.x - 70, this.ball.y + (this.ball.y > MY ? -110 : 110)];
    ref.x += (clamp(rx, PX + 20, PX + PW - 20) - ref.x) * Math.min(1, dt * 2.5);
    ref.y += (clamp(ry, PY + 20, PY + PH - 20) - ref.y) * Math.min(1, dt * 2.5);
    if (ref.card && (ref.card.life -= dt) <= 0) ref.card = null;
    for (const team of TEAMS) {
      this.ripple[team] = Math.max(0, this.ripple[team] - dt * 0.6);
      this.cheer[team] = Math.max(0, this.cheer[team] - dt);
      if (this.coach[team] && (this.coach[team].life -= dt) <= 0) this.coach[team] = null;
    }
    if (this.ft && this.app.rt() > this.ft.until) this.ft = null;
    this.fx.update(dt);
  }

  moveBall(dt, R) {
    const f = this.flight;
    const ball = this.ball;
    if (!f) {
      // 没在飞：粘在持球人脚下，没人持球就停在该停的地方
      const c = R.carrier && R.phase === 'live' && !R.shootout && R.players.get(R.carrier)?.alive ? this.bots.get(R.carrier) : null;
      const [tx, ty] = c ? [c.x + DIR[c.team] * 12, c.y + 6] : [this.spot.x, this.spot.y];
      const k = Math.min(1, dt * 10);
      [ball.x, ball.y, ball.h] = [ball.x + (tx - ball.x) * k, ball.y + (ty - ball.y) * k, 0];
      return;
    }
    f.t += dt;
    const k = clamp(f.t / f.dur, 0, 1);
    [ball.x, ball.y, ball.h] = [f.x0 + (f.x1 - f.x0) * ease(k), f.y0 + (f.y1 - f.y0) * ease(k), Math.sin(k * Math.PI) * f.h];
    if (k >= 1 && !f.landed) {
      f.landed = true;
      f.onLand?.();
    }
    if (k < 1 || (f.hold -= dt) > 0) return;
    this.flight = null;
    if (this.queue.length) this.start(this.queue.shift());
    else if (Math.hypot(ball.x - this.spot.x, ball.y - this.spot.y) > 120) this.start({ x1: this.spot.x, y1: this.spot.y, h: 40, dur: 0.55 });
  }

  moveKeepers(dt, R) {
    for (const team of TEAMS) {
      const k = this.keepers[team];
      let [hx, hy] = [goalX(team) + DIR[team] * 24, clamp(this.ball.y, MY - 46, MY + 46)];
      if (R.field(team).some((q) => R.waiting?.(q))) [hx, hy] = [goalX(team) + DIR[team] * 90, MY - 80]; // 在等你：溜达出门线看手机
      if (k.say && (k.say.life -= dt) <= 0) k.say = null;
      k.down = Math.max(0, k.down - dt);
      if (k.dive && (k.dive.t += dt) >= k.dive.dur) {
        [k.y, k.dive, k.down] = [k.y + k.dive.dy, null, 0.7];
        continue;
      }
      if (k.dive || k.down > 0) continue;
      k.x += (hx - k.x) * Math.min(1, dt * 4);
      k.y += (hy - k.y) * Math.min(1, dt * 5);
    }
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(layers.pitch, 0, 0, W, H);
    this.drawCrowd(g, layers.top, rt);
    this.drawCrowd(g, layers.bottom, rt);
    this.drawBoards(g, 96, rt);
    this.drawBoards(g, 884, rt + 7);
    for (const team of TEAMS) this.drawNet(g, team, rt);
    this.drawCoaches(g);
    // 人按 y 排序，靠下的盖住靠上的；球影在人下面，球在最上面
    const items = [[this.ref.y, () => this.drawRef(g)]];
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      if (p) items.push([b.y, () => this.drawBot(g, R, b, p)]);
    }
    for (const team of TEAMS) items.push([this.keepers[team].y, () => this.drawKeeper(g, this.keepers[team])]);
    const { x, y, h } = this.ball;
    oval(g, x + 2 + h * 0.15, y + 5, 7 - Math.min(3, h / 50), 3.5, `rgba(0,0,0,${0.35 - Math.min(0.2, h / 600)})`);
    for (const [, draw] of items.sort((a, b) => a[0] - b[0])) draw();
    this.drawBall(g);
    this.fx.renderOver(g, scale);
    const fs = fontFor(scale);
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      if (p) this.drawTags(g, R, b, p, fs, rt);
    }
    for (const team of TEAMS) this.drawKeeperTag(g, R, this.keepers[team], fs);
    this.drawBug(g, R);
  }

  drawCrowd(g, layer, rt) {
    const sw = W / 40;
    const waveX = ((rt * 260) % (W + 800)) - 400; // 人浪
    for (let i = 0; i < 40; i++) {
      const x = i * sw;
      const cheer = this.cheer[x < 800 ? 'claude' : 'codex'];
      const lift = Math.exp(-(((x - waveX) / 90) ** 2)) * 6 + (cheer > 0 ? Math.abs(Math.sin(rt * 13 + i * 0.9)) * 6 * Math.min(1, cheer) : 0);
      g.drawImage(layer.c, x * 2, 0, sw * 2, layer.c.height, x, layer.y0 - lift + 2, sw, layer.c.height / 2);
    }
  }

  /** LED 广告牌：一块块面板慢慢滚动。 */
  drawBoards(g, y, rt) {
    const ads = [
      [TEAM_NAME.claude, COLOR.claude], ['AGENT STRIKE', '#f5c451'], [L('测试全绿 ✓', 'ALL TESTS GREEN ✓'), '#6fd38b'], [TEAM_NAME.codex, COLOR.codex],
      [L('禁止 rm -rf', 'NO rm -rf'), '#ff8a8a'], ['LGTM 👍', '#fff'], [L('今日零 Bug', '0 BUGS TODAY'), '#9fd0ff'], ['git push --force ❌', '#ffb86b'],
    ];
    const off = (rt * 26) % (260 * ads.length);
    g.fillStyle = '#0b0d12';
    g.fillRect(0, y, W, 24);
    for (let i = 0; i < ads.length + 7; i++) {
      const x = i * 260 - off + 130;
      const [text, color] = ads[i % ads.length];
      if (x > -130 && x < W + 130) txt(g, text, x, y + 13, '800 15px', color);
    }
  }

  /** 球网：进球之后整张网抖一阵。 */
  drawNet(g, team, rt) {
    const [gx, out, D] = [goalX(team), -DIR[team], 36]; // 球网在球门线外侧
    const amp = this.ripple[team] * 9;
    const wob = (x, y) => amp * Math.sin(y * 0.18 + rt * 22 + x * 0.1);
    const net = 'rgba(255,255,255,0.55)';
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(Math.min(gx, gx + out * D), MY - GH, D, GH * 2);
    for (let i = 1; i <= 4; i++) {
      const x = gx + (out * D * i) / 4;
      const pts = [];
      for (let y = MY - GH; y <= MY + GH; y += 6) pts.push([x + out * wob(x, y) * (i / 4), y]);
      line(g, pts, net, 1);
    }
    for (let y = MY - GH + 10; y < MY + GH; y += 10) line(g, [[gx, y], [gx + out * (D + wob(gx, y)), y]], net, 1);
    line(g, [[gx, MY - GH], [gx + out * D, MY - GH], [gx + out * D, MY + GH], [gx, MY + GH]], '#fff', 5);
    for (const y of [MY - GH, MY + GH]) disc(g, gx, y, 4.5, '#fff');
  }

  drawCoaches(g) {
    for (const team of TEAMS) {
      const x = 800 - DIR[team] * 170;
      const c = this.coach[team];
      disc(g, x, 869, 10, '#2a2e38', COLOR[team], 3);
      if (!c) continue;
      g.globalAlpha = Math.min(1, c.life / 0.3);
      pill(g, x, 843, c.text, { size: 13, bg: 'rgba(255,255,255,0.92)', color: '#111', max: 180, weight: 800 });
      g.globalAlpha = 1;
    }
  }

  drawBot(g, R, b, p) {
    const d = DIR[b.team];
    g.globalAlpha = p.alive ? 1 : 0.45;
    if (b.slide > 0) line(g, [[b.x, b.y], [b.x - d * 46, b.y + 4]], 'rgba(120,80,40,0.55)', 8); // 滑铲留下的草皮印
    man(g, b.x, b.y, b.down > 0 ? [1.35, 0.6] : [1, 1], COLOR[b.team], DEEP[b.team], NUMS[Math.max(0, R.field(b.team).indexOf(p)) % NUMS.length], '#fff');
    if (b.kickT > 0) line(g, [[b.x + d * 10, b.y + 8], [b.x + d * 24, b.y + 10]], '#fff', 4);
    if (p.sid === R.carrier && p.alive && R.phase === 'live' && !R.shootout) {
      // FIFA 头顶那个「当前控制球员」小三角
      const tri = [[b.x - 7, b.y - 52], [b.x + 7, b.y - 52], [b.x, b.y - 43], [b.x - 7, b.y - 52]];
      path(g, tri);
      g.fillStyle = COLOR[b.team];
      g.fill();
      line(g, tri, '#fff', 2);
    }
    g.globalAlpha = 1;
  }

  drawKeeper(g, k) {
    let [y, s] = [k.y, k.down > 0 ? [0.65, 1.6] : [1, 1]];
    if (k.dive) {
      const e = ease(k.dive.t / k.dive.dur);
      [y, s] = [y + k.dive.dy * e, [1 - 0.35 * e, 1 + 0.6 * e]]; // 横向飞身，身子拉长
    }
    man(g, k.x, y, s, KEEPER[k.team], COLOR[k.team], 1, '#222', () => { for (const t of [-1, 1]) disc(g, DIR[k.team] * 8, t * 15, 5, '#fff'); }); // 手套
  }

  drawRef(g) {
    const { x, y, card } = this.ref;
    oval(g, x + 3, y + 8, 12, 6, 'rgba(0,0,0,0.25)');
    disc(g, x, y, 12, '#16181d', '#f5c451', 2);
    if (!card) return;
    Object.assign(g, { fillStyle: card.color === 'red' ? '#e23b3b' : '#ffd23a', strokeStyle: '#000', lineWidth: 1.5 });
    g.fillRect(x + 8, y - 38, 14, 20);
    g.strokeRect(x + 8, y - 38, 14, 20);
  }

  drawBall(g) {
    const { x, h } = this.ball;
    const y = this.ball.y - h;
    const r = 7 + Math.min(4, h / 30);
    const a = (x + y) * 0.08; // 滚起来花纹跟着转
    disc(g, x, y, r, '#fff', '#333', 1.2);
    for (let i = 0; i < 3; i++) disc(g, x + Math.cos(a + i * 2.1) * r * 0.5, y + Math.sin(a + i * 2.1) * r * 0.5, r * 0.25, '#222');
  }

  drawTags(g, R, b, p, fs, rt) {
    const y = b.y - 30;
    g.globalAlpha = p.alive ? 1 : 0.5;
    pill(g, b.x, y, p.name, { color: COLOR[b.team], size: fs, max: 110 });
    if (b.label) {
      g.globalAlpha = Math.min(1, b.label.life / 0.4) * (b.label.ghost ? 0.45 : 1);
      pill(g, b.x, y - fs - 8 - (1.7 - b.label.life) * 6, b.label.text, { size: fs - 1, max: 190, weight: 500, bg: b.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)' });
    }
    g.globalAlpha = 1;
    if (b.icon || !p.alive) emoji(g, b.icon ? b.icon.text : '🟥', b.x + 18, b.y - 14, fs + 4);
    if (p.alive && R.now - p.lastActive > 60e3) {
      const k = (rt * 0.6 + b.x) % 1;
      g.globalAlpha = 1 - k;
      txt(g, 'z', b.x + 16 + k * 8, b.y - 12 - k * 18, `700 ${fs}px`, 'rgba(255,255,255,0.8)');
      g.globalAlpha = 1;
    }
  }

  drawKeeperTag(g, R, k, fs) {
    const w = [...(R.waits || [])].find(([sid, x]) => !x.boom && R.players.get(sid)?.team === k.team && R.players.get(sid)?.onField);
    if (w) {
      // 门将在等你：掏出手机，身边一圈倒计时
      const prog = clamp((R.now - w[1].t) / (w[1].deadline - w[1].t), 0, 1);
      emoji(g, '📱', k.x + 16, k.y - 4, fs + 4);
      Object.assign(g, { strokeStyle: 'rgba(255,90,90,0.9)', lineWidth: 3 });
      g.beginPath();
      g.arc(k.x, k.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - prog));
      g.stroke();
      pill(g, k.x, k.y - 30, L('门将在等你', 'GK waiting on you'), { size: fs - 1, color: '#ffb3b3', max: 150 });
    } else pill(g, k.x, k.y - 28, L(`${TEAM_NAME[k.team]} 门将`, `${TEAM_NAME[k.team]} GK`), { size: fs - 2, color: KEEPER[k.team], max: 130 });
    if (!k.say) return;
    g.globalAlpha = Math.min(1, k.say.life / 0.4);
    pill(g, k.x, k.y - 52, k.say.text, { size: fs - 1, max: 170, bg: 'rgba(10,12,16,0.8)' });
    g.globalAlpha = 1;
  }

  /** 左上角的转播比分条：「CLA 1–0 COD 67'」，下面一行是控球率或点球。 */
  drawBug(g, R) {
    const live = R.goals && R.phase === 'live';
    const ft = this.ft;
    const goals = ft ? ft.goals : live ? R.goals : { claude: 0, codex: 0 };
    const clock = ft ? L('全场结束', 'FT') : !live ? L('热身', 'Warm-up') : R.shootout ? L('点球', 'PENS') : `${R.minute()}'`;
    const [x, y] = [18, 12];
    const box = (bx, by, w, h, fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect(bx, by, w, h, 5); g.fill(); };
    box(x, y, 330, 40, 'rgba(8,10,14,0.88)');
    box(x + 8, y + 6, 6, 28, COLOR.claude);
    box(x + 216, y + 6, 6, 28, COLOR.codex);
    box(x + 82, y + 6, 76, 28, '#fff');
    txt(g, abbr('claude'), x + 20, y + 21, '900 18px', '#fff', 'left');
    txt(g, `${goals.claude}–${goals.codex}`, x + 120, y + 21, '900 20px', '#111');
    txt(g, abbr('codex'), x + 210, y + 21, '900 18px', '#fff', 'right');
    txt(g, clock, x + 278, y + 21, '800 17px', ft ? '#f5c451' : '#9fe8a0');
    let sub = null;
    if (ft?.pens) sub = L(`点球 ${ft.pens.claude}–${ft.pens.codex}`, `Pens ${ft.pens.claude}–${ft.pens.codex}`);
    else if (live && R.shootout) {
      const dots = (t) => R.shootout.kicks[t].map((s) => (s ? '●' : '○')).join('') || '·';
      sub = `${abbr('claude')} ${dots('claude')}   ${dots('codex')} ${abbr('codex')}`;
    } else if (live) {
      const { claude: a, codex: b } = R.possN;
      const pa = a + b ? Math.round((a / (a + b)) * 100) : 50;
      sub = L(`控球率 ${pa}% – ${100 - pa}%`, `Possession ${pa}% – ${100 - pa}%`) + (R.party ? L(' · 金球制胜', ' · Golden goal') : '');
    }
    if (!sub) return;
    box(x, y + 44, 330, 24, 'rgba(8,10,14,0.75)');
    txt(g, sub, x + 165, y + 56, '700 13px', '#d8dde6');
  }

  hud(R) {
    if (R.phase !== 'live' || !R.goals) return null;
    const so = R.shootout;
    const min = so ? L('点球大战', 'Penalties') : `${R.minute()}'`;
    const sub = so ? L(`点球 ${count(so.kicks.claude)} – ${count(so.kicks.codex)}`, `Pens ${count(so.kicks.claude)} – ${count(so.kicks.codex)}`) : L(`比分 ${R.goals.claude} – ${R.goals.codex}`, `Score ${R.goals.claude} – ${R.goals.codex}`);
    return { mid: L(`第 ${R.round} 场 · ${min}`, `Match ${R.round} · ${min}`), sub };
  }
}
