// 绝地吃鸡：海岛大逃杀，活到最后的人（或小队）吃鸡。
// 跑命令开枪，测试通过爆头，改代码舔包，读代码听声辨位；很久不干活的人跑不进圈，被毒圈毒死。
import { Rules as Base, COLOR, DEEP, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, rand, pill, hpBar, emoji, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

// meta 在 import 时就求值，文字都写成 getter，切换语言后读到的是新语言
export const meta = {
  id: 'br',
  icon: '🍗',
  get name() { return L('绝地吃鸡', 'Chicken Dinner'); },
  get desc() { return L('海岛大逃杀。跑命令开枪，改代码舔包，很久不干活的跑不进圈，被毒死', 'Island battle royale. Commands shoot, edits loot, idle agents die in the Blue Zone'); },
  get roundWord() { return L('局', 'match'); },
  get wait() {
    return {
      start: L('🌿 {a} 趴在草丛里等你', '🌿 {a} is lying in the grass, waiting for you'),
      sub: L('40 秒内回它，不然毒圈就收到脸上了', 'Reply within 40s or the Blue Zone gets them'),
      done: L('🏃 回得及时，跑进圈了', '🏃 Replied in time, made it into the circle'),
      boom: L('☠️ {a} 在草丛里趴太久，被毒死了', '☠️ {a} camped too long and died to the Blue Zone'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('开枪（枪越好越疼，会描边）', 'Shoot (better gun, more damage; may miss)')],
      [L('🍳 刚落地没枪', '🍳 Just landed, no gun'), L('平底锅拍人：铛！', 'Frying Pan smack: CLANG!')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('爆头', 'Headshot')],
      [L('🔍 读文件、搜代码', '🔍 Read or search code'), L('听声辨位，下一枪不描边还更疼', 'Listen for footsteps: next shot hits harder')],
      [L('🧱 改代码', '🧱 Edit code'), L('舔包：一级甲 → 二级甲 → 三级甲', 'Loot: Level 1 → Level 2 → Level 3 Vest')],
      [L('💰 烧 token', '💰 Burn tokens'), L('搜物资：平底锅 → UMP45 → M416 → AWM', 'Scavenge: Frying Pan → UMP45 → M416 → AWM')],
      [L('🔭 上网查资料', '🔭 Search the web'), L('98K / AWM 狙击，偶尔抢到空投', 'Kar98k / AWM snipe, sometimes an Airdrop')],
      [L('✅ 任务完成', '✅ Task done'), L('打药回血', 'Heal up')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('把成盒的队友扶起来（单排就开吉普撞人）', 'Revive a boxed teammate (solo: run someone over)')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('被平底锅拍晕 / 跑毒', 'Pan-stunned / outrun the zone')],
      [L('🦵 动作报错', '🦵 Action fails'), L('摔伤、吃了口毒', 'Fall damage or a zone tick')],
      [L('🌿 它在等你', '🌿 Waiting for you'), L('趴草丛当伏地魔，40 秒不回就被毒死', 'Goes prone in the grass; 40s and the zone kills it')],
      [L('☠️ 很久没动作', '☠️ Idle for a while'), L('跑不进圈，被毒圈慢慢毒死', 'Left outside the circle, dies to the Blue Zone')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('空投吉利服：满血 + 三级甲', 'Airdrop Ghillie Suit: full HP + Level 3 Vest')],
    ];
  },
};

// tokens 搜得越多枪越好；AWM 是顶配，空投也能抢到
const GUNS = [
  { id: 'pan', min: 9, max: 14, miss: 0.08, hs: 0.05, tok: 0 },
  { id: 'ump', min: 10, max: 15, miss: 0.25, hs: 0.03, tok: 1500 },
  { id: 'm416', min: 14, max: 20, miss: 0.2, hs: 0.05, tok: 5000 },
  { id: 'awm', min: 30, max: 42, miss: 0.3, hs: 0.18, tok: 15000 },
];
const SNIPE = {
  k98: { id: 'k98', min: 30, max: 42, miss: 0.3, hs: 0.2, snipe: true },
  awm: { id: 'awm', min: 45, max: 60, miss: 0.25, hs: 0.28, snipe: true },
};
const ARMOR = [
  { cut: 0, dur: 0, color: 'rgba(0,0,0,0)' },
  { cut: 0.3, dur: 100, color: '#d9d9d9' },
  { cut: 0.4, dur: 160, color: '#5fa8ff' },
  { cut: 0.55, dur: 240, color: '#b77cff' },
];
// 名字只在显示的时候翻译，规则逻辑只认 id，语言不会影响结果
const gunName = (id) => ({ pan: L('平底锅', 'Frying Pan'), ump: 'UMP45', m416: 'M416', awm: 'AWM', k98: 'Kar98k' })[id];
const armorName = (lv) => [L('没穿甲', 'No Vest'), L('一级甲', 'Level 1 Vest'), L('二级甲', 'Level 2 Vest'), L('三级甲', 'Level 3 Vest')][lv];
const ZONE = () => L('毒圈', 'Blue Zone');
// 毒圈：[等多少秒, 缩多少秒, 圈外每秒掉血]；大乱斗里时间整体乘 0.5
const PHASES = [[35, 35, 1], [30, 30, 2], [25, 25, 4], [20, 20, 7], [15, 20, 11]];
const RADII = [360, 225, 130, 62, 0];
const DROP = 20e3; // 航线 + 跳伞
const TICK = 2000; // 毒圈按 2 秒一格结算（源时间），和推进频率无关，回放才一致
const RUN = 260; // 每个动作最多往圈里跑这么远
const FINAL_GRACE = 20e3; // 决赛圈收完还没分出胜负，血多的吃鸡
const DMG = 0.2; // 枪的整体伤害系数：一局大约 15～30 个动作分出胜负
const EARLY = 35e3; // 这之前死 = 落地成盒

// ================================================================ 海岛（规则层和画面层共用同一个轮廓）

const { w: W, h: H } = WORLD;
const [CX, CY, RX, RY] = [800, 470, 590, 360];
const shore = (a) => 1 + 0.07 * Math.sin(3 * a + 1.3) + 0.05 * Math.sin(5 * a + 0.4) + 0.03 * Math.sin(9 * a + 2.1);

/** 把一个点拉回岛上（k 越小越靠内陆）。 */
function toLand(x, y, k = 0.82) {
  const dx = (x - CX) / RX;
  const dy = (y - CY) / RY;
  const a = Math.atan2(dy, dx);
  const lim = shore(a) * k;
  if (Math.hypot(dx, dy) <= lim) return [x, y];
  return [CX + Math.cos(a) * lim * RX, CY + Math.sin(a) * lim * RY];
}
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { ffa: true, maxPerTeam: 6 };

  init() {
    this.sp = this.party ? 0.5 : 1; // 大乱斗：毒圈缩得快
    this.pow = DMG; // 枪的伤害（大乱斗靠毒圈缩得快来提速）
    // acc：这次结算累计的毒圈伤害，攒起来一起告诉画面
    Object.assign(this, { circles: null, flight: null, zoneT: 0, acc: new Map(), lastDead: null });
  }

  initPlayer(p) {
    Object.assign(p, { wins: 0, dmgBy: new Map() });
    this.spawn(p);
  }

  onEnter(p) {
    this.spawn(p);
  }

  /** 光着身子跳伞：满血、没甲、手里一口平底锅。落点在航线附近，按会话和这一局确定，回放拖进度条也一样。 */
  spawn(p) {
    Object.assign(p, {
      alive: true, hp: 100, armor: 0, dur: 0, tier: 0, loot: 0, focus: 0,
      prone: false, ghillie: 0, stunUntil: 0, outside: false, rk: 0, looted: false, diedAt: 0,
    });
    p.dmgBy.clear();
    const r = rng(hash(`${p.sid}:${this.round}:${this.roundStart}`));
    const f = this.flight || { x1: 200, y1: 200, x2: 1400, y2: 740 };
    const t = 0.15 + r() * 0.7;
    const nl = Math.hypot(f.x2 - f.x1, f.y2 - f.y1) || 1;
    const off = (r() * 2 - 1) * 210;
    const [x, y] = toLand(f.x1 + (f.x2 - f.x1) * t - ((f.y2 - f.y1) / nl) * off, f.y1 + (f.y2 - f.y1) * t + ((f.x2 - f.x1) / nl) * off);
    Object.assign(p, { x, y, dx: x, dy: y, jump: t });
  }

  onRoundStart(fx) {
    // 开局时间对齐到全局 2 秒格：毒圈结算的时间点和推进频率无关
    this.roundStart = Math.floor(this.roundStart / TICK) * TICK;
    const r = rng(hash(`br-${this.round}`) ^ (Math.floor(this.roundStart / 1000) | 0));
    // 航线：从海上一边飞到另一边
    const a = r() * Math.PI * 2;
    const ox = CX + (r() - 0.5) * 300;
    const oy = CY + (r() - 0.5) * 200;
    this.flight = { x1: ox - Math.cos(a) * 950, y1: oy - Math.sin(a) * 650, x2: ox + Math.cos(a) * 950, y2: oy + Math.sin(a) * 650 };
    // 毒圈：每个圈都落在上一个圈里，圈心都在岛上
    const Z = [{ x: CX, y: CY, r: Math.hypot(RX, RY) * 1.25 }];
    let [x, y] = toLand(CX + (r() - 0.5) * RX * 0.8, CY + (r() - 0.5) * RY * 0.8, 0.5);
    Z.push({ x, y, r: RADII[0] });
    for (let i = 1; i < RADII.length; i++) {
      const prev = Z[Z.length - 1];
      const b = r() * Math.PI * 2;
      const d = r() * (prev.r - RADII[i]) * 0.85;
      [x, y] = toLand(prev.x + Math.cos(b) * d, prev.y + Math.sin(b) * d, 0.62);
      Z.push({ x, y, r: RADII[i] });
    }
    this.circles = Z;
    this.zoneT = this.roundStart;
    this.acc.clear();
    this.lastDead = null;
    for (const p of this.field()) this.spawn(p);
    fx.push({ type: 'flight', round: this.round });
  }

  /** t 时刻的毒圈：当前白圈、下一个圈、阶段、剩余时间、圈外每秒掉血。 */
  zoneAt(t = this.now) {
    const Z = this.circles;
    if (!Z) return null;
    let e = t - this.roundStart;
    const drop = DROP * this.sp;
    if (e < drop) return { ...Z[0], next: Z[1], state: 'drop', phase: 0, left: drop - e, dps: 0 };
    e -= drop;
    for (let i = 0; i < PHASES.length; i++) {
      const [w, s, dps] = PHASES[i];
      const [wait, shrink] = [w * 1000 * this.sp, s * 1000 * this.sp];
      if (e < wait) return { ...Z[i], next: Z[i + 1], state: 'wait', phase: i + 1, left: wait - e, dps };
      e -= wait;
      if (e < shrink) {
        const k = e / shrink;
        const [a, b] = [Z[i], Z[i + 1]];
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r: a.r + (b.r - a.r) * k, next: b, state: 'shrink', phase: i + 1, left: shrink - e, dps };
      }
      e -= shrink;
    }
    return { ...Z[Z.length - 1], next: null, state: 'final', phase: PHASES.length, left: 0, over: e, dps: PHASES[PHASES.length - 1][2] };
  }

  /** 两队都在场就是四排（打对面），只有一队就是单排（谁都打）。 */
  squads() {
    return !!(this.field('claude').length && this.field('codex').length);
  }

  mult(p) {
    return this.balanceMult(p.team) * this.sizeMult() * this.pow;
  }

  ghostOk() {
    return false; // 成盒了就是成盒了
  }

  onTokens(p, n, fx) {
    if (!p.onField || !p.alive || this.phase !== 'live') return;
    p.loot += n;
    let t = p.tier;
    while (t < 3 && p.loot >= GUNS[t + 1].tok * this.sp) t++;
    if (t === p.tier) return;
    p.tier = t;
    fx.push({ type: 'gun', sid: p.sid, gun: GUNS[t].id });
  }

  onEvent(p, ev, r, fx) {
    if (ev.k !== 'ask' && ev.k !== 'answer') {
      p.prone = false;
      this.run(p, r);
    }
    // 报错：摔伤 / 吃了口毒
    const ouch = { shell: 1, read: 0.5, edit: 0.6, misc: 0.5 }[ev.k];
    if (ev.ok === false && ouch) return this.oops(p, r, fx, ouch);
    switch (ev.k) {
      case 'shell': return this.shoot(p, ev, r, GUNS[p.tier], fx);
      case 'read': return this.listen(p, fx);
      case 'edit': return this.lick(p, r, fx);
      case 'misc': return this.nade(p, r, fx);
      case 'web':
        if (ev.ok === false) return fx.push({ type: 'shot', from: p.sid, to: null, weapon: p.tier === 3 ? 'awm' : 'k98', miss: true });
        if (p.tier < 3 && r() < 0.15) return this.airdrop(p, 'awm', fx);
        return this.shoot(p, ev, r, SNIPE[p.tier === 3 ? 'awm' : 'k98'], fx);
      case 'agent': return this.rescue(p, r, fx);
      case 'done': return this.heal(p, r, fx);
      case 'compact': return this.bonk(p, r, fx);
      case 'prompt': return this.medic(p, 10, 'drink', fx);
      case 'abort':
        fx.push({ type: 'abort', sid: p.sid });
        return this.kill(null, p, { weapon: L('被你淘汰', 'Eliminated by you'), cause: 'human' }, fx);
      case 'apierr':
        p.stunUntil = ev.t + 15000;
        return fx.push({ type: 'lag', sid: p.sid });
      case 'pr': return this.airdrop(p, 'ghillie', fx);
    }
  }

  /** 干活的人自动往下一个圈里跑。 */
  run(p, r) {
    const z = this.zoneAt();
    if (!z || z.state === 'drop') return;
    const c = z.next && z.next.r > 0 ? z.next : z;
    if (c.r > 0 && d2(p, c) < (c.r * 0.8) ** 2 && r() < 0.6) return;
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * c.r * 0.7;
    const [tx, ty] = toLand(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, 0.95);
    const dist = Math.hypot(tx - p.x, ty - p.y);
    if (dist < 1) return;
    const step = Math.min(dist, RUN) / dist;
    p.x += (tx - p.x) * step;
    p.y += (ty - p.y) * step;
  }

  shoot(p, ev, r, gun, fx) {
    const foes = this.foes(p);
    if (!foes.length) return fx.push({ type: 'shot', from: p.sid, to: null, weapon: gun.id });
    const pool = foes.sort((a, b) => d2(a, p) - d2(b, p));
    // 平底锅打最近的，狙击打最远的，其它多半打近的
    const pan = gun.id === 'pan';
    const t = pool[pan ? 0 : gun.snipe ? pool.length - 1 : Math.floor(r() * r() * pool.length)];
    const shot = { type: 'shot', from: p.sid, to: t.sid, weapon: gun.id, pan };
    if (ev.t < p.stunUntil) return fx.push({ ...shot, miss: true, why: 'dazed' }); // 眼冒金星
    if (!p.focus && r() < gun.miss) return fx.push({ ...shot, miss: true, why: 'trace' }); // 描边
    if (t.ghillie > 0 && r() < 0.5) {
      t.ghillie--;
      return fx.push({ ...shot, miss: true, why: 'ghillie' });
    }
    if (!pan && t.tier === 0 && r() < 0.1) {
      fx.push({ ...shot, miss: true, why: 'pan' }); // 屁股上的平底锅挡子弹
      return fx.push({ type: 'panBlock', sid: t.sid });
    }
    let dmg = gun.min + r() * (gun.max - gun.min);
    if (p.focus) dmg *= 1.4;
    p.focus = 0;
    const hs = !!ev.hs || r() < gun.hs;
    dmg *= this.mult(p);
    if (hs) dmg = Math.max(90, dmg * 2.5); // 爆头不吃甲，基本一枪带走
    fx.push({ ...shot, hs });
    this.damage(p, t, dmg, { weapon: gunName(gun.id), hs, cause: pan ? 'pan' : 'gun' }, fx);
  }

  /** 掉血。info.tick 表示是毒圈结算，伤害先攒着，最后一起告诉画面。 */
  damage(att, vic, dmg, info, fx) {
    if (!vic.alive) return;
    let d = Math.round(dmg);
    const hit = { type: 'hit', from: att ? att.sid : null, to: vic.sid, hs: !!info.hs, cause: info.cause };
    // 甲：爆头、毒圈、摔伤不减
    if (vic.armor > 0 && !info.hs && info.cause !== 'zone' && info.cause !== 'fall') {
      vic.dur -= d;
      d -= Math.round(d * ARMOR[vic.armor].cut);
      if (vic.dur <= 0) {
        fx.push({ type: 'armorBreak', sid: vic.sid, armor: vic.armor });
        vic.armor = vic.dur = 0;
      }
    }
    d = clamp(d, 0, vic.hp);
    vic.hp -= d;
    if (att && att !== vic) {
      att.dmg += d;
      vic.dmgBy.set(att.sid, (vic.dmgBy.get(att.sid) || 0) + d);
    }
    if (info.tick) this.acc.set(vic.sid, (this.acc.get(vic.sid) || 0) + d);
    else fx.push({ ...hit, dmg: d });
    if (vic.hp > 0) return;
    this.flush(fx);
    this.kill(att, vic, info, fx);
  }

  kill(att, vic, info, fx) {
    if (!vic.alive) return;
    const early = this.now - this.roundStart < EARLY * this.sp;
    const rich = vic.armor >= 2 || vic.tier >= 2;
    Object.assign(vic, { alive: false, hp: 0, prone: false, outside: false, diedAt: this.now });
    vic.d++;
    this.lastDead = vic;
    const killer = att && att !== vic ? att : null;
    let assist = null;
    if (killer) {
      killer.k++;
      killer.rk++;
      if (info.hs) killer.hs++;
      for (const [sid, d] of vic.dmgBy) {
        const a = this.players.get(sid);
        if (sid !== killer.sid && d >= 30 && a) {
          a.a++;
          assist = assist || sid;
        }
      }
    }
    fx.push({ type: 'kill', killer: killer ? killer.sid : null, victim: vic.sid, weapon: info.weapon, hs: !!info.hs, cause: info.cause, assist, early });
    if (early) fx.push({ type: 'note', text: L('📦 {0} 落地成盒', '📦 {0}: landed, looted, boxed'), sids: [vic.sid] });
    else if (rich && killer) {
      // 快递员：死的时候一身好装备，全送给了杀他的人
      const goods = [vic.armor >= 2 ? armorName(vic.armor) : '', vic.tier >= 2 ? gunName(GUNS[vic.tier].id) : ''].filter(Boolean).join(' + ');
      fx.push({ type: 'note', text: L(`🚚 {0} 给 {1} 送了快递（${goods}）`, `🚚 Delivery guy {0} brought {1} a ${goods}`), sids: [vic.sid, killer.sid] });
    }
  }

  oops(p, r, fx, k) {
    const fall = r() < 0.5;
    fx.push({ type: 'oops', sid: p.sid, fall });
    this.damage(null, p, (7 + r() * 7) * k * (this.party ? 1.5 : 1), { weapon: fall ? L('摔死了', 'Fall damage') : ZONE(), cause: fall ? 'fall' : 'zone' }, fx);
  }

  listen(p, fx) {
    p.focus = 1;
    const near = this.foes(p).sort((a, b) => d2(a, p) - d2(b, p))[0];
    fx.push({ type: 'listen', sid: p.sid, to: near ? near.sid : null });
  }

  /** 舔包：有盒子先舔盒子（快递到了），没有就在房子里搜甲。 */
  lick(p, r, fx) {
    const box = this.field().find((q) => !q.alive && !q.looted && q.diedAt >= this.roundStart);
    let up = false;
    if (box) {
      box.looted = true;
      if (box.armor > p.armor) [p.armor, up] = [box.armor, true];
      p.tier = Math.max(p.tier, box.tier);
    }
    if (!up && p.armor < 3 && (p.armor === 0 || r() < 0.45)) [p.armor, up] = [p.armor + 1, true];
    p.dur = ARMOR[p.armor].dur; // 换上新甲 / 修好旧甲
    fx.push({ type: 'loot', sid: p.sid, armor: p.armor, up, box: box ? box.sid : null });
    if (up && p.armor === 3) fx.push({ type: 'note', text: L('🦺 {0} 舔到了三级甲', '🦺 {0} looted a Level 3 Vest'), sids: [p.sid] });
  }

  nade(p, r, fx) {
    const foes = this.foes(p);
    if (!foes.length) return;
    const t = foes[Math.floor(r() * foes.length)];
    fx.push({ type: 'nade', from: p.sid, to: t.sid });
    this.damage(p, t, (12 + r() * 10) * this.mult(p), { weapon: L('手雷', 'Frag Grenade'), cause: 'nade' }, fx);
  }

  airdrop(p, kind, fx) {
    if (kind === 'awm') p.tier = 3;
    else Object.assign(p, { hp: 100, armor: 3, dur: ARMOR[3].dur, ghillie: 3 });
    fx.push({ type: 'drop', sid: p.sid, kind });
    const text = kind === 'awm' ? L('🪂 {0} 抢到了空投：AWM！', '🪂 {0} grabbed the Airdrop: AWM!') : L('🌿 {0} 捡到空投吉利服：满血三级甲', '🌿 {0} got a Ghillie Suit Airdrop: full HP + Level 3 Vest');
    fx.push({ type: 'note', text, sids: [p.sid] });
  }

  /** 派子代理：四排把成盒的队友扶起来 / 给队友递药；单排就开吉普撞人。 */
  rescue(p, r, fx) {
    const mates = this.squads() ? this.field(p.team).filter((m) => m !== p) : [];
    const box = mates.find((m) => !m.alive && m.diedAt >= this.roundStart);
    if (box) {
      if (box.looted) Object.assign(box, { armor: 0, dur: 0, tier: 0, looted: false }); // 盒子被人舔过，爬起来就是光着的
      Object.assign(box, { alive: true, hp: 30 });
      p.a++;
      fx.push({ type: 'revive', sid: box.sid, by: p.sid });
      return fx.push({ type: 'note', text: L('🤝 {0} 被 {1} 扶起来了：「扶我起来，我还能打！」', '🤝 {1} picked up {0}: "Help me up, I can still fight!"'), sids: [box.sid, p.sid] });
    }
    const low = mates.filter((m) => m.alive).sort((a, b) => a.hp - b.hp)[0];
    if (low && low.hp < 70) return this.medic(low, 30, 'mate', fx); // 队友递的急救包
    const foes = this.foes(p).sort((a, b) => d2(a, p) - d2(b, p));
    if (!foes.length) return;
    fx.push({ type: 'car', from: p.sid, to: foes[0].sid });
    this.damage(p, foes[0], (30 + r() * 15) * this.mult(p), { weapon: L('吉普车', 'UAZ Jeep'), cause: 'car' }, fx);
  }

  medic(p, amount, item, fx) {
    const n = Math.min(amount, 100 - p.hp);
    p.hp += n;
    fx.push({ type: 'heal', sid: p.sid, amount: n, item });
  }

  heal(p, r, fx) {
    const x = r();
    if (x < 0.15) this.medic(p, 100, 'medkit', fx); // 医疗箱
    else if (x < 0.6 && p.hp < 75) this.medic(p, 75 - p.hp, 'aid', fx); // 急救包只能回到 75
    else this.medic(p, 25, 'drink', fx); // 能量饮料
  }

  /** 上下文压缩：被路过的人一锅拍晕，或者跑毒。 */
  bonk(p, r, fx) {
    const foes = this.foes(p);
    if (foes.length && r() < 0.6) {
      const t = foes[Math.floor(r() * foes.length)];
      p.stunUntil = this.now + 10000;
      fx.push({ type: 'shot', from: t.sid, to: p.sid, weapon: 'pan', pan: true });
      fx.push({ type: 'stun', sid: p.sid, by: t.sid });
      this.damage(t, p, 15 * this.mult(t), { weapon: gunName('pan'), cause: 'pan' }, fx);
    } else {
      fx.push({ type: 'runzone', sid: p.sid });
      this.damage(null, p, 10, { weapon: ZONE(), cause: 'zone' }, fx);
    }
  }

  // 它在等你：趴进草丛当伏地魔，及时回它就爬起来，超时被毒死
  onWait(p, fx) {
    if (!p.alive) return;
    p.prone = true;
    fx.push({ type: 'prone', sid: p.sid });
    fx.push({ type: 'note', text: L('🌿 {0} 趴进草丛当伏地魔，等你回复', '🌿 {0} went prone in the grass, waiting for you'), sids: [p.sid] });
  }

  onAnswer(p, wait, fx) {
    p.prone = false;
    if (p.alive) this.medic(p, 10, 'up', fx); // 爬起来了
  }

  onWaitTimeout(p, fx) {
    p.prone = false;
    if (p.alive) this.kill(null, p, { weapon: L('趴草丛被毒死', 'Camped in the Blue Zone'), cause: 'zone' }, fx);
  }

  // ---------------------------------------------------------------- 毒圈

  /**
   * 毒圈只在全局 2 秒格上结算（onTick 里按格补算，补算时把时钟拨到那一格），结果和推进频率无关；
   * 底座会自己准点停在挂机下场 / 等你超时的时刻。所以这里不用登记每一格：
   * 一格一个定时器会把底座每次推进的停靠点用光，长时间没事件时反而漏掉挂机时刻。
   */
  timers() {
    return [];
  }

  onTick(fx) {
    if (!this.circles) return;
    const now = this.now;
    // 按格补结算；结算时把时钟拨到那一格，这样毒死人开新局的时间也和逐帧推进一样
    while (this.phase === 'live' && !this.halted && this.zoneT + TICK <= now) {
      this.zoneT += TICK;
      this.now = this.zoneT;
      this.zoneTick(this.zoneT, fx);
    }
    // 由外壳管理时，一局在半路结束就停在那一格，剩下的时间交给外壳接着推
    if (!this.halted) this.now = now;
    this.flush(fx);
  }

  zoneTick(t, fx) {
    const z = this.zoneAt(t);
    if (z.state === 'drop') return;
    const round = this.round;
    const sec = TICK / 1000;
    for (const p of this.field()) {
      if (!p.alive) continue;
      if (t - p.lastActive > this.idleLimit) continue; // 马上要挂机下场的不算
      const out = z.r <= 0 || d2(p, z) > z.r * z.r;
      p.outside = out;
      if (out) this.damage(null, p, Math.round(z.dps * sec), { weapon: ZONE(), cause: 'zone', tick: true }, fx);
      if (!p.alive) {
        this.flush(fx);
        this.check(fx);
        if (this.round !== round || this.phase !== 'live') return;
      }
    }
    if (z.state === 'final' && z.over >= FINAL_GRACE * this.sp) {
      const up = this.alive().sort((a, b) => b.hp - a.hp || b.rk - a.rk || (a.sid < b.sid ? -1 : 1));
      this.flush(fx);
      if (up.length) this.chicken(up[0], fx, L('决赛圈血量领先', 'Most HP in the final circle'));
    }
  }

  flush(fx) {
    for (const [sid, dmg] of this.acc) if (dmg > 0) fx.push({ type: 'hit', from: null, to: sid, dmg, cause: 'zone' });
    this.acc.clear();
  }

  /** 只剩一个人（四排：只剩一队）就吃鸡。 */
  check(fx) {
    if (!this.circles) return;
    const up = this.alive();
    if ((this.squads() ? new Set(up.map((q) => q.team)).size : up.length) > 1) return;
    const best = up.sort((a, b) => b.rk - a.rk || b.hp - a.hp)[0] || this.lastDead;
    if (best) this.chicken(best, fx);
  }

  chicken(p, fx, why = '') {
    p.wins++;
    fx.push({ type: 'chicken', sid: p.sid });
    const win = L('大吉大利，今晚吃鸡！', 'Winner Winner, Chicken Dinner!');
    const kills = p.rk ? L(`${p.rk} 杀`, `${p.rk} kills`) : L('0 杀苟进决赛圈', 'Zero kills, camped to the final circle');
    fx.push({ type: 'announce', text: win, sub: `${p.name} · ${kills}`, cls: 'gold', ms: 3200 });
    this.endRound(p.team, why ? 'final' : 'chicken', fx, why ? `${why} · ${win}` : win);
  }
}

// ================================================================ 地图：一座海岛，几个经典的跳伞点

const TAU = Math.PI * 2;
const TOWNS = [
  { name: () => L('P 城', 'Pochinki'), x: 760, y: 530, n: 9 },
  { name: () => L('G 港', 'Georgopol'), x: 400, y: 330, n: 10 },
  { name: () => L('Y 城', 'Yasnaya'), x: 1090, y: 300, n: 8 },
  { name: () => L('R 城', 'Rozhok'), x: 740, y: 290, n: 6 },
  { name: () => L('M 城', 'Mylta'), x: 1260, y: 560, n: 7 },
  { name: () => L('学校', 'School'), x: 920, y: 410, n: 0, school: true },
  { name: () => L('军事基地', 'Military Base'), x: 1020, y: 730, n: 4, hangar: true },
  { name: () => L('机场', 'Airport'), x: 430, y: 640, n: 3, runway: true },
];
const ROADS = [
  [[290, 390], [400, 330], [560, 300], [740, 290], [930, 330], [1090, 300], [1270, 280]],
  [[760, 160], [740, 290], [760, 530], [880, 640], [1020, 730], [1120, 830]],
  [[430, 640], [570, 590], [760, 530], [1000, 540], [1260, 560], [1410, 520]],
  [[1090, 300], [1180, 430], [1260, 560]],
];

const disc = (g, x, y, r, color) => {
  g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
};
const circle = (g, x, y, r, color, lw) => {
  [g.strokeStyle, g.lineWidth] = [color, lw];
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
};

function shorePath(g, k) {
  g.beginPath();
  for (let i = 0; i <= 240; i++) {
    const a = (i / 240) * TAU;
    g.lineTo(CX + Math.cos(a) * RX * shore(a) * k, CY + Math.sin(a) * RY * shore(a) * k);
  }
  g.closePath();
}

/** 俯视的小房子：阴影 + 屋顶 + 屋脊。 */
function house(g, x, y, w, h, a, roof) {
  g.save(); g.translate(x, y); g.rotate(a);
  for (const [col, dx, dy, hh] of [['rgba(20,30,10,0.3)', 4, 5, h], [roof, 0, 0, h], ['rgba(255,255,255,0.18)', 0, 0, h / 2]]) {
    g.fillStyle = col; g.fillRect(-w / 2 + dx, -h / 2 + dy, w, hh);
  }
  [g.strokeStyle, g.lineWidth] = ['rgba(0,0,0,0.3)', 1.2];
  g.strokeRect(-w / 2, -h / 2, w, h); g.restore();
}

function drawIsland() {
  const c = document.createElement('canvas');
  [c.width, c.height] = [W * 2, H * 2];
  const g = c.getContext('2d');
  g.scale(2, 2);
  const r = rng(11);
  g.fillStyle = '#1c5a86'; g.fillRect(0, 0, W, H);
  [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.09)', 1.5];
  for (let i = 0; i < 170; i++) {
    g.beginPath(); g.arc(r() * W, r() * H, 6 + r() * 10, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); // 海浪
  }
  // 浅水、沙滩、草地
  for (const [k, col] of [[1.08, 'rgba(90,185,205,0.45)'], [1, '#e3d09a'], [0.95, '#6b984a']]) {
    g.fillStyle = col;
    shorePath(g, k);
    g.fill();
  }
  g.save();
  shorePath(g, 0.95);
  g.clip();
  for (let i = 0; i < 900; i++) disc(g, r() * W, r() * H, 8 + r() * 30, r() < 0.5 ? 'rgba(40,80,20,0.12)' : 'rgba(170,210,110,0.1)');
  // 麦田
  for (let i = 0; i < 16; i++) house(g, ...toLand(CX + (r() - 0.5) * RX * 1.8, CY + (r() - 0.5) * RY * 1.8, 0.85), 50 + r() * 70, 34 + r() * 40, r() - 0.5, 'rgba(190,185,90,0.45)');
  // 公路
  for (const road of ROADS) {
    const pts = road.map(([x, y]) => toLand(x, y, 0.97));
    for (const [w, col, dash] of [[13, '#9b8763', []], [10, '#b9a57c', []], [1.5, 'rgba(255,250,220,0.6)', [10, 10]]]) {
      [g.strokeStyle, g.lineWidth, g.lineJoin, g.lineCap] = [col, w, 'round', 'round'];
      g.setLineDash(dash); g.beginPath();
      for (const [x, y] of pts) g.lineTo(x, y);
      g.stroke();
    }
    g.setLineDash([]);
  }
  // 城镇：机场跑道、学校、军事基地的机库、普通民房
  const roofs = ['#a5533f', '#7d6a5a', '#8b9096', '#b86d3e', '#5f6f7d'];
  for (const t of TOWNS) {
    if (t.runway) house(g, t.x, t.y, 320, 32, -0.35, '#7d7f80');
    if (t.school) house(g, t.x, t.y, 74, 44, 0.1, '#9a8f84');
    for (let i = 0; i < t.n; i++) {
      const a = r() * TAU;
      const d = 18 + r() * 52;
      const [hx, hy] = [t.x + Math.cos(a) * d, t.y + Math.sin(a) * d * 0.8];
      if (t.hangar) house(g, hx, hy, 52, 30, (r() - 0.5) * 0.3, '#6c7a6a');
      else house(g, hx, hy, 16 + r() * 14, 13 + r() * 10, (r() - 0.5) * 0.6, roofs[Math.floor(r() * roofs.length)]);
    }
  }
  // 树
  for (let i = 0; i < 520; i++) {
    const [x, y] = [r() * W, r() * H];
    const s = 6 + r() * 6;
    const dark = r() < 0.5;
    if (toLand(x, y, 0.9)[0] !== x || TOWNS.some((t) => (t.x - x) ** 2 + (t.y - y) ** 2 < 85 ** 2)) continue;
    disc(g, x + 3, y + 4, s, 'rgba(15,35,10,0.3)');
    disc(g, x, y, s, dark ? '#3f6e2d' : '#36602a');
    disc(g, x - s / 3, y - s / 3, s / 2.5, 'rgba(170,220,120,0.25)');
  }
  g.restore();
  // 地图网格和地名（像游戏里的大地图）
  [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.07)', 1];
  for (let x = 0; x <= W; x += 160) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 160) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  [g.textAlign, g.textBaseline, g.font, g.lineWidth] = ['center', 'middle', `800 17px ${FONT}`, 4];
  [g.strokeStyle, g.fillStyle] = ['rgba(20,30,20,0.55)', 'rgba(255,255,255,0.88)'];
  for (const t of TOWNS) {
    g.strokeText(t.name(), t.x, t.y - 62);
    g.fillText(t.name(), t.x, t.y - 62);
  }
  return c;
}

// ================================================================ 画面

const PLANE_RT = 3.2; // 飞机飞过去的真实秒数（倍速高时跟着源时间更快）
const CHUTE_RT = 1.1; // 跳伞落地的真实秒数
// 飘字：type → [文字, 颜色]
const SAY = {
  gun: (f) => [`🔫 ${gunName(f.gun)}`, '#ffe08a'],
  armorBreak: (f) => [L(`💥 ${armorName(f.armor)}碎了`, `💥 ${armorName(f.armor)} broke`), '#c9d6ff'],
  oops: (f) => (f.fall ? [L('🦵 摔了一跤', '🦵 Fall damage'), '#ffb38a'] : [L('☠️ 吃了口毒', '☠️ Zone tick'), '#a9c6ff']),
  runzone: () => [L('🏃 跑毒', '🏃 Outrunning the zone'), '#a9c6ff'],
  prone: () => [L('🌿 伏地魔', '🌿 Grass snake mode'), '#9fe07a'],
  stun: () => [L('💫 被平底锅拍晕了', '💫 Pan-stunned'), '#ffe08a'],
  lag: () => [L('📡 460ms 卡成 PPT', '📡 460 ping, slideshow mode'), '#ff8a8a'],
  revive: () => [L('🤝 扶我起来，我还能打！', '🤝 Help me up, I can still fight!'), '#6fd38b'],
  drop: (f) => [f.kind === 'awm' ? L('🪂 空投：AWM！', '🪂 Airdrop: AWM!') : L('🪂 空投吉利服！', '🪂 Airdrop: Ghillie Suit!'), '#ff9a8a'],
  loot: (f) => [f.box ? L('📦 舔包', '📦 Looted a box') : `🦺 ${armorName(f.armor)}`, ARMOR[f.armor].color],
  heal: (f) => [`${{ medkit: '🧰', drink: '🥤' }[f.item] || '🩹'} +${f.amount}`, '#6fd38b'],
};
const QUIET = new Set(['gun', 'loot', 'heal']); // 倍速很高时不飘这些字
// 光环：type → [起始半径, 结束半径, 颜色, 时长, 线宽]
const RING = {
  loot: (f) => [6, 30, ARMOR[f.armor].color, 0.5, 2],
  heal: () => [30, 6, 'rgba(111,211,139,0.9)', 0.5, 3],
  revive: () => [70, 10, 'rgba(255,255,255,0.9)', 0.6, 4],
  listen: () => [10, 60, 'rgba(180,230,255,0.8)', 0.6, 2],
  chicken: () => [10, 120, 'rgba(255,215,90,0.95)', 1, 6],
  waitBoom: () => [10, 90, 'rgba(120,170,255,0.9)', 0.8, 8],
};
const ICON = { stun: '💫', lag: '📡', abort: '✋' };
const DEATH = {
  early: () => [L('📦 落地成盒', '📦 Landed, looted, boxed'), '#ffd27a'],
  zone: () => [L('☠️ 被毒死了', '☠️ Died to the Blue Zone'), '#a9c6ff'],
  human: () => [L('✋ 被你淘汰', '✋ Eliminated by you'), '#fff'],
  other: () => [L('💀 成盒', '💀 Boxed'), '#fff'],
};
// 没打中的原因：描边 / 吉利服看不见 / 被拍晕了打歪
const MISS = { trace: () => L('描边', 'Missed!'), ghillie: () => L('🌿 没看见', "🌿 Where'd he go?"), dazed: () => L('💫 打歪了', '💫 Dazed miss') };

class Bot {
  constructor(sid, team, x, y) {
    Object.assign(this, { sid, team, x, y, angle: Math.random() * TAU, wx: 0, wy: 0, hold: 0, hitT: 0, muzzle: 0, awm: 0 });
    this.label = null;
    this.icon = null;
    this.dead = false; // 成盒（回合结束动画期间先保持）
    this.air = null; // 跳伞中：{ f 跳伞时机, t 落地进度, sx, sy }
  }

  update(dt, p, active, frozen) {
    for (const k of ['hitT', 'muzzle', 'awm']) this[k] = Math.max(0, this[k] - dt);
    if (this.label && (this.label.life -= dt) <= 0) this.label = null;
    if (this.icon && (this.icon.life -= dt) <= 0) this.icon = null;
    if (frozen || this.dead || this.air || p.prone) return;
    if (active && (this.hold -= dt) <= 0) [this.hold, this.wx, this.wy] = [rand(0.8, 2.5), rand(-26, 26), rand(-26, 26)];
    // 跟着规则层的位置跑（落后太多就跑快点，倍速高时也跟得上）
    const dx = p.x + this.wx - this.x;
    const dy = p.y + this.wy - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const step = Math.min(dist, (90 + dist * 2.5) * dt) / dist;
    this.x += dx * step;
    this.y += dy * step;
    let diff = Math.atan2(dy, dx) - this.angle;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    if (dist > 4) this.angle += diff * Math.min(1, dt * 8);
  }
}

// 地图上画着地名，所以每种语言各缓存一张
const LAYERS = {};
const islandLayer = () => (LAYERS[L('zh', 'en')] ||= drawIsland());

export class View {
  constructor(app) {
    this.app = app;
    islandLayer();
    this.fx = new Particles();
    this.bots = new Map();
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    this.bots.clear();
    Object.assign(this, { crates: [], plane: null, winner: null, resetAt: 0, frozenZone: null, lastZone: null });
    if (!R) return;
    for (const p of R.field()) this.bot(R, p.sid);
    if (R.phase === 'live' && R.circles && R.now - R.roundStart < DROP * R.sp) this.startDrop(R);
  }

  bot(R, sid) {
    let b = this.bots.get(sid);
    const p = R.players.get(sid);
    if (!b && p && p.onField) {
      b = new Bot(sid, p.team, p.x, p.y);
      b.dead = !p.alive;
      if (this.plane) b.air = { f: p.jump, t: -1 };
      this.bots.set(sid, b);
    }
    return b;
  }

  /** 新的一局：飞机沿航线飞过去，大家飞到自己落点附近就跳伞。 */
  startDrop(R) {
    this.plane = { t0: this.app.rt(), ...R.flight };
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      Object.assign(b, { dead: p ? !p.alive : false, air: { f: p ? p.jump : 0.5, t: -1 } });
      if (p) [b.x, b.y] = [p.dx, p.dy];
    }
  }

  planeK(R) {
    if (!this.plane) return 2;
    return Math.max((this.app.rt() - this.plane.t0) / PLANE_RT, (R.now - R.roundStart) / (DROP * R.sp * 0.7));
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    for (const f of list) {
      const b = f.sid ? this.bot(R, f.sid) : null;
      if (b && SAY[f.type] && !(busy && QUIET.has(f.type))) fx.text(b.x, b.y - 28, ...SAY[f.type](f), 14, 1.4);
      if (b && RING[f.type]) fx.ring(b.x, b.y, ...RING[f.type](f));
      if (b && ICON[f.type]) b.icon = { text: ICON[f.type], life: 2.2 };
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (b && text && !(busy && f.ev.k === 'read')) b.label = { text, ok: f.ev.ok !== false, life: 1.7, ghost: !f.alive };
          break;
        }
        case 'bench': this.bots.delete(f.sid); break;
        case 'shot': this.shot(R, f, busy); break;
        case 'hit': this.hit(R, f, busy); break;
        case 'revive':
          if (b) b.dead = false;
          break;
        case 'kill': {
          const v = this.bot(R, f.victim);
          if (!v) break;
          v.dead = true;
          fx.sparks(v.x, v.y, COLOR[v.team], 12, 180);
          fx.text(v.x, v.y - 34, ...DEATH[f.early ? 'early' : DEATH[f.cause] ? f.cause : 'other'](), 16, 1.7);
          break;
        }
        case 'panBlock':
          if (!b) break;
          fx.text(b.x, b.y - 30, L('铛！屁股上的锅挡住了', 'CLANG! Butt-pan saves the day'), '#ffe08a', 15, 1.5);
          fx.sparks(b.x, b.y, '#fff6c0', 10, 200);
          this.clang();
          break;
        case 'drop':
          if (b) this.crates.push({ x: b.x + rand(-40, 40), y: b.y + rand(-40, 40), t: busy ? 1 : 0, smoke: busy ? 0 : 6, kind: f.kind });
          if (this.crates.length > 12) this.crates.shift();
          break;
        case 'chicken':
          this.winner = f.sid;
          if (b) fx.sparks(b.x, b.y, '#ffd75a', 30, 260);
          break;
        case 'roundEnd':
          this.frozenZone = this.lastZone;
          this.resetAt = app.rt() + (busy ? 0.4 : 2.2);
          break;
        case 'flight':
          if (!this.resetAt) this.startDrop(R);
          break;
      }
    }
  }

  shot(R, f, busy) {
    const from = this.bot(R, f.from);
    if (!from || from.dead || from.air) return;
    const to = f.to ? this.bot(R, f.to) : null;
    let [tx, ty] = to ? [to.x, to.y] : [from.x + Math.cos(from.angle) * 140, from.y + Math.sin(from.angle) * 140];
    if (to && f.miss) {
      // 描边：子弹擦着人飞过去
      const a = Math.atan2(ty - from.y, tx - from.x) + (Math.random() < 0.5 ? -1 : 1) * rand(0.12, 0.3);
      const d = Math.hypot(tx - from.x, ty - from.y) + 30;
      [tx, ty] = [from.x + Math.cos(a) * d, from.y + Math.sin(a) * d];
      if (!busy && MISS[f.why]) this.fx.text(to.x + rand(-10, 10), to.y - 20, MISS[f.why](), '#ddd', 13);
    }
    from.angle = Math.atan2(ty - from.y, tx - from.x);
    if (f.pan) {
      if (to && !f.miss) [from.x, from.y] = [(from.x + to.x) / 2, (from.y + to.y) / 2]; // 平底锅：冲过去拍
      return;
    }
    const snipe = f.weapon === 'awm' || f.weapon === 'k98';
    from.muzzle = 0.07;
    if (snipe) from.awm = 0.5;
    this.fx.tracer(from.x + Math.cos(from.angle) * 18, from.y + Math.sin(from.angle) * 18, tx, ty,
      snipe ? 'rgba(255,255,255,0.95)' : 'rgba(255,230,150,0.9)', snipe ? 3 : 1.6, snipe ? 0.4 : 0.14);
    this.app.sfx.shot(snipe ? 'AWM' : 'M416');
  }

  hit(R, f, busy) {
    const to = this.bot(R, f.to);
    if (!to) return;
    const { fx, app } = this;
    to.hitT = 0.18;
    if (f.cause === 'pan') {
      fx.text(to.x, to.y - 26, L('铛！', 'CLANG!'), '#ffe08a', 22, 1.2);
      fx.sparks(to.x, to.y, '#fff6c0', busy ? 4 : 12, 220);
      this.clang();
    } else if (f.cause === 'nade' || f.cause === 'car') {
      fx.explosion(to.x, to.y, false);
      const what = f.cause === 'car' ? L('🚙 吉普车撞人', '🚙 Run over') : L('💣 手雷', '💣 Frag');
      fx.text(to.x, to.y - 18, `${what} -${f.dmg}`, '#ffcf6b', 15);
      app.sfx.boom(false);
    } else if (f.hs) {
      fx.text(to.x, to.y - 24, L('🎯 爆头', '🎯 Headshot'), '#f5c451', 18, 1.3);
      app.sfx.headshot();
    } else {
      const zone = f.cause === 'zone';
      if (!busy || zone) fx.text(to.x + rand(-8, 8), to.y - 18, `${zone ? '☠ ' : ''}-${f.dmg}`, zone ? '#9fc0ff' : f.cause === 'fall' ? '#ffb38a' : '#fff', 13);
      fx.sparks(to.x, to.y, zone ? 'rgba(120,170,255,0.9)' : '#ffe2b0', busy ? 1 : 4, zone ? 60 : 120);
    }
  }

  /** 平底锅的声音：铛！ */
  clang() {
    const s = this.app.sfx;
    if (!s.ok(2)) return;
    s.tone(1250, 0.4, 0.22, 'triangle', 1180);
    s.tone(2630, 0.3, 0.1, 'sine', 2480);
  }

  update(dt, R) {
    const live = this.app.mode === 'live';
    const frozen = !!this.resetAt;
    const k = this.planeK(R);
    for (const b of this.bots.values()) {
      const p = R.players.get(b.sid);
      if (!p) continue;
      if (b.air && !frozen) {
        // 跳伞：飞机飞到落点附近就跳，降落伞慢慢落到落点
        if (b.air.t < 0 && k >= b.air.f) {
          const f = this.plane || R.flight;
          Object.assign(b.air, { t: 0, sx: f.x1 + (f.x2 - f.x1) * b.air.f, sy: f.y1 + (f.y2 - f.y1) * b.air.f });
        }
        if (b.air.t >= 0) {
          const e = Math.min(1, (b.air.t += dt / CHUTE_RT));
          [b.x, b.y] = [b.air.sx + (p.dx - b.air.sx) * e, b.air.sy + (p.dy - b.air.sy) * e];
          if (e >= 1) b.air = null;
        }
        if (k > 1.6) [b.air, b.x, b.y] = [null, p.x, p.y];
      }
      b.update(dt, p, R.now - p.lastActive < (live ? 60e3 : 90e3), frozen);
    }
    if (this.plane && k > 1.6) this.plane = null;
    this.fx.update(dt);
    for (const c of this.crates) {
      c.t = Math.min(1, c.t + dt / 1.4);
      if (c.t >= 1 && (c.smoke -= dt) > 0 && Math.random() < dt * 14) this.fx.smoke(c.x + rand(-3, 3), c.y - 6, 1, 9, 'rgba(235,60,50,0.55)'); // 落地冒红烟
    }
    if (this.resetAt && this.app.rt() >= this.resetAt) {
      Object.assign(this, { resetAt: 0, frozenZone: null, winner: null, crates: [] });
      for (const [sid] of this.bots) if (!R.players.get(sid)?.onField) this.bots.delete(sid);
      for (const p of R.field()) this.bot(R, p.sid);
      if (R.phase === 'live' && R.circles) this.startDrop(R);
      else for (const b of this.bots.values()) b.dead = false;
    }
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(islandLayer(), 0, 0, W, H);
    const z = this.frozenZone || (R.phase === 'live' ? R.zoneAt(R.now) : null);
    if (!this.frozenZone) this.lastZone = z;
    this.drawZone(g, z, rt);
    for (const c of this.crates) this.drawCrate(g, c, rt);
    const shown = [...this.bots.values()].filter((b) => R.players.get(b.sid) && !(b.air && b.air.t < 0)); // 还在飞机上的不画
    for (const b of shown) if (b.dead) this.drawBox(g, b);
    this.fx.renderUnder(g);
    for (const b of shown) {
      if (b.air) this.drawChute(g, b);
      else if (!b.dead) this.drawBot(g, b, R.players.get(b.sid), rt);
    }
    this.drawPlane(g, R);
    this.fx.renderOver(g, scale);
    const fs = fontFor(scale);
    const live = this.app.mode === 'live';
    for (const b of shown) {
      const p = R.players.get(b.sid);
      this.drawTags(g, b, p, R.now - p.lastActive < (live ? 60e3 : 90e3), fs, rt);
    }
  }

  /** 毒圈：圈外一层蓝，白圈是当前安全区，虚线是下一个圈。 */
  drawZone(g, z, rt) {
    if (!z) return;
    g.fillStyle = 'rgba(45,105,255,0.22)'; g.beginPath(); g.rect(0, 0, W, H);
    if (z.r > 0) {
      g.moveTo(z.x + z.r, z.y); g.arc(z.x, z.y, z.r, 0, TAU);
    }
    g.fill('evenodd');
    if (z.r > 0) {
      circle(g, z.x, z.y, z.r + 4, `rgba(110,160,255,${0.45 + 0.2 * Math.sin(rt * 5)})`, 9);
      circle(g, z.x, z.y, z.r, '#fff', 3);
    }
    if (z.next && z.state !== 'drop' && z.next.r > 0) {
      g.setLineDash([12, 9]);
      circle(g, z.next.x, z.next.y, z.next.r, 'rgba(255,255,255,0.85)', 2);
      g.setLineDash([]);
    }
  }

  drawPlane(g, R) {
    const k = this.planeK(R);
    if (!this.plane || k > 1.25) return;
    const f = this.plane;
    [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.35)', 2];
    g.setLineDash([6, 10]);
    g.beginPath(); g.moveTo(f.x1, f.y1); g.lineTo(f.x2, f.y2); g.stroke(); // 航线
    g.setLineDash([]); g.save(); g.translate(f.x1 + (f.x2 - f.x1) * k, f.y1 + (f.y2 - f.y1) * k);
    g.rotate(Math.atan2(f.y2 - f.y1, f.x2 - f.x1) + Math.PI / 4); // ✈️ 本身朝右上
    emoji(g, '✈️', 0, 0, 60);
    g.restore();
  }

  drawChute(g, b) {
    const s = 1.6 - 0.6 * clamp(b.air.t, 0, 1);
    disc(g, b.x, b.y, 5 * s, COLOR[b.team]);
    emoji(g, '🪂', b.x, b.y - 16 * s, 26 * s);
  }

  drawBot(g, b, p, rt) {
    const rad = 12;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(b.x + 3, b.y + 5, rad + 2, rad - 2, 0, 0, TAU); g.fill();
    g.save(); g.translate(b.x, b.y); g.rotate(b.angle);
    if (p.tier === 0) {
      // 平底锅
      g.fillStyle = '#5b5b60'; g.fillRect(8, -2, 12, 4);
      disc(g, 25, 0, 7, '#2d2d31');
      circle(g, 25, 0, 7, '#8a8a90', 1.5);
    } else {
      const len = b.awm > 0 || p.tier === 3 ? 30 : p.tier === 2 ? 22 : 17;
      g.fillStyle = '#26262a'; g.fillRect(6, -3, len, 6);
      if (b.muzzle > 0) disc(g, 8 + len, 0, 6, '#fff3a0');
    }
    g.restore();
    disc(g, b.x, b.y, rad, b.hitT > 0 ? '#ff5a5a' : COLOR[b.team]);
    circle(g, b.x, b.y, rad, DEEP[b.team], 3);
    if (p.armor > 0) circle(g, b.x, b.y, rad + 4, ARMOR[p.armor].color, 2.5); // 甲：一级灰、二级蓝、三级紫
    if (p.ghillie > 0) {
      g.setLineDash([3, 3]); // 吉利服：一圈毛茸茸的草
      circle(g, b.x, b.y, rad + 5, '#4f7d2f', 6);
      g.setLineDash([]);
    }
    if (p.prone) emoji(g, '🌿', b.x, b.y + 4, 30); // 伏地魔：趴在草丛里
    if (p.outside) disc(g, b.x, b.y, rad + 6, `rgba(90,140,255,${0.25 + 0.15 * Math.sin(rt * 6)})`);
    if (this.winner === b.sid) emoji(g, '🍗', b.x, b.y - 58 - Math.abs(Math.sin(rt * 4)) * 8, 34);
  }

  /** 成盒：变成一个小箱子。 */
  drawBox(g, b) {
    for (const [col, y, h] of [['#9a7444', -8, 15], [COLOR[b.team], -3, 4]]) {
      g.fillStyle = col; g.fillRect(b.x - 10, b.y + y, 20, h);
    }
    [g.strokeStyle, g.lineWidth] = ['#5d4220', 1.5];
    g.strokeRect(b.x - 10, b.y - 8, 20, 15);
  }

  /** 空投箱：挂着降落伞落下来，落地冒红烟。 */
  drawCrate(g, c, rt) {
    const h = (1 - c.t) * 260;
    if (c.t < 1) emoji(g, '🪂', c.x, c.y - h - 26, 34);
    for (const [col, x, y, w, hh] of [['rgba(0,0,0,0.25)', -11, h - 5, 26, 18], ['#d24a3c', -13, -10, 26, 20], ['#3b6fd8', -13, -2, 26, 4]]) {
      g.fillStyle = col; g.fillRect(c.x + x, c.y - h + y, w, hh);
    }
    if (c.kind === 'ghillie') emoji(g, '🌿', c.x, c.y - h - 20 + Math.sin(rt * 3) * 2, 14);
  }

  drawTags(g, b, p, active, fs, rt) {
    const y = b.y - 30;
    const alive = !b.dead;
    g.globalAlpha = alive ? 1 : 0.5;
    pill(g, b.x, y, p.name, { color: COLOR[b.team], size: fs, max: 120 });
    if (alive && !b.air) hpBar(g, b.x, b.y + 17, 34, p.hp / 100);
    g.globalAlpha = 1;
    if (b.label) {
      g.globalAlpha = Math.min(1, b.label.life / 0.4) * (b.label.ghost ? 0.45 : 1);
      pill(g, b.x, y - fs - 8 - (1.7 - b.label.life) * 6, b.label.text, {
        size: fs - 1, max: 190, weight: 500, bg: b.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)',
      });
    }
    if (!active && alive && !b.air) {
      [g.fillStyle, g.font] = ['rgba(255,255,255,0.8)', `700 ${fs}px sans-serif`];
      const k = (rt * 0.6 + b.x) % 1;
      g.globalAlpha = 1 - k; g.fillText('z', b.x + 16 + k * 8, b.y - 12 - k * 18);
    }
    g.globalAlpha = 1;
    if (b.icon) emoji(g, b.icon.text, b.x, b.y - 56, fs + 10);
  }

  hud(R) {
    if (R.phase !== 'live' || !R.circles) return null;
    const z = R.zoneAt(R.now);
    const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    const t = mmss(z.left);
    const n = R.alive().length;
    const sub = {
      drop: L(`航线中 · ${t} 后刷圈`, `On the plane · zone in ${t}`),
      wait: L(`第 ${z.phase} 个圈 · ${t} 后缩圈`, `Zone ${z.phase} · shrinks in ${t}`),
      shrink: L(`第 ${z.phase} 个圈 · 正在缩圈 ${t}`, `Zone ${z.phase} · shrinking ${t}`),
      final: L('决赛圈 · 全员吃毒', 'Final circle · everyone in the zone'),
    };
    return { mid: L(`剩余 ${n} 人`, `${n} alive`), sub: sub[z.state] };
  }
}
