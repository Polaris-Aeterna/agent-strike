// 马里奥赛车：俯视角卡丁车，每个动作踩一脚油门，先跑完的人冲线。
// 测试通过吃蘑菇，上网查资料放蓝龟壳（专炸领跑的，自己人也炸），报错踩香蕉，等你回复就停在路边。
import { Rules as Base, COLOR, DEEP, WORLD, clamp, rng, actText } from '../core.js';
import { Particles, rand, pill, emoji, fontFor, FONT } from '../fxkit.js';
import { L } from '../i18n.js';

// meta 在 import 时就求值，文字都写成 getter，切换语言后读到的是新语言
export const meta = {
  id: 'kart',
  icon: '🏎️',
  get name() { return L('马里奥赛车', 'Mario Kart'); },
  get desc() { return L('每个动作踩一脚油门。蓝龟壳专炸第一名，自己人也不放过', 'Every action hits the gas. The Blue Shell hunts first place, teammates included'); },
  get roundWord() { return L('场', 'race'); },
  get wait() {
    return {
      start: L('⏳ {a} 把车停在路边等你', '⏳ {a} pulled over to wait for you'),
      sub: L('40 秒内回它，不然拖车就来了', 'Reply within 40s or the tow truck comes'),
      done: L('🏎️ 回得及时，重新上路', '🏎️ Replied in time, back on the road'),
      boom: L('🚛 {a} 等太久，被拖车拖走了', '🚛 {a} waited too long and got towed'),
    };
  },
  get legend() {
    return [
      [L('🔫 跑命令 / 改代码 / 读文件', '🔫 Command / edit / read'), L('踩油门（改代码是漂移小喷）', 'Hit the gas (edits are drift boosts)')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('🍄 蘑菇加速', '🍄 Mushroom boost')],
      [L('🔭 上网查资料', '🔭 Search the web'), L('💙 蓝龟壳：专炸第一名，自己人也炸', '💙 Blue Shell: hits first place, even a teammate')],
      [L('🔍 读文件、搜代码', '🔍 Read or search code'), L('偶尔扔 🟢 绿龟壳砸前面那辆', 'Sometimes a 🟢 Green Shell at the kart ahead')],
      [L('✅ 任务完成', '✅ Task done'), L('⭐ 无敌星：接下来几下更快还不怕道具', '⭐ Star: faster and immune for a few actions')],
      [L('🐛 动作报错', '🐛 Action fails'), L('🍌 踩到香蕉，原地打转', '🍌 Slip on a Banana and spin out')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('🚀 火箭炮弹，一口气冲出去一大截', '🚀 Bullet Bill: a huge jump forward')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('⚡ 被闪电劈中，缩小变慢', '⚡ Struck by Lightning: tiny and slow')],
      [L('💰 烧 token', '💰 Burn tokens'), L('🪙 捡金币，金币越多极速越高', '🪙 Coins: more coins, higher top speed')],
      [L('💬 收到新指令', '💬 New prompt'), L('小加速', 'Small boost')],
      [L('✋ 被你打断', '✋ You interrupt it'), L('被你一脚踢出赛道', 'You kick it off the track')],
      [L('⏳ 它在等你', '⏳ Waiting for you'), L('停在路边，40 秒不回被拖车拖走', 'Pulls over; 40s and the tow truck takes it')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('直接冲刺一大截', 'A big straight-line dash')],
      [L('🐢 落在后面', '🐢 Falling behind'), L('跑得更快（橡皮筋）', 'Drive faster (rubber-banding)')],
    ];
  },
};

const GAS = { shell: 0.05, read: 0.03, edit: 0.06, misc: 0.04, web: 0.04 }; // 每个动作往前跑多少圈（乘倍率前）
const POINTS = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]; // 大奖赛积分
const COIN_TOK = 1500; // 每烧这么多 token 捡一个金币
const BLUE_GAP = 12; // 全场至少隔这么多个动作才会再出一个蓝龟壳（大乱斗减半）

// ================================================================ 规则

export class Rules extends Base {
  static defaults = { ffa: true, maxPerTeam: 6 };

  init() {
    this.laps = this.opts.laps || (this.party ? 2 : 3);
    this.pace = this.party ? 1.5 : 1;
    this.blueGap = this.party ? BLUE_GAP / 2 : BLUE_GAP;
    this.raceLen = (this.party ? 8 : 25) * 60e3; // 超时就按名次判
    this.sinceBlue = 0;
    this.finalLap = false;
    this.podium = [];
  }

  initPlayer(p) {
    Object.assign(p, { prog: 0, star: 0, tiny: 0, coins: 0, coinTok: 0, parked: false, race: -1, gp: 0, wins: 0 });
  }

  onEnter(p) {
    if (p.race === this.round && this.phase === 'live') return; // 同一场里挂机回来，接着跑
    // 半路上场的从车队最后面出发
    const others = this.field().filter((q) => q !== p && q.race === this.round);
    const back = this.phase === 'live' && others.length ? Math.max(0, Math.min(...others.map((q) => q.prog)) - 0.02) : 0;
    Object.assign(p, { prog: back, star: 0, tiny: 0, parked: this.waiting(p), race: this.round });
  }

  onRoundStart(fx) {
    this.sinceBlue = 0;
    this.finalLap = false;
    for (const p of this.field()) Object.assign(p, { prog: 0, star: 0, tiny: 0, coins: 0, parked: this.waiting(p), race: this.round });
    fx.push({ type: 'grid', round: this.round });
  }

  standings() {
    return this.field().sort((a, b) => b.prog - a.prog || (a.sid < b.sid ? -1 : 1));
  }

  top() {
    let best = null;
    for (const p of this.field()) if (!best || p.prog > best.prog) best = p;
    return best;
  }

  /** 速度倍率：均衡火力 ×（一队在场时）人数修正 × 无敌星 / 闪电 / 金币 × 落后补偿。 */
  mult(p) {
    const both = this.field('claude').length && this.field('codex').length;
    let m = this.balanceMult(p.team) * (both ? 1 : this.sizeMult()) * this.pace;
    if (p.star > 0) m *= 1.5;
    if (p.tiny > 0) m *= 0.6;
    m *= 1 + Math.min(10, p.coins) * 0.02;
    const lead = this.top();
    if (lead && lead !== p) m *= 1 + 0.5 * clamp((lead.prog - p.prog) / 0.5, 0, 1);
    return m;
  }

  /** 往前跑 amount 圈（已经乘好倍率），顺便报圈数。 */
  drive(p, amount, fx) {
    const before = Math.floor(p.prog);
    p.prog += amount;
    const after = Math.floor(p.prog);
    if (after > before && after < this.laps) {
      fx.push({ type: 'lap', sid: p.sid, lap: after + 1 });
      if (after === this.laps - 1 && !this.finalLap && this.laps > 1 && p === this.top()) {
        this.finalLap = true;
        fx.push({ type: 'announce', text: L('最后一圈！', 'Final Lap!'), sub: L(`${p.name} 领跑`, `${p.name} leads`), cls: 'gold', ms: 2200 });
      }
    }
  }

  /** 被道具打中：倒退、打转、掉金币。无敌星免疫（除了你的那一脚）。 */
  hurt(p, loss, what, by, fx, force = false) {
    if (p.star > 0 && !force) {
      fx.push({ type: 'immune', sid: p.sid, what });
      return false;
    }
    p.prog = Math.max(0, p.prog - loss);
    p.coins = Math.max(0, p.coins - 2);
    p.d++;
    if (by && by !== p) {
      by.k++;
      by.dmg += Math.round(loss * 100);
    }
    fx.push({ type: 'spin', sid: p.sid, what, by: by ? by.sid : null });
    return true;
  }

  onTokens(p, n, fx) {
    if (!p.onField || this.phase !== 'live') return;
    p.coinTok += n;
    let got = 0;
    while (p.coinTok >= COIN_TOK) {
      p.coinTok -= COIN_TOK;
      if (p.coins < 10) {
        p.coins++;
        got++;
      }
    }
    if (got) fx.push({ type: 'coin', sid: p.sid, coins: p.coins });
  }

  onEvent(p, ev, r, fx) {
    const act = ev.k in GAS || ev.k === 'agent';
    if (act) this.sinceBlue++;
    if (p.parked && ev.k !== 'ask' && ev.k !== 'answer' && !this.waiting(p)) p.parked = false;
    const m = this.mult(p);
    const bad = ev.ok === false;
    if (bad && ev.k in GAS) {
      // 报错：踩到香蕉
      this.hurt(p, 0.04, 'banana', null, fx);
    } else {
      switch (ev.k) {
        case 'shell':
          this.drive(p, GAS.shell * m, fx);
          if (ev.hs) {
            p.hs++;
            this.drive(p, 0.1 * m, fx);
            fx.push({ type: 'boost', sid: p.sid, what: 'mushroom' });
          }
          break;
        case 'read':
          this.drive(p, GAS.read * m, fx);
          if (r() < 0.3) this.green(p, r, fx);
          break;
        case 'edit':
          this.drive(p, GAS.edit * m, fx);
          fx.push({ type: 'boost', sid: p.sid, what: 'drift' });
          break;
        case 'misc':
          this.drive(p, GAS.misc * m, fx);
          break;
        case 'web':
          this.drive(p, GAS.web * m, fx);
          if (this.sinceBlue >= this.blueGap) this.blue(p, fx);
          else {
            this.drive(p, 0.04 * m, fx);
            fx.push({ type: 'boost', sid: p.sid, what: 'gold' });
          }
          break;
        case 'agent':
          this.drive(p, 0.3 * m, fx);
          fx.push({ type: 'boost', sid: p.sid, what: 'rocket' });
          break;
        case 'done':
          p.star = 5; // 这一下不算，后面 4 个动作有效
          fx.push({ type: 'star', sid: p.sid });
          break;
        case 'compact':
          if (this.hurt(p, 0.02, 'zap', null, fx)) p.tiny = 5;
          break;
        case 'prompt':
          this.drive(p, 0.04 * m, fx);
          fx.push({ type: 'boost', sid: p.sid, what: 'prompt' });
          break;
        case 'abort':
          this.hurt(p, 0.15, 'kick', null, fx, true);
          break;
        case 'apierr':
          this.hurt(p, 0.03, 'signal', null, fx);
          break;
        case 'pr':
          this.drive(p, 0.5 * m, fx);
          fx.push({ type: 'boost', sid: p.sid, what: 'dash' });
          break;
      }
    }
    if (act || ev.k === 'done') {
      if (p.star > 0) p.star--;
      if (p.tiny > 0 && ev.k !== 'compact') p.tiny--;
    }
  }

  /** 绿龟壳：砸正前方那辆；自己领跑就往后扔。直线飞，经常撞墙弹飞。 */
  green(p, r, fx) {
    const order = this.standings();
    const i = order.indexOf(p);
    const t = i > 0 ? order[i - 1] : order[i + 1];
    if (!t) return;
    const hit = r() < 0.65;
    fx.push({ type: 'green', from: p.sid, to: t.sid, hit, back: i === 0 });
    if (hit) this.hurt(t, 0.05, 'green', p, fx);
  }

  /** 蓝龟壳：直奔第一名，管你是不是自己人，甚至是不是自己。 */
  blue(p, fx) {
    const lead = this.top();
    if (!lead) return;
    this.sinceBlue = 0;
    const both = this.field('claude').length && this.field('codex').length;
    const self = lead === p;
    const mate = !self && both && lead.team === p.team;
    fx.push({ type: 'blue', from: p.sid, to: lead.sid, self, mate });
    if (self) fx.push({ type: 'note', text: L('💙 {0} 自己领跑还放蓝龟壳……炸到了自己', '💙 {0} fired a Blue Shell from first place… and blew up themselves'), sids: [p.sid] });
    else if (mate) fx.push({ type: 'note', text: L('💙 蓝龟壳不认队友：{0} 炸飞了自家领跑的 {1}', '💙 Blue Shell has no friends: {0} blew up teammate {1} in first'), sids: [p.sid, lead.sid] });
    else fx.push({ type: 'note', text: L('💙 {0} 的蓝龟壳炸飞了领跑的 {1}', "💙 {0}'s Blue Shell blew up the leader {1}"), sids: [p.sid, lead.sid] });
    const near = this.field().filter((q) => q !== lead && lead.prog - q.prog < 0.04 && q.prog <= lead.prog);
    this.hurt(lead, 0.12, 'blue', self ? null : p, fx);
    for (const q of near) this.hurt(q, 0.05, 'blue', q === p ? null : p, fx);
  }

  // 它在等你：停在路边，及时回它就重新上路，超时被拖车拖走
  onWait(p, fx) {
    p.parked = true;
    fx.push({ type: 'park', sid: p.sid });
  }

  onAnswer(p, wait, fx) {
    p.parked = false;
    this.drive(p, 0.03 * this.mult(p), fx);
    fx.push({ type: 'boost', sid: p.sid, what: 'resume' });
  }

  onWaitTimeout(p, fx) {
    p.parked = false;
    this.hurt(p, 0.3, 'tow', null, fx, true);
  }

  /** 比赛超时的那一刻：时钟准点停下来判名次，和推进频率无关。 */
  timers() {
    return [this.roundStart + this.raceLen];
  }

  onTick(fx) {
    if (this.now - this.roundStart < this.raceLen) return;
    const lead = this.top();
    if (lead && lead.prog > 0) this.finish(lead, fx, L('时间到 · 按名次判', 'Time up · decided by position'));
    else this.roundStart = this.now;
  }

  check(fx) {
    const lead = this.top();
    if (lead && lead.prog >= this.laps) this.finish(lead, fx);
  }

  finish(p, fx, why = '') {
    const order = this.standings();
    order.forEach((q, i) => (q.gp += POINTS[i] || 0));
    p.wins++;
    this.podium = order.slice(0, 3).map((q) => q.sid);
    fx.push({ type: 'finish', sid: p.sid, order: order.map((q) => ({ sid: q.sid, prog: q.prog })) });
    const crossed = L(`${p.name} 冲线！`, `${p.name} crosses the line!`);
    fx.push({ type: 'announce', text: `🏁 ${crossed}`, sub: order.slice(1, 3).map((q, i) => `${i + 2}. ${q.name}`).join('   '), cls: p.team, ms: 2600 });
    this.endRound(p.team, why ? 'time' : 'finish', fx, why || crossed);
  }
}

// ================================================================ 赛道：一条闭合的样条曲线

const { w: W, h: H } = WORLD;
const TAU = Math.PI * 2;
const TW = 84; // 路面宽
const CP = [
  [640, 852], [900, 856], [1180, 842], [1400, 795], [1515, 680], [1530, 530], [1490, 385], [1505, 235],
  [1430, 112], [1295, 98], [1215, 190], [1225, 330], [1165, 450], [1040, 505], [905, 455], [850, 325],
  [760, 205], [620, 140], [470, 168], [395, 285], [450, 415], [600, 495], [640, 615], [520, 690],
  [345, 650], [222, 718], [245, 818], [400, 858],
];

// Catmull-Rom 样条采样成折线，记下每个点到起点的累计长度
const PTS = [];
for (let i = 0; i < CP.length; i++) {
  const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((k) => CP[(i + k + CP.length) % CP.length]);
  for (let j = 0; j < 24; j++) {
    const t = j / 24;
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    PTS.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
  }
}
const CUM = [0];
for (let i = 1; i <= PTS.length; i++) {
  const [a, b] = [PTS[i - 1], PTS[i % PTS.length]];
  CUM.push(CUM[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
}
const LEN = CUM[PTS.length];

/** 赛道上距起点 s 像素处的位置和朝向。 */
function posAt(s) {
  s = ((s % LEN) + LEN) % LEN;
  let [lo, hi] = [0, PTS.length];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (CUM[mid] <= s) lo = mid;
    else hi = mid;
  }
  const [a, b] = [PTS[lo], PTS[(lo + 1) % PTS.length]];
  const k = (s - CUM[lo]) / (CUM[lo + 1] - CUM[lo] || 1);
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** 弯道程度：前后两点的朝向差（正负是左右弯）。 */
function curveAt(s) {
  let d = posAt(s + 30).a - posAt(s - 30).a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** 赛道上 s 处、往侧面偏 lane 像素的位置。 */
function offset(s, lane) {
  const p = posAt(s);
  return { x: p.x - Math.sin(p.a) * lane, y: p.y + Math.cos(p.a) * lane, a: p.a };
}

const nearTrack = (x, y, d) => PTS.some(([px, py], i) => i % 3 === 0 && (px - x) ** 2 + (py - y) ** 2 < d * d);
const BOXES = []; // 道具箱：四排，每排四个
for (const f of [0.13, 0.4, 0.63, 0.86]) for (const lane of [-27, -9, 9, 27]) BOXES.push({ ...offset(f * LEN, lane), hide: 0 });
const PANEL = { x: 14, y: 14, w: 300 }; // 左上角名次表，赛道和树都绕开它

const disc = (g, x, y, r, color) => {
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
};

function drawTrack() {
  const c = document.createElement('canvas');
  [c.width, c.height] = [W * 2, H * 2];
  const g = c.getContext('2d');
  g.scale(2, 2);
  const r = rng(7);
  // 草地 + 剪草条纹、中间的小湖、发夹弯外侧的砂石缓冲区
  g.fillStyle = '#5aa845';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = -H; x < W; x += 90) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 45, 0); g.lineTo(x + 45 + H, H); g.lineTo(x + H, H); g.fill();
  }
  g.fillStyle = '#3d8fc9';
  g.beginPath(); g.ellipse(1010, 690, 120, 60, -0.1, 0, TAU); g.fill();
  [g.strokeStyle, g.lineWidth] = ['#e9dcae', 6];
  g.stroke();
  g.fillStyle = '#d9c48f';
  g.beginPath(); g.ellipse(1400, 60, 150, 40, 0, 0, TAU); g.fill();
  // 路肩（红白相间）→ 柏油路面 → 白边线
  g.lineJoin = 'round';
  g.beginPath();
  for (const [x, y] of PTS) g.lineTo(x, y);
  g.closePath();
  for (const [col, w, dash] of [['#f4f4f4', TW + 18, []], ['#d83a2e', TW + 18, [16, 16]], ['#45474c', TW, []], ['#4e5056', TW - 14, []]]) {
    [g.strokeStyle, g.lineWidth] = [col, w];
    g.setLineDash(dash);
    g.stroke();
  }
  g.setLineDash([]);
  [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.55)', 2];
  for (const side of [-1, 1]) {
    g.beginPath();
    for (let s = 0; s <= LEN; s += 8) {
      const p = offset(s, side * (TW / 2 - 4));
      g.lineTo(p.x, p.y);
    }
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 2500; i++) {
    const p = offset(r() * LEN, (r() - 0.5) * (TW - 8));
    g.fillRect(p.x, p.y, 1.5, 1.5);
  }
  // 起点 / 终点格子线 + 发车格
  const st = posAt(0);
  g.save(); g.translate(st.x, st.y); g.rotate(st.a);
  const sq = TW / 8;
  for (let i = 0; i < 16; i++) {
    g.fillStyle = (i + (i >> 3)) % 2 ? '#111' : '#fff';
    g.fillRect(-sq + (i >> 3) * sq, -TW / 2 + (i % 8) * sq, sq, sq);
  }
  [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.7)', 2];
  for (let k = 0; k < 6; k++) {
    const [x, y] = [-24 - k * 34, k % 2 ? 18 : -18];
    g.beginPath(); g.moveTo(x + 8, y - 10); g.lineTo(x - 6, y - 10); g.lineTo(x - 6, y + 10); g.lineTo(x + 8, y + 10); g.stroke();
  }
  g.restore();
  // 看台和观众
  g.fillStyle = '#8a8d94';
  g.fillRect(700, 912, 460, 44);
  for (let i = 0; i < 160; i++) disc(g, 706 + r() * 448, 918 + r() * 34, 3, `hsl(${Math.floor(r() * 360)},70%,${55 + r() * 20}%)`);
  // 树（躲开赛道、湖、看台和名次表）
  for (let i = 0; i < 260; i++) {
    const [x, y, s, dark] = [r() * W, r() * H, 9 + r() * 8, r() < 0.5];
    if (nearTrack(x, y, TW / 2 + 34) || (x < PANEL.x + PANEL.w + 20 && y < 340)) continue;
    if ((x - 1010) ** 2 / 140 ** 2 + (y - 690) ** 2 / 80 ** 2 < 1 || (y > 900 && x > 690 && x < 1170)) continue;
    disc(g, x + 4, y + 5, s, 'rgba(20,50,10,0.3)');
    disc(g, x, y, s, dark ? '#2f7a2a' : '#3a8a31');
    disc(g, x - s / 3, y - s / 3, s / 2.4, 'rgba(190,240,140,0.3)');
  }
  // 绿色水管、轮胎墙
  for (const [x, y] of [[760, 700], [300, 420], [1340, 430]]) {
    disc(g, x + 4, y + 5, 22, 'rgba(0,0,0,0.25)');
    disc(g, x, y, 22, '#2fae3a');
    [g.strokeStyle, g.lineWidth] = ['#1b6e22', 4];
    g.stroke();
    disc(g, x, y, 14, '#0d3d12');
  }
  for (let i = 0; i < 9; i++) {
    disc(g, 1500 - i * 22, 30 + Math.sin(i * 0.6) * 6, 9, '#222');
    [g.strokeStyle, g.lineWidth] = [i % 2 ? '#d83a2e' : '#eee', 3];
    g.stroke();
  }
  return c;
}

// ================================================================ 画面

const LANES = [-22, 0, 22, -11, 11, -30, 30, -4, 4, -16, 16, 26];
// 加速的飘字：what → [文字, 颜色]（写成函数，显示的时候才按当前语言取）
const BOOST = {
  mushroom: () => [L('🍄 蘑菇加速', '🍄 Mushroom!'), '#ff7a6b'],
  gold: () => [L('🍄 金蘑菇', '🍄 Golden Mushroom'), '#ffd75a'],
  rocket: () => [L('🚀 火箭炮弹', '🚀 Bullet Bill!'), '#ffb35a'],
  prompt: () => [L('💬 油门踩到底', '💬 Pedal to the metal'), '#a8d4ff'],
  dash: () => [L('🏆 直接冲刺！', '🏆 Straight to the front!'), '#ffd75a'],
  resume: () => [L('🏎️ 重新上路', '🏎️ Back on the road'), '#9fe07a'],
};
// 被打中的飘字：what → [文字, 颜色]
const OUCH = {
  banana: () => [L('🍌 踩到香蕉', '🍌 Slipped on a Banana'), '#ffe45a'],
  green: () => [L('🟢 被绿龟壳砸中', '🟢 Hit by a Green Shell'), '#8fe08f'],
  blue: () => [L('💥 被蓝龟壳炸飞', '💥 Blue Shelled!'), '#9cc6ff'],
  zap: () => [L('⚡ 被闪电劈中，缩小了', '⚡ Lightning! Shrunk'), '#fff38a'],
  kick: () => [L('🦶 被你一脚踢出赛道', '🦶 You kicked it off the track'), '#fff'],
  tow: () => [L('🚛 被拖车拖走了', '🚛 Towed away'), '#ff9a8a'],
  signal: () => [L('📡 信号丢失，原地打转', '📡 Lost signal, spun out'), '#ff9a8a'],
};

class Kart {
  constructor(sid, team, disp, slot) {
    Object.assign(this, { sid, team, disp, slot, x: 0, y: 0, a: 0, curve: 0, speed: 0, drift: 0, park: 0 });
    Object.assign(this, { spin: 0, boost: 0, rocket: 0, kick: 0, hold: 0 }); // 各种特效还剩几秒
    this.label = null;
    this.icon = null;
    this.goal = null; // 一场结束后的定格进度（冠军冲过终点线）
  }

  update(dt, p, frozen) {
    for (const k of ['spin', 'boost', 'rocket', 'kick', 'hold']) this[k] = Math.max(0, this[k] - dt);
    if (this.label && (this.label.life -= dt) <= 0) this.label = null;
    if (this.icon && (this.icon.life -= dt) <= 0) this.icon = null;
    this.park += ((p.parked ? 1 : 0) - this.park) * Math.min(1, dt * 4);
    // 平滑追上规则层的进度；倒退（被打中）的时候退得快
    const before = this.disp;
    const target = frozen ? this.goal : this.hold > 0 ? null : p.prog;
    if (target != null) {
      const diff = target - this.disp;
      if (Math.abs(diff) > 2) this.disp = target;
      else if (diff > 0) this.disp += Math.max(diff * (1 - Math.exp(-dt * 2.2)), Math.min(diff, 0.02 * dt));
      else this.disp += diff * Math.min(1, dt * 4);
    }
    this.speed = ((this.disp - before) * LEN) / Math.max(dt, 1e-3);
    // 刚发车时在发车格里两列排开，开出去之后各走各的车道
    const grid = clamp((this.disp * LEN) / 220, 0, 1);
    const s = this.disp * LEN - (Math.floor(this.slot / 2) * 34 + 24) * (1 - grid);
    const lane = (this.slot % 2 ? 18 : -18) * (1 - grid) + LANES[this.slot % LANES.length] * grid;
    Object.assign(this, offset(s, lane + this.park * (TW / 2 + 26 - lane) + this.kick * 70));
    this.curve = curveAt(s);
    this.drift = this.speed > 25 && Math.abs(this.curve) > 0.3 ? this.drift + dt : 0;
  }
}

let trackLayer = null;

export class View {
  constructor(app) {
    this.app = app;
    trackLayer ||= drawTrack();
    this.fx = new Particles();
    this.karts = new Map();
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    this.karts.clear();
    Object.assign(this, { shells: [], peels: [], zap: 0, bolt: null, countdown: 0, resetAt: 0, podium: null, winner: null });
    if (R) for (const p of R.field()) this.kart(R, p.sid);
  }

  kart(R, sid) {
    let k = this.karts.get(sid);
    const p = R.players.get(sid);
    if (!k && p && p.onField) {
      const used = new Set([...this.karts.values()].map((q) => q.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      k = new Kart(sid, p.team, p.prog, slot);
      this.karts.set(sid, k);
    }
    return k;
  }

  /** 新一场：所有车回到发车格，红灯倒数。 */
  grid(R, busy) {
    Object.assign(this, { podium: null, winner: null, peels: [], shells: [], countdown: busy ? 0 : 2.4 });
    for (const [sid] of this.karts) if (!R.players.get(sid)?.onField) this.karts.delete(sid);
    R.field().forEach((p, i) => Object.assign(this.kart(R, p.sid), { slot: i, disp: p.prog, goal: null }));
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    for (const f of list) {
      const k = f.sid ? this.kart(R, f.sid) : null;
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (k && text && !(busy && f.ev.k === 'read')) k.label = { text, ok: f.ev.ok !== false, life: 1.7 };
          break;
        }
        case 'bench': this.karts.delete(f.sid); break;
        case 'grid': if (!this.resetAt) this.grid(R, busy); break;
        case 'boost': if (k) this.boost(k, f.what, busy); break;
        case 'spin': if (k) this.spin(k, f); break;
        case 'lap':
          if (k && !busy) fx.text(k.x, k.y - 30, L(`第 ${f.lap} 圈`, `Lap ${f.lap}`), '#fff', 15, 1.3);
          break;
        case 'coin':
          if (!k || busy) break;
          fx.text(k.x + 14, k.y - 22, '🪙', '#ffd75a', 13, 0.8);
          if (!app.sfx.ok(0)) break;
          app.sfx.tone(988, 0.07, 0.06, 'square'); // 吃金币的「叮~」
          app.sfx.tone(1319, 0.2, 0.06, 'square', null, 0.07);
          break;
        case 'star':
          if (!k) break;
          fx.text(k.x, k.y - 30, L('⭐ 无敌星', '⭐ Star power!'), '#ffe45a', 16, 1.4);
          fx.sparks(k.x, k.y, '#ffe45a', 14, 180);
          if (app.sfx.ok(2)) [784, 988, 1175, 1568].forEach((h, i) => app.sfx.tone(h, 0.1, 0.07, 'square', null, i * 0.07));
          break;
        case 'immune':
          if (k) fx.text(k.x, k.y - 30, L('⭐ 无敌，弹开了', '⭐ Invincible, bounced off'), '#ffe45a', 14, 1.2);
          break;
        case 'green':
        case 'blue': {
          const [from, to] = [this.kart(R, f.from), this.kart(R, f.to)];
          if (!from || !to) break;
          const dur = f.type === 'green' ? (busy ? 0.15 : 0.45) : busy ? 0.35 : 1.4;
          this.shells.push({ kind: f.type, from, to, x: from.x, y: from.y, s0: from.disp * LEN, t: 0, dur, hit: f.hit, self: f.self, booms: [] });
          if (f.type === 'green') break;
          to.hold = dur; // 蓝龟壳炸到之前先别倒退
          if (!busy) fx.text(from.x, from.y - 30, f.self ? L('💙 呃……', '💙 Uh-oh…') : L('💙 蓝龟壳！', '💙 Blue Shell!'), '#7fb6ff', 16, 1.3);
          if (app.sfx.ok(2)) app.sfx.tone(600, 0.6, 0.06, 'sine', 1200);
          break;
        }
        case 'park':
          if (k) k.icon = { text: '⏳', life: 999 };
          break;
        case 'waitDone':
        case 'waitLate':
          if (k && k.icon?.text === '⏳') k.icon = null;
          break;
        case 'finish': {
          // 冠军冲过终点线，其他车原地定格，显示领奖台
          this.winner = f.sid;
          this.podium = f.order.slice(0, 3).map((o) => o.sid);
          for (const q of this.karts.values()) q.goal = q.sid === f.sid ? R.laps : q.disp;
          if (k) fx.sparks(k.x, k.y, '#fff', 30, 260);
          break;
        }
        case 'roundEnd':
          this.resetAt = app.rt() + (busy ? 0.4 : 2.6);
          for (const q of this.karts.values()) if (q.goal == null) q.goal = q.disp;
          break;
      }
    }
  }

  boost(k, what, busy) {
    if (what === 'drift') {
      k.boost = Math.max(k.boost, 0.35); // 漂移小喷
      return;
    }
    if (what === 'rocket') k.rocket = busy ? 0.5 : 1.6;
    k.boost = Math.max(k.boost, what === 'dash' ? 1.6 : what === 'resume' ? 0.4 : 0.9);
    if (BOOST[what] && (!busy || what !== 'gold')) this.fx.text(k.x, k.y - 30, ...BOOST[what](), 15, 1.2);
    if (k.icon?.text === '⏳') k.icon = null;
    if (what !== 'prompt' && this.app.sfx.ok(1)) this.app.sfx.tone(300, 0.3, 0.06, 'sawtooth', 900);
  }

  spin(k, f) {
    const { fx, app } = this;
    const show = () => {
      k.spin = f.what === 'kick' ? 1.4 : 0.9;
      fx.text(k.x, k.y - 32, ...OUCH[f.what](), 15, 1.4);
      if (f.what === 'banana') {
        this.peels.push({ x: k.x + Math.cos(k.a) * 10, y: k.y + Math.sin(k.a) * 10, life: 5 });
        if (this.peels.length > 20) this.peels.shift();
      } else if (f.what === 'green') fx.sparks(k.x, k.y, '#5fd35f', 12, 180);
      else if (f.what === 'blue') {
        fx.explosion(k.x, k.y, true);
        fx.ring(k.x, k.y, 10, 130, 'rgba(90,150,255,0.95)', 0.7, 10);
        app.shake(0.4, 8);
        app.sfx.boom(true);
      } else if (f.what === 'zap') {
        [this.zap, this.bolt] = [0.5, { x: k.x, y: k.y }];
        if (app.sfx.ok(2)) app.sfx.burst(0.4, 3000, 0.4, 'highpass');
      } else if (f.what === 'kick') [k.kick, k.icon] = [1.4, { text: '☁️🎣', life: 2.2 }]; // 云上的钓鱼佬（Lakitu）把车钓回来
      else if (f.what === 'tow') k.icon = { text: '🚛', life: 2.2 };
    };
    // 龟壳还在天上飞：等它落地再炸（蓝龟壳的溅射也一起等）
    const sh = (f.what === 'blue' || f.what === 'green') && [...this.shells].reverse().find((s) => s.kind === f.what && !s.boomed && (f.what === 'blue' || s.to === k));
    if (sh) sh.booms.push(show);
    else show();
  }

  update(dt, R) {
    const frozen = !!this.resetAt;
    this.countdown = Math.max(0, this.countdown - dt);
    this.zap = Math.max(0, this.zap - dt);
    for (const k of this.karts.values()) {
      const p = R.players.get(k.sid);
      if (!p) continue;
      k.update(dt, p, frozen);
      // 漂移火花：蓝 → 橙 → 紫，漂得越久越高级
      if (k.drift > 0.1 && Math.random() < dt * 30) {
        const side = k.curve > 0 ? -1 : 1;
        this.fx.sparks(k.x - Math.cos(k.a) * 12 - Math.sin(k.a) * 8 * side, k.y - Math.sin(k.a) * 12 + Math.cos(k.a) * 8 * side,
          k.drift > 1.2 ? '#d07bff' : k.drift > 0.6 ? '#ffa94d' : '#6fc3ff', 1, 70);
      }
      if ((k.boost > 0 || k.rocket > 0) && Math.random() < dt * 25) this.fx.sparks(k.x - Math.cos(k.a) * 18, k.y - Math.sin(k.a) * 18, '#ffb347', 1, 50);
      for (const b of BOXES) if (!b.hide && (b.x - k.x) ** 2 + (b.y - k.y) ** 2 < 14 ** 2) b.hide = 1.5; // 开过去撞碎道具箱
    }
    for (const b of BOXES) b.hide = Math.max(0, b.hide - dt);
    for (const s of this.shells) {
      if ((s.t += dt) < s.dur || s.boomed) continue;
      s.boomed = true;
      for (const fn of s.booms) fn();
      if (s.kind === 'green' && !s.hit) this.fx.text(s.x, s.y - 16, L('撞墙弹飞了', 'Bounced off the wall'), '#ccc', 12, 0.9);
    }
    this.shells = this.shells.filter((s) => s.t < s.dur + 0.05);
    for (const pl of this.peels) pl.life -= dt;
    this.peels = this.peels.filter((pl) => pl.life > 0);
    this.fx.update(dt);
    if (this.resetAt && this.app.rt() >= this.resetAt) {
      this.resetAt = 0;
      this.grid(R, false);
    }
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(trackLayer, 0, 0, W, H);
    BOXES.forEach((b, i) => this.drawBox(g, b, i, rt));
    for (const pl of this.peels) emoji(g, '🍌', pl.x, pl.y, 16);
    this.fx.renderUnder(g);
    const ks = [...this.karts.values()].filter((k) => R.players.get(k.sid)).sort((a, b) => a.y - b.y);
    for (const k of ks) this.drawKart(g, k, R.players.get(k.sid), rt);
    for (const s of this.shells) this.drawShell(g, s, rt);
    this.fx.renderOver(g, scale);
    if (this.zap > 0 && this.bolt) {
      // 闪电：全屏一白，一道折线劈下来
      g.fillStyle = `rgba(255,255,240,${this.zap * 0.9})`;
      g.fillRect(0, 0, W, H);
      [g.strokeStyle, g.lineWidth] = ['#fff38a', 4];
      g.beginPath();
      for (let y = 0; y <= this.bolt.y; y += 40) g.lineTo(this.bolt.x + (y + 40 > this.bolt.y ? 0 : rand(-18, 18)), y);
      g.lineTo(this.bolt.x, this.bolt.y);
      g.stroke();
    }
    const fs = fontFor(scale);
    const live = this.app.mode === 'live';
    for (const k of ks) {
      const p = R.players.get(k.sid);
      this.drawTags(g, k, p, R.now - p.lastActive < (live ? 60e3 : 90e3), fs, rt);
    }
    if (this.countdown > 0) this.drawLights(g, this.countdown);
    this.drawPanel(g, R, fs);
    if (this.podium && this.resetAt) this.drawPodium(g, R, fs);
  }

  /** 彩虹问号道具箱，转着圈上下浮动。 */
  drawBox(g, b, i, rt) {
    if (b.hide > 0) return;
    g.save(); g.translate(b.x, b.y + Math.sin(rt * 3 + i) * 1.5); g.rotate(rt * 1.2 + i);
    [g.fillStyle, g.strokeStyle, g.lineWidth] = [`hsla(${(rt * 140 + i * 25) % 360},90%,62%,0.92)`, 'rgba(255,255,255,0.9)', 1.5];
    g.beginPath(); g.roundRect(-7, -7, 14, 14, 3); g.fill(); g.stroke();
    g.rotate(-(rt * 1.2 + i));
    [g.fillStyle, g.font, g.textAlign, g.textBaseline] = ['#fff', `900 11px ${FONT}`, 'center', 'middle'];
    g.fillText('?', 0, 0.5);
    g.restore();
  }

  /** 俯视的卡丁车：四个轮子、队色车身、戴队色帽子的小车手。 */
  drawKart(g, k, p, rt) {
    const s = p.tiny > 0 ? 0.6 : 1;
    g.save();
    g.translate(k.x, k.y);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.ellipse(3, 5, 19 * s, 12 * s, k.a, 0, TAU); g.fill();
    if (p.star > 0) disc(g, 0, 0, 26 * s, `hsla(${(rt * 600) % 360},100%,60%,0.55)`); // 无敌星：彩虹光
    g.rotate(k.a + k.spin * 12 + k.kick * 6);
    g.scale(s, s);
    if (k.rocket > 0) {
      // 火箭炮弹：黑色子弹头，白眼睛
      g.fillStyle = '#1b1b1f';
      g.beginPath(); g.moveTo(-20, -11); g.lineTo(8, -11); g.quadraticCurveTo(24, 0, 8, 11); g.lineTo(-20, 11); g.fill();
      disc(g, 4, -5, 3.5, '#fff');
      disc(g, 4, 5, 3.5, '#fff');
      g.fillStyle = '#d83a2e';
      g.fillRect(-20, -11, 4, 22);
    } else {
      if (k.boost > 0) {
        g.fillStyle = `rgba(255,${150 + Math.floor(Math.random() * 80)},60,0.9)`; // 尾焰
        g.beginPath(); g.moveTo(-15, -6); g.lineTo(-30 - Math.random() * 10, 0); g.lineTo(-15, 6); g.fill();
      }
      g.fillStyle = '#18181b';
      for (const [wx, wy] of [[-10, -10], [9, -10], [-10, 10], [9, 10]]) {
        g.beginPath(); g.roundRect(wx - 5, wy - 3.5, 10, 7, 2); g.fill();
      }
      [g.fillStyle, g.strokeStyle, g.lineWidth] = [COLOR[k.team], DEEP[k.team], 2];
      g.beginPath(); g.roundRect(-15, -8, 30, 16, 6); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(4, -6, 9, 12);
      g.fillStyle = '#2a2a2e';
      g.fillRect(12, -9, 4, 18); // 前保险杠
      disc(g, -3, 0, 5.5, '#f2c9a0');
      g.beginPath(); g.arc(-4, 0, 5.5, Math.PI * 0.55, Math.PI * 1.45); g.fillStyle = DEEP[k.team]; g.fill();
      g.fillRect(-1, -2.5, 5, 5); // 帽檐
      [g.fillStyle, g.font, g.textAlign, g.textBaseline] = ['#fff', `900 6px ${FONT}`, 'center', 'middle'];
      g.fillText(k.team === 'claude' ? 'C' : 'X', -5.5, 0.5);
    }
    g.restore();
    if (p.parked && Math.floor(rt * 3) % 2 === 0) disc(g, k.x - Math.cos(k.a) * 14, k.y - Math.sin(k.a) * 14, 3, '#ffb000'); // 双闪
    if (this.winner === k.sid && this.resetAt) emoji(g, '🏁', k.x + 18, k.y - 22 - Math.abs(Math.sin(rt * 5)) * 6, 26);
  }

  drawShell(g, s, rt) {
    const k = Math.min(1, s.t / s.dur);
    if (s.kind === 'green') {
      // 绿龟壳：直线飞过去，没打中就斜着撞墙
      let [tx, ty] = [s.to.x, s.to.y];
      if (!s.hit) {
        const a = Math.atan2(ty - s.from.y, tx - s.from.x) + 0.7;
        [tx, ty] = [s.from.x + Math.cos(a) * 90, s.from.y + Math.sin(a) * 90];
      }
      [s.x, s.y] = [s.from.x + (tx - s.from.x) * k, s.from.y + (ty - s.from.y) * k];
      this.shellIcon(g, s.x, s.y, '#3fbf3f', rt);
      return;
    }
    // 蓝龟壳：沿着赛道飞到第一名头上，悬停一下再砸下去
    let s1 = s.to.disp * LEN;
    if (s1 < s.s0 && !s.self) s1 += LEN;
    const p = k < 0.75 && !s.self ? posAt(s.s0 + (s1 - s.s0) * (k / 0.75)) : s.to;
    const y = p.y - (k < 0.75 ? 40 : 40 * (1 - (k - 0.75) / 0.25));
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(p.x, p.y, 8, 4, 0, 0, TAU); g.fill();
    const flap = Math.sin(rt * 30) * 5;
    [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.9)', 2];
    g.beginPath(); g.moveTo(p.x - 6, y); g.lineTo(p.x - 18, y - 8 - flap); g.moveTo(p.x + 6, y); g.lineTo(p.x + 18, y - 8 - flap); g.stroke(); // 翅膀
    disc(g, p.x, y, 16, 'rgba(90,150,255,0.35)');
    this.shellIcon(g, p.x, y, '#2f6fe0', rt);
  }

  shellIcon(g, x, y, color, rt) {
    disc(g, x, y, 8, color);
    [g.strokeStyle, g.lineWidth] = ['#fff', 2];
    g.stroke();
    [g.strokeStyle, g.lineWidth] = ['rgba(255,255,255,0.7)', 1.2];
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rt * 8;
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
    }
    g.stroke();
  }

  drawTags(g, k, p, active, fs, rt) {
    const y = k.y - 26;
    pill(g, k.x, y, p.name, { color: COLOR[k.team], size: fs, max: 120 });
    if (k.label) {
      g.globalAlpha = Math.min(1, k.label.life / 0.4);
      pill(g, k.x, y - fs - 8 - (1.7 - k.label.life) * 6, k.label.text, {
        size: fs - 1, max: 190, weight: 500, bg: k.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)',
      });
    }
    if (!active && !p.parked) {
      [g.fillStyle, g.font] = ['rgba(255,255,255,0.8)', `700 ${fs}px sans-serif`];
      const t = (rt * 0.6 + k.x) % 1;
      g.globalAlpha = 1 - t;
      g.fillText('z', k.x + 16 + t * 8, k.y - 10 - t * 18);
    }
    g.globalAlpha = 1;
    if (k.icon) emoji(g, k.icon.text, k.x, k.y - 52, fs + 10);
  }

  /** 发车红绿灯：挂在云上，三盏红灯依次亮，然后 GO！ */
  drawLights(g, t) {
    const st = posAt(0);
    const [x, y] = [st.x + 40, st.y - 110];
    emoji(g, '☁️', x - 6, y + 6, 54);
    g.fillStyle = '#222';
    g.beginPath(); g.roundRect(x - 40, y - 14, 80, 28, 8); g.fill();
    const lit = t > 1.8 ? 1 : t > 1.2 ? 2 : t > 0.6 ? 3 : 4;
    for (let i = 0; i < 3; i++) disc(g, x - 24 + i * 24, y, 9, lit === 4 ? '#3fe05a' : i < lit ? '#ff3b30' : '#4a1a18');
    if (lit < 4) return;
    [g.font, g.textAlign, g.lineWidth, g.strokeStyle, g.fillStyle] = [`900 28px ${FONT}`, 'center', 5, 'rgba(0,0,0,0.6)', '#3fe05a'];
    g.strokeText('GO!', x, y + 40);
    g.fillText('GO!', x, y + 40);
  }

  /** 左上角名次表：名次、名字、圈数、金币、状态。 */
  drawPanel(g, R, fs) {
    const order = R.standings();
    if (!order.length) return;
    const rowH = fs * 1.75;
    const { x, y, w } = PANEL;
    g.fillStyle = 'rgba(10,12,16,0.62)';
    g.beginPath(); g.roundRect(x, y, w, rowH * (order.length + 1) + 10, 10); g.fill();
    [g.textBaseline, g.font, g.textAlign, g.fillStyle] = ['middle', `800 ${fs}px ${FONT}`, 'left', '#fff'];
    const title = R.phase === 'live' ? L(`🏁 名次  共 ${R.laps} 圈`, `🏁 Standings  ${R.laps} laps`) : L('🏁 名次  热身中', '🏁 Standings  warm-up');
    g.fillText(title, x + 12, y + rowH / 2 + 5);
    order.forEach((p, i) => {
      const yy = y + rowH * (i + 1.5) + 5;
      [g.font, g.textAlign, g.fillStyle] = [`italic 900 ${fs + 1}px ${FONT}`, 'left', ['#ffd75a', '#d9dde3', '#e0a065'][i] || '#9aa0a8'];
      g.fillText(['1st', '2nd', '3rd'][i] || `${i + 1}th`, x + 10, yy);
      [g.font, g.fillStyle] = [`700 ${fs}px ${FONT}`, COLOR[p.team]];
      let name = p.name;
      while (name.length > 1 && g.measureText(name).width > w - 160) name = name.slice(0, -1);
      g.fillText(name === p.name ? name : `${name}…`, x + 52, yy);
      const st = p.parked ? '⏳' : p.star > 0 ? '⭐' : p.tiny > 0 ? '⚡' : '';
      [g.textAlign, g.fillStyle] = ['right', '#fff'];
      const lap = Math.min(R.laps, Math.floor(p.prog) + 1);
      g.fillText(L(`${st} ${lap}/${R.laps}圈 🪙${p.coins}`, `${st} Lap ${lap}/${R.laps} 🪙${p.coins}`), x + w - 10, yy);
    });
  }

  drawPodium(g, R, fs) {
    const [cx, cy] = [1000, 690];
    g.fillStyle = 'rgba(10,12,16,0.72)';
    g.beginPath(); g.roundRect(cx - 160, cy - 70, 320, 140, 12); g.fill();
    [g.textAlign, g.textBaseline, g.font, g.fillStyle] = ['center', 'middle', `900 ${fs + 6}px ${FONT}`, '#ffd75a'];
    g.fillText(L('🏆 本场领奖台', '🏆 Podium'), cx, cy - 46);
    this.podium.forEach((sid, i) => {
      const p = R.players.get(sid);
      if (!p) return;
      [g.font, g.fillStyle] = [`700 ${fs + 1}px ${FONT}`, COLOR[p.team]];
      g.fillText(`${['🥇', '🥈', '🥉'][i]} ${p.name.slice(0, 14)}`, cx, cy - 12 + i * (fs + 12));
    });
  }

  hud(R) {
    const lead = R.phase === 'live' ? R.top() : null;
    if (!lead) return null;
    const lap = Math.min(R.laps, Math.floor(lead.prog) + 1);
    return { mid: L(`第 ${lap}/${R.laps} 圈`, `Lap ${lap}/${R.laps}`), sub: L(`领跑：${lead.name}`, `Leader: ${lead.name}`) };
  }
}
