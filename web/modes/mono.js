// 大富翁：经典 40 格棋盘。每个动作就是那个会话掷一次骰子，走到哪格算哪格：没人的地买下来，对面的地交房租，
// 自己的地盖房子。测试通过掷出双数再走一次，命令报错直接进监狱，烧 token 就是赚钱。哪队先破产哪队输。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, ACTIONS, WORLD, clamp, hash, rng, actText } from '../core.js';
import { L } from '../i18n.js';
import { Particles, pill, fitText, fontFor, emoji, FONT } from '../fxkit.js';

export const meta = {
  id: 'mono',
  icon: '🎲',
  get name() { return L('大富翁', 'Monopoly Tycoon'); },
  get desc() { return L('每个动作掷一次骰子：买地、收租、盖酒店。测试通过掷双数，报错进监狱，先破产的输', 'Every action rolls the dice: buy land, collect rent, build hotels. Passing tests roll doubles, errors go to jail. Go broke and you lose'); },
  get roundWord() { return L('局', 'game'); },
  get wait() {
    return {
      start: L('🅿️ {a} 停在原地等你', '🅿️ {a} is parked, waiting for you'),
      sub: L('40 秒内回它，不然吃罚单', 'Reply within 40s or it gets a parking ticket'),
      done: L('✂️ 及时回复，收小费 $50', '✂️ Quick reply: $50 tip'),
      boom: L('🚨 {a} 等太久，被贴了罚单', '🚨 {a} waited too long: parking ticket!'),
    };
  },
  get legend() {
    return [
      [L('🎲 任何动作', '🎲 Any action'), L('掷两颗骰子，走到哪格算哪格', 'Roll two dice, resolve the tile you land on')],
      [L('🏠 落在地上', '🏠 Land on a property'), L('没人的买下，对面的交租，自己的盖房', 'Unowned: buy. Theirs: pay rent. Yours: build')],
      [L('🧱 改代码', '🧱 Edit code'), L('一口气盖两栋房', 'Builds two houses at once')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('掷出双数，再掷一次', 'Doubles! Roll again')],
      [L('🐛 命令报错', '🐛 Command fails'), L('进监狱！掷出双数或交保释金才能出来', 'Go to jail! Roll doubles or pay bail')],
      [L('🔭 上网查资料', '🔭 Web search'), L('走完再抽一张机会卡', 'Draw a Chance card after moving')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('请律师捞人出狱，没坐牢就多走一回合', 'Lawyer bails you out, or an extra turn')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('晕了，下一回合不动', 'Dizzy: skips the next turn')],
      [L('✅ 任务完成', '✅ Task done'), L('发工资', 'Payday')],
      [L('💬 收到新指令', '💬 New prompt'), L('你发了个红包', 'You send a red packet')],
      [L('✋ 被打断', '✋ Interrupted'), L('你没收了它最值钱的一块地', 'You seize its most valuable property')],
      [L('⏳ 它在等你', '⏳ Waiting for you'), L('停在原地，40 秒不回吃罚单', 'Parked: no reply in 40s = parking ticket')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('最好的地直接盖酒店', 'Instant hotel on the best property')],
      [L('💰 token', '💰 Tokens'), L('烧 token 就是赚钱', 'Burning tokens literally earns money')],
      [L('📈 房价暴涨', '📈 Prices soar'), L('拖得越久租金越高', 'Rents climb as the game drags on')],
      [L('💸 先破产的输', '💸 First to go broke loses'), L('时间到就比身家', 'Time up: richest net worth wins')],
    ];
  },
};

// ================================================================ 棋盘

// i18n-dict-start —— 下面是地名和卡牌的中英对照表
const GROUPS = [
  { color: '#955436', house: 50 }, { color: '#9cd6f2', house: 50 }, { color: '#d63c95', house: 100 }, { color: '#f39325', house: 100 },
  { color: '#e3262d', house: 150 }, { color: '#f2d30f', house: 150 }, { color: '#1ea65a', house: 200 }, { color: '#2363b5', house: 200 },
];
const st = (g, price, rent, zh, en) => ({ k: 'street', g, price, rent, zh, en });
const CHANCE = { k: 'chance', zh: '机会', en: 'Chance' };
const CHEST = { k: 'chest', zh: '命运', en: 'Community Chest' };
const TILES = [
  { k: 'go', zh: '起点', en: 'GO' }, st(0, 60, [2, 10, 30, 90, 160, 250], '西二旗', "Xi'erqi"), CHEST,
  st(0, 60, [4, 20, 60, 180, 320, 450], '后厂村', 'Hou-changcun'), { k: 'tax', price: 200, zh: '所得税', en: 'Income Tax' },
  { k: 'station', price: 200, zh: '13 号线', en: 'Line 13' }, st(1, 100, [6, 30, 90, 270, 400, 550], '五道口', 'Wudaokou'), CHANCE,
  st(1, 100, [6, 30, 90, 270, 400, 550], '中关村', 'Zhong-guancun'), st(1, 120, [8, 40, 100, 300, 450, 600], '望京', 'Wangjing'),
  { k: 'jail', zh: '监狱', en: 'Jail' }, st(2, 140, [10, 50, 150, 450, 625, 750], '张江', 'Zhangjiang'),
  { k: 'util', price: 150, zh: 'GPU 集群', en: 'GPU Cluster' }, st(2, 140, [10, 50, 150, 450, 625, 750], '滨江', 'Binjiang'),
  st(2, 160, [12, 60, 180, 500, 700, 900], '南山', 'Nanshan'), { k: 'station', price: 200, zh: '机场快线', en: 'Airport Express' },
  st(3, 180, [14, 70, 200, 550, 750, 950], '班加罗尔', 'Bangalore'), CHEST, st(3, 180, [14, 70, 200, 550, 750, 950], '柏林', 'Berlin'),
  st(3, 200, [16, 80, 220, 600, 800, 1000], '特拉维夫', 'Tel Aviv'), { k: 'parking', zh: '免费停车', en: 'Free Parking' },
  st(4, 220, [18, 90, 250, 700, 875, 1050], '西雅图', 'Seattle'), CHANCE, st(4, 220, [18, 90, 250, 700, 875, 1050], '伦敦', 'London'),
  st(4, 240, [20, 100, 300, 750, 925, 1100], '新加坡', 'Singapore'), { k: 'station', price: 200, zh: '高铁站', en: 'HSR Station' },
  st(5, 260, [22, 110, 330, 800, 975, 1150], '首尔', 'Seoul'), st(5, 260, [22, 110, 330, 800, 975, 1150], '东京', 'Tokyo'),
  { k: 'util', price: 150, zh: '咖啡机', en: 'Coffee Machine' }, st(5, 280, [24, 120, 360, 850, 1025, 1200], '香港', 'Hong Kong'),
  { k: 'gotojail', zh: '进监狱', en: 'Go to Jail' }, st(6, 300, [26, 130, 390, 900, 1100, 1275], '上海', 'Shanghai'),
  st(6, 300, [26, 130, 390, 900, 1100, 1275], '纽约', 'New York'), CHEST, st(6, 320, [28, 150, 450, 1000, 1200, 1400], '苏黎世', 'Zurich'),
  { k: 'station', price: 200, zh: '超级高铁', en: 'Hyperloop' }, CHANCE, st(7, 350, [35, 175, 500, 1100, 1300, 1500], '旧金山', 'San Francisco'),
  { k: 'tax', price: 100, zh: 'Token 账单', en: 'Token Bill' }, st(7, 400, [50, 200, 600, 1400, 1700, 2000], '硅谷', 'Silicon Valley'),
];
const CARDS = {
  chance: [
    { zh: '你的 PR 被合并了，收 $200', en: 'Your PR got merged. Collect $200', cash: 200 },
    { zh: '生产环境挂了，赔 $150', en: 'Prod is down. Pay $150', cash: -150 },
    { zh: 'Code review 打回重写，倒退 3 格', en: 'Code review says rewrite it. Go back 3 spaces', move: -3 },
    { zh: '需求又改了：回到起点，领 $200', en: 'Requirements changed again. Advance to GO, collect $200', go: 0 },
    { zh: '被猎头挖去硅谷', en: 'Poached by a headhunter. Advance to Silicon Valley', go: 39 },
    { zh: '手滑敲了 rm -rf /，直接进监狱', en: 'Oops, rm -rf /. Go directly to jail', jail: 1 },
    { zh: '律师函警告：出狱免费卡', en: 'Lawyer on retainer: Get Out of Jail Free', free: 1 },
    { zh: '仓库 Star 破万，赞助商打钱 $100', en: 'Repo hit 10k stars. Sponsors pay $100', cash: 100 },
    { zh: '云服务器续费：每栋房子 $25，每座酒店 $100', en: 'Cloud renewal: $25 per house, $100 per hotel', repairs: [25, 100] },
    { zh: '去坐最近的地铁，房东收双倍', en: 'Take the nearest train. Pay the owner double', near: 1 },
    { zh: 'AI 写的代码一次跑通，收 $150', en: 'AI code ran on the first try. Collect $150', cash: 150 },
    { zh: '忘了关 GPU 实例，付 $100', en: 'Forgot to shut down the GPU. Pay $100', cash: -100 },
    { zh: '坐 13 号线通勤，过起点领 $200', en: 'Commute on Line 13. If you pass GO, collect $200', go: 5 },
    { zh: '被拉去当技术评审，付对面 $50', en: 'Drafted as a tech reviewer. Pay the other team $50', payFoe: 50 },
    { zh: '去东京出差', en: 'Business trip to Tokyo', go: 27 },
  ],
  chest: [
    { zh: '银行系统出错，对你有利，收 $200', en: 'Bank error in your favor. Collect $200', cash: 200 },
    { zh: '颈椎病复诊，付 $50', en: 'Neck-pain checkup. Pay $50', cash: -50 },
    { zh: '年终奖到账，收 $100', en: 'Year-end bonus. Collect $100', cash: 100 },
    { zh: '今天你生日，对面给你 $50', en: "It's your birthday! The other team pays you $50", each: 50 },
    { zh: '你在选美比赛中获得二等奖，收 $10', en: 'Second prize in a beauty contest. Collect $10', cash: 10 },
    { zh: '报了《21 天精通 Rust》，付 $50', en: 'Bought "Rust in 21 Days". Pay $50', cash: -50 },
    { zh: '律师函警告：出狱免费卡', en: 'Get Out of Jail Free', free: 1 },
    { zh: '线上事故你背锅，进监狱', en: 'You took the blame for the outage. Go to jail', jail: 1 },
    { zh: '退税，收 $20', en: 'Income tax refund. Collect $20', cash: 20 },
    { zh: '回到起点，领 $200', en: 'Advance to GO. Collect $200', go: 0 },
    { zh: '黑客松拿了冠军，收 $100', en: 'Won the hackathon. Collect $100', cash: 100 },
    { zh: '咖啡泼到键盘上，付 $50', en: 'Coffee on the keyboard. Pay $50', cash: -50 },
    { zh: '开源项目收到捐赠，收 $50', en: 'Open-source donation. Collect $50', cash: 50 },
    { zh: '机房要修：每栋房子 $40，每座酒店 $115', en: 'Server room repairs: $40 per house, $115 per hotel', repairs: [40, 115] },
  ],
};
// i18n-dict-end

const BUYABLE = new Set(['street', 'station', 'util']);
const [STATIONS, UTILS] = [[5, 15, 25, 35], [12, 28]];
const GROUP_TILES = GROUPS.map((_, g) => TILES.map((t, i) => (t.k === 'street' && t.g === g ? i : -1)).filter((i) => i >= 0));
const TOKENS = ['🎩', '🚗', '🐕', '🚢', '👢', '🐈', '🦆', '🐧'];
const tname = (i) => L(TILES[i].zh, TILES[i].en);
const houseCost = (i) => GROUPS[TILES[i].g]?.house || 0;
const money = (n) => `${n < 0 ? '−' : ''}$${String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** 一队的身家：现金 + 地价 + 房子造价。 */
function worthOf(own, houses, cash, team) {
  let v = cash;
  for (let i = 0; i < 40; i++) if (own[i] === team) v += TILES[i].price + houses[i] * houseCost(i);
  return v;
}

/** 确定性洗牌：种子是固定的字符串，和语言、时钟都无关。 */
function shuffled(list, seed) {
  const [r, out] = [rng(hash(seed)), list.slice()];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ================================================================ 规则

export class Rules extends Base {
  static defaults = {
    cash: 1000, rent: 1.6, boomEvery: 16, roundLen: 15 * 60e3, deal: 3, salary: 200,
    partyCash: 400, partyRent: 5, partyBoomEvery: 4, partyRoundLen: 5 * 60e3, partyDeal: 6, partySalary: 100,
    boom: 1.5, bail: 50, tokRate: 1 / 100, buyReserve: 0.1, buildReserve: 0.3, richAt: 0.8,
  };

  init() {
    const [o, P] = [this.opts, this.opts.party];
    this.cfg = {
      cash: P ? o.partyCash : o.cash, rent: P ? o.partyRent : o.rent, boomEvery: P ? o.partyBoomEvery : o.boomEvery, salary: P ? o.partySalary : o.salary,
      deal: P ? o.partyDeal : o.deal, boom: o.boom, bail: o.bail, tok: o.tokRate, buyRes: o.buyReserve, buildRes: o.buildReserve, richAt: o.richAt,
    };
    this.roundLen = P ? o.partyRoundLen : o.roundLen;
    this.newBoard();
  }

  /** 新开一局：钱包重置、两副牌按局数洗好，再按官方「速战速决」规则先发几张地契（谁手里总地价低先发谁）。 */
  newBoard() {
    this.own = Array(40).fill(null);
    this.by = Array(40).fill(null); // 谁买的这块地（收租算在他头上）
    this.houses = Array(40).fill(0); // 0～4 栋房子，5 = 酒店
    this.wallet = {};
    for (const t of TEAMS) this.wallet[t] = { cash: this.cfg.cash, free: 0, acc: 0, broke: false };
    // level：房价暴涨了几次；pot：免费停车的奖池，税和罚款都丢进去，谁停上去谁拿走
    [this.turns, this.level, this.pot] = [0, 0, 0];
    this.decks = { chance: this.shuffle('chance', 0), chest: this.shuffle('chest', 0) };
    const sum = { claude: 0, codex: 0 };
    const deeds = shuffled(TILES.map((t, i) => (BUYABLE.has(t.k) ? i : -1)).filter((i) => i >= 0), `deal-${this.round}`);
    for (const i of deeds.slice(0, this.cfg.deal * 2)) {
      const team = sum.claude <= sum.codex ? 'claude' : 'codex';
      [this.own[i], sum[team]] = [team, sum[team] + TILES[i].price];
    }
  }

  shuffle(kind, cycle) {
    return { order: shuffled(CARDS[kind].map((_, i) => i), `${kind}-${this.round}-${cycle}`), i: 0, cycle };
  }

  initPlayer(p) {
    Object.assign(p, { pos: 0, jail: 0, dizzy: false, token: this.players.size % TOKENS.length });
  }

  onRoundStart(fx) {
    this.newBoard();
    for (const p of this.players.values()) Object.assign(p, { pos: 0, jail: 0, dizzy: false });
    fx.push({ type: 'newGame', own: this.own.slice(), cash: this.cfg.cash });
  }

  // 一局结束：把最后的棋盘拍个快照给画面定格（下一局马上就开了）
  onRoundEnd(winner, fx) {
    const cash = { claude: this.wallet.claude.cash, codex: this.wallet.codex.cash };
    fx.push({ type: 'final', winner, own: this.own.slice(), houses: this.houses.slice(), cash, broke: TEAMS.find((t) => this.wallet[t].broke) || null });
  }

  rentMult() {
    return this.cfg.rent * this.cfg.boom ** this.level;
  }

  /**
   * 均衡火力：掷骰子多的队，每一回合的进账和开销都按比例缩小，掷得少的放大，两边每分钟的现金流差不多。
   * （大富翁里多掷骰子不一定占便宜，后期反而是多踩对面的地，所以收支一起缩放。）夹在 0.5～2 倍，免得一张税单就把人掏空。
   */
  bm(team) {
    return clamp(this.balanceMult(team), 0.5, 2);
  }

  monopoly(team, g) {
    return GROUP_TILES[g].every((i) => this.own[i] === team);
  }

  onEvent(p, ev, r, fx) {
    if (ACTIONS.has(ev.k)) return this.turn(p, ev, r, fx);
    if (this.phase !== 'live') return;
    switch (ev.k) {
      case 'done': return this.earn(p, this.cfg.salary, 'salary', fx);
      case 'prompt': return this.earn(p, 100, 'prompt', fx);
      case 'compact':
      case 'apierr':
        p.dizzy = true;
        return fx.push({ type: 'dizzy', sid: p.sid, why: ev.k });
      case 'abort': return this.seize(p, fx);
      case 'pr': return this.hotel(p, fx);
    }
  }

  dice(r, forced) {
    const a = 1 + Math.floor(r() * 6);
    return [a, forced ? a : 1 + Math.floor(r() * 6)];
  }

  /** 一个动作 = 这个棋子的一回合。 */
  turn(p, ev, r, fx) {
    if (this.phase !== 'live') {
      // 热身：只走路，不算钱
      const [a, b] = this.dice(r, false);
      fx.push({ type: 'roll', sid: p.sid, team: p.team, d: [a, b] });
      return this.walk(p, a + b, fx, false);
    }
    if (p.dizzy) {
      p.dizzy = false;
      return fx.push({ type: 'skip', sid: p.sid });
    }
    // 破产会当场结束这一局（大乱斗里还会停下来），之后的事都不做了
    const rd = this.round;
    const over = () => this.halted || this.round !== rd;
    if (++this.turns % this.cfg.boomEvery === 0 && this.level < 10) this.soar(fx);
    if (ev.ok === false) return this.toJail(p, 'err', fx);
    let extra = ev.k === 'agent' ? 1 : 0;
    if (p.jail) {
      if (this.jailTurn(p, ev, r, fx, over) !== 'roll') return;
      extra = 0;
    }
    for (let k = 0; k <= extra && !over() && !p.jail; k++) {
      for (let n = 0; n < 3; n++) {
        const forced = !!ev.hs && k === 0 && n === 0;
        const [a, b] = this.dice(r, forced);
        if (forced) p.hs++;
        fx.push({ type: 'roll', sid: p.sid, team: p.team, d: [a, b], dbl: a === b, forced, n });
        if (a === b && n === 2) {
          this.toJail(p, 'speed', fx);
          break;
        }
        this.walk(p, a + b, fx);
        if (over()) return;
        this.land(p, a + b, ev, r, fx);
        if (over() || p.jail || a !== b) break;
      }
    }
    if (over() || p.jail) return;
    if (ev.k === 'web') this.draw(p, 'chance', ev, r, fx);
    if (over() || p.jail) return;
    // 改代码：一口气盖两栋；平时手头宽裕也顺手盖一栋
    if (ev.k === 'edit') for (let k = 0; k < 2; k++) this.develop(p, 0.05, fx);
    else if (this.wallet[p.team].cash > this.cfg.cash * this.cfg.richAt) this.develop(p, this.cfg.buildRes, fx);
  }

  /** 在牢里的一回合：律师 / 出狱卡 / 有钱就交保释金，不然掷骰子碰运气，第三次还不是双数就交钱出来。 */
  jailTurn(p, ev, r, fx, over) {
    const w = this.wallet[p.team];
    if (ev.k === 'agent') {
      fx.push({ type: 'note', text: L('🪂 {0} 请来律师，无罪释放', '🪂 {0} lawyered up and walked free'), sids: [p.sid] });
      return this.release(p, 'lawyer', fx);
    }
    if (w.free > 0) return w.free--, this.release(p, 'card', fx);
    if (w.cash >= this.cfg.bail * 10) {
      this.pay(p.team, this.cfg.bail, null, 'bail', fx, null, p.sid);
      return this.release(p, 'bail', fx);
    }
    const [a, b] = this.dice(r, !!ev.hs);
    fx.push({ type: 'roll', sid: p.sid, team: p.team, d: [a, b], dbl: a === b, forced: !!ev.hs, jail: true });
    if (a !== b && p.jail < 3) {
      fx.push({ type: 'stuck', sid: p.sid, n: p.jail++ });
      return 'stay';
    }
    if (a !== b) this.pay(p.team, this.cfg.bail, null, 'bail', fx, null, p.sid);
    if (over()) return 'stay';
    this.release(p, a === b ? 'dbl' : 'served', fx);
    this.walk(p, a + b, fx);
    if (!over()) this.land(p, a + b, ev, r, fx);
    return 'moved';
  }

  release(p, how, fx) {
    p.jail = 0;
    fx.push({ type: 'free', sid: p.sid, team: p.team, how });
    return 'roll';
  }

  toJail(p, why, fx) {
    [p.pos, p.jail] = [10, 1];
    p.d++;
    fx.push({ type: 'jail', sid: p.sid, team: p.team, why });
    const sub = {
      err: L(`${p.name} 命令报错，被警察带走`, `${p.name}'s command failed. Busted!`),
      tile: L(`${p.name} 踩到了「进监狱」`, `${p.name} landed on Go to Jail`),
      speed: L(`${p.name} 连掷三次双数：超速！`, `${p.name} rolled three doubles: speeding!`),
      card: L(`${p.name} 抽到了坐牢卡`, `${p.name} drew a jail card`),
    }[why];
    fx.push({ type: 'announce', text: L('进监狱！', 'Go to jail!'), sub, cls: 'bad', ms: 1300 });
  }

  /** 走 steps 格（可以是负数）。路过或停在起点领工资。 */
  walk(p, steps, fx, salary = true) {
    const from = p.pos;
    p.pos = (from + steps + 40) % 40;
    fx.push({ type: 'move', sid: p.sid, team: p.team, from, steps });
    if (salary && steps > 0 && from + steps >= 40) this.earn(p, this.cfg.salary, 'go', fx, 0);
  }

  /** 停在一格上：买地、交租、盖房、交税、抽卡…… mult 是「房东收双倍」。 */
  land(p, roll, ev, r, fx, mult = 1) {
    const [i, t] = [p.pos, TILES[p.pos]];
    if (BUYABLE.has(t.k)) {
      const o = this.own[i];
      if (!o) return this.buy(p, i, fx);
      if (o !== p.team) return this.pay(p.team, this.rent(i, roll) * mult * this.bm(p.team), o, 'rent', fx, i, p.sid);
      if (t.k === 'street') this.build(p, i, ev.k === 'edit' ? 0.05 : this.cfg.buildRes, 'land', fx);
    } else if (t.k === 'tax') this.pay(p.team, t.price * this.bm(p.team), null, 'tax', fx, i, p.sid);
    else if (t.k === 'chance' || t.k === 'chest') this.draw(p, t.k, ev, r, fx);
    else if (t.k === 'gotojail') this.toJail(p, 'tile', fx);
    else if (t.k === 'parking' && this.pot > 0) {
      const n = this.pot;
      this.pot = 0;
      this.wallet[p.team].cash += n;
      fx.push({ type: 'cash', team: p.team, sid: p.sid, amount: n, why: 'pot', tile: i });
      fx.push({ type: 'note', text: L(`🅿️ {0} 停进免费停车，捡走奖池 ${money(n)}`, `🅿️ {0} hit the Free Parking jackpot: ${money(n)}`), sids: [p.sid] });
    }
  }

  rent(i, roll) {
    const [t, o] = [TILES[i], this.own[i]];
    if (t.k === 'station') return 25 * 2 ** (STATIONS.filter((s) => this.own[s] === o).length - 1) * this.rentMult();
    if (t.k === 'util') return roll * (UTILS.every((s) => this.own[s] === o) ? 10 : 4) * this.rentMult();
    return t.rent[this.houses[i]] * (this.monopoly(o, t.g) ? 2 : 1) * this.rentMult(); // 包下整条街：租金翻倍
  }

  earn(p, amount, why, fx, tile = null) {
    const n = Math.round(amount * this.bm(p.team));
    this.wallet[p.team].cash += n;
    fx.push({ type: 'cash', team: p.team, sid: p.sid, amount: n, why, tile });
  }

  /** 付钱。to = 收钱的队，没有就进免费停车的奖池。钱不够先变卖，还不够就破产。sid = 谁的动作（画面按他的动画排队）。 */
  pay(team, amount, to, why, fx, tile = null, sid = null) {
    amount = Math.max(1, Math.round(amount));
    const w = this.wallet[team];
    w.cash -= amount;
    fx.push({ type: 'cash', team, sid, amount: -amount, why, tile, to });
    if (to) {
      this.wallet[to].cash += amount;
      const owner = why === 'rent' ? this.players.get(this.by[tile]) : null;
      if (owner) owner.dmg += amount;
      fx.push({ type: 'cash', team: to, sid, amount, why: why === 'rent' ? 'rentIn' : 'gift', tile, from: team });
    } else this.pot += amount;
    if (w.cash < 0) this.liquidate(team, fx, tile, why, sid);
  }

  /** 钱不够：先半价卖房子，再把地半价卖回银行，都从便宜的开始。还不够就破产。 */
  liquidate(team, fx, tile, why, sid) {
    const w = this.wallet[team];
    const mine = this.own.map((o, i) => (o === team ? i : -1)).filter((i) => i >= 0).sort((a, b) => TILES[a].price - TILES[b].price);
    for (const i of mine) {
      if (w.cash >= 0) break;
      if (!this.houses[i]) continue;
      const each = houseCost(i) / 2;
      const n = Math.min(this.houses[i], Math.ceil(-w.cash / each));
      [this.houses[i], w.cash] = [this.houses[i] - n, w.cash + n * each];
      fx.push({ type: 'sell', team, sid, tile: i, houses: this.houses[i], amount: n * each, lost: false });
    }
    for (const i of mine) {
      if (w.cash >= 0) break;
      this.own[i] = this.by[i] = null;
      w.cash += TILES[i].price / 2;
      fx.push({ type: 'sell', team, sid, tile: i, houses: 0, amount: TILES[i].price / 2, lost: true });
    }
    if (w.cash >= 0) return;
    this.wallet[team].broke = true;
    fx.push({ type: 'bankrupt', team, sid });
    const sub = why === 'rent'
      ? L(`${TEAM_NAME[team]} 付不起 ${tname(tile)} 的房租`, `${TEAM_NAME[team]} can't pay the rent on ${tname(tile)}`)
      : L(`${TEAM_NAME[team]} 资不抵债`, `${TEAM_NAME[team]} is out of money`);
    fx.push({ type: 'announce', text: L('破产！', 'Bankrupt!'), sub, cls: 'bad', ms: 2200 });
    this.endRound(OTHER[team], 'bankrupt', fx, L(`${TEAM_NAME[team]} 破产了`, `${TEAM_NAME[team]} went bankrupt`));
  }

  /** 没人的地：手头留一点余钱就买。 */
  buy(p, i, fx) {
    const [w, t] = [this.wallet[p.team], TILES[i]];
    if (w.cash - t.price < this.cfg.cash * this.cfg.buyRes) return fx.push({ type: 'pass', sid: p.sid, tile: i });
    w.cash -= t.price;
    [this.own[i], this.by[i]] = [p.team, p.sid];
    p.k++;
    fx.push({ type: 'buy', team: p.team, sid: p.sid, tile: i, price: t.price });
    if (t.k !== 'street' || !this.monopoly(p.team, t.g)) return;
    const names = GROUP_TILES[t.g].map(tname).join(' + ');
    fx.push({ type: 'announce', text: L('垄断！', 'Monopoly!'), sub: L(`${TEAM_NAME[p.team]} 包下了 ${names}`, `${TEAM_NAME[p.team]} owns all of ${names}`), cls: p.team, ms: 1500 });
  }

  /** 盖一栋房子（4 栋之后是酒店）。reserve = 盖完至少留多少（按开局资金的比例）。 */
  build(p, i, reserve, why, fx) {
    const [w, cost] = [this.wallet[p.team], houseCost(i)];
    if (this.houses[i] >= 5 || w.cash - cost < this.cfg.cash * reserve) return;
    w.cash -= cost;
    this.houses[i]++;
    p.a++;
    fx.push({ type: 'build', team: p.team, sid: p.sid, tile: i, houses: this.houses[i], cost, why });
    if (this.houses[i] === 5) this.hotelNews(p, i, fx);
  }

  /** 挑「多一栋房子租金涨得最多」的那块地盖一栋。 */
  develop(p, reserve, fx) {
    let [best, gain] = [-1, 0];
    for (let i = 0; i < 40; i++) {
      const h = this.houses[i];
      if (this.own[i] !== p.team || TILES[i].k !== 'street' || h >= 5) continue;
      if (TILES[i].rent[h + 1] - TILES[i].rent[h] > gain) [best, gain] = [i, TILES[i].rent[h + 1] - TILES[i].rent[h]];
    }
    if (best >= 0) this.build(p, best, reserve, reserve < this.cfg.buildRes ? 'edit' : 'rich', fx);
  }

  /** 开 PR：最好的那块地直接盖酒店；一块地都没有就发 PR 奖金。 */
  hotel(p, fx) {
    let best = -1;
    for (let i = 0; i < 40; i++) {
      if (this.own[i] === p.team && TILES[i].k === 'street' && this.houses[i] < 5 && (best < 0 || TILES[i].rent[5] > TILES[best].rent[5])) best = i;
    }
    if (best < 0) return this.earn(p, 300, 'pr', fx);
    this.houses[best] = 5;
    p.a++;
    fx.push({ type: 'build', team: p.team, sid: p.sid, tile: best, houses: 5, cost: 0, why: 'pr' });
    this.hotelNews(p, best, fx);
  }

  hotelNews(p, i, fx) {
    fx.push({ type: 'announce', text: L('盖酒店！', 'Hotel!'), sub: L(`${TEAM_NAME[p.team]} 在 ${tname(i)} 盖起了酒店`, `${TEAM_NAME[p.team]} built a hotel on ${tname(i)}`), cls: p.team, ms: 1400 });
  }

  /** 你打断了它：没收它最值钱的一块地。 */
  seize(p, fx) {
    const val = (i) => TILES[i].price + this.houses[i] * houseCost(i);
    let best = -1;
    for (let i = 0; i < 40; i++) if (this.own[i] === p.team && (best < 0 || val(i) > val(best))) best = i;
    if (best < 0) return;
    [this.own[best], this.by[best], this.houses[best]] = [null, null, 0];
    fx.push({ type: 'sell', team: p.team, sid: p.sid, tile: best, houses: 0, amount: 0, lost: true, seize: true });
    fx.push({ type: 'note', text: L(`✋ 你打断了 {0}，没收了 ${tname(best)}`, `✋ You interrupted {0} and seized ${tname(best)}`), sids: [p.sid], cls: 'big' });
  }

  /** 抽一张牌。牌堆每局按局数洗好，抽完再洗，回放拖进度条也是同一副牌。 */
  draw(p, kind, ev, r, fx) {
    let d = this.decks[kind];
    if (d.i >= d.order.length) d = this.decks[kind] = this.shuffle(kind, d.cycle + 1);
    const id = d.order[d.i++];
    const [c, bm] = [CARDS[kind][id], this.bm(p.team)];
    fx.push({ type: 'card', sid: p.sid, team: p.team, deck: kind, id });
    if (c.cash > 0) this.earn(p, c.cash, 'card', fx);
    else if (c.cash < 0) this.pay(p.team, -c.cash * bm, null, 'card', fx, null, p.sid);
    else if (c.free) this.wallet[p.team].free++;
    else if (c.jail) this.toJail(p, 'card', fx);
    else if (c.each) this.pay(OTHER[p.team], c.each * bm, p.team, 'gift', fx, null, p.sid);
    else if (c.payFoe) this.pay(p.team, c.payFoe * bm, OTHER[p.team], 'gift', fx, null, p.sid);
    else if (c.repairs) {
      let n = 0;
      for (let i = 0; i < 40; i++) if (this.own[i] === p.team) n += this.houses[i] === 5 ? c.repairs[1] : this.houses[i] * c.repairs[0];
      if (n) this.pay(p.team, n * bm, null, 'repairs', fx, null, p.sid);
    } else {
      // 挪位置的卡：倒退 3 格 / 去某一格 / 去最近的车站（房东收双倍）
      const to = c.move ? p.pos + c.move : c.near ? STATIONS.find((s) => s > p.pos) ?? STATIONS[0] : c.go;
      this.walk(p, c.move || (to - p.pos + 40) % 40, fx);
      this.land(p, 7, ev, r, fx, c.near ? 2 : 1);
    }
  }

  /** 房价暴涨：每隔几回合，所有租金再乘一次（大字隔一次喊一回，免得刷屏）。 */
  soar(fx) {
    const m = +(this.cfg.boom ** ++this.level).toFixed(1);
    fx.push({ type: 'soar', level: this.level, mult: m });
    if (this.level % 2) fx.push({ type: 'announce', text: L('房价暴涨！', 'Prices soar!'), sub: L(`所有租金 ×${m}`, `All rents ×${m}`), cls: 'gold', ms: 1100 });
  }

  // 烧 token 就是赚钱：零头攒着，满 $20 入账一次
  onTokens(p, n, fx) {
    if (this.phase !== 'live' || !p.onField) return;
    const w = this.wallet[p.team];
    w.acc += n * this.cfg.tok * this.bm(p.team);
    if (w.acc < 20) return;
    const m = Math.floor(w.acc);
    [w.acc, w.cash] = [w.acc - m, w.cash + m];
    fx.push({ type: 'cash', team: p.team, amount: m, why: 'tok' });
  }

  // 它在等你：停在原地。及时回 = 小费；超时 = 罚单（进奖池）
  onAnswer(p, wait, fx) {
    if (this.phase === 'live') this.earn(p, 50, 'tip', fx);
  }

  onWaitTimeout(p, fx) {
    if (this.phase === 'live') this.pay(p.team, 100, null, 'fine', fx, null, p.sid);
  }

  timers() {
    return [this.roundStart + this.roundLen];
  }

  onTick(fx) {
    if (this.now < this.roundStart + this.roundLen) return;
    if (!this.turns) this.roundStart = this.now; // 一步都没走，不算这局
    else this.endRound(this.leader(), 'time', fx, L('时间到 · 身家最高的赢', 'Time up · richest net worth wins'));
  }

  leader() {
    const [a, b] = TEAMS.map((t) => worthOf(this.own, this.houses, this.wallet[t].cash, t));
    return a === b ? null : a > b ? 'claude' : 'codex';
  }
}

// ================================================================ 画面
// 左边一张大棋盘：格子、色带、地名、价格、房子、棋子；中间掷骰子、翻卡；右边两队的钱包和现金流水。

const { w: W, h: H } = WORLD;
const [BX, BY, BS, CORNER, BAND, PAD] = [40, 30, 900, 118, 22, 14];
const EDGE = (BS - 2 * CORNER) / 9;
const MID = [BX + BS / 2, BY + BS / 2];
const [PANEL_X, PANEL_W, CARD_H] = [972, 600, 446];
const CARD_Y = { claude: 34, codex: 500 };
const DECK_POS = { chance: [MID[0] - 150, MID[1] + 178], chest: [MID[0] + 150, MID[1] + 178] };
const DECK_COLOR = { chance: '#f08a24', chest: '#4f9fe0' };
const JAIL_CELL = { x: BX + 38, y: BY + BS - CORNER, w: CORNER - 38, h: CORNER - 38 };
const INK = '#1f3a2a';
const ease = (k) => 1 - (1 - k) * (1 - k);

/** 第 i 格的位置。side：0 下边、1 左边、2 上边、3 右边（色带朝棋盘里面）。 */
function tileRect(i) {
  const [R, B] = [BX + BS - CORNER, BY + BS - CORNER];
  if (i % 10 === 0) return { x: i === 0 || i === 30 ? R : BX, y: i < 20 ? B : BY, w: CORNER, h: CORNER, side: i / 10, corner: true };
  if (i < 10) return { x: R - i * EDGE, y: B, w: EDGE, h: CORNER, side: 0 };
  if (i < 20) return { x: BX, y: B - (i - 10) * EDGE, w: CORNER, h: EDGE, side: 1 };
  if (i < 30) return { x: BX + CORNER + (i - 21) * EDGE, y: BY, w: EDGE, h: CORNER, side: 2 };
  return { x: R, y: BY + CORNER + (i - 31) * EDGE, w: CORNER, h: EDGE, side: 3 };
}

const bandRect = (r) => [{ x: r.x, y: r.y, w: r.w, h: BAND }, { x: r.x + r.w - BAND, y: r.y, w: BAND, h: r.h }, { x: r.x, y: r.y + r.h - BAND, w: r.w, h: BAND }, { x: r.x, y: r.y, w: BAND, h: r.h }][r.side];
const bodyRect = (r, cut) => (!cut ? r : [{ x: r.x, y: r.y + BAND, w: r.w, h: r.h - BAND }, { x: r.x, y: r.y, w: r.w - BAND, h: r.h }, { x: r.x, y: r.y, w: r.w, h: r.h - BAND }, { x: r.x + BAND, y: r.y, w: r.w - BAND, h: r.h }][r.side]);

/** 棋子站在这一格的哪里。监狱那格：坐牢的在牢房里，探监的站在下面那条边上。 */
function anchor(i, jailed = false) {
  if (i === 10) return jailed ? [JAIL_CELL.x + JAIL_CELL.w / 2, JAIL_CELL.y + JAIL_CELL.h / 2 + 4] : [BX + 62, BY + BS - 19];
  const b = bodyRect(tileRect(i), TILES[i].k === 'street');
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** 同一格上有好几个棋子就排开。 */
function slot(k, n, i, jailed) {
  if (n <= 1) return [0, 0];
  if (i === 10 && !jailed) return [(k - (n - 1) / 2) * 20, 0];
  const cols = n <= 4 ? 2 : 3;
  return [((k % cols) - (cols - 1) / 2) * 22, (Math.floor(k / cols) - (Math.ceil(n / cols) - 1) / 2) * 22];
}

function rr(g, x, y, w, h, r, fill) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) (g.fillStyle = fill), g.fill();
}

function lin(g, x0, y0, x1, y1, ...stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

function txt(g, s, x, y, font, color, align = 'center') {
  [g.font, g.fillStyle, g.textAlign, g.textBaseline] = [`${font} ${FONT}`, color, align, 'middle'];
  g.fillText(s, x, y);
}

/** 自动换行：中文一个字一断，英文按词（和连字符）断。 */
function wrap(g, text, max) {
  const out = [''];
  for (const w of text.match(/[\u2e80-\u9fff\uff00-\uffef]|[^\s\u2e80-\u9fff\uff00-\uffef-]+-?\s*|-|\s+/g) || []) {
    const cur = out[out.length - 1];
    if (!cur.trim() || g.measureText(cur + w).width <= max) out[out.length - 1] = cur + w;
    else out.push(w.trimStart());
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 找一个放得下的字号，最多 lines 行。 */
function fitLines(g, text, max, sizes, lines, weight = 700) {
  for (const size of sizes) {
    g.font = `${weight} ${size}px ${FONT}`;
    const out = wrap(g, text, max);
    if (out.length <= lines && out.every((s) => g.measureText(s).width <= max)) return { out, size };
  }
  return { out: wrap(g, text, max).slice(0, lines).map((s) => fitText(g, s, max)), size: sizes[sizes.length - 1] };
}

function drawHouse(g, x, y, s, color) {
  g.beginPath(); g.moveTo(x - s / 2, y); g.lineTo(x, y - s / 2); g.lineTo(x + s / 2, y); g.lineTo(x + s / 2, y + s / 2); g.lineTo(x - s / 2, y + s / 2); g.closePath();
  [g.fillStyle, g.strokeStyle, g.lineWidth] = [color, '#fff', 1.6];
  g.fill(); g.stroke();
}

const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function drawDie(g, x, y, s, v, rot, glow) {
  g.save(); g.translate(x, y); g.rotate(rot);
  [g.shadowColor, g.shadowBlur] = [glow, 18];
  rr(g, -s / 2, -s / 2, s, s, s * 0.2, '#fbfaf4');
  [g.shadowBlur, g.strokeStyle, g.lineWidth, g.fillStyle] = [0, 'rgba(0,0,0,0.35)', 2, v === 1 ? '#d6282f' : '#222'];
  g.stroke();
  for (const [dx, dy] of PIPS[v]) circle(g, dx * s * 0.27, dy * s * 0.27, s * (v === 1 ? 0.13 : 0.085));
  g.restore();
}

function circle(g, x, y, r, fill = true) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) g.fill();
}

// ---------------------------------------------------------------- 静态棋盘（每种语言画一张缓存起来）

function drawTile(g, i) {
  const [t, r] = [TILES[i], tileRect(i)];
  const [cx, cy] = [r.x + r.w / 2, r.y + r.h / 2];
  [g.fillStyle, g.strokeStyle] = ['#eef6ef', INK];
  g.fillRect(r.x, r.y, r.w, r.h);
  if (i === 0) {
    txt(g, L('起点', 'GO'), cx, cy - 18, '900 34px', '#c8202a');
    txt(g, L('路过领 $200', 'Collect $200'), cx, cy + 14, '700 12px', INK);
    [g.strokeStyle, g.lineWidth] = ['#c8202a', 6];
    g.beginPath(); g.moveTo(cx + 34, cy + 38); g.lineTo(cx - 30, cy + 38); g.moveTo(cx - 18, cy + 28); g.lineTo(cx - 32, cy + 38); g.lineTo(cx - 18, cy + 48); g.stroke();
  } else if (i === 10) {
    const c = JAIL_CELL;
    [g.fillStyle, g.strokeStyle, g.lineWidth] = ['#f39a3d', 'rgba(30,30,30,0.75)', 3];
    g.fillRect(c.x, c.y, c.w, c.h);
    txt(g, L('监狱', 'JAIL'), c.x + c.w / 2, c.y + 13, '900 14px', INK);
    g.beginPath();
    for (let k = 1; k < 6; k++) g.moveTo(c.x + (k * c.w) / 6, c.y + 24), g.lineTo(c.x + (k * c.w) / 6, c.y + c.h);
    g.stroke();
    [g.strokeStyle, g.lineWidth] = [INK, 1.5];
    g.strokeRect(c.x, c.y, c.w, c.h);
    txt(g, L('探', 'JUST'), r.x + 19, r.y + 30, '800 12px', INK);
    txt(g, L('监', 'VISIT'), r.x + 19, r.y + 50, '800 12px', INK);
  } else if (i === 20 || i === 30) {
    emoji(g, i === 20 ? '🚗' : '👮', cx, cy - 16, 40);
    txt(g, i === 20 ? L('免费停车', 'FREE PARKING') : L('进监狱', 'GO TO JAIL'), cx, cy + 26, '900 14px', i === 20 ? '#c8202a' : INK);
    if (i === 20) txt(g, L('奖池在这', 'Jackpot!'), cx, cy + 44, '700 11px', INK);
  } else {
    const street = t.k === 'street';
    const band = bandRect(r);
    [g.fillStyle, g.lineWidth] = [street ? GROUPS[t.g].color : '#eef6ef', 1.2];
    if (street) g.fillRect(band.x, band.y, band.w, band.h), g.strokeRect(band.x, band.y, band.w, band.h);
    // 竖着排：图标、地名（最多两行，放不下就缩字号）、价格
    const b = bodyRect(r, street);
    const icon = { station: '🚇', util: i === 12 ? '⚡' : '☕', tax: i === 4 ? '💸' : '🧾', chest: '🎁', chance: '?' }[t.k];
    const { out, size } = fitLines(g, L(t.zh, t.en), b.w - 8, [13, 12, 11, 10, 9], 2);
    const price = BUYABLE.has(t.k) ? `$${t.price}` : t.k === 'tax' ? L(`付 $${t.price}`, `Pay $${t.price}`) : '';
    let y = b.y + (b.h - (icon ? 26 : 0) - out.length * (size + 2) - (price ? 16 : 0)) / 2;
    if (icon === '?') txt(g, '?', b.x + b.w / 2, y + 12, '900 30px', '#e8730c');
    else if (icon) emoji(g, icon, b.x + b.w / 2, y + 12, 20);
    y += icon ? 26 : 0;
    for (const line of out) txt(g, line, b.x + b.w / 2, y + size / 2 + 1, `700 ${size}px`, INK), (y += size + 2);
    if (price) txt(g, price, b.x + b.w / 2, y + 8, '800 11px', '#3d5a48');
  }
  [g.strokeStyle, g.lineWidth] = [INK, 1.5];
  g.strokeRect(r.x, r.y, r.w, r.h);
}

function drawCardBack(g, deck, w = 150, h = 96) {
  rr(g, -w / 2, -h / 2, w, h, 10, DECK_COLOR[deck]);
  [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.85)', 3];
  g.stroke();
  if (deck === 'chance') txt(g, '?', 0, -6, `900 ${h * 0.5}px`, '#fff');
  else emoji(g, '🎁', 0, -6, h * 0.36);
  txt(g, deck === 'chance' ? L('机会', 'CHANCE') : L('命运', 'COMMUNITY CHEST'), 0, h / 2 - 15, `800 ${h * 0.13}px`, '#fff');
}

function drawBoard() {
  const c = document.createElement('canvas');
  c.width = c.height = (BS + PAD * 2) * 2;
  const g = c.getContext('2d');
  g.scale(2, 2); g.translate(PAD - BX, PAD - BY);
  rr(g, BX - PAD, BY - PAD, BS + PAD * 2, BS + PAD * 2, 16, '#163222');
  g.fillStyle = lin(g, 0, BY, 0, BY + BS, '#d7ecdb', '#bfdcc6');
  g.fillRect(BX, BY, BS, BS);
  for (let i = 0; i < 40; i++) drawTile(g, i);
  // 中间的大招牌：斜着的红色横幅
  g.save(); g.translate(MID[0], BY + CORNER + 105); g.rotate(-0.06);
  [g.shadowColor, g.shadowBlur] = ['rgba(0,0,0,0.35)', 12];
  rr(g, -220, -50, 440, 100, 12, '#d6282f');
  [g.shadowBlur, g.strokeStyle, g.lineWidth] = [0, '#fff', 4];
  g.stroke();
  [g.lineWidth, g.strokeStyle, g.font, g.textAlign, g.textBaseline] = [6, 'rgba(80,0,0,0.6)', `900 64px ${FONT}`, 'center', 'middle'];
  g.strokeText(L('大富翁', 'TYCOON'), 0, 2);
  txt(g, L('大富翁', 'TYCOON'), 0, 2, '900 64px', '#fff');
  g.restore();
  txt(g, L('AI 特别版 · 烧 token 就是赚钱', 'AI EDITION · burning tokens is income'), MID[0], BY + CORNER + 175, '700 15px', '#2c4a37');
  for (const deck of ['chance', 'chest']) {
    g.save(); g.translate(...DECK_POS[deck]); g.rotate(deck === 'chance' ? -0.16 : 0.16);
    for (let k = 3; k >= 0; k--) g.save(), g.translate(k * 2.5, k * 2.5), drawCardBack(g, deck), g.restore();
    g.restore();
  }
  return c;
}

const LAYERS = {};
const boardLayer = () => (LAYERS[L('zh', 'en')] ||= drawBoard());

/** 现金流水的说明文字。 */
function whyText(f) {
  const tn = f.tile != null ? tname(f.tile) : '';
  return {
    go: L('💵 过起点', '💵 Passed GO'), rent: L(`🏠 交租 · ${tn}`, `🏠 Rent · ${tn}`), rentIn: L(`🏠 收租 · ${tn}`, `🏠 Rent from ${tn}`),
    gift: L('🤝 两队转账', '🤝 Transfer'), tax: `💸 ${tn}`, card: L('🃏 卡牌', '🃏 Card'), repairs: L('🔧 维修费', '🔧 Repairs'),
    salary: L('✅ 发工资', '✅ Payday'), prompt: L('🧧 你发的红包', '🧧 Your red packet'), tok: L('🔥 烧 token', '🔥 Token burn'),
    tip: L('✂️ 及时回复小费', '✂️ Quick-reply tip'), fine: L('🚨 罚单', '🚨 Parking ticket'), bail: L('🔓 保释金', '🔓 Bail'),
    pot: L('🅿️ 免费停车奖池', '🅿️ Free Parking jackpot'), pr: L('🏆 PR 奖金', '🏆 PR bonus'),
  }[f.why] || '';
}

const PAWN_FX = new Set(['roll', 'move', 'jail', 'free', 'stuck', 'skip', 'dizzy', 'buy', 'pass', 'build', 'sell', 'cash', 'card', 'bankrupt', 'soar']);
const WAIT = { roll: 0.45, jail: 0.3, free: 0.3, stuck: 0.3, skip: 0.3, buy: 0.3, pass: 0.15, build: 0.25, sell: 0.15, card: 1 }; // 演完一个效果棋子停多久

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    [this.pawns, this.coins, this.cardQ, this.card, this.dice, this.frozen, this.pending, this.last, this.next] = [new Map(), [], [], null, null, null, null, null, null];
    this.ticker = { claude: [], codex: [] };
    this.own = R?.own ? R.own.slice() : Array(40).fill(null);
    this.houses = R?.houses ? R.houses.slice() : Array(40).fill(0);
    this.cash = { claude: R?.wallet?.claude.cash ?? 0, codex: R?.wallet?.codex.cash ?? 0 };
    this.show = { ...this.cash };
    if (R) for (const p of R.field()) this.pawn(R, p.sid);
  }

  pawn(R, sid) {
    let pw = this.pawns.get(sid);
    const p = R.players.get(sid);
    if (!pw && p?.onField) {
      const [x, y] = anchor(p.pos, !!p.jail);
      pw = { sid, team: p.team, tile: p.pos, jailed: !!p.jail, x, y, tx: x, ty: y, lift: 0, hop: null, fly: null, queue: [], wait: 0, held: !!(this.pending || this.frozen), label: null, nameT: 0 };
      this.pawns.set(sid, pw);
    }
    return pw;
  }

  apply(list, R, busy) {
    this.busy = busy;
    for (const f of list) {
      if (PAWN_FX.has(f.type)) {
        // 跟棋子有关的效果排进它的动画队列：骰子停了再走，走到了再买地交租
        const pw = f.sid ? this.pawn(R, f.sid) : null;
        if (!pw || busy) this.run(f, pw, true);
        else if (pw.queue.push(f) > 16) this.flush(pw);
      } else if (f.type === 'act') {
        const pw = this.pawn(R, f.sid);
        const text = f.ev.k !== 'think' && actText(f.ev);
        if (pw && text && !(busy && f.ev.k === 'read')) [pw.label, pw.nameT] = [{ text, ok: f.ev.ok !== false, life: 1.8 }, 5];
        if (pw && ACTIONS.has(f.ev.k)) this.last = f.sid;
      } else if (f.type === 'join') this.pawn(R, f.sid);
      else if (f.type === 'bench') this.pawns.delete(f.sid);
      else if (f.type === 'final') this.final(f, busy);
      else if (f.type === 'newGame') {
        this.next = f;
        if (!this.pending && !this.frozen) this.fresh(true);
      }
    }
  }

  /** 一局结束：等棋子把最后几步走完，再把最后的棋盘定格几秒。 */
  final(f, busy) {
    this.pending = { snap: { ...f, t: 0, dur: busy ? 0.7 : 3.4 }, t: 0 };
    for (const pw of this.pawns.values()) {
      if (busy) this.flush(pw);
      if (pw.queue.length || pw.hop || pw.fly || pw.wait > 0) pw.queue.push({ type: 'barrier' });
      else pw.held = true;
    }
  }

  /** 新一局：开局发好的地契、满满的钱包、棋子回到起点。定格期间排进来的新一局动作接着演；drop = 扔掉热身时没演完的。 */
  fresh(drop) {
    const n = this.next;
    if (!n) return;
    [this.own, this.houses, this.cash, this.ticker] = [n.own.slice(), Array(40).fill(0), { claude: n.cash, codex: n.cash }, { claude: [], codex: [] }];
    for (const pw of this.pawns.values()) {
      [pw.tile, pw.jailed, pw.held, pw.hop, pw.fly, pw.wait] = [0, false, false, null, null, 0];
      if (drop) pw.queue = [];
    }
  }

  flush(pw) {
    if (pw.hop) pw.tile = pw.hop.path[pw.hop.path.length - 1];
    [pw.hop, pw.fly, pw.wait] = [null, null, 0];
    while (pw.queue.length && !pw.held) {
      const f = pw.queue.shift();
      if (f.type === 'barrier') pw.held = true;
      else this.run(f, pw, true);
    }
  }

  tick(team, amount, text) {
    if (!amount) return;
    this.cash[team] += amount;
    this.ticker[team].unshift({ amount, text, t: 0 });
    if (this.ticker[team].length > 5) this.ticker[team].pop();
  }

  /** 演一个效果，返回这个棋子接下来要停多久。instant = 倍速很高或者积压太多，直接出结果。 */
  run(f, pw, instant) {
    const { app, fx } = this;
    const loud = !instant && app.sfx.ok(1);
    const at = f.tile != null ? anchor(f.tile) : pw ? [pw.x, pw.y] : MID;
    const say = (text, color, size = 15, dy = 26) => !instant && fx.text(at[0], at[1] - dy, text, color, size, 1.25);
    const tones = (list, dur, type, gap) => loud && list.forEach((fr, k) => app.sfx.tone(fr, dur, 0.07, type, null, k * gap));
    const tn = f.tile != null ? tname(f.tile) : '';
    switch (f.type) {
      case 'roll':
        this.dice = { d: f.d, team: f.team, dbl: f.dbl, forced: f.forced, jail: f.jail, t: instant ? 9 : 0 };
        tones([700, 860, 640], 0.03, 'square', 0.065);
        break;
      case 'move': {
        const path = Array.from({ length: Math.abs(f.steps) }, (_, s) => (f.from + Math.sign(f.steps) * (s + 1) + 40) % 40);
        if (pw) pw.jailed = false;
        if (pw && (instant || !path.length)) pw.tile = path.length ? path[path.length - 1] : f.from;
        else if (pw) [pw.tile, pw.hop] = [f.from, { path, k: 0, t: 0, per: Math.min(0.13, 1.4 / path.length) }];
        break;
      }
      case 'jail':
        if (pw) [pw.tile, pw.jailed, pw.fly] = [10, true, instant ? null : { x0: pw.x, y0: pw.y, t: 0, dur: 0.65 }];
        if (loud) [0, 0.28].forEach((d) => app.sfx.tone(880, 0.26, 0.08, 'sawtooth', 620, d)); // 警笛
        say(L('🚔 抓走！', '🚔 Busted!'), '#ff6b6b', 18, 30);
        break;
      case 'free':
        if (pw) pw.jailed = false;
        say({ lawyer: L('🪂 律师捞人', '🪂 Lawyered!'), card: L('🃏 出狱卡', '🃏 Jail-free card'), bail: L('🔓 交保释金', '🔓 Bailed out'), dbl: L('🎲 双数越狱', '🎲 Doubles: free!'), served: L('🔓 刑满释放', '🔓 Time served') }[f.how], '#9fe0a8');
        break;
      case 'stuck':
      case 'skip':
      case 'dizzy':
      case 'pass':
        say({
          stuck: L(`🔒 没掷出双数 ${f.n}/3`, `🔒 No doubles ${f.n}/3`), skip: L('💫 晕了，跳过', '💫 Dizzy, skipped'), pass: L('买不起', "Can't afford"),
          dizzy: f.why === 'apierr' ? L('📡 断网了', '📡 Disconnected') : L('💫 记忆被压缩', '💫 Memory squashed'),
        }[f.type], f.type === 'dizzy' ? '#fff' : '#ccc', 14);
        break;
      case 'buy':
        this.own[f.tile] = f.team;
        this.tick(f.team, -f.price, L(`🏷️ 买下 ${tn}`, `🏷️ Bought ${tn}`));
        if (!instant) fx.ring(at[0], at[1], 8, 50, COLOR[f.team], 0.5, 4);
        say(L('买下！', 'SOLD!'), COLOR[f.team], 18, 24);
        tones([1568, 2093], 0.1, 'square', 0.07); // 收银机
        break;
      case 'build': {
        const hotel = f.houses === 5;
        this.houses[f.tile] = f.houses;
        this.tick(f.team, -f.cost, hotel ? L(`🏨 酒店 · ${tn}`, `🏨 Hotel · ${tn}`) : L(`🏡 盖房 · ${tn}`, `🏡 House · ${tn}`));
        if (!instant) fx.sparks(at[0], at[1], hotel ? '#ff5a5a' : '#6fd38b', 10, 140);
        say(hotel ? L('🏨 酒店！', '🏨 HOTEL!') : `🏡 ×${f.houses}`, hotel ? '#ff7a7a' : '#8fe09a', hotel ? 20 : 15, 24);
        tones(hotel ? [523, 659, 784, 1047] : [784, 988], 0.12, 'triangle', 0.07);
        break;
      }
      case 'sell':
        if (f.lost) this.own[f.tile] = null;
        this.houses[f.tile] = f.houses;
        this.tick(f.team, f.amount, L(`📉 变卖 · ${tn}`, `📉 Sold · ${tn}`));
        if (f.seize) this.ticker[f.team].unshift({ amount: 0, text: L(`✋ 你没收了 ${tn}`, `✋ You seized ${tn}`), t: 0 });
        say(f.seize ? L('✋ 没收', '✋ SEIZED') : L('📉 变卖', '📉 SOLD OFF'), '#ffb35a', 14, 20);
        break;
      case 'cash':
        this.tick(f.team, f.amount, whyText(f));
        if (instant) break;
        // 进账的钱化成金币飞进钱包
        if (f.why === 'go' || f.why === 'rentIn' || f.why === 'pot') for (let k = 0; k < (f.why === 'go' ? 4 : 7); k++) this.coins.push({ x: at[0], y: at[1], x2: PANEL_X + 160, y2: CARD_Y[f.team] + 98, t: -k * 0.05, dur: 0.6 });
        if (f.amount < 0 && pw) say(money(f.amount), '#ff6b6b', f.why === 'rent' ? 20 : 15);
        if (f.why === 'rent' && loud) app.sfx.tone(700, 0.18, 0.08, 'triangle', 300);
        if (f.why === 'rentIn' || f.why === 'go') tones([1319, 1760], 0.07, 'triangle', 0.06);
        break;
      case 'card':
        this.cardQ.push({ deck: f.deck, id: f.id, team: f.team, sid: f.sid, t: 0, dur: instant ? 1.1 : 2.8 });
        if (this.cardQ.length > 3) this.cardQ.shift();
        if (loud) app.sfx.burst(0.1, 2600, 0.12, 'highpass');
        break;
      case 'bankrupt':
        fx.explosion(PANEL_X + PANEL_W / 2, CARD_Y[f.team] + 100, true);
        app.shake(0.5, 10);
        app.sfx.boom(true);
        break;
      case 'soar':
        if (!instant) fx.text(MID[0], MID[1] + 92, L(`📈 租金 ×${f.mult}`, `📈 Rent ×${f.mult}`), '#ffd166', 22, 1.6);
        break;
    }
    return instant ? 0 : f.type === 'cash' ? (f.why === 'rent' ? 0.35 : 0.08) : WAIT[f.type] || 0;
  }

  update(dt, R) {
    this.fx.update(dt);
    if (this.dice) this.dice.t += dt;
    if (!this.card && this.cardQ.length) this.card = this.cardQ.shift();
    if (this.card && (this.card.t += dt * (1 + this.cardQ.length)) >= this.card.dur) this.card = null;
    for (const c of this.coins) c.t += dt;
    this.coins = this.coins.filter((c) => c.t < c.dur);
    for (const team of TEAMS) {
      this.show[team] += ((this.frozen ? this.frozen.cash[team] : this.cash[team]) - this.show[team]) * Math.min(1, dt * 6);
      for (const e of this.ticker[team]) e.t += dt;
    }
    for (const pw of this.pawns.values()) this.stepPawn(pw, dt);
    this.layout(dt);
    const pend = this.pending;
    if (pend && ((pend.t += dt) > 4 || [...this.pawns.values()].every((pw) => pw.held))) {
      for (const pw of this.pawns.values()) this.flush(pw);
      [this.frozen, this.pending] = [pend.snap, null];
      if (!pend.snap.broke) this.app.sfx.round(true);
    } else if (!pend && this.frozen && (this.frozen.t += dt) >= this.frozen.dur) {
      this.frozen = null;
      this.fresh(false);
    }
    // 动画都演完了：和规则层对一下账（拖进度条、漏掉的小钱都在这里补齐）
    if (this.pending || this.frozen || !R.own || [...this.pawns.values()].some((pw) => pw.queue.length || pw.hop || pw.fly || pw.wait > 0)) return;
    [this.own, this.houses] = [R.own.slice(), R.houses.slice()];
    for (const team of TEAMS) this.cash[team] = R.wallet[team].cash;
    for (const pw of this.pawns.values()) {
      const p = R.players.get(pw.sid);
      if (p) [pw.tile, pw.jailed] = [p.pos, !!p.jail];
    }
  }

  stepPawn(pw, dt) {
    if (pw.label && (pw.label.life -= dt) <= 0) pw.label = null;
    pw.nameT = Math.max(0, pw.nameT - dt);
    const speed = 1 + pw.queue.length * 0.6; // 有积压就演快一点
    const h = pw.hop;
    if (h) {
      h.t += dt * speed;
      while (h.t >= h.per && h.k < h.path.length) [h.t, pw.tile] = [h.t - h.per, h.path[h.k++]];
      if (h.k >= h.path.length) pw.hop = null;
      return;
    }
    if (pw.fly && (pw.fly.t += dt * speed) < pw.fly.dur) return;
    pw.fly = null;
    if (pw.wait > 0 && (pw.wait -= dt * speed) > 0) return;
    while (pw.queue.length && !pw.held) {
      const f = pw.queue.shift();
      if (f.type === 'barrier') pw.held = true;
      else if ((pw.wait = this.run(f, pw, false)) > 0 || pw.hop || pw.fly) return;
    }
  }

  /** 棋子的位置：跳格子时一格一格蹦过去，坐牢时飞进牢房，平时在格子里排好。 */
  layout(dt) {
    const groups = new Map();
    for (const pw of this.pawns.values()) {
      const key = pw.tile * 2 + (pw.jailed ? 1 : 0);
      groups.set(key, [...(groups.get(key) || []), pw]);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.sid < b.sid ? -1 : 1)).forEach((pw, k) => {
        const [[ax, ay], [ox, oy]] = [anchor(pw.tile, pw.jailed), slot(k, list.length, pw.tile, pw.jailed)];
        [pw.tx, pw.ty] = [ax + ox, ay + oy];
      });
    }
    for (const pw of this.pawns.values()) {
      if (pw.hop) {
        const [[x1, y1], [x2, y2]] = [anchor(pw.tile), anchor(pw.hop.path[pw.hop.k])];
        const u = clamp(pw.hop.t / pw.hop.per, 0, 1);
        [pw.x, pw.y, pw.lift] = [x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, Math.sin(u * Math.PI) * 22];
      } else if (pw.fly) {
        const u = ease(clamp(pw.fly.t / pw.fly.dur, 0, 1));
        [pw.x, pw.y, pw.lift] = [pw.fly.x0 + (pw.tx - pw.fly.x0) * u, pw.fly.y0 + (pw.ty - pw.fly.y0) * u, Math.sin(u * Math.PI) * 140];
      } else {
        const k = Math.min(1, dt * 12);
        [pw.x, pw.y, pw.lift] = [pw.x + (pw.tx - pw.x) * k, pw.y + (pw.ty - pw.y) * k, pw.lift * (1 - k)];
      }
    }
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const [rt, fs, snap] = [this.app.rt(), fontFor(scale, 12), this.frozen];
    const [own, houses] = snap ? [snap.own, snap.houses] : [this.own, this.houses];
    g.fillStyle = lin(g, 0, 0, W, H, '#10241a', '#070d0a');
    g.fillRect(0, 0, W, H);
    g.drawImage(boardLayer(), BX - PAD, BY - PAD, BS + PAD * 2, BS + PAD * 2);
    this.drawEstates(g, own, houses);
    this.drawCentre(g, R, rt);
    this.drawPawns(g, R, rt);
    for (const c of this.coins) {
      const u = ease(clamp(c.t / c.dur, 0, 1));
      if (c.t >= 0) txt(g, '🪙', c.x + (c.x2 - c.x) * u, c.y + (c.y2 - c.y) * u - Math.sin(u * Math.PI) * 120, '18px', '#ffd166');
    }
    this.fx.renderOver(g, scale);
    this.drawTags(g, R, fs);
    this.drawCard(g, R);
    for (const team of TEAMS) this.drawWallet(g, R, team, own, houses);
    if (snap) this.drawFinal(g, snap);
  }

  /** 有主的地：铺一层队伍色，外沿一条色条；色带上画房子（绿）和酒店（红）。 */
  drawEstates(g, own, houses) {
    for (let i = 0; i < 40; i++) {
      const team = own[i];
      if (!team) continue;
      const [r, street] = [tileRect(i), TILES[i].k === 'street'];
      const b = bodyRect(r, street);
      [g.globalAlpha, g.fillStyle] = [0.24, COLOR[team]];
      g.fillRect(b.x, b.y, b.w, b.h);
      g.globalAlpha = 1;
      g.fillRect(...[[r.x, r.y + r.h - 7, r.w, 7], [r.x, r.y, 7, r.h], [r.x, r.y, r.w, 7], [r.x + r.w - 7, r.y, 7, r.h]][r.side]);
      if (!street || !houses[i]) continue;
      const [band, across] = [bandRect(r), r.side % 2 === 0];
      if (houses[i] === 5) drawHouse(g, band.x + band.w / 2, band.y + band.h / 2 + 1, 18, '#e3262d');
      else for (let k = 0; k < houses[i]; k++) {
        const u = (k + 0.5) / 4;
        drawHouse(g, across ? band.x + band.w * u : band.x + band.w / 2, across ? band.y + band.h / 2 + 1 : band.y + band.h * u + 1, 13, '#2fb84f');
      }
    }
  }

  /** 棋盘中间：局数 / 房价 / 倒计时、免费停车奖池、骰子。 */
  drawCentre(g, R, rt) {
    const left = Math.max(0, (R.roundLen || 0) - (R.now - R.roundStart));
    const clock = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    const m = +((R.cfg?.boom || 1.5) ** (R.level || 0)).toFixed(1);
    const info = R.phase === 'live' ? L(`第 ${R.round} 局 · 房价 ×${m} · ⏱ ${clock}`, `Game ${R.round} · Rent ×${m} · ⏱ ${clock}`) : L('热身中 · 等对手上场', 'Warm-up · waiting for an opponent');
    if (!this.frozen) pill(g, MID[0], BY + CORNER + 205, info, { size: 17, max: 460, weight: 800, color: m > 3 ? '#ffd166' : '#fff', bg: 'rgba(20,40,28,0.85)' });
    if (R.pot > 0) pill(g, MID[0], MID[1] + 70, L(`🅿️ 免费停车奖池 ${money(R.pot)}`, `🅿️ Free Parking jackpot ${money(R.pot)}`), { size: 15, max: 360, weight: 700, color: '#ffe08a', bg: 'rgba(20,40,28,0.8)' });
    const d = this.dice;
    if (!d) return;
    const k = clamp(d.t / 0.45, 0, 1);
    g.globalAlpha = d.t > 4 ? 0.55 : 1;
    for (let j = 0; j < 2; j++) {
      // 滚的时候点数乱跳、上下弹，停下来才是真点数
      const v = k < 1 ? 1 + (Math.floor(rt * 14 + j * 3) % 6) : d.d[j];
      const x = MID[0] + (j ? 44 : -44) + (k < 1 ? Math.sin(rt * 40 + j) * 5 : 0);
      drawDie(g, x, MID[1] - 8 - Math.abs(Math.sin(k * Math.PI * 2.5)) * 34 * (1 - k), 62, v, k < 1 ? (1 - k) * (j ? 6 : -5) : j ? 0.08 : -0.07, COLOR[d.team] || '#fff');
    }
    g.globalAlpha = 1;
    if (k < 1) return;
    if (d.dbl && d.t < 2.5) txt(g, d.jail ? L('双数！越狱成功', 'DOUBLES! Jailbreak') : `${d.forced ? '🎯 ' : ''}${L('双数！再掷一次', 'DOUBLES! Roll again')}`, MID[0], MID[1] + 42, '900 22px', '#ffd166');
    else if (d.jail && d.t < 2) txt(g, L('🔒 牢里掷骰子：要双数才能出去', '🔒 Rolling for doubles in jail'), MID[0], MID[1] + 42, '700 15px', '#ffb3b3');
  }

  drawPawns(g, R, rt) {
    for (const pw of [...this.pawns.values()].sort((a, b) => a.y - a.lift - (b.y - b.lift))) {
      const p = R.players.get(pw.sid);
      if (!p) continue;
      const [x, y] = [pw.x, pw.y - pw.lift];
      // 影子（跳起来时变小变淡）、最近动过的那个套一圈光、队伍色的棋子
      g.fillStyle = `rgba(0,0,0,${0.35 - Math.min(0.2, pw.lift / 300)})`;
      g.beginPath(); g.ellipse(pw.x + 2, pw.y + 10, 12 - Math.min(5, pw.lift / 10), 5, 0, 0, Math.PI * 2); g.fill();
      if (this.last === pw.sid) {
        [g.strokeStyle, g.globalAlpha, g.lineWidth] = [COLOR[pw.team], 0.5 + 0.4 * Math.sin(rt * 6), 3];
        circle(g, x, y, 18, false);
        g.stroke();
        g.globalAlpha = 1;
      }
      [g.fillStyle, g.lineWidth, g.strokeStyle] = [COLOR[pw.team], 2.5, DEEP[pw.team]];
      circle(g, x, y, 13);
      g.stroke();
      emoji(g, TOKENS[p.token ?? 0], x, y + 1, 15);
      if (pw.jailed && !pw.fly) {
        // 铁窗
        [g.strokeStyle, g.lineWidth] = ['rgba(25,25,25,0.9)', 2.5];
        g.beginPath(); g.moveTo(x - 12, y - 15); g.lineTo(x + 12, y - 15);
        for (const dx of [-9, -3, 3, 9]) g.moveTo(x + dx, y - 16), g.lineTo(x + dx, y + 15);
        g.stroke();
      }
      const w = R.waits?.get(pw.sid);
      if (w && !w.boom) emoji(g, '⏳', x + 14, y - 14, 14);
      else if (p.dizzy) emoji(g, '💫', x + Math.cos(rt * 5) * 12, y - 16 + Math.sin(rt * 5) * 3, 13);
    }
  }

  /** 名字牌（最近动过的棋子）和动作气泡。 */
  drawTags(g, R, fs) {
    for (const pw of this.pawns.values()) {
      const p = R.players.get(pw.sid);
      if (!p || (pw.nameT <= 0 && this.last !== pw.sid && !pw.label)) continue;
      const y = pw.y - pw.lift - 28;
      g.globalAlpha = Math.min(1, Math.max(pw.nameT, this.last === pw.sid ? 1 : 0));
      pill(g, pw.x, y, p.name, { color: COLOR[pw.team], size: fs, max: 130, weight: 700 });
      if (pw.label) {
        g.globalAlpha = Math.min(1, pw.label.life / 0.4);
        pill(g, pw.x, y - fs - 8 - (1.8 - pw.label.life) * 6, pw.label.text, { size: fs - 1, max: 200, weight: 500, bg: pw.label.ok ? 'rgba(10,12,16,0.78)' : 'rgba(130,20,20,0.88)' });
      }
      g.globalAlpha = 1;
    }
  }

  /** 抽到的卡：从牌堆飞到中间，翻过来，念完再消失。 */
  drawCard(g, R) {
    const c = this.card;
    if (!c) return;
    const [dx, dy] = DECK_POS[c.deck];
    const e = ease(clamp(c.t / 0.22, 0, 1));
    const u = clamp((c.t - 0.22) / 0.3, 0, 1);
    const [cw, ch] = [430, 250];
    g.save();
    g.globalAlpha = clamp((c.dur - c.t) / 0.3, 0, 1);
    g.translate(dx + (MID[0] - dx) * e, dy + (MID[1] + 36 - dy) * e); // 从牌堆飞出来，横着压扁再展开 = 翻面
    g.scale((0.35 + 0.65 * e) * Math.max(0.03, Math.abs(Math.cos(u * Math.PI))), 0.35 + 0.65 * e);
    [g.shadowColor, g.shadowBlur] = ['rgba(0,0,0,0.5)', 24];
    if (u < 0.5) drawCardBack(g, c.deck, cw, ch);
    else {
      rr(g, -cw / 2, -ch / 2, cw, ch, 14, '#fffdf5');
      [g.shadowBlur, g.strokeStyle, g.lineWidth] = [0, DECK_COLOR[c.deck], 5];
      g.stroke();
      rr(g, -cw / 2 + 8, -ch / 2 + 8, cw - 16, 44, 9, DECK_COLOR[c.deck]);
      txt(g, c.deck === 'chance' ? L('❓ 机会', '❓ CHANCE') : L('🎁 命运', '🎁 COMMUNITY CHEST'), 0, -ch / 2 + 30, '900 22px', '#fff');
      const card = CARDS[c.deck][c.id];
      const { out, size } = fitLines(g, L(card.zh, card.en), cw - 50, [26, 23, 20, 18], 4, 800);
      out.forEach((line, k) => txt(g, line, 0, 14 + (k - (out.length - 1) / 2) * (size + 6), `800 ${size}px`, '#2a2a2a'));
      const name = R.players.get(c.sid)?.name;
      if (name) pill(g, 0, ch / 2 - 22, L(`${name} 抽到`, `drawn by ${name}`), { color: COLOR[c.team], size: 13, max: 300, weight: 700, bg: 'rgba(20,20,20,0.8)' });
    }
    g.restore();
  }

  /** 右边一队一张大卡片：钱包、身家、地产、现金流水、在场的棋子。 */
  drawWallet(g, R, team, own, houses) {
    const [x0, y0, w] = [PANEL_X, CARD_Y[team], PANEL_W];
    g.save();
    [g.shadowColor, g.shadowBlur, g.strokeStyle, g.lineWidth] = [COLOR[team], this.last && this.pawns.get(this.last)?.team === team ? 22 : 10, COLOR[team], 2.5];
    rr(g, x0, y0, w, CARD_H, 16, 'rgba(10,14,19,0.9)');
    g.stroke();
    g.restore();
    const worth = money(worthOf(own, houses, this.frozen ? this.frozen.cash[team] : this.cash[team], team));
    txt(g, TEAM_NAME[team], x0 + 22, y0 + 32, '900 28px', COLOR[team], 'left');
    txt(g, L(`身家 ${worth}`, `Net worth ${worth}`), x0 + w - 22, y0 + 32, '700 17px', 'rgba(255,255,255,0.7)', 'right');
    const v = this.show[team];
    txt(g, money(v), x0 + 22, y0 + 98, '900 76px', v < 0 ? '#ff5a5a' : v < (R.cfg?.cash || 1000) * 0.2 ? '#ffb35a' : '#fff', 'left');
    let [n, hs, ht] = [0, 0, 0];
    for (let i = 0; i < 40; i++) if (own[i] === team) [n, hs, ht] = [n + 1, hs + (houses[i] < 5 ? houses[i] : 0), ht + (houses[i] === 5)];
    const free = R.wallet?.[team]?.free || 0;
    const stats = [L(`🏷️ ${n} 块地`, `🏷️ ${n} deeds`), L(`🏡 ${hs} 栋房`, `🏡 ${hs} houses`), L(`🏨 ${ht} 座酒店`, `🏨 ${ht} hotels`)];
    if (free) stats.push(L(`🃏 出狱卡 ×${free}`, `🃏 Jail-free ×${free}`));
    txt(g, stats.join('   '), x0 + 24, y0 + 152, '700 16px', 'rgba(255,255,255,0.82)', 'left');
    // 现金流水：最新的在最上面，滑进来
    this.ticker[team].forEach((e, k) => {
      const [y, a] = [y0 + 188 + k * 25, clamp(e.t / 0.25, 0, 1)];
      g.globalAlpha = a * (1 - k * 0.13);
      if (e.amount) txt(g, `${e.amount > 0 ? '+' : ''}${money(e.amount)}`, x0 + 120 + (1 - a) * 30, y, '900 19px', e.amount > 0 ? '#7ee08f' : '#ff7a7a', 'right');
      g.font = `600 16px ${FONT}`;
      txt(g, fitText(g, e.text, w - 160), x0 + 136 + (1 - a) * 30, y, '600 16px', 'rgba(255,255,255,0.75)', 'left');
    });
    [g.globalAlpha, g.fillStyle] = [1, 'rgba(255,255,255,0.08)'];
    g.fillRect(x0 + 20, y0 + 316, w - 40, 1.5);
    R.field(team).slice(0, 5).forEach((p, k) => {
      const [y, wt] = [y0 + 340 + k * 24, R.waits?.get(p.sid)];
      const waiting = wt && !wt.boom;
      const sec = waiting ? Math.ceil(Math.max(0, wt.deadline - R.now) / 1000) : 0;
      const status = waiting ? L(`⏳ 等你 ${sec} 秒`, `⏳ waiting ${sec}s`) : p.jail ? L(`🔒 坐牢 ${p.jail}/3`, `🔒 In jail ${p.jail}/3`) : p.dizzy ? L('💫 晕了', '💫 Dizzy') : `📍 ${tname(this.pawns.get(p.sid)?.tile ?? p.pos)}`;
      if (this.last === p.sid) rr(g, x0 + 16, y - 11, w - 32, 22, 6, DEEP[team]);
      emoji(g, TOKENS[p.token ?? 0], x0 + 34, y, 17);
      g.font = `700 15px ${FONT}`;
      txt(g, fitText(g, p.name, 300), x0 + 54, y, '700 15px', this.last === p.sid ? '#fff' : COLOR[team], 'left');
      txt(g, status, x0 + w - 24, y, '600 15px', p.jail || waiting ? '#ffb3b3' : 'rgba(255,255,255,0.6)', 'right');
    });
    if (!R.field(team).length) txt(g, L(`等待 ${TEAM_NAME[team]} 上场…`, `Waiting for ${TEAM_NAME[team]}…`), x0 + w / 2, y0 + 370, '700 17px', 'rgba(255,255,255,0.45)');
    if (this.frozen?.broke !== team) return;
    // 破产的那队盖个红章
    g.save(); g.translate(x0 + w / 2, y0 + 120); g.rotate(-0.18);
    [g.globalAlpha, g.strokeStyle, g.lineWidth] = [Math.min(1, this.frozen.t / 0.25), '#ff3b3b', 7];
    rr(g, -190, -48, 380, 96, 8, 'rgba(40,0,0,0.75)');
    g.stroke();
    txt(g, L('破产', 'BANKRUPT'), 0, 2, '900 64px', '#ff3b3b');
    g.restore();
  }

  /** 一局结束的定格：谁破产了、谁赢了。 */
  drawFinal(g, s) {
    const k = clamp(s.t / 0.3, 0, 1);
    g.fillStyle = `rgba(5,10,7,${0.55 * k})`;
    g.fillRect(BX + CORNER, BY + CORNER, BS - CORNER * 2, BS - CORNER * 2);
    g.save(); g.translate(MID[0], MID[1] - 30); g.scale(0.6 + 0.4 * ease(k), 0.6 + 0.4 * ease(k));
    const title = s.broke ? L('破产！', 'BANKRUPT!') : L('⏱ 时间到', '⏱ TIME UP');
    [g.lineWidth, g.strokeStyle, g.font, g.textAlign, g.textBaseline] = [8, 'rgba(0,0,0,0.7)', `italic 900 92px ${FONT}`, 'center', 'middle'];
    g.strokeText(title, 0, 0);
    txt(g, title, 0, 0, 'italic 900 92px', s.broke ? '#ff4b4b' : '#ffd166');
    if (s.broke) txt(g, L(`${TEAM_NAME[s.broke]} 资不抵债`, `${TEAM_NAME[s.broke]} is out of money`), 0, 66, '800 24px', '#fff');
    txt(g, s.winner ? L(`🏆 ${TEAM_NAME[s.winner]} 赢下这局`, `🏆 ${TEAM_NAME[s.winner]} wins the game`) : L('平局', 'Draw'), 0, s.broke ? 112 : 70, '900 30px', s.winner ? COLOR[s.winner] : '#fff');
    g.restore();
  }

  hud(R) {
    if (R.phase !== 'live' || !R.wallet) return null;
    const pips = (team) => R.field(team).map((p) => !p.jail); // 坐牢的显示成空心
    return { mid: L(`第 ${R.round} 局`, `Game ${R.round}`), sub: `${money(R.wallet.claude.cash)} : ${money(R.wallet.codex.cash)}`, pips: { claude: pips('claude'), codex: pips('codex') } };
  }
}
