// 星露谷物语 · 种田大赛：两队各种一块地，比谁先赚够金币，当选「年度最佳农场」。
// 改代码播种、跑命令浇水、读代码查看作物、任务完成收获出货；报错招来乌鸦，上下文压缩就是「你在凌晨两点晕倒了」。
// 作物只靠动作长大（浇一次水长一节），不看真实时间；日历每过几个动作翻一天，夜里出货箱结算金币。
import { Rules as Base, TEAMS, OTHER, COLOR, DEEP, TEAM_NAME, ACTIONS, WORLD, clamp, hash, rng, actText } from '../core.js';
import { Particles, rand, pill, fitText, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

export const meta = {
  id: 'farm',
  icon: '🌾',
  get name() { return L('星露谷物语 · 种田大赛', 'Stardew Farm-Off'); },
  get desc() { return L('两队各种一块地：改代码播种、跑命令浇水、任务完成收获出货，先赚够金币的当选年度最佳农场', 'Two farms side by side: edits plant, commands water, finished tasks harvest & ship. First to the gold goal is Farm of the Year'); },
  get roundWord() { return L('届', 'contest'); },
  get wait() {
    return {
      start: L('🎩 {a} 在等你 · 刘易斯镇长带着委托上门了', '🎩 {a} is waiting for you · Mayor Lewis has a quest'),
      sub: L('40 秒内回它就算完成委托，超时庄稼就枯萎了', 'Reply within 40s to finish the quest — or the crops wither'),
      done: L('📜 委托完成，镇长给了赏金', '📜 Quest complete — Lewis pays up'),
      boom: L('🥀 {a} 等太久，庄稼枯萎了', '🥀 {a} waited too long — the crops withered'),
    };
  },
  get legend() {
    return [
      [L('🌱 改代码', '🌱 Edit code'), L('播种：防风草 → 花椰菜 → 甜瓜 → 上古水果，越有钱种子越好', 'Plant: Parsnip → Cauliflower → Melon → Ancient Fruit, richer farm = better seeds')],
      [L('💧 跑命令', '💧 Run a command'), L('浇水，浇一次长一节', 'Water: each watering grows a crop one stage')],
      [L('⭐ 测试 / 编译通过 / git commit', '⭐ Tests / build pass / git commit'), L('金星品质：作物卖价 ×1.5', 'Gold star quality: crops sell for ×1.5')],
      [L('🔍 读文件、搜代码', '🔍 Read / search code'), L('查看作物：熟了就收，没熟就施肥', 'Check crops: harvest ripe ones, fertilize the rest')],
      [L('📦 任务完成', '📦 Task done'), L('收获全部熟了的作物，当场出货', 'Harvest everything ripe and ship it right now')],
      [L('🌙 每过几个动作', '🌙 Every few actions'), L('过一夜：出货箱结算，金币到账', 'A night passes: the shipping bin pays out')],
      [L('🛒 上网查资料', '🛒 Web search'), L('去皮埃尔商店买高一档的种子（失败 = 周三休息）', 'Pierre’s: premium seeds one tier up (fail = closed Wednesdays)')],
      [L('✨ 派出子代理', '✨ Spawn a subagent'), L('祝尼魔来帮忙收菜、补种', 'Junimos come to harvest and replant')],
      [L('🐦 报错', '🐦 Error'), L('乌鸦来吃庄稼（有时被稻草人吓跑）', 'A crow eats a crop (sometimes the scarecrow wins)')],
      [L('😵 上下文压缩', '😵 Context compaction'), L('你在凌晨两点晕倒了：扣 10% 金币当医药费', 'You passed out at 2 AM: 10% of your gold goes to medical bills')],
      [L('✋ 你打断了它', '✋ You interrupt it'), L('一镰刀把自己的庄稼割了', 'You scythe your own crops')],
      [L('🎩 它在等你', '🎩 Waiting for you'), L('刘易斯镇长带着委托上门，40 秒不回庄稼枯萎', 'Mayor Lewis brings a quest; no reply in 40s and crops wither')],
      [L('💌 收到新指令', '💌 New prompt'), L('收到一封信：妈妈寄来一点钱', 'A letter: Mom sent a little money')],
      [L('🏛 开 PR', '🏛 Open a PR'), L('社区中心修好了：大笔奖金，祝尼魔跳舞', 'Community Center restored: big bonus, Junimo dance')],
      [L('🍄 token', '🍄 Tokens'), L('路边捡点野菜卖钱', 'Forage a little pocket money')],
    ];
  },
};

// ================================================================ 作物与农场

// grow = 浇几次水才熟；price 是星露谷原版卖价；regrow = 收完再浇几次又能收（上古水果不用重种）
const CROPS = [
  { grow: 3, price: 35, leaf: '#74c04c' }, // 防风草
  { grow: 5, price: 175, leaf: '#5aa843' }, // 花椰菜
  { grow: 6, price: 250, leaf: '#4f9a3a' }, // 甜瓜
  { grow: 9, price: 550, regrow: 4, leaf: '#3d7f3a' }, // 上古水果
];
const ANCIENT = 3;
const cropName = (c) => [L('防风草', 'Parsnip'), L('花椰菜', 'Cauliflower'), L('甜瓜', 'Melon'), L('上古水果', 'Ancient Fruit')][c];
const seasonName = (s) => [L('春季', 'Spring'), L('夏季', 'Summer'), L('秋季', 'Fall'), L('冬季', 'Winter')][s];
const seasonHello = (s) => [L('春天来了', 'Spring is here'), L('夏天到了', 'Summer is here'), L('秋天到了', 'Fall is here'), L('冬天到了', 'Winter is here')][s];

const PLOTS = 12; // 4 列 × 3 行
const START_GOLD = 500; // 星露谷开局就是 500g
const STAR = 1.5; // 金星品质卖价 ×1.5
const TIER_AT = [0, 0.06, 0.22, 0.5]; // 本局卖出的作物值到目标的这么多，就买得起下一档种子
const SEASON_DAYS = 28;
const MAX_WORK = 40; // 一次动作最多攒这么多活（人少的那队一个动作顶好几个）
const TOK_PER_G = 400; // 烧这么多 token 捡 1g 野菜钱
// 每种动作先干什么活，干不了就往后顺延，农夫从来不闲着
const ORDER = { plant: ['plant', 'water', 'harvest'], water: ['water', 'harvest', 'plant'], harvest: ['harvest', 'water', 'plant'] };

const ripe = (pl) => pl.c >= 0 && pl.g >= CROPS[pl.c].grow;
const growth = (pl) => (pl.c >= 0 ? pl.g / CROPS[pl.c].grow : -1);
const clearPlot = (pl) => Object.assign(pl, { c: -1, g: 0, star: false });
const idx = (farm, f) => farm.plots.map((pl, i) => (f(pl) ? i : -1)).filter((i) => i >= 0);
const byGrowth = (farm) => (a, b) => growth(farm.plots[b]) - growth(farm.plots[a]) || a - b;
const calOf = (day) => ({ year: Math.floor(day / (SEASON_DAYS * 4)) + 1, season: Math.floor(day / SEASON_DAYS) % 4, dom: (day % SEASON_DAYS) + 1 });

function newFarm(team) {
  const plots = Array.from({ length: PLOTS }, (_, i) => ({ c: i < 4 ? 0 : -1, g: 0, wet: false, star: false, weed: false })); // 开局送的防风草已经种了一排
  return { team, gold: START_GOLD, bin: 0, binN: 0, made: 0, tier: 0, work: 0, crow: 0, plots, harvests: 0 };
}

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { goal: 2500, partyGoal: 900, roundLen: 40 * 60e3, partyRoundLen: 10 * 60e3, dayActs: 6, partyDayActs: 3 };

  init() {
    const o = this.opts;
    this.goal = o.party ? o.partyGoal : o.goal;
    this.roundLen = o.party ? o.partyRoundLen : o.roundLen;
    this.dayActs = o.party ? o.partyDayActs : o.dayActs;
    this.cal = { day: 0, acts: 0 }; // 日历跨回合接着走：一局是一届比赛，年月照常过
    this.farms = { claude: newFarm('claude'), codex: newFarm('codex') };
  }

  initPlayer(p) {
    p.forage = 0;
  }

  onRoundStart(fx) {
    this.farms = { claude: newFarm('claude'), codex: newFarm('codex') };
    fx.push({ type: 'farmReset' });
  }

  get live() {
    return this.phase === 'live';
  }

  /**
   * 干活倍率。种田是各种各的（比赛跑），不是互相打：底座的均衡火力里有一项「对面人多血厚」，
   * 这里把它除掉，只均衡出手频率，两边每分钟干的活一样多，比的是活干得好不好。
   */
  mult(team) {
    const size = this.sizeMult();
    const [mine, theirs] = [this.field(team).length, this.field(OTHER[team]).length];
    if (!this.balance || !mine || !theirs) return size;
    return clamp(this.balanceMult(team) * Math.sqrt(mine / theirs), 0.05, 20) * size;
  }

  onEvent(p, ev, r, fx) {
    const farm = this.farms[p.team];
    const m = this.mult(p.team);
    const { plant, water, harvest } = ORDER;
    if (ev.ok === false && ACTIONS.has(ev.k) && ev.k !== 'agent') {
      // 报错：上网失败 = 皮埃尔的店周三休息；其它 = 乌鸦来吃庄稼
      if (ev.k === 'web') fx.push({ type: 'farmClosed', team: p.team, sid: p.sid });
      else this.crow(p, farm, m, r, fx);
    } else if (ev.k === 'edit') this.work(p, farm, 2.2 * m, plant, fx);
    else if (ev.k === 'shell') {
      if (ev.hs) this.goldStar(p, farm, fx);
      this.work(p, farm, 2 * m, water, fx);
    } else if (ev.k === 'read') this.work(p, farm, 1.4 * m, harvest, fx);
    else if (ev.k === 'misc') this.work(p, farm, m, water, fx);
    else if (ev.k === 'think') this.work(p, farm, 0.25 * m, water, fx);
    else if (ev.k === 'web') {
      fx.push({ type: 'farmShop', team: p.team, sid: p.sid, tier: Math.min(3, farm.tier + 1) });
      this.work(p, farm, 1.6 * m, plant, fx, { premium: true });
    } else if (ev.k === 'agent') {
      if (this.live) p.a++;
      this.work(p, farm, 4 * m, harvest, fx, { who: 'junimo' });
    } else if (ev.k === 'done') {
      this.harvestAll(p, farm, fx);
      this.work(p, farm, m, plant, fx);
    } else if (ev.k === 'compact') this.passOut(p, farm, fx);
    else if (ev.k === 'abort') this.scythe(p, farm, fx);
    else if (ev.k === 'apierr') this.bolt(p, farm, r, fx);
    else if (ev.k === 'prompt') this.letter(p, farm, m, fx);
    else if (ev.k === 'pr') this.restore(p, farm, fx);
    // 日历：两边加起来每做 dayActs 个动作过一天，夜里出货箱结算
    if (this.live && ACTIONS.has(ev.k) && ++this.cal.acts >= this.dayActs) this.night(fx);
  }

  /** 干 amount 份活（已乘好倍率），按 order 找活干，零头攒着下次用。 */
  work(p, farm, amount, order, fx, info = {}) {
    farm.work = Math.min(MAX_WORK, farm.work + amount);
    const out = { plant: [], water: [], harvest: [], weeds: [] };
    const seen = new Set(); // 喷壶一下浇好几格：一次动作里同一块地只浇一次，实在没别的活才浇第二遍
    while (farm.work >= 1) {
      let ok = this.job(p, farm, order, seen, out, info);
      if (!ok && seen.size) {
        seen.clear();
        ok = this.job(p, farm, order, seen, out, info);
      }
      if (!ok) break;
      farm.work -= 1;
    }
    if (out.plant.length + out.water.length + out.harvest.length + out.weeds.length) fx.push({ type: 'farmWork', team: farm.team, sid: p.sid, who: info.who || null, ...out });
    if (out.harvest.length) this.tierUp(farm, fx);
  }

  job(p, farm, order, seen, out, info) {
    for (const kind of order) {
      if (kind === 'plant') {
        const i = farm.plots.findIndex((pl) => pl.c < 0);
        if (i < 0) continue;
        const pl = farm.plots[i];
        if (pl.weed) {
          pl.weed = false; // 先锄草，下一份活才种
          out.weeds.push(i);
        } else {
          Object.assign(pl, { c: info.premium ? Math.min(3, farm.tier + 1) : farm.tier, g: 0, star: false });
          out.plant.push(i);
        }
        return true;
      }
      if (kind === 'water') {
        // 先浇最快熟的那棵：庄稼一棵接一棵熟，金币源源不断
        let i = -1;
        farm.plots.forEach((pl, j) => {
          if (pl.c >= 0 && !ripe(pl) && !seen.has(j) && (i < 0 || growth(pl) > growth(farm.plots[i]))) i = j;
        });
        if (i < 0) continue;
        Object.assign(farm.plots[i], { g: farm.plots[i].g + 1, wet: true });
        seen.add(i);
        out.water.push(i);
        return true;
      }
      const i = farm.plots.findIndex(ripe);
      if (i < 0) continue;
      out.harvest.push(this.harvest(p, farm, i));
      return true;
    }
    return false;
  }

  /** 收一棵：卖价进出货箱，夜里（或任务完成时）才变成金币。 */
  harvest(p, farm, i) {
    const pl = farm.plots[i];
    const crop = CROPS[pl.c];
    const gold = Math.round(crop.price * (pl.star ? STAR : 1));
    const item = { i, c: pl.c, star: pl.star, gold };
    farm.bin += gold;
    farm.binN++;
    farm.made += gold;
    farm.harvests++;
    if (this.live) {
      p.k++;
      p.dmg += gold;
    }
    if (crop.regrow) Object.assign(pl, { g: crop.grow - crop.regrow, star: false });
    else clearPlot(pl);
    return item;
  }

  tierUp(farm, fx) {
    while (farm.tier < 3 && farm.made >= TIER_AT[farm.tier + 1] * this.goal) fx.push({ type: 'farmTier', team: farm.team, tier: ++farm.tier });
  }

  /** 任务完成：熟了的全收，连同出货箱里的当场出货。 */
  harvestAll(p, farm, fx) {
    const items = idx(farm, ripe).map((i) => this.harvest(p, farm, i));
    if (items.length) fx.push({ type: 'farmWork', team: farm.team, sid: p.sid, who: null, plant: [], water: [], harvest: items, weeds: [] });
    const gold = this.ship(farm, fx, false, p.sid);
    this.tierUp(farm, fx);
    // 一次收三棵以上，或者一车货值四分之一个目标，就算丰收
    if (this.live && (items.length >= 3 || gold >= this.goal / 4)) fx.push({ type: 'announce', text: L('丰收！', 'Bumper harvest!'), sub: L(`${p.name} 任务完成 · 收了 ${items.length} 棵，当场出货 +${gold}g`, `${p.name}: task done · ${items.length} harvested, shipped +${gold}g`), cls: p.team, ms: 1500 });
  }

  /** 出货箱结算。热身时不算钱（出货箱先攒着，开打时整块地重来）。 */
  ship(farm, fx, night, sid = null) {
    if (farm.bin <= 0 || !this.live) return 0;
    const gold = farm.bin;
    farm.gold += gold;
    fx.push({ type: 'farmShip', team: farm.team, sid, gold, n: farm.binN, night });
    farm.bin = 0;
    farm.binN = 0;
    return gold;
  }

  /** 测试通过 = 金星作物：长得最好的几棵都变成金星品质，卖价 ×1.5。 */
  goldStar(p, farm, fx) {
    const plots = idx(farm, (pl) => pl.c >= 0 && !pl.star).sort(byGrowth(farm)).slice(0, 4);
    for (const i of plots) farm.plots[i].star = true;
    if (!this.live) return;
    p.hs++;
    fx.push({ type: 'farmStar', team: farm.team, sid: p.sid, plots });
    if (plots.length) fx.push({ type: 'announce', text: L('⭐ 金星品质！', '⭐ Gold star quality!'), sub: L(`${p.name} 测试通过 · ${plots.length} 棵作物卖价 ×1.5`, `${p.name}: tests pass · ${plots.length} crops sell ×1.5`), cls: p.team, ms: 1200 });
  }

  crow(p, farm, m, r, fx) {
    // 乌鸦的胃口跟着倍率走：忙的那队报错多，但每次报错吃得少；吃不饱的那几次算稻草人吓跑了它
    farm.crow += clamp(m, 0.4, 2.5);
    if (farm.crow < 1) fx.push({ type: 'farmCrow', team: farm.team, sid: p.sid, plot: -1, c: -1 });
    while (farm.crow >= 1) {
      farm.crow -= 1;
      const planted = idx(farm, (pl) => pl.c >= 0);
      if (planted.length) {
        const i = planted[Math.floor(r() * planted.length)];
        fx.push({ type: 'farmCrow', team: farm.team, sid: p.sid, plot: i, c: farm.plots[i].c });
        clearPlot(farm.plots[i]);
        if (this.live) p.d++;
        continue;
      }
      // 地里没庄稼可吃：长杂草，下次播种得先锄掉
      const empty = idx(farm, (pl) => !pl.weed);
      if (!empty.length) continue;
      const i = empty[Math.floor(r() * empty.length)];
      farm.plots[i].weed = true;
      fx.push({ type: 'farmWeed', team: farm.team, sid: p.sid, plot: i });
    }
  }

  passOut(p, farm, fx) {
    if (!this.live) return;
    // 星露谷原版：晕倒扣 10% 的钱，最多 1000g
    const loss = Math.min(1000, Math.floor(farm.gold * 0.1));
    farm.gold -= loss;
    fx.push({ type: 'farmPassOut', team: farm.team, sid: p.sid, loss });
    fx.push({ type: 'announce', text: L('你在凌晨两点晕倒了……', 'You passed out at 2 AM…'), sub: L(`${p.name} 上下文压缩 · 医药费 ${loss}g`, `${p.name} compacted · ${loss}g in medical bills`), cls: 'bad', ms: 2000 });
  }

  scythe(p, farm, fx) {
    const plots = idx(farm, (pl) => pl.c >= 0).sort(byGrowth(farm)).slice(0, 2);
    for (const i of plots) clearPlot(farm.plots[i]);
    if (this.live && plots.length) p.d++;
    fx.push({ type: 'farmScythe', team: farm.team, sid: p.sid, plots });
    fx.push({ type: 'note', text: L('✋ 你打断了 {0}，一镰刀把庄稼割了', '✋ You interrupted {0} and scythed the crops'), sids: [p.sid] });
  }

  /** API 报错 = 暴风雨，闪电劈中一棵庄稼。 */
  bolt(p, farm, r, fx) {
    const planted = idx(farm, (pl) => pl.c >= 0);
    const i = planted.length ? planted[Math.floor(r() * planted.length)] : Math.floor(r() * PLOTS);
    if (planted.length) clearPlot(farm.plots[i]);
    fx.push({ type: 'farmBolt', team: farm.team, sid: p.sid, plot: i });
  }

  letter(p, farm, m, fx) {
    if (!this.live) return;
    const gold = Math.round(this.goal * 0.008 * clamp(m, 0.3, 3));
    farm.gold += gold;
    fx.push({ type: 'farmLetter', team: farm.team, sid: p.sid, gold });
  }

  /** 开 PR = 社区中心修好了：大笔奖金，祝尼魔一高兴，地里的庄稼都多长两节。 */
  restore(p, farm, fx) {
    for (const pl of farm.plots) if (pl.c >= 0) pl.g = Math.min(CROPS[pl.c].grow, pl.g + 2);
    const gold = this.live ? Math.round(this.goal * 0.12) : 0;
    farm.gold += gold;
    fx.push({ type: 'farmCC', team: farm.team, sid: p.sid, gold });
    if (this.live) fx.push({ type: 'announce', text: L('社区中心修好了！', 'Community Center restored!'), sub: L(`${p.name} 提交 PR · 祝尼魔跳起了舞 +${gold}g`, `${p.name} opened a PR · the Junimos dance +${gold}g`), cls: 'gold', ms: 2200 });
  }

  // 过一夜：出货箱结算，地干了；每 28 天换季
  night(fx) {
    this.cal.acts = 0;
    this.cal.day++;
    for (const t of TEAMS) {
      for (const pl of this.farms[t].plots) pl.wet = false;
      this.ship(this.farms[t], fx, true);
    }
    fx.push({ type: 'farmNight', day: this.cal.day });
    if (this.cal.day % SEASON_DAYS) return;
    const { season, year } = calOf(this.cal.day);
    let lost = 0;
    for (const t of TEAMS) {
      // 换季：没熟的庄稼全枯了（上古水果扛得住，冬天除外）
      const plots = idx(this.farms[t], (pl) => pl.c >= 0 && !ripe(pl) && (pl.c !== ANCIENT || season === 3));
      for (const i of plots) clearPlot(this.farms[t].plots[i]);
      lost += plots.length;
      if (plots.length) fx.push({ type: 'farmWither', team: t, sid: null, plots, why: 'season' });
    }
    const text = season === 0 ? L(`第 ${year} 年 · 春天来了`, `Year ${year} · Spring is here`) : seasonHello(season);
    fx.push({ type: 'announce', text, sub: lost ? L('换季了，没来得及收的庄稼全枯了……', 'New season: unharvested crops withered…') : L('新的季节，新的种子', 'New season, new seeds'), cls: 'gold', ms: 1800 });
  }

  // 它在等你：刘易斯镇长带着委托来了。及时回 = 赏金；超时 = 一半庄稼枯萎
  onWait(p, fx) {
    fx.push({ type: 'farmLewis', team: p.team, sid: p.sid });
  }

  onAnswer(p, wait, fx) {
    if (!this.live) return;
    const gold = Math.round(this.goal * 0.03 * clamp(this.mult(p.team), 0.5, 3));
    this.farms[p.team].gold += gold;
    fx.push({ type: 'farmQuest', team: p.team, sid: p.sid, gold });
  }

  onWaitTimeout(p, fx) {
    const farm = this.farms[p.team];
    const r = rng(hash(`${p.sid}:${this.now}`));
    const planted = idx(farm, (pl) => pl.c >= 0);
    for (let i = planted.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [planted[i], planted[j]] = [planted[j], planted[i]];
    }
    const plots = planted.slice(0, Math.ceil(planted.length / 2));
    for (const i of plots) clearPlot(farm.plots[i]);
    if (this.live) p.d += plots.length;
    fx.push({ type: 'farmWither', team: p.team, sid: p.sid, plots, why: 'wait' });
  }

  onTokens(p, n) {
    if (!p.onField || !this.live) return;
    p.forage += (n * this.mult(p.team)) / TOK_PER_G;
    const g = Math.floor(p.forage);
    p.forage -= g;
    this.farms[p.team].gold += g;
  }

  timers() {
    return [this.roundStart + this.roundLen];
  }

  // 拖太久就天黑收工：金币（连出货箱里的）多的赢；一样多就再种一会儿
  onTick(fx) {
    if (this.now < this.roundStart + this.roundLen) return;
    const w = this.leader();
    if (!w) this.roundStart = this.now;
    else this.endRound(w, 'time', fx, L(`天黑收工 · ${TEAM_NAME[w]} 的农场更有钱`, `Time's up · ${TEAM_NAME[w]}'s farm is richer`));
  }

  leader() {
    const [a, b] = TEAMS.map((t) => this.farms[t].gold + this.farms[t].bin);
    return a === b ? null : a > b ? 'claude' : 'codex';
  }

  check(fx) {
    const [a, b] = TEAMS.map((t) => this.farms[t].gold);
    if (a < this.goal && b < this.goal) return;
    const w = a === b ? null : a > b ? 'claude' : 'codex';
    this.endRound(w, 'goal', fx, w ? L(`💰 ${TEAM_NAME[w]} 当选年度最佳农场！`, `💰 ${TEAM_NAME[w]}: Farm of the Year!`) : L('💰 两家农场一样有钱', '💰 Both farms equally rich'));
  }
}

// ================================================================ 画面
// 俯视角的两块农场，左右各一队，中间一条石子路。地块直接读规则层的状态，效果只负责动画。

const { w: W, h: H } = WORLD;
const CX = { claude: 390, codex: 1210 };
const TILE = 108;
const GAP = 14;
const GRID_W = 4 * TILE + 3 * GAP;
const GRID_Y = 330;
const HOUSE = { claude: [66, 50], codex: [W - 66 - 224, 50] };
const BIN = { claude: [314, 196], codex: [W - 314 - 76, 196] };
const SIGN = { claude: [434, 92], codex: [W - 434 - 256, 92] };
const GATE_Y = 905;
const GRASS = [['#7cbc4f', '#6aa843', '#93cf62'], ['#5ea63b', '#4d9231', '#77bd4d'], ['#b59a48', '#a1843b', '#caa957'], ['#e8eef4', '#d3dde8', '#ffffff']];
const DOTS = [['#ff9ec7', '#fff27a', '#ffffff'], ['#ffd34d', '#ff7a7a', '#ffffff'], ['#e0782f', '#c4502a', '#f0a640'], ['#ffffff', '#cfe3f5']];
const AMBIENT = [['#ffb3d1', '#ffffff'], null, ['#e0782f', '#c4502a', '#f0a640'], ['#ffffff', '#e6f0fa']]; // 春天飘花瓣，秋天落叶，冬天下雪
const SHIRTS = ['#5b8fd6', '#d65b5b', '#6cbf5f', '#b98bd8', '#e0b24a', '#4fb3a9', '#e07fa8'];
const JUNI = ['#7fd16b', '#6fb7ff', '#c38bff', '#ff8f8f', '#ffd36b', '#ffa65c'];
const SEASON_ICON = ['🌸', '☀️', '🍂', '❄️'];
const SKIN = '#f2c9a0';
const outward = (team) => (team === 'claude' ? -1 : 1); // 远离中路的方向
const money = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function plotXY(team, i) {
  const col = team === 'claude' ? i % 4 : 3 - (i % 4); // 两块地镜像：第一列都挨着自家房子
  return [CX[team] - GRID_W / 2 + col * (TILE + GAP), GRID_Y + Math.floor(i / 4) * (TILE + GAP)];
}
const plotMid = (team, i) => plotXY(team, i).map((v) => v + TILE / 2);
const binMid = (team) => [BIN[team][0] + 38, BIN[team][1] + 18];
const signMid = (team) => [SIGN[team][0] + 128, SIGN[team][1] + 56];
const scarecrowXY = (team) => [CX[team] + outward(team) * (GRID_W / 2 + 46), GRID_Y + 160];

function timeText(k) {
  const mins = 360 + Math.floor((clamp(k, 0, 1) * 1200) / 10) * 10; // 早上 6 点到凌晨 2 点
  const [h, mm] = [Math.floor(mins / 60) % 24, String(mins % 60).padStart(2, '0')];
  return L(`${h}:${mm}`, `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'am' : 'pm'}`);
}

// ---------------------------------------------------------------- 画画小工具

function rect(g, color, x, y, w, h) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function rr(g, color, x, y, w, h, r) {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function ell(g, x, y, rx, ry, rot, color) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  g.fill();
}

/** 多边形：stroke 给线宽就只描边（折线），否则填色。 */
function poly(g, color, pts, stroke = 0) {
  g.beginPath();
  for (const [x, y] of pts) g.lineTo(x, y);
  if (stroke) {
    g.strokeStyle = color;
    g.lineWidth = stroke;
    g.stroke();
    return;
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function star(g, x, y, r, color) {
  const pt = (k) => [x + Math.cos(-Math.PI / 2 + (k * Math.PI) / 5) * (k % 2 ? r * 0.45 : r), y + Math.sin(-Math.PI / 2 + (k * Math.PI) / 5) * (k % 2 ? r * 0.45 : r)];
  poly(g, color, Array.from({ length: 10 }, (_, k) => pt(k)));
  g.strokeStyle = 'rgba(120,70,0,0.7)';
  g.lineWidth = 1.5;
  g.stroke();
}

function txt(g, s, x, y, font, color, align = 'center') {
  g.font = `${font} ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

/** 一棵作物，(x, y) 是根部。stage：0 刚冒芽 / 1 长叶子 / 2 快熟了 / 3 熟了。 */
function drawCrop(g, x, y, c, stage, s = 1, sway = 0) {
  const leaf = CROPS[c].leaf;
  const leaves = (list, rx, ry) => list.forEach(([lx, ly, rot]) => ell(g, lx, ly, rx, ry, rot, leaf));
  const balls = (list, color) => list.forEach(([bx, by, r]) => ell(g, bx, by, r, r, 0, color));
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.rotate(sway);
  if (stage === 0) {
    ell(g, 0, 1, 6, 2.5, 0, 'rgba(60,35,15,0.45)');
    poly(g, leaf, [[0, 0], [0, -7]], 2);
    leaves([[-4, -8, -0.5], [4, -8, 0.5]], 5, 2.5);
  } else if (stage === 1) {
    poly(g, leaf, [[0, 0], [0, -16]], 2);
    leaves([[-7, -6, -0.6], [7, -9, 0.6], [-6, -14, -0.8], [6, -17, 0.8]], 7, 3.2);
  } else if (stage === 2 && c === 0) leaves([[-6, -14, -0.4], [0, -14, 0], [6, -14, 0.4]], 3.5, 11);
  else if (stage === 2 && c === 3) {
    balls([[-8, -10, 8], [8, -10, 8], [0, -18, 9]], leaf);
    balls([[-5, -12, 2.5], [5, -16, 2.5], [3, -8, 2.5]], '#9fd86a');
  } else if (stage === 2) {
    leaves([[-9, -6, -0.5], [9, -6, 0.5], [-6, -15, -0.9], [6, -15, 0.9]], 9, 4);
    if (c === 1) ell(g, 0, -10, 5, 4.5, 0, '#f3eed6'); // 花椰菜的小花球
    else balls(Array.from({ length: 5 }, (_, k) => [Math.cos(k * 1.26) * 3.5, -12 + Math.sin(k * 1.26) * 3.5, 2.5]), '#ffd84a'); // 甜瓜开小黄花
  } else if (c === 0) {
    // 防风草：三片长叶 + 露出土的白萝卜头
    leaves([[-6, -18, -0.4], [0, -18, 0], [6, -18, 0.4]], 4, 12);
    ell(g, 0, -3, 10, 8, 0, '#f2e2b0');
    ell(g, -3, -6, 3, 2, 0, 'rgba(255,255,255,0.6)');
    rect(g, '#c9a565', -6, -10, 12, 2);
  } else if (c === 1) {
    // 花椰菜：一圈大叶子托着白花球
    leaves([[-14, -6, -0.5], [14, -6, 0.5], [0, -2, 0]], 13, 6);
    balls([[-7, -12, 8], [7, -12, 8], [0, -18, 8.5], [0, -9, 8.5]], '#f6f1dc');
    balls([[-6, -14, 2.2], [5, -10, 2.2], [1, -19, 2.2], [7, -16, 2.2], [-3, -8, 2.2]], '#ddd3b0');
  } else if (c === 2) {
    // 甜瓜：绿底深纹的大瓜
    ell(g, -13, -16, 10, 5, -0.6, leaf);
    ell(g, 0, -14, 17, 15, 0, '#8bd052');
    for (const dx of [-8, 0, 8]) poly(g, '#4c8d2b', [[dx * 0.4, -28], [dx, -14], [dx * 0.4, 0]], 2.2);
    ell(g, -6, -21, 4.5, 3, -0.4, 'rgba(255,255,255,0.45)');
  } else {
    // 上古水果：深绿灌木挂满蓝色果子
    balls([[-10, -12, 11], [10, -12, 11], [0, -23, 12], [0, -8, 11]], leaf);
    const fruit = [[-9, -16], [-4, -9], [6, -23], [10, -11], [1, -16], [-11, -6], [5, -4]];
    balls(fruit.map(([fx, fy]) => [fx, fy, 4]), '#3f97de');
    balls(fruit.map(([fx, fy]) => [fx - 1.2, fy - 1.4, 1.5]), '#bff0ff');
  }
  g.restore();
}

// 每个季节一张草地底图：草、小花 / 落叶 / 积雪、中间的石子路、两圈篱笆
const backs = [];
function backdrop(season) {
  if (backs[season]) return backs[season];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = rng(31 + season);
  const [base, dark, light] = GRASS[season];
  rect(g, base, 0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const [x, y, col] = [r() * W, r() * H, r() < 0.55 ? dark : light];
    rect(g, col, x, y, 3, 2);
    rect(g, col, x + 1, y - 3, 1, 3);
  }
  for (let i = 0; i < 170; i++) {
    const s = 1.5 + r() * 2;
    ell(g, r() * W, r() * H, s, s, 0, DOTS[season][Math.floor(r() * DOTS[season].length)]);
  }
  rect(g, season === 3 ? '#c8d1db' : '#b8a27c', 752, 0, 96, H);
  for (let y = 4; y < H; y += 21) {
    for (let x = 758 + ((y / 21) % 2) * 12; x < 842; x += 25) ell(g, x, y, 10, 7, r() * 0.6, season === 3 ? '#e3e9ef' : r() < 0.5 ? '#cdbb96' : '#a8916c');
  }
  const post = (px, py) => {
    rect(g, 'rgba(0,0,0,0.18)', px - 3, py + 2, 10, 5);
    rect(g, '#8b5e34', px - 4, py - 15, 8, 19);
    rect(g, season === 3 ? '#ffffff' : '#b07a44', px - 4, py - 15, 8, 3);
  };
  for (const team of TEAMS) {
    const x0 = CX[team] - 360;
    for (const [x, y, w, h] of [[x0, 30, 720, 4], [x0, 34, 4, GATE_Y - 34], [x0 + 716, 34, 4, GATE_Y - 34], [x0, GATE_Y - 4, 310, 4], [x0 + 410, GATE_Y - 4, 310, 4]]) rect(g, '#9c6a3a', x, y, w, h);
    for (let x = x0; x <= x0 + 720; x += 40) {
      post(x, 34);
      if (x < x0 + 310 || x > x0 + 410) post(x, GATE_Y); // 下边留个门
    }
    for (let y = 74; y < GATE_Y; y += 40) {
      post(x0, y);
      post(x0 + 720, y);
    }
  }
  return (backs[season] = c);
}

/** 一个农夫（每个会话一个）：戴队伍颜色的草帽，在地里走来走去。 */
class Farmer {
  constructor(sid, team) {
    Object.assign(this, { sid, team, pose: null, label: null, sleep: 0, idle: rand(1, 3), moving: false, shopT: 0 });
    this.x = this.tx = CX[team] + rand(-220, 220);
    this.y = this.ty = rand(730, 870);
    this.face = team === 'claude' ? 1 : -1;
    this.shirt = SHIRTS[hash(sid) % SHIRTS.length];
  }

  goTo(x, y) {
    this.tx = clamp(x, CX[this.team] - 330, CX[this.team] + 330);
    this.ty = clamp(y, GRID_Y - 10, GATE_Y - 20);
    this.idle = rand(2.5, 5);
  }

  act(kind, item = null, max = 0.8) {
    this.pose = { kind, t: 0, max, item };
  }

  update(dt, active) {
    if (this.label && (this.label.life -= dt) <= 0) this.label = null;
    if (this.pose && (this.pose.t += dt) >= this.pose.max) this.pose = null;
    this.sleep = Math.max(0, this.sleep - dt);
    this.shopT = Math.max(0, this.shopT - dt);
    if (this.sleep > 0) return;
    const [dx, dy] = [this.tx - this.x, this.ty - this.y];
    const d = Math.hypot(dx, dy);
    this.moving = d > 2;
    if (this.moving) {
      const s = Math.min(d, 190 * dt);
      this.x += (dx / d) * s;
      this.y += (dy / d) * s;
      if (Math.abs(dx) > 3) this.face = dx > 0 ? 1 : -1;
    } else if (active && (this.idle -= dt) <= 0) this.goTo(CX[this.team] + rand(-280, 280), rand(735, 875));
  }
}

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.farmers = new Map();
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    this.farmers.clear();
    [this.crows, this.junimos, this.coins, this.items, this.bolts, this.bigs, this.letters] = [[], [], [], [], [], [], []];
    this.pops = new Map();
    this.dialog = { claude: null, codex: null };
    this.binOpen = { claude: 0, codex: 0 };
    this.dance = { claude: 0, codex: 0 };
    this.shown = { claude: R?.farms?.claude.gold ?? START_GOLD, codex: R?.farms?.codex.gold ?? START_GOLD };
    this.nightFlash = 0;
    this.tod = 0;
    this.flakes = Array.from({ length: 50 }, () => ({ x: rand(0, W), y: rand(0, H), v: rand(25, 60), ph: rand(0, 6) }));
    if (R) for (const p of R.field()) this.farmer(R, p.sid);
  }

  farmer(R, sid) {
    let f = this.farmers.get(sid);
    const p = R.players.get(sid);
    if (!f && p && p.onField) this.farmers.set(sid, (f = new Farmer(sid, p.team)));
    return f;
  }

  big(team, text, color, size = 34, dy = 0, life = 1.4) {
    if (this.bigs.length > 8) this.bigs.shift();
    this.bigs.push({ x: CX[team], y: GRID_Y + 150 + dy, text, color, size, t: 0, life });
  }

  say(team, text, life = 2.6) {
    this.dialog[team] = { text, life, max: life };
  }

  junimo(team, i, delay = 0) {
    const [x, y] = plotMid(team, i);
    const [sx, sy] = [CX[team] + outward(team) * 340, rand(720, 880)];
    this.junimos.push({ sx, sy, tx: x + rand(-14, 14), ty: y + 22, t: -delay, life: 2.2, color: JUNI[Math.floor(rand(0, JUNI.length))] });
  }

  coinsTo(team, x, y, n) {
    const [tx, ty] = signMid(team);
    for (let k = 0; k < n; k++) this.coins.push({ x1: x + rand(-10, 10), y1: y, x2: tx + rand(-40, 40), y2: ty, t: -k * 0.06, dur: 0.7 });
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    const tones = (notes, type, gap, vol, dur, delay = 0) => notes.forEach((hz, k) => app.sfx.tone(hz, dur, vol, type, null, delay + k * gap));
    for (const f of list) {
      const fm = f.sid ? this.farmer(R, f.sid) : null;
      const at = f.plot >= 0 ? plotMid(f.team, f.plot) : null;
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (fm && text && !(busy && f.ev.k === 'read')) fm.label = { text, ok: f.ev.ok !== false, life: 1.7 };
          break;
        }
        case 'bench':
          this.farmers.delete(f.sid);
          break;
        case 'farmReset':
          [this.crows, this.junimos, this.items, this.coins] = [[], [], [], []];
          this.pops.clear();
          for (const t of TEAMS) this.shown[t] = R.farms[t].gold;
          break;
        case 'farmWork': {
          const all = [...f.plant, ...f.water, ...f.harvest.map((h) => h.i), ...f.weeds];
          const h = f.harvest[f.harvest.length - 1];
          if (f.who === 'junimo') {
            all.slice(0, busy ? 2 : 6).forEach((i, k) => this.junimo(f.team, i, k * 0.12));
            if (fm && !busy) fx.text(fm.x, fm.y - 80, L('✨ 祝尼魔来帮忙', '✨ Junimos to the rescue'), '#b8ff9a', 15, 1.4);
          } else if (fm && all.length) {
            const [px, py] = plotXY(f.team, all[all.length - 1]);
            fm.goTo(px + TILE / 2 + rand(-16, 16), py + TILE - 6);
            fm.act(h ? 'harvest' : f.plant.length ? 'plant' : 'water', h ? h.c : null, h ? 1.1 : 0.8);
          }
          for (const i of f.plant) this.pops.set(`${f.team}:${i}`, 0.35);
          if (busy) break;
          for (const i of f.plant.concat(f.weeds)) fx.sparks(...plotMid(f.team, i), '#7a4a22', 5, 70);
          for (const i of f.water.slice(0, 6)) fx.sparks(...plotMid(f.team, i), '#8fd3ff', 4, 60);
          const [bx, by] = binMid(f.team);
          for (const it of f.harvest.slice(0, 8)) {
            const [x, y] = plotMid(f.team, it.i);
            this.items.push({ c: it.c, star: it.star, x1: x, y1: y, x2: bx, y2: by, t: 0, dur: 0.8 });
            fx.text(x, y - 30, `+${it.gold}g`, it.star ? '#ffd84d' : '#fff3c4', it.star ? 18 : 15, 1.1);
            if (it.star) fx.sparks(x, y, '#ffd84d', 8, 120);
          }
          if (!app.sfx.ok()) break;
          if (h) tones([660, 880], 'triangle', 0.07, 0.07, 0.09);
          else if (f.plant.length) app.sfx.tone(320, 0.07, 0.07, 'triangle', 520);
          else app.sfx.burst(0.16, 2600, 0.05, 'highpass');
          break;
        }
        case 'farmStar':
          if (busy) break;
          for (const i of f.plots) {
            const [x, y] = plotMid(f.team, i);
            fx.sparks(x, y, '#ffd84d', 10, 140);
            fx.ring(x, y, 6, 50, 'rgba(255,216,77,0.9)', 0.5, 3);
          }
          this.big(f.team, L('⭐ 金星品质！', '⭐ Gold star quality!'), '#ffd84d', 36, -70);
          app.sfx.headshot();
          break;
        case 'farmShip': {
          this.binOpen[f.team] = 1.4;
          if (busy) break;
          const [bx, by] = binMid(f.team);
          this.coinsTo(f.team, bx, by, Math.min(8, 2 + Math.floor(f.gold / 150)));
          fx.text(bx, by - 30, f.night ? L(`📦 连夜出货 +${f.gold}g`, `📦 Shipped overnight +${f.gold}g`) : L(`📦 当场出货 +${f.gold}g`, `📦 Shipped now +${f.gold}g`), '#ffe27a', 17, 1.6);
          if (app.sfx.ok(2)) tones([1319, 1568, 2093], 'square', 0.06, 0.06, 0.08, 0.25);
          break;
        }
        case 'farmNight':
          this.nightFlash = busy ? 0.4 : 1.5;
          break;
        case 'farmWither':
          if (busy) break;
          for (const i of f.plots) fx.smoke(...plotMid(f.team, i), 5, 12, 'rgba(120,90,40,0.55)');
          if (f.plots.length) this.big(f.team, f.why === 'season' ? L('🥀 换季，庄稼枯了', '🥀 Crops died with the season') : L('🥀 庄稼枯萎了', '🥀 The crops withered'), '#d9b27a', 30, 60);
          if (f.why === 'wait') this.say(f.team, L('🎩 刘易斯：「唉，年轻人……」', '🎩 Lewis: "Sigh… young people these days."'));
          break;
        case 'farmCrow': {
          const [x, y] = at || scarecrowXY(f.team);
          const sx = CX[f.team] + outward(f.team) * rand(250, 380);
          this.crows.push({ sx, sy: -40, px: x - (at ? 0 : outward(f.team) * 60), py: y - 6, t: 0, miss: !at, face: x > sx ? 1 : -1 });
          if (!busy && !at) fx.text(x, y - 70, L('🎃 稻草人吓跑了乌鸦', '🎃 The scarecrow scared it off'), '#fff', 14, 1.6);
          if (!busy && app.sfx.ok()) app.sfx.tone(700, 0.18, 0.06, 'sawtooth', 380, 0.3);
          break;
        }
        case 'farmWeed':
          if (!busy) fx.sparks(...at, '#3f7a2a', 6, 60);
          break;
        case 'farmPassOut':
          if (fm) fm.sleep = busy ? 1 : 3.2;
          this.say(f.team, L(`😵 你在凌晨两点晕倒了……医药费 ${f.loss}g`, `😵 You passed out at 2 AM… ${f.loss}g in medical bills`), 3.2);
          if (!busy && f.loss) fx.text(...signMid(f.team), `-${f.loss}g`, '#ff8a8a', 20, 1.6);
          if (!busy && app.sfx.ok(2)) tones([523, 392, 262], 'triangle', 0.2, 0.08, 0.25);
          break;
        case 'farmScythe':
          if (fm && f.plots.length) {
            const [px, py] = plotXY(f.team, f.plots[0]);
            fm.goTo(px + TILE / 2, py + TILE - 6);
            fm.act('scythe', null, 0.9);
          }
          if (busy) break;
          for (const i of f.plots) fx.sparks(...plotMid(f.team, i), '#6fbf4a', 12, 160);
          this.big(f.team, L('🔪 一镰刀下去……', '🔪 Swish… there go the crops'), '#ff9a8a', 28, 40);
          break;
        case 'farmBolt':
          this.bolts.push({ x: at[0], y: at[1], t: 0 });
          if (busy) break;
          fx.explosion(...at, false);
          fx.text(at[0], at[1] - 40, L('⚡ 闪电劈中了庄稼', '⚡ Lightning struck a crop'), '#fff27a', 15, 1.4);
          app.shake(0.25, 6);
          app.sfx.boom(false);
          break;
        case 'farmLetter':
          if (busy) break;
          if (fm) this.letters.push({ x1: fm.x + 300 * outward(f.team), y1: -30, fm, t: 0, dur: 0.9, gold: f.gold });
          this.say(f.team, L(`💌 妈妈：「给你寄了点钱，别太累了。」+${f.gold}g`, `💌 Mom: "Here's a little money. Don't overwork!" +${f.gold}g`));
          break;
        case 'farmLewis':
          this.say(f.team, L('🎩 刘易斯：「我这儿有个小委托……」', '🎩 Lewis: "I have a small favor to ask…"'));
          break;
        case 'farmQuest':
          this.say(f.team, L(`🎩 刘易斯：「谢谢！这是赏金。」+${f.gold}g`, `🎩 Lewis: "Thank you! Here's your reward." +${f.gold}g`));
          if (!busy) this.coinsTo(f.team, CX[f.team], GATE_Y - 40, 5);
          break;
        case 'farmCC':
          this.dance[f.team] = busy ? 1 : 5;
          if (busy) break;
          this.coinsTo(f.team, CX[f.team], GRID_Y + 170, 10);
          this.big(f.team, L('🏛 社区中心修好了！', '🏛 Community Center restored!'), '#ffe27a', 38, -40, 2.2);
          app.shake(0.3, 4);
          if (app.sfx.ok(2)) tones([523, 659, 784, 1047, 1319], 'triangle', 0.09, 0.08, 0.16);
          break;
        case 'farmShop':
          // 上网很频繁：同一个人隔几秒才出一次台词
          if (!fm || busy || fm.shopT > 0) break;
          fm.shopT = 4;
          fx.text(fm.x, fm.y - 84, L(`🛒 皮埃尔：欢迎光临！${cropName(f.tier)}种子到货`, `🛒 Pierre: "Welcome!" ${cropName(f.tier)} seeds in stock`), '#ffe9b0', 14, 1.6);
          break;
        case 'farmClosed':
          if (fm && !busy) fx.text(fm.x, fm.y - 84, L('🚪 皮埃尔的店：周三休息', '🚪 Pierre’s: closed on Wednesdays'), '#ffb0a0', 14, 1.6);
          break;
        case 'farmTier':
          if (!busy) this.big(f.team, L(`🌱 买得起${cropName(f.tier)}种子了`, `🌱 ${cropName(f.tier)} seeds unlocked`), '#b8ff9a', 28, 100, 1.8);
          break;
        case 'roundEnd': {
          // 内战时外壳把 winner 抹成了 null（不计分），画面照样给赢的那块地放烟花
          const w = f.winner || R.history?.[R.history.length - 1]?.winner;
          if (!w) break;
          this.big(w, L('💰 年度最佳农场！', '💰 Farm of the Year!'), '#ffd84d', 50, -20, 2.6);
          if (!busy) JUNI.forEach((col) => fx.sparks(CX[w] + rand(-200, 200), GRID_Y + rand(0, 300), col, 12, 200));
          break;
        }
      }
    }
  }

  update(dt, R) {
    const live = this.app.mode === 'live';
    for (const f of this.farmers.values()) {
      const p = R.players.get(f.sid);
      if (p) f.update(dt, R.now - p.lastActive < (live ? 60e3 : 90e3));
    }
    this.fx.update(dt);
    const tick = (arr, end) => arr.filter((o) => (o.t += dt) < end(o));
    this.crows = tick(this.crows, () => 2.2);
    this.junimos = tick(this.junimos, (j) => j.life);
    this.coins = tick(this.coins, (c) => c.dur);
    this.items = tick(this.items, (it) => it.dur);
    this.bolts = tick(this.bolts, () => 0.5);
    this.bigs = tick(this.bigs, (b) => b.life);
    this.letters = tick(this.letters, (l) => {
      if (l.t >= l.dur) this.fx.text(l.fm.x, l.fm.y - 70, `💌 +${l.gold}g`, '#ffd1e6', 16, 1.4);
      return l.dur;
    });
    for (const [k, v] of this.pops) {
      if (v - dt <= 0) this.pops.delete(k);
      else this.pops.set(k, v - dt);
    }
    for (const t of TEAMS) {
      this.binOpen[t] = Math.max(0, this.binOpen[t] - dt);
      this.dance[t] = Math.max(0, this.dance[t] - dt);
      if (this.dialog[t] && (this.dialog[t].life -= dt) <= 0) this.dialog[t] = null;
      // 金币牌滚动计数
      const target = R.farms?.[t]?.gold ?? START_GOLD;
      this.shown[t] += (target - this.shown[t]) * Math.min(1, dt * 5);
      if (Math.abs(target - this.shown[t]) < 1) this.shown[t] = target;
    }
    // 时钟慢慢走；翻到第二天直接跳回早上
    const k = R.phase === 'live' ? (R.cal?.acts ?? 0) / (R.dayActs || 6) : 0.15;
    this.tod = k < this.tod - 0.3 ? k : this.tod + (k - this.tod) * Math.min(1, dt * 3);
    this.nightFlash = Math.max(0, this.nightFlash - dt);
    for (const s of this.flakes) {
      s.y += s.v * dt;
      s.x += Math.sin(this.app.rt() * 1.3 + s.ph) * 18 * dt;
      if (s.y > H + 10) [s.y, s.x] = [-10, rand(0, W)];
    }
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    const { season, year, dom } = calOf(R.cal?.day ?? 0);
    const hour = 6 + this.tod * 20;
    const dusk = clamp((hour - 17) / 4, 0, 1);
    const fs = fontFor(scale);
    g.drawImage(backdrop(season), 0, 0, W, H);
    for (const team of TEAMS) {
      this.drawHouse(g, team, Math.max(dusk, this.nightFlash > 0 ? 1 : 0));
      this.drawBin(g, team, clamp(this.binOpen[team] / 0.4, 0, 1));
      this.drawScarecrow(g, ...scarecrowXY(team));
      R.farms?.[team]?.plots.forEach((pl, i) => this.drawPlot(g, team, i, pl, rt));
    }
    // 人物按纵坐标排序，下面的挡住上面的
    const sprites = [];
    for (const f of this.farmers.values()) if (R.players.get(f.sid)) sprites.push([f.y, () => this.drawFarmer(g, f, rt)]);
    for (const j of this.junimos) {
      if (j.t < 0) continue;
      const q = clamp(j.t / 0.8, 0, 1) - clamp((j.t - 1.4) / 0.8, 0, 1); // 跳过去，干完活再跳回来
      const [x, y] = [j.sx + (j.tx - j.sx) * q, j.sy + (j.ty - j.sy) * q];
      sprites.push([y, () => this.drawJunimo(g, x, y, j.color, Math.abs(Math.sin(j.t * 9)) * 12, Math.min(1, (j.life - j.t) / 0.3))]);
    }
    for (const team of TEAMS) {
      // 社区中心修好了：一圈祝尼魔绕着地跳舞
      for (let n = 0; this.dance[team] > 0 && n < 6; n++) {
        const a = rt * 1.6 + (n * Math.PI) / 3;
        const [x, y] = [CX[team] + Math.cos(a) * 170, GRID_Y + 180 + Math.sin(a) * 110];
        sprites.push([y, () => this.drawJunimo(g, x, y, JUNI[n], Math.abs(Math.sin(rt * 8 + n)) * 16, Math.min(1, this.dance[team] / 0.5))]);
      }
      if (this.waiter(R, team)) sprites.push([GATE_Y - 30, () => this.drawLewis(g, CX[team], GATE_Y - 30, rt)]);
    }
    sprites.sort((a, b) => a[0] - b[0]);
    for (const [, draw] of sprites) draw();
    this.drawFlyers(g, rt);
    // 天色：傍晚泛橙，夜里发蓝；刚过一夜闪一下深蓝
    const night = Math.max(clamp((hour - 20) / 5, 0, 1) * 0.3, this.nightFlash > 0 ? Math.min(1, this.nightFlash / 0.6) * 0.5 : 0);
    if (dusk > 0) rect(g, `rgba(255,140,60,${dusk * 0.1 * (1 - night)})`, 0, 0, W, H);
    if (night > 0) rect(g, `rgba(16,24,70,${night})`, 0, 0, W, H);
    const amb = AMBIENT[season];
    if (amb) this.flakes.forEach((s, n) => ell(g, s.x, s.y, season === 3 ? 2.5 : 4, 2.5, season === 3 ? 0 : rt * 2 + s.ph, amb[n % amb.length]));
    this.fx.renderOver(g, scale);
    for (const f of this.farmers.values()) {
      const p = R.players.get(f.sid);
      if (p) this.drawTags(g, f, p, R, fs, rt);
    }
    for (const team of TEAMS) {
      this.drawSign(g, R, team, fs);
      if (R.phase === 'live') this.drawWait(g, R, team, fs);
      if (!R.field(team).length) pill(g, CX[team], GRID_Y + 180, L(`等待 ${TEAM_NAME[team]} 上场…`, `Waiting for ${TEAM_NAME[team]}…`), { size: 18, max: 320, color: COLOR[team] });
      if (this.dialog[team]) this.drawDialog(g, team, this.dialog[team], fs);
    }
    for (const b of this.bigs) {
      const q = b.t / b.life;
      g.globalAlpha = q > 0.75 ? 1 - (q - 0.75) / 0.25 : 1;
      this.bigText(g, b.x, b.y - q * 30, b.text, b.color, Math.max(b.size, fontFor(scale, b.size * 0.7)), q < 0.1 ? 0.6 + q * 4 : 1);
    }
    g.globalAlpha = 1;
    this.drawCalendar(g, R, season, year, dom, rt);
  }

  waiter(R, team) {
    for (const [sid, w] of R.waits || []) {
      const p = R.players.get(sid);
      if (!w.boom && p && p.onField && p.team === team) return [p, w];
    }
    return null;
  }

  bigText(g, x, y, text, color, size, s = 1) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, size / 6);
    g.strokeStyle = 'rgba(60,30,10,0.85)';
    g.strokeText(text, 0, 0);
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  }

  /** 农舍：屋顶是队伍颜色，天黑了窗户亮灯。 */
  drawHouse(g, team, glow) {
    const [x, y] = HOUSE[team];
    rect(g, 'rgba(0,0,0,0.2)', x + 12, y + 184, 206, 14);
    rect(g, '#d6a067', x + 16, y + 88, 192, 102);
    for (let n = 1; n < 6; n++) rect(g, 'rgba(110,60,20,0.22)', x + 16, y + 88 + n * 17, 192, 2);
    rect(g, '#8a5a3a', x + (team === 'claude' ? 168 : 36), y - 6, 22, 40);
    poly(g, DEEP[team], [[x, y + 96], [x + 34, y + 18], [x + 190, y + 18], [x + 224, y + 96]]);
    for (let n = 0; n < 4; n++) {
      const inset = 34 * (1 - (6 + n * 18) / 78);
      rect(g, COLOR[team], x + inset + 6, y + 24 + n * 18, 224 - 2 * inset - 12, 8);
    }
    rect(g, '#7a4a24', x + 97, y + 128, 30, 62);
    ell(g, x + 121, y + 160, 2.5, 2.5, 0, '#f0c040');
    for (const wx of [x + 38, x + 152]) {
      rect(g, glow > 0.2 ? `rgba(255,214,120,${0.6 + glow * 0.4})` : '#a9d8f0', wx, y + 118, 34, 28);
      for (const [a, b, w, h] of [[15, 0, 4, 28], [0, 12, 34, 3], [-2, -2, 38, 3], [-2, 27, 38, 3], [-2, 0, 3, 28], [33, 0, 3, 28]]) rect(g, '#7a4a24', wx + a, y + 118 + b, w, h);
    }
  }

  /** 出货箱：结算时盖子掀开。 */
  drawBin(g, team, open) {
    const [x, y] = BIN[team];
    rect(g, 'rgba(0,0,0,0.2)', x + 4, y + 50, 76, 8);
    rect(g, '#9b6a35', x, y + 14, 76, 40);
    for (let n = 1; n < 4; n++) rect(g, 'rgba(70,40,15,0.35)', x, y + 14 + n * 10, 76, 2);
    rect(g, '#7d7d86', x + 8, y + 14, 5, 40);
    rect(g, '#7d7d86', x + 63, y + 14, 5, 40);
    if (open > 0) rect(g, '#3a2410', x + 3, y + 12, 70, 6);
    rect(g, '#b8814a', x - 3, y + 4 - open * 16, 82, 11 - open * 5);
    rect(g, '#7d7d86', x + 30, y + 6 - open * 16, 16, 4);
  }

  drawScarecrow(g, x, y) {
    ell(g, x, y + 2, 14, 5, 0, 'rgba(0,0,0,0.18)');
    rect(g, '#7a5230', x - 3, y - 50, 6, 52);
    rect(g, '#7a5230', x - 24, y - 40, 48, 5);
    rect(g, '#8f6bb0', x - 12, y - 42, 24, 22);
    ell(g, x, y - 54, 11, 11, 0, '#e8b34c');
    rect(g, '#3a2a1a', x - 5, y - 57, 3, 3);
    rect(g, '#3a2a1a', x + 3, y - 57, 3, 3);
    ell(g, x, y - 64, 16, 4, 0, '#c9a24a');
    ell(g, x, y - 69, 8, 6, 0, '#c9a24a');
  }

  /** 一块地：浇过水颜色变深，作物按生长阶段画。 */
  drawPlot(g, team, i, pl, rt) {
    const [x, y] = plotXY(team, i);
    rr(g, 'rgba(0,0,0,0.15)', x + 3, y + 5, TILE, TILE, 12);
    rr(g, pl.wet ? '#5d3b20' : '#9b6b3e', x, y, TILE, TILE, 12);
    for (let n = 1; n < 4; n++) rect(g, pl.wet ? 'rgba(0,0,0,0.2)' : 'rgba(80,45,20,0.25)', x + 10, y + (n * TILE) / 4 - 2, TILE - 20, 3);
    if (pl.wet) ell(g, x + 30, y + 26, 10, 4, 0, 'rgba(160,210,255,0.25)');
    if (pl.weed) for (const [wx, wy] of [[30, 70], [62, 48], [78, 82]]) drawCrop(g, x + wx, y + wy, 3, 1, 1.1, Math.sin(rt * 2 + wx) * 0.1);
    if (pl.c < 0) return;
    const frac = pl.g / CROPS[pl.c].grow;
    const st = frac >= 1 ? 3 : frac < 0.34 ? 0 : frac < 0.67 ? 1 : 2;
    const pop = this.pops.get(`${team}:${i}`) || 0;
    drawCrop(g, x + TILE / 2, y + TILE * 0.74, pl.c, st, (1.5 + st * 0.08) * (1 - (pop / 0.35) * 0.7), Math.sin(rt * 1.7 + i) * 0.05);
    if (pl.star) star(g, x + TILE - 16, y + 16, 9, '#ffd84d');
    if (st === 3 && Math.sin(rt * 3 + i * 1.7) > 0.9) star(g, x + 22, y + 22, 5, '#ffffff');
  }

  drawFarmer(g, f, rt) {
    const { x, y, face } = f;
    ell(g, x, y, 15, 5, 0, 'rgba(0,0,0,0.22)');
    if (f.sleep > 0) {
      // 晕倒：横躺在地上，头上冒 z
      rect(g, f.shirt, x - 20, y - 12, 22, 12);
      rect(g, '#3c4a7a', x - 36, y - 11, 16, 10);
      ell(g, x + 12, y - 7, 9, 9, 0, SKIN);
      ell(g, x + 21, y - 7, 4.5, 14, 0, COLOR[f.team]);
      txt(g, 'z', x + 18 + ((rt * 20) % 12), y - 24 - ((rt * 20) % 12), '800 16px', '#fff');
      return;
    }
    const step = f.moving ? Math.sin(rt * 14) * 3 : 0;
    for (const [lx, lift] of [[-7, Math.max(0, step)], [1, Math.max(0, -step)]]) {
      rect(g, '#3c4a7a', x + lx, y - 16 - lift, 6, 15);
      rect(g, '#5a3a22', x + lx - 1, y - 3 - lift, 7, 4);
    }
    rr(g, f.shirt, x - 10, y - 34, 20, 20, 5);
    const pose = f.pose;
    const q = pose ? pose.t / pose.max : 0;
    const [hx, hy] = [x + face * 12, y - 26];
    if (pose?.kind === 'harvest') {
      // 星露谷经典姿势：把刚收的作物举过头顶
      rect(g, SKIN, x - 13, y - 52, 5, 20);
      rect(g, SKIN, x + 8, y - 52, 5, 20);
      drawCrop(g, x, y - 62 - Math.sin(Math.min(1, q * 3) * (Math.PI / 2)) * 6, pose.item, 3, 0.9);
    } else {
      rect(g, SKIN, x - face * 13 - 2, y - 32, 5, 14);
      rect(g, SKIN, hx - 2, y - 32, 5, 12);
      if (pose?.kind === 'water') {
        // 喷壶歪着倒水
        g.save();
        g.translate(hx + face * 4, hy);
        g.rotate(face * 0.5);
        rect(g, '#8fa3b8', -7, -5, 14, 11);
        rect(g, '#8fa3b8', face > 0 ? 6 : -18, -3, 12, 3);
        g.restore();
        for (let n = 0; n < 3; n++) ell(g, hx + face * (20 + n * 3), y - 18 + ((rt * 90 + n * 7) % 18), 1.8, 2.5, 0, '#8fd3ff');
      } else if (pose?.kind === 'plant' || pose?.kind === 'scythe') {
        // 锄头 / 镰刀挥一下
        g.save();
        g.translate(hx, hy);
        g.rotate(face * (-1.6 + Math.sin(q * Math.PI) * 2.2));
        rect(g, '#8a5a2b', -1.5, -26, 3, 28);
        if (pose.kind === 'plant') rect(g, '#b8c0c8', face > 0 ? -1.5 : -8.5, -28, 10, 4);
        else {
          g.beginPath();
          g.arc(face * 8, -26, 9, Math.PI, Math.PI * 2);
          g.lineWidth = 3;
          g.strokeStyle = '#d0d6dc';
          g.stroke();
        }
        g.restore();
      }
    }
    ell(g, x, y - 44, 10, 10, 0, SKIN);
    rect(g, '#2b2b2b', x + face * 4 - 1, y - 46, 2, 3);
    rect(g, '#2b2b2b', x - face * 2 - 1, y - 46, 2, 3);
    rect(g, '#6b4226', x - 10 - face * 2, y - 50, 6, 8);
    // 草帽：队伍颜色
    ell(g, x, y - 52, 16, 4.5, 0, COLOR[f.team]);
    rr(g, COLOR[f.team], x - 9, y - 63, 18, 12, 5);
    rect(g, DEEP[f.team], x - 9, y - 55, 18, 3);
  }

  drawTags(g, f, p, R, fs, rt) {
    const active = R.now - p.lastActive < (this.app.mode === 'live' ? 60e3 : 90e3);
    const top = f.y - (f.pose?.kind === 'harvest' ? 104 : 78);
    pill(g, f.x, top, p.name, { color: COLOR[f.team], size: fs, max: 120 });
    if (f.label) {
      g.globalAlpha = Math.min(1, f.label.life / 0.4);
      pill(g, f.x, top - fs - 8 - (1.7 - f.label.life) * 6, f.label.text, { size: fs - 1, max: 190, weight: 500, bg: f.label.ok ? 'rgba(40,24,10,0.75)' : 'rgba(120,20,20,0.8)' });
      g.globalAlpha = 1;
    }
    if (!active && f.sleep <= 0) {
      const q = (rt * 0.6 + f.x) % 1;
      g.globalAlpha = 1 - q;
      txt(g, 'z', f.x + 14 + q * 8, f.y - 60 - q * 18, `700 ${fs}px`, '#fff');
      g.globalAlpha = 1;
    }
  }

  /** 祝尼魔：圆滚滚的小精灵，头顶一片叶子。 */
  drawJunimo(g, x, y, color, hop, alpha = 1) {
    g.globalAlpha = alpha;
    ell(g, x, y, 10, 4, 0, 'rgba(0,0,0,0.2)');
    const by = y - hop;
    ell(g, x, by - 11, 11, 10, 0, color);
    ell(g, x, by - 5, 9, 4, 0, 'rgba(0,0,0,0.12)');
    ell(g, x - 4, by - 13, 1.8, 2.4, 0, '#1b1b1b');
    ell(g, x + 4, by - 13, 1.8, 2.4, 0, '#1b1b1b');
    poly(g, '#3f8f2a', [[x, by - 20], [x + 2, by - 27]], 2);
    ell(g, x + 6, by - 28, 5, 2.5, -0.5, '#6fd04a');
    g.globalAlpha = 1;
  }

  /** 刘易斯镇长：扁帽、白胡子，头上一个感叹号。 */
  drawLewis(g, x, y, rt) {
    ell(g, x, y, 15, 5, 0, 'rgba(0,0,0,0.22)');
    rect(g, '#5b4636', x - 7, y - 16, 6, 16);
    rect(g, '#5b4636', x + 1, y - 16, 6, 16);
    rr(g, '#6b8f3c', x - 11, y - 36, 22, 22, 5);
    rect(g, '#7a5a3a', x - 5, y - 36, 10, 20);
    ell(g, x, y - 46, 10, 10, 0, '#f0c49a');
    rect(g, '#d0d0d0', x - 7, y - 42, 14, 4);
    ell(g, x, y - 54, 12, 4, 0, '#6b4a2e');
    ell(g, x, y - 57, 9, 5, 0, '#7a5a3a');
    const bob = Math.sin(rt * 6) * 3;
    rr(g, '#fff', x + 10, y - 92 + bob, 24, 26, 6);
    txt(g, '!', x + 22, y - 79 + bob, '900 20px', '#d9342b');
  }

  /** 天上飞的：收获的作物飞进出货箱、金币飞上金币牌、信、乌鸦、闪电。 */
  drawFlyers(g, rt) {
    const arc = (o, x2, y2, hgt) => {
      const q = clamp(o.t / o.dur, 0, 1);
      return [o.x1 + (x2 - o.x1) * q, o.y1 + (y2 - o.y1) * q - Math.sin(q * Math.PI) * hgt, q];
    };
    for (const it of this.items) {
      const [x, y, q] = arc(it, it.x2, it.y2, 120);
      drawCrop(g, x, y + 10, it.c, 3, 0.9 * (1 - q * 0.4));
      if (it.star) star(g, x + 12, y - 16, 6, '#ffd84d');
    }
    for (const c of this.coins) {
      if (c.t < 0) continue;
      const [x, y] = arc(c, c.x2, c.y2, 90);
      ell(g, x, y, 7 * Math.abs(Math.cos(rt * 10 + c.x1)) + 1, 7, 0, '#f7c843');
    }
    for (const l of this.letters) {
      const [x, y] = arc(l, l.fm.x, l.fm.y - 70, 0);
      rect(g, '#fff6e6', x - 12, y - 8, 24, 16);
      poly(g, '#d07a9a', [[x - 12, y - 8], [x, y + 1], [x + 12, y - 8]], 1.5);
    }
    for (const c of this.crows) {
      // 飞进来 → 啄几下 → 叼着飞走；被稻草人吓到的直接掉头
      const [tin, tpeck] = c.miss ? [0.6, 0.6] : [0.7, 1.3];
      let [x, y, face] = [c.px, c.py + Math.abs(Math.sin(c.t * 18)) * 4, c.face];
      if (c.t < tin) [x, y] = [c.sx + ((c.px - c.sx) * c.t) / tin, c.sy + ((c.py - c.sy) * c.t) / tin];
      else if (c.t >= tpeck) {
        const q = (c.t - tpeck) / 0.8;
        const ax = c.miss ? c.sx : c.px * 2 - c.sx;
        [x, y, face] = [c.px + (ax - c.px) * q, c.py + (-80 - c.py) * q, c.miss ? -c.face : c.face];
      }
      this.drawCrow(g, x, y, rt, face, c.t >= tin && c.t < tpeck);
    }
    for (const b of this.bolts) {
      g.globalAlpha = 1 - b.t / 0.5;
      poly(g, '#fff8a0', [[b.x + 30, 0], ...Array.from({ length: 6 }, (_, n) => [b.x + ((n + 1) % 2 ? -18 : 18) * (1 - (n + 1) / 6), (b.y * (n + 1)) / 6])], 5);
      g.globalAlpha = 1;
    }
  }

  drawCrow(g, x, y, rt, face, perched) {
    const flap = perched ? 0 : Math.sin(rt * 22);
    ell(g, x, y, 11, 7, 0, '#1d1d26');
    ell(g, x + face * 10, y - 4, 6, 6, 0, '#1d1d26');
    poly(g, '#f0a020', [[x + face * 15, y - 6], [x + face * 22, y - 3], [x + face * 15, y - 1]]);
    ell(g, x + face * 11, y - 6, 1.4, 1.4, 0, '#fff');
    poly(g, '#2a2a36', [[x - face * 2, y - 2], [x - face * 10, y - 4 - flap * 14], [x + face * 4, y - 3]]);
    poly(g, '#2a2a36', [[x - face * 9, y], [x - face * 18, y - 3], [x - face * 16, y + 4]]);
  }

  /** 金币牌：队名、金币（滚动计数）、到目标的进度条（亮黄那截是出货箱里还没结算的）、买得起的种子。 */
  drawSign(g, R, team, fs) {
    const [x, y] = SIGN[team];
    const [w, h] = [256, 128];
    const farm = R.farms?.[team];
    rect(g, '#7a4a24', x + 30, y + h - 6, 10, 30);
    rect(g, '#7a4a24', x + w - 40, y + h - 6, 10, 30);
    rr(g, '#b97f45', x, y, w, h, 10);
    rr(g, '#f3dba6', x + 6, y + 6, w - 12, h - 12, 7);
    g.font = `900 17px ${FONT}`;
    txt(g, fitText(g, L(`${TEAM_NAME[team]} 农场`, `${TEAM_NAME[team]} Farm`), w - 30), x + w / 2, y + 22, '900 17px', DEEP[team]);
    rr(g, '#3b2a1a', x + 16, y + 36, w - 32, 36, 6);
    ell(g, x + 36, y + 54, 9, 9, 0, '#f7c843');
    txt(g, 'g', x + 36, y + 53, '900 11px', '#9a6a10');
    txt(g, `${money(this.shown[team])}g`, x + w - 26, y + 55, '900 24px', '#ffd75e', 'right');
    const goal = R.goal || 1;
    const frac = clamp((farm?.gold ?? 0) / goal, 0, 1);
    rect(g, '#8a6a40', x + 16, y + 80, w - 32, 10);
    rect(g, COLOR[team], x + 16, y + 80, (w - 32) * frac, 10);
    if (farm?.bin) rect(g, 'rgba(255,230,120,0.6)', x + 16 + (w - 32) * frac, y + 80, (w - 32) * Math.min(1 - frac, farm.bin / goal), 10);
    const seeds = farm ? cropName(farm.tier) : '';
    txt(g, L(`🎯 ${money(goal)}g · 种子：${seeds}`, `🎯 ${money(goal)}g · Seeds: ${seeds}`), x + w / 2, y + 106, `700 ${Math.min(14, fs + 1)}px`, '#5a3a1a');
  }

  /** 它在等你：刘易斯站在门口，脚下一圈倒计时。 */
  drawWait(g, R, team, fs) {
    const hit = this.waiter(R, team);
    if (!hit) return;
    const [p, w] = hit;
    const left = Math.max(0, w.deadline - R.now);
    pill(g, CX[team], GATE_Y + 18, L(`🎩 刘易斯镇长在等 ${p.name} · ${Math.ceil(left / 1000)} 秒`, `🎩 Mayor Lewis waits on ${p.name} · ${Math.ceil(left / 1000)}s`), { size: fs, max: 340, bg: 'rgba(130,30,20,0.85)' });
    g.strokeStyle = 'rgba(255,120,100,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(CX[team], GATE_Y - 58, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / (w.deadline - w.t)));
    g.stroke();
  }

  /** 星露谷风格的对话框：米色底、深棕边。 */
  drawDialog(g, team, d, fs) {
    const [w, h] = [520, 56];
    const [x, y] = [CX[team] - w / 2, GATE_Y - 200];
    g.globalAlpha = clamp(Math.min(d.life / 0.3, (d.max - d.life) / 0.15), 0, 1);
    rr(g, '#8a4b1f', x - 4, y - 4, w + 8, h + 8, 10);
    rr(g, '#f8e4b4', x, y, w, h, 7);
    g.strokeStyle = '#d6a05a';
    g.lineWidth = 2;
    g.strokeRect(x + 5, y + 5, w - 10, h - 10);
    const font = `700 ${Math.max(15, fs + 2)}px`;
    g.font = `${font} ${FONT}`;
    txt(g, fitText(g, d.text, w - 30), CX[team], y + h / 2, font, '#4a2a10');
    g.globalAlpha = 1;
  }

  /** 星露谷右上角那种日历框：季节、第几天、时钟（按今天做了多少动作走）。 */
  drawCalendar(g, R, season, year, dom, rt) {
    const [x, y, w, h] = [704, 12, 192, 96];
    rr(g, '#8a4b1f', x - 4, y - 4, w + 8, h + 8, 12);
    rr(g, '#f8e4b4', x, y, w, h, 9);
    txt(g, SEASON_ICON[season], x + 24, y + 26, '20px', '#000');
    txt(g, L(`${seasonName(season)} 第 ${dom} 天`, `${seasonName(season)} ${dom}`), x + w / 2 + 14, y + 26, '900 19px', '#4a2a10');
    // 小太阳 / 月亮沿着弧线走
    const a = Math.PI + clamp(this.tod, 0, 1) * Math.PI;
    g.strokeStyle = 'rgba(138,75,31,0.4)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x + 40, y + 72, 24, 18, 0, Math.PI, Math.PI * 2);
    g.stroke();
    ell(g, x + 40 + Math.cos(a) * 24, y + 72 + Math.sin(a) * 18, 6, 6, 0, this.tod > 0.7 ? '#c9d3ff' : '#ffb830');
    txt(g, timeText(this.tod), x + 128, y + 58, '800 17px', '#4a2a10');
    txt(g, L(`第 ${year} 年`, `Year ${year}`), x + 128, y + 80, '700 13px', '#8a5a2a');
    if (R.phase !== 'live') txt(g, L('热身中', 'Warm-up'), x + w / 2, y + h + 18, '800 15px', `rgba(255,255,255,${0.7 + 0.3 * Math.sin(rt * 3)})`);
  }

  hud(R) {
    if (R.phase !== 'live' || !R.farms) return null;
    const { season, dom } = calOf(R.cal.day);
    return { mid: L(`${seasonName(season)} 第 ${dom} 天`, `${seasonName(season)} ${dom}`), sub: `💰 ${money(R.farms.claude.gold)} : ${money(R.farms.codex.gold)}` };
  }
}
