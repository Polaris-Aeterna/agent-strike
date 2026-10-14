// 宝可梦对战：每队一只宝可梦出战，其余在精灵球里加油。跑命令放招式，测试通过效果拔群，等你回复太久就睡着。
// 规则层把对战文字当成效果吐出来（{type:'say'}），画面层像 GBA 一样一句一句打字播放。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, pill, emoji, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'poke',
  icon: '⚡',
  get name() { return L('宝可梦对战', 'Pokémon Battle'); },
  get desc() { return L('回合制宝可梦对战。跑命令放招式，测试通过效果拔群，等你回复太久它就睡着了', 'Turn-based Pokémon battle. Commands are moves, passing tests are super effective, keep it waiting and it falls asleep'); },
  get roundWord() { return L('场对战', 'battle'); },
  get wait() {
    return {
      start: L('⏳ {a} 在等训练家下指令', '⏳ {a} is waiting for orders'),
      sub: L('40 秒内回它就是「训练家下达了指令！」，超时它就睡着了', 'Reply within 40s to give an order — or it falls asleep'),
      done: L('📣 训练家下达了指令！', '📣 The Trainer gave an order!'),
      boom: L('💤 {a} 等训练家等得睡着了…', '💤 {a} got tired of waiting and fell asleep…'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令', '🔫 Run a command'), L('放招式（十万伏特、喷射火焰…）', 'Attack (Thunderbolt, Flamethrower…)')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('效果拔群！伤害 ×2', "It's super effective! ×2 damage")],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('瞪眼：对手防御降低', "Leer: the foe's Defense falls")],
      [L('🧱 改代码', '🧱 Edit code'), L('变硬 / 光合作用：防御提高或回血', 'Harden / Synthesis: Defense up or heal')],
      [L('🔭 上网查资料', '🔭 Web search'), L('破坏光线：超痛，但下一回合动不了', 'Hyper Beam: huge hit, then it must recharge')],
      [L('🤔 思考', '🤔 Thinking'), L('蓄力：下一招 ×1.5', 'Focus Energy: next move ×1.5')],
      [L('✅ 任务完成', '✅ Task done'), L('Z 招式 / 极巨化', 'Z-Move / Dynamax')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('替身；场外队友派就是帮手', 'Substitute; from the bench it is Helping Hand')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('混乱：可能攻击自己', 'Confusion: may hurt itself')],
      [L('🐛 报错', '🐛 Error'), L('攻击没有命中，或者不知所以地攻击了自己', 'The attack missed, or it hurt itself in confusion')],
      [L('💬 你发消息', '💬 You send a message'), L('训练家使用了伤药', 'The Trainer uses a Potion')],
      [L('⏳ 它在等你', '⏳ Waiting on you'), L('40 秒内回它攻击提高，超时睡着还被食梦', 'Reply within 40s: Attack up. Too late: it falls asleep and eats a Dream Eater')],
      [L('✋ 你打断它', '✋ You interrupt it'), L('被训练家强行收回（算倒下）', 'Forcibly recalled (counts as fainted)')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('进化！满血 + 能力大幅提高', 'Evolution! Full heal + stats up')],
      [L('📣 场外的队友', '📣 Benched teammates'), L('帮手 / 加油：给出战的宝可梦加成', 'Helping Hand / cheering: buff the active Pokémon')],
    ];
  },
};

// ================================================================ 图鉴
// 数据里只放英文 id，名字用的时候再按当前语言查（语言可以中途切换）。

const NAMES = () => ({
  // 宝可梦
  pikachu: L('皮卡丘', 'Pikachu'), charmander: L('小火龙', 'Charmander'), charmeleon: L('火恐龙', 'Charmeleon'), charizard: L('喷火龙', 'Charizard'),
  squirtle: L('杰尼龟', 'Squirtle'), wartortle: L('卡咪龟', 'Wartortle'), blastoise: L('水箭龟', 'Blastoise'),
  bulbasaur: L('妙蛙种子', 'Bulbasaur'), ivysaur: L('妙蛙草', 'Ivysaur'), venusaur: L('妙蛙花', 'Venusaur'),
  gastly: L('鬼斯', 'Gastly'), haunter: L('鬼斯通', 'Haunter'), gengar: L('耿鬼', 'Gengar'), snorlax: L('卡比兽', 'Snorlax'),
  dratini: L('迷你龙', 'Dratini'), dragonair: L('哈克龙', 'Dragonair'), dragonite: L('快龙', 'Dragonite'),
  eevee: L('伊布', 'Eevee'), jolteon: L('雷伊布', 'Jolteon'), flareon: L('火伊布', 'Flareon'), vaporeon: L('水伊布', 'Vaporeon'),
  magikarp: L('鲤鱼王', 'Magikarp'), gyarados: L('暴鲤龙', 'Gyarados'), psyduck: L('可达鸭', 'Psyduck'), golduck: L('哥达鸭', 'Golduck'),
  jigglypuff: L('胖丁', 'Jigglypuff'), wigglytuff: L('胖可丁', 'Wigglytuff'), mewtwo: L('超梦', 'Mewtwo'), meowth: L('喵喵', 'Meowth'), persian: L('猫老大', 'Persian'),
  caterpie: L('绿毛虫', 'Caterpie'), metapod: L('铁甲蛹', 'Metapod'), butterfree: L('巴大蝶', 'Butterfree'), slowpoke: L('呆呆兽', 'Slowpoke'), slowbro: L('呆壳兽', 'Slowbro'),
  // 招式
  thunderbolt: L('十万伏特', 'Thunderbolt'), thunderShock: L('电击', 'Thunder Shock'), gigavolt: L('终极伏特狂雷闪', 'Gigavolt Havoc'), maxLightning: L('极巨闪电', 'Max Lightning'),
  flamethrower: L('喷射火焰', 'Flamethrower'), ember: L('火花', 'Ember'), inferno: L('超强极限爆焰弹', 'Inferno Overdrive'), maxFlare: L('极巨火爆', 'Max Flare'),
  waterGun: L('水枪', 'Water Gun'), bubble: L('泡沫', 'Bubble'), hydroVortex: L('超级水流大漩涡', 'Hydro Vortex'), maxGeyser: L('极巨水流', 'Max Geyser'),
  razorLeaf: L('飞叶快刀', 'Razor Leaf'), vineWhip: L('藤鞭', 'Vine Whip'), bloomDoom: L('绚烂缤纷花怒放', 'Bloom Doom'), maxOvergrowth: L('极巨草原', 'Max Overgrowth'),
  shadowBall: L('暗影球', 'Shadow Ball'), lick: L('舌舔', 'Lick'), nightmare: L('无尽暗夜之诱惑', 'Never-Ending Nightmare'), maxPhantasm: L('极巨幽魂', 'Max Phantasm'),
  bodySlam: L('泰山压顶', 'Body Slam'), tackle: L('撞击', 'Tackle'), breakneck: L('究极无敌大冲撞', 'Breakneck Blitz'), maxStrike: L('极巨攻击', 'Max Strike'),
  dragonPulse: L('龙之波动', 'Dragon Pulse'), dragonBreath: L('龙息', 'Dragon Breath'), drake: L('究极巨龙震天地', 'Devastating Drake'), maxWyrmwind: L('极巨龙骑', 'Max Wyrmwind'),
  psychic: L('精神强念', 'Psychic'), confusion: L('念力', 'Confusion'), psystrike: L('精神击破', 'Psystrike'), maxMindstorm: L('极巨脑冲', 'Max Mindstorm'),
  gleam: L('魔法闪耀', 'Dazzling Gleam'), pound: L('拍击', 'Pound'), twinkle: L('可爱星星飞天撞', 'Twinkle Tackle'), maxStarfall: L('极巨妖精', 'Max Starfall'),
  bugBite: L('虫咬', 'Bug Bite'), stringShot: L('吐丝', 'String Shot'), spinOut: L('绝对捕食回旋斩', 'Savage Spin-Out'), maxFlutterby: L('极巨虫蛊', 'Max Flutterby'),
  quickAttack: L('电光一闪', 'Quick Attack'), tenMillion: L('千万伏特', '10,000,000 Volt Thunderbolt'), wildfire: L('超极巨地狱灭焰', 'G-Max Wildfire'),
  hydroPump: L('水炮', 'Hydro Pump'), solarBeam: L('日光束', 'Solar Beam'), pancake: L('认真起来大爆击', 'Pulverizing Pancake'), takeDown: L('猛撞', 'Take Down'),
  splash: L('水溅跃', 'Splash'), zSplash: L('Z 水溅跃', 'Z-Splash'), furySwipes: L('乱抓', 'Fury Swipes'), scratch: L('抓', 'Scratch'), payDay: L('聚宝功', 'Pay Day'),
  psybeam: L('幻象光线', 'Psybeam'), hyperBeam: L('破坏光线', 'Hyper Beam'), leer: L('瞪眼', 'Leer'), sing: L('唱歌', 'Sing'), dreamEater: L('食梦', 'Dream Eater'),
  substitute: L('替身', 'Substitute'), harden: L('变硬', 'Harden'), withdraw: L('缩入壳中', 'Withdraw'), synthesis: L('光合作用', 'Synthesis'), minimize: L('变小', 'Minimize'),
  rest: L('睡觉', 'Rest'), roost: L('羽栖', 'Roost'), defenseCurl: L('变圆', 'Defense Curl'), amnesia: L('瞬间失忆', 'Amnesia'), recover: L('自我再生', 'Recover'), slackOff: L('偷懒', 'Slack Off'),
  // 招牌台词（{n} 换成名字）
  cryPikachu: L('{n}：皮卡皮卡！', '{n}: Pika pika!'), crySnorlax: L('{n} 挡住了去路！', '{n} is blocking the path!'), cryMagikarp: L('{n} 在地上扑腾扑腾……', '{n} flops around uselessly…'),
  cryPsyduck: L('{n}：可达？', '{n}: Psy…duck?'), cryJiggly: L('{n}：胖～丁～', '{n}: Jiggly~puff~'), cryMeowth: L('{n}：就是这样喵！', "{n}: Meowth, that's right!"),
  crySlowpoke: L('{n} 发了一会儿呆……', '{n} zoned out for a while…'), dizzyPsyduck: L('{n} 抱着脑袋，头痛欲裂！', '{n} clutches its head. Splitting headache!'),
  refusePikachu: L('……{n} 摇了摇头，拒绝了雷之石！', '…{n} shook its head and refused the Thunder Stone!'),
});
const nameCache = {};
const tr = (id) => (nameCache[L('zh', 'en')] ||= NAMES())[id] || id;

const TYPE = {
  elec: { c: '#f5cf2a', hit: 'thunderbolt', quick: 'thunderShock', z: 'gigavolt', max: 'maxLightning' },
  fire: { c: '#ff7b2e', hit: 'flamethrower', quick: 'ember', z: 'inferno', max: 'maxFlare' },
  water: { c: '#3d9bff', hit: 'waterGun', quick: 'bubble', z: 'hydroVortex', max: 'maxGeyser' },
  grass: { c: '#55c255', hit: 'razorLeaf', quick: 'vineWhip', z: 'bloomDoom', max: 'maxOvergrowth' },
  ghost: { c: '#8b5fd0', hit: 'shadowBall', quick: 'lick', z: 'nightmare', max: 'maxPhantasm' },
  normal: { c: '#c9c2a6', hit: 'bodySlam', quick: 'tackle', z: 'breakneck', max: 'maxStrike' },
  dragon: { c: '#6b5cff', hit: 'dragonPulse', quick: 'dragonBreath', z: 'drake', max: 'maxWyrmwind' },
  psychic: { c: '#ff5d9e', hit: 'psychic', quick: 'confusion', z: 'psystrike', max: 'maxMindstorm' },
  fairy: { c: '#ff9fd2', hit: 'gleam', quick: 'pound', z: 'twinkle', max: 'maxStarfall' },
  bug: { c: '#9cc22c', hit: 'bugBite', quick: 'stringShot', z: 'spinOut', max: 'maxFlutterby' },
};
// 克制表：攻击属性 → 防守属性 → 倍率（没写的就是 1）
const CHART = {
  elec: { water: 2, grass: 0.5, dragon: 0.5, elec: 0.5 },
  fire: { grass: 2, bug: 2, water: 0.5, fire: 0.5, dragon: 0.5 },
  water: { fire: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
  grass: { water: 2, fire: 0.5, grass: 0.5, dragon: 0.5, bug: 0.5 },
  ghost: { ghost: 2, psychic: 2, normal: 0.5 },
  normal: { ghost: 0.5 },
  dragon: { dragon: 2, fairy: 0.5 },
  psychic: { psychic: 0.5 },
  fairy: { dragon: 2, fire: 0.5 },
  bug: { grass: 2, psychic: 2, fire: 0.5, ghost: 0.5, fairy: 0.5 },
};
const EFF_MULT = { 2: 1.4, 1: 1, 0.5: 0.7 }; // 克制别太极端，免得属性决定一切

// 每个会话按 sid 抽一只。forms 是进化链
const DEX = [
  { forms: [{ n: 'pikachu', e: '🐭' }], type: 'elec', quick: 'quickAttack', z: 'tenMillion', guard: ['harden', 'def'], cry: 'cryPikachu', refuse: 'refusePikachu', ballHate: true },
  { forms: [{ n: 'charmander', e: '🦎' }, { n: 'charmeleon', e: '🦎' }, { n: 'charizard', e: '🐉', max: 'wildfire' }], type: 'fire', guard: ['harden', 'def'] },
  { forms: [{ n: 'squirtle', e: '🐢' }, { n: 'wartortle', e: '🐢' }, { n: 'blastoise', e: '🐢', hit: 'hydroPump' }], type: 'water', guard: ['withdraw', 'def'] },
  { forms: [{ n: 'bulbasaur', e: '🐸' }, { n: 'ivysaur', e: '🐸' }, { n: 'venusaur', e: '🌺', hit: 'solarBeam' }], type: 'grass', guard: ['synthesis', 'heal'] },
  { forms: [{ n: 'gastly', e: '👻' }, { n: 'haunter', e: '👻' }, { n: 'gengar', e: '😈' }], type: 'ghost', guard: ['minimize', 'def'] },
  { forms: [{ n: 'snorlax', e: '🐻' }], type: 'normal', z: 'pancake', guard: ['rest', 'rest'], cry: 'crySnorlax' },
  { forms: [{ n: 'dratini', e: '🐍' }, { n: 'dragonair', e: '🐍' }, { n: 'dragonite', e: '🐲' }], type: 'dragon', guard: ['roost', 'heal'] },
  { forms: [{ n: 'eevee', e: '🦊' }], branch: [{ n: 'jolteon', e: '🦊', type: 'elec' }, { n: 'flareon', e: '🦊', type: 'fire' }, { n: 'vaporeon', e: '🦊', type: 'water' }], type: 'normal', hit: 'takeDown', quick: 'quickAttack', guard: ['defenseCurl', 'def'] },
  { forms: [{ n: 'magikarp', e: '🐟', hit: 'tackle', quick: 'splash', mtype: 'normal', splash: true }, { n: 'gyarados', e: '🐉', hit: 'hydroPump' }], type: 'water', evoAt: [1], guard: ['splash', 'splash'], cry: 'cryMagikarp' },
  { forms: [{ n: 'psyduck', e: '🦆' }, { n: 'golduck', e: '🦆' }], type: 'water', guard: ['amnesia', 'def'], cry: 'cryPsyduck', dizzy: 'dizzyPsyduck' },
  { forms: [{ n: 'jigglypuff', e: '🎈' }, { n: 'wigglytuff', e: '🎈' }], type: 'fairy', guard: ['defenseCurl', 'def'], sing: true, cry: 'cryJiggly' },
  { forms: [{ n: 'mewtwo', e: '👽' }], type: 'psychic', z: 'psystrike', guard: ['recover', 'heal'] },
  { forms: [{ n: 'meowth', e: '🐱' }, { n: 'persian', e: '🐈' }], type: 'normal', hit: 'furySwipes', quick: 'scratch', payday: true, guard: ['harden', 'def'], cry: 'cryMeowth' },
  { forms: [{ n: 'caterpie', e: '🐛' }, { n: 'metapod', e: '🌰', only: true }, { n: 'butterfree', e: '🦋', hit: 'psybeam', mtype: 'psychic' }], type: 'bug', evoAt: [1], guard: ['stringShot', 'def'] },
  { forms: [{ n: 'slowpoke', e: '🦛' }, { n: 'slowbro', e: '🦛' }], type: 'water', guard: ['slackOff', 'heal'], cry: 'crySlowpoke' },
];

/** 这只宝可梦现在的样子（按进化阶段），名字都换成当前语言。 */
function spec(p) {
  const d = DEX[p.dex];
  const f = d.branch && p.form >= 1 ? d.branch[p.branch % d.branch.length] : d.forms[Math.min(p.form, d.forms.length - 1)];
  const type = f.type || d.type;
  const T = TYPE[type];
  return {
    name: tr(f.n), e: f.e, type, color: T.c, mtype: f.mtype || type, guard: [tr(d.guard[0]), d.guard[1]],
    hit: tr(f.hit || d.hit || T.hit), quick: tr(f.quick || d.quick || T.quick), z: tr(f.z || d.z || T.z), max: tr(f.max || T.max),
    only: !!f.only, splash: !!f.splash, sing: !!d.sing, payday: !!d.payday,
  };
}

const HOME = 'claude'; // 我方：左下角背对镜头；Codex 是右上角的对手
const SWITCH_IDLE = 60e3; // 出战的宝可梦 60 秒没动静，队友一动就换它上去
const MOVES = new Set(['shell', 'read', 'edit', 'web', 'misc', 'agent', 'think', 'done', 'compact']);
const DMG = 0.5; // 总伤害系数：调对战节奏用
const HELP = { shell: 9, web: 12, misc: 5, read: 2 }; // 场外队友每个动作攒多少帮手伤害
const HELP_CAP = 40;
const stage = (s) => (s >= 0 ? 1 + 0.25 * s : 1 / (1 - 0.25 * s));
const line = (id, n) => tr(id).replace('{n}', n);
const big = (text) => ({ type: 'say', text, prio: true }); // 重要的句子，倍速时也不丢
/** 往 fx 里依次塞：字符串是一句对战文字，对象原样塞（画面动作），空值跳过。 */
function tell(fx, ...xs) {
  for (const x of xs) if (x) fx.push(typeof x === 'string' ? { type: 'say', text: x, prio: false } : x);
  return true;
}

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { battleLen: 10 * 60e3, maxPerTeam: 6 };

  init() {
    this.battleLen = this.opts.party ? 4 * 60e3 : this.opts.battleLen;
    this.act = { claude: null, codex: null };
    this.faints = { claude: 0, codex: 0 };
    this.dealt = 0;
  }

  initPlayer(p) {
    const h = hash(p.sid);
    Object.assign(p, { dex: h % DEX.length, branch: (h >>> 8) % 3, form: 0, lv0: 12 + ((h >>> 12) % 28), hardens: 0 });
    this.calm(p, true);
  }

  /** 清状态。full = 上场 / 新一场（满血、睡眠也清）；否则是换下场：能力变化、混乱、蓄力、替身消失，睡眠保留。 */
  calm(p, full = false) {
    Object.assign(p, { atk: 0, def: 0, charge: 0, help: 0, conf: 0, recharge: false, sub: false, said: {} }, full && { hp: 100, sleep: 0 });
    this.refresh(p);
  }

  refresh(p) {
    p.sp = spec(p);
    p.lv = p.lv0 + p.k * 2 + p.form * 4;
  }

  /** 文案里的名字：对面的要加「对手的」，跟游戏里一样。 */
  nm(p) {
    return (p.team === HOME ? '' : L('对手的 ', 'Foe ')) + p.sp.name;
  }

  // ---------------------------------------------------------------- 出战与换人

  cur(team) {
    const p = this.players.get(this.act[team]);
    return p && p.onField && p.alive ? p : null;
  }

  /** 替补：最近动过的、还没倒下的队友。 */
  nextUp(team) {
    return this.alive(team).sort((a, b) => b.lastActive - a.lastActive)[0] || null;
  }

  sendNext(team, fx) {
    const nx = this.nextUp(team);
    if (nx) this.sendOut(nx, null, fx);
    return nx;
  }

  foe(p, fx) {
    return this.cur(OTHER[p.team]) || this.sendNext(OTHER[p.team], fx);
  }

  /** 这个动作算不算出战宝可梦的招式：是它自己 / 场上没人 / 出战的发呆太久 → 是；否则是场外支援。 */
  claim(p, fx) {
    const c = this.cur(p.team);
    if (c === p) return true;
    if (c && (this.now - c.lastActive <= SWITCH_IDLE || this.waiting(c))) return false;
    this.sendOut(p, c, fx);
    return true;
  }

  sendOut(p, prev, fx) {
    const [T, n] = [TEAM_NAME[p.team], p.sp.name];
    if (prev) this.calm(prev);
    if (prev) tell(fx, big(L(`${T} 收回了 ${prev.sp.name}！去吧，${n}！`, `${T} withdrew ${prev.sp.name}! Go! ${n}!`)));
    else tell(fx, big(p.team === HOME ? L(`去吧！${n}！`, `Go! ${n}!`) : L(`${T} 派出了 ${n}！`, `${T} sent out ${n}!`)));
    this.act[p.team] = p.sid;
    p.said = {};
    tell(fx, { type: 'out', team: p.team, sid: p.sid, e: p.sp.e, name: n }, DEX[p.dex].cry && line(DEX[p.dex].cry, n));
  }

  onEnter(p, fx) {
    this.calm(p, true);
    if (this.phase !== 'live') return; // 开打那一刻 onRoundStart 统一播
    tell(fx, L(`野生的 ${p.sp.name} 出现了！`, `A wild ${p.sp.name} appeared!`));
    if (!this.cur(p.team)) this.sendOut(p, null, fx);
    else tell(fx, L(`好耶！${TEAM_NAME[p.team]} 收服了 ${p.sp.name}！`, `Gotcha! ${p.sp.name} was caught by ${TEAM_NAME[p.team]}!`));
  }

  onLeave(p, fx) {
    if (this.act[p.team] !== p.sid) return;
    this.act[p.team] = null;
    this.calm(p);
    if (this.phase !== 'live') return;
    tell(fx, L(`${p.sp.name} 回到了精灵球里。`, `${p.sp.name} returned to its Poké Ball.`), { type: 'recall', team: p.team, sid: p.sid });
    this.sendNext(p.team, fx);
  }

  onRoundStart(fx) {
    Object.assign(this, { faints: { claude: 0, codex: 0 }, dealt: 0, act: { claude: null, codex: null } });
    for (const p of this.field()) this.calm(Object.assign(p, { alive: true }), true);
    const [n, T] = [this.round, TEAM_NAME[OTHER[HOME]]];
    tell(fx, big(n > 1 ? L(`第 ${n} 场！宝可梦训练家 ${T} 想要对战！`, `Battle ${n}! Pokémon Trainer ${T} wants to battle!`) : L(`宝可梦训练家 ${T} 想要对战！`, `Pokémon Trainer ${T} wants to battle!`)));
    this.sendNext(OTHER[HOME], fx); // 游戏里也是对面先派
    this.sendNext(HOME, fx);
  }

  // ---------------------------------------------------------------- 动作

  ghostOk(ev) {
    return ev.k === 'pr'; // 倒下了开 PR 也能进化复活
  }

  onEvent(p, ev, r, fx) {
    if (this.phase !== 'live') return; // 热身时一队在场上自己玩，不刷屏
    if (ev.k === 'prompt') return this.potion(p, fx);
    if (ev.k === 'abort') return this.recalled(p, fx);
    if (ev.k === 'pr') return this.evolve(p, fx, true);
    if (ev.k === 'apierr') {
      tell(fx, L('与服务器的连接中断了……', 'Lost connection to the server…'));
      return this.selfHurt(p, 8, L('通信错误', 'Connection error'), 'net', fx);
    }
    if (!MOVES.has(ev.k)) return;
    if (this.claim(p, fx)) this.move(p, ev, r, fx);
    else this.support(p, ev, fx);
  }

  move(p, ev, r, fx) {
    const n = this.nm(p);
    if (ev.k === 'think') {
      // 蓄力不占回合，也不刷屏：每次出场只说一次
      if (p.sleep || p.charge) return;
      tell(fx, { type: 'charge', sid: p.sid }, !p.said.charge && L(`${n} 正在蓄力！`, `${n} is getting pumped!`));
      return (p.charge = p.said.charge = 1);
    }
    if (ev.k === 'compact') {
      p.conf = 2;
      return tell(fx, L(`${n} 混乱了！`, `${n} became confused!`), { type: 'confuse', sid: p.sid }, DEX[p.dex].dizzy && line(DEX[p.dex].dizzy, n));
    }
    if (this.blocked(p, n, r, fx)) return;
    if (p.sp.only) return this.harden(p, n, fx);
    if (ev.ok === false) return this.whiff(p, n, ev, r, fx);
    if (ev.k === 'shell') return this.attack(p, ev.hs ? 'hs' : 'hit', r, fx);
    if (ev.k === 'misc') return this.attack(p, 'quick', r, fx);
    if (ev.k === 'web') return this.attack(p, 'beam', r, fx);
    if (ev.k === 'done') return this.zmove(p, n, r, fx);
    if (ev.k === 'read') return this.glare(p, n, r, fx);
    if (ev.k === 'edit') return this.guard(p, n, fx);
    if (p.sub) p.help = Math.min(HELP_CAP, p.help + 10); // 子代理：替身；已经有替身就攒点力气
    else tell(fx, used(n, tr('substitute')), { type: 'sub', sid: p.sid, on: true }, L(`${n} 的替身出现了！`, `${n} put in a substitute!`));
    p.sub = true;
  }

  /** 睡眠 / 破坏光线的反作用 / 混乱：这一招放不出来就返回 true。 */
  blocked(p, n, r, fx) {
    if (p.sleep > 0) {
      if (--p.sleep > 0) return tell(fx, L(`${n} 正在呼呼大睡。`, `${n} is fast asleep.`), { type: 'zzz', sid: p.sid });
      tell(fx, L(`${n} 醒过来了！`, `${n} woke up!`));
    }
    if (p.recharge) {
      p.recharge = false;
      return tell(fx, L(`${n} 因攻击的反作用力而无法动弹！`, `${n} must recharge!`));
    }
    if (p.conf <= 0) return false;
    tell(fx, L(`${n} 正在混乱中！`, `${n} is confused!`));
    if (r() < 0.45) {
      p.conf--;
      tell(fx, L('不知所以地攻击了自己！', 'It hurt itself in its confusion!'));
      return this.selfHurt(p, 8 + r() * 5, L('混乱', 'Confusion'), 'bug', fx) || true;
    }
    if (!--p.conf) tell(fx, L(`${n} 的混乱解除了！`, `${n} snapped out of its confusion!`));
    return false;
  }

  attack(p, kind, r, fx) {
    const sp = p.sp;
    const foe = this.foe(p, fx);
    const move = kind === 'beam' ? tr('hyperBeam') : kind === 'quick' ? sp.quick : sp.hit;
    tell(fx, used(this.nm(p), move));
    if (kind === 'quick' && sp.splash) return tell(fx, L('但是什么也没有发生！', 'But nothing happened!'));
    if (!foe) return tell(fx, L('但是，没有目标……', 'But there was no target…'));
    const [lo, hi] = { hit: [11, 15], hs: [11, 15], quick: [6, 9], beam: [24, 30] }[kind];
    const mtype = kind === 'beam' ? 'normal' : sp.mtype;
    const crit = kind !== 'hs' && r() < 1 / 16;
    const eff = kind === 'hs' ? 2 : CHART[mtype][foe.sp.type] || 1;
    const dmg = (lo + r() * (hi - lo)) * (kind === 'hs' ? 2 : EFF_MULT[eff]) * (crit ? 1.5 : 1);
    tell(fx, { type: 'move', sid: p.sid, to: foe.sid, kind, color: TYPE[mtype].c });
    this.hit(p, foe, this.power(p, foe, dmg), { move, crit, eff, hs: kind === 'hs' }, fx);
    if (kind === 'beam') p.recharge = true;
  }

  /** 帮手攒下的伤害加上去，再乘蓄力、能力等级、进化阶段、均衡火力。蓄力和帮手用一次就没了。 */
  power(p, foe, dmg) {
    dmg = (dmg + p.help) * (p.charge ? 1.5 : 1) * (stage(p.atk) / stage(foe.def)) * (1 + 0.08 * p.form);
    p.charge = p.help = 0;
    return dmg * DMG * this.relay(p.team) * this.balanceMult(p.team) * this.sizeMult();
  }

  /**
   * 车轮战系数：一次只有一只在打，人多时一场要打倒好几只，单招再痛一点，免得一场拖太久。
   * 大乱斗倒一只就结束，所以不按人数给对面加血量优势（底座的均衡火力里算了人数，这里抵掉）。
   */
  relay(team) {
    const n = (this.field('claude').length + this.field('codex').length) / 2 || 1;
    if (!this.party) return n ** 0.75;
    return Math.sqrt((n * Math.max(1, this.field(team).length)) / Math.max(1, this.field(OTHER[team]).length));
  }

  hit(att, vic, dmg, info, fx) {
    const vn = this.nm(vic);
    if (vic.sub) {
      vic.sub = false;
      tell(fx, L(`替身代替 ${vn} 承受了攻击！`, `The substitute took the hit for ${vn}!`), { type: 'sub', sid: vic.sid, on: false }, L(`${vn} 的替身消失了……`, `${vn}'s substitute faded…`));
      return 0;
    }
    const d = clamp(Math.round(dmg), 1, vic.hp);
    vic.hp -= d;
    this.dealt += d;
    if (att && att.team !== vic.team) att.dmg += d;
    tell(fx, { type: 'hit', sid: vic.sid, by: att ? att.sid : null, hp: vic.hp, big: !!info.crit || info.eff > 1 }, info.crit && L('击中要害！', 'A critical hit!'));
    tell(fx, info.eff > 1 ? L('效果拔群！', "It's super effective!") : info.eff < 1 && L('效果不太好……', "It's not very effective…"));
    if (vic.hp <= 0) this.faint(vic, att, info.move, info.cause || 'move', fx, { hs: !!info.hs });
    return d;
  }

  selfHurt(p, dmg, weapon, cause, fx) {
    if (!p.alive) return;
    p.hp -= clamp(Math.round(dmg), 1, p.hp);
    tell(fx, { type: 'hit', sid: p.sid, by: null, hp: p.hp });
    if (p.hp <= 0) this.faint(p, null, weapon, cause, fx);
  }

  heal(p, amount, fx) {
    p.hp = Math.min(100, p.hp + Math.round(amount));
    tell(fx, { type: 'heal', sid: p.sid, hp: p.hp });
  }

  faint(vic, att, weapon, cause, fx, { hs = false, text = null } = {}) {
    if (!vic.alive) return;
    Object.assign(vic, { alive: false, hp: 0, d: vic.d + 1 });
    this.faints[vic.team]++;
    const killer = att && att.team !== vic.team ? att : null;
    tell(fx, big(text || L(`${this.nm(vic)} 倒下了！`, `${this.nm(vic)} fainted!`)), { type: 'faint', sid: vic.sid });
    tell(fx, { type: 'kill', killer: killer ? killer.sid : null, victim: vic.sid, weapon, hs, cause, assist: null });
    if (killer) killer.k++;
    if (killer && killer.alive) {
      // 经验值、升级，够格了还会进化
      const [n, exp] = [this.nm(killer), Math.round(vic.lv * 4.2 + 30)];
      this.refresh(killer);
      tell(fx, L(`${n} 获得了 ${exp} 点经验值！`, `${n} gained ${exp} Exp. Points!`), L(`${n} 升到了 Lv.${killer.lv}！`, `${n} grew to Lv. ${killer.lv}!`));
      if ((DEX[killer.dex].evoAt || [2, 5]).filter((a) => killer.k >= a).length > killer.form) this.evolve(killer, fx, false);
    }
    if (this.act[vic.team] !== vic.sid) return;
    this.act[vic.team] = null;
    if (!this.party) this.sendNext(vic.team, fx); // 大乱斗倒下一只就结束；正赛派下一只（团灭的话 check 会收尾）
  }

  /** 进化。full = 开 PR：满血 + 能力提升，到头了就「停止了进化」。 */
  evolve(p, fx, full) {
    const d = DEX[p.dex];
    const n0 = this.nm(p);
    const can = p.form < (d.branch ? 1 : d.forms.length - 1);
    if (!can && !full) return;
    if (!p.alive) Object.assign(p, { alive: true, hp: 0 });
    tell(fx, big(L(`咦？${n0} 的样子……`, `What? ${n0} is evolving!`)));
    if (can) {
      p.form++;
      this.refresh(p);
      tell(fx, { type: 'evolve', sid: p.sid, e: p.sp.e, name: p.sp.name }, big(L(`恭喜！${n0} 进化成了 ${p.sp.name}！`, `Congratulations! ${n0} evolved into ${p.sp.name}!`)));
    } else tell(fx, big(d.refuse ? line(d.refuse, n0) : L(`……${n0} 停止了进化。`, `Huh? ${n0} stopped evolving!`)));
    this.heal(p, full ? 100 : 25, fx);
    if (!full) return;
    p.atk = Math.min(3, p.atk + 1);
    p.def = Math.min(3, p.def + 1);
    tell(fx, L(`${this.nm(p)} 的 HP 全满，能力大幅提高了！`, `${this.nm(p)} is fully healed and its stats rose sharply!`));
  }

  // 铁甲蛹只会变硬。变硬够了就会变成巴大蝶
  harden(p, n, fx) {
    tell(fx, used(n, tr('harden')), { type: 'move', sid: p.sid, to: null, kind: 'guard', color: TYPE.bug.c }, p.def < 3 ? defUp(n) : defMax(n));
    p.def = Math.min(3, p.def + 1);
    if (++p.hardens >= 6) this.evolve(p, fx, false);
  }

  whiff(p, n, ev, r, fx) {
    tell(fx, used(n, { web: tr('hyperBeam'), read: tr('leer'), edit: p.sp.guard[0], agent: tr('substitute'), done: p.sp.z, misc: p.sp.quick }[ev.k] || p.sp.hit));
    if (!['shell', 'web', 'misc', 'done'].includes(ev.k)) return tell(fx, L('但是，失败了！', 'But it failed!'));
    if (r() >= 0.3) return tell(fx, { type: 'miss', sid: p.sid }, L(`${n} 的攻击没有命中！`, `${n}'s attack missed!`));
    tell(fx, L(`${n} 不知所以地攻击了自己！`, `${n} tripped and hurt itself!`));
    this.selfHurt(p, 6 + r() * 5, L('自伤', 'Self-hit'), 'bug', fx);
  }

  glare(p, n, r, fx) {
    // 鲤鱼王只会水溅跃，偶尔提醒一下大家
    if (p.sp.splash) return r() < 0.35 && tell(fx, used(n, tr('splash')), { type: 'splash', sid: p.sid }, L('但是什么也没有发生！', 'But nothing happened!'));
    const foe = this.foe(p, fx);
    if (!foe || foe.def <= -2) return;
    foe.def--;
    tell(fx, used(n, tr('leer')), { type: 'move', sid: p.sid, to: foe.sid, kind: 'status', color: '#ff4d4d' }, L(`${this.nm(foe)} 的防御降低了！`, `${this.nm(foe)}'s Defense fell!`));
  }

  guard(p, n, fx) {
    const [g, kind] = p.sp.guard;
    tell(fx, used(n, g), { type: 'move', sid: p.sid, to: null, kind: 'guard', color: p.sp.color });
    if (kind === 'splash') return tell(fx, L('但是什么也没有发生！', 'But nothing happened!'));
    if (kind === 'rest' || kind === 'heal') {
      const rest = kind === 'rest'; // 卡比兽的睡觉：回满血，然后睡两回合
      if (p.hp >= (rest ? 70 : 100)) return tell(fx, L('但是，失败了！', 'But it failed!'));
      if (rest) p.sleep = 2;
      this.heal(p, rest ? 100 : 14, fx);
      return tell(fx, rest ? L(`${n} 睡着了，HP 全部恢复了！`, `${n} slept and became healthy!`) : L(`${n} 的 HP 回复了！`, `${n}'s HP was restored.`));
    }
    if (p.def < 2) return tell(fx, defUp(n)) && p.def++;
    this.heal(p, 5, fx);
    tell(fx, !p.said.def && defMax(n));
    p.said.def = 1;
  }

  // 任务完成：Z 招式或极巨化。鲤鱼王、胖丁、喵喵有自己的版本
  zmove(p, n, r, fx) {
    const sp = p.sp;
    const foe = this.foe(p, fx);
    const zPower = L(`${n} 释放出全身的 Z 力量！`, `${n} surrounded itself with its Z-Power!`);
    if (sp.splash) return tell(fx, zPower, used(n, tr('zSplash')), { type: 'splash', sid: p.sid, big: true }, L('但是什么也没有发生！', 'But nothing happened!'));
    if (!foe) return;
    const fn = this.nm(foe);
    if (sp.sing) {
      // 胖丁唱歌把对面唱睡着，然后气鼓鼓地在人家脸上乱画
      foe.sleep = Math.max(foe.sleep, 2);
      tell(fx, used(n, tr('sing')), { type: 'move', sid: p.sid, to: foe.sid, kind: 'status', color: TYPE.fairy.c }, L(`${fn} 睡着了！`, `${fn} fell asleep!`));
      tell(fx, L(`${n} 气鼓鼓地在 ${fn} 的脸上乱涂乱画！`, `${n} angrily doodled all over ${fn}'s face!`));
      return this.hit(p, foe, this.power(p, foe, 18), { move: tr('sing') }, fx);
    }
    const z = !sp.payday && r() < 0.5;
    const move = sp.payday ? tr('payDay') : z ? sp.z : sp.max;
    if (!sp.payday) tell(fx, z ? zPower : L(`${n} 极巨化了！`, `${n} Dynamaxed!`), !z && { type: 'dyna', sid: p.sid });
    tell(fx, used(n, move), { type: 'move', sid: p.sid, to: foe.sid, kind: 'z', color: sp.color });
    const eff = CHART[sp.type][foe.sp.type] || 1;
    this.hit(p, foe, this.power(p, foe, (34 + r() * 10) * EFF_MULT[eff]), { move, eff }, fx);
    const coins = sp.payday && Math.round(300 + r() * 1700);
    if (coins) tell(fx, L(`地上散落了 ¥${coins}！`, `Coins scattered everywhere! ($${coins})`));
  }

  // 场外的队友：帮手（攒伤害，出战的下一招一起打出去）、加油（回一点血）。
  // 均衡火力是按全队动作算的，所以场外队友的动作也得变成伤害，不然人多的队反而吃亏
  support(p, ev, fx) {
    const c = this.cur(p.team);
    if (!c || ev.ok === false) return;
    const cheer = (text) => fx.push({ type: 'cheer', sid: p.sid, text });
    if (ev.k === 'agent' || HELP[ev.k]) {
      if (c.help >= HELP_CAP) return;
      c.help = ev.k === 'agent' ? HELP_CAP : Math.min(HELP_CAP, c.help + HELP[ev.k]);
      cheer(ev.k === 'read' ? L('加油！', 'Go go!') : L('帮手！', 'Helping Hand!'));
      if (ev.k === 'read' || (c.said.help && ev.k !== 'agent')) return;
      c.said.help = 1;
      return tell(fx, L(`${this.nm(p)} 使用了 帮手！`, `${this.nm(p)} used Helping Hand!`));
    }
    if (ev.k === 'edit' && c.hp < 100) this.heal(c, 3, fx);
    if (ev.k === 'edit') return cheer(L('加油！', 'Go go!'));
    if (ev.k !== 'done') return;
    tell(fx, L(`${this.nm(p)} 在精灵球里为 ${this.nm(c)} 加油！`, `${this.nm(p)} cheers for ${this.nm(c)} from its Poké Ball!`));
    this.heal(c, 10, fx);
    cheer(L('加油！！', 'GO GO GO!'));
  }

  potion(p, fx) {
    if (!p.alive) return;
    const n = this.nm(p);
    tell(fx, L(`${TEAM_NAME[p.team]} 对 ${p.sp.name} 使用了 伤药！`, `${TEAM_NAME[p.team]} used a Potion on ${p.sp.name}!`), p.sleep > 0 && L(`${n} 醒过来了！`, `${n} woke up!`));
    p.sleep = 0;
    if (p.hp >= 100) return;
    this.heal(p, 20, fx);
    tell(fx, L(`${n} 的 HP 回复了！`, `${n}'s HP was restored.`));
  }

  recalled(p, fx) {
    const [T, n] = [TEAM_NAME[p.team], p.sp.name];
    tell(fx, big(L(`${T}：回来吧，${n}！`, `${T}: ${n}, come back!`)), DEX[p.dex].ballHate && L(`${n} 死活不肯进精灵球……被硬塞了回去。`, `${n} refuses to get in the Poké Ball… and gets shoved in.`));
    this.faint(p, null, L('被训练家收回', 'Recalled'), 'human', fx, { text: L(`${this.nm(p)} 被训练家强行收回了！`, `${this.nm(p)} was forcibly recalled!`) });
  }

  // 它在等你 = 在等训练家下指令。及时回 → 攻击提高；超时 → 睡着，还被对面食梦
  onWait(p, fx) {
    if (p.alive) tell(fx, L(`${this.nm(p)} 在等训练家下指令……`, `${this.nm(p)} is waiting for orders…`), { type: 'waiting', sid: p.sid });
  }

  onAnswer(p, wait, fx) {
    if (!p.alive) return;
    p.atk = Math.min(3, p.atk + 1);
    tell(fx, L('训练家下达了指令！', 'The Trainer gave an order!'), { type: 'buff', sid: p.sid }, L(`${this.nm(p)} 的攻击提高了！`, `${this.nm(p)}'s Attack rose!`));
  }

  onWaitTimeout(p, fx) {
    if (!p.alive) return;
    const n = this.nm(p);
    p.sleep = 3;
    tell(fx, big(L(`${n} 等训练家等得睡着了……`, `${n} got tired of waiting and fell asleep…`)), { type: 'zzz', sid: p.sid });
    const foe = this.cur(OTHER[p.team]);
    if (this.act[p.team] !== p.sid || !foe) return;
    tell(fx, used(this.nm(foe), tr('dreamEater')), { type: 'move', sid: foe.sid, to: p.sid, kind: 'hit', color: TYPE.psychic.c });
    const d = this.hit(foe, p, 35, { move: tr('dreamEater'), cause: 'c4' }, fx);
    if (!d || !foe.alive) return;
    this.heal(foe, d / 2, fx);
    tell(fx, L(`${n} 的梦境被吃掉了！`, `${n}'s dream was eaten!`));
  }

  // ---------------------------------------------------------------- 胜负

  check(fx) {
    for (const team of TEAMS) {
      const f = this.field(team);
      if (!f.length || (this.party ? !this.faints[team] : f.some((p) => p.alive))) continue;
      const [T, V, cash] = [TEAM_NAME[team], TEAM_NAME[OTHER[team]], Math.max(...f.map((p) => p.lv)) * 120];
      tell(fx, !this.party && big(L(`${T} 眼前一黑……`, `${T} blacked out!`)), big(L(`${V} 战胜了 宝可梦训练家 ${T}！`, `${V} defeated Pokémon Trainer ${T}!`)));
      tell(fx, L(`${V} 得到了 ¥${cash} 作为奖金！`, `${V} got $${cash} for winning!`));
      const why = this.party ? L(`${T} 的宝可梦倒下了！`, `${T}'s Pokémon fainted!`) : L(`${T} 的宝可梦全部倒下了！`, `All of ${T}'s Pokémon fainted!`);
      return this.endRound(OTHER[team], 'battle', fx, why);
    }
  }

  timers() {
    return [this.roundStart + this.battleLen];
  }

  // 防卡死：一场打太久就比剩余 HP（平均到每只，免得人多的队白占便宜）
  onTick(fx) {
    if (this.now - this.roundStart < this.battleLen) return;
    if (!this.dealt) return void (this.roundStart = this.now);
    const w = this.leader();
    tell(fx, big(L('对战时间到！比一比剩下的 HP……', "Time's up! Comparing remaining HP…")), w && big(L(`${TEAM_NAME[w]} 的宝可梦更有精神！`, `${TEAM_NAME[w]}'s Pokémon look livelier!`)));
    this.endRound(w, 'time', fx, L('时间到 · 剩余 HP 判定', "Time's up · HP decides"));
  }

  leader() {
    const hp = (t) => this.field(t).reduce((s, p) => s + (p.alive ? p.hp : 0), 0) / Math.max(1, this.field(t).length);
    const [a, b] = [hp('claude'), hp('codex')];
    return a === b ? null : a > b ? 'claude' : 'codex';
  }
}

const used = (n, move) => L(`${n} 使用了 ${move}！`, `${n} used ${move}!`);
const defUp = (n) => L(`${n} 的防御提高了！`, `${n}'s Defense rose!`);
const defMax = (n) => L(`${n} 的防御已经无法再提高了！`, `${n}'s Defense won't go any higher!`);

// ================================================================ 画面
// GBA 风格的对战画面：对手（Codex）在右上，我方（Claude）在左下背对镜头，底部是打字机对话框。
// 画面动作挂在对应的那句话上，那句话开始打字时才播，跟游戏里一样。

const { w: W, h: H } = WORLD;
const SIDE = {
  codex: { x: 1180, y: 300, size: 190, py: 398, rx: 270, ry: 62, flip: false, box: [70, 60, 620, 150], tag: [70, 236], bench: [1530, 110, -84] },
  claude: { x: 430, y: 590, size: 250, py: 712, rx: 330, ry: 78, flip: true, box: [900, 452, 640, 200], tag: [900, 426], bench: [70, 400, 84] },
};
const TB = [24, 784, 1552, 160]; // 底部对话框
const TUFTS = (() => {
  const r = rng(42);
  return TEAMS.flatMap((team) => Array.from({ length: 26 }, () => {
    const S = SIDE[team];
    const [a, k] = [r() * Math.PI * 2, Math.sqrt(r()) * 0.9];
    return [S.x + Math.cos(a) * S.rx * k, S.py + Math.sin(a) * S.ry * k, 6 + r() * 8];
  }));
})();
const newSlot = (team) => ({ team, sid: null, e: '', name: '', inT: 9, lunge: 0, flash: 0, faintT: -1, evo: 0, dyna: 0, prev: null, label: null, sub: false });

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    this.queue = []; // 等着播的句子：{ text, prio, acts: [画面动作] }
    this.cur = null; // 正在打字的那句
    Object.assign(this, { last: '', idle: 0, timers: [], shots: [], white: 0 });
    this.hp = new Map(); // sid → { d: 显示的血, t: 目标血 }
    this.minis = new Map(); // 场外队友的小头像：sid → { x, y, hop }
    this.slots = { claude: newSlot('claude'), codex: newSlot('codex') };
    if (R) this.sync(R, true);
  }

  /** 画面和规则对齐：拖进度条时一步到位；平时只在没有句子要播的时候慢慢对齐。 */
  sync(R, hard) {
    for (const team of TEAMS) {
      const s = this.slots[team];
      const p = R.players.get(R.act[team]);
      const q = R.players.get(s.sid);
      if (p && p.onField && p.alive) {
        if (s.sid !== p.sid) this.sendOut({ sid: p.sid }, s, hard);
        Object.assign(s, { e: p.sp.e, name: p.sp.name, sub: p.sub });
      } else if (s.sid && (hard || !q || !q.onField)) s.sid = null;
      else if (s.sid && !q.alive && s.faintT < 0) s.faintT = 0.8; // 漏播的倒下：直接藏起来
    }
    for (const p of R.field()) {
      const h = this.hpOf(p.sid, p.hp);
      h.t = p.hp;
      if (hard) h.d = p.hp;
    }
  }

  hpOf(sid, init = 100) {
    if (!this.hp.has(sid)) this.hp.set(sid, { d: init, t: init });
    return this.hp.get(sid);
  }

  slotOf(sid) {
    return TEAMS.map((t) => this.slots[t]).find((s) => sid && s.sid === sid) || null;
  }

  pos(sid) {
    const s = this.slotOf(sid);
    const m = this.minis.get(sid);
    return s ? [SIDE[s.team].x, SIDE[s.team].y] : m ? [m.x, m.y] : [W / 2, 400];
  }

  after(sec, fn) {
    if (sec > 0) this.timers.push({ t: sec, fn });
    else fn();
  }

  // ---------------------------------------------------------------- 效果进来

  apply(list, R, busy) {
    for (const f of list) {
      if (f.type === 'say') this.enqueue(f, busy);
      else if (f.type === 'act') {
        const text = actText(f.ev);
        const s = this.slotOf(f.sid);
        if (text && f.ev.k !== 'think' && s && !busy) s.label = { text, ok: f.ev.ok !== false, life: 1.8 };
      } else if (f.type === 'cheer') {
        const m = this.minis.get(f.sid);
        if (m) m.hop = 0.45;
        if (m && !busy) this.fx.text(m.x, m.y - 44, f.text, '#fff', 20, 0.9);
      } else {
        const run = this.visual(f, R);
        const last = this.queue[this.queue.length - 1];
        if (run && last && !busy) last.acts.push(run);
        else if (run) run(busy);
      }
    }
  }

  enqueue(f, busy) {
    if (busy && !f.prio) return;
    this.queue.push({ text: f.text, prio: f.prio, acts: [] });
    // 积压太多就快进：先扔不重要的句子，它的画面动作并到下一句
    while (this.queue.length > (busy ? 3 : 10)) {
      const i = Math.max(0, this.queue.findIndex((m) => !m.prio));
      const [m] = this.queue.splice(i, 1);
      const next = this.queue[i] || this.queue[i - 1];
      if (next) next.acts.unshift(...m.acts);
      else for (const fn of m.acts) fn(true);
    }
  }

  /** 把一个规则效果变成一段画面动作（返回函数，等对应的句子开始打字时调用；quick = 快进，不放特效）。 */
  visual(f, R) {
    const { app, fx } = this;
    const [x, y] = [() => this.pos(f.sid)[0], () => this.pos(f.sid)[1]];
    const slot = () => this.slotOf(f.sid) || {};
    switch (f.type) {
      case 'out':
        return (quick) => {
          this.hpOf(f.sid, R.players.get(f.sid)?.hp ?? 100);
          this.sendOut(f, this.slots[f.team], quick);
        };
      case 'recall':
        return () => {
          const s = this.slots[f.team];
          if (s.sid === f.sid) Object.assign(s, { prev: { e: s.e, t: 0 }, sid: null });
        };
      case 'move': return (quick) => this.moveFx(f, quick);
      case 'hit':
        return (quick) => {
          this.hpOf(f.sid).t = f.hp;
          const [hx, hy] = this.pos(f.sid);
          this.after(!quick && f.by && this.slotOf(f.by) ? 0.22 : 0, () => {
            slot().flash = 0.6;
            fx.sparks(hx, hy, '#fff6c8', quick ? 3 : 9, 200);
            if (f.big) app.shake(0.25, 6);
            if (f.big) app.sfx.headshot();
            else if (app.sfx.ok(1)) app.sfx.tone(190, 0.12, 0.12, 'square', 70);
          });
        };
      case 'heal':
        return () => {
          this.hpOf(f.sid).t = f.hp;
          fx.ring(x(), y(), 70, 10, 'rgba(120,230,140,0.9)', 0.6, 4);
        };
      case 'faint':
        return (quick) => {
          this.hpOf(f.sid).t = 0;
          slot().faintT = 0;
          if (!quick && app.sfx.ok(2)) app.sfx.tone(620, 0.6, 0.1, 'square', 80);
        };
      case 'evolve':
        return () => {
          Object.assign(slot(), { e: f.e, name: f.name, evo: 1.8 });
          fx.ring(x(), y(), 20, 200, 'rgba(255,255,255,0.95)', 0.9, 10);
          app.sfx.good();
        };
      case 'sub':
        return () => {
          slot().sub = f.on;
          if (!f.on) fx.smoke(x(), y() + 40, 10, 16, 'rgba(255,255,255,0.7)');
        };
      case 'dyna':
        return () => {
          slot().dyna = 3;
          app.shake(0.5, 8);
          app.sfx.boom(true);
        };
      case 'splash':
        return () => {
          slot().lunge = 0.35;
          fx.sparks(x(), y() + 60, '#7cc8ff', f.big ? 30 : 10, 160);
        };
      case 'miss': return () => fx.text(x(), y() - 120, 'MISS', '#bbb', 26);
      case 'charge': case 'buff': return () => fx.ring(x(), y(), 20, 130, f.type === 'charge' ? 'rgba(255,170,60,0.9)' : 'rgba(255,90,90,0.9)', 0.6, 6);
      case 'confuse': case 'zzz': case 'waiting': return () => fx.text(x() + 60, y() - 110, { zzz: '💤', confuse: '💫', waiting: '❓' }[f.type], '#fff', 40, 1.4);
    }
    return null;
  }

  sendOut(f, s, quick) {
    if (s.sid && s.sid !== f.sid && s.faintT < 0) s.prev = { e: s.e, t: 0 };
    Object.assign(s, { sid: f.sid, inT: quick ? 9 : 0, faintT: -1, flash: 0, lunge: 0, evo: 0, dyna: 0, sub: false, label: null });
    if (f.e) Object.assign(s, { e: f.e, name: f.name });
    if (!quick && this.app.sfx.ok(1)) this.app.sfx.tone(320, 0.18, 0.08, 'triangle', 980);
  }

  moveFx(f, quick) {
    const { fx, app } = this;
    const [x1, y1] = this.pos(f.sid);
    if (f.kind === 'guard') return fx.ring(x1, y1, 40, 150, f.color, 0.6, 8);
    const s = this.slotOf(f.sid);
    if (s) s.lunge = 0.35;
    if (!f.to || quick) return;
    const [x2, y2] = this.pos(f.to);
    if (f.kind === 'status') return fx.ring(x2, y2, 160, 30, f.color, 0.6, 5);
    const [z, beam] = [f.kind === 'z', f.kind === 'beam' || f.kind === 'z'];
    this.shots.push({ beam, x1, y1, x2, y2, t: 0, dur: z ? 0.8 : beam ? 0.6 : 0.24, color: f.kind === 'beam' ? '#fff3a8' : f.color, wide: z });
    if (z) this.white = 0.35;
    if (beam) app.shake(z ? 0.6 : 0.4, z ? 10 : 6);
    if (z) app.sfx.boom(true);
    else if (beam) app.sfx.burst(0.5, 1400, 0.12, 'bandpass');
    else if (app.sfx.ok(0)) app.sfx.tone(520, 0.1, 0.05, 'square', 900);
  }

  // ---------------------------------------------------------------- 每帧

  update(dt, R) {
    this.fx.update(dt);
    for (const t of this.timers) t.t -= dt;
    const due = this.timers.filter((t) => t.t <= 0);
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const t of due) t.fn();
    for (const s of this.shots) s.t += dt;
    this.shots = this.shots.filter((s) => s.t < s.dur);
    this.white = Math.max(0, this.white - dt);
    for (const s of Object.values(this.slots)) {
      s.inT += dt;
      for (const k of ['lunge', 'flash', 'evo', 'dyna']) s[k] = Math.max(0, s[k] - dt);
      if (s.faintT >= 0) s.faintT += dt;
      if (s.prev && (s.prev.t += dt) > 0.35) s.prev = null;
      if (s.label && (s.label.life -= dt) <= 0) s.label = null;
    }
    for (const m of this.minis.values()) m.hop = Math.max(0, m.hop - dt);
    for (const h of this.hp.values()) h.d += clamp(h.t - h.d, -70 * dt, 70 * dt); // 血条每秒最多掉 70
    // 打字机：排队的句子越多打得越快，倍速回放也快一点
    if (!this.cur && this.queue.length) {
      const m = this.queue.shift();
      this.cur = { text: m.text, shown: 0, hold: 0 };
      for (const fn of m.acts) fn(false);
      this.idle = 0;
    }
    if (!this.cur) return (this.idle += dt) > 0.6 && this.sync(R, false);
    const n = this.queue.length;
    const fast = (n > 5 ? 4 : n > 1 ? 2 : 1) * Math.sqrt(clamp(this.app.speed?.() || 1, 1, 9)) * (/[a-z]/i.test(this.cur.text) ? 2 : 1); // 英文字母多，打快一倍
    const c = this.cur;
    if (c.shown < c.text.length) c.shown = Math.min(c.text.length, c.shown + dt * 28 * fast);
    else if ((c.hold += dt * fast) > 0.9) [this.last, this.cur] = [c.text, null];
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    this.drawBackground(g);
    for (const team of ['codex', 'claude']) this.drawBench(g, R, team, rt, scale);
    for (const team of ['codex', 'claude']) this.drawSlot(g, R, this.slots[team], rt);
    for (const s of this.shots) drawShot(g, s);
    this.fx.renderOver(g, scale);
    for (const team of TEAMS) {
      this.drawBox(g, R, team);
      const s = this.slots[team];
      if (!s.label || !s.sid) continue;
      g.globalAlpha = Math.min(1, s.label.life / 0.4);
      pill(g, SIDE[team].x, SIDE[team].y - SIDE[team].size * 0.62, s.label.text, { size: fontFor(scale, 16), max: 300, weight: 500, bg: s.label.ok ? 'rgba(20,30,30,0.7)' : 'rgba(130,20,20,0.82)' });
      g.globalAlpha = 1;
    }
    this.drawText(g, R, rt);
    if (this.white > 0) rr(g, 0, 0, W, H, 0, `rgba(255,255,255,${Math.min(0.85, this.white * 2.5)})`);
  }

  drawBackground(g) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#f4f8e4');
    sky.addColorStop(0.45, '#e2f0c4');
    sky.addColorStop(1, '#c4e0a0');
    rr(g, 0, 0, W, H, 0, sky);
    g.fillStyle = 'rgba(120,160,80,0.07)'; // 复古的横条纹
    for (let y = 0; y < H; y += 24) g.fillRect(0, y, W, 10);
    for (const S of Object.values(SIDE)) {
      // 草地台子
      oval(g, S.x, S.py + 6, S.rx, S.ry, '#6fa851');
      oval(g, S.x, S.py, S.rx - 8, S.ry - 8, '#a5d27a');
      oval(g, S.x - S.rx * 0.15, S.py - S.ry * 0.2, S.rx * 0.6, S.ry * 0.45, '#bfe08f');
    }
    Object.assign(g, { strokeStyle: '#5f9a44', lineWidth: 3 });
    g.beginPath();
    for (const [x, y, s] of TUFTS) {
      g.moveTo(x - s / 2, y - s);
      g.lineTo(x, y);
      g.lineTo(x + s / 2, y - s);
    }
    g.stroke();
  }

  drawSlot(g, R, s, rt) {
    const S = SIDE[s.team];
    const dir = s.team === HOME ? 1 : -1;
    if (s.prev) {
      // 被收回：红光一缩
      const k = 1 - s.prev.t / 0.35;
      sprite(g, s.prev.e, S.x, S.y, S.size * k, S.flip, k);
      dot(g, S.x, S.y, S.size * 0.5 * k, `rgba(255,60,60,${0.5 * k})`);
    }
    if (!s.sid || s.faintT > 0.8) return;
    if (s.inT < 0.3) {
      // 出场：精灵球划一道弧飞过去
      const [k, sx] = [s.inT / 0.3, s.team === HOME ? -40 : W + 40];
      return drawBall(g, sx + (S.x - sx) * k, S.y + 40 - 160 * Math.sin(k * Math.PI), 18, true, k * 12);
    }
    const grow = clamp((s.inT - 0.3) / 0.25, 0, 1);
    if (grow < 1) dot(g, S.x, S.y, S.size * 0.7 * grow + 20, `rgba(255,255,255,${0.9 * (1 - grow)})`);
    const p = R.players.get(s.sid);
    const q = s.lunge > 0 ? Math.sin((1 - s.lunge / 0.35) * Math.PI) : 0;
    const x = S.x + dir * 80 * q;
    let y = S.y - dir * 30 * q + (s.faintT < 0 ? Math.sin(rt * 2.6 + dir) * 6 : 0);
    const size = S.size * grow * (s.dyna > 0 ? 1.6 : 1) * (s.evo > 0 ? 1 + 0.18 * Math.sin(rt * 30) : 1);
    let alpha = s.flash > 0 && Math.floor(s.flash * 14) % 2 === 0 ? 0.15 : 1;
    g.save();
    if (s.faintT >= 0) {
      // 倒下：往下沉进草地里
      const k = clamp(s.faintT / 0.6, 0, 1);
      g.beginPath();
      g.rect(0, 0, W, S.py - 10);
      g.clip();
      y += k * S.size * 0.95;
      alpha *= 1 - k * 0.5;
    } else oval(g, S.x, S.py - 4, S.size * 0.36, S.size * 0.08, 'rgba(40,70,20,0.25)');
    if (s.dyna > 0) dot(g, x, y, size * 0.6, 'rgba(255,40,90,0.25)'); // 极巨化：变大一圈，红光
    if (s.evo > 0) dot(g, x, y, size * 0.55, `rgba(255,255,255,${0.5 + 0.4 * Math.sin(rt * 20)})`); // 进化：闪白光
    if (p && p.charge && s.faintT < 0) {
      Object.assign(g, { strokeStyle: `rgba(255,160,40,${0.5 + 0.3 * Math.sin(rt * 10)})`, lineWidth: 6 });
      g.beginPath();
      g.ellipse(x, y + size * 0.1, size * 0.5, size * 0.56, 0, 0, Math.PI * 2);
      g.stroke();
    }
    sprite(g, s.e, x, y, size, S.flip, alpha);
    g.restore();
    if (!p || s.faintT >= 0) return;
    // 状态小动画：睡觉冒 Z、混乱头上转小鸟、替身玩偶、反作用流汗
    const top = y - size * 0.5;
    for (let i = 0; p.sleep && i < 3; i++) {
      const k = (rt * 0.7 + i / 3) % 1;
      g.globalAlpha = 1 - k;
      txt(g, 'Z', x + 50 + k * 50, top - k * 70, 34, '#4a5a8a', 'left', 900);
      g.globalAlpha = 1;
    }
    for (let i = 0; p.conf && i < 3; i++) emoji(g, '🐤', x + Math.cos(rt * 4 + i * 2.1) * 70, top + Math.sin(rt * 4 + i * 2.1) * 18, 30);
    if (s.sub) emoji(g, '🧸', x + dir * 110, y + size * 0.25, size * 0.45);
    if (p.recharge) emoji(g, '💦', x - dir * 70, top + 20, 40);
  }

  // 场外的队友：小头像蹲在边上，帮手 / 加油时蹦一下
  drawBench(g, R, team, rt, scale) {
    const [bx, by, step] = SIDE[team].bench;
    const mates = R.field(team).filter((p) => p.sid !== this.slots[team].sid && p.alive);
    mates.forEach((p, i) => {
      if (!this.minis.has(p.sid)) this.minis.set(p.sid, { hop: 0 });
      const m = Object.assign(this.minis.get(p.sid), { x: bx + i * step, y: by });
      const hop = m.hop > 0 ? Math.sin((m.hop / 0.45) * Math.PI) * 26 : Math.sin(rt * 3 + i) * 3;
      sprite(g, p.sp.e, m.x, m.y - hop, 58, false, 0.9);
    });
    if (mates.length) txt(g, L('精灵球里加油中', 'Cheering from the ball'), bx + ((mates.length - 1) * step) / 2, by + 46, fontFor(scale, 14), 'rgba(40,60,30,0.6)', 'center', 600);
  }

  // 血量框：名字、状态牌、Lv、HP 条（绿 / 黄 / 红）；我方多一行数字和经验条。框外是训练家名牌和精灵球
  drawBox(g, R, team) {
    const [x, y, w, h] = SIDE[team].box;
    const s = this.slots[team];
    const p = s.sid ? R.players.get(s.sid) : null;
    this.drawTag(g, R, team);
    rr(g, x + 8, y + 8, w, h, 16, 'rgba(40,50,40,0.35)');
    rr(g, x, y, w, h, 16, '#f8f8e4', '#38403a', 5);
    if (!p) return txt(g, '……', x + 28, y + 50, 34, '#888', 'left', 700);
    const name = s.name || p.sp.name;
    txt(g, name, x + 28, y + 42, 38, '#383838');
    let bx = x + 40 + g.measureText(name).width;
    for (const [label, col] of badges(p)) {
      g.font = `800 20px ${FONT}`;
      const bw = g.measureText(label).width + 16;
      rr(g, bx, y + 28, bw, 28, 6, col);
      txt(g, label, bx + 8, y + 43, 20, '#fff');
      bx += bw + 6;
    }
    txt(g, `Lv.${p.lv}`, x + w - 26, y + 42, 30, '#383838', 'right');
    txt(g, L(`「${p.name}」`, `"${p.name}"`), x + 24, y + 80, 21, '#7a7a70', 'left', 500);
    const frac = clamp(this.hpOf(p.sid, p.hp).d / 100, 0, 1);
    const [bx0, bw, by] = [x + 110, w - 140, y + 108];
    rr(g, x + 34, by - 4, 66, 30, 6, '#e8a33a');
    txt(g, 'HP', x + 50, by + 11, 20, '#fff', 'left', 900);
    rr(g, bx0 - 4, by - 4, bw + 8, 30, 8, '#404840');
    rr(g, bx0, by, bw, 22, 0, '#e8e8d8');
    rr(g, bx0, by, bw * frac, 22, 0, frac > 0.5 ? '#58d068' : frac > 0.2 ? '#f0c030' : '#f05038');
    rr(g, bx0, by, bw * frac, 7, 0, 'rgba(255,255,255,0.35)');
    if (team !== HOME) return;
    const max = Math.floor(p.lv * 2 + 30);
    txt(g, `${Math.ceil(frac * max)}/ ${max}`, x + w - 30, by + 52, 30, '#383838', 'right');
    rr(g, x + 30, y + h - 22, w - 60, 10, 0, '#404840');
    rr(g, x + 30, y + h - 22, ((w - 60) * ((p.k * 37 + p.ops) % 100)) / 100, 10, 0, '#48a8f8');
  }

  // 训练家名牌 + 精灵球（●●●○○○）
  drawTag(g, R, team) {
    const [x, y] = SIDE[team].tag;
    const label = L(`${TEAM_NAME[team]} 的队伍`, `${TEAM_NAME[team]}'s party`);
    g.font = `900 26px ${FONT}`;
    const lw = g.measureText(label).width;
    rr(g, x, y - 18, lw + 24, 36, 8, DEEP[team]);
    rr(g, x, y - 18, 8, 36, 0, COLOR[team]);
    txt(g, label, x + 16, y, 26, '#fff', 'left', 900);
    const party = R.field(team);
    for (let i = 0; i < 6; i++) {
      if (party[i]) drawBall(g, x + lw + 56 + i * 40, y, 14, party[i].alive, 0);
      else rr(g, x + lw + 43 + i * 40, y - 13, 26, 26, 13, null, 'rgba(60,60,60,0.5)', 3);
    }
  }

  drawText(g, R, rt) {
    const [x, y, w, h] = TB;
    rr(g, x, y, w, h, 20, '#2b3a4a');
    rr(g, x + 12, y + 12, w - 24, h - 24, 12, '#fbfbf6', '#78b0c8', 4);
    const p = R.players.get(R.act[HOME]);
    const menu = !this.cur && R.phase === 'live' && this.idle > 2.5;
    let text = this.last;
    if (this.cur) text = this.cur.text.slice(0, Math.floor(this.cur.shown));
    else if (R.phase !== 'live') text = L('正在寻找对手……（两队都有人上场才开打）', 'Looking for an opponent… (both teams need someone on the field)');
    else if (menu) text = p && p.alive ? L(`${p.sp.name} 要做什么？`, `What will ${p.sp.name} do?`) : '……';
    g.font = `700 44px ${FONT}`;
    const lines = wrap(g, text, (menu ? w - 520 : w) - 100).slice(0, 2);
    lines.forEach((ln, i) => {
      const ly = y + (lines.length > 1 ? 56 + i * 52 : h / 2);
      txt(g, ln, x + 56, ly + 3, 44, '#d4d4c8', 'left', 700); // GBA 字的灰色阴影
      txt(g, ln, x + 53, ly, 44, '#383838', 'left', 700);
    });
    if (this.cur && this.cur.shown >= this.cur.text.length && Math.floor(rt * 3) % 2 === 0) txt(g, '▼', x + w - 58, y + h - 44, 26, '#e04838', 'center');
    if (!menu) return;
    // 没话说的时候摆出「战斗 / 背包 / 宝可梦 / 逃跑」
    const mx = x + w - 500;
    rr(g, mx, y + 8, 488, h - 16, 12, '#fbfbf6', '#5a6a78', 5);
    [L('战斗', 'FIGHT'), L('背包', 'BAG'), L('宝可梦', 'POKéMON'), L('逃跑', 'RUN')].forEach((t, i) => txt(g, t, mx + 70 + (i % 2) * 220, y + 52 + Math.floor(i / 2) * 58, 38, '#383838'));
    txt(g, '▶', mx + 24, y + 52, 38, '#383838');
  }

  hud(R) {
    if (R.phase !== 'live') return null;
    const nm = (t) => R.players.get(R.act[t])?.sp?.name || '…';
    return { mid: L(`第 ${R.round} 场对战`, `Battle ${R.round}`), sub: `${nm('claude')} vs ${nm('codex')}` };
  }
}

// ================================================================ 小工具

function badges(p) {
  const out = [];
  if (p.sleep) out.push([L('睡眠', 'SLP'), '#8a7fa8']);
  if (p.conf) out.push([L('混乱', 'CNF'), '#e0609e']);
  if (p.charge) out.push([L('蓄力', 'PUMP'), '#f08a24']);
  if (p.recharge) out.push([L('休息', 'RCHG'), '#888']);
  if (p.sub) out.push([L('替身', 'SUB'), '#6aa060']);
  if (p.def) out.push([p.def > 0 ? L('防御↑', 'DEF↑') : L('防御↓', 'DEF↓'), p.def > 0 ? '#4a8ad0' : '#c05040']);
  if (p.atk > 0) out.push([L('攻击↑', 'ATK↑'), '#d05040']);
  return out.slice(0, 3);
}

/** 招式的飞行物：普通招式是一颗属性色的球，破坏光线 / Z 招式是一道光（外圈招式色，白芯）。 */
function drawShot(g, s) {
  const k = s.t / s.dur;
  if (!s.beam) return dot(g, s.x1 + (s.x2 - s.x1) * k, s.y1 + (s.y2 - s.y1) * k, 22, s.color);
  for (const [w, c, al] of [[s.wide ? 90 : 46, s.color, 0.5], [s.wide ? 34 : 16, '#fff', 1]]) {
    Object.assign(g, { globalAlpha: al * Math.sin(k * Math.PI), lineCap: 'round', strokeStyle: c, lineWidth: w });
    g.beginPath();
    g.moveTo(s.x1, s.y1);
    g.lineTo(s.x2, s.y2);
    g.stroke();
  }
  Object.assign(g, { globalAlpha: 1, lineCap: 'butt' });
}

function sprite(g, e, x, y, size, flip, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  if (flip) g.scale(-1, 1); // 我方背对镜头，脸朝右上
  emoji(g, e, 0, 0, size);
  g.restore();
}

/** 精灵球：上红下白，中间一道黑线一个白扣。倒下的那只是灰的。 */
function drawBall(g, x, y, r, alive, spin) {
  g.save();
  g.translate(x, y);
  g.rotate(spin);
  dot(g, 0, 0, r, alive ? '#fafafa' : '#cfcfcf');
  g.fillStyle = alive ? '#f04838' : '#9a9a9a';
  g.beginPath();
  g.arc(0, 0, r, Math.PI, 0);
  g.fill();
  Object.assign(g, { strokeStyle: '#303030', lineWidth: 2.5 });
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.moveTo(-r, 0);
  g.lineTo(r, 0);
  g.stroke();
  dot(g, 0, 0, r * 0.32, '#fafafa');
  g.restore();
}

// 画图小工具：圆角框（可填可描边）、圆点、椭圆、一行字
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
function txt(g, s, x, y, size, color, align = 'left', weight = 800) {
  Object.assign(g, { font: `${weight} ${size}px ${FONT}`, textAlign: align, textBaseline: 'middle', fillStyle: color });
  g.fillText(s, x, y);
}

/** 按宽度折行：中文按字断，英文尽量在空格处断。 */
function wrap(g, text, max) {
  const lines = [''];
  for (const ch of text) {
    const cur = lines[lines.length - 1];
    if (g.measureText(cur + ch).width <= max || !cur) {
      lines[lines.length - 1] += ch;
      continue;
    }
    const cut = /[a-z0-9]/i.test(ch) ? cur.lastIndexOf(' ') : -1;
    if (cut > 0) [lines[lines.length - 1], lines[lines.length]] = [cur.slice(0, cut), cur.slice(cut + 1) + ch];
    else lines.push(ch === ' ' ? '' : ch); // 行首不留空格
  }
  return lines;
}
