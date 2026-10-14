// 飞机大战 · 雷电：竖版射击对战。屏幕劈成左右两条航道，每队一架战机在底下开火，敌机一排排压下来。
// 打下来的敌机会变成「垃圾」飞过中线、塞进对面的航道（像俄罗斯方块 99），哪队的命先用光哪队输。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, ACTIONS, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, rand, pill, hpBar, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'plane',
  icon: '✈️',
  get name() { return L('飞机大战 · 雷电', 'Sky Force (Raiden)'); },
  get desc() { return L('竖版射击对战：跑命令开火，打下的敌机飞去对面航道，命先用光的输', 'Vertical shmup versus: commands open fire, every kill flies over to the other lane, first to lose all lives loses'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('🛸 {a} 悬停等你回复', '🛸 {a} is hovering, waiting for you'),
      sub: L('40 秒内回它，不然被弹幕淹没', 'Reply within 40s or get buried in bullets'),
      done: L('✅ 及时回复，护盾充能', '✅ Quick reply: shield recharged'),
      boom: L('💥 {a} 悬停太久，被弹幕淹没', '💥 {a} hovered too long and got swarmed'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('开火：火力越高散弹越宽', 'Open fire: more power, wider spread')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('全屏炸弹 BOMB!', 'Screen-clearing BOMB!')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('锁定：下一轮齐射暴击', 'Lock-on: next volley crits')],
      [L('🧱 改代码', '🧱 Edit code'), L('吃 P：火力升级 P1 → P4', 'Grab a P: power P1 → P4')],
      [L('🔭 上网查资料', '🔭 Web search'), L('追踪导弹', 'Homing missiles')],
      [L('💭 思考', '💭 Thinking'), L('蓄力，攒满放激光', 'Charge up; full charge fires a laser')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('僚机来助阵', 'A wingman joins in')],
      [L('✅ 任务完成', '✅ Task done'), L('歼灭波 / 重创 Boss', 'Kill wave / Boss smasher')],
      [L('🐛 命令报错', '🐛 Command fails'), L('被子弹击中', 'Hit by a bullet')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('护盾失效', 'Shield down')],
      [L('✋ 被打断', '✋ Interrupted'), L('你把自己的飞机撞了：掉一条命', 'You crashed your own jet: lose a life')],
      [L('💬 收到新指令', '💬 New prompt'), L('补给箱：回血（满血给炸弹）', 'Supply drop: repair (bomb if full)')],
      [L('⏳ 它在等你', '⏳ Waiting for you'), L('悬停；40 秒不回被弹幕淹没', 'Hovering; no reply in 40s = swarmed')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('必杀 · 核弹：清屏并送对面一大波', 'NUKE: wipe your lane, send a huge wave over')],
      [L('💥 打下敌机', '💥 Shoot planes down'), L('变成垃圾敌机飞去对面', 'They fly over as garbage for the other side')],
    ];
  },
};

// ================================================================ 规则
// 每队一条航道：敌机（种类、血量、第几排第几列）+ 战机的血 / 命 / 火力 / 炸弹 / 护盾。
// 任何一个动作 = 全场走一步：两边的敌机都往下压一排、顶上来新的一波，然后动作的那队开火。
// 打下来的敌机按分值给对面攒「垃圾」，下一步从对面航道顶上飞进来。

const LANES = 5;
const ROWS = 9; // 第 0 排在航道最上面，走过第 ROWS - 1 排就撞上战机
const HP = 100;
const MAX_PENDING = 20;
const MAX_BOMBS = 5;
// 敌机：hp 血量，crash 撞上战机扣多少血，pts 分数，send 打下来给对面攒几点垃圾，every 几步挪一格
const KIND = {
  scout: { hp: 10, crash: 28, pts: 100, send: 1, every: 1 }, // 小飞机：一梭子就掉
  fighter: { hp: 24, crash: 40, pts: 300, send: 2, every: 1 }, // 中飞机
  bomber: { hp: 56, crash: 60, pts: 1000, send: 4, every: 2 }, // 大飞机：皮厚，两步才挪一格
};
// Boss：两步往下挪一格，挪到第 hold 排就停住开炮，stay 步之内打不下来就飞走；它在场时这条航道的基础波减半
const BOSS = { hp: 80, pts: 8000, send: 10, every: 2, hold: 2, fireEvery: 3, bullet: 6, stay: 20 };
const SHOT = 12; // 一发子弹的基础威力
const SPREAD = [null, [1], [0.85, 0.5], [0.8, 0.5, 0.5], [0.85, 0.6, 0.6, 0.45]]; // P1～P4：每轮几发、每发多痛
const BOMB_DMG = 45;
const cell = (e) => e.row * LANES + e.lane;
// 掉命的原因 → 击杀播报里的武器和类别
const DEATH = {
  crash: () => [L('敌机撞击', 'Rammed'), 'gun'],
  bug: () => [L('被子弹击中', 'Shot down'), 'bug'],
  net: () => [L('信号中断', 'Signal lost'), 'net'],
  human: () => [L('自己撞的', 'Self-crash'), 'human'],
  boss: () => ['BOSS', 'gun'],
  swarm: () => [L('弹幕淹没', 'Bullet swarm'), 'zone'],
};

function newCol(team, round, cfg) {
  return {
    team, foes: [], boss: null, ids: 0, hp: HP, lives: cfg.lives, bombs: cfg.bombs, power: 1, lock: 0, charge: 0, shield: 1, wing: 0,
    score: 0, kills: 0, sent: 0, pending: 0, pendFrom: null, frac: 0, out: 0, maxed: false, dead: false, pilot: null,
    rnd: rng(hash(`plane-${team}-${round}`)),
  };
}

export class Rules extends Base {
  static defaults = {
    lives: 3, bombs: 1, waveBase: 6, waveRamp: 0.6, attack: 0.5, bossFirst: 18, bossEvery: 30, roundLen: 10 * 60e3, tideEvery: 20e3,
    partyCfg: { lives: 2, bombs: 0, waveBase: 6, waveRamp: 1, attack: 0.6, bossFirst: 8, bossEvery: 16, roundLen: 4 * 60e3, tideEvery: 8e3 },
  };

  init() {
    const o = this.opts;
    const keys = ['lives', 'bombs', 'waveBase', 'waveRamp', 'attack', 'bossFirst', 'bossEvery', 'roundLen', 'tideEvery'];
    this.cfg = Object.fromEntries(keys.map((k) => [k, o.party ? o.partyCfg[k] : o[k]]));
    this.roundLen = this.cfg.roundLen;
    this.resetField(0);
  }

  resetField(round) {
    Object.assign(this, { step: 0, tide: 0, wave: 0, bossAt: Infinity });
    this.cols = { claude: newCol('claude', round, this.cfg), codex: newCol('codex', round, this.cfg) };
  }

  onRoundStart(fx) {
    this.resetField(this.round);
    // 第一艘 Boss 什么时候来：每局固定（种子是局数），两边同时来
    this.bossAt = this.cfg.bossFirst + Math.floor(rng(hash(`plane-boss-${this.round}`))() * 6);
    fx.push({ type: 'planeReset' });
  }

  // 人不够回到热身：清场，热身时接着练手（不掉血、不送垃圾）
  onPause(fx) {
    this.resetField(this.round);
    fx.push({ type: 'planeReset' });
  }

  /**
   * 火力倍数。底座的均衡火力按「对面有几个人要打」算；这里两边各只有一架战机要打，
   * 所以把人数那一项约掉，只按动作频率均衡：动作多的那队每发子弹轻一点。
   */
  fire(team) {
    const pool = (t) => Math.max(1, this.field(t).length);
    return clamp(this.balanceMult(team) * Math.sqrt(pool(team) / pool(OTHER[team])), 0.33, 3) * this.sizeMult() * 0.5;
  }

  pilotOf(c) {
    const p = this.players.get(c.pilot);
    return p && p.onField && p.team === c.team ? p : this.field(c.team)[0] || null;
  }

  onEvent(p, ev, r, fx) {
    const c = this.cols[p.team];
    if (c.dead) return;
    c.pilot = p.sid;
    if (ACTIONS.has(ev.k)) {
      this.stepAll(fx);
      if (c.dead) return this.flush(fx);
    }
    if (ev.ok === false) this.hurt(c, p, ev.k === 'shell' ? 20 : 14, 'bug', fx); // 被击中
    else this.act(c, p, ev, fx);
    this.flush(fx);
  }

  act(c, p, ev, fx) {
    const live = this.phase === 'live';
    const say = (type) => fx.push({ type, team: c.team, sid: p.sid });
    switch (ev.k) {
      case 'shell':
        if (ev.hs && live) p.hs++;
        if (ev.hs) this.bomb(c, p, 'hs', fx);
        else this.volley(c, p, 1, 'shot', fx, { laser: true, wing: true });
        break;
      case 'read': this.volley(c, p, 0.5, 'vulcan', fx, { keepLock: true }), (c.lock = 1), say('planeLock'); break;
      case 'edit':
        if (c.power < 4) this.item(c, p, 'P', fx);
        else {
          if (live) c.score += 500; // 满火力再吃 P：加分，顺手一梭子
          this.volley(c, p, 0.7, 'shot', fx);
        }
        break;
      case 'web': this.missiles(c, p, fx); break;
      case 'misc': this.volley(c, p, 0.6, 'vulcan', fx); break;
      case 'agent':
        [c.wing, p.a] = [6, p.a + (live ? 1 : 0)];
        say('planeWing');
        this.volley(c, p, 0.8, 'wing', fx, { keepLock: true });
        break;
      case 'think': if (c.charge < 3 && ++c.charge === 3) say('planeCharge'); break;
      case 'done': this.killWave(c, p, fx); break;
      case 'prompt': this.item(c, p, c.hp < HP ? 'H' : 'B', fx); break;
      case 'compact': Object.assign(c, { shield: 0, charge: 0, lock: 0 }), say('planeShield'); break;
      case 'abort':
        if (!live) break;
        fx.push({ type: 'note', text: L('✋ 你打断了 {0}，它一头撞了下去', '✋ You interrupted {0} and it nosedived'), sids: [p.sid] });
        this.loseLife(c, p, null, 'human', fx);
        break;
      case 'apierr': this.hurt(c, p, 12, 'net', fx); break;
      case 'pr': this.nuke(c, p, fx); break;
    }
  }

  // ---------------------------------------------------------------- 全场走一步

  stepAll(fx) {
    this.step++;
    const live = this.phase === 'live';
    if (live && this.step === this.bossAt - 2) {
      fx.push({ type: 'planeWarn' });
      fx.push({ type: 'announce', text: 'WARNING!', sub: L('巨大战舰正在高速接近', 'A HUGE BATTLESHIP IS APPROACHING FAST'), cls: 'bad', ms: 2200 });
    }
    const bossNow = live && this.step >= this.bossAt;
    if (bossNow) this.bossAt += this.cfg.bossEvery;
    const wave = this.waveList();
    for (const team of TEAMS) {
      const c = this.cols[team];
      if (c.dead) continue;
      this.march(c, fx);
      if (c.dead) continue;
      if (bossNow && !c.boss) {
        c.boss = { boss: true, hp: BOSS.hp, max: BOSS.hp, row: 0, lane: 2, age: 0 };
        fx.push({ type: 'planeBoss', team });
      }
      this.spawn(c, wave);
    }
  }

  /** 这一步两边一起来的敌机：同一个种子，两条航道一模一样；越往后越密。 */
  waveList() {
    const r = rng(hash(`plane-wave-${this.round}-${this.step}`));
    this.wave += this.cfg.waveBase + (this.phase === 'live' ? this.cfg.waveRamp * Math.min(this.step, 90) : 0);
    const out = [];
    while (out.length < 3 && this.wave >= KIND.scout.hp) {
      const x = r();
      const kind = this.step > 6 && x < 0.14 && this.wave >= KIND.bomber.hp ? 'bomber' : x < 0.42 && this.wave >= KIND.fighter.hp ? 'fighter' : 'scout';
      this.wave -= KIND[kind].hp;
      out.push({ kind, lane: Math.floor(r() * LANES) });
    }
    this.wave = Math.min(this.wave, KIND.bomber.hp * 2); // 塞不进去的额度别无限攒
    return out;
  }

  /** 从最下面一排往上挪：轮到它动、前面空着才往前一格；冲过底线就撞上战机。 */
  march(c, fx) {
    const occ = new Set(c.foes.map(cell));
    const crashed = [];
    for (const e of [...c.foes].sort((a, b) => b.row - a.row || a.id - b.id)) {
      if (++e.age % KIND[e.kind].every) continue;
      occ.delete(cell(e));
      if (e.row + 1 >= ROWS) {
        crashed.push(e);
        continue;
      }
      if (!occ.has(cell(e) + LANES)) e.row++; // 前面堵住了就原地等
      occ.add(cell(e));
    }
    if (crashed.length) c.foes = c.foes.filter((e) => !crashed.includes(e));
    // 自动炸弹：这一下会要命、手里还有炸弹，就先扔掉
    const toll = crashed.reduce((s, e) => s + KIND[e.kind].crash, 0);
    if (this.phase === 'live' && c.bombs > 0 && toll > 0 && toll >= c.hp + (c.shield ? 20 : 0)) {
      c.bombs--;
      this.bomb(c, this.pilotOf(c), 'panic', fx, crashed);
    } else {
      for (const e of crashed) {
        fx.push({ type: 'planeCrash', team: c.team, id: e.id, kind: e.kind, lane: e.lane, src: e.src });
        this.hurt(c, null, KIND[e.kind].crash, 'crash', fx, e.from);
        if (c.dead) return;
      }
    }
    const b = c.boss;
    if (!b) return;
    if (++b.age > BOSS.stay) {
      c.boss = null;
      fx.push({ type: 'planeBossGone', team: c.team });
    } else if (b.age % (b.row < BOSS.hold ? BOSS.every : BOSS.fireEvery) === 0) {
      if (b.row < BOSS.hold) b.row++;
      else this.hurt(c, null, BOSS.bullet, 'boss', fx);
    }
  }

  /** 顶上进来新敌机：先是两边一样的基础波（有 Boss 时减半），再是对面送来的垃圾（一步最多进 3 架）。 */
  spawn(c, wave) {
    const occ = new Set(c.foes.map(cell));
    const put = (kind, lane, rows, src, from) => {
      for (const row of rows) {
        for (let i = 0; i < LANES; i++) {
          const l = (lane + i) % LANES;
          if (occ.has(row * LANES + l)) continue;
          occ.add(row * LANES + l);
          c.foes.push({ id: ++c.ids, kind, hp: KIND[kind].hp, max: KIND[kind].hp, row, lane: l, age: 0, src, from });
          return true;
        }
      }
      return false;
    };
    wave.forEach((w, i) => (!c.boss || i % 2) && put(w.kind, w.lane, [0], null, null));
    for (let i = 0; i < 3 && c.pending > 0; i++) {
      const x = c.rnd();
      const kind = c.pending >= 4 && x < 0.2 ? 'bomber' : c.pending >= 2 && x < 0.45 ? 'fighter' : 'scout';
      if (!put(kind, Math.floor(c.rnd() * LANES), [0, 1], OTHER[c.team], c.pendFrom)) break;
      c.pending = Math.max(0, c.pending - KIND[kind].send);
    }
  }

  // ---------------------------------------------------------------- 开火

  /** 最前面的目标排在前：离战机越近越先打，一样近先打中间的。 */
  targets(c) {
    const ts = c.foes.filter((e) => e.hp > 0);
    if (c.boss) ts.push(c.boss);
    return ts.sort((a, b) => b.row - a.row || Math.abs(a.lane - 2) - Math.abs(b.lane - 2) || (a.id || 0) - (b.id || 0));
  }

  /** 一轮齐射：按火力等级分成几发，每发打最前面的一架（打过的换下一架，散弹就是这么散开的）。 */
  volley(c, p, mult, kind, fx, { laser = false, wing = false, keepLock = false } = {}) {
    const f = SHOT * this.fire(c.team);
    const crit = !keepLock && c.lock > 0;
    if (crit) c.lock = 0;
    const packets = SPREAD[c.power].map((x) => x * f * mult * (crit ? 1.6 : 1));
    const withWing = wing && c.wing > 0;
    if (withWing) c.wing--, packets.push(0.6 * f);
    const hits = [];
    const done = new Set();
    for (const [i, dmg] of packets.entries()) {
      const ts = this.targets(c);
      if (!ts.length) break;
      // 主炮先打 Boss（除非有敌机已经贴到跟前），两边的散弹清杂兵
      const t = (i === 0 && c.boss && ts[0].row < ROWS - 2 && c.boss) || ts.find((e) => !done.has(e)) || ts[0];
      done.add(t);
      this.damage(c, p, t, dmg, hits, fx);
    }
    // 蓄力满了：这一轮顺带一道贯穿整列的激光
    let beam = null;
    if (laser && c.charge >= 3) {
      c.charge = 0;
      beam = this.targets(c)[0]?.lane ?? 2;
      for (const e of [...c.foes]) if (e.lane === beam) this.damage(c, p, e, 1.4 * f, hits, fx);
      if (c.boss && Math.abs(beam - 2) <= 1) this.damage(c, p, c.boss, 1.4 * f, hits, fx);
    }
    fx.push({ type: 'planeVolley', team: c.team, sid: p.sid, kind, hits, crit, beam });
  }

  /** 追踪导弹：三发，专挑皮最厚的（有 Boss 先打 Boss）。 */
  missiles(c, p, fx) {
    const crit = c.lock > 0;
    const k = 0.8 * SHOT * this.fire(c.team) * (crit ? 1.6 : 1);
    const hits = [];
    c.lock = 0;
    for (let i = 0; i < 3; i++) {
      const t = this.targets(c).sort((a, b) => (b.boss ? 1 : 0) - (a.boss ? 1 : 0) || b.hp - a.hp)[0];
      if (t) this.damage(c, p, t, k, hits, fx);
    }
    fx.push({ type: 'planeVolley', team: c.team, sid: p.sid, kind: 'missile', hits, crit });
  }

  /** 任务完成 = 歼灭波：Boss 掉四成血，最前面六架各挨一大下。 */
  killWave(c, p, fx) {
    const hits = [];
    if (c.boss) this.damage(c, p, c.boss, BOSS.hp * 0.4, hits, fx);
    const k = 1.3 * SHOT * this.fire(c.team);
    for (const e of this.targets(c).filter((x) => !x.boss).slice(0, 6)) this.damage(c, p, e, k, hits, fx);
    fx.push({ type: 'planeVolley', team: c.team, sid: p.sid, kind: 'wave', hits });
  }

  /** 全屏炸弹：测试通过白送一颗；自动炸弹用库存，顺手把正要撞上来的那几架带走。 */
  bomb(c, p, why, fx, crashed = []) {
    fx.push({ type: 'planeBomb', team: c.team, sid: p?.sid, why });
    if (why === 'hs' && this.phase === 'live') fx.push({ type: 'announce', text: L('全屏炸弹 BOMB!', 'BOMB!'), sub: L(`${p.name} 测试通过 · 清屏`, `${p.name}: tests pass · screen cleared`), cls: c.team, ms: 1400 });
    const hits = [];
    for (const e of crashed) this.kill(c, p, e, fx);
    for (const e of [...c.foes]) this.damage(c, p, e, BOMB_DMG, hits, fx);
    if (c.boss) this.damage(c, p, c.boss, BOSS.hp * 0.12, hits, fx);
    fx.push({ type: 'planeVolley', team: c.team, sid: p?.sid, kind: 'bomb', hits });
  }

  /** 开 PR = 必杀 · 核弹：自己航道清空，Boss 掉六成血，再给对面送一大波。 */
  nuke(c, p, fx) {
    fx.push({ type: 'planeNuke', team: c.team, sid: p.sid });
    if (this.phase === 'live') fx.push({ type: 'announce', text: L('必杀 · 核弹', 'NUKE!'), sub: L(`${p.name} 开了 PR · 清屏并送对面一大波`, `${p.name} opened a PR · lane wiped, huge wave sent`), cls: 'gold', ms: 1600 });
    const hits = [];
    for (const e of [...c.foes]) this.damage(c, p, e, 999, hits, fx);
    if (c.boss) this.damage(c, p, c.boss, BOSS.hp * 0.6, hits, fx);
    c.out += 10;
    fx.push({ type: 'planeVolley', team: c.team, sid: p.sid, kind: 'nuke', hits });
  }

  damage(c, p, e, dmg, hits, fx) {
    if (e.hp <= 0) return;
    const d = Math.min(e.hp, dmg);
    e.hp -= dmg;
    hits.push({ id: e.boss ? 'boss' : e.id, lane: e.lane, row: e.row, dmg: Math.round(d), kill: e.hp <= 0 });
    if (e.hp <= 0) this.kill(c, p, e, fx);
  }

  kill(c, p, e, fx) {
    const k = e.boss ? BOSS : KIND[e.kind];
    if (e.boss) c.boss = null;
    else c.foes = c.foes.filter((x) => x !== e);
    e.hp = 0;
    fx.push({ type: 'planeKill', team: c.team, sid: p?.sid, id: e.boss ? 'boss' : e.id, kind: e.boss ? 'boss' : e.kind, lane: e.lane, row: e.row, src: e.src || null, pts: k.pts });
    if (this.phase !== 'live') return;
    c.score += k.pts;
    c.kills++;
    c.out += k.send;
    if (p) p.k++, (p.dmg += k.pts / 100);
    // 掉落：大飞机有时掉炸弹，中飞机偶尔掉 P
    if (e.kind === 'bomber' && c.rnd() < 0.3) this.item(c, p, 'B', fx, e);
    else if (e.kind === 'fighter' && c.power < 4 && c.rnd() < 0.12) this.item(c, p, 'P', fx, e);
    if (!e.boss) return;
    const who = p ? p.name : TEAM_NAME[c.team];
    fx.push({ type: 'announce', text: L('击落 Boss！', 'BOSS DOWN!'), sub: L(`${who} 击落了巨大战舰`, `${who} shot down the battleship`), cls: c.team, ms: 1800 });
    if (c.lives > this.cfg.lives) return;
    c.lives++;
    fx.push({ type: 'planeUp', team: c.team });
    fx.push({ type: 'announce', text: '1UP', sub: L(`${TEAM_NAME[c.team]} 多一条命`, `${TEAM_NAME[c.team]} gains a life`), cls: 'gold', ms: 1200 });
  }

  /** 补给胶囊：P 火力、B 炸弹、H 修理、S 护盾。at = 从哪架敌机身上掉出来的。 */
  item(c, p, it, fx, at = null) {
    let max = false;
    if (it === 'P') {
      c.power = Math.min(4, c.power + 1);
      if (c.power === 4 && !c.maxed) {
        c.maxed = max = true;
        if (this.phase === 'live') fx.push({ type: 'announce', text: L('火力全开 MAX POWER!', 'MAX POWER!'), sub: L(`${TEAM_NAME[c.team]} 散弹满级`, `${TEAM_NAME[c.team]} spread shot maxed out`), cls: c.team, ms: 1200 });
      }
    } else if (it === 'B') c.bombs = Math.min(MAX_BOMBS, c.bombs + 1);
    else if (it === 'H') c.hp = Math.min(HP, c.hp + 40);
    else if (it === 'S') c.shield = 1;
    fx.push({ type: 'planeItem', team: c.team, sid: p?.sid, item: it, lane: at?.lane ?? null, row: at?.row ?? null, max });
  }

  // ---------------------------------------------------------------- 挨打 / 掉命 / 送垃圾

  hurt(c, p, dmg, why, fx, from = null) {
    if (c.dead) return;
    const live = this.phase === 'live'; // 热身时只演不扣血
    const shield = live && c.shield > 0;
    if (shield) c.shield = 0;
    else if (live) c.hp -= dmg;
    fx.push({ type: 'planeHit', team: c.team, sid: p?.sid, dmg: live && !shield ? dmg : 0, why, shield });
    if (c.hp <= 0) this.loseLife(c, p, from, why, fx);
  }

  loseLife(c, p, from, why, fx) {
    if (c.dead || this.phase !== 'live') return;
    c.lives--;
    const victim = p || this.pilotOf(c);
    const killer = from && this.players.get(from) && this.players.get(from).team !== c.team ? from : null;
    const [weapon, cause] = DEATH[why]();
    if (victim) {
      victim.d++;
      fx.push({ type: 'kill', killer, victim: victim.sid, weapon, cause, hs: false });
    }
    fx.push({ type: 'planeLife', team: c.team, lives: c.lives, why });
    if (c.lives <= 0) {
      Object.assign(c, { dead: true, hp: 0 });
      fx.push({ type: 'announce', text: 'GAME OVER', sub: L(`${TEAM_NAME[c.team]} 的战机全灭`, `${TEAM_NAME[c.team]} is out of jets`), cls: 'bad', ms: 1600 });
      return;
    }
    // 新飞机：满血、带护盾、火力掉一级；坠机的爆炸把贴脸的敌机一起带走（不算击落）
    Object.assign(c, { hp: HP, shield: 1, power: Math.max(1, c.power - 1), lock: 0, charge: 0 });
    c.foes = c.foes.filter((e) => e.row < ROWS - 3);
  }

  /** 打下来的分值攒起来，按 attack 换成整架的垃圾：先抵消自己航道攒着的，剩下的送去对面。 */
  flush(fx) {
    for (const c of Object.values(this.cols)) {
      const pts = c.out;
      c.out = 0;
      if (pts <= 0 || this.phase !== 'live' || c.dead) continue;
      c.frac += pts * this.cfg.attack;
      let n = Math.floor(c.frac + 1e-9);
      if (n <= 0) continue;
      c.frac -= n;
      const cancel = Math.min(n, c.pending);
      c.pending -= cancel;
      n -= cancel;
      const foe = this.cols[OTHER[c.team]];
      if (n > 0 && !foe.dead) Object.assign(foe, { pending: Math.min(MAX_PENDING, foe.pending + n), pendFrom: c.pilot }), (c.sent += n);
      fx.push({ type: 'planeSend', from: c.team, to: OTHER[c.team], sid: c.pilot, n, cancel });
    }
  }

  // ---------------------------------------------------------------- 它在等你：及时回 = 护盾充能；超时 = 一整排小飞机贴脸 + 一波弹幕

  onAnswer(p, wait, fx) {
    const c = this.cols[p.team];
    if (!c.dead) this.item(c, p, 'S', fx);
  }

  onWaitTimeout(p, fx) {
    const c = this.cols[p.team];
    if (c.dead) return;
    const row = ROWS - 3;
    const occ = new Set(c.foes.map(cell));
    for (let l = 0; l < LANES; l++) if (!occ.has(row * LANES + l)) c.foes.push({ id: ++c.ids, kind: 'scout', hp: KIND.scout.hp, max: KIND.scout.hp, row, lane: l, age: 0, src: null, from: null });
    fx.push({ type: 'planeSwarm', team: c.team, sid: p.sid });
    this.hurt(c, p, 20, 'swarm', fx);
  }

  // ---------------------------------------------------------------- 回合

  /** 自己的定时器：拖太久进「弹幕地狱」，每 tideEvery 敌机自己压一步；再拖到两倍时长直接判。 */
  timers() {
    return [this.roundStart + this.roundLen * 2, this.roundStart + this.roundLen + this.tide * this.cfg.tideEvery];
  }

  // 到点的定时器按「该发生的时刻」结算，不看现在几点，所以时钟推进得多勤都打出一样的结果
  onTick(fx) {
    if (this.now >= this.roundStart + this.roundLen * 2) return this.endRound(this.leader(), 'time', fx, L('时间到 · 命多的赢', 'Time’s up · more lives wins'));
    while (this.now >= this.roundStart + this.roundLen + this.tide * this.cfg.tideEvery) {
      if (this.tide === 0) fx.push({ type: 'announce', text: L('弹幕地狱！', 'BULLET HELL!'), sub: L('拖太久了，敌机自己压上来', 'Too slow: the enemy pushes in on its own'), cls: 'bad', ms: 1600 });
      this.tide++;
      this.stepAll(fx);
      this.flush(fx);
      if (this.halted || TEAMS.some((t) => this.cols[t].dead)) break;
    }
  }

  /** 时间到 / 同归于尽：命多的赢，再比血，再比分。 */
  leader() {
    const [a, b] = TEAMS.map((t) => this.cols[t]);
    for (const f of [(c) => c.lives, (c) => Math.max(0, c.hp), (c) => c.score]) if (f(a) !== f(b)) return f(a) > f(b) ? 'claude' : 'codex';
    return null;
  }

  check(fx) {
    const dead = TEAMS.filter((t) => this.cols[t].dead);
    if (!dead.length) return;
    if (dead.length === 2) this.endRound(this.leader(), 'down', fx, L('两架战机同归于尽', 'Both jets went down'));
    else this.endRound(OTHER[dead[0]], 'down', fx, L(`${TEAM_NAME[dead[0]]} 的战机全灭`, `${TEAM_NAME[dead[0]]} ran out of jets`));
  }
}

// ================================================================ 画面
// 左右两条竖航道，中间一条分隔带放 VS 和「来袭」槽。敌机的格子坐标来自规则层，画面只负责让它们平滑地飞过去。

const { w: W, h: H } = WORLD;
const COL_W = 560;
const COL_X = { claude: 140, codex: 900 };
const COL_Y = 74;
const COL_B = 946;
const COL_H = COL_B - COL_Y;
const LANE_W = COL_W / LANES;
const ROW0 = COL_Y + 92;
const JET_Y = COL_B - 140;
const ROW_H = (JET_Y - 56 - ROW0) / ROWS;
const MID = 800;
const THEMES = ['sea', 'land', 'space'];
const SLOTS = [[0, 0, 1], [-80, 30, 0.72], [80, 30, 0.72], [-150, 52, 0.62], [150, 52, 0.62]]; // 编队：长机 + 僚机 [dx, dy, 缩放]
const ITEM = { P: ['P', '#ff7a3d'], B: ['B', '#3fcf6a'], H: ['❤', '#ff5c8a'], S: ['S', '#4fd6ff'] };
const SHADOW = 'rgba(0,12,24,0.26)';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const BOOM = { scout: 0.8, fighter: 1.1, bomber: 1.7, boss: 3 };
const TILE_H = 1024;
// 只需要在航道中间喊一声的效果：[文字, 颜色, 字号, 上下偏移, 持续秒数]
const BIGS = {
  planeWing: () => [L('僚机支援！', 'WINGMAN!'), '#9fffcf', 34, 60, 1.1],
  planeShield: () => [L('护盾失效', 'SHIELD DOWN'), '#7fd8ff', 32, 100, 1.2],
  planeSwarm: () => [L('被弹幕淹没！', 'SWARMED!'), '#ff5c8a', 44, 40, 1.4],
  planeBossGone: () => [L('Boss 撤退了', 'BOSS ESCAPED'), '#c9d2e0', 30, -120, 1.3],
  planeUp: () => ['1UP', '#7dff8a', 58, -120, 1.4],
};
const TAU = Math.PI * 2;
const laneX = (team, lane) => COL_X[team] + (lane + 0.5) * LANE_W;
const rowY = (row) => ROW0 + row * ROW_H;
const bossY = (row) => rowY(row) - 26;
const meterX = (team) => (team === 'claude' ? COL_X.claude + COL_W + 14 : COL_X.codex - 28);
const smooth = (k) => k * k * (3 - 2 * k);
const h01 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------- 小画笔

function lin(g, x0, y0, x1, y1, ...stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

function txt(g, s, x, y, font, color, align = 'center', family = FONT) {
  [g.font, g.fillStyle, g.textAlign, g.textBaseline] = [`${font} ${family}`, color, align, 'middle'];
  g.fillText(s, x, y);
}

function poly(g, pts, color) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (color) (g.fillStyle = color), g.fill();
}

// 左右对称的轮廓：只给右半边（从中线上的点开始、到中线上的点结束），自动镜像出左半边
function sym(half) {
  const out = half.slice();
  for (let i = half.length - 4; i >= 2; i -= 2) out.push(-half[i], half[i + 1]);
  return out;
}

function box(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function dot(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

function oval(g, x, y, rx, ry, color) {
  g.fillStyle = color;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
}

function glow(g, x, y, r, inner, outer) {
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, inner);
  rg.addColorStop(1, outer);
  dot(g, x, y, r, rg);
}

function seg(g, color, lw, ...pts) {
  [g.strokeStyle, g.lineWidth] = [color, lw];
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) g.moveTo(pts[i], pts[i + 1]), g.lineTo(pts[i + 2], pts[i + 3]);
  g.stroke();
}

// ---------------------------------------------------------------- 飞机造型

/** 我方战机：机头朝上，翼尖和机身中线刷队伍色。o.solid 给整架涂一个颜色（影子、受击闪红）。 */
function drawJet(g, x, y, s, team, o = {}) {
  const sol = o.solid;
  g.save(); g.translate(x, y); g.scale(s, s);
  if (!sol) {
    const fl = 12 + Math.sin((o.rt || 0) * 40 + x) * 3; // 尾焰
    for (const ex of [-6, 6]) {
      g.fillStyle = lin(g, 0, 24, 0, 24 + fl * 1.6, '#fff6c0', '#ffb347', 'rgba(255,80,20,0)');
      g.beginPath(); g.moveTo(ex - 4, 24); g.quadraticCurveTo(ex, 24 + fl * 1.8, ex + 4, 24); g.fill();
    }
  }
  poly(g, sym([0, -9, 34, 14, 34, 20, 8, 16, 0, 16]), sol || lin(g, -34, 0, 34, 0, '#8e98a3', '#eef1f5', '#8e98a3'));
  poly(g, sym([0, 15, 15, 27, 15, 31, 0, 31]), sol || '#b9c1ca');
  g.fillStyle = sol || lin(g, -7, 0, 7, 0, '#8a949f', '#f6f8fb', '#8a949f');
  g.beginPath(); g.moveTo(0, -38); g.bezierCurveTo(5, -30, 7, -16, 7, 0); g.lineTo(6, 26); g.lineTo(-6, 26); g.lineTo(-7, 0); g.bezierCurveTo(-7, -16, -5, -30, 0, -38); g.fill();
  if (sol) return g.restore();
  [g.strokeStyle, g.lineWidth] = ['rgba(20,24,30,0.55)', 1.2];
  g.stroke();
  // 队伍色：翼尖、翼上条纹、机鼻、机身中线
  for (const sx of [-1, 1]) {
    poly(g, [sx * 34, 14, sx * 25, 6.5, sx * 23, 9.5, sx * 34, 18.5], COLOR[team]);
    poly(g, [sx * 11, 3, sx * 26, 12.5, sx * 26, 15.5, sx * 11, 7], COLOR[team]);
  }
  poly(g, [0, -38, 2.6, -31, -2.6, -31], COLOR[team]);
  box(g, -1.5, -4, 3, 28, DEEP[team]);
  g.fillStyle = '#59626d';
  for (const sx of [-1, 1]) g.fillRect(sx * 18 - 1.5, 7, 3, 11); // 导弹挂架
  oval(g, 0, -17, 3.6, 9, lin(g, 0, -26, 0, -8, '#c8f6ff', '#2a8fd6', '#0b2c55')); // 座舱
  oval(g, -1.2, -20, 1, 3.5, 'rgba(255,255,255,0.75)');
  if (o.muzzle) for (const [mx, my, r] of [[0, -42, 7], [-18, 4, 5], [18, 4, 5]]) glow(g, mx, my, r, 'rgba(255,250,200,0.95)', 'rgba(255,200,80,0)');
  g.restore();
}

// 敌机机头朝下（往我方飞）。tint = 对面送来的垃圾，用对面的队伍色涂装
function scoutShape(g, o) {
  const sol = o.solid;
  poly(g, sym([0, -3, 20, -6, 20, 1, 5, 6, 0, 6]), sol || '#5b8a3a');
  poly(g, sym([0, -19, 8, -19, 8, -14, 0, -12]), sol || '#5b8a3a');
  oval(g, 0, 0, 5.5, 18, sol || lin(g, -6, 0, 6, 0, '#6f9f45', '#bfe57f', '#6f9f45'));
  if (sol) return;
  for (const sx of [-12, 12]) dot(g, sx, -1.5, 2.8, o.tint || '#d8443a');
  oval(g, 0, 6, 2.4, 4, '#ffe066');
  const a = Math.cos((o.rt || 0) * 40) * 7; // 螺旋桨
  seg(g, 'rgba(30,30,30,0.6)', 1.5, a, 18, -a, 18);
}

function fighterShape(g, o) {
  const sol = o.solid;
  poly(g, sym([0, 25, 6, 9, 27, -8, 27, -14, 7, -10, 5, -21, 0, -21]), sol || '#3c4552');
  if (sol) return;
  poly(g, sym([0, 25, 6, 9, 5, -21, 0, -21]), lin(g, -6, 0, 6, 0, '#4b5563', '#9aa5b4', '#4b5563'));
  for (const sx of [-1, 1]) poly(g, [sx * 11, -1, sx * 25, -9.5, sx * 25, -12.5, sx * 11, -5], o.tint || '#e04848');
  oval(g, 0, 9, 2.6, 5.5, '#ff9f80');
  for (const sx of [-3, 3]) glow(g, sx, -23, 5, 'rgba(255,220,140,0.95)', 'rgba(255,120,40,0)');
}

function bomberShape(g, o) {
  const sol = o.solid;
  poly(g, sym([0, 9, 46, 3, 48, -3, 44, -7, 0, -9]), sol || '#5f4f3b');
  poly(g, sym([0, -27, 18, -31, 18, -36, 0, -35]), sol || '#5f4f3b');
  oval(g, 0, -2, 9, 37, sol || lin(g, -9, 0, 9, 0, '#6e5d45', '#b8a27c', '#6e5d45'));
  if (sol) return;
  for (const ex of [-31, -16, 16, 31]) {
    box(g, ex - 4, -4, 8, 15, '#463a2b');
    oval(g, ex, 13, 8, 1.5 + Math.abs(Math.sin((o.rt || 0) * 30 + ex)) * 1.8, 'rgba(30,30,30,0.35)'); // 转动的螺旋桨
  }
  g.fillStyle = o.tint || '#2d2a24';
  for (const sx of [-1, 1]) g.fillRect(sx > 0 ? 37 : -43, -5, 6, 9);
  oval(g, 0, 30, 5, 6, '#9fd8ff');
  dot(g, 0, -12, 3.5, '#2b2f36');
}

const SHAPES = { scout: scoutShape, fighter: fighterShape, bomber: bomberShape };

function drawFoe(g, x, y, kind, o = {}) {
  g.save(); g.translate(x, y);
  if (o.s) g.scale(o.s, o.s);
  if (o.rot) g.rotate(o.rot);
  SHAPES[kind](g, o);
  if (o.flash) (g.globalAlpha = 0.7), SHAPES[kind](g, { solid: '#ffffff' }), (g.globalAlpha = 1);
  g.restore();
}

const BOSS_HULL = sym([0, 80, 48, 46, 132, 32, 158, -8, 96, -48, 56, -68, 0, -68]);

/** 巨大战舰：舰首朝下，四个炮塔转着瞄你，中间的红色核心一闪一闪。 */
function drawBoss(g, x, y, o = {}) {
  const rt = o.rt || 0;
  g.save(); g.translate(x, y);
  poly(g, BOSS_HULL, o.solid || lin(g, -160, 0, 160, 0, '#262b34', '#5d6676', '#262b34'));
  if (o.solid) return g.restore();
  [g.strokeStyle, g.lineWidth] = ['rgba(0,0,0,0.6)', 2];
  g.stroke();
  seg(g, 'rgba(255,255,255,0.09)', 1.5, 48, 46, 56, -68, -48, 46, -56, -68, 96, -48, 132, 32, -96, -48, -132, 32); // 装甲接缝
  poly(g, sym([0, 56, 30, 30, 34, -40, 0, -52]), '#3b4250');
  for (const ex of [-74, -30, 30, 74]) {
    const fl = 7 + Math.sin(rt * 30 + ex) * 2;
    glow(g, ex, -70 - fl / 2, 9 + fl, 'rgba(200,240,255,0.95)', 'rgba(80,180,255,0)');
  }
  const pulse = Math.round(120 + 100 * (0.55 + 0.45 * Math.sin(rt * 6)));
  glow(g, 0, 8, 28, `rgba(255,${pulse},${pulse},1)`, 'rgba(255,0,0,0)');
  for (const [tx, ty] of [[-108, 2], [108, 2], [-58, 30], [58, 30]]) {
    const a = Math.PI / 2 + Math.sin(rt * 1.7 + tx) * 0.6;
    dot(g, tx, ty, 12, '#1d2128');
    seg(g, '#8a93a3', 5, tx, ty, tx + Math.cos(a) * 21, ty + Math.sin(a) * 21);
    dot(g, tx, ty, 4, '#c0392b');
  }
  if (o.flash) (g.globalAlpha = 0.55), poly(g, BOSS_HULL, '#ffffff'), (g.globalAlpha = 1);
  g.restore();
}

// ---------------------------------------------------------------- 背景：每种地形预先画一张能无缝接起来的长图，滚着放

const TILES = {};
function tile(theme) {
  if (TILES[theme]) return TILES[theme];
  const S = 1.5;
  const cv = document.createElement('canvas');
  [cv.width, cv.height] = [COL_W * S, TILE_H * S];
  const g = cv.getContext('2d');
  g.scale(S, S);
  const r = rng(hash(`plane-bg-${theme}`));
  const each = (fn) => [-TILE_H, 0, TILE_H].forEach(fn); // 上下接缝处各多画一份
  ({ sea: paintSea, land: paintLand, space: paintSpace })[theme](g, r, each);
  return (TILES[theme] = cv);
}

/** 海：深浅不一的水色、浪花、三座小岛（浅滩 → 沙滩 → 草地 → 树）。 */
function paintSea(g, r, each) {
  box(g, 0, 0, COL_W, TILE_H, '#145a8a');
  for (let i = 0; i < 14; i++) {
    const [x, y, rad, col] = [r() * COL_W, r() * TILE_H, 60 + r() * 120, r() < 0.5 ? 'rgba(8,45,85,0.4)' : 'rgba(50,140,180,0.28)'];
    each((dy) => glow(g, x, y + dy, rad, col, 'rgba(0,0,0,0)'));
  }
  [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.14)', 1.5];
  for (let i = 0; i < 170; i++) {
    const [x, y, w] = [r() * COL_W, r() * TILE_H, 6 + r() * 14];
    each((dy) => (g.beginPath(), g.moveTo(x, y + dy), g.quadraticCurveTo(x + w / 2, y + dy - 3, x + w, y + dy), g.stroke()));
  }
  for (let i = 0; i < 3; i++) {
    const [x, y, s] = [70 + r() * (COL_W - 140), (i + r() * 0.6) * (TILE_H / 3), 36 + r() * 40];
    const parts = Array.from({ length: 6 }, () => [(r() - 0.5) * s * 1.4, (r() - 0.5) * s, s * (0.45 + r() * 0.35)]);
    const trees = Array.from({ length: 12 }, () => [(r() - 0.5) * s * 0.9, (r() - 0.5) * s * 0.6]);
    each((dy) => {
      for (const [col, grow] of [['rgba(110,215,220,0.35)', 22], ['#e8d79c', 8], ['#4f9a43', -4]]) {
        g.fillStyle = col;
        g.beginPath();
        for (const [px, py, pr] of parts) g.moveTo(x + px + Math.max(4, pr + grow), y + py + dy), g.arc(x + px, y + py + dy, Math.max(4, pr + grow), 0, TAU);
        g.fill();
      }
      for (const [tx, ty] of trees) dot(g, x + tx, y + ty + dy, 4, '#2f6e2c');
    });
  }
}

/** 陆地：田块、一条河、一条公路、树林和红顶小房子。 */
function paintLand(g, r, each) {
  box(g, 0, 0, COL_W, TILE_H, '#4d7a3c');
  const FIELD = ['#5f8f45', '#7d9c4c', '#a8a65a', '#43703a', '#8f7d4e', '#6e9a52'];
  for (let i = 0; i < 28; i++) {
    const [x, y, w, h, a, col] = [r() * COL_W, r() * TILE_H, 60 + r() * 110, 40 + r() * 90, (r() - 0.5) * 0.3, FIELD[Math.floor(r() * FIELD.length)]];
    each((dy) => {
      g.save(); g.translate(x, y + dy); g.rotate(a);
      box(g, -w / 2, -h / 2, w, h, col);
      g.fillStyle = 'rgba(255,255,255,0.06)'; // 田垄
      for (let k = -h / 2 + 6; k < h / 2; k += 7) g.fillRect(-w / 2, k, w, 1);
      [g.strokeStyle, g.lineWidth] = ['rgba(40,60,25,0.4)', 2];
      g.strokeRect(-w / 2, -h / 2, w, h);
      g.restore();
    });
  }
  // 河和公路：周期整除长图高度的正弦线，接缝无缝
  const curve = (cx, amp, k) => (y) => cx + Math.sin((y / TILE_H) * TAU * k) * amp;
  const [river, road] = [curve(COL_W * (0.3 + r() * 0.2), 50 + r() * 30, 2), curve(COL_W * 0.78, 30, 1)];
  for (const [fx, col, lw, dash] of [[river, '#c9b77a', 48], [river, '#2f6fa3', 36], [river, 'rgba(150,210,245,0.35)', 10], [road, '#5a5d61', 16], [road, 'rgba(255,255,255,0.6)', 2, [14, 12]]]) {
    [g.strokeStyle, g.lineWidth] = [col, lw];
    g.setLineDash(dash || []);
    g.beginPath();
    for (let y = -20; y <= TILE_H + 20; y += 16) g.lineTo(fx(y), y);
    g.stroke();
  }
  g.setLineDash([]);
  for (let i = 0; i < 140; i++) {
    const [x, y, s] = [r() * COL_W, r() * TILE_H, 3 + r() * 4];
    each((dy) => (dot(g, x, y + dy, s, '#2c5a27'), dot(g, x - s * 0.3, y + dy - s * 0.3, s * 0.45, 'rgba(160,220,120,0.35)')));
  }
  for (let i = 0; i < 12; i++) {
    const [x, y] = [r() * COL_W, r() * TILE_H];
    each((dy) => {
      box(g, x - 7, y + dy - 5, 14, 10, '#e9e1cf');
      box(g, x - 8, y + dy - 6, 16, 5, '#b5482f');
    });
  }
}

/** 太空：星云、远处的星星、一颗带光环的行星（近处的星星每帧画，有视差）。 */
function paintSpace(g, r, each) {
  box(g, 0, 0, COL_W, TILE_H, '#060818');
  const NEB = ['rgba(140,60,200,0.2)', 'rgba(40,150,180,0.16)', 'rgba(60,80,220,0.18)', 'rgba(200,60,120,0.14)'];
  for (let i = 0; i < 6; i++) {
    const [x, y, rad] = [r() * COL_W, r() * TILE_H, 120 + r() * 160];
    each((dy) => glow(g, x, y + dy, rad, NEB[i % NEB.length], 'rgba(0,0,0,0)'));
  }
  for (let i = 0; i < 280; i++) {
    const [x, y, s, a] = [r() * COL_W, r() * TILE_H, r() < 0.9 ? 1 : 2, 0.25 + r() * 0.6];
    each((dy) => ((g.fillStyle = `rgba(255,255,255,${a})`), g.fillRect(x, y + dy, s, s)));
  }
  const [px, py, pr] = [80 + r() * (COL_W - 160), r() * TILE_H, 46 + r() * 30];
  each((dy) => {
    dot(g, px, py + dy, pr, lin(g, px - pr, py + dy - pr, px + pr, py + dy + pr, '#f0b37a', '#a8553a', '#2a1410'));
    [g.strokeStyle, g.lineWidth] = ['rgba(240,210,170,0.55)', 4];
    g.beginPath(); g.ellipse(px, py + dy, pr * 1.8, pr * 0.42, -0.3, 0, TAU); g.stroke();
  });
}

function cloud(g, x, y, s, alpha) {
  g.fillStyle = `rgba(255,255,255,${alpha})`;
  g.beginPath();
  for (const [dx, dy, k] of [[0, 0, 1], [-0.85, 0.2, 0.7], [0.85, 0.15, 0.75], [-0.35, -0.38, 0.72], [0.38, -0.3, 0.66], [0.1, 0.35, 0.7]]) g.moveTo(x + dx * s + k * s, y + dy * s), g.arc(x + dx * s, y + dy * s, k * s, 0, TAU);
  g.fill();
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
    this.cols = {};
    for (const team of TEAMS) {
      const cx = COL_X[team] + COL_W / 2;
      this.cols[team] = { foes: new Map(), boss: null, gx: cx, tx: cx, wander: 0, hitT: 0, flash: 0, bombT: 0, nukeT: 0, lockT: 0, shieldT: 0, respawn: 0, wingIn: 1, muzzle: new Map(), bigs: [] };
    }
    this.clearAir();
    Object.assign(this, { wrecks: [], debris: [], pops: [], labels: new Map(), jetIn: new Map(), warn: null, over: null });
    if (R?.cols) for (const team of TEAMS) this.sync(R, team, true);
  }

  /** 新的一局：天上飞着的子弹、胶囊、垃圾全清掉（爆炸和粒子留着演完）。 */
  clearAir() {
    Object.assign(this, { shots: [], bullets: [], beams: [], items: [], flights: [] });
  }

  /** 让画面里的敌机跟上规则层：新来的从顶上（垃圾从中线那边）飞进来，没了的直接拿掉（爆炸另外演）。 */
  sync(R, team, snap) {
    const c = R.cols?.[team];
    const cv = this.cols[team];
    if (!c) return;
    const seen = new Set();
    for (const e of c.foes) {
      seen.add(e.id);
      const [tx, ty] = [laneX(team, e.lane), rowY(e.row)];
      let d = cv.foes.get(e.id);
      if (!d) {
        const side = team === 'claude' ? COL_X.claude + COL_W + 30 : COL_X.codex - 30;
        cv.foes.set(e.id, (d = { kind: e.kind, src: e.src, hp: e.hp, max: e.max, flash: 0, x: snap || !e.src ? tx : side, y: snap ? ty : e.src ? COL_Y + 30 : COL_Y - 40 }));
      }
      if (e.hp < d.hp) d.flash = 0.12;
      Object.assign(d, { hp: e.hp, tx, ty }, snap ? { x: tx, y: ty } : {});
    }
    for (const id of cv.foes.keys()) if (!seen.has(id)) cv.foes.delete(id);
    if (!c.boss) return void (cv.boss = null);
    if (!cv.boss) cv.boss = { x: laneX(team, 2), y: snap ? bossY(c.boss.row) : COL_Y - 140, flash: 0, hp: c.boss.hp };
    if (c.boss.hp < cv.boss.hp) cv.boss.flash = 0.1;
    Object.assign(cv.boss, { tx: laneX(team, 2), ty: bossY(c.boss.row), hp: c.boss.hp });
  }

  /** 在场的会话排成编队：第一个是长机，其余是僚机。新上场的从下面飞进来，掉命后新飞机从下面升上来。 */
  jets(R, team) {
    const c = R.cols?.[team];
    if (!c || c.dead || !R.field) return [];
    const cv = this.cols[team];
    const rt = this.app.rt();
    return R.field(team).slice(0, SLOTS.length).map((p, i) => {
      const [dx, dy, s] = SLOTS[i];
      const intro = 1 - (this.jetIn.get(p.sid) ?? 1);
      return { p, s, x: clamp(cv.gx + dx, COL_X[team] + 30, COL_X[team] + COL_W - 30), y: JET_Y + dy + Math.sin(rt * 2.2 + i * 1.3) * 3 + intro * intro * 200 + cv.respawn * 140 };
    });
  }

  jetOf(R, team, sid) {
    const js = this.jets(R, team);
    return js.find((j) => j.p.sid === sid) || js[0] || null;
  }

  hitPos(team, h) {
    const cv = this.cols[team];
    if (h.id === 'boss') return cv.boss ? [cv.boss.x, cv.boss.y + 20] : [laneX(team, 2), bossY(h.row)];
    const d = cv.foes.get(h.id);
    return d ? [d.x, d.y] : [laneX(team, h.lane), rowY(h.row)];
  }

  big(team, text, color, size = 44, dy = 0, life = 1.3) {
    const bigs = this.cols[team].bigs;
    if (bigs.length > 5) bigs.shift();
    bigs.push({ text, color, size, dy, life, t: 0 });
  }

  /** 爆炸：火球 + 卡通星形爆闪（微信飞机大战那种）+ 四散的碎片。 */
  boom(x, y, size = 1, color = '#9aa3ad') {
    const { fx } = this;
    fx.ring(x, y, 4, 26 * size + 18, 'rgba(255,190,90,0.9)', 0.32 + size * 0.08, 3 + size * 2);
    fx.sparks(x, y, '#ffd27a', Math.round(4 + size * 5), 80 + size * 70);
    fx.smoke(x, y, Math.round(2 + size * 3), 7 + size * 5, 'rgba(70,60,55,0.5)');
    if (this.pops.length < 40) this.pops.push({ x, y, s: 12 + size * 14, t: 0, dur: 0.22 + size * 0.06, a: rand(0, 1) });
    for (let i = 0; i < 3 + size * 4 && this.debris.length < 180; i++) {
      const [a, v] = [rand(0, TAU), rand(50, 190) * (0.6 + size * 0.3)];
      this.debris.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rand(0, 6), vr: rand(-12, 12), w: rand(3, 7) * (0.7 + size * 0.3), h: rand(2, 4), color: Math.random() < 0.5 ? color : '#3b3f46', life: rand(0.5, 0.9), max: 0.9 });
    }
    if (this.app.sfx.ok(1)) this.app.sfx.burst(0.1 + size * 0.1, 520 - size * 70, 0.16 + size * 0.06);
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    for (const f of list) {
      const cv = f.team ? this.cols[f.team] : null;
      const jet = f.team && f.type !== 'planeVolley' ? this.jetOf(R, f.team, f.sid) : null;
      switch (f.type) {
        case 'act': {
          const text = f.ev.k !== 'think' && actText(f.ev);
          if (R.players.get(f.sid)?.onField && text && !(busy && f.ev.k === 'read')) this.labels.set(f.sid, { text, life: 1.6, bad: f.ev.ok === false });
          break;
        }
        case 'join': if (!busy) this.jetIn.set(f.sid, 0); break;
        case 'planeReset':
          for (const team of TEAMS) Object.assign(this.cols[team], { foes: new Map(), boss: null, respawn: 0, bombT: 0, nukeT: 0 });
          this.clearAir();
          break;
        case 'planeVolley': this.volleyFx(R, f, busy); break;
        case 'planeKill': {
          // 先记下被打中那架的位置，子弹飞到了再炸
          const d = f.id === 'boss' ? cv.boss : cv.foes.get(f.id);
          const [x, y] = d ? [d.x, d.y] : f.id === 'boss' ? [laneX(f.team, 2), bossY(f.row)] : [laneX(f.team, f.lane), rowY(f.row)];
          if (busy) break;
          if (this.wrecks.length > 40) this.wrecks.shift();
          this.wrecks.push({ team: f.team, kind: f.kind, src: f.src, x, y, pts: f.pts, t: f.kind === 'boss' ? -0.05 : -0.14, max: f.kind === 'boss' ? 1.8 : 0.3 });
          break;
        }
        case 'planeCrash': {
          // 冲过底线的敌机一头扎向战机
          const d = cv.foes.get(f.id);
          cv.hitT = 0.3;
          if (busy || !jet) break;
          const [x, y] = d ? [d.x, d.y] : [laneX(f.team, f.lane), rowY(ROWS - 1)];
          this.wrecks.push({ team: f.team, kind: f.kind, src: f.src, x, y, x2: jet.x + rand(-12, 12), y2: jet.y - 10, t: -0.22, dive: 0.22, max: 0.3, ram: true });
          break;
        }
        case 'planeBossGone':
          if (cv.boss && !busy) this.wrecks.push({ team: f.team, kind: 'boss', x: cv.boss.x, y: cv.boss.y, t: 0, max: 1.4, flee: true, boomed: true });
          break;
        case 'planeHit': this.hitFx(f, jet, busy); break;
        case 'planeLife': {
          const [x, y] = jet ? [jet.x, jet.y] : [COL_X[f.team] + COL_W / 2, JET_Y];
          app.sfx.boom(true);
          if (busy) break;
          this.boom(x, y, 2.6, COLOR[f.team]);
          for (let i = 0; i < 4; i++) app.later(0.12 * (i + 1), () => this.boom(x + rand(-40, 40), y + rand(-40, 30), 1.2, COLOR[f.team]));
          app.shake(0.45, 9);
          if (f.lives > 0) this.big(f.team, L(`被击落！还剩 ${f.lives} 条命`, `SHOT DOWN! ${f.lives} left`), '#ff6b6b', 32, 140, 1.5), (cv.respawn = 1.1);
          break;
        }
        case 'planeUp': if (!busy && app.sfx.ok(2)) [784, 988, 1175, 1568].forEach((hz, i) => app.sfx.tone(hz, 0.12, 0.1, 'square', null, i * 0.08)); break;
        case 'planeBomb':
        case 'planeNuke': {
          const nuke = f.type === 'planeNuke';
          [cv.bombT, cv.nukeT, cv.flash] = nuke ? [cv.bombT, 1.6, 0.9] : [0.9, cv.nukeT, 0.45];
          app.sfx.boom(true);
          if (busy) break;
          if (nuke) this.big(f.team, L('核弹！', 'NUKE!'), '#ffd166', 76, -40, 1.8);
          else this.big(f.team, f.why === 'panic' ? L('自动炸弹！', 'AUTO BOMB!') : L('全屏炸弹！', 'BOMB!'), '#ffffff', f.why === 'panic' ? 40 : 70, -60, 1.3);
          app.shake(nuke ? 0.8 : 0.45, nuke ? 14 : 9);
          break;
        }
        case 'planeItem': {
          if (f.max) this.big(f.team, L('火力全开！', 'MAX POWER!'), '#ffd166', 48, -150, 1.4);
          if (busy || !jet || this.items.length > 24) break;
          const [x, y] = f.lane != null ? [laneX(f.team, f.lane), rowY(f.row)] : [COL_X[f.team] + rand(80, COL_W - 80), COL_Y + 70];
          this.items.push({ team: f.team, sid: f.sid, item: f.item, x, y, t: f.lane != null ? -0.25 : 0, dur: 0.9, a: rand(0, 6) });
          break;
        }
        case 'planeLock': cv.lockT = 0.7; break;
        case 'planeCharge': if (jet && !busy) fx.text(jet.x, jet.y - 60, L('⚡ 蓄力完成', '⚡ CHARGED'), '#7fe8ff', 14, 1); break;
        case 'planeWing': cv.wingIn = 0; break;
        case 'planeShield': cv.shieldT = 0.8; break;
        case 'planeWarn':
          this.warn = { t: 0, dur: busy ? 1 : 3 };
          if (!busy && app.sfx.ok(2)) for (let i = 0; i < 6; i++) app.sfx.tone(i % 2 ? 620 : 880, 0.22, 0.1, 'square', null, i * 0.26); // 警报
          break;
        case 'planeSend':
          for (let i = 0; !busy && i < Math.min(f.n, 8) && this.flights.length < 60; i++) {
            this.flights.push({ from: f.from, x1: laneX(f.from, rand(0.5, 3.5)), y1: rand(ROW0 + 40, ROW0 + 260), x2: laneX(f.to, Math.floor(rand(0, LANES))), y2: COL_Y + 40, t: -i * 0.08, dur: 0.9 });
          }
          if (f.cancel && !busy) fx.text(meterX(f.from) + 7, 520, L(`🛡 抵消 ${f.cancel}`, `🛡 Blocked ${f.cancel}`), '#9fd0ff', 13, 1.1);
          break;
        case 'roundEnd': this.over = { winner: f.winner, t: 0, dur: busy ? 0.8 : 2.8 }; break;
      }
      const b = !busy && f.team && BIGS[f.type];
      if (b) this.big(f.team, ...b());
    }
  }

  /** 一轮齐射：发光弹丸 / 追踪导弹 / 激光，从开火的那架飞机打向目标。 */
  volleyFx(R, f, busy) {
    const { app, fx } = this;
    const cv = this.cols[f.team];
    const jet = this.jetOf(R, f.team, f.sid);
    if (jet) cv.muzzle.set(jet.p.sid, 0.08);
    if (f.hits.length && f.hits[0].id !== 'boss') [cv.tx, cv.wander] = [laneX(f.team, f.hits[0].lane), 1.4]; // 编队滑到目标那一列
    if (f.kind === 'missile') app.sfx.ok(1) && app.sfx.tone(260, 0.3, 0.06, 'sawtooth', 900);
    else if (f.kind !== 'bomb' && f.kind !== 'nuke') app.sfx.shot(f.kind === 'vulcan' ? 'Glock-18' : 'M4A4');
    if (busy || !jet || this.shots.length > 220) return;
    const hits = f.hits.slice(0, 10);
    const [gx, gy] = [jet.x, jet.y - 34 * jet.s];
    hits.forEach((h, i) => {
      const [tx, ty] = this.hitPos(f.team, h);
      if (f.kind === 'missile') {
        const side = i % 2 ? 1 : -1;
        this.shots.push({ kind: 'missile', team: f.team, x1: jet.x + side * 16, y1: jet.y, cx: jet.x + side * 150, cy: jet.y - 40, x2: tx, y2: ty, t: -i * 0.07, dur: 0.55 });
      } else if (['shot', 'vulcan', 'wing', 'wave'].includes(f.kind)) {
        const n = f.kind === 'vulcan' ? 1 : 2;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * 9;
          this.shots.push({ kind: f.kind === 'wave' ? 'wave' : 'pellet', team: f.team, x1: gx + off, y1: gy, x2: tx + off * 0.6, y2: ty, t: -k * 0.03 - i * 0.02, dur: 0.12 + Math.abs(gy - ty) / 4500, crit: f.crit, small: f.kind === 'vulcan', wing: f.kind === 'wing' });
        }
      }
      if (h.dmg && !h.kill && hits.length <= 6) fx.text(tx + rand(-8, 8), ty - 16, `-${h.dmg}`, f.crit ? '#ffe066' : '#ffffff', 12, 0.6);
    });
    if (!hits.length && (f.kind === 'shot' || f.kind === 'vulcan')) this.shots.push({ kind: 'pellet', team: f.team, x1: gx, y1: gy, x2: gx + rand(-40, 40), y2: COL_Y, t: 0, dur: 0.3, small: true }); // 没目标：朝天放空枪
    if (f.beam != null) {
      this.beams.push({ team: f.team, x: laneX(f.team, f.beam), y: gy, t: 0, dur: 0.5 });
      app.shake(0.15, 3);
      if (app.sfx.ok(2)) app.sfx.tone(180, 0.45, 0.12, 'sawtooth', 1400);
    }
    if (f.crit && hits.length) {
      const [tx, ty] = this.hitPos(f.team, hits[0]);
      fx.text(tx, ty - 32, L('暴击！', 'CRIT!'), '#ffe066', 18, 0.9);
    }
    if (f.kind === 'wave') this.big(f.team, L('歼灭波', 'KILL WAVE'), '#7fffd4', 36, -20, 1.1);
  }

  /** 战机挨打：子弹从上面（或 Boss 的炮塔）射下来，打中了闪红 / 护盾挡下。 */
  hitFx(f, jet, busy) {
    const cv = this.cols[f.team];
    if (!jet) return;
    if (busy || f.why === 'crash' || this.bullets.length > 150) return this.impact(f, jet);
    const n = { boss: 7, swarm: 14, net: 1 }[f.why] || 3;
    const [x1, y1] = f.why === 'boss' && cv.boss ? [cv.boss.x, cv.boss.y + 50] : [clamp(jet.x + rand(-170, 170), COL_X[f.team] + 20, COL_X[f.team] + COL_W - 20), ROW0 + rand(0, 160)];
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * (f.why === 'boss' ? 22 : 14);
      this.bullets.push({ team: f.team, x1: f.why === 'swarm' ? COL_X[f.team] + rand(20, COL_W - 20) : x1, y1, x2: jet.x + spread, y2: jet.y + rand(-8, 8), t: -i * 0.035, dur: 0.42, hit: i === n - 1 ? { f, sid: jet.p.sid } : null });
    }
  }

  impact(f, jet) {
    const { app, fx } = this;
    if (f.shield) {
      fx.ring(jet.x, jet.y, 44, 70, 'rgba(110,220,255,0.95)', 0.45, 5);
      fx.text(jet.x, jet.y - 60, L('🛡 护盾挡下', '🛡 Shield!'), '#9fe8ff', 15, 1);
      if (app.sfx.ok(1)) app.sfx.tone(1300, 0.12, 0.08, 'triangle', 600);
      return;
    }
    if (!f.dmg) return;
    this.cols[f.team].hitT = 0.3;
    fx.sparks(jet.x, jet.y - 10, '#ff8a6a', 8, 150);
    fx.smoke(jet.x, jet.y, 3, 9, 'rgba(90,90,90,0.5)');
    fx.text(jet.x + rand(-10, 10), jet.y - 56, `${{ net: '📡 ', bug: '🐛 ' }[f.why] || ''}-${f.dmg}`, '#ff6b6b', 16, 1);
    app.sfx.bite();
  }

  update(dt, R) {
    const rt = this.app.rt();
    const ease = (k) => Math.min(1, dt * k);
    for (const team of TEAMS) {
      const cv = this.cols[team];
      this.sync(R, team, false);
      for (const d of cv.foes.values()) [d.x, d.y, d.flash] = [d.x + (d.tx - d.x) * ease(6), d.y + (d.ty - d.y) * ease(5), Math.max(0, d.flash - dt)];
      const b = cv.boss;
      if (b) [b.x, b.y, b.flash] = [b.tx + Math.sin(rt * 0.9) * 36, b.y + (b.ty - b.y) * ease(1.6), Math.max(0, b.flash - dt)];
      // 编队：开火时滑到目标那一列，没事就左右晃悠
      if ((cv.wander -= dt) <= 0) [cv.wander, cv.tx] = [rand(1.6, 3.2), COL_X[team] + rand(0.25, 0.75) * COL_W];
      cv.gx += (cv.tx - cv.gx) * ease(2.5);
      for (const k of ['hitT', 'flash', 'bombT', 'nukeT', 'lockT', 'shieldT', 'respawn']) cv[k] = Math.max(0, cv[k] - dt);
      cv.wingIn = Math.min(1, cv.wingIn + dt * 1.4);
      for (const [sid, m] of cv.muzzle) (m <= dt ? cv.muzzle.delete(sid) : cv.muzzle.set(sid, m - dt));
      for (const x of cv.bigs) x.t += dt;
      cv.bigs = cv.bigs.filter((x) => x.t < x.life);
    }
    for (const [sid, t] of this.jetIn) (t + dt >= 1 ? this.jetIn.delete(sid) : this.jetIn.set(sid, t + dt * 1.6));
    for (const [sid, l] of this.labels) if ((l.life -= dt) <= 0) this.labels.delete(sid);
    for (const s of this.shots) {
      if ((s.t += dt) > 0 && s.t < s.dur && s.kind === 'missile') this.fx.smoke(...this.shotPos(s, s.t / s.dur), 1, 4, 'rgba(225,225,225,0.45)'); // 导弹尾烟
      if (s.t < s.dur) continue;
      s.done = true;
      if (s.kind === 'missile') this.boom(s.x2, s.y2, 0.5, '#ffb347');
      else this.fx.sparks(s.x2, s.y2, s.crit ? '#ffe066' : COLOR[s.team], 3, 90);
    }
    for (const b of this.bullets) {
      if ((b.t += dt) < b.dur) continue;
      b.done = true;
      const jet = b.hit && this.jetOf(R, b.hit.f.team, b.hit.sid);
      if (jet) this.impact(b.hit.f, jet);
    }
    for (const w of this.wrecks) {
      if ((w.t += dt) >= 0 && !w.boomed) {
        w.boomed = true;
        const [x, y] = [w.x2 ?? w.x, w.y2 ?? w.y];
        this.boom(x, y, BOOM[w.kind] || 1, w.src ? COLOR[w.src] : '#7d8a5a');
        if (w.pts && !w.ram) this.fx.text(x, y - 18, `+${w.pts}`, w.kind === 'boss' ? '#ffd166' : '#ffffff', w.kind === 'boss' ? 26 : 13, 0.9);
        if (w.kind === 'boss') this.app.shake(0.7, 12);
      }
      if (w.kind === 'boss' && !w.flee && Math.random() < dt * 12) this.boom(w.x + rand(-130, 130), w.y + rand(-50, 60), 1.3, '#5d6676'); // Boss 连环爆炸
    }
    for (const it of this.items) {
      if ((it.t += dt) < it.dur) continue;
      it.done = true;
      const jet = this.jetOf(R, it.team, it.sid);
      if (!jet) continue;
      const [ch, col] = ITEM[it.item];
      const word = { P: L('火力升级', 'POWER UP'), B: L('炸弹 +1', 'BOMB +1'), H: L('修理 +40', 'REPAIR +40'), S: L('护盾充能', 'SHIELD UP') }[it.item];
      this.fx.ring(jet.x, jet.y, 10, 56, col, 0.45, 4);
      this.fx.text(jet.x, jet.y - 62, `${ch} ${word}`, col, 15, 1.1);
      if (this.app.sfx.ok(1)) [660, 880, 1320].forEach((hz, i) => this.app.sfx.tone(hz, 0.08, 0.08, 'square', null, i * 0.05));
    }
    for (const arr of [this.flights, this.beams, this.pops]) for (const x of arr) x.t += dt;
    for (const q of this.debris) [q.x, q.y, q.r, q.life, q.vx, q.vy] = [q.x + q.vx * dt, q.y + q.vy * dt, q.r + q.vr * dt, q.life - dt, q.vx * 0.94, q.vy * 0.94];
    const keep = (arr, f) => arr.filter(f);
    [this.shots, this.bullets, this.items] = [this.shots, this.bullets, this.items].map((arr) => keep(arr, (x) => !x.done));
    [this.flights, this.beams, this.pops] = [this.flights, this.beams, this.pops].map((arr) => keep(arr, (x) => x.t < x.dur));
    this.wrecks = keep(this.wrecks, (w) => w.t < w.max);
    this.debris = keep(this.debris, (q) => q.life > 0);
    this.fx.update(dt);
    if (this.warn && (this.warn.t += dt) >= this.warn.dur) this.warn = null;
    if (this.over && (this.over.t += dt) >= this.over.dur) this.over = null;
  }

  shotPos(s, k) {
    if (s.kind !== 'missile') return [s.x1 + (s.x2 - s.x1) * k, s.y1 + (s.y2 - s.y1) * k];
    const u = 1 - k;
    return [u * u * s.x1 + 2 * u * k * s.cx + k * k * s.x2, u * u * s.y1 + 2 * u * k * s.cy + k * k * s.y2];
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    box(g, 0, 0, W, H, '#05070c');
    this.drawDivider(g, R, rt);
    for (const team of TEAMS) this.drawCol(g, R, team, rt);
    this.drawFlights(g, rt);
    for (const q of this.debris) {
      g.save(); g.globalAlpha = Math.max(0, q.life / q.max); g.translate(q.x, q.y); g.rotate(q.r);
      box(g, -q.w / 2, -q.h / 2, q.w, q.h, q.color);
      g.restore();
    }
    this.fx.renderOver(g, scale);
    for (const team of TEAMS) this.drawTags(g, R, team, scale, rt);
    for (const team of TEAMS) {
      for (const b of this.cols[team].bigs) {
        const k = b.t / b.life;
        g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        this.bigText(g, COL_X[team] + COL_W / 2, 440 + b.dy - k * 30, b.text, b.color, b.size, k < 0.12 ? 0.5 + (k / 0.12) * 0.6 : 1);
      }
    }
    g.globalAlpha = 1;
    this.drawWarn(g, rt);
  }

  bigText(g, x, y, text, color, size, s = 1, glowColor = color) {
    g.save(); g.translate(x, y); g.scale(s, s);
    [g.font, g.textAlign, g.textBaseline, g.lineJoin, g.lineWidth, g.strokeStyle] = [`italic 900 ${size}px ${FONT}`, 'center', 'middle', 'round', Math.max(4, size / 7), 'rgba(0,0,0,0.78)'];
    g.strokeText(text, 0, 0);
    [g.shadowColor, g.shadowBlur, g.fillStyle] = [glowColor, size / 3, color];
    g.fillText(text, 0, 0);
    g.restore();
  }

  /** 滚动的地面 / 星空，再加一层飞得更快的云（视差）。弹幕地狱时整个加速。 */
  drawBack(g, x0, theme, rt, hell) {
    const off = (rt * (hell ? 110 : 38)) % TILE_H;
    const img = tile(theme);
    g.drawImage(img, x0, COL_Y + off - TILE_H, COL_W, TILE_H);
    g.drawImage(img, x0, COL_Y + off, COL_W, TILE_H);
    if (theme === 'space') {
      // 三层星星，越近越快，最近一层拉成线
      for (const [sp, a, sz, salt] of [[30, 0.45, 1.2, 1], [75, 0.7, 1.8, 2], [170, 0.9, 2.2, 3]]) {
        const s = rt * sp * (hell ? 2.5 : 1);
        const n0 = Math.floor(s / 37);
        g.fillStyle = `rgba(220,230,255,${a})`;
        for (let n = n0 - 1; n <= n0 + 26; n++) if (h01(n * 7 + salt * 1000) > 0.4) g.fillRect(x0 + h01(n * 13 + salt * 77) * COL_W, COL_B - n * 37 + s, sz, salt === 3 ? sz * 5 : sz);
      }
      return;
    }
    const s = rt * (hell ? 230 : 90);
    const n0 = Math.floor((s - 200) / 230);
    for (let n = n0; n <= n0 + 6; n++) {
      if (h01(n * 7 + 3) < 0.35) continue;
      const [x, y, size] = [x0 + h01(n * 13 + 5) * COL_W, COL_B - n * 230 + s, 34 + h01(n * 17 + 9) * 46];
      cloud(g, x + 16, y + 26, size, theme === 'sea' ? 0.17 : 0.12); // 云在地上的影子
      cloud(g, x, y, size, 0.42);
    }
  }

  drawCol(g, R, team, rt) {
    const cv = this.cols[team];
    const c = R.cols?.[team];
    const x0 = COL_X[team];
    const theme = THEMES[((R.round || 1) + (team === 'codex' ? 1 : 0)) % THEMES.length];
    const hell = R.phase === 'live' && R.tide > 0;
    const low = c && c.hp < 35 && !c.dead;
    const veil = (fill) => ((g.fillStyle = fill), g.fillRect(x0, COL_Y, COL_W, COL_H));
    g.save();
    [g.shadowColor, g.shadowBlur] = [low ? `rgba(255,40,40,${0.6 + 0.4 * Math.sin(rt * 9)})` : COLOR[team], 24];
    veil('#000');
    g.restore();
    g.save(); g.beginPath(); g.rect(x0, COL_Y, COL_W, COL_H); g.clip();
    this.drawBack(g, x0, theme, rt, hell);
    const jets = this.jets(R, team);
    if (theme !== 'space') {
      // 地面上的影子
      for (const d of cv.foes.values()) drawFoe(g, d.x + 14, d.y + 24, d.kind, { solid: SHADOW, s: 0.85 });
      if (cv.boss) drawBoss(g, cv.boss.x + 26, cv.boss.y + 40, { solid: SHADOW });
      for (const j of jets) drawJet(g, j.x + 16, j.y + 30, j.s * 0.85, team, { solid: SHADOW });
    }
    for (const d of cv.foes.values()) {
      if (d.src) glow(g, d.x, d.y, d.kind === 'bomber' ? 52 : 34, `${COLOR[d.src]}88`, `${COLOR[d.src]}00`); // 垃圾敌机：对面队伍色的光晕
      drawFoe(g, d.x, d.y, d.kind, { rt, tint: d.src ? COLOR[d.src] : null, flash: d.flash > 0 });
      if (d.hp < d.max && d.hp > 0) hpBar(g, d.x, d.y - (d.kind === 'bomber' ? 44 : 28), d.kind === 'bomber' ? 50 : 30, d.hp / d.max, 3);
    }
    if (cv.boss) drawBoss(g, cv.boss.x, cv.boss.y, { rt, flash: cv.boss.flash > 0 });
    this.drawWrecks(g, team, rt);
    this.drawShots(g, team);
    this.drawJets(g, team, c, jets, rt);
    this.drawItems(g, R, team, rt);
    this.drawLock(g, cv, c, rt);
    // 炸弹：从战机炸开一个白色大火球；核弹：整条航道一团橙色蘑菇光
    if (cv.bombT > 0) {
      const k = 1 - cv.bombT / 0.9;
      const j = jets[0] || { x: x0 + COL_W / 2, y: JET_Y };
      g.globalAlpha = Math.max(0, 1 - k) * 0.85;
      glow(g, j.x, j.y - 200, 120 + k * 700, 'rgba(255,255,240,1)', 'rgba(255,200,120,0)');
      g.globalAlpha = 1;
    }
    if (cv.nukeT > 0) {
      const k = 1 - cv.nukeT / 1.6;
      glow(g, x0 + COL_W / 2, 420, 80 + k * 520, `rgba(255,${Math.round(240 - k * 140)},120,${0.9 * (1 - k)})`, 'rgba(255,80,20,0)');
    }
    if (cv.flash > 0) veil(`rgba(255,255,255,${Math.min(0.8, cv.flash)})`);
    if (cv.hitT > 0 || hell) {
      const rg = g.createRadialGradient(x0 + COL_W / 2, 520, 160, x0 + COL_W / 2, 520, 560);
      rg.addColorStop(0, 'rgba(255,0,0,0)');
      rg.addColorStop(1, `rgba(255,20,20,${(Math.min(0.45, cv.hitT * 1.4) + (hell ? 0.12 + 0.06 * Math.sin(rt * 5) : 0)).toFixed(3)})`);
      veil(rg);
    }
    g.restore();
    [g.strokeStyle, g.lineWidth] = [low ? `rgb(255,${Math.round(90 + 60 * Math.sin(rt * 9))},90)` : COLOR[team], 3];
    g.strokeRect(x0, COL_Y, COL_W, COL_H);
    this.drawHud(g, team, c, rt);
    if (this.over) {
      // 一局结束：赢的一边金色「胜利」，输的一边变暗打「GAME OVER」
      const o = this.over;
      const win = o.winner === team;
      g.globalAlpha = clamp((o.dur - o.t) / 0.3, 0, 1) * clamp(o.t / 0.15, 0, 1);
      if (o.winner && !win) veil('rgba(0,0,0,0.45)');
      const text = !o.winner ? L('平局', 'DRAW') : win ? L('胜利！', 'WINNER!') : 'GAME OVER';
      this.bigText(g, x0 + COL_W / 2, 470, text, win ? '#ffd166' : o.winner ? '#ff4d4d' : '#ffffff', win ? 72 : 62, 0.7 + 0.3 * clamp(o.t / 0.3, 0, 1));
      g.globalAlpha = 1;
    }
    if (!R.field?.(team).length) {
      veil('rgba(5,6,10,0.6)');
      pill(g, x0 + COL_W / 2, 500, L(`等待 ${TEAM_NAME[team]} 起飞…`, `Waiting for ${TEAM_NAME[team]} to take off…`), { size: 18, max: 340, color: COLOR[team] });
    }
  }

  drawWrecks(g, team, rt) {
    for (const w of this.wrecks) {
      if (w.team !== team) continue;
      const tint = w.src ? COLOR[w.src] : null;
      if (w.flee) drawBoss(g, w.x, w.y - w.t * w.t * 500, { rt }); // Boss 打不下来，加速飞走
      else if (w.ram && w.t < 0) {
        const k = 1 + w.t / w.dive; // 撞过来：一边冲一边闪
        drawFoe(g, w.x + (w.x2 - w.x) * k, w.y + (w.y2 - w.y) * k, w.kind, { rt, tint, flash: Math.floor(rt * 20) % 2 === 0 });
      } else if (w.kind === 'boss') {
        g.globalAlpha = clamp(1 - w.t / w.max, 0, 1);
        drawBoss(g, w.x, w.y + Math.max(0, w.t) * 30, { rt, flash: Math.floor(rt * 14) % 2 === 0 });
        g.globalAlpha = 1;
      } else if (w.t < 0.06) drawFoe(g, w.x, w.y, w.kind, { rt, tint, flash: true });
    }
    // 卡通星形爆闪
    for (const p of this.pops) {
      const k = p.t / p.dur;
      const pts = [];
      for (let i = 0; i < 20; i++) {
        const rr = (i % 2 ? 0.45 : 1) * p.s * (0.6 + k * 0.7);
        pts.push(Math.cos((i / 20) * TAU) * rr, Math.sin((i / 20) * TAU) * rr);
      }
      g.globalAlpha = 1 - k;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a);
      poly(g, pts, '#ffb02e');
      g.scale(0.55, 0.55);
      poly(g, pts, '#fff6c8');
      g.restore();
    }
    g.globalAlpha = 1;
  }

  drawShots(g, team) {
    for (const b of this.beams) {
      if (b.team !== team) continue;
      const k = b.t / b.dur;
      const w = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * 34 + 4;
      box(g, b.x - w, COL_Y, w * 2, b.y - COL_Y, lin(g, b.x - w, 0, b.x + w, 0, 'rgba(80,220,255,0)', 'rgba(120,235,255,0.8)', 'rgba(255,255,255,1)', 'rgba(120,235,255,0.8)', 'rgba(80,220,255,0)'));
      glow(g, b.x, b.y, w * 1.4, 'rgba(255,255,255,0.95)', 'rgba(120,235,255,0)');
    }
    for (const s of this.shots) {
      if (s.team !== team || s.t < 0) continue;
      const [x, y] = this.shotPos(s, Math.min(1, s.t / s.dur));
      if (s.kind === 'missile') {
        const [px, py] = this.shotPos(s, Math.max(0, s.t / s.dur - 0.05));
        g.save(); g.translate(x, y); g.rotate(Math.atan2(y - py, x - px) + Math.PI / 2);
        glow(g, 0, 9, 9, 'rgba(255,230,150,0.95)', 'rgba(255,120,40,0)');
        box(g, -2.5, -8, 5, 14, '#eceff3');
        poly(g, [0, -13, 2.5, -8, -2.5, -8], '#e04848');
        g.restore();
      } else if (s.kind === 'wave') glow(g, x, y, 16, 'rgba(220,255,245,1)', 'rgba(80,255,200,0)');
      else {
        // 发光弹丸：拉长的光点，暴击是金色大号
        const col = s.crit ? '#ffe066' : s.wing ? '#9fffcf' : COLOR[team];
        const r = s.small ? 3 : s.crit ? 6 : 4.5;
        glow(g, x, y, r * 2.6, `${col}cc`, `${col}00`);
        oval(g, x, y, r * 0.6, r * 1.5, '#ffffff');
      }
    }
    for (const b of this.bullets) {
      if (b.team !== team || b.t < 0) continue;
      const k = Math.min(1, b.t / b.dur);
      const [x, y] = [b.x1 + (b.x2 - b.x1) * k, b.y1 + (b.y2 - b.y1) * k];
      glow(g, x, y, 11, 'rgba(255,90,140,0.9)', 'rgba(255,40,90,0)'); // 敌方子弹：粉红色光球
      dot(g, x, y, 3.2, '#fff0f5');
    }
  }

  drawJets(g, team, c, jets, rt) {
    const cv = this.cols[team];
    const lead = jets[0];
    if (!c || !lead || (this.over?.winner && this.over.winner !== team && this.over.t < 2)) return; // 输掉的那架刚炸完，先别露面
    if (cv.respawn <= 0 || Math.floor(rt * 16) % 2) {
      for (const j of jets) drawJet(g, j.x, j.y, j.s, team, { rt, muzzle: cv.muzzle.has(j.p.sid) });
      if (cv.hitT > 0) (g.globalAlpha = Math.min(0.7, cv.hitT * 2.5)), drawJet(g, lead.x, lead.y, lead.s, team, { solid: '#ff4040' }), (g.globalAlpha = 1);
    }
    // 护盾：一圈淡蓝色的泡泡
    if (c.shield || cv.shieldT > 0) {
      const a = +(c.shield ? 0.3 + 0.15 * Math.sin(rt * 4) : cv.shieldT).toFixed(3);
      [g.strokeStyle, g.lineWidth, g.fillStyle] = [`rgba(120,220,255,${a})`, 3, `rgba(120,220,255,${a * 0.25})`];
      g.beginPath(); g.arc(lead.x, lead.y, 46, 0, TAU); g.stroke(); g.fill();
    }
    // 蓄力：机头一团电光，满了一闪一闪
    if (c.charge > 0) glow(g, lead.x, lead.y - 44, 6 + c.charge * 5 + (c.charge >= 3 ? 4 * Math.sin(rt * 18) : 0), 'rgba(220,250,255,0.95)', 'rgba(80,200,255,0)');
    // 僚机（子代理）：一架小支援机绕着长机飞
    if (c.wing > 0) {
      const [wx, wy] = [lead.x + Math.sin(rt * 1.6) * 64, lead.y - 70 + (1 - cv.wingIn) * 260];
      drawJet(g, wx, wy, 0.48, team, { rt });
      pill(g, wx, wy + 26, L(`僚机 ×${c.wing}`, `Wing ×${c.wing}`), { size: 10, color: '#9fffcf' });
    }
  }

  /** 补给胶囊：从敌机身上（或天上）掉下来，晃悠着飞向战机。 */
  drawItems(g, R, team, rt) {
    for (const it of this.items) {
      if (it.team !== team) continue;
      const jet = this.jetOf(R, team, it.sid);
      const k = clamp(it.t / it.dur, 0, 1);
      const [tx, ty] = jet ? [jet.x, jet.y] : [it.x, JET_Y];
      const [ch, col] = ITEM[it.item];
      const [x, y] = [it.x + (tx - it.x) * smooth(k) + Math.sin(rt * 8 + it.a) * 6 * (1 - k), it.y + (ty - it.y) * smooth(k)];
      glow(g, x, y, 24, `${col}aa`, `${col}00`);
      g.save(); g.translate(x, y); g.rotate(Math.sin(rt * 5 + it.a) * 0.4);
      [g.fillStyle, g.strokeStyle, g.lineWidth] = [lin(g, 0, -11, 0, 11, '#ffffff', col, col), 'rgba(0,0,0,0.5)', 1.5];
      g.beginPath(); g.roundRect(-15, -11, 30, 22, 11); g.fill(); g.stroke();
      txt(g, ch, 0, 1, '900 15px', '#222');
      g.restore();
    }
  }

  /** 锁定：最前面那架敌机身上套一个转着的准星。 */
  drawLock(g, cv, c, rt) {
    if (!c || (!c.lock && cv.lockT <= 0)) return;
    let best = null;
    for (const d of cv.foes.values()) if (!best || d.ty > best.ty) best = d;
    if (!best) return;
    const r = 26 + cv.lockT * 40;
    g.save(); g.translate(best.x, best.y); g.rotate(rt * 2);
    seg(g, '#ffe066', 2, 0, r - 8, 0, r + 8, 0, -r + 8, 0, -r - 8, r - 8, 0, r + 8, 0, -r + 8, 0, -r - 8, 0);
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    g.restore();
  }

  /** 航道里的 HUD：上面是队名、分数、火力、蓄力；下面是命、血条、炸弹。Boss 在场时多一条大血条。 */
  drawHud(g, team, c, rt) {
    if (!c) return;
    const x0 = COL_X[team];
    const px = x0 + COL_W - 14;
    const maxed = c.power >= 4;
    box(g, x0, COL_Y, COL_W, 72, lin(g, 0, COL_Y, 0, COL_Y + 72, 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'));
    txt(g, TEAM_NAME[team].toUpperCase(), x0 + 14, COL_Y + 18, '900 18px', COLOR[team], 'left');
    txt(g, String(c.score).padStart(7, '0'), x0 + 14, COL_Y + 44, '800 24px', '#ffffff', 'left', MONO);
    txt(g, L(`击落 ${c.kills} · 送出 ${c.sent}`, `${c.kills} down · ${c.sent} sent`), x0 + 136, COL_Y + 45, '700 12px', COLOR[team], 'left');
    txt(g, `P${c.power}`, px - 70, COL_Y + 18, '900 18px', maxed ? '#ffd166' : '#ff9a5c', 'right');
    txt(g, '⚡', px - 70, COL_Y + 44, '700 15px', '#7fe8ff', 'right');
    for (let i = 0; i < 4; i++) {
      box(g, px - 62 + i * 16, COL_Y + 11, 12, 14, i >= c.power ? 'rgba(255,255,255,0.15)' : maxed ? `rgba(255,209,102,${0.75 + 0.25 * Math.sin(rt * 8)})` : '#ff7a3d');
    }
    for (let i = 0; i < 3; i++) {
      box(g, px - 62 + i * 21, COL_Y + 39, 17, 9, i >= c.charge ? 'rgba(255,255,255,0.15)' : c.charge >= 3 ? `rgba(160,240,255,${0.7 + 0.3 * Math.sin(rt * 14)})` : '#4fc3e8');
    }
    if (c.lock) pill(g, px - 128, COL_Y + 44, L('🎯 锁定', '🎯 LOCK'), { size: 12, color: '#ffe066', weight: 800 });
    if (c.boss) {
      const bw = COL_W - 120;
      txt(g, 'BOSS', x0 + 16, COL_Y + 84, 'italic 900 15px', '#ff5a5a', 'left');
      box(g, x0 + 70, COL_Y + 78, bw, 12, 'rgba(0,0,0,0.6)');
      box(g, x0 + 70, COL_Y + 78, bw * clamp(c.boss.hp / c.boss.max, 0, 1), 12, lin(g, x0 + 70, 0, x0 + 70 + bw, 0, '#ff2a2a', '#ff9a3c'));
      [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.5)', 1];
      g.strokeRect(x0 + 70, COL_Y + 78, bw, 12);
    }
    const [by, hx] = [COL_B - 22, x0 + COL_W / 2];
    box(g, x0, COL_B - 56, COL_W, 56, lin(g, 0, COL_B - 56, 0, COL_B, 'rgba(0,0,0,0)', 'rgba(0,0,0,0.75)'));
    for (let i = 0; i < Math.min(c.lives, 6); i++) drawJet(g, x0 + 22 + i * 26, by, 0.34, team, { rt });
    box(g, hx - 87, by - 7, 174, 14, 'rgba(0,0,0,0.6)');
    hpBar(g, hx, by - 5, 170, Math.max(0, c.hp) / HP, 10);
    txt(g, `${c.shield ? '🛡 ' : ''}HP ${Math.max(0, Math.round(c.hp))}`, hx, by - 18, '800 11px', '#dfe6ee');
    for (let i = 0; i < Math.min(c.bombs, MAX_BOMBS); i++) {
      const bx = x0 + COL_W - 24 - i * 28;
      g.fillStyle = '#3fcf6a';
      g.beginPath(); g.roundRect(bx - 11, by - 9, 22, 18, 9); g.fill();
      txt(g, 'B', bx, by + 1, '900 12px', '#0f2a16');
    }
  }

  /** 名字牌在飞机下面，动作气泡在上面；悬停等你时套一圈倒计时。 */
  drawTags(g, R, team, scale, rt) {
    const fs = fontFor(scale, 12);
    for (const j of this.jets(R, team)) {
      const w = R.waits?.get(j.p.sid);
      pill(g, j.x, j.y + 44 * j.s + 10, j.p.name, { color: COLOR[team], size: fs - 1, max: 120 });
      if (w && !w.boom) {
        const k = clamp((R.now - w.t) / (w.deadline - w.t), 0, 1);
        const sec = Math.ceil(Math.max(0, w.deadline - R.now) / 1000);
        [g.strokeStyle, g.lineWidth] = [`rgba(255,90,90,${0.7 + 0.3 * Math.sin(rt * 8)})`, 3];
        g.beginPath(); g.arc(j.x, j.y, 54 * j.s, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k)); g.stroke();
        pill(g, j.x, j.y - 58 * j.s - fs - 8, L(`⏳ 悬停 ${sec} 秒`, `⏳ Hover ${sec}s`), { color: '#fff', size: fs - 1, bg: 'rgba(150,20,20,0.85)' });
      }
      const l = this.labels.get(j.p.sid);
      if (!l) continue;
      g.globalAlpha = Math.min(1, l.life / 0.35);
      pill(g, j.x, j.y - 52 * j.s - (1.6 - l.life) * 8, l.text, { size: fs - 1, max: 200, weight: 500, bg: l.bad ? 'rgba(130,20,20,0.88)' : 'rgba(10,12,16,0.78)' });
      g.globalAlpha = 1;
    }
  }

  /** 中间的分隔带：VS、第几局、弹幕地狱倒计时、Boss 倒计时、两边的「来袭」槽。 */
  drawDivider(g, R, rt) {
    const [x0, x1] = [COL_X.claude + COL_W, COL_X.codex];
    box(g, x0, COL_Y, x1 - x0, COL_H, lin(g, x0, 0, x1, 0, '#0b0e15', '#1b2030', '#0b0e15'));
    for (let y = COL_Y + 20; y < COL_B; y += 40) for (const x of [x0 + 8, x1 - 8]) dot(g, x, y, 2.5, 'rgba(255,255,255,0.08)'); // 铆钉
    this.bigText(g, MID, 230, 'VS', lin(g, MID - 60, 0, MID + 60, 0, COLOR.claude, COLOR.codex), 88, 1 + 0.04 * Math.sin(rt * 2.2), 'rgba(255,255,255,0.3)');
    if (R.phase !== 'live') txt(g, L('热身中', 'Warm-up'), MID, 300, '800 20px', '#ffffff');
    else {
      txt(g, L(`第 ${R.round} 局`, `Game ${R.round}`), MID, 300, '800 20px', '#ffffff');
      const left = Math.max(0, R.roundLen - (R.now - R.roundStart));
      const clock = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      if (left > 0) txt(g, L(`弹幕地狱 ${clock}`, `Bullet hell ${clock}`), MID, 328, '600 13px', 'rgba(255,255,255,0.55)');
      else txt(g, L('☠ 弹幕地狱', '☠ BULLET HELL'), MID, 328, '800 14px', `rgba(255,110,110,${0.7 + 0.3 * Math.sin(rt * 6)})`);
      const n = R.bossAt - R.step;
      if (Number.isFinite(n) && n > 0) txt(g, L(`Boss 还有 ${n} 步`, `Boss in ${n} moves`), MID, 352, '600 13px', n <= 3 ? '#ff6b6b' : 'rgba(255,255,255,0.45)');
    }
    for (const team of TEAMS) {
      const [mx, top, bot] = [meterX(team), 430, COL_B - 40];
      const pend = R.cols?.[team]?.pending || 0;
      box(g, mx, top, 14, bot - top, 'rgba(255,255,255,0.06)');
      txt(g, L('来袭', 'Inbound'), mx + 7, bot + 16, '600 11px', 'rgba(255,255,255,0.45)');
      if (pend <= 0) continue;
      const h = (bot - top) * Math.min(1, pend / MAX_PENDING);
      g.globalAlpha = 0.75 + 0.25 * Math.sin(rt * 10);
      box(g, mx + 1, bot - h, 12, h, lin(g, 0, bot - h, 0, bot, pend >= 10 ? '#ff3030' : '#ffc23b', '#ff6a2b'));
      g.globalAlpha = 1;
      pill(g, mx + 7, bot - h - 14, `+${pend}`, { color: '#ff8a7a', size: 12, weight: 800 });
    }
  }

  /** 送出去的垃圾：一串对面队伍色的小飞机从自己航道飞过中线，钻进对面航道的顶上。 */
  drawFlights(g, rt) {
    const [cx, cy] = [MID, COL_Y - 20];
    for (const fl of this.flights) {
      if (fl.t < 0) continue;
      const e = smooth(fl.t / fl.dur);
      const u = 1 - e;
      const [x, y] = [u * u * fl.x1 + 2 * u * e * cx + e * e * fl.x2, u * u * fl.y1 + 2 * u * e * cy + e * e * fl.y2];
      const [dx, dy] = [2 * u * (cx - fl.x1) + 2 * e * (fl.x2 - cx), 2 * u * (cy - fl.y1) + 2 * e * (fl.y2 - cy)];
      glow(g, x, y, 22, `${COLOR[fl.from]}aa`, `${COLOR[fl.from]}00`);
      drawFoe(g, x, y, 'scout', { rt, tint: COLOR[fl.from], s: 0.8, rot: Math.atan2(dy, dx) - Math.PI / 2 });
    }
  }

  /** BOSS 来袭：横贯全屏的红色警报条，上下两道滚动的黄黑警示线。 */
  drawWarn(g, rt) {
    const w = this.warn;
    if (!w) return;
    const [y, h] = [400, 150];
    g.globalAlpha = clamp(Math.min(w.t / 0.25, (w.dur - w.t) / 0.35), 0, 1);
    box(g, 0, y, W, h, `rgba(150,0,0,${0.55 + 0.15 * Math.sin(rt * 10)})`);
    for (const yy of [y, y + h - 18]) {
      g.save(); g.beginPath(); g.rect(0, yy, W, 18); g.clip();
      box(g, 0, yy, W, 18, '#ffcc00');
      for (let x = -40 + ((rt * 120) % 40); x < W + 40; x += 40) poly(g, [x, yy + 18, x + 18, yy, x + 34, yy, x + 16, yy + 18], '#111');
      g.restore();
    }
    this.bigText(g, MID, y + h / 2 - 12, 'WARNING!!', Math.floor(rt * 6) % 2 ? '#ffffff' : '#ff2a2a', 84, 1, '#ff0000');
    txt(g, L('巨大战舰正在高速接近', 'A HUGE BATTLESHIP IS APPROACHING FAST'), MID, y + h - 36, '800 20px', '#ffd6d6');
    g.globalAlpha = 1;
  }

  hud(R) {
    if (R.phase !== 'live' || !R.cols) return null;
    const { claude, codex } = R.cols;
    const max = Math.min(6, Math.max(R.cfg?.lives || 3, claude.lives, codex.lives));
    const pips = (c) => Array.from({ length: max }, (_, i) => i < c.lives);
    return { mid: L(`第 ${R.round} 局`, `Game ${R.round}`), sub: `♥ ${claude.lives} : ${codex.lives}`, pips: { claude: pips(claude), codex: pips(codex) } };
  }
}
