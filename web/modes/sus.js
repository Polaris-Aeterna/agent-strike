// Among Us · 太空狼人杀：一队当船员做任务，一队当内鬼混在船上刀人，每局交换。
// 跑命令 = 做任务 / 刀人；读文件 = 看监控；上网 = 管理室地图 / 破坏反应堆；它在等你 = 拍紧急按钮。
// 开会投票是这个模式的灵魂：够可疑就投出内鬼，不够可疑……「X 不是内鬼。」
import { Rules as Base, OTHER, COLOR, TEAM_NAME, WORLD, rng, hash, clamp, actText } from '../core.js';
import { Particles, rand, pill, fitText, emoji, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'sus',
  icon: '🔪',
  get name() { return L('Among Us · 太空狼人杀', 'Among Us'); },
  get desc() { return L('一队当船员做任务，一队当内鬼混在船上刀人，每局交换。开会投票：「X 不是内鬼。」', 'One team does tasks, the other hides among them as Impostors; swap every game. Then the vote: "X was not The Impostor."'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('🚨 {a} 在等你回复', '🚨 {a} is waiting for you'),
      sub: L('船员会拍下紧急按钮开会；40 秒不回，挂机的人要出事', 'Crewmates hit the Emergency Button; no reply in 40s and the AFK one is in trouble'),
      done: L('✂️ 及时回复', '✂️ Replied in time'),
      boom: L('💀 {a} 挂机太久了（船员会被刀，内鬼会露馅）', '💀 {a} went AFK too long (crewmates get stabbed, Impostors look sus)'),
    };
  },
  get legend() {
    return [
      [L('🧑‍🚀 船员 · 跑命令 / 改代码', '🧑‍🚀 Crew · run / edit'), L('做任务，填满任务条', 'Do tasks, fill the task bar')],
      [L('🎯 船员 · 测试通过', '🎯 Crew · tests pass'), L('一次完成大任务（还能自证清白）', 'Big visual task (proves innocence)')],
      [L('📹 船员 · 读文件', '📹 Crew · read files'), L('看监控：盯上可疑的人，发现尸体就报告', 'Watch cams: spot the sus one, report bodies')],
      [L('🗺️ 船员 · 上网', '🗺️ Crew · web'), L('打开管理室地图', 'Check the Admin map')],
      [L('🤝 船员 · 派出子代理', '🤝 Crew · subagent'), L('结伴同行，挡下一刀', 'Buddy up — blocks the next kill')],
      [L('🔪 内鬼 · 跑命令', '🔪 Impostor · run a command'), L('刀冷却好了就刀人，留下半截尸体', 'Kill when the cooldown is ready')],
      [L('🕳️ 内鬼 · 改代码', '🕳️ Impostor · edit'), L('钻通风管（降低嫌疑）', 'Vent (less sus)')],
      [L('☢️ 内鬼 · 上网', '☢️ Impostor · web'), L('破坏反应堆，船员修不好就赢', 'Sabotage the reactor — unfixed means victory')],
      [L('🔪 内鬼 · 任务完成', '🔪 Impostor · task done'), L('双杀', 'Double Kill')],
      [L('🐛 报错', '🐛 Error'), L('船员：刷卡太快了；内鬼：被人看见了', 'Crew: "Too fast. Try again." · Impostor: seen, sus!')],
      [L('🚨 它在等你', '🚨 Waiting on you'), L('紧急会议！', 'EMERGENCY MEETING!')],
      [L('🗳️ 开会投票', '🗳️ Voting'), L('够可疑就投出内鬼，不然……「X 不是内鬼。」', 'Sus enough → ejected. Otherwise… "X was not The Impostor."')],
    ];
  },
};

// ================================================================ 飞船（规则和画面共用的房间表）

// i18n-dict-start
const ROOMS = {
  ueng: { zh: '上引擎', en: 'Upper Engine', r: [190, 90, 230, 170], floor: '#8b8f86' }, reactor: { zh: '反应堆', en: 'Reactor', r: [24, 350, 180, 250], floor: '#6f7f8a' },
  sec: { zh: '监控室', en: 'Security', r: [380, 400, 140, 150], floor: '#7b8794' }, leng: { zh: '下引擎', en: 'Lower Engine', r: [190, 690, 230, 170], floor: '#8b8f86' },
  medbay: { zh: '医疗室', en: 'MedBay', r: [500, 280, 170, 150], floor: '#8fb2bf' }, caf: { zh: '餐厅', en: 'Cafeteria', r: [640, 66, 360, 250], floor: '#a3adb8' },
  weapons: { zh: '武器室', en: 'Weapons', r: [1100, 80, 200, 170], floor: '#8e9aa3' }, o2: { zh: '氧气室', en: 'O2', r: [1120, 350, 150, 110], floor: '#8fa89a' },
  nav: { zh: '导航室', en: 'Navigation', r: [1410, 360, 170, 210], floor: '#8796a8' }, admin: { zh: '管理室', en: 'Admin', r: [930, 400, 170, 150], floor: '#9d9a86' },
  storage: { zh: '储藏室', en: 'Storage', r: [650, 570, 230, 330], floor: '#968b78' }, elec: { zh: '电力室', en: 'Electrical', r: [450, 580, 160, 130], floor: '#878a7c' },
  comms: { zh: '通讯室', en: 'Communications', r: [960, 770, 170, 140], floor: '#8c96a0' }, shields: { zh: '护盾室', en: 'Shields', r: [1200, 650, 200, 170], floor: '#8f99a8' },
};
const TASKS = [
  ['admin', '刷卡', 'Swipe Card'], ['admin', '上传数据', 'Upload Data'], ['elec', '接电线', 'Fix Wiring'],
  ['elec', '校准分配器', 'Calibrate Distributor'], ['elec', '分配电力', 'Divert Power'], ['o2', '清理过滤网', 'Clean O2 Filter'],
  ['caf', '下载数据', 'Download Data'], ['storage', '倒垃圾', 'Empty Garbage'], ['storage', '给引擎加油', 'Fuel Engines'],
  ['ueng', '校准引擎输出', 'Align Engine Output'], ['leng', '校准引擎输出', 'Align Engine Output'], ['nav', '稳定航向', 'Stabilize Steering'],
  ['nav', '规划航线', 'Chart Course'], ['reactor', '解锁歧管', 'Unlock Manifolds'], ['medbay', '检查样本', 'Inspect Sample'],
  ['comms', '下载数据', 'Download Data'], ['weapons', '下载数据', 'Download Data'], ['shields', '分配电力', 'Accept Diverted Power'],
];
const BIG = [['medbay', '提交扫描', 'Submit Scan'], ['weapons', '清理小行星', 'Clear Asteroids'], ['reactor', '启动反应堆', 'Start Reactor'], ['shields', '开启护盾', 'Prime Shields']];
// 船员不够时，用经典配色的路人船员凑满一船（红色永远在场，因为红色很可疑）
const NPCS = [
  ['red', '红色', 'Red', '#c51111'], ['lime', '黄绿色', 'Lime', '#50ef39'], ['pink', '粉色', 'Pink', '#ed54ba'], ['yellow', '黄色', 'Yellow', '#f5f557'],
  ['white', '白色', 'White', '#d6e0f0'], ['purple', '紫色', 'Purple', '#6b2fbb'], ['green', '绿色', 'Green', '#117f2d'], ['black', '黑色', 'Black', '#3f474e'],
];
// i18n-dict-end
const ROOM_IDS = Object.keys(ROOMS);
const VENT_ROOMS = ['reactor', 'ueng', 'leng', 'sec', 'medbay', 'elec', 'caf', 'admin', 'nav', 'weapons', 'shields'];
const CAM_ROOMS = new Set(['ueng', 'medbay', 'admin', 'nav', 'storage']); // 监控拍得到的房间
const roomName = (id) => L(ROOMS[id].zh, ROOMS[id].en);
const ACT = new Set(['shell', 'read', 'edit', 'web', 'misc', 'agent']);
// 每种动作做多少任务（乘上 cfg.task 和均衡系数）
const WORK = { shell: 1, edit: 1.2, misc: 0.8, big: 3.5, done: 2.5, prompt: 0.6, agent: 0.4, answer: 0.8, pr: 4, ghost: 0.5 };
const pick = (r, list) => list[Math.floor(r() * list.length)];

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { roundLen: 12 * 60e3 };

  init() {
    this.goal = 100;
    this.roundLen = this.opts.party ? 6 * 60e3 : this.opts.roundLen;
    // 大乱斗：任务条更短、刀冷却更快、开会更勤
    this.cfg = this.opts.party
      ? { task: 6, charge: 12, cam: 11, meetEvery: 9, sabLen: 5, sabMs: 45e3, sabCd: 6, innocent: 0.55, crewMax: 6 }
      : { task: 4.3, charge: 6.2, cam: 6.5, meetEvery: 16, sabLen: 7, sabMs: 60e3, sabCd: 10, innocent: 0.5, crewMax: 8 };
    this.setup();
  }

  setup() {
    // 单独玩时每局交换；大乱斗每关都是新的一局，就用开局时刻决定谁当内鬼
    const flip = this.opts.party ? hash(`sus${this.now}`) & 1 : 0;
    this.crewTeam = (this.round + flip) % 2 === 1 ? 'claude' : 'codex';
    this.impTeam = OTHER[this.crewTeam];
    // charge：内鬼的刀，攒到 100 就能刀人（全队共用一把）；sab：反应堆熔毁 { clock, len, fix, until }
    Object.assign(this, { task: 0, charge: 0, bodies: [], sab: null, sabCd: 3, lights: 0, cams: 0, meetClock: 0, meetings: 0, lastImp: null, npcs: [] });
  }

  /** 路人船员：不是会话，不做任务，只会到处走、被刀、被冤枉。像正经房间那样每个内鬼配四五个船员。 */
  topUp() {
    const want = clamp(2 + 2 * this.field(this.impTeam).length, 4, this.cfg.crewMax);
    const r = rng(hash(`npc:${this.round}:${this.now}:${this.npcs.length}`));
    while (this.crewSize() < want && this.npcs.length < NPCS.length) {
      const free = NPCS.filter(([id]) => !this.npcs.some((n) => n.sid === `npc:${id}`));
      const [id, zh, en, color] = free[0][0] === 'red' ? free[0] : pick(r, free);
      this.npcs.push({
        sid: `npc:${id}`, npc: true, zh, en, color, team: this.crewTeam, alive: true, sus: id === 'red' ? 12 : r() * 8, buddy: false, room: 'caf', susBy: new Map(), k: 0, d: 0, a: 0,
        get name() { return L(this.zh, this.en); },
      });
    }
  }

  initPlayer(p) { Object.assign(p, { sus: 0, susBy: new Map(), buddy: false, room: 'caf', deadRound: -1 }); }

  onEnter(p) {
    // 这一局已经死过 / 被投出去的人，挂机回来也只能当鬼
    if (p.deadRound === this.round) p.alive = false;
    p.room = 'caf';
    if (this.phase === 'live') this.topUp(); // 半路来了内鬼：再叫几个路人船员上船
  }

  onRoundStart(fx) {
    this.setup();
    for (const p of this.field()) Object.assign(p, { alive: true, sus: 0, buddy: false, room: 'caf' });
    for (const p of this.players.values()) p.susBy.clear();
    this.topUp();
    const n = this.field(this.impTeam).length;
    fx.push({ type: 'sides', crew: this.crewTeam, imp: this.impTeam });
    const text = L(`${TEAM_NAME[this.crewTeam]} 当船员 · ${TEAM_NAME[this.impTeam]} 当内鬼`, `${TEAM_NAME[this.crewTeam]}: Crewmates · ${TEAM_NAME[this.impTeam]}: Impostors`);
    fx.push({ type: 'announce', text, sub: L(`我们之中有 ${n} 个内鬼`, n === 1 ? 'There is 1 Impostor among us' : `There are ${n} Impostors among us`), cls: 'gold' });
  }

  /** 均衡系数：均衡火力 × 人少更痛，再把人数比抵掉（任务条不会因为对面人多就变长）。 */
  pow(team) {
    const pool = Math.sqrt(Math.max(1, this.field(team).length) / Math.max(1, this.field(OTHER[team]).length));
    return this.balanceMult(team) * this.sizeMult() * pool;
  }

  /** 倒计时类的东西（破坏、关灯、开会间隔）按动作走：两队的一个动作折算成差不多的「时间」。 */
  unit(team) { return clamp(this.balanceMult(team), 0.2, 3); }
  livingCrew() { return this.alive(this.crewTeam).concat(this.npcs.filter((n) => n.alive)); }
  livingImps() { return this.alive(this.impTeam); }
  crewSize() { return this.field(this.crewTeam).length + this.npcs.length; }
  /** 内鬼人数 ≥ 船员就赢；内鬼开局就比船员多时，至少要刀掉一半船员。 */
  line(imps = this.livingImps().length) { return Math.min(imps, Math.floor(this.crewSize() / 2)); }
  /** 内鬼一共要刀几个人：要刀的人多，刀就冷却得快，总工作量差不多。 */
  kScale() { return Math.max(1, this.crewSize() - this.line(this.field(this.impTeam).length)); }
  over(rnd) { return this.round !== rnd || this.phase !== 'live'; }
  ghostOk(ev) { return ACT.has(ev.k) || ev.k === 'done'; }

  /** 右上角一行小字。路人船员不是会话，名字直接写进去。 */
  say(fx, who, text, cls = 'big') {
    if (who && who.npc) fx.push({ type: 'note', cls, text: text.replace('{0}', who.name) });
    else fx.push({ type: 'note', cls, text, sids: who ? [who.sid] : [] });
  }

  setRoom(p, room, fx) {
    if (p.room === room) return;
    p.room = room;
    fx.push({ type: 'go', sid: p.sid, room });
  }

  onEvent(p, ev, r, fx) {
    if (ev.k === 'think') return;
    if (this.phase !== 'live') return ACT.has(ev.k) && this.setRoom(p, pick(r, ROOM_IDS), fx); // 热身：先在船上溜达
    const rnd = this.round;
    const crew = p.team === this.crewTeam;
    if (!p.alive) crew ? this.ghostTask(p, ev, r, fx) : ev.k === 'web' && this.sabotage(p, r, fx); // 鬼船员接着做任务，鬼内鬼照样搞破坏
    else if (crew) this.crewMove(p, ev, r, fx);
    else this.impMove(p, ev, r, fx);
    if (this.over(rnd) || !ACT.has(ev.k)) return;
    this.tick(p, r, fx);
    if (!this.over(rnd) && crew) this.crewAfter(p, r, fx);
  }

  /** 破坏倒计时、关灯、监控都按「动作」走；路人船员也趁机走动一下。 */
  tick(p, r, fx) {
    const u = this.unit(p.team);
    const npcs = this.npcs.filter((n) => n.alive);
    if (npcs.length && r() < 0.5) this.setRoom(pick(r, npcs), pick(r, ROOM_IDS), fx);
    if (this.sab) {
      if (this.sab.fresh) this.sab.fresh = false; // 刚破坏的那一下不算
      else if ((this.sab.clock += u) >= this.sab.len) return this.meltdown(fx);
    }
    if (this.lights > 0 && (this.lights -= u) <= 0) {
      this.lights = 0;
      fx.push({ type: 'lights', on: true });
    }
    this.cams = Math.max(0, this.cams - u);
    if (p.team === this.impTeam) this.sabCd -= u;
  }

  // ---------------------------------------------------------------- 船员

  crewMove(p, ev, r, fx) {
    const m = this.pow(p.team);
    const bad = ev.ok === false;
    // 反应堆在熔毁：干什么都先去修（改代码 / 交任务 / 结伴按手印 = 一下修好）
    if (this.sab && !bad && (ACT.has(ev.k) || ev.k === 'done')) return this.fix(p, ['edit', 'done', 'agent'].includes(ev.k) ? 100 : (ev.k === 'shell' || ev.k === 'misc' ? 40 : 30) * m, fx);
    switch (ev.k) {
      case 'shell':
      case 'edit':
      case 'misc':
        if (bad) return this.flub(p, ev.k === 'shell' ? (r() < 0.5 ? 'fast' : 'slow') : ev.k === 'edit' ? 'wire' : 'scare', fx);
        if (ev.k === 'edit' && this.lights > 0) return this.fixLights(p, fx);
        return this.doTask(p, ev.hs ? 'big' : ev.k, r, fx);
      case 'read': return bad ? this.flub(p, 'static', fx) : this.watchCams(p, r, fx);
      case 'web': return bad ? this.flub(p, 'scare', fx) : this.adminMap(p, fx);
      case 'agent': return this.buddyUp(p, r, fx);
      case 'done':
      case 'prompt':
      case 'pr': return this.doTask(p, ev.k, r, fx);
      case 'compact': return this.lightsOut(p, fx);
      case 'abort': return this.die(p, null, { weapon: L('踢出房间', 'Kicked'), cause: 'human' }, fx, false);
      case 'apierr': return this.say(fx, p, L('📡 {0} 断开了连接', '📡 {0} has disconnected'), 'note');
    }
  }

  doTask(p, kind, r, fx) {
    const amt = this.cfg.task * WORK[kind] * this.pow(p.team) * (this.lights > 0 && p.alive ? 0.5 : 1);
    const big = kind === 'big';
    const task = Math.floor(r() * (big ? BIG : TASKS).length);
    const room = (big ? BIG : TASKS)[task][0];
    this.setRoom(p, room, fx);
    this.task = Math.min(this.goal, this.task + amt);
    p.dmg += Math.round(amt);
    if (big) p.sus = Math.max(0, p.sus - 30); // 看得见的大任务能自证清白
    fx.push({ type: 'task', sid: p.sid, task, big, room, ghost: !p.alive });
  }

  /** 船员每做一个动作：可能顺路撞见尸体；隔一阵子也会有人去拍紧急按钮。死了的船员由活着的人代劳。 */
  crewAfter(p, r, fx) {
    const crew = this.livingCrew();
    if (this.task >= this.goal || !crew.length) return;
    const who = p.alive ? p : pick(r, crew);
    if (this.bodies.length && r() < (this.lights > 0 ? 0.08 : 0.2)) return this.meeting('body', who, fx);
    this.meetClock += this.unit(p.team);
    if (this.meetClock >= this.cfg.meetEvery && !this.sab) this.meeting('button', who, fx);
  }

  ghostTask(p, ev, r, fx) { if (['shell', 'edit', 'misc', 'done'].includes(ev.k) && ev.ok !== false) this.doTask(p, 'ghost', r, fx); }

  flub(p, why, fx) {
    p.sus = Math.min(60, p.sus + 6);
    fx.push({ type: 'flub', sid: p.sid, why });
  }

  watchCams(p, r, fx) {
    this.setRoom(p, 'sec', fx);
    this.cams = 3;
    if (this.bodies.length) return this.meeting('body', p, fx);
    const imps = this.livingImps();
    if (!imps.length) return;
    const last = imps.find((q) => q.sid === this.lastImp);
    const t = last && r() < 0.6 ? last : pick(r, imps);
    this.addSus(t, this.cfg.cam * this.pow(p.team), p, 'cam', fx);
    fx.push({ type: 'cams', sid: p.sid, target: t.sid });
  }

  adminMap(p, fx) {
    this.setRoom(p, 'admin', fx);
    fx.push({ type: 'admin', sid: p.sid });
    for (const q of this.livingImps()) this.addSus(q, this.cfg.cam * 0.6 * this.pow(p.team), p, 'admin', fx);
  }

  buddyUp(p, r, fx) {
    const mates = this.livingCrew().filter((q) => q !== p);
    const mate = mates.length ? pick(r, mates) : null;
    p.buddy = true;
    if (mate) {
      mate.buddy = true;
      this.setRoom(p, mate.room, fx);
    }
    fx.push({ type: 'buddy', sid: p.sid, mate: mate ? mate.sid : null });
    this.doTask(p, 'agent', r, fx);
  }

  fix(p, amt, fx) {
    this.setRoom(p, 'reactor', fx);
    this.sab.fix += amt;
    p.a++;
    if (this.sab.fix < 100) return;
    this.sab = null;
    fx.push({ type: 'fixed', sid: p.sid });
    this.say(fx, p, L('🔧 {0} 稳住了反应堆', '🔧 {0} stopped the meltdown'), 'note');
  }

  fixLights(p, fx) {
    this.setRoom(p, 'elec', fx);
    this.lights = 0;
    fx.push({ type: 'lights', on: true, sid: p.sid });
    fx.push({ type: 'fixed', sid: p.sid, small: true });
  }

  lightsOut(p, fx) {
    this.lights = 5;
    fx.push({ type: 'lights', on: false, sid: p.sid });
  }

  // ---------------------------------------------------------------- 内鬼

  impMove(p, ev, r, fx) {
    const m = this.pow(p.team);
    this.lastImp = p.sid;
    if (ev.ok === false && ACT.has(ev.k)) return this.addSus(p, 18 * clamp(m, 0.3, 2), null, r() < 0.3 ? 'red' : 'seen', fx);
    switch (ev.k) {
      case 'shell':
        if (ev.hs) this.charge = Math.min(100, this.charge + 2 * this.cfg.charge * m * this.kScale());
        return this.charge >= 100 ? this.stab(p, r, fx, !!ev.hs) : this.stalk(p, 1, r, fx);
      case 'read':
        if (!this.bodies.length || r() >= 0.12) return this.stalk(p, 0.6, r, fx, true);
        this.addSus(p, 15, null, 'self', fx); // 自己刀的自己报
        return this.meeting('body', p, fx);
      case 'misc': return this.stalk(p, 0.6, r, fx);
      case 'prompt': return this.stalk(p, 0.5, r, fx);
      case 'edit': return this.vent(p, r, fx);
      case 'agent': return this.fakeTask(p, r, fx);
      case 'web': return this.sabotage(p, r, fx);
      case 'done': return this.doubleKill(p, r, fx);
      case 'compact': return this.lightsOut(p, fx);
      case 'pr':
        this.charge = 100;
        return this.stab(p, r, fx, true);
      case 'abort': return this.die(p, null, { weapon: L('踢出房间', 'Kicked'), cause: 'human' }, fx, false);
      case 'apierr': return this.say(fx, p, L('📡 {0} 断开了连接', '📡 {0} has disconnected'), 'note');
    }
  }

  /** 跟踪、等刀冷却。follow = 跟着某个船员走（读文件）。 */
  stalk(p, w, r, fx, follow = false) {
    const before = this.charge;
    this.charge = Math.min(100, this.charge + this.cfg.charge * w * this.pow(p.team) * this.kScale());
    const crew = this.livingCrew();
    this.setRoom(p, follow && crew.length ? pick(r, crew).room : pick(r, ROOM_IDS), fx);
    if (before < 100 && this.charge >= 100) fx.push({ type: 'ready', team: p.team });
  }

  /** 刀人。被同伴挡下 / 当面被人看见 / 被监控拍到，都会让嫌疑暴涨。 */
  stab(p, r, fx, hs = false, quiet = false) {
    const rnd = this.round;
    const crew = this.livingCrew();
    if (!crew.length) return null;
    const v = pick(r, crew);
    this.setRoom(p, v.room, fx);
    this.charge = 0;
    if (v.buddy) {
      v.buddy = false;
      fx.push({ type: 'save', sid: v.sid, by: p.sid });
      this.addSus(p, 30, v, 'buddy', fx);
      return null;
    }
    const weapon = pick(r, [L('捅刀', 'Stab'), L('扭断脖子', 'Neck snap'), L('舌头穿刺', 'Tongue'), L('开枪', 'Gunshot')]);
    this.die(v, p, { weapon, cause: 'knife', hs }, fx, true);
    this.check(fx);
    if (!this.over(rnd) && !quiet) this.witness(p, v, fx);
    return v;
  }

  witness(p, v, fx) {
    if (this.lights > 0) return;
    const crew = this.livingCrew();
    const wit = crew.find((c) => c.room === v.room);
    const cam = this.cams > 0 && CAM_ROOMS.has(v.room) ? crew.find((c) => c.room === 'sec') : null;
    if (!wit && !cam) return;
    this.addSus(p, wit ? 45 : 35, wit || cam, wit ? 'witness' : 'cams', fx);
    this.meeting('body', wit || cam, fx);
  }

  doubleKill(p, r, fx) {
    const rnd = this.round;
    if (this.charge < 100) {
      this.stalk(p, 1.6, r, fx);
      return this.charge >= 100 && this.stab(p, r, fx);
    }
    const a = this.stab(p, r, fx, false, true);
    if (this.over(rnd)) return;
    this.charge = 100;
    const b = this.stab(p, r, fx, true, true);
    if (this.over(rnd)) return;
    if (a && b) fx.push({ type: 'announce', text: L('🔪 双杀！', '🔪 Double Kill!'), sub: L(`${p.name} 一口气刀了两个`, `${p.name} took out two at once`), cls: 'bad' });
    if (a || b) this.witness(p, b || a, fx);
  }

  vent(p, r, fx) {
    const room = pick(r, VENT_ROOMS);
    p.room = room;
    this.charge = Math.min(100, this.charge + this.cfg.charge * 0.4 * this.pow(p.team) * this.kScale());
    fx.push({ type: 'vent', sid: p.sid, room });
    // 钻出来正好撞见船员：「我看见他钻管道了！」
    const seen = this.lights <= 0 && this.livingCrew().find((c) => c.room === room);
    if (seen && r() < 0.4) return this.addSus(p, 50, seen, 'vent', fx);
    p.sus = Math.max(0, p.sus - 10 * clamp(this.pow(p.team), 0.3, 2));
  }

  fakeTask(p, r, fx) {
    this.setRoom(p, pick(r, TASKS)[0], fx);
    p.sus = Math.max(0, p.sus - 18 * clamp(this.pow(p.team), 0.3, 2));
    fx.push({ type: 'fake', sid: p.sid });
  }

  sabotage(p, r, fx) {
    if (this.sab || this.sabCd > 0 || !this.livingCrew().length) return p.alive && this.stalk(p, 0.5, r, fx);
    this.sab = { clock: 0, len: this.cfg.sabLen, fix: 0, until: this.now + this.cfg.sabMs, fresh: true };
    this.sabCd = this.cfg.sabCd;
    fx.push({ type: 'sabotage', sid: p.sid, until: this.sab.until });
    fx.push({ type: 'announce', text: L('☢️ 反应堆即将熔毁！', '☢️ Reactor Meltdown!'), sub: L('船员快去修，修不好内鬼直接赢', 'Crew, fix it — or the Impostors win'), cls: 'bad' });
  }

  meltdown(fx) {
    fx.push({ type: 'meltdown' });
    this.endRound(this.impTeam, 'reactor', fx, L('反应堆熔毁 · 内鬼胜利', 'Impostors win · Reactor meltdown'));
  }

  // ---------------------------------------------------------------- 死亡、嫌疑、开会

  die(v, killer, info, fx, body) {
    if (!v.alive) return;
    Object.assign(v, { alive: false, buddy: false, deadRound: this.round });
    v.d++;
    if (killer && killer.team !== v.team) {
      killer.k++;
      if (info.hs) killer.hs++;
    }
    if (body) this.bodies.push({ sid: v.sid, room: v.room });
    if (!v.npc) return fx.push({ type: 'kill', killer: killer ? killer.sid : null, victim: v.sid, weapon: info.weapon, hs: !!info.hs, cause: info.cause });
    // 路人船员不进击杀播报（它不是会话），画面照样演，右上角写一行
    fx.push({ type: 'npcKill', killer: killer ? killer.sid : null, victim: v.sid, cause: info.cause });
    if (info.cause === 'knife') this.say(fx, killer, L(`🔪 {0} 刀了${v.name}（${info.weapon}）`, `🔪 {0} killed ${v.name} (${info.weapon})`), 'note');
  }

  addSus(p, amt, by, why, fx) {
    p.sus = clamp(p.sus + amt, 0, 150);
    if (by) p.susBy.set(by.sid, (p.susBy.get(by.sid) || 0) + amt);
    fx.push({ type: 'sus', sid: p.sid, why });
  }

  /** 开会：清掉尸体和破坏、刀重新冷却，然后投票。投票是确定性的：够可疑就投出内鬼，不然很可能冤枉好人。 */
  meeting(kind, caller, fx) {
    this.meetings++;
    const body = kind === 'body' ? this.bodies[0] : null;
    if (body && caller.team === this.crewTeam) caller.sus = Math.min(60, caller.sus + 8); // 谁报的谁可疑
    Object.assign(this, { meetClock: 0, sab: null, lights: 0, cams: 0, bodies: [], charge: this.charge * 0.3 });
    const vr = rng(hash(`vote:${this.round}:${this.meetings}:${this.now}:${caller.sid}`));
    const imps = this.livingImps().sort((a, b) => b.sus - a.sus);
    const crew = this.livingCrew();
    const top = imps[0];
    let who = null;
    let out = 'skip';
    // 嫌疑 60 大约两成半投对，100 不到六成，150 才基本跑不掉
    if (top && vr() < clamp((top.sus - 15) / 130, 0, 0.9) ** 1.3) who = top;
    else if (crew.length >= 2 && vr() < this.cfg.innocent * (crew.length >= 3 ? 1 : 0.6)) {
      let t = vr() * crew.reduce((s, q) => s + 6 + q.sus, 0);
      who = crew.find((q) => (t -= 6 + q.sus) <= 0) || crew[crew.length - 1];
    } else out = vr() < 0.55 ? 'skip' : 'tie';
    if (who) out = 'eject';
    const imp = !!who && who.team === this.impTeam;
    const votes = this.tally(out, who, vr);
    fx.push({ type: 'meeting', kind, caller: caller.sid, body: body ? body.sid : null, out, eject: who ? who.sid : null, imp, remain: imps.length - (imp ? 1 : 0), votes });
    this.say(fx, caller, body ? L(`📢 {0} 在${roomName(body.room)}发现了尸体！`, `📢 {0} reported a body in ${roomName(body.room)}!`) : L('🚨 {0} 拍下了紧急按钮', '🚨 {0} called an Emergency Meeting'));
    for (const q of imps) q.sus *= 0.7;
    for (const q of crew) q.sus *= 0.5;
    for (const q of this.field().concat(this.npcs)) q.room = 'caf';
    if (!who) return this.say(fx, null, out === 'tie' ? L('🗳️ 没有人被投出。（平票）', '🗳️ No one was ejected. (Tie)') : L('🗳️ 没有人被投出。（跳过）', '🗳️ No one was ejected. (Skipped)'));
    // 投对了：功劳记给把它盯得最紧的船员
    let accuser = caller.team === this.crewTeam && !caller.npc ? caller : null;
    for (const [sid, v] of imp ? who.susBy : []) {
      const q = this.players.get(sid);
      if (q && q.team === this.crewTeam && v > (who.susBy.get(accuser?.sid) || 0)) accuser = q;
    }
    this.die(who, imp ? accuser : null, { weapon: L('投票', 'Vote'), cause: 'vote' }, fx, false);
    this.say(fx, who, imp ? L('🗳️ {0} 是内鬼。', '🗳️ {0} was The Impostor.') : L('🗳️ {0} 不是内鬼。', '🗳️ {0} was not The Impostor.'));
    this.check(fx);
  }

  /** 编一份和结果一致的票：[投票的人, 投给谁（null = 跳过）]。 */
  tally(out, who, vr) {
    const sids = this.livingImps().concat(this.livingCrew()).map((p) => p.sid);
    const other = (self) => sids.filter((s) => s !== self)[Math.floor(vr() * (sids.length - 1))] ?? null;
    const votes = [];
    const count = (t) => votes.filter((x) => x[1] === t).length;
    if (out === 'tie' && sids.length >= 2) {
      const a = pick(vr, sids);
      const b = other(a);
      sids.forEach((s, i) => votes.push([s, s === a ? b : s === b ? a : i % 2 ? a : b]));
      for (const [x, y] of [[a, b], [b, a]]) for (const v of votes) if (count(x) > count(y) && v[1] === x && v[0] !== y) v[1] = null;
      return votes;
    }
    const target = out === 'eject' ? who.sid : null;
    for (const s of sids) votes.push([s, s === target ? (vr() < 0.5 ? null : other(s)) : vr() < 0.7 ? target : vr() < 0.5 ? null : other(s)]);
    const best = () => Math.max(...[null, ...sids].filter((s) => s !== target).map(count));
    for (const v of votes) if (count(target) <= best() && v[0] !== target && v[1] !== target) v[1] = target;
    return votes;
  }

  // ---------------------------------------------------------------- 等你 / 时间 / 胜负

  onWait(p, fx) {
    if (!p.alive) return;
    if (p.team === this.impTeam) return this.addSus(p, 15, null, 'afk', fx);
    if (this.meetClock >= 3 && !this.sab) this.meeting('button', p, fx); // 紧急会议！
  }

  onAnswer(p, wait, fx) {
    if (p.alive && p.team === this.crewTeam) this.doTask(p, 'answer', rng(hash(p.sid + this.now)), fx);
  }

  onWaitTimeout(p, fx) {
    if (!p.alive) return;
    if (p.team === this.impTeam) return this.addSus(p, 35, null, 'afk', fx);
    const imps = this.livingImps();
    if (imps.length) this.die(p, pick(rng(hash(p.sid + this.now)), imps), { weapon: L('挂机被刀', 'AFK kill'), cause: 'knife' }, fx, true);
  }

  timers() { return this.sab ? [this.roundStart + this.roundLen, this.sab.until] : [this.roundStart + this.roundLen]; }

  onTick(fx) {
    if (this.sab && this.now >= this.sab.until) return this.meltdown(fx);
    if (this.now - this.roundStart < this.roundLen) return;
    const w = this.leader();
    if (!w) this.roundStart = this.now;
    else this.endRound(w, 'time', fx, w === this.crewTeam ? L('时间到 · 任务进度领先', 'Time up · tasks ahead') : L('时间到 · 内鬼刀得更快', 'Time up · Impostors ahead'));
  }

  leader() {
    const tf = this.task / this.goal;
    const kf = (this.crewSize() - this.livingCrew().length) / this.kScale();
    if (!tf && !kf) return null;
    return tf >= kf ? this.crewTeam : this.impTeam;
  }

  check(fx) {
    if (!this.field(this.crewTeam).length || !this.field(this.impTeam).length) return;
    if (this.task >= this.goal) return this.endRound(this.crewTeam, 'tasks', fx, L('任务全部完成 · 船员胜利', 'Crewmates win · All tasks done'));
    if (!this.livingImps().length) return this.endRound(this.crewTeam, 'eject', fx, L('内鬼全部出局 · 船员胜利', 'Crewmates win · No Impostors left'));
    if (this.livingCrew().length <= this.line()) return this.endRound(this.impTeam, 'kills', fx, L('内鬼人数追平了船员 · 内鬼胜利', 'Impostors win · They outnumber the crew'));
  }
}

// ================================================================ 地图
// 斯凯尔德号（The Skeld）俯视图：房间、走廊、通风管、任务台、监控摄像头。

const { w: W, h: H } = WORLD;
const HALLS = [
  [270, 255, 70, 440], [200, 450, 75, 50], [335, 450, 50, 50], [415, 150, 230, 60], [560, 205, 50, 80], [995, 140, 110, 60],
  [1295, 180, 75, 475], [1265, 380, 40, 50], [1365, 440, 50, 50], [790, 310, 60, 265], [845, 450, 90, 50], [415, 760, 240, 60],
  [500, 705, 50, 60], [875, 800, 90, 60], [1125, 770, 80, 45],
];
const NODES = {
  ueng: [305, 175], reactor: [114, 475], sec: [450, 475], leng: [305, 775], medbay: [585, 355], caf: [820, 191], weapons: [1200, 165],
  o2: [1195, 405], nav: [1495, 465], admin: [1015, 475], storage: [765, 735], elec: [530, 645], comms: [1045, 840], shields: [1300, 735],
  jl: [305, 475], ju: [585, 180], jr1: [1335, 205], jr2: [1335, 405], jr3: [1335, 465], jc: [820, 475], jd: [535, 790], js: [920, 830],
};
const ADJ = {};
for (const e of ['ueng-jl', 'jl-leng', 'jl-reactor', 'jl-sec', 'ueng-ju', 'ju-medbay', 'ju-caf', 'caf-weapons', 'weapons-jr1', 'jr1-jr2', 'jr2-o2', 'jr2-jr3',
  'jr3-nav', 'jr3-shields', 'caf-jc', 'jc-admin', 'jc-storage', 'storage-jd', 'jd-elec', 'jd-leng', 'storage-js', 'js-comms', 'comms-shields']) {
  const [a, b] = e.split('-');
  (ADJ[a] ||= []).push(b);
  (ADJ[b] ||= []).push(a);
}
const VENTS = { reactor: [70, 400], ueng: [385, 232], leng: [385, 832], sec: [490, 525], medbay: [640, 405], elec: [585, 690], caf: [965, 95], admin: [1075, 525], nav: [1450, 395], weapons: [1270, 105], shields: [1370, 800] };
const CAMS = [[430, 165], [820, 340], [1335, 300], [700, 790]];
const station = (id) => [ROOMS[id].r[0] + ROOMS[id].r[2] / 2, ROOMS[id].r[1] + 30];
const spot = (id, [x, y, w, h] = ROOMS[id].r) => [x + 30 + Math.random() * (w - 60), y + 56 + Math.random() * (h - 76)];
const seat = (i, n) => [820 + Math.cos((i / n) * Math.PI * 2) * 120, 205 + Math.sin((i / n) * Math.PI * 2) * 78];

function bfs(from, to) {
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    if (n === to) break;
    for (const m of ADJ[n]) if (!(m in prev)) (prev[m] = n), queue.push(m);
  }
  const path = [];
  for (let n = to; n; n = prev[n]) path.unshift(n);
  return path;
}
function nearestNode(x, y) {
  let best = 'caf';
  for (const k in NODES) if ((NODES[k][0] - x) ** 2 + (NODES[k][1] - y) ** 2 < (NODES[best][0] - x) ** 2 + (NODES[best][1] - y) ** 2) best = k;
  return best;
}

/** 同队的人用同一个队伍颜色的深浅区分；路人船员用经典配色。 */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)));
  return `rgb(${ch.join(',')})`;
}
const SHADES = [0, -0.28, 0.3, -0.45, 0.5, -0.12];
const tint = (q) => (q.npc ? q.color : shade(COLOR[q.team], SHADES[hash(q.sid) % SHADES.length]));
const ent = (R, sid) => R.players.get(sid) || R.npcs?.find((n) => n.sid === sid);

// 画图小工具：填色 + 描边
function paint(g, fill, stroke, lw = 3) {
  if (fill) (g.fillStyle = fill), g.fill();
  if (stroke) (g.strokeStyle = stroke), (g.lineWidth = lw), g.stroke();
}
function circle(g, x, y, r, fill, stroke, lw) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  paint(g, fill, stroke, lw);
}
function oval(g, x, y, rx, ry, fill, stroke, lw) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  paint(g, fill, stroke, lw);
}
function rrect(g, x, y, w, h, r, fill, stroke, lw) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  paint(g, fill, stroke, lw);
}
function write(g, text, x, y, size, color, { weight = 800, align = 'center', italic = false, stroke = null } = {}) {
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (stroke) (g.lineWidth = size / 7), (g.strokeStyle = stroke), g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

let ship = null;
function drawShip() {
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.fillStyle = '#04060d';
  g.fillRect(0, 0, W, H);
  const r = rng(11);
  for (let i = 0; i < 300; i++) (g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.6})`), g.fillRect(r() * W, r() * H, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1);
  // 先画一圈墙（外扩），再画地板：门口自然就打通了
  const rooms = Object.values(ROOMS);
  g.fillStyle = '#1b2029';
  for (const [x, y, w, h] of rooms.map((o) => o.r).concat(HALLS)) g.fillRect(x - 7, y - 7, w + 14, h + 14);
  g.fillStyle = '#4c5566';
  for (const [x, y, w, h] of HALLS) g.fillRect(x, y, w, h);
  for (const { r: [x, y, w, h], floor } of rooms) {
    g.fillStyle = floor;
    g.fillRect(x, y, w, h);
    g.beginPath();
    for (let xx = x + 24; xx < x + w; xx += 24) g.moveTo(xx, y), g.lineTo(xx, y + h);
    for (let yy = y + 24; yy < y + h; yy += 24) g.moveTo(x, yy), g.lineTo(x + w, yy);
    paint(g, null, 'rgba(0,0,0,0.08)', 1);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x, y, w, 12);
  }
  const ink = '#232a33';
  // 餐厅的圆桌，中间那张有紧急按钮
  for (const [x, y] of [[720, 135], [920, 135], [720, 265], [920, 265], [820, 200]]) circle(g, x, y, 30, '#c8ced6', '#6b7480');
  circle(g, 820, 200, 12, '#d8262a', '#7a8090');
  // 反应堆、引擎、监控、管理室、电力室、医疗室、导航、武器、氧气、储藏、通讯、护盾
  circle(g, 92, 475, 46, '#1d6f8f', ink);
  circle(g, 92, 475, 24, '#69d2ff', '#1d6f8f');
  for (const y of [380, 545]) rrect(g, 150, y, 34, 26, 5, '#55606e', ink);
  for (const y of [126, 726]) rrect(g, 206, y, 84, 100, 14, '#a0a7ae', ink), rrect(g, 194, y + 25, 14, 50, 5, '#e2843c', ink);
  for (let i = 0; i < 3; i++) rrect(g, 392 + i * 40, 414, 32, 22, 3, '#2d8a5a', '#0c1620');
  rrect(g, 962, 445, 104, 62, 6, '#46a878', ink);
  for (let i = 0; i < 4; i++) rrect(g, 462 + i * 36, 594, 26, 34, 3, ['#d8423a', '#3a7bd8', '#e8c63a', '#d84ab8'][i], ink);
  circle(g, 588, 385, 28, 'rgba(90,220,120,0.35)', '#3a9c58');
  rrect(g, 512, 300, 60, 30, 6, '#e8eef4', ink);
  rrect(g, 1552, 380, 22, 170, 6, '#0a1630', '#16243d');
  circle(g, 1200, 170, 34, '#55606e', ink);
  for (const x of [1150, 1185, 1220]) circle(g, x, 412, 11, '#3e8f47', ink);
  for (const [x, y] of [[670, 620], [720, 620], [670, 670], [820, 840], [780, 860]]) rrect(g, x, y, 42, 42, 4, '#9b7a4c', '#5c4426');
  circle(g, 1045, 830, 26, '#9aa5b1', ink);
  circle(g, 1300, 735, 34, '#5a7bd6', '#2c3f7a');
  // 通风管、任务台
  for (const [x, y] of Object.values(VENTS)) {
    rrect(g, x - 15, y - 9, 30, 18, 4, '#4a4f57', '#1b2029');
    g.beginPath();
    for (let i = -9; i <= 9; i += 6) g.moveTo(x + i, y - 6), g.lineTo(x + i, y + 6);
    paint(g, null, '#2a2e35', 2);
  }
  for (const id of ROOM_IDS) rrect(g, station(id)[0] - 12, station(id)[1] - 8, 24, 14, 3, '#2b313b', '#e8d24a');
  return c;
}

/** 豆子小人：背包、身体、两条小短腿、面罩。ghost = 半透明的鬼，没有腿，下面是波浪。 */
function drawBean(g, x, y, color, { face = 1, walk = 0, s = 1, rot = 0, ghost = false } = {}) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.scale(s * face, s);
  const ink = '#0b0d12';
  rrect(g, -18, -32, 9, 18, 3, color, ink);
  g.beginPath();
  if (ghost) {
    g.moveTo(-12, -14);
    g.arc(0, -28, 12, Math.PI, 0);
    g.lineTo(12, -10);
    for (let i = 0; i < 3; i++) g.quadraticCurveTo(8 - i * 8, -2 - (i % 2) * 6, 4 - i * 8, -10);
    g.closePath();
  } else {
    const a = Math.sin(walk) * 4;
    g.roundRect(-11 + a * 0.5, -12, 9, 12 - Math.max(0, a), 3);
    g.roundRect(2 - a * 0.5, -12, 9, 12 - Math.max(0, -a), 3);
    paint(g, color, ink);
    g.beginPath();
    g.roundRect(-12, -42, 24, 34, [12, 12, 5, 5]);
  }
  paint(g, color, ink);
  oval(g, 4, -30, 9, 6, '#8fd3ee', ink);
  oval(g, 7, -32, 4, 2, 'rgba(255,255,255,0.85)');
  g.restore();
}

/** 被刀之后只剩下半截，露出一根卡通骨头。 */
function drawBody(g, x, y, color, s = 1) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  g.roundRect(-11, -10, 9, 10, 3);
  g.roundRect(2, -10, 9, 10, 3);
  g.roundRect(-12, -20, 24, 13, [2, 2, 5, 5]);
  paint(g, color, '#0b0d12');
  g.fillStyle = '#f4efe2';
  g.fillRect(-2, -30, 5, 12);
  circle(g, -2, -30, 3.5, '#f4efe2');
  circle(g, 3, -30, 3.5, '#f4efe2');
  g.restore();
}

// ================================================================ 画面

class Bean {
  constructor(sid, [x, y]) {
    Object.assign(this, { sid, x, y, path: [], face: 1, walk: 0, body: null, vent: null, label: null, pop: null, bob: Math.random() * 6 });
  }

  goTo(room, ghost, to = spot(room)) {
    this.path = ghost ? [to] : bfs(nearestNode(this.x, this.y), room).map((n) => NODES[n]).concat([to]);
  }

  update(dt, speed, ghost) {
    if (this.label && (this.label.life -= dt) <= 0) this.label = null;
    if (this.pop && (this.pop.life -= dt) <= 0) this.pop = null;
    if (this.vent) {
      // 钻进通风管：先缩下去，再从另一头冒出来
      this.vent.t += dt;
      if (!this.vent.moved && this.vent.t >= 0.3) [this.x, this.y, this.vent.moved] = [...this.vent.to, true];
      if (this.vent.t >= 0.6) this.vent = null;
      return;
    }
    if (!this.path.length) return;
    const [tx, ty] = this.path[0];
    const d = Math.hypot(tx - this.x, ty - this.y);
    const step = (ghost ? 100 : 140) * speed * dt;
    if (d <= step) return ([this.x, this.y] = this.path.shift());
    if (Math.abs(tx - this.x) > 2) this.face = tx > this.x ? 1 : -1;
    this.x += ((tx - this.x) / d) * step;
    this.y += ((ty - this.y) / d) * step;
    this.walk += dt * 14 * Math.min(speed, 3);
  }
}

export class View {
  constructor(app) {
    this.app = app;
    ship ||= drawShip();
    this.fx = new Particles();
    this.beans = new Map();
    this.glow = new Map();
    this.stars = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: rand(20, 160), s: Math.random() < 0.2 ? 3 : 1.5 }));
    this.ov = null;
    this.dark = 0;
    this.camT = 0;
  }

  reset(R) {
    this.fx.clear();
    this.beans.clear();
    this.glow.clear();
    // 大乱斗刚好在投票那一刻换关：别把放逐动画掐掉
    if (this.ov && this.app.rt() - this.ov.at > 0.05) this.ov = null;
    if (!R || !R.npcs) return;
    this.sync(R);
    for (const { sid } of R.bodies) if (this.beans.has(sid)) this.beans.get(sid).body = { x: this.beans.get(sid).x, y: this.beans.get(sid).y };
  }

  /** 场上的人和路人船员都要有一个豆子；下场的删掉。 */
  sync(R) {
    const list = R.field().concat(R.npcs);
    for (const q of list) if (!this.beans.has(q.sid)) this.beans.set(q.sid, new Bean(q.sid, q.room === 'caf' ? seat(this.beans.size, 10) : spot(q.room)));
    if (this.beans.size > list.length) for (const sid of this.beans.keys()) if (!list.some((q) => q.sid === sid)) this.beans.delete(sid);
  }

  /** 开局 / 开会：所有人回到餐厅的大桌子边。 */
  regroup(R) {
    this.sync(R);
    let i = 0;
    for (const b of this.beans.values()) {
      [b.x, b.y] = seat(i++, this.beans.size);
      Object.assign(b, { path: [], body: null, vent: null });
    }
  }

  apply(list, R, busy) {
    if (!R.npcs) return;
    this.sync(R);
    for (const f of list) this.one(f, R, busy, f.sid ? this.beans.get(f.sid) : null);
  }

  one(f, R, busy, b) {
    const { fx, app } = this;
    const say = (text, color = '#fff', size = 13, life = 1.2) => b && fx.text(b.x, b.y - 68, text, color, size, life);
    switch (f.type) {
      case 'act': {
        const text = f.ev.k === 'think' ? null : actText(f.ev);
        if (b && text && !(busy && f.ev.k === 'read')) b.label = { text, ok: f.ev.ok !== false, life: 1.7, ghost: !f.alive };
        return;
      }
      case 'roundStart':
      case 'sides': return this.regroup(R);
      case 'go': return b && b.goTo(f.room, !ent(R, f.sid)?.alive);
      case 'task': {
        const [x, y] = station(f.room);
        const t = (f.big ? BIG : TASKS)[f.task];
        if (b) b.goTo(f.room, f.ghost, [x + rand(-22, 22), y + 34]);
        this.glow.set(f.room, 1);
        if (!busy || f.big) fx.text(x, y - 16, f.big ? L(`🎯 ${t[1]}！`, `🎯 ${t[2]}!`) : `✔ ${L(t[1], t[2])}`, f.big ? '#ffe36b' : '#8dff9a', f.big ? 16 : 13, 1.3);
        if (f.big) fx.ring(x, y, 10, 70, 'rgba(255,227,107,0.9)', 0.6);
        if (app.sfx.ok()) app.sfx.tone(f.big ? 660 : 520, 0.07, 0.06, 'triangle', f.big ? 990 : 700);
        return;
      }
      case 'flub': return say(FLUB[f.why](), '#ff9a8a', 14, 1.4);
      case 'sus': return SUS[f.why] && say(SUS[f.why](), '#ff6b6b', 14, 1.4);
      case 'fake': return !busy && say(L('🙃 假装在做任务', '🙃 Faking a task'), '#ffd28a');
      case 'fixed': return say(f.small ? L('🔧 修好了', '🔧 Fixed') : L('✅ 反应堆稳住了', '✅ Reactor stabilized'), '#9cffb0', 15, 1.4);
      case 'lights': return !f.on && !busy && say(L('💡 灯灭了', '💡 Lights out'), '#ffe08a', 14);
      case 'admin': return fx.ring(1015, 478, 10, 70, 'rgba(70,214,140,0.9)', 0.6);
      case 'sabotage': return app.sfx.ok(1) && app.sfx.tone(700, 0.35, 0.12, 'square', 420);
      case 'kill':
      case 'npcKill': return this.onKill(f, busy);
      case 'meeting': return this.onMeeting(f, R, busy);
      case 'cams': {
        this.camT = 1.5;
        const t = this.beans.get(f.target);
        if (t && !busy) fx.ring(t.x, t.y - 20, 34, 8, 'rgba(255,70,70,0.9)', 0.5);
        return;
      }
      case 'buddy':
        for (const q of [b, this.beans.get(f.mate)]) if (q && !busy) fx.ring(q.x, q.y - 20, 8, 36, 'rgba(120,255,160,0.9)', 0.5);
        return !busy && say(L('🤝 结伴同行', '🤝 Buddied up'), '#9cffb0');
      case 'save':
        if (b) fx.ring(b.x, b.y - 20, 50, 10, 'rgba(120,255,160,0.9)', 0.6, 4);
        return say(L('🛡 同伴挡下了这一刀！', '🛡 Saved by a buddy!'), '#9cffb0', 15, 1.5);
      case 'vent':
        if (!b) return;
        // 从最近的通风口钻进去，从目标房间的通风口钻出来
        [b.x, b.y] = Object.values(VENTS).reduce((a, v) => ((v[0] - b.x) ** 2 + (v[1] - b.y) ** 2 < (a[0] - b.x) ** 2 + (a[1] - b.y) ** 2 ? v : a));
        Object.assign(b, { path: [], vent: { t: 0, to: [VENTS[f.room][0], VENTS[f.room][1] + 6], moved: false } });
        return app.sfx.ok() && app.sfx.tone(140, 0.12, 0.08, 'square', 90);
      case 'meltdown':
        fx.explosion(92, 475, true);
        app.shake(0.8, 12);
        return app.sfx.boom(true);
    }
  }

  onKill(f, busy) {
    const v = this.beans.get(f.victim);
    if (!v) return;
    if (f.cause === 'human') v.pop = { text: '✋', life: 2 };
    if (f.cause !== 'knife') return;
    // 内鬼一刀闪到身边；受害者剩下半截，鬼魂飘起来
    v.body = { x: v.x, y: v.y };
    Object.assign(v, { path: [], vent: null, y: v.y - 14 });
    const k = this.beans.get(f.killer);
    if (k) Object.assign(k, { x: v.x + (Math.random() < 0.5 ? -20 : 20), y: v.y + 18, path: [], vent: null });
    this.fx.sparks(v.x, v.y - 10, '#ff5d5d', busy ? 3 : 10, 150);
    this.app.sfx.tone(210, 0.18, 0.12, 'sawtooth', 70);
    if (!busy) this.app.shake(0.15, 4);
  }

  /** 开会：紧急会议 / 发现尸体 → 投票面板 → 星空放逐，三段动画。倍速越高放得越快。 */
  onMeeting(f, R, busy) {
    this.regroup(R);
    const k = busy ? 0.18 : clamp(1.6 / Math.max(1, this.app.speed()) ** 0.6, 0.18, 1); // 1 倍速约 7 秒，20 倍速约 2 秒
    const card = (q) => q && { sid: q.sid, name: q.name, color: tint(q), alive: q.alive || q.sid === f.eject };
    const cards = R.field(R.crewTeam).concat(R.field(R.impTeam), R.npcs).map(card);
    this.ov = { f, at: this.app.rt(), t: 0, steps: [1.2 * k, 2.2 * k, 4 * k], cards, caller: card(ent(R, f.caller)), body: card(ent(R, f.body)), ej: card(ent(R, f.eject)) };
    const { sfx } = this.app;
    for (let i = 0; i < 3; i++) sfx.tone(f.kind === 'body' ? 330 : 560, 0.14, 0.12, 'square', f.kind === 'body' ? 220 : 560, i * 0.2);
    this.app.later((this.ov.steps[0] + this.ov.steps[1]) * 0.95, () => sfx.burst(0.7, 900, 0.07, 'bandpass'));
  }

  update(dt, R) {
    this.fx.update(dt);
    if (!R.npcs) return;
    const sp = clamp(Math.sqrt(this.app.speed()), 1, 8);
    for (const [sid, b] of this.beans) b.update(dt, sp, !ent(R, sid)?.alive);
    for (const [k, v] of this.glow) v - dt <= 0 ? this.glow.delete(k) : this.glow.set(k, v - dt);
    this.camT = Math.max(0, this.camT - dt);
    this.dark += ((R.lights > 0 && R.phase === 'live' ? 1 : 0) - this.dark) * Math.min(1, dt * 3);
    if (this.ov && (this.ov.t += dt) > this.ov.steps[0] + this.ov.steps[1] + this.ov.steps[2]) this.ov = null;
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(ship, 0, 0, W, H);
    if (!R.npcs) return;
    const fs = fontFor(scale, 12);
    for (const id of ROOM_IDS) {
      const [x, y, w, h] = ROOMS[id].r;
      write(g, roomName(id), x + 8, y + h - fs / 2 - 8, fs, 'rgba(20,24,32,0.55)', { weight: 700, align: 'left' });
      const gl = this.glow.get(id);
      if (gl) circle(g, ...station(id), 18 + (1 - gl) * 10, `rgba(255,236,90,${gl * 0.6})`);
      if (R.sab && id === 'reactor') {
        g.beginPath();
        g.rect(x, y, w, h);
        paint(g, null, `rgba(255,40,40,${0.5 + 0.5 * Math.sin(rt * 8)})`, 6);
      }
    }
    for (const [x, y] of CAMS) {
      g.fillStyle = '#2a2f37';
      g.fillRect(x - 8, y - 6, 16, 12);
      circle(g, x + 5, y - 2, 2.5, (R.cams > 0 || this.camT > 0) && Math.floor(rt * 3) % 2 === 0 ? '#ff3030' : '#5a1a1a');
    }
    for (const bd of R.bodies) {
      const b = this.beans.get(bd.sid);
      const q = ent(R, bd.sid);
      if (q) drawBody(g, ...(b?.body ? [b.body.x, b.body.y] : station(bd.room)), tint(q), 1.25);
    }
    const list = [...this.beans.values()].map((b) => [b, ent(R, b.sid)]).filter(([, q]) => q).sort((a, c) => a[0].y - c[0].y);
    for (const [b, q] of list) {
      const s = b.vent ? Math.abs(b.vent.t - 0.3) / 0.3 : 1;
      if (!q.alive || s < 0.05) continue;
      g.save();
      g.translate(b.x, b.y);
      g.scale(1, s);
      drawBean(g, 0, 0, tint(q), { face: b.face, walk: b.path.length ? b.walk : 0 });
      g.restore();
    }
    g.globalAlpha = 0.4;
    for (const [b, q] of list) if (!q.alive) drawBean(g, b.x, b.y + Math.sin(rt * 2 + b.bob) * 4 - 6, tint(q), { face: b.face, ghost: true });
    g.globalAlpha = 1;
    this.fx.renderOver(g, scale);
    this.drawDark(g, R);
    for (const [b, q] of list) this.tags(g, R, b, q, fs, rt);
    if (R.sab) {
      g.fillStyle = `rgba(255,0,0,${0.06 + 0.1 * (0.5 + 0.5 * Math.sin(rt * 7))})`;
      g.fillRect(0, 0, W, H);
      const left = Math.max(0, Math.ceil((R.sab.until - R.now) / 1000));
      pill(g, W / 2, 84, L(`☢️ 反应堆熔毁倒计时 ${left} 秒 · 修复 ${Math.round(R.sab.fix)}%`, `☢️ Reactor meltdown in ${left}s · ${Math.round(R.sab.fix)}% fixed`), { size: fontFor(scale, 18), max: 700, color: '#ffdddd', bg: 'rgba(150,0,0,0.85)', weight: 800 });
    }
    this.drawHud(g, R, scale, rt);
    this.drawOverlay(g, scale, rt);
  }

  /** 名字牌、动作气泡、嫌疑条（红条越长越可疑）、结伴的盾、内鬼刀好了的小刀。 */
  tags(g, R, b, q, fs, rt) {
    if (b.vent && !b.vent.moved) return;
    const y = b.y - 56 + (q.alive ? 0 : Math.sin(rt * 2 + b.bob) * 4 - 6);
    g.globalAlpha = q.alive ? 1 : 0.45;
    pill(g, b.x, y, q.name, { color: q.npc ? '#d8dde4' : COLOR[q.team], size: fs, max: 120, bg: q.npc ? 'rgba(10,12,16,0.4)' : 'rgba(10,12,16,0.65)' });
    if (q.alive && q.sus > 4) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(b.x - 16, b.y + 5, 32, 4);
      g.fillStyle = q.sus >= 100 ? '#ff2a2a' : '#ff7a5a';
      g.fillRect(b.x - 16, b.y + 5, 32 * Math.min(1, q.sus / 100), 4);
    }
    if (q.alive && q.buddy) emoji(g, '🛡', b.x + 20, b.y - 34, 13);
    if (q.alive && !q.npc && q.team === R.impTeam && R.charge >= 100) emoji(g, '🔪', b.x - 21, b.y - 34, 15);
    if (b.pop) emoji(g, b.pop.text, b.x, y - 26, 22);
    g.globalAlpha = 1;
    if (!b.label) return;
    g.globalAlpha = Math.min(1, b.label.life / 0.4) * (b.label.ghost ? 0.45 : 1);
    pill(g, b.x, y - fs - 8 - (1.7 - b.label.life) * 6, b.label.text, { size: fs - 1, max: 190, weight: 500, bg: b.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)' });
    g.globalAlpha = 1;
  }

  /** 关灯：整艘船一片漆黑，只有船员身边一小圈看得见（内鬼的视野不受影响）。 */
  drawDark(g, R) {
    if (this.dark < 0.02) return;
    if (!this.darkC) {
      this.darkC = document.createElement('canvas');
      [this.darkC.width, this.darkC.height] = [W / 2, H / 2];
    }
    const d = this.darkC.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W / 2, H / 2);
    d.fillStyle = `rgba(2,3,8,${0.86 * this.dark})`;
    d.fillRect(0, 0, W / 2, H / 2);
    d.globalCompositeOperation = 'destination-out';
    for (const q of R.livingCrew()) {
      const b = this.beans.get(q.sid);
      if (!b) continue;
      const grd = d.createRadialGradient(b.x / 2, b.y / 2 - 10, 6, b.x / 2, b.y / 2 - 10, 52);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      circle(d, b.x / 2, b.y / 2 - 10, 52, grd);
    }
    d.globalCompositeOperation = 'source-over';
    g.drawImage(this.darkC, 0, 0, W, H);
  }

  /** 左上角任务条和两边是谁，右下角内鬼的刀（冷却好了就变红）。 */
  drawHud(g, R, scale, rt) {
    const [x, y, w, h] = [18, 12, 520, 30];
    rrect(g, x - 6, y - 6, w + 12, h + 12, 8, 'rgba(8,10,14,0.7)');
    g.fillStyle = '#20301f';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#43d243';
    g.fillRect(x, y, w * clamp(R.task / R.goal, 0, 1), h);
    const pct = Math.floor((R.task / R.goal) * 100);
    write(g, L(`任务总进度 ${pct}%`, `TOTAL TASKS COMPLETED ${pct}%`), x + 10, y + h / 2 + 1, fontFor(scale, 14), '#fff', { align: 'left' });
    const fs = fontFor(scale, 13);
    const npc = R.npcs.length ? L(` + ${R.npcs.length} 个路人`, ` + ${R.npcs.length} randoms`) : '';
    const sides = [[`🧑‍🚀 ${TEAM_NAME[R.crewTeam]} · ${L('船员', 'Crewmates')}${npc}`, COLOR[R.crewTeam]], [`🔪 ${TEAM_NAME[R.impTeam]} · ${L('内鬼', 'Impostors')}`, COLOR[R.impTeam]]];
    sides.forEach(([text, color], i) => {
      g.font = `600 ${fs}px ${FONT}`;
      const tw = Math.min(360, g.measureText(text).width + 10);
      pill(g, x + tw / 2, y + h + 20 + i * (fs + 10), text, { color, size: fs, max: 360 });
    });
    if (R.lights > 0) pill(g, x + w + 90, y + h / 2, L('💡 灯被关了', '💡 Lights out'), { size: fs, color: '#ffe08a' });
    const [kx, ky, kr] = [W - 70, H - 70, 46];
    circle(g, kx, ky, kr, R.charge >= 100 ? `rgba(200,20,20,${0.75 + 0.25 * Math.sin(rt * 6)})` : 'rgba(40,44,52,0.85)');
    g.beginPath();
    g.arc(kx, ky, kr - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(R.charge / 100, 0, 1));
    paint(g, null, COLOR[R.impTeam], 6);
    emoji(g, '🔪', kx, ky - 8, 30);
    write(g, L('击杀', 'KILL'), kx, ky + 24, fontFor(scale, 14), '#fff', { weight: 900 });
  }

  drawOverlay(g, scale, rt) {
    const o = this.ov;
    if (!o) return;
    let t = o.t;
    let i = 0;
    while (i < 2 && t > o.steps[i]) t -= o.steps[i++];
    const k = clamp(t / o.steps[i], 0, 1);
    g.save();
    g.fillStyle = i === 2 ? '#000' : 'rgba(0,0,0,0.58)';
    g.fillRect(0, 0, W, H);
    [this.splash, this.vote, this.eject][i].call(this, g, o, k, scale, rt);
    g.restore();
  }

  /** 「紧急会议！」/「发现尸体！」：斜着的色带、放射线、报告人和尸体。 */
  splash(g, o, k, scale) {
    const body = o.f.kind === 'body';
    g.translate(W / 2, H / 2);
    g.rotate(-0.05);
    g.fillStyle = body ? '#3b1d10' : '#4a0d0d';
    g.fillRect(-W, -150, W * 2, 300);
    g.save();
    g.beginPath();
    g.rect(-W, -150, W * 2, 300);
    g.clip();
    g.beginPath();
    for (let a = 0; a < 20; a++) {
      const ang = (a / 20) * Math.PI * 2 + k * 0.6;
      g.moveTo(Math.cos(ang) * 130, Math.sin(ang) * 60);
      g.lineTo(Math.cos(ang) * 1000, Math.sin(ang) * 500);
    }
    paint(g, null, body ? 'rgba(255,190,90,0.22)' : 'rgba(255,90,90,0.22)', 10);
    g.restore();
    if (o.caller) drawBean(g, -610, 125, o.caller.color, { s: 3.2 });
    if (body && o.body) drawBody(g, 610, 115, o.body.color, 3.2);
    else oval(g, 610, 80, 80, 34, '#7a8090'), oval(g, 610, 62, 48, 22, Math.floor(k * 8) % 2 ? '#ff3b3b' : '#c51111');
    const text = body ? L('发现尸体！', 'DEAD BODY REPORTED') : L('紧急会议！', 'EMERGENCY MEETING!');
    write(g, text, 0, -20, Math.round(92 * (0.5 + 0.5 * Math.min(1, k * 6))), body ? '#ffd27a' : '#fff', { weight: 900, italic: true, stroke: '#120404' });
    if (o.caller) pill(g, 0, 70, body ? L(`${o.caller.name} 报告了尸体`, `${o.caller.name} found the body`) : L(`${o.caller.name} 拍下了紧急按钮`, `${o.caller.name} pressed the button`), { size: fontFor(scale, 22), max: 700, bg: 'rgba(0,0,0,0.6)' });
  }

  /** 投票面板：「谁是内鬼？」每张卡片下面是投给它的人的颜色。 */
  vote(g, o, k, scale) {
    const [x0, y0, pw, ph] = [W / 2 - 500, 70, 1000, 800];
    rrect(g, x0, y0, pw, ph, 26, '#aebccb', '#28323d', 8);
    const reveal = k > 0.45;
    write(g, reveal ? L('投票结果', 'Voting Results') : L('谁是内鬼？', 'Who Is The Impostor?'), W / 2, y0 + 48, fontFor(scale, 40), '#1b2430', { weight: 900 });
    const cards = o.cards.filter(Boolean).slice(0, 12);
    const color = Object.fromEntries(cards.map((c) => [c.sid, c.color]));
    const votes = o.f.votes.slice(0, reveal ? Math.ceil(clamp((k - 0.45) / 0.35, 0, 1) * o.f.votes.length) : 0);
    const dots = (t, x, y) => votes.filter((v) => v[1] === t).forEach(([v], j) => circle(g, x + j * 22, y, 8, color[v] || '#888', '#111', 2));
    cards.forEach((c, i) => {
      const [cx, cy] = [x0 + 30 + (i % 2) * 480, y0 + 100 + Math.floor(i / 2) * 92];
      const out = reveal && c.sid === o.f.eject;
      rrect(g, cx, cy, 460, 78, 10, c.alive ? '#e8eef4' : '#7f8a96', out ? '#d81e1e' : '#3a4654', out ? 6 : 3);
      drawBean(g, cx + 38, cy + 66, c.color, { s: 1.3, ghost: !c.alive });
      g.font = `800 ${fontFor(scale, 22)}px ${FONT}`;
      write(g, fitText(g, c.name, 360), cx + 80, cy + 26, fontFor(scale, 22), '#18202a', { align: 'left' });
      if (!c.alive) emoji(g, '❌', cx + 38, cy + 40, 26);
      dots(c.sid, cx + 92, cy + 58);
    });
    write(g, L('跳过投票', 'Skip Vote'), x0 + 34, y0 + ph - 46, fontFor(scale, 20), '#18202a', { align: 'left' });
    dots(null, x0 + 160, y0 + ph - 46);
    write(g, L(`投票倒计时：${Math.ceil((1 - k) * 15)} 秒`, `Voting Ends In: ${Math.ceil((1 - k) * 15)}s`), x0 + pw - 34, y0 + ph - 46, fontFor(scale, 20), '#18202a', { align: 'right' });
  }

  /** 放逐：一颗豆子在星空里翻滚着飘过，字一个一个打出来——「X 不是内鬼。」 */
  eject(g, o, k, scale, rt) {
    g.fillStyle = '#fff';
    for (const s of this.stars) g.fillRect((((s.x - rt * s.v) % W) + W) % W, s.y, s.s, s.s);
    if (o.ej) drawBean(g, -140 + (W + 280) * Math.min(1, k * 1.1), H / 2 - 80 + Math.sin(k * 7) * 24, o.ej.color, { s: 2.6, rot: k * 10 });
    const f = o.f;
    const full = o.ej ? (f.imp ? L(`${o.ej.name} 是内鬼。`, `${o.ej.name} was The Impostor.`) : L(`${o.ej.name} 不是内鬼。`, `${o.ej.name} was not The Impostor.`)) : f.out === 'tie' ? L('没有人被投出。（平票）', 'No one was ejected. (Tie)') : L('没有人被投出。（跳过）', 'No one was ejected. (Skipped)');
    const chars = Array.from(full);
    g.font = `700 46px ${FONT}`;
    write(g, fitText(g, chars.slice(0, Math.ceil(chars.length * clamp(k * 1.8, 0, 1))).join(''), W - 120), W / 2, H / 2, 46, '#fff', { weight: 700 });
    if (!o.ej || k <= 0.62) return;
    g.globalAlpha = clamp((k - 0.62) * 5, 0, 1);
    write(g, L(`还剩 ${f.remain} 个内鬼。`, f.remain === 1 ? '1 Impostor remains.' : `${f.remain} Impostors remain.`), W / 2, H / 2 + 64, 30, '#c9d2dc', { weight: 600 });
    g.globalAlpha = 1;
  }

  hud(R) {
    if (R.phase !== 'live' || !R.npcs) return null;
    const left = R.sab ? Math.max(0, Math.ceil((R.sab.until - R.now) / 1000)) : 0;
    const sub = R.sab ? L(`☢️ 熔毁 ${left} 秒`, `☢️ Meltdown ${left}s`) : L(`任务 ${Math.floor((R.task / R.goal) * 100)}%`, `Tasks ${Math.floor((R.task / R.goal) * 100)}%`);
    const pips = { [R.crewTeam]: R.field(R.crewTeam).map((p) => p.alive).concat(R.npcs.map((n) => n.alive)), [R.impTeam]: R.field(R.impTeam).map((p) => p.alive) };
    return { mid: L(`第 ${R.round} 局`, `Game ${R.round}`), sub, pips };
  }
}

// 船员手滑、内鬼露馅时头上飘的字
const FLUB = {
  fast: () => L('💳 刷卡太快了，请重试', '💳 Too fast. Try again.'),
  slow: () => L('💳 刷卡太慢了，请重试', '💳 Too slow. Try again.'),
  wire: () => L('🔌 电线接错了', '🔌 Wrong wire!'),
  scare: () => L('😱 被吓了一跳', '😱 Jump scare!'),
  static: () => L('📺 监控全是雪花', '📺 Cams are just static'),
};
const SUS = {
  seen: () => L('👀 被人看见了', '👀 Seen! Kinda sus'),
  red: () => L('ඞ 好可疑', 'ඞ sus'),
  buddy: () => L('🛡 被同伴撞见了', '🛡 Caught by a buddy'),
  vent: () => L('🕳️ 被看到钻通风管！', '🕳️ Seen venting!'),
  witness: () => L('😱 当面行凶！', '😱 Killed in front of a witness!'),
  cams: () => L('📹 被监控拍到了', '📹 Caught on camera'),
  afk: () => L('🧍 一直站着不动，可疑', '🧍 Standing still… sus'),
  self: () => L('🙋 自己报的警', '🙋 Self report'),
};
