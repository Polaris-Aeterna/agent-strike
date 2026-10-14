// 太鼓达人：每个动作是自己队鼓道上的一个音符。比的是节奏稳不稳，不是谁敲得多。
// 判定：这一拍和上一拍的间隔，跟本队最近的节奏（间隔取对数后的指数平均）比——稳 = 良，差一点 = 可，差太多 = 不可；
// 报错永远是不可。一阵挤在一起的动作不单独判定，变成连打 / 气球。
// 一首歌：一方打满 N 个音符（或时间到）就结束，比「平均每个音符的得分」，所以人多、动作多不占便宜。
import { Rules as Base, TEAMS, COLOR, DEEP, TEAM_NAME, ACTIONS, WORLD, clamp, hash, rng, actText } from '../core.js';
import { L } from '../i18n.js';
import { Particles, pill, fitText, fontFor, FONT } from '../fxkit.js';

export const meta = {
  id: 'taiko',
  icon: '🥁',
  get name() { return L('太鼓达人', 'Taiko Drum Master'); },
  get desc() { return L('每个动作是鼓道上的一个音符。比的是节奏稳不稳，不是谁敲得多', 'Every action is a note on your drum lane. Steady rhythm wins, not spam'); },
  get roundWord() { return L('首', 'song'); },
  get wait() {
    return {
      start: L('🥁 {a} 在等你回复', '🥁 {a} is waiting for you'),
      sub: L('鼓先停一拍：40 秒内回它，下一拍直接「良」', 'The drum holds the beat: reply within 40s for a free GOOD'),
      done: L('🥁 及时回复，鼓点接上了', '🥁 Back on the beat'),
      boom: L('💥 {a} 等太久了，一串「不可」', '💥 {a} waited too long: a string of BADs'),
    };
  },
  get legend() {
    return [
      [L('🔴 跑命令 / 改代码 / 派子代理', '🔴 Command / edit / subagent'), L('咚（红色音符）', 'Don (red note)')],
      [L('🔵 读文件 / 上网 / 其它工具', '🔵 Read / web / other tools'), L('咔（蓝色音符）', 'Ka (blue note)')],
      [L('🎯 测试通过 · ✅ 任务完成', '🎯 Tests pass · ✅ Task done'), L('大咚 / 大咔，双倍分', 'Big Don / Big Ka, double points')],
      [L('🎼 和本队最近的节奏比', '🎼 Compared with your team’s recent tempo'), L('稳 = 良，差一点 = 可，差太多 = 不可', 'Steady = GOOD, a bit off = OK, way off = BAD')],
      [L('🎵 新指令 / 休止符之后的第一拍', '🎵 First beat after a prompt or a long rest'), L('重新起拍，算「良」', 'Fresh downbeat: GOOD')],
      [L('🐛 报错', '🐛 Error'), L('不可，连击断掉', 'BAD, combo broken')],
      [L('🟡 一阵挤在一起的动作', '🟡 A rapid burst of actions'), L('连打每击 +10；子代理扎堆是🎈气球，打爆有奖励', 'Drumroll, +10 per hit; a subagent swarm is a 🎈 balloon — pop it for a bonus')],
      [L('💭 思考', '💭 Thinking'), L('蓄力：下一个「良」×1.5', 'Charge: next GOOD ×1.5')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('节奏乱了：下一拍降一级', 'Lost the beat: next note one grade worse')],
      [L('💬 收到新指令', '💬 New prompt'), L('加油！魂槽 +', 'Cheer! Soul gauge +')],
      [L('✋ 被打断', '✋ Interrupted'), L('你拔了鼓棒：连击清零，−200', 'You yanked the sticks: combo reset, −200')],
      [L('⏳ 它在等你', '⏳ Waiting on you'), L('鼓停一拍；超时 = 一串不可', 'The drum waits; timeout = a string of BADs')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('魂槽 MAX + 全连奖励 +300', 'Soul gauge MAX + bonus +300')],
      [L('🏁 一首歌', '🏁 A song'), L('一方打满音符或时间到；比平均每音符得分', 'Ends when a lane fills up or time runs out; best average per note wins')],
    ];
  },
};

// ================================================================ 数值

const ROLL_GAP = 1500; // 和本队上一击相隔不到 1.5 秒：算连打，不单独判定
const ROLL_CAP = 20; // 一段连打最多 20 击，再多就开下一段
const ROLL_PTS = 10; // 连打每击的分数
const ROLL_W = 0.12; // 连打每击算 0.12 个音符（平均分里的权重），扎堆刷不出高平均
const POP_PTS = 60; // 打爆气球的奖励
const TEMPO_K = 0.25; // 节奏的指数平均系数
const CHARGE = 1.5; // 蓄力后的「良」
const PTS = { good: 100, ok: 50, bad: 0 };
const GAUGE = { good: 0.06, ok: 0.02, bad: -0.08 };
const CLEAR = 0.8; // 魂槽合格线
const COMBO_TIERS = [10, 30, 50, 100]; // 连击到这些数，每个音符的分数再 +10%
const ABORT_PEN = 200;
const PR_PTS = 300;
const BIG_COOLDOWN = 120e3; // 「大咚！」大横幅的冷却（同一队）
const DON = new Set(['shell', 'edit', 'agent']);

const SONG_N = 16;
const songTitle = (i) => [
  L('千本樱（AI 混音）', 'Senbonzakura (AI remix)'), L('Bash 进行曲', 'Bash March'),
  L('天国与地狱（递归版）', 'Heaven and Hell (Recursive Ver.)'), L('红莲华（Segfault 混音）', 'Gurenge (Segfault Mix)'),
  L('野蜂飞舞（并行子代理）', 'Flight of the Subagents'), L('卡门序曲（git rebase -i）', 'Carmen Overture (git rebase -i)'),
  L('拉德斯基进行曲（CI 全绿）', 'Radetzky March (CI Green)'), L('小星星（无限循环）', 'Twinkle Twinkle Infinite Loop'),
  L('恋爱循环（while true）', 'Renai Circulation (while true)'), L('极乐净土（npm install 中）', 'Gokuraku Jodo (npm installing)'),
  L('卡农（无尽重构）', 'Canon in Refactor'), L('夏祭（上下文压缩版）', 'Natsu Matsuri (Compacted)'),
  L('最终鬼畜（测试全红）', 'Final Kichiku (All Tests Red)'), L('太鼓达人主题曲（Token 加量）', 'Taiko Theme (Extra Tokens)'),
  L('新宝岛（404 Not Found）', 'Shin Takarajima (404 Not Found)'), L('Merge Conflict 狂想曲', 'Merge Conflict Rhapsody'),
][((i % SONG_N) + SONG_N) % SONG_N];
const diffName = (d) => [L('简单', 'Easy'), L('普通', 'Normal'), L('困难', 'Hard'), L('魔王', 'Oni')][d] || '';
const judgeWord = (j) => ({ good: L('良', 'GOOD'), ok: L('可', 'OK'), bad: L('不可', 'BAD') })[j];

const songStats = () => ({ notes: 0, weight: 0, score: 0, goods: 0, oks: 0, bads: 0, rolls: 0, balloons: 0, gauge: 0 });
const avgOf = (ln) => (ln.weight ? ln.score / ln.weight : 0);
const fmtAvg = (x) => x.toFixed(1);

function newLane(team) {
  return { team, tempo: null, lastNote: null, last: null, fresh: false, charge: 0, shaky: 0, combo: 0, maxCombo: 0, roll: null, bigAt: -1e15, label: null, ...songStats() };
}

// ================================================================ 规则

export class Rules extends Base {
  static defaults = {
    // |ln 间隔 − 节奏| < goodD 是「良」（快慢 2.2 倍以内），< okD 是「可」（5 倍以内）；隔了 rest 以上算休止符
    goodD: 0.8, okD: 1.6, rest: 90e3,
    notes: 32, minNotes: 8, songLen: 8 * 60e3, fcMin: 15, balloon: 8, streak: 3,
    partyNotes: 12, partyMinNotes: 4, partySongLen: 4 * 60e3, partyFcMin: 10, partyBalloon: 5, partyStreak: 2,
  };

  init() {
    const o = this.opts;
    const pick = (k) => (o.party ? o[`party${k[0].toUpperCase()}${k.slice(1)}`] : o[k]);
    [this.target, this.minNotes, this.songLen, this.fcMin, this.balloonNeed, this.streak] = ['notes', 'minNotes', 'songLen', 'fcMin', 'balloon', 'streak'].map(pick);
    [this.songIdx, this.diff, this.stars] = [0, 0, 1];
    this.lanes = { claude: newLane('claude'), codex: newLane('codex') };
  }

  // 一首新歌：随机挑歌名和难度（只看回合数和开唱时刻，确定性的），这首歌的分数清零；连击和节奏接着上一首
  onRoundStart(fx) {
    const r = rng(hash(`taiko-song-${this.round}-${this.roundStart}`));
    this.songIdx = (this.songIdx + 1 + Math.floor(r() * (SONG_N - 1))) % SONG_N;
    this.diff = this.opts.party ? 3 : Math.floor(r() * 4);
    this.stars = [2, 4, 7, 9][this.diff] + Math.floor(r() * 2);
    for (const ln of Object.values(this.lanes)) {
      if (ln.roll) this.closeRoll(ln, fx);
      Object.assign(ln, songStats());
    }
    fx.push({ type: 'song', idx: this.songIdx, diff: this.diff, stars: this.stars, round: this.round });
  }

  onEvent(p, ev, r, fx) {
    const ln = this.lanes[p.team];
    if (['abort', 'apierr', 'pr'].includes(ev.k) && ln.roll) this.closeRoll(ln, fx);
    switch (ev.k) {
      case 'think':
        ln.charge = 1; // 蓄力（画面直接看规则状态；思考太频繁，不单独发效果）
        break;
      case 'compact':
        ln.shaky = 1;
        fx.push({ type: 'shaky', team: p.team, sid: p.sid });
        break;
      case 'prompt':
        ln.gauge = clamp(ln.gauge + 0.1, 0, 1);
        ln.fresh = true;
        fx.push({ type: 'cheer', team: p.team, why: 'prompt' });
        break;
      case 'abort':
        this.beat(p, ln, 'bad', { drum: 'stick', pts: -ABORT_PEN, gauge: -0.3, why: 'abort', ev }, fx);
        ln.fresh = true;
        fx.push({ type: 'note', text: L(`✋ 你拔了 {0} 的鼓棒：连击清零，−${ABORT_PEN}`, `✋ You yanked {0}’s drumsticks: combo reset, −${ABORT_PEN}`), sids: [p.sid] });
        break;
      case 'apierr':
        this.beat(p, ln, 'bad', { drum: 'don', why: 'net', ev }, fx);
        break;
      case 'pr':
        this.beat(p, ln, 'good', { drum: 'gold', big: true, pts: PR_PTS, gauge: 1, why: 'pr', ev }, fx);
        if (this.phase === 'live') fx.push({ type: 'announce', text: L('魂槽 MAX！', 'Soul Gauge MAX!'), sub: L(`${TEAM_NAME[p.team]} 提交 PR · 全连奖励 +${PR_PTS}`, `${TEAM_NAME[p.team]} opened a PR · bonus +${PR_PTS}`), cls: 'gold', ms: 1800 });
        break;
      default:
        // 任务完成 / 测试通过 = 大音符
        if (ACTIONS.has(ev.k) || ev.k === 'done') this.hit(p, ln, ev, fx, ev.k === 'done' || (ev.k === 'shell' && !!ev.hs));
    }
  }

  /** 一个动作打到鼓上：挤在上一击后面就是连打，否则按节奏判定。 */
  hit(p, ln, ev, fx, big) {
    const t = ev.t;
    const bad = ev.ok === false;
    if (ln.roll && t - ln.roll.last >= ROLL_GAP) this.closeRoll(ln, fx);
    if (!big && !bad && !ln.fresh && ln.last != null && t - ln.last < ROLL_GAP) return this.rollHit(p, ln, ev, fx);
    if (ln.roll) this.closeRoll(ln, fx);
    const gap = ln.lastNote == null ? null : t - ln.lastNote;
    const rest = gap == null || ln.tempo == null || gap > this.opts.rest;
    let judge;
    if (bad) judge = 'bad';
    else if (ln.fresh || rest) judge = 'good'; // 新指令 / 你刚回复 / 休止符之后：重新起拍，稳稳落在拍子上
    else if (big && gap < ROLL_GAP) judge = 'good'; // 大音符很好打：紧跟着上一拍也算良
    else {
      const d = Math.abs(Math.log(Math.max(1, gap)) - ln.tempo);
      judge = d < this.opts.goodD ? 'good' : d < this.opts.okD ? 'ok' : 'bad';
    }
    if (ln.shaky && judge !== 'bad') judge = judge === 'good' ? 'ok' : 'bad'; // 上下文压缩：节奏乱了，降一级
    ln.shaky = 0;
    if (gap != null && !ln.fresh && gap <= this.opts.rest) {
      const lg = Math.log(clamp(gap, ROLL_GAP, this.opts.rest));
      ln.tempo = ln.tempo == null ? lg : ln.tempo + (lg - ln.tempo) * TEMPO_K;
    }
    ln.fresh = false;
    ln.lastNote = ln.last = t;
    const why = bad ? 'err' : big ? (ev.k === 'done' ? 'done' : 'hs') : null;
    this.beat(p, ln, judge, { drum: DON.has(ev.k) ? 'don' : 'ka', big, why, ev }, fx);
  }

  /** 记一个判定过的音符：连击、分数、魂槽。o.pts / o.gauge 可以直接指定（PR、拔鼓棒）。 */
  beat(p, ln, judge, o, fx) {
    const live = this.phase === 'live';
    if (judge === 'bad') ln.combo = 0;
    else ln.maxCombo = Math.max(ln.maxCombo, ++ln.combo);
    const charged = judge === 'good' && ln.charge > 0 && o.pts == null;
    if (charged) ln.charge = 0;
    const mult = 1 + 0.1 * COMBO_TIERS.filter((c) => ln.combo >= c).length;
    const pts = o.pts ?? Math.round(PTS[judge] * (o.big ? 2 : 1) * (charged ? CHARGE : 1) * mult);
    [ln.score, ln.weight, ln.notes] = [Math.max(0, ln.score + pts), ln.weight + 1, ln.notes + 1];
    ln[`${judge}s`]++;
    ln.gauge = clamp(ln.gauge + (o.gauge ?? GAUGE[judge] * (o.big ? 1.5 : 1)), 0, 1);
    ln.label = { sid: p.sid, ev: o.ev || null };
    if (live) [p.dmg, p.k, p.hs] = [p.dmg + Math.max(0, pts), p.k + (judge === 'good'), p.hs + (judge === 'good' && !!o.big)];
    fx.push({
      type: 'beat', team: ln.team, sid: p.sid, ev: o.ev || null, drum: o.drum, big: !!o.big, judge, why: o.why || null, charged,
      combo: ln.combo, score: ln.score, notes: ln.notes, gauge: ln.gauge, avg: avgOf(ln),
    });
    if (!live || judge === 'bad') return;
    if (ln.combo === 50 || ln.combo % 100 === 0) {
      fx.push({ type: 'announce', text: L(`${ln.combo} 连击！`, `${ln.combo} Combo!`), sub: L(`${TEAM_NAME[ln.team]} 一拍都没断`, `${TEAM_NAME[ln.team]} hasn’t missed a beat`), cls: ln.team, ms: 1500 });
    }
    if (judge === 'good' && (o.why === 'hs' || o.why === 'done') && ln.last - ln.bigAt >= BIG_COOLDOWN) {
      ln.bigAt = ln.last;
      const text = o.drum === 'don' ? L('大咚！', 'BIG DON!') : L('大咔！', 'BIG KA!');
      const sub = o.why === 'hs' ? L(`${p.name} · 测试通过`, `${p.name} · tests pass`) : L(`${p.name} · 任务完成`, `${p.name} · task done`);
      fx.push({ type: 'announce', text, sub, cls: ln.team, ms: 1200 });
    }
  }

  /** 连打 / 气球：不判定、不算连击，每击 +10；气球打够次数就爆。 */
  rollHit(p, ln, ev, fx) {
    if (ln.roll && ln.roll.hits >= ROLL_CAP) this.closeRoll(ln, fx);
    if (!ln.roll) {
      ln.roll = { kind: ev.sub ? 'balloon' : 'roll', hits: 0, need: this.balloonNeed, popped: false, last: ev.t };
      ln.rolls++;
      fx.push({ type: 'rollStart', team: ln.team, kind: ln.roll.kind, need: ln.roll.need });
    }
    const r = ln.roll;
    r.hits++;
    r.last = ln.last = ev.t;
    [ln.score, ln.weight] = [ln.score + ROLL_PTS, ln.weight + ROLL_W];
    let pop = false;
    if (r.kind === 'balloon' && !r.popped && r.hits >= r.need) {
      r.popped = pop = true;
      ln.score += POP_PTS;
      ln.balloons++;
      if (this.phase === 'live') p.a++;
    }
    fx.push({ type: 'rollHit', team: ln.team, sid: p.sid, ev, hits: r.hits, pop, score: ln.score, avg: avgOf(ln) });
  }

  closeRoll(ln, fx) {
    fx.push({ type: 'rollEnd', team: ln.team });
    ln.roll = null;
  }

  // 它在等你：鼓先停一拍。及时回 = 下一拍直接「良」；超时 = 一串「不可」
  onWait(p, fx) {
    fx.push({ type: 'hold', team: p.team });
  }

  onAnswer(p, wait, fx) {
    const ln = this.lanes[p.team];
    ln.fresh = true;
    ln.gauge = clamp(ln.gauge + 0.05, 0, 1);
    fx.push({ type: 'cheer', team: p.team, why: 'answer' });
  }

  onWaitTimeout(p, fx) {
    const ln = this.lanes[p.team];
    if (ln.roll) this.closeRoll(ln, fx);
    for (let i = 0; i < this.streak; i++) this.beat(p, ln, 'bad', { drum: i % 2 ? 'ka' : 'don', pts: 0, why: 'timeout' }, fx);
    ln.fresh = true;
    fx.push({ type: 'note', text: L('⏳ {0} 等太久，鼓点断成一串「不可」', '⏳ {0} waited too long — a string of BADs'), sids: [p.sid] });
  }

  /** 定时器：这首歌的时间上限、还开着的连打什么时候收尾。 */
  timers() {
    const out = [this.roundStart + this.songLen];
    for (const ln of Object.values(this.lanes)) if (ln.roll) out.push(ln.roll.last + ROLL_GAP);
    return out;
  }

  onTick(fx) {
    for (const team of TEAMS) {
      const ln = this.lanes[team];
      if (ln.roll && this.now >= ln.roll.last + ROLL_GAP) this.closeRoll(ln, fx);
    }
    if (this.now < this.roundStart + this.songLen) return;
    if (this.lanes.claude.notes + this.lanes.codex.notes > 0) this.finish('time', fx);
    else this.roundStart = this.now; // 一个音符都没有：歌还没开始，重新计时
  }

  check(fx) {
    const [a, b] = TEAMS.map((t) => this.lanes[t].notes);
    const [hi, lo] = [Math.max(a, b), Math.min(a, b)];
    // 一方打满就收歌；对面音符太少（样本不够）再等等，最多等到打满两倍
    if ((hi >= this.target && lo >= this.minNotes) || hi >= this.target * 2) this.finish('notes', fx);
  }

  /** 一首歌结束：全连奖励，然后比平均每音符得分。 */
  finish(reason, fx) {
    const live = this.phase === 'live';
    const res = {};
    for (const team of TEAMS) {
      const ln = this.lanes[team];
      if (ln.roll) this.closeRoll(ln, fx);
      const fc = ln.notes >= this.fcMin && ln.bads === 0;
      if (fc) ln.score += 10 * ln.notes;
      res[team] = { avg: avgOf(ln), notes: ln.notes, goods: ln.goods, oks: ln.oks, bads: ln.bads, fc, clear: ln.gauge >= CLEAR, gauge: ln.gauge };
      if (fc && live) fx.push({ type: 'announce', text: L('全连！', 'Full Combo!'), sub: L(`${TEAM_NAME[team]} 整首歌一个「不可」都没有`, `${TEAM_NAME[team]}: not a single BAD all song`), cls: 'gold', ms: 1800 });
    }
    const [a, b] = [res.claude.avg, res.codex.avg];
    let winner = a > b ? 'claude' : b > a ? 'codex' : null;
    if (!winner && res.claude.gauge !== res.codex.gauge) winner = res.claude.gauge > res.codex.gauge ? 'claude' : 'codex';
    fx.push({ type: 'songEnd', winner, res });
    const text = reason === 'time'
      ? L(`时间到 · 平均每音符 ${fmtAvg(a)} : ${fmtAvg(b)}`, `Time up · avg per note ${fmtAvg(a)} : ${fmtAvg(b)}`)
      : L(`平均每音符 ${fmtAvg(a)} : ${fmtAvg(b)}`, `Avg per note ${fmtAvg(a)} : ${fmtAvg(b)}`);
    this.endRound(winner, reason, fx, text);
  }
}

// ================================================================ 画面
// 上下两条鼓道，左边是咚酱和判定圈，音符从右边飞进来，飞到判定圈的那一刻才亮出判定（画面上留一小段延迟，让音符看得见在飞）。

const { w: W, h: H } = WORLD;
const LANE_X = 300; // 鼓道左端（再往左是咚酱）
const HIT_X = 420; // 判定圈
const END_X = 1590; // 音符出现的地方
const LANE_H = 150;
const LANE_Y = { claude: 210, codex: 478 };
const TRAVEL = 1.6; // 音符飞到判定圈要几秒（真实时间）
const NOTE_R = 32;
const BIG_R = 48;
const GAUGE_X = 900;
const GAUGE_W = 660;
const INK = '#1a0d08';
const C = { don: '#f2492b', ka: '#45b5d9', roll: '#fbc21c', balloon: '#ff8a2a', gold: '#ffd84a', stick: '#9a8a7a' };
const J_COLOR = { good: '#ffcf33', ok: '#ffffff', bad: '#8fa8ff' };
const midY = (team) => LANE_Y[team] + LANE_H / 2;
const TAU = Math.PI * 2;

function txt(g, s, x, y, font, color, align = 'center') {
  g.font = `${font} ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

/** 描黑边的大字（判定、连击数）。 */
function otxt(g, s, x, y, size, color, align = 'center', weight = 900) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(3, size / 6);
  g.strokeStyle = 'rgba(20,8,4,0.9)';
  g.strokeText(s, x, y);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

/** 缩放 / 旋转之后的描边大字。 */
function stamp(g, s, x, y, size, color, k = 1, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(k, k);
  otxt(g, s, 0, 0, size, color);
  g.restore();
}

function circle(g, x, y, r, fill, stroke, lw = 3) {
  g.beginPath();
  g.arc(x, y, Math.max(0.1, r), 0, TAU);
  if (fill) (g.fillStyle = fill), g.fill();
  if (stroke) (g.strokeStyle = stroke), (g.lineWidth = lw), g.stroke();
}

function ell(g, x, y, rx, ry, fill, rot = 0) {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  g.fill();
}

/** 画几段线：segs = [[x1, y1, x2, y2], ...]。 */
function lines(g, segs, color, lw) {
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.beginPath();
  for (const [a, b, c, d] of segs) g.moveTo(a, b), g.lineTo(c, d);
  g.stroke();
}

/** 线性渐变，颜色均匀分布。 */
function lin(g, x0, y0, x1, y1, ...stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

function box(g, fill, x, y, w, h) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
}

function rr(g, x, y, w, h, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/** 左边对齐的小牌子，返回宽度。 */
function pillL(g, x, y, text, opts) {
  g.font = `${opts.weight || 600} ${opts.size || 12}px ${FONT}`;
  const w = g.measureText(fitText(g, text, opts.max || 140)).width + 10;
  pill(g, x + w / 2, y, text, opts);
  return w;
}

// 静态背景（夜祭：幕布、提灯、舞台、鼓道底板），按语言各画一张缓存起来
let layer = null;
let layerLang = null;
function backLayer() {
  const key = L('zh', 'en');
  if (layer && layerLang === key) return layer;
  const S = 1.5;
  const c = document.createElement('canvas');
  [c.width, c.height] = [W * S, H * S];
  const g = c.getContext('2d');
  g.scale(S, S);
  box(g, lin(g, 0, 0, 0, H, '#2a0b14', '#160710', '#0c0508'), 0, 0, W, H);
  // 顶上的幕：深红底 + 青海波纹
  box(g, lin(g, 0, 0, 0, 150, '#8c1424', '#4e0a16'), 0, 0, W, 150);
  g.strokeStyle = 'rgba(255,210,140,0.08)';
  g.lineWidth = 2;
  for (let y = 20; y < 150; y += 22) for (let x = (y / 22) % 2 ? 0 : 22; x < W + 44; x += 44) for (const r of [18, 12, 6]) {
    g.beginPath();
    g.arc(x, y, r, Math.PI, TAU);
    g.stroke();
  }
  box(g, '#e8b04a', 0, 148, W, 4);
  for (const team of TEAMS) {
    const y = LANE_Y[team];
    box(g, 'rgba(0,0,0,0.35)', 0, y - 42, W, 38); // 鼓道上方的信息条
    box(g, lin(g, 0, y, LANE_X, y, DEEP[team], COLOR[team]), 0, y, LANE_X, LANE_H); // 左边咚酱的台子
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 12; x < LANE_X; x += 24) g.fillRect(x, y, 2, LANE_H);
    box(g, '#26232a', LANE_X, y, W - LANE_X, LANE_H); // 鼓道
    box(g, '#1a181d', LANE_X, y + 18, W - LANE_X, LANE_H - 36);
    g.fillStyle = '#0b0a0c';
    for (const yy of [y - 4, y + LANE_H]) g.fillRect(0, yy, W, 4);
  }
  // 舞台：一串提灯 + 木地板
  const wave = (x) => 690 + Math.sin((x / W) * Math.PI * 3) * 14;
  g.strokeStyle = 'rgba(30,10,10,0.9)';
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x <= W; x += 10) g.lineTo(x, wave(x));
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const [x, y] = [60 + i * 135, wave(60 + i * 135) + 30];
    const glow = g.createRadialGradient(x, y, 4, x, y, 60);
    glow.addColorStop(0, 'rgba(255,140,60,0.35)');
    glow.addColorStop(1, 'rgba(255,140,60,0)');
    box(g, glow, x - 60, y - 60, 120, 120);
    ell(g, x, y, 20, 26, i % 2 ? '#e8402c' : '#f5e6c8');
    g.fillStyle = '#2a1a12';
    for (const dy of [-30, 24]) g.fillRect(x - 12, y + dy, 24, 6);
    txt(g, L('祭', '♪'), x, y + 1, '800 18px', i % 2 ? '#fff3dc' : '#c8301c');
  }
  box(g, lin(g, 0, 860, 0, H, '#6b3e1e', '#3a1f0c'), 0, 860, W, H - 860);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let x = 0; x < W; x += 80) g.fillRect(x, 860, 2, H - 860);
  box(g, '#e8b04a', 0, 858, W, 3);
  [layer, layerLang] = [c, key];
  return c;
}

export class View {
  constructor(app) {
    this.app = app;
    this.fx = new Particles();
    this.reset(null);
  }

  reset(R) {
    this.fx.clear();
    [this.sched, this.flyers, this.bigs, this.result, this.bigDrum] = [[], [], [], null, 0];
    this.notes = { claude: [], codex: [] };
    this.song = { idx: R?.songIdx ?? 0, diff: R?.diff ?? 0, stars: R?.stars ?? 1, round: R?.round ?? 0 };
    this.lane = {};
    for (const team of TEAMS) {
      const ln = R?.lanes?.[team];
      this.lane[team] = {
        score: ln?.score || 0, combo: ln?.combo || 0, notes: ln?.notes || 0, avg: ln ? avgOf(ln) : 0, gauge: ln?.gauge || 0, gShow: ln?.gauge || 0,
        bounce: 0, mood: 'idle', moodT: 0, judge: null, flash: 0, flashKind: 'don', label: null, roll: null, cheer: 0, lastAt: 0, words: [],
      };
      if (ln?.label?.ev) this.setLabel(R, team, ln.label.sid, ln.label.ev, false);
    }
  }

  /** 等鼓道上已经在飞的音符都落地之后再做（换歌、结果牌）。 */
  afterNotes(busy, fn) {
    const rt = this.app.rt();
    this.sched.push({ at: busy ? rt : Math.max(rt + TRAVEL, ...TEAMS.map((t) => this.lane[t].lastAt)) + 0.01, fn });
  }

  setLabel(R, team, sid, ev, bad) {
    const text = ev && actText(ev);
    if (!text) return;
    const name = R?.players?.get(sid)?.name || this.app.nameOf?.(sid) || String(sid).slice(0, 6);
    this.lane[team].label = { name, text, bad: bad || ev.ok === false, life: 2.2 };
  }

  /** 把一个音符放进鼓道：它在 at 时刻（真实时间）飞到判定圈。积压太多就挤一挤。 */
  spawn(team, o, busy) {
    const rt = this.app.rt();
    const lv = this.lane[team];
    o.travel = busy ? 0.3 : TRAVEL;
    o.at = Math.max(rt + o.travel, Math.min(lv.lastAt + (busy ? 0.03 : 0.12), rt + o.travel * 2));
    o.done = false;
    lv.lastAt = o.at;
    const list = this.notes[team];
    list.push(o);
    if (list.length > 48) {
      const old = list.shift();
      if (old.kind === 'note' && !old.done) this.land(null, team, old, true);
    }
    return o;
  }

  apply(list, R, busy) {
    const rt = this.app.rt();
    for (const f of list) {
      const lv = this.lane[f.team];
      if (!lv && ['beat', 'rollStart', 'rollHit', 'rollEnd', 'shaky', 'cheer', 'hold'].includes(f.type)) continue; // 别的游戏也有叫 cheer 的效果
      switch (f.type) {
        case 'act': {
          const p = R.players.get(f.sid);
          if (p?.onField && ['compact', 'prompt', 'ask', 'answer'].includes(f.ev.k)) this.setLabel(R, p.team, f.sid, f.ev, false);
          break;
        }
        case 'beat':
          this.spawn(f.team, { ...f, kind: 'note', type: undefined }, busy);
          break;
        case 'rollStart':
          lv.roll = this.spawn(f.team, { kind: 'roll', rtype: f.kind, need: f.need, hits: [], end: null, shown: 0, popped: false }, busy);
          break;
        case 'rollHit': {
          const roll = lv.roll || (lv.roll = this.spawn(f.team, { kind: 'roll', rtype: 'roll', need: 99, hits: [], end: null, shown: 0, popped: false }, busy));
          const prev = roll.hits[roll.hits.length - 1];
          roll.hits.push({ at: Math.max(rt + roll.travel, roll.at, prev ? prev.at + 0.03 : 0), pop: f.pop, score: f.score, avg: f.avg, sid: f.sid, ev: f.ev, n: f.hits, done: false });
          break;
        }
        case 'rollEnd':
          if (lv.roll) {
            const last = lv.roll.hits.length ? lv.roll.hits[lv.roll.hits.length - 1].at : lv.roll.at;
            lv.roll.end = Math.max(rt + lv.roll.travel, last + 0.15);
            lv.lastAt = Math.max(lv.lastAt, lv.roll.end);
            lv.roll = null;
          }
          break;
        case 'song':
          this.afterNotes(busy, () => {
            this.song = { idx: f.idx, diff: f.diff, stars: f.stars, round: f.round };
            for (const team of TEAMS) Object.assign(this.lane[team], { score: 0, notes: 0, avg: 0, gauge: 0 });
          });
          break;
        case 'songEnd':
          this.afterNotes(busy, () => {
            this.result = { winner: f.winner, res: f.res, t: 0, dur: busy ? 0.8 : 3.2 };
            if (busy) return;
            for (const team of TEAMS) if (f.res[team].fc || f.winner === team) this.lane[team].cheer = 2.5;
            if (this.app.sfx.ok(2)) [523, 659, 784, 1047].forEach((fq, i) => this.app.sfx.tone(fq, 0.18, 0.1, 'triangle', null, i * 0.09));
          });
          break;
        case 'shaky':
          [lv.mood, lv.moodT] = ['dizzy', 3];
          this.word(f.team, L('💫 节奏乱了', '💫 Lost the beat'), '#ffffff', 1.4);
          break;
        case 'cheer':
          lv.cheer = 1.6;
          this.word(f.team, f.why === 'answer' ? L('鼓点接上了！', 'Back on beat!') : L('加油！', 'Go go!'), '#9fe0ff', 1.3);
          break;
        case 'hold':
          this.word(f.team, L('⏳ 鼓停一拍', '⏳ Drum on hold'), '#ff9a8a', 1.6);
          break;
      }
    }
  }

  /** 咚酱头上飘一行小字。 */
  word(team, text, color, life) {
    const words = this.lane[team].words;
    if (words.length > 1) words.shift();
    words.push({ text, color, life, max: life });
  }

  /** 音符飞到判定圈：亮判定、更新分数、咚酱的表情、声音。 */
  land(R, team, o, quiet) {
    const lv = this.lane[team];
    o.done = true;
    Object.assign(lv, { score: o.score, combo: o.combo, notes: o.notes, avg: o.avg, gauge: o.gauge });
    if (o.ev) this.setLabel(R, team, o.sid, o.ev, o.judge === 'bad');
    if (quiet) return;
    const { fx, app } = this;
    const y = midY(team);
    const color = C[o.drum] || C.don;
    lv.judge = { j: o.judge, t: 0 };
    lv.bounce = 1;
    if (o.judge === 'bad') {
      [lv.mood, lv.moodT] = o.why === 'abort' ? ['cry', 2.4] : ['sad', 0.9];
      const say = { abort: [L('✋ 你拔了鼓棒！', '✋ Sticks yanked!'), '#ff8a8a'], timeout: [L('⏳ 等太久', '⏳ Waited too long'), '#ff8a8a'], err: [L('🐛 报错', '🐛 Error'), '#a6e05a'] }[o.why];
      if (say) this.word(team, say[0], say[1], 1.4);
      if (o.why === 'abort') app.shake(0.3, 6);
      if (app.sfx.ok(1)) app.sfx.tone(105, 0.1, 0.16, 'triangle', 70);
      return;
    }
    o.gone = true;
    [lv.mood, lv.moodT, lv.flash, lv.flashKind, this.bigDrum] = [o.judge === 'good' ? 'happy' : 'idle', 0.5, 1, o.drum, 1];
    fx.ring(HIT_X, y, o.big ? 40 : 28, o.big ? 110 : 70, o.judge === 'good' ? 'rgba(255,214,90,0.95)' : 'rgba(255,255,255,0.8)', 0.35, o.big ? 7 : 4);
    fx.sparks(HIT_X, y, color, o.big ? 16 : o.judge === 'good' ? 7 : 3, o.big ? 260 : 170);
    if (o.big) {
      fx.sparks(HIT_X, y, '#fff3b0', 12, 320);
      const text = o.why === 'pr' ? L('魂槽 MAX！', 'SOUL MAX!') : o.drum === 'don' ? L('大咚！', 'DON!!') : L('大咔！', 'KA!!');
      this.bigs.push({ team, text, color: o.why === 'pr' ? C.gold : color, t: 0, life: 1.1 });
    }
    if (o.charged) fx.text(HIT_X + 60, y - 50, L('蓄力 ×1.5', 'Charged ×1.5'), '#ffd166', 15, 1);
    if (o.combo >= 10 && o.combo % 10 === 0) {
      this.bigs.push({ team, text: L(`${o.combo} 连击`, `${o.combo} Combo`), color: '#ffe066', t: 0, life: 1.2, combo: true });
      lv.cheer = Math.max(lv.cheer, 1.4);
    }
    // 打中的音符飞进魂槽（原作的经典动画）
    if (this.flyers.length < 30) this.flyers.push({ team, drum: o.drum, big: o.big, t: 0, dur: 0.45 });
    this.drum(o.drum, o.big);
  }

  /** 合成鼓声：咚 = 低沉的鼓面，咔 = 鼓边的脆响。 */
  drum(kind, big) {
    const s = this.app.sfx;
    if (!s.ok(big ? 2 : 1)) return;
    if (kind === 'ka') {
      s.burst(big ? 0.07 : 0.04, 3600, big ? 0.34 : 0.22, 'highpass');
      s.tone(big ? 1300 : 1700, 0.035, big ? 0.12 : 0.08, 'square');
    } else if (kind === 'gold') {
      [523, 784, 1047].forEach((f, i) => s.tone(f, 0.16, 0.1, 'triangle', null, i * 0.06));
    } else {
      s.tone(big ? 115 : 150, big ? 0.24 : 0.14, big ? 0.5 : 0.36, 'sine', big ? 55 : 70);
      s.burst(0.05, 480, big ? 0.26 : 0.14);
    }
  }

  /** 连打的一击到了判定圈：咚咚咚，气球打够了就爆。 */
  rollTick(R, team, roll, h, busy) {
    const lv = this.lane[team];
    const y = midY(team);
    h.done = true;
    roll.shown = h.n;
    Object.assign(lv, { score: h.score, avg: h.avg });
    [lv.bounce, lv.flash, lv.flashKind, this.bigDrum] = [Math.max(lv.bounce, 0.6), 0.7, 'roll', Math.max(this.bigDrum, 0.5)];
    if (h.ev && !busy) this.setLabel(R, team, h.sid, h.ev, false);
    if (!busy) this.fx.sparks(HIT_X, y, C.roll, 2, 120);
    const s = this.app.sfx;
    if (h.pop) {
      roll.popped = true;
      lv.cheer = Math.max(lv.cheer, 1.5);
      this.fx.explosion(HIT_X, y - 10, false);
      this.fx.text(HIT_X + 20, y - 56, L(`🎈 啪！+${POP_PTS}`, `🎈 POP! +${POP_PTS}`), C.balloon, 22, 1.2);
      if (s.ok(2)) s.burst(0.16, 1800, 0.5, 'bandpass'), s.tone(700, 0.1, 0.1, 'triangle', 1600);
    } else if (s.ok(0)) s.tone(170, 0.05, 0.16, 'sine', 100);
  }

  update(dt, R) {
    const rt = this.app.rt();
    const busy = (this.app.speed?.() || 1) > 60;
    for (const team of TEAMS) {
      const lv = this.lane[team];
      for (const o of this.notes[team]) {
        if (o.kind === 'note' && !o.done && o.at <= rt) this.land(R, team, o, false);
        if (o.kind === 'roll') for (const h of o.hits) if (!h.done && h.at <= rt) this.rollTick(R, team, o, h, busy);
      }
      // 打中的音符消失；不可的音符继续往左滑出去；连打的尾巴过了判定圈就收掉
      this.notes[team] = this.notes[team].filter((o) => {
        if (o.kind === 'roll') return !(o.end != null && o.end + 0.2 <= rt && o.hits.every((h) => h.done));
        return !o.gone && (!o.done || rt - o.at < 0.5);
      });
      [lv.bounce, lv.flash, lv.cheer] = [Math.max(0, lv.bounce - dt * 5), Math.max(0, lv.flash - dt * 4), Math.max(0, lv.cheer - dt)];
      if ((lv.moodT -= dt) <= 0) lv.mood = 'idle';
      if (lv.judge && (lv.judge.t += dt) > 0.6) lv.judge = null;
      if (lv.label && (lv.label.life -= dt) <= 0) lv.label = null;
      for (const w of lv.words) w.life -= dt;
      lv.words = lv.words.filter((w) => w.life > 0);
      lv.gShow += (lv.gauge - lv.gShow) * Math.min(1, dt * 6);
    }
    // 换歌 / 结果牌排在音符落地之后
    if (this.sched.length) {
      const due = this.sched.filter((s) => s.at <= rt);
      this.sched = this.sched.filter((s) => s.at > rt);
      for (const s of due) s.fn();
    }
    for (const f of this.flyers) f.t += dt;
    this.flyers = this.flyers.filter((f) => f.t < f.dur);
    for (const b of this.bigs) b.t += dt;
    this.bigs = this.bigs.filter((b) => b.t < b.life).slice(-8);
    this.bigDrum = Math.max(0, this.bigDrum - dt * 4);
    if (this.result && (this.result.t += dt) >= this.result.dur) this.result = null;
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------- 画

  render(g, R, scale) {
    const rt = this.app.rt();
    g.drawImage(backLayer(), 0, 0, W, H);
    this.drawHeader(g, R);
    for (const team of TEAMS) this.drawLane(g, R, team, rt, scale);
    this.drawStage(g, rt);
    for (const f of this.flyers) {
      const k = f.t / f.dur;
      const [y0, x1, y1] = [midY(f.team), GAUGE_X + GAUGE_W * this.lane[f.team].gShow, LANE_Y[f.team] - 23];
      g.globalAlpha = 1 - k * 0.5;
      this.noteShape(g, HIT_X + (x1 - HIT_X) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 120, (f.big ? BIG_R : NOTE_R) * (1 - k * 0.5), f.drum);
    }
    g.globalAlpha = 1;
    this.fx.renderOver(g, scale);
    this.drawResult(g, rt);
  }

  drawHeader(g, R) {
    const s = this.song;
    if (R.phase !== 'live') {
      otxt(g, L('♪ 热身中 · 自由练习', '♪ Warm-up · free play'), 800, 52, 40, '#fff6e0');
      return txt(g, L('两队都有人上场就开唱', 'The song starts when both teams are on stage'), 800, 100, '600 16px', 'rgba(255,230,200,0.75)');
    }
    otxt(g, `♪ ${songTitle(s.idx)}`, 800, 52, 40, '#fff6e0');
    pill(g, 800, 98, `${diffName(s.diff)} ${'★'.repeat(s.stars)}`, { color: s.diff === 3 ? '#ff9a8a' : '#ffd166', size: 16, max: 360, weight: 800, bg: 'rgba(40,6,12,0.75)' });
    txt(g, L(`第 ${s.round} 首`, `Song ${s.round}`), 60, 52, '800 24px', '#ffd9a0', 'left');
    const left = Math.max(0, (R.songLen || 0) - (R.now - R.roundStart));
    txt(g, `⏱ ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`, W - 60, 52, '800 24px', left < 30e3 ? '#ff8a8a' : '#ffd9a0', 'right');
    // 这首歌的进度：两边各打了多少个音符
    const target = R.target || 1;
    TEAMS.forEach((team, i) => {
      box(g, 'rgba(0,0,0,0.45)', 560, 124 + i * 12, 480, 7);
      box(g, COLOR[team], 560, 124 + i * 12, 480 * clamp(this.lane[team].notes / target, 0, 1), 7);
    });
    txt(g, L(`${target} 个音符`, `${target} notes`), 1052, 133, '600 13px', 'rgba(255,230,200,0.7)', 'left');
  }

  drawLane(g, R, team, rt, scale) {
    const lv = this.lane[team];
    const y = LANE_Y[team];
    const my = midY(team);
    const fs = fontFor(scale, 13);
    // 信息条：队名、分数、平均分、音符数、魂槽
    const sy = y - 23;
    const nw = pillL(g, 14, sy, TEAM_NAME[team], { color: '#fff', bg: DEEP[team], size: 17, max: 170, weight: 800 });
    txt(g, String(Math.round(lv.score)).padStart(6, '0'), 30 + nw, sy, '900 24px', '#fff', 'left');
    txt(g, L(`平均 ${fmtAvg(lv.avg)}`, `Avg ${fmtAvg(lv.avg)}`), 170 + nw, sy, '800 18px', COLOR[team], 'left');
    txt(g, `${lv.notes}/${R.target || '-'} ♪`, 320 + nw, sy, '700 15px', 'rgba(255,255,255,0.6)', 'left');
    this.drawGauge(g, team, sy, rt);
    // 判定圈
    circle(g, HIT_X, my, 46, 'rgba(0,0,0,0.35)', 'rgba(255,255,255,0.28)', 3);
    circle(g, HIT_X, my, NOTE_R + 2, null, 'rgba(255,255,255,0.45)', 3);
    g.globalAlpha = lv.flash;
    if (lv.flash > 0) circle(g, HIT_X, my, 50, null, C[lv.flashKind] || C.don, 8);
    g.globalAlpha = 1;
    // 音符：远的先画，近的压在上面
    g.save();
    g.beginPath();
    g.rect(LANE_X, y, W - LANE_X, LANE_H);
    g.clip();
    const list = this.notes[team];
    for (let i = list.length - 1; i >= 0; i--) this.drawNote(g, list[i], my, rt);
    g.restore();
    // 判定字：良 / 可 / 不可
    if (lv.judge) {
      const k = lv.judge.t / 0.6;
      g.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      otxt(g, judgeWord(lv.judge.j), HIT_X, y + 22 - Math.min(k, 0.2) * 40, lv.judge.j === 'bad' ? 26 : 32, J_COLOR[lv.judge.j]);
      g.globalAlpha = 1;
    }
    // 谁刚敲的、敲的是什么
    if (lv.label) {
      g.globalAlpha = Math.min(1, lv.label.life / 0.4);
      const w = pillL(g, HIT_X + 62, y + 14, lv.label.name, { color: COLOR[team], size: fs, max: 200, weight: 700 });
      pillL(g, HIT_X + 68 + w, y + 14, lv.label.text, { size: fs - 1, max: 320, weight: 500, bg: lv.label.bad ? 'rgba(130,20,20,0.88)' : 'rgba(10,12,16,0.75)' });
      g.globalAlpha = 1;
    }
    // 大字：大咚、连击数
    for (const b of this.bigs) {
      if (b.team !== team) continue;
      const k = b.t / b.life;
      const s = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.8);
      g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      stamp(g, b.text, b.combo ? 640 : HIT_X + 150, my - 6 - k * 20, b.combo ? 40 : 52, b.color, s);
    }
    g.globalAlpha = 1;
    this.drawFace(g, R, team, 120, my, rt);
    // 连击数印在咚酱右边
    if (lv.combo >= 3) {
      stamp(g, String(lv.combo), 250, my - 8, lv.combo >= 100 ? 40 : 46, lv.combo >= 50 ? '#ffd84a' : '#ffffff', 1 + lv.bounce * 0.25);
      txt(g, L('连击', 'COMBO'), 250, my + 30, '800 13px', 'rgba(255,255,255,0.85)');
    }
    lv.words.forEach((w, i) => {
      g.globalAlpha = Math.min(1, w.life / 0.3);
      otxt(g, w.text, 150, y + 14 + i * 22 - (1 - w.life / w.max) * 10, 16, w.color, 'center', 800);
    });
    g.globalAlpha = 1;
    this.drawWait(g, R, team, rt);
    if (!R.field?.(team).length) {
      box(g, 'rgba(5,4,8,0.6)', LANE_X, y, W - LANE_X, LANE_H);
      pill(g, 900, my, L(`等待 ${TEAM_NAME[team]} 上场…`, `Waiting for ${TEAM_NAME[team]}…`), { size: 20, max: 360, color: COLOR[team] });
    }
  }

  /** 魂槽：合格线之前红色，过了合格线变黄，满了是彩虹。 */
  drawGauge(g, team, y, rt) {
    const v = clamp(this.lane[team].gShow, 0, 1);
    const [x, w, h] = [GAUGE_X, GAUGE_W, 18];
    rr(g, x - 3, y - h / 2 - 3, w + 6, h + 6, 6, 'rgba(0,0,0,0.6)');
    const full = v >= 0.999;
    const off = (rt * 300) % w;
    box(g, full ? lin(g, x + off - w, 0, x + off + w, 0, '#ff4d4d', '#ffb84d', '#fff04d', '#5dff7a', '#4dc3ff', '#b04dff', '#ff4d4d') : v >= CLEAR ? '#ffd84a' : '#e8402c', x, y - h / 2, w * v, h);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 1; i < 25; i++) g.fillRect(x + (w * i) / 25, y - h / 2, 2, h);
    box(g, '#fff', x + w * CLEAR - 2, y - h / 2 - 4, 4, h + 8);
    circle(g, x + w - 4, y, 15, full ? `hsl(${(rt * 200) % 360},90%,55%)` : '#3a2a20', INK, 3);
    txt(g, L('魂', 'S'), x + w - 4, y + 1, '900 15px', full ? '#fff' : 'rgba(255,255,255,0.5)');
    txt(g, L('魂槽', 'Soul'), x - 10, y, '700 13px', 'rgba(255,255,255,0.6)', 'right');
  }

  /** 一个音符：黑边、白圈、红 / 蓝芯，拔鼓棒的音符打个叉。 */
  noteShape(g, x, y, r, drum) {
    circle(g, x, y, r + 3, INK);
    circle(g, x, y, r, '#fff8ec');
    circle(g, x, y, r * 0.8, C[drum] || C.don);
    ell(g, x - r * 0.25, y - r * 0.32, r * 0.35, r * 0.18, 'rgba(255,255,255,0.35)', -0.4);
    const k = r * 0.45;
    if (drum === 'stick') lines(g, [[x - k, y - k, x + k, y + k], [x + k, y - k, x - k, y + k]], '#3a2a1a', r * 0.18);
  }

  drawNote(g, o, my, rt) {
    const xOf = (at) => HIT_X + ((at - rt) / o.travel) * (END_X - HIT_X);
    if (o.kind !== 'roll') {
      let x = xOf(o.at);
      if (o.done) {
        // 不可：滑过判定圈，慢慢变淡
        x = HIT_X - (rt - o.at) * 260;
        g.globalAlpha = Math.max(0, 1 - (rt - o.at) / 0.5) * 0.7;
      }
      if (x < END_X + 60) this.noteShape(g, x, my, o.big ? BIG_R : NOTE_R, o.drum);
      g.globalAlpha = 1;
      return;
    }
    const head = Math.max(HIT_X, xOf(o.at));
    const tail = o.end != null ? Math.max(HIT_X, xOf(o.end)) : END_X + 40;
    const r = NOTE_R * 0.92;
    if (o.rtype === 'balloon') {
      // 气球：停在判定圈越打越鼓，数字是还差几下
      if (tail > head) box(g, 'rgba(255,138,42,0.35)', head, my - 6, tail - head, 12);
      if (o.popped && head <= HIT_X) return;
      const br = r * (head <= HIT_X ? 1 + Math.min(0.6, o.shown / Math.max(1, o.need)) * 0.6 : 1);
      lines(g, [[head, my + br, head - 4, my + br + 16]], INK, 2);
      circle(g, head, my, br + 3, INK);
      circle(g, head, my, br, C.balloon);
      ell(g, head - br * 0.3, my - br * 0.35, br * 0.3, br * 0.18, 'rgba(255,255,255,0.4)', -0.5);
      otxt(g, String(Math.max(0, o.need - o.shown)), head, my + 2, 22, '#fff');
      return;
    }
    // 连打：黄色长条，头在判定圈里时显示击数
    if (tail > head) {
      rr(g, head, my - r - 3, tail - head + r + 3, (r + 3) * 2, r + 3, INK);
      rr(g, head, my - r, tail - head + r, r * 2, r, C.roll);
    }
    this.noteShape(g, head, my, r, 'roll');
    if (head <= HIT_X && o.shown) otxt(g, L(`${o.shown} 连打`, `${o.shown} hits`), HIT_X + 4, my - r - 18, 18, '#ffe066');
  }

  /** 咚酱：鼓身是队伍色，奶白色的脸，敲中会弹一下张嘴喊「咚」。 */
  drawFace(g, R, team, x, y, rt) {
    const lv = this.lane[team];
    const [b, mood] = [lv.bounce, lv.mood];
    g.save();
    g.translate(x, y + 6 - b * 12 + Math.sin(rt * 3 + (team === 'claude' ? 0 : 1.5)) * 2);
    g.scale(1 + b * 0.07, 1 - b * 0.07);
    if (R.lanes?.[team]?.charge > 0) {
      // 蓄力中：发金光
      g.shadowColor = '#ffd166';
      g.shadowBlur = 18 + Math.sin(rt * 8) * 6;
    }
    circle(g, 0, 0, 58, COLOR[team], INK, 5);
    g.shadowBlur = 0;
    for (let i = 0; i < 10; i++) circle(g, Math.cos((i / 10) * TAU) * 52, Math.sin((i / 10) * TAU) * 52, 2.5, '#2a1a10'); // 鼓钉
    circle(g, 0, 2, 44, '#fff3dc', 'rgba(26,13,8,0.6)', 2);
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (const ex of [-16, 16]) {
      if (mood === 'happy') {
        g.beginPath();
        g.arc(ex, -4, 7, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      } else if (mood === 'dizzy') {
        g.lineWidth = 2.5;
        g.beginPath();
        for (let a = 0; a < Math.PI * 4; a += 0.3) g.lineTo(ex + Math.cos(a + rt * 6) * a * 0.75, -4 + Math.sin(a + rt * 6) * a * 0.75);
        g.stroke();
        g.lineWidth = 4;
      } else if (mood === 'sad' || mood === 'cry') {
        lines(g, [[ex - 7, -8, ex + 7, -2], [ex - 7, -2, ex + 7, -8]], INK, 4);
        if (mood === 'cry') ell(g, ex, 8 + ((rt * 40) % 20), 3, 5, '#6cc8ff');
      } else {
        ell(g, ex, -5, 6, 8, INK);
        circle(g, ex + 2, -8, 2.2, '#fff');
      }
    }
    for (const s of [-1, 1]) ell(g, s * 28, 10, 7, 4.5, 'rgba(255,110,110,0.55)'); // 腮红
    // 嘴：敲中张大嘴喊「咚」，不可就撇嘴
    const [open, sad] = [b > 0.2 || mood === 'happy', mood === 'sad' || mood === 'cry'];
    [g.strokeStyle, g.lineWidth, g.fillStyle] = [INK, 4, '#c0281c'];
    g.beginPath();
    if (open) g.arc(0, 12, 6 + b * 7, 0, Math.PI);
    else g.arc(0, sad ? 22 : 10, 7, Math.PI * (sad ? 1.15 : 0.15), Math.PI * (sad ? 1.85 : 0.85));
    if (open) g.fill();
    else g.stroke();
    g.restore();
    const sw = b * 0.9; // 鼓棒跟着敲
    lines(g, [-1, 1].map((s) => [x + s * 50, y + 44, x + s * (66 - sw * 18), y + 4 - sw * 24]), '#c89a5a', 6);
  }

  /** 「它在等你」：咚酱脚下一条倒计时。 */
  drawWait(g, R, team, rt) {
    for (const [sid, w] of R.waits || []) {
      const p = R.players.get(sid);
      if (w.boom || !p || p.team !== team || !p.onField) continue;
      const sec = Math.ceil(Math.max(0, w.deadline - R.now) / 1000);
      g.globalAlpha = 0.85 + 0.15 * Math.sin(rt * 8);
      pill(g, 150, LANE_Y[team] + LANE_H - 14, L(`⏳ ${p.name} 在等你 · ${sec} 秒`, `⏳ ${p.name} waiting · ${sec}s`), { size: 12, max: 280, bg: 'rgba(150,20,20,0.9)', weight: 700 });
      g.globalAlpha = 1;
      return;
    }
  }

  /** 舞台：中间一面大鼓，两边是各队的应援舞者，魂槽越满上来的越多，连击时一起跳。 */
  drawStage(g, rt) {
    const d = this.bigDrum;
    const [cx, cy] = [800, 800];
    g.fillStyle = '#3a1f0c';
    for (const dx of [-90, 74]) g.fillRect(cx + dx, cy + 40, 16, 56);
    g.save();
    g.translate(cx, cy);
    g.scale(1 + d * 0.04, 1 + d * 0.04);
    g.strokeStyle = INK;
    g.lineWidth = 4;
    for (const [rx, ry, c, edge] of [[100, 70, '#8a3a1a', true], [40, 62, '#f5e6c8', true], [18, 28, '#e8402c', false]]) {
      ell(g, 0, 0, rx, ry, c);
      if (edge) g.stroke();
    }
    g.restore();
    g.globalAlpha = d;
    if (d > 0) circle(g, cx, cy, 80 + (1 - d) * 50, null, 'rgba(255,220,140,0.8)', 4);
    g.globalAlpha = 1;
    for (const team of TEAMS) {
      const lv = this.lane[team];
      const n = 1 + Math.floor(clamp(lv.gShow, 0, 1) * 4.99);
      const [base, dir] = team === 'claude' ? [140, 1] : [1460, -1];
      for (let i = 0; i < 5; i++) {
        const on = i < n;
        const jump = on && lv.cheer > 0 ? Math.abs(Math.sin(rt * 9 + i)) * 22 * Math.min(1, lv.cheer) : 0;
        g.globalAlpha = on ? 1 : 0.15;
        this.dancer(g, base + dir * i * 118, 900 - jump, team, i, on ? lv.cheer : 0, rt, on);
      }
      g.globalAlpha = 1;
      txt(g, L(`${TEAM_NAME[team]} 应援团`, `${TEAM_NAME[team]} cheer squad`), team === 'claude' ? 380 : 1220, 942, '700 15px', 'rgba(255,230,200,0.6)');
    }
  }

  /** 一个穿法被的小舞者，手里挥着扇子。 */
  dancer(g, x, y, team, i, cheer, rt, on) {
    const arm = on ? Math.sin(rt * (cheer > 0 ? 9 : 3) + i * 1.3) * (cheer > 0 ? 1.1 : 0.5) : 0;
    lines(g, [[x - 7, y - 30, x - 10, y], [x + 7, y - 30, x + 10, y]], '#2a1a10', 5);
    g.fillStyle = COLOR[team];
    g.beginPath();
    for (const [px, py] of [[-18, -30], [18, -30], [13, -72], [-13, -72]]) g.lineTo(x + px, y + py);
    g.fill();
    box(g, '#fff3dc', x - 2, y - 72, 4, 42); // 法被的白领
    for (const s of [-1, 1]) {
      const a = -Math.PI / 2 + s * (1.2 + arm * s * 0.8);
      const [hx, hy] = [x + s * 12 + Math.cos(a) * 26, y - 66 + Math.sin(a) * 26];
      lines(g, [[x + s * 12, y - 66, hx, hy]], DEEP[team], 6);
      if (s === 1) {
        g.fillStyle = i % 2 ? '#ffd84a' : '#e8402c';
        g.beginPath();
        g.moveTo(hx, hy);
        g.arc(hx, hy, 14, a - 0.7, a + 0.7);
        g.fill();
      }
    }
    circle(g, x, y - 86, 13, '#f5d2a8', '#2a1a10', 2);
    g.fillStyle = '#2a1a10';
    g.beginPath();
    g.arc(x, y - 89, 13, Math.PI, TAU);
    g.fill();
    box(g, '#fff', x - 14, y - 92, 28, 4); // 头巾
  }

  /** 一首歌结束：每条鼓道上盖一个结果牌（胜负、平均分、全连、魂槽合格）。 */
  drawResult(g, rt) {
    const r = this.result;
    if (!r) return;
    const k = clamp(r.t / 0.35, 0, 1);
    g.globalAlpha = clamp((r.dur - r.t) / 0.4, 0, 1);
    for (const team of TEAMS) {
      const res = r.res[team];
      const my = midY(team);
      const win = r.winner === team;
      box(g, 'rgba(10,4,8,0.72)', LANE_X, LANE_Y[team], W - LANE_X, LANE_H);
      stamp(g, !r.winner ? L('平局', 'DRAW') : win ? L('胜利！', 'WIN!') : L('惜败', 'LOSE'), 700, my - 12, win ? 66 : 46, win ? '#ffd84a' : !r.winner ? '#ffffff' : '#9fb0d0', 0.6 + 0.4 * k);
      txt(g, L(`平均 ${fmtAvg(res.avg)} · 良 ${res.goods} 可 ${res.oks} 不可 ${res.bads}`, `Avg ${fmtAvg(res.avg)} · GOOD ${res.goods} OK ${res.oks} BAD ${res.bads}`), 700, my + 40, '700 17px', 'rgba(255,240,220,0.9)');
      if (res.fc) stamp(g, L('全连！', 'FULL COMBO!'), 1120, my, 44, `hsl(${(rt * 240) % 360},95%,62%)`, 1, -0.08);
      pill(g, 1420, my, res.clear ? L('魂槽合格 ✓', 'Clear ✓') : L('魂槽不合格', 'Not cleared'), { size: 16, weight: 800, color: res.clear ? '#ffd84a' : '#9fb0d0', bg: 'rgba(0,0,0,0.6)', max: 220 });
    }
    g.globalAlpha = 1;
  }

  hud(R) {
    if (R.phase !== 'live' || !R.lanes) return null;
    const { claude, codex } = R.lanes;
    return { mid: `♪ ${songTitle(R.songIdx)}`, sub: L(`连击 ${claude.combo} : ${codex.combo}`, `Combo ${claude.combo} : ${codex.combo}`) };
  }
}
