// Chrome 小恐龙：断网时浏览器里那个跑酷小游戏。上下两条跑道，每队一条，队里的会话是一群像素霸王龙。
// 每个动作往前跑一截，路上的仙人掌和翼龙顺手跳过；报错就一头撞上去（掉一条命，记分清零）。
// 测试通过是超级跳，任务完成天就黑了（夜间模式），API 报错整条跑道弹出「无法访问此网站」。先跑到终点的队赢。
import { Rules as Base, TEAMS, OTHER, COLOR, TEAM_NAME, WORLD, clamp, hash, rng, actText } from '../core.js';
import { L } from '../i18n.js';
import { Particles, rand, pill, fontFor, FONT } from '../fxkit.js';

// meta 在 import 时就求值，文字都写成 getter，切换语言后读到的是新语言
export const meta = {
  id: 'dino',
  icon: '🦖',
  get name() { return L('Chrome 小恐龙', 'Chrome Dino Run'); },
  get desc() { return L('断网小恐龙赛跑：每个动作往前跑，报错撞仙人掌，API 报错弹出「无法访问此网站」', 'The offline T-Rex, as a race: every action runs, errors hit cacti, API errors pop the No-internet page'); },
  get roundWord() { return L('局', 'run'); },
  get wait() {
    return {
      start: L('🦖 {a} 停下来等你', '🦖 {a} stopped running to wait for you'),
      sub: L('40 秒内回它，不然翼龙就飞过来了', 'Reply within 40s or the pterodactyl gets it'),
      done: L('🦖 回得及时，接着跑', '🦖 Replied in time — back to running'),
      boom: L('🦅 {a} 等太久，撞上了翼龙', '🦅 {a} waited too long and hit a pterodactyl'),
    };
  },
  get legend() {
    return [
      [L('🏃 跑命令 / 读文件 / 改代码', '🏃 Command / read / edit'), L('往前跑，顺手跳过仙人掌', 'Run forward, hopping cacti on the way')],
      [L('🎯 测试 / 编译通过 / git commit', '🎯 Tests / build pass / git commit'), L('超级跳：一口气跳过一串', 'Super jump: clear a whole row at once')],
      [L('🔭 上网查资料', '🔭 Search the web'), L('冲刺；正好碰上翼龙就低头钻过去', 'Sprint — and duck under any pterodactyl')],
      [L('🐛 动作报错', '🐛 Action fails'), L('撞仙人掌：掉一条命，记分清零', 'Hit a cactus: lose a life, score resets')],
      [L('💭 思考', '💭 Thinking'), L('蓄力：下一跳更远', 'Charge up: the next jump goes farther')],
      [L('✅ 任务完成', '✅ Task done'), L('🌙 夜间模式：天黑了，夜跑更快', '🌙 Night mode: lights out, night runs are faster')],
      [L('🪂 派出子代理', '🪂 Spawn a subagent'), L('🚀 加速道具', '🚀 Speed boost')],
      [L('📡 API 报错', '📡 API error'), L('「无法访问此网站」：整条跑道断网一会儿', '"No internet": the whole lane goes offline for a bit')],
      [L('💫 上下文压缩', '💫 Context compaction'), L('📶 掉线重连，原地卡一会儿', '📶 Dropped connection, stuck for a moment')],
      [L('✋ 被你打断', '✋ You interrupt it'), L('🔌 你拔了网线：直接 GAME OVER', '🔌 You pulled the plug: instant GAME OVER')],
      [L('💬 收到新指令', '💬 New prompt'), L('␣ 按空格开始：GAME OVER 的能复活，没倒的加速', '␣ Press space: revives a GAME OVER, boosts everyone else')],
      [L('⏳ 它在等你', '⏳ Waiting on you'), L('站着等你；40 秒不回撞上翼龙', 'Stands still; 40s without a reply and a pterodactyl hits')],
      [L('🏆 开 PR', '🏆 Open a PR'), L('无敌冲刺：冲一大截，接下来几下撞不坏', 'Invincible dash: a long sprint, then a few hits shrug off')],
      [L('🏁 一局', '🏁 A run'), L('先跑到终点的队赢；一队全员 GAME OVER 直接输；时间到比谁远', 'First lane to the finish wins; a lane wiped out loses; time up = farther lane wins')],
    ];
  },
};

// ================================================================ 数值

const STEP = { shell: 30, read: 20, edit: 34, misc: 24, web: 30 }; // 每个动作往前跑多少米（乘倍率前）
const SUPER = 3; // 测试通过：超级跳，三步并一步（以下都是「几个跑命令那么远」）
const BOOST = 2.5; // 子代理：加速道具
const DASH = 5; // 开 PR：无敌冲刺
const NIGHT_RUN = 2; // 任务完成：天黑了，先冲两步
const SPACE = 1.5; // 新指令：按空格开始
const RESUME = 1; // 及时回复：接着跑
const SPRINT = 1.15; // 上网查资料本来就跑得快一点
const DUCK = 0.5; // 正好钻过翼龙：再多冲半步
const CHARGE = 1.4; // 思考蓄力：下一跳远 40%
const NIGHT_MULT = 1.2; // 夜跑更快
const NIGHT_LEN = 45e3;
const NIGHT_ANN = 5 * 60e3; // 「夜间模式」大横幅的冷却（每条跑道）
const STUN = 5e3; // 撞了之后趴在地上：这几秒里自己的动作不算数，也不会再掉命
const LAG = 8e3; // 上下文压缩：掉线重连
const INVINC = 6; // 无敌冲刺之后，接下来几个动作撞不坏
const HI_MIN = 1000; // 旧纪录至少这么高，破纪录才放大横幅
const MULT_CAP = [0.2, 6]; // 倍率上下限，免得一个动作直接跑完全程

// ================================================================ 规则

export class Rules extends Base {
  static defaults = {
    maxPerTeam: 5,
    course: 1000, roundLen: 10 * 60e3, lives: 3, offline: 15e3,
    partyCourse: 520, partyRoundLen: 5 * 60e3, partyLives: 2, partyOffline: 10e3,
  };

  init() {
    const o = this.opts;
    const pick = (k) => (o.party ? o[`party${k[0].toUpperCase()}${k.slice(1)}`] : o[k]);
    [this.course, this.roundLen, this.maxLives, this.offLen] = ['course', 'roundLen', 'lives', 'offline'].map(pick);
    this.lanes = { claude: this.newLane('claude'), codex: this.newLane('codex') };
  }

  /** 一条跑道：dist 是这一局跑了多远（决定胜负）；run 是右上角的记分，撞一下清零，跨局累计；hi 是最高纪录。 */
  newLane(team) {
    return { team, dist: 0, obs: this.genObs(team), next: 0, run: 0, hi: 0, mile: 0, hiAnn: false, offUntil: 0, nightUntil: 0, nightAnn: -1e15 };
  }

  /** 这一局这条跑道上的障碍：只看回合数、开局时刻和队伍，确定性的。越往后越密，翼龙要跑一段才出现。 */
  genObs(team) {
    const r = rng(hash(`dino:${team}:${this.round}:${this.roundStart}`));
    const k = Math.sqrt(this.course / 1000);
    const out = [];
    let d = (150 + r() * 80) * k;
    while (d < this.course - 50) {
      const f = d / this.course;
      if (f > (this.party ? 0.15 : 0.3) && r() < 0.3) out.push({ d: Math.round(d), kind: 'ptero', h: Math.floor(r() * 3) });
      else out.push({ d: Math.round(d), kind: r() < 0.35 + 0.25 * f ? 'big' : 'small', n: [1, 1, 1, 2, 2, 3][Math.floor(r() * 6)] });
      d += (110 + r() * 150) * k * (1 - 0.3 * f);
    }
    return out;
  }

  initPlayer(p) {
    Object.assign(p, { lives: this.maxLives, rnd: -1, downUntil: 0, downWhy: null, charge: 0, invinc: 0 });
  }

  onEnter(p) {
    // 同一局里挂机回来：命数照旧，GAME OVER 了的还是 GAME OVER（底座上场时会把 alive 设回 true）
    if (p.rnd === this.round && this.phase === 'live') {
      if (p.lives <= 0) p.alive = false;
      return;
    }
    Object.assign(p, { lives: this.maxLives, rnd: this.round, downUntil: 0, charge: 0, invinc: 0 });
  }

  onRoundStart(fx) {
    for (const t of TEAMS) Object.assign(this.lanes[t], { dist: 0, obs: this.genObs(t), next: 0, offUntil: 0, nightUntil: 0 });
    for (const p of this.field()) Object.assign(p, { alive: true, lives: this.maxLives, rnd: this.round, downUntil: 0, charge: 0, invinc: 0 });
    fx.push({ type: 'dinoRound', round: this.round });
  }

  /**
   * 速度倍率。两队共用一条跑道比谁先到终点（不是比谁先把对面打光），
   * 所以在均衡火力 × 人数修正之外再乘 √(本队人数 / 对面人数)：合起来就是「两条跑道一样快」，
   * 动作多的一方不会光靠刷量赢，比的是撞得少、跳得好。
   */
  mult(p) {
    const pool = (t) => Math.max(1, this.field(t).length);
    const m = this.balanceMult(p.team) * this.sizeMult() * Math.sqrt(pool(p.team) / pool(OTHER[p.team]));
    return clamp(m, MULT_CAP[0], MULT_CAP[1]);
  }

  ghostOk(ev) {
    return ev.k === 'prompt'; // GAME OVER 之后只有「按空格」（你发的新指令）能让它重来
  }

  onEvent(p, ev, r, fx) {
    if (this.phase !== 'live') return;
    const ln = this.lanes[p.team];
    if (!p.alive) {
      if (ev.k === 'prompt') this.revive(p, ln, fx);
      return;
    }
    if (ev.ok === false && (ev.k in STEP || ev.k === 'agent')) {
      this.oops(p, ln, ev, fx);
      return;
    }
    switch (ev.k) {
      case 'shell':
        if (ev.hs) {
          p.hs++;
          this.go(p, ln, STEP.shell * SUPER, 'super', fx);
        } else this.go(p, ln, STEP.shell, 'run', fx);
        break;
      case 'read':
      case 'edit':
      case 'misc':
        this.go(p, ln, STEP[ev.k], 'run', fx);
        break;
      case 'web':
        this.go(p, ln, STEP.web * SPRINT, 'web', fx);
        break;
      case 'agent':
        p.a++;
        this.go(p, ln, STEP.shell * BOOST, 'boost', fx);
        break;
      case 'think':
        p.charge = 1; // 蓄力（思考太频繁，不单独发效果，画面直接看规则状态）
        break;
      case 'done':
        this.night(p, ln, fx);
        this.go(p, ln, STEP.shell * NIGHT_RUN, 'night', fx);
        break;
      case 'compact':
        p.downUntil = Math.max(p.downUntil, this.now + LAG);
        p.downWhy = 'lag';
        fx.push({ type: 'dinoLag', team: p.team, sid: p.sid });
        break;
      case 'prompt':
        this.go(p, ln, STEP.shell * SPACE, 'space', fx);
        break;
      case 'abort':
        fx.push({ type: 'dinoUnplug', team: p.team, sid: p.sid });
        this.crash(p, ln, 'plug', fx, { cause: 'human', weapon: L('🔌 拔网线', '🔌 Unplugged') }, true);
        break;
      case 'apierr':
        this.offline(p, ln, fx);
        break;
      case 'pr':
        p.downUntil = 0; // 无敌冲刺：趴着也立刻爬起来，断网也照冲
        this.go(p, ln, STEP.shell * DASH, 'dash', fx);
        p.invinc = INVINC;
        break;
    }
  }

  /** 往前跑 base 米（乘倍率前）：路上经过的障碍全部跳过 / 钻过。how 只决定画面怎么演。 */
  go(p, ln, base, how, fx) {
    const now = this.now;
    if (how !== 'dash') {
      if (now < ln.offUntil) {
        fx.push({ type: 'dinoStuck', team: p.team, sid: p.sid, why: 'net' });
        return;
      }
      if (now < p.downUntil) {
        fx.push({ type: 'dinoStuck', team: p.team, sid: p.sid, why: p.downWhy });
        return;
      }
    }
    const m = this.mult(p);
    let amount = base * m;
    const charged = p.charge > 0 && how !== 'space' && how !== 'resume';
    if (charged) {
      amount *= CHARGE;
      p.charge = 0;
    }
    if (now < ln.nightUntil) amount *= NIGHT_MULT;
    // 上网查资料正好碰上翼龙：低头钻过去，顺势多冲半步
    let ducked = false;
    if (how === 'web') {
      for (let i = ln.next; i < ln.obs.length && ln.obs[i].d <= ln.dist + amount; i++) if (ln.obs[i].kind === 'ptero') ducked = true;
      if (ducked) amount += STEP.web * DUCK * m;
    }
    const from = ln.dist;
    const to = from + amount;
    const cleared = [];
    while (ln.next < ln.obs.length && ln.obs[ln.next].d <= to) cleared.push(ln.next++);
    ln.dist = to;
    p.dmg += Math.round(amount);
    p.k += cleared.length;
    if (p.invinc > 0 && how !== 'dash') p.invinc--;
    fx.push({ type: 'dinoRun', team: p.team, sid: p.sid, from, to, how: ducked ? 'duck' : how, cleared, charged });
    this.addScore(ln, amount, fx);
  }

  /** 右上角的记分：每 100 分「嘀」一声闪一下；超过最高纪录（一次）放「新纪录」。 */
  addScore(ln, amount, fx) {
    ln.run += amount;
    const mile = Math.floor(ln.run / 100);
    if (mile > ln.mile) {
      ln.mile = mile;
      fx.push({ type: 'dinoMile', team: ln.team, n: mile * 100 });
    }
    if (ln.run <= ln.hi) return;
    const prev = ln.hi;
    ln.hi = ln.run;
    if (ln.hiAnn) return;
    ln.hiAnn = true;
    if (prev < HI_MIN) return;
    fx.push({ type: 'dinoHi', team: ln.team, hi: Math.floor(prev) });
    fx.push({
      type: 'announce', text: L('新纪录！', 'New high score!'),
      sub: L(`${TEAM_NAME[ln.team]} 一路没撞，超过了 HI ${pad(prev)}`, `${TEAM_NAME[ln.team]} beat HI ${pad(prev)} without a crash`), cls: 'gold', ms: 1800,
    });
  }

  /** 动作报错：一头撞上前面的障碍（够得着的话先跑过去），够不着就是被石头绊倒。 */
  oops(p, ln, ev, fx) {
    const now = this.now;
    if (now < ln.offUntil) return fx.push({ type: 'dinoStuck', team: p.team, sid: p.sid, why: 'net' });
    if (now < p.downUntil) return fx.push({ type: 'dinoStuck', team: p.team, sid: p.sid, why: p.downWhy }); // 已经趴着了，不会再掉命
    if (p.invinc > 0) {
      p.invinc--;
      return fx.push({ type: 'dinoShield', team: p.team, sid: p.sid });
    }
    const ob = ln.obs[ln.next];
    let what = 'rock';
    if (ob && ob.d - ln.dist <= (STEP[ev.k] || STEP.shell) * this.mult(p)) {
      what = ob.kind === 'ptero' ? 'ptero' : 'cactus';
      ln.dist = Math.max(ln.dist, ob.d - 4);
    }
    const weapon = { ptero: L('🦅 翼龙', '🦅 Pterodactyl'), cactus: L('🌵 仙人掌', '🌵 Cactus'), rock: L('🪨 石头', '🪨 Rock') }[what];
    this.crash(p, ln, what, fx, { cause: 'bug', weapon });
  }

  /** 撞了：掉一条命、趴一会儿、这条跑道的记分清零；没命了就 GAME OVER。lethal = 直接没命。 */
  crash(p, ln, what, fx, info, lethal = false) {
    p.lives = lethal ? 0 : p.lives - 1;
    p.d++;
    p.invinc = 0;
    p.downUntil = this.now + STUN;
    p.downWhy = 'crash';
    const lost = Math.floor(ln.run);
    Object.assign(ln, { run: 0, mile: 0, hiAnn: false });
    fx.push({ type: 'dinoCrash', team: p.team, sid: p.sid, what, lives: p.lives, lost });
    if (p.lives > 0) return;
    p.lives = 0;
    p.alive = false;
    p.downUntil = 0;
    fx.push({ type: 'kill', killer: null, victim: p.sid, weapon: info.weapon, cause: info.cause });
    fx.push({ type: 'dinoOver', team: p.team, sid: p.sid });
    fx.push({ type: 'announce', text: 'GAME OVER', sub: L(`${p.name} · 发条新指令 = 按空格重来`, `${p.name} · send a prompt = press space to restart`), cls: 'bad', ms: 1500 });
  }

  /** 你发了新指令 = 按空格：GAME OVER 的恐龙带一条命重新开始。 */
  revive(p, ln, fx) {
    Object.assign(p, { alive: true, lives: 1, downUntil: 0, charge: 0, invinc: 0 });
    fx.push({ type: 'dinoRevive', team: p.team, sid: p.sid });
    fx.push({ type: 'note', text: L('␣ {0} 按下空格：重新开始！', '␣ {0} pressed space: restart!'), sids: [p.sid] });
    this.go(p, ln, STEP.shell, 'space', fx);
  }

  /** API 报错：整条跑道弹出「无法访问此网站」，断网这段时间谁的动作都不算数。 */
  offline(p, ln, fx) {
    const was = this.now < ln.offUntil;
    ln.offUntil = this.now + this.offLen;
    fx.push({ type: 'dinoOffline', team: p.team, sid: p.sid, until: ln.offUntil });
    if (!was) fx.push({ type: 'announce', text: L('无法访问此网站', 'No internet'), sub: `ERR_INTERNET_DISCONNECTED · ${TEAM_NAME[p.team]}`, cls: 'bad', ms: 2000 });
  }

  /** 任务完成：经典的昼夜翻转，这条跑道天黑一阵子，夜跑更快。 */
  night(p, ln, fx) {
    const was = this.now < ln.nightUntil;
    ln.nightUntil = this.now + NIGHT_LEN;
    if (was) return;
    fx.push({ type: 'dinoNight', team: p.team, sid: p.sid });
    if (this.now - ln.nightAnn < NIGHT_ANN) return;
    ln.nightAnn = this.now;
    fx.push({ type: 'announce', text: L('🌙 夜间模式', '🌙 Night mode'), sub: L(`${TEAM_NAME[p.team]} 的跑道天黑了 · 夜跑更快`, `Lights out on ${TEAM_NAME[p.team]}'s lane · night runs are faster`), cls: p.team, ms: 1400 });
  }

  // 它在等你：恐龙站着不动。及时回 = 接着跑；超时 = 撞上翼龙（无敌也挡不住）
  onWait(p, fx) {
    fx.push({ type: 'dinoWait', team: p.team, sid: p.sid });
  }

  onAnswer(p, wait, fx) {
    if (this.phase === 'live' && p.alive) this.go(p, this.lanes[p.team], STEP.shell * RESUME, 'resume', fx);
  }

  onWaitTimeout(p, fx) {
    if (this.phase !== 'live' || !p.alive) return;
    this.crash(p, this.lanes[p.team], 'ptero', fx, { cause: 'ptero', weapon: L('🦅 翼龙', '🦅 Pterodactyl') });
  }

  /** 定时器只有一个：这一局的时间上限。断网、夜间、趴地上都是拿事件时刻比，不需要准点结算。 */
  timers() {
    return [this.roundStart + this.roundLen];
  }

  onTick(fx) {
    if (this.now < this.roundStart + this.roundLen) return;
    const [a, b] = TEAMS.map((t) => this.lanes[t].dist);
    if (a + b > 0) this.win(this.leader(), 'time', fx);
    else this.roundStart = this.now; // 谁都没跑：重新计时
  }

  leader() {
    const [a, b] = TEAMS.map((t) => this.lanes[t].dist);
    return a > b ? 'claude' : b > a ? 'codex' : null;
  }

  check(fx) {
    for (const team of TEAMS) {
      if (this.lanes[team].dist >= this.course) return this.win(team, 'finish', fx);
    }
    for (const team of TEAMS) {
      const f = this.field(team);
      if (f.length && f.every((p) => !p.alive)) return this.win(OTHER[team], 'gameover', fx, team);
    }
  }

  win(team, reason, fx, loser = null) {
    const [a, b] = TEAMS.map((t) => Math.floor(this.lanes[t].dist));
    fx.push({ type: 'dinoEnd', winner: team, reason, loser, dist: { claude: a, codex: b } });
    const text = {
      finish: () => L(`${TEAM_NAME[team]} 先跑完 ${this.course} 米`, `${TEAM_NAME[team]} reached ${this.course}m first`),
      gameover: () => L(`${TEAM_NAME[loser]} 全员 GAME OVER`, `${TEAM_NAME[loser]}: everyone GAME OVER`),
      time: () => L(`时间到 · 跑了 ${a} : ${b} 米`, `Time up · ${a}m : ${b}m`),
    }[reason]();
    this.endRound(team, reason, fx, text);
  }
}

const pad = (n) => String(Math.min(99999, Math.floor(n))).padStart(5, '0'); // 原版的计分板：五位数，封顶 99999

// ================================================================ 像素图
// 字符画：# 是一个像素。画的时候按行合并成横条，一次 fillRect 一条。

function sprite(rows) {
  const runs = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue;
      let e = x;
      while (row[e] === '#') e++;
      runs.push([x, y, e - x]);
      x = e;
    }
  });
  return { runs, w: Math.max(...rows.map((r) => r.length)), h: rows.length };
}

function blit(g, s, x, y, px, color) {
  g.fillStyle = color;
  for (const [cx, cy, n] of s.runs) g.fillRect(x + cx * px, y + cy * px, n * px + 0.4, px + 0.4);
}

// 霸王龙：身子 + 三种腿（站着 / 迈左腿 / 迈右腿）
const REX_BODY = [
  '............##########',
  '...........##.########',
  '...........###########',
  '...........###########',
  '...........###########',
  '...........#####......',
  '...........########...',
  '..........#####.......',
  '#........######.......',
  '#.......########......',
  '##.....##########.....',
  '###...########.##.....',
  '#############...#.....',
  '#############.........',
  '.############.........',
  '..##########..........',
  '...########...........',
  '....######............',
];
const REX_LEGS = {
  stand: ['....###.##............', '....##...#............', '....#....#............', '....##...##...........'],
  a: ['....###.##............', '....##...###..........', '....#.................', '....##................'],
  b: ['....###.##............', '...###...#............', '.........#............', '.........##...........'],
};
const REX = Object.fromEntries(Object.entries(REX_LEGS).map(([k, legs]) => [k, sprite(REX_BODY.concat(legs))]));
// 低头跑：身子放平，头伸到前面
const DUCK_BODY = [
  '....................########',
  '#.......#########..##.######',
  '##....######################',
  '############################',
  '.#######################....',
  '..##############.#######....',
  '...###########..##..........',
  '....########................',
];
const DUCKS = [
  sprite(DUCK_BODY.concat(['....###.##..................', '....##...###................', '....##......................'])),
  sprite(DUCK_BODY.concat(['....###.##..................', '...###...#..................', '.........##.................'])),
];
const CACTUS = sprite([
  '...###...', '..#####..', '..#####..', '#.#####..', '#.#####.#', '#.#####.#', '#.#####.#', '#########',
  '.#######.', '..#####..', '..#####..', '..#####..', '..#####..', '..#####..', '..#####..', '..#####..',
]);
// 翼龙两帧：翅膀朝上 / 朝下（头朝左，迎面飞过来）
const PTERO = [
  sprite(['......#...........', '......##..........', '......###.........', '...#..####........', '..##..#####.......', '.###..######......', '################..', '....###########...', '......########....', '........#####.....']),
  sprite(['...#..............', '..##..............', '.###..............', '################..', '....############..', '......########....', '......#####.......', '......####........', '......###.........', '......##..........']),
];
const CLOUD = sprite([
  '..........######.......', '........##......##.....', '....####..........#....', '...#...............###.',
  '.##...................#', '#.....................#', '#######################',
]);
const HEART = sprite(['.#.#.', '#####', '#####', '.###.', '..#..']);

// ================================================================ 画面
// 上下两条跑道，每条像一个单独的 Chrome 窗口：白底、灰色像素恐龙、地平线、云。天黑了就整条反色。

const { w: W } = WORLD;
const LANE_H = 452;
const LANE_Y = { claude: 16, codex: 492 };
const GROUND = 352; // 地平线离跑道顶部多远
const PX = 2; // 一米 = 2 个世界像素
const DP = 4; // 恐龙的一个像素有多大
const REX_W = 22 * DP;
const FRONT_X = 600; // 领跑恐龙的左边
const NOSE = FRONT_X + REX_W; // 规则里的跑道距离对应领跑恐龙的鼻尖
const SLOT = 100; // 恐龙之间的间隔
const SCORE_X = 1330; // 计分板右边缘（再往右是 app 的击杀播报，别被挡住）
const PAT = 1800; // 地面花纹多长循环一次
const DAY = { bg: [247, 247, 247], ink: [83, 83, 83], soft: [172, 172, 172], faint: [226, 226, 226] };
const NIGHT = { bg: [32, 33, 36], ink: [225, 225, 225], soft: [120, 120, 124], faint: [58, 59, 64] };
const MONO = `"Courier New", ui-monospace, Menlo, monospace`;

const mixc = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
const palette = (k) => Object.fromEntries(Object.keys(DAY).map((key) => [key, mixc(DAY[key], NIGHT[key], k)]));
const mod = (a, n) => ((a % n) + n) % n;
const obW = (ob) => (ob.kind === 'ptero' ? 58 : ob.kind === 'big' ? ob.n * 36 + 4 : ob.n * 25 + 2);
const PTERO_Y = [14, 58, 100]; // 翼龙离地多高：低（要跳）、中（低头或跳）、高（直接从下面跑过去）

// 撞上什么 / 怎么跑的飘字（写成函数，显示的时候才按当前语言取）
const OUCH = {
  cactus: () => L('🌵 撞仙人掌', '🌵 Hit a cactus'),
  ptero: () => L('🦅 撞上翼龙', '🦅 Hit a pterodactyl'),
  rock: () => L('🪨 被石头绊倒', '🪨 Tripped on a rock'),
  plug: () => L('🔌 你拔了网线', '🔌 You pulled the plug'),
};
const STAMP = {
  finish: () => L('🏁 冲线！', '🏁 FINISH!'),
  time: () => L('⏱ 时间到 · 领先', '⏱ TIME UP · AHEAD'),
  gameover: () => L('🏆 对面全员 GAME OVER', '🏆 THEY ALL CRASHED'),
};
const HOW = {
  super: () => [L('🎯 超级跳！', '🎯 Super jump!'), '#f5c451'],
  boost: () => [L('🚀 加速道具', '🚀 Speed boost'), '#ffb35a'],
  dash: () => [L('🏆 无敌冲刺！', '🏆 Invincible dash!'), '#f5c451'],
  night: () => [L('🌙 夜跑', '🌙 Night run'), '#a8b8ff'],
  space: () => [L('␣ 按空格开始', '␣ Press space'), '#9fd0ff'],
  resume: () => [L('▶ 接着跑', '▶ Back to running'), '#6fd38b'],
  duck: () => [L('🔭 低头！', '🔭 Duck!'), '#9fd0ff'],
};

// 地面花纹：小石子、地平线上的小鼓包（一次生成，所有跑道共用）
let ground = null;
function groundPattern() {
  if (ground) return ground;
  ground = { pebbles: [], bumps: [] };
  for (let x = 0; x < PAT; x += rand(14, 46)) ground.pebbles.push({ x, y: rand(6, 30), w: rand(2, 9), soft: Math.random() < 0.5 });
  for (let x = 60; x < PAT; x += rand(160, 420)) ground.bumps.push({ x, w: rand(18, 46), up: Math.random() < 0.6 });
  return ground;
}

class Runner {
  constructor(sid, team) {
    Object.assign(this, { sid, team, x: -REX_W - 20, order: 0, label: null, icon: null, crash: 0, dash: 0, phase: Math.random() * 50, air: 0, slot: 0 });
  }
}

/** 一条跑道的画面状态：显示用的距离（平滑追规则层）、障碍、昼夜、闪烁。 */
class Track {
  constructor(team) {
    this.team = team;
    this.clouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 430 + rand(0, 220), y: rand(80, 190) }));
    this.stars = Array.from({ length: 16 }, () => ({ x: rand(30, W - 30), y: rand(60, 230), t: rand(0, 6) }));
    this.load([], 0);
    Object.assign(this, { night: 0, nights: 0, wasNight: false });
  }

  load(obs, dist) {
    Object.assign(this, { obs, how: new Map(), disp: dist, tgt: dist, speed: 0, blink: 0, over: 0, offFlash: 0 });
  }
}

export class View {
  constructor(app) {
    this.app = app;
    groundPattern();
    this.fx = new Particles();
    this.tracks = { claude: new Track('claude'), codex: new Track('codex') };
    this.runners = new Map();
    this.seq = 0;
    this.freezeUntil = 0;
    this.pending = false;
    this.result = null;
  }

  reset(R) {
    this.fx.clear();
    this.runners.clear();
    Object.assign(this, { freezeUntil: 0, pending: false, result: null });
    this.loadRound(R, false);
  }

  /** 按规则状态重建两条跑道。fromStart：新一局从起跑线开始追（画面上看得见冲出去）。 */
  loadRound(R, fromStart) {
    this.result = null;
    for (const team of TEAMS) {
      const ln = R?.lanes?.[team];
      this.tracks[team].load(ln ? ln.obs : [], ln && !fromStart ? ln.dist : 0);
    }
    for (const [sid] of this.runners) if (!R?.players.get(sid)?.onField) this.runners.delete(sid);
    if (R) for (const p of R.field()) this.runner(R, p.sid);
  }

  runner(R, sid) {
    let r = this.runners.get(sid);
    const p = R.players.get(sid);
    if (!r && p && p.onField) {
      r = new Runner(sid, p.team);
      r.order = -this.runners.size; // 新来的排在最后面
      this.runners.set(sid, r);
    }
    return r;
  }

  frozen() {
    return this.app.rt() < this.freezeUntil;
  }

  /** 跑道上某个障碍现在在屏幕上的位置（左边）。 */
  obX(tr, ob) {
    return NOSE + (ob.d - tr.disp) * PX;
  }

  apply(list, R, busy) {
    const { app, fx } = this;
    for (const f of list) {
      const r = f.sid ? this.runner(R, f.sid) : null;
      const tr = f.team ? this.tracks[f.team] : null;
      const head = r ? [r.x + REX_W / 2, LANE_Y[r.team] + GROUND - 100 - r.air] : null;
      switch (f.type) {
        case 'act': {
          const text = f.ev.k === 'think' ? null : actText(f.ev);
          if (r && text && !(busy && f.ev.k === 'read')) r.label = { text, ok: f.ev.ok !== false, life: 1.7, ghost: !f.alive };
          break;
        }
        case 'bench':
          this.runners.delete(f.sid);
          break;
        case 'dinoRound':
          if (this.frozen()) this.pending = true;
          else this.loadRound(R, !busy);
          break;
        case 'dinoRun': {
          if (!r || !tr) break;
          r.order = ++this.seq; // 谁动了谁冲到最前面
          if (!this.pending) for (const i of f.cleared) tr.how.set(i, f.how);
          if (f.how === 'boost' || f.how === 'dash' || f.how === 'super') r.dash = busy ? 0.4 : 1.2;
          const tag = HOW[f.how]?.() || (f.charged && !busy ? [L('💭 蓄力跳', '💭 Charged jump'), '#d8c8ff'] : null);
          if (tag && !(busy && f.how === 'night')) fx.text(head[0], head[1] - 30, tag[0], tag[1], 15, 1.2);
          if (f.how === 'super' || f.how === 'dash') fx.sparks(head[0], head[1] + 40, '#f5c451', busy ? 4 : 12, 160);
          if (f.cleared.length && !busy && app.sfx.ok(0)) app.sfx.tone(f.how === 'super' ? 392 : 523, 0.05, 0.035, 'square', f.how === 'super' ? 1046 : 784); // 起跳「哔」
          if (f.how === 'dash' && app.sfx.ok(2)) [523, 659, 784, 1046].forEach((h, i) => app.sfx.tone(h, 0.08, 0.06, 'square', null, i * 0.06));
          if (r.icon && r.icon.text !== '🔌') r.icon = null;
          break;
        }
        case 'dinoMile':
          if (!tr) break;
          tr.blink = 1; // 原版每 100 分计分板闪几下、「嘀嘀」一声
          if (!busy) fx.text(SCORE_X - 100, LANE_Y[f.team] + 66, `${f.n}!`, '#f5c451', 15, 1);
          if (!busy && app.sfx.ok(1)) {
            app.sfx.tone(1046, 0.06, 0.04, 'square');
            app.sfx.tone(1568, 0.09, 0.04, 'square', null, 0.07);
          }
          break;
        case 'dinoHi':
          if (tr) tr.blink = 2;
          break;
        case 'dinoCrash': {
          if (!r) break;
          r.crash = 0.8;
          fx.text(head[0], head[1] - 26, OUCH[f.what](), '#ff8a7a', 15, 1.4);
          if (f.lost >= 100 && !busy) fx.text(SCORE_X - 120, LANE_Y[r.team] + 66, L(`记分清零 −${f.lost}`, `Score reset −${f.lost}`), '#ff8a7a', 13, 1.3);
          fx.sparks(head[0] + 30, head[1] + 60, '#8a8a8a', busy ? 3 : 10, 150);
          app.shake(0.15, 3);
          if (app.sfx.ok(2)) app.sfx.tone(196, 0.2, 0.07, 'square', 92);
          break;
        }
        case 'dinoOver':
          if (tr) tr.over = busy ? 0.8 : 2.2;
          if (app.sfx.ok(2)) [392, 330, 262, 196].forEach((h, i) => app.sfx.tone(h, 0.12, 0.06, 'square', null, i * 0.11));
          break;
        case 'dinoShield':
          if (r && !busy) fx.text(head[0], head[1] - 26, L('🛡 无敌，撞不动', '🛡 Invincible — no damage'), '#f5c451', 14, 1.2);
          break;
        case 'dinoStuck':
          if (r && !busy) fx.text(head[0], head[1] - 22, { net: L('📡 断网中…', '📡 Offline…'), lag: L('📶 重连中…', '📶 Reconnecting…') }[f.why] || L('😵 还趴着', '😵 Still down'), '#bbb', 12, 0.9);
          break;
        case 'dinoLag':
          if (r) r.icon = { text: '📶', life: LAG / 1000 };
          if (r && !busy) fx.text(head[0], head[1] - 26, L('📶 掉线重连', '📶 Connection dropped'), '#ddd', 14, 1.3);
          break;
        case 'dinoUnplug':
          if (r) r.icon = { text: '🔌', life: 2.5 };
          if (tr) tr.offFlash = busy ? 0.8 : 2.5; // 拔了网线，这条跑道闪一下断网页面
          break;
        case 'dinoOffline':
          app.shake(0.25, 5);
          if (app.sfx.ok(2)) app.sfx.tone(440, 0.35, 0.06, 'sawtooth', 110);
          break;
        case 'dinoWait':
          if (r) r.icon = { text: '⏳', life: 999 };
          break;
        case 'waitDone':
        case 'waitLate':
        case 'waitBoom':
          if (r && r.icon?.text === '⏳') r.icon = null;
          break;
        case 'dinoRevive':
          if (!r) break;
          fx.ring(head[0], head[1] + 50, 70, 8, 'rgba(160,210,255,0.9)', 0.6, 4);
          fx.text(head[0], head[1] - 30, L('␣ 重新开始！', '␣ Restart!'), '#9fd0ff', 16, 1.4);
          if (app.sfx.ok(1)) [523, 784].forEach((h, i) => app.sfx.tone(h, 0.08, 0.05, 'square', null, i * 0.08));
          break;
        case 'dinoEnd':
          // 一局结束：两条跑道定格在终点那一刻（规则层已经开了下一局），过一会儿再从起跑线重来
          for (const team of TEAMS) this.tracks[team].tgt = f.dist[team];
          this.result = { winner: f.winner, reason: f.reason, loser: f.loser };
          this.freezeUntil = app.rt() + (busy ? 0.4 : 2.8);
          break;
        case 'roundEnd':
          if (!this.frozen()) this.freezeUntil = app.rt() + (busy ? 0.4 : 2.8);
          break;
      }
    }
  }

  update(dt, R) {
    const frozen = this.frozen();
    if (!frozen && this.pending) {
      this.pending = false;
      this.loadRound(R, true);
    }
    const fast = Math.max(1, Math.sqrt(this.app.speed?.() || 1) / 2);
    const k = 1 - Math.exp(-dt * 2.2 * fast);
    for (const team of TEAMS) {
      const tr = this.tracks[team];
      const ln = R.lanes?.[team];
      if (ln && !frozen && !this.pending) tr.tgt = ln.dist;
      const before = tr.disp;
      const diff = tr.tgt - tr.disp;
      if (diff < -1) tr.disp = tr.tgt;
      else if (diff > 700) tr.disp = tr.tgt - 350; // 落后太多（拖进度条 / 超高倍速）：直接跳过去一大截
      else if (diff > 0) tr.disp += Math.max(diff * k, Math.min(diff, 14 * dt * fast));
      tr.speed = Math.max(0, tr.disp - before) / Math.max(dt, 1e-3); // 往回跳（新一局 / 拖进度条）不算倒着跑
      const isNight = frozen || this.pending ? tr.wasNight : !!ln && R.now < ln.nightUntil;
      if (isNight && !tr.wasNight) tr.nights++;
      tr.wasNight = isNight;
      tr.night += ((isNight ? 1 : 0) - tr.night) * Math.min(1, dt * 2.5);
      for (const key of ['blink', 'over', 'offFlash']) tr[key] = Math.max(0, tr[key] - dt);
    }
    for (const p of R.field()) this.runner(R, p.sid);
    for (const team of TEAMS) this.updatePack(dt, R, team);
    this.fx.update(dt);
  }

  /** 一群恐龙：刚动过的冲到最前面，趴下的、等你的、GAME OVER 的被地面带着往后退。 */
  updatePack(dt, R, team) {
    const tr = this.tracks[team];
    const pack = [];
    for (const r of this.runners.values()) {
      const p = R.players.get(r.sid);
      if (r.team === team && p) pack.push([r, p, this.stateOf(R, p)]);
    }
    const rank = { run: 0, down: 1, wait: 1, dead: 2 };
    pack.sort((a, b) => rank[a[2]] - rank[b[2]] || b[0].order - a[0].order);
    const scroll = tr.speed * PX;
    pack.forEach(([r, p, st], i) => {
      r.slot = i;
      for (const key of ['crash', 'dash']) r[key] = Math.max(0, r[key] - dt);
      if (r.label && (r.label.life -= dt) <= 0) r.label = null;
      if (r.icon && (r.icon.life -= dt) <= 0) r.icon = null;
      const before = r.x;
      if (st === 'run') r.x += (FRONT_X - i * SLOT - r.x) * (1 - Math.exp(-dt * 3));
      else r.x = Math.max(16 + (pack.length - 1 - i) * 26, r.x - scroll * dt);
      r.moving = st === 'run' && (tr.speed > 2 || Math.abs(r.x - before) > 20 * dt);
      r.phase += (st === 'run' ? scroll + Math.abs(r.x - before) / Math.max(dt, 1e-3) : 0) * dt;
      // 跳不跳、低不低头：看已经越过的障碍是不是正从脚下经过（跟着地面走，倍速也对得上）
      let air = 0;
      r.duck = false;
      if (st === 'run') {
        const nose = r.x + REX_W;
        for (let j = 0; j < tr.obs.length; j++) {
          const ob = tr.obs[j];
          if (ob.d > tr.tgt + 1e-6) break;
          const ox = this.obX(tr, ob);
          const ow = obW(ob);
          const u = (nose + 50 - ox) / (135 + ow);
          if (u < 0 || u > 1) continue;
          const how = tr.how.get(j);
          if (ob.kind === 'ptero' && (ob.h === 2 || (ob.h === 1 && how === 'duck'))) {
            if (how === 'duck') r.duck = true;
            continue;
          }
          const big = how === 'super' || how === 'dash' ? 1.45 : 1;
          air = Math.max(air, (ob.kind === 'big' ? 108 : ob.kind === 'ptero' ? (ob.h ? 135 : 96) : 82) * big * 4 * u * (1 - u));
        }
      }
      r.air = air;
    });
  }

  stateOf(R, p) {
    if (!p.alive) return 'dead';
    if (R.now < p.downUntil) return 'down';
    if (R.waiting(p)) return 'wait';
    return 'run';
  }

  render(g, R, scale) {
    const rt = this.app.rt();
    g.fillStyle = '#16171a';
    g.fillRect(0, 0, W, WORLD.h);
    for (const team of TEAMS) this.renderLane(g, R, this.tracks[team], scale, rt);
    this.fx.renderOver(g, scale);
  }

  renderLane(g, R, tr, scale, rt) {
    const y0 = LANE_Y[tr.team];
    const gy = y0 + GROUND;
    const pal = palette(tr.night);
    const ln = R.lanes?.[tr.team];
    const frozen = this.frozen() || this.pending;
    g.save();
    g.beginPath();
    g.rect(0, y0, W, LANE_H);
    g.clip();
    g.fillStyle = pal.bg;
    g.fillRect(0, y0, W, LANE_H);
    this.drawSky(g, tr, y0, pal, rt);
    this.drawGround(g, tr, gy, pal);
    this.drawFinish(g, R, tr, gy, pal);
    this.drawObstacles(g, tr, gy, pal, rt);
    this.drawPack(g, R, tr, gy, pal, rt, fontFor(scale));
    this.drawHeader(g, R, tr, y0, pal, frozen);
    if (R.phase !== 'live' && !frozen) this.drawIntro(g, y0, pal, rt);
    if ((ln && !frozen && R.now < ln.offUntil) || tr.offFlash > 0) this.drawNoInternet(g, R, tr, ln, y0, pal, rt);
    const res = frozen && this.result;
    if (res && res.winner === tr.team) this.drawStamp(g, y0, pal, STAMP[res.reason](), false);
    else if (res || tr.over > 0) this.drawStamp(g, y0, pal, 'G A M E   O V E R', true);
    g.restore();
  }

  /** 天上：白天一个淡淡的太阳，晚上月亮（每晚换一个月相）和一闪一闪的星星；云慢慢往后飘。 */
  drawSky(g, tr, y0, pal, rt) {
    const k = tr.night;
    const [cx, cy] = [1480, y0 + 150];
    if (k < 1) {
      g.globalAlpha = 1 - k;
      g.strokeStyle = pal.faint;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, cy, 22, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = pal.faint;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillRect(cx + Math.cos(a) * 34 - 3, cy + Math.sin(a) * 34 - 3, 6, 6);
      }
    }
    if (k > 0) {
      g.globalAlpha = k;
      g.fillStyle = pal.ink;
      for (const s of tr.stars) {
        const tw = (Math.sin(rt * 2 + s.t) + 1) / 2;
        const z = tw > 0.5 ? 3 : 2;
        g.fillRect(s.x, y0 + s.y, z, z);
        if (tw > 0.85) g.fillRect(s.x - 3, y0 + s.y + 1, 9, 1);
      }
      const phase = [-20, -12, -6, 0, 6, 12, 20][tr.nights % 7]; // 原版的月亮有 7 个月相
      g.fillStyle = pal.ink;
      g.beginPath();
      g.arc(cx, cy, 20, 0, Math.PI * 2);
      g.fill();
      if (phase) {
        g.fillStyle = pal.bg;
        g.beginPath();
        g.arc(cx + phase, cy - 3, 18, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    for (const c of tr.clouds) blit(g, CLOUD, mod(c.x - tr.disp * PX * 0.2, 2150) - 200, y0 + c.y, 3, pal.soft);
  }

  /** 地平线 + 鼓包 + 小石子，跟着跑动往左滚。 */
  drawGround(g, tr, gy, pal) {
    const s = mod(tr.disp * PX, PAT);
    g.fillStyle = pal.ink;
    g.fillRect(0, gy, W, 2);
    for (let rep = 0; rep * PAT - s < W + PAT; rep++) {
      const base = rep * PAT - s;
      for (const b of ground.bumps) {
        const x = base + b.x;
        if (x < -60 || x > W + 10) continue;
        g.fillStyle = pal.bg;
        g.fillRect(x + 4, gy, b.w - 8, 2);
        g.fillStyle = pal.ink;
        const dy = b.up ? -3 : 2;
        g.fillRect(x, gy + dy / 3, 4, 2);
        g.fillRect(x + 4, gy + dy, b.w - 8, 2);
        g.fillRect(x + b.w - 4, gy + dy / 3, 4, 2);
      }
      for (const p of ground.pebbles) {
        const x = base + p.x;
        if (x < -10 || x > W + 10) continue;
        g.fillStyle = p.soft ? pal.soft : pal.ink;
        g.fillRect(x, gy + p.y, p.w, 2);
      }
    }
  }

  /** 终点：黑白格子旗 + 地上一条格子线。 */
  drawFinish(g, R, tr, gy, pal) {
    const x = NOSE + ((R.course || 1000) - tr.disp) * PX;
    if (x > W + 60 || x < -60) return;
    g.fillStyle = pal.ink;
    g.fillRect(x, gy - 150, 3, 150);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) {
      g.fillStyle = (i + j) % 2 ? pal.bg : pal.ink;
      g.fillRect(x + 3 + i * 7, gy - 150 + j * 7, 7, 7);
    }
    g.strokeStyle = pal.ink;
    g.lineWidth = 1;
    g.strokeRect(x + 3, gy - 150, 56, 35);
    for (let j = 0; j < 4; j++) {
      g.fillStyle = j % 2 ? pal.bg : pal.ink;
      g.fillRect(x - 3, gy + 4 + j * 6, 6, 6);
      g.fillStyle = j % 2 ? pal.ink : pal.bg;
      g.fillRect(x + 3, gy + 4 + j * 6, 6, 6);
    }
  }

  drawObstacles(g, tr, gy, pal, rt) {
    tr.obs.forEach((ob, i) => {
      const x = this.obX(tr, ob);
      if (x > W + 20 || x + obW(ob) < -20) return;
      if (ob.kind === 'ptero') {
        const s = PTERO[Math.floor(rt * 6 + i) % 2];
        blit(g, s, x, gy - PTERO_Y[ob.h] - s.h * 3.2, 3.2, pal.ink);
        return;
      }
      const px = ob.kind === 'big' ? 4.4 : 3;
      const step = ob.kind === 'big' ? 36 : 25;
      for (let k = 0; k < ob.n; k++) blit(g, CACTUS, x + k * step, gy + 2 - CACTUS.h * px + (k % 2) * px * 2, px, pal.ink);
    });
  }

  drawPack(g, R, tr, gy, pal, rt, fs) {
    const pack = [...this.runners.values()].filter((r) => r.team === tr.team && R.players.get(r.sid)).sort((a, b) => b.slot - a.slot);
    for (const r of pack) this.drawRunner(g, R, r, R.players.get(r.sid), tr, gy, pal, rt);
    const live = this.app.mode === 'live';
    for (const r of pack) this.drawTags(g, R, r, R.players.get(r.sid), gy, pal, rt, fs, live);
  }

  drawRunner(g, R, r, p, tr, gy, pal, rt) {
    const st = this.stateOf(R, p);
    const base = gy + 2 - r.air;
    const accent = COLOR[r.team];
    g.globalAlpha = st === 'dead' ? 0.55 : 1;
    // 无敌冲刺 / 加速：身后拖几个残影
    if (r.dash > 0 && st === 'run') {
      for (let i = 3; i >= 1; i--) {
        g.globalAlpha = 0.12 * (4 - i) * Math.min(1, r.dash * 2);
        this.rex(g, r.x - i * 26, base, 'stand', 0, accent, pal, accent, false);
      }
      g.globalAlpha = 1;
      g.fillStyle = pal.soft;
      for (let i = 0; i < 4; i++) g.fillRect(r.x - 70 - ((rt * 900 + i * 53) % 120), base - 20 - i * 16, 40, 2);
    }
    if (p.invinc > 0 && st === 'run' && Math.floor(rt * 10) % 2) g.globalAlpha = 0.45; // 无敌：一闪一闪
    const frame = mod(Math.floor(r.phase / 26), 2);
    const lost = (this.frozen() || this.pending) && this.result && this.result.winner !== r.team; // 一局输了：定格成 × 眼
    let pose = 'stand';
    if (st === 'run' && r.duck && !lost) pose = 'duck';
    else if (st === 'run' && r.moving && r.air <= 0 && !lost) pose = 'run';
    const xEyes = st === 'dead' || st === 'down' || r.crash > 0 || lost;
    // 撞了趴下：往前栽一点
    if (st === 'down' && p.downWhy === 'crash') {
      g.save();
      g.translate(r.x + REX_W / 2, base);
      g.rotate(0.18);
      this.rex(g, -REX_W / 2, 0, 'stand', 0, pal.ink, pal, accent, true);
      g.restore();
    } else this.rex(g, r.x, base, pose, frame, pal.ink, pal, accent, xEyes);
    g.globalAlpha = 1;
    // 命：地面下面一排小心心
    if (st !== 'dead') {
      const n = Math.max(p.lives, R.maxLives || 3);
      for (let i = 0; i < n; i++) blit(g, HEART, r.x + REX_W / 2 - n * 8 + i * 16 + 2, gy + 36, 2.4, i < p.lives ? pal.ink : pal.faint);
    }
  }

  /** 画一只像素霸王龙。base 是脚底的 y；accent 是队色头巾。 */
  rex(g, x, base, pose, frame, ink, pal, accent, xEyes) {
    if (pose === 'duck') {
      const s = DUCKS[frame];
      const y = base - s.h * DP;
      blit(g, s, x, y, DP, ink);
      g.fillStyle = accent;
      g.fillRect(x + 16 * DP, y + 2 * DP, 3 * DP, DP);
      return;
    }
    const s = REX[pose === 'run' ? (frame ? 'b' : 'a') : 'stand'];
    const y = base - s.h * DP;
    blit(g, s, x, y, DP, ink);
    // 队色头巾：脖子上一圈，尾巴在身后飘
    g.fillStyle = accent;
    g.fillRect(x + 10 * DP, y + 7 * DP, 5 * DP, DP);
    g.fillRect(x + 8 * DP, y + (frame ? 7 : 8) * DP, 2 * DP, DP);
    if (!xEyes) return;
    // 撞了：眼睛变成 ×
    g.fillStyle = pal.bg;
    g.fillRect(x + 12 * DP, y, 3 * DP, 3 * DP);
    g.fillStyle = ink;
    for (const [cx, cy] of [[12, 0], [14, 0], [13, 1], [12, 2], [14, 2]]) g.fillRect(x + cx * DP, y + cy * DP, DP, DP);
  }

  drawTags(g, R, r, p, gy, pal, rt, fs, live) {
    const st = this.stateOf(R, p);
    const cx = r.x + REX_W / 2;
    const top = gy - 88 - r.air;
    const y = top - 14 - (r.slot % 2) * 26;
    g.globalAlpha = st === 'dead' ? 0.6 : 1;
    pill(g, cx, y, p.name, { color: COLOR[r.team], size: fs, max: 112 });
    g.globalAlpha = 1;
    if (st === 'dead') {
      g.font = `700 13px ${MONO}`;
      g.textAlign = 'center';
      g.fillStyle = pal.ink;
      g.fillText('GAME OVER', cx, gy + 44);
    }
    if (r.label) {
      g.globalAlpha = Math.min(1, r.label.life / 0.4) * (r.label.ghost ? 0.45 : 1);
      pill(g, cx, y - fs - 8 - (1.7 - r.label.life) * 6, r.label.text, {
        size: fs - 1, max: 190, weight: 500, bg: r.label.ok ? 'rgba(10,12,16,0.72)' : 'rgba(120,20,20,0.8)',
      });
      g.globalAlpha = 1;
    }
    if (r.icon) {
      g.font = `${fs + 8}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(r.icon.text, cx + 52, top + 6);
    }
    // 太久没动静：打瞌睡
    if (st === 'run' && R.now - p.lastActive > (live ? 60e3 : 90e3)) {
      const t = (rt * 0.6 + r.x / 97) % 1;
      g.globalAlpha = 1 - t;
      g.fillStyle = pal.ink;
      g.font = `700 ${fs}px sans-serif`;
      g.fillText('z', cx + 40 + t * 8, top + 10 - t * 18);
      g.globalAlpha = 1;
    }
  }

  /** 跑道顶上：左边队名，中间进度条（到终点还有多远），右边原版的「HI 00000 00000」计分板。 */
  drawHeader(g, R, tr, y0, pal, frozen) {
    const ln = R.lanes?.[tr.team];
    const cy = y0 + 28;
    g.fillStyle = COLOR[tr.team];
    g.fillRect(18, cy - 13, 6, 26);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `800 21px ${FONT}`;
    g.fillStyle = pal.ink;
    const name = TEAM_NAME[tr.team].toUpperCase();
    g.fillText(name, 34, cy);
    const nw = g.measureText(name).width;
    const n = R.field(tr.team).length;
    g.font = `600 14px ${FONT}`;
    g.fillStyle = pal.soft;
    g.fillText(L(`${n} 只恐龙`, `${n} dino${n === 1 ? '' : 's'}`), 44 + nw, cy + 1);
    // 进度条
    const course = R.course || 1000;
    const [bx, bw] = [330, 520];
    const f = clamp(tr.tgt / course, 0, 1);
    g.fillStyle = pal.faint;
    g.fillRect(bx, cy - 2, bw, 4);
    g.fillStyle = COLOR[tr.team];
    g.fillRect(bx, cy - 2, bw * f, 4);
    blit(g, REX.stand, bx + bw * f - 9, cy - 22, 1, pal.ink);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      g.fillStyle = (i + j) % 2 ? pal.bg : pal.ink;
      g.fillRect(bx + bw + 6 + i * 5, cy - 8 + j * 5, 5, 5);
    }
    g.font = `700 15px ${MONO}`;
    g.fillStyle = pal.ink;
    g.fillText(`${Math.floor(frozen ? tr.tgt : ln?.dist ?? 0)}/${course}m`, bx + bw + 30, cy + 1);
    // 计分板：每 100 分闪几下
    if (!ln) return;
    g.textAlign = 'right';
    g.font = `700 24px ${MONO}`;
    const cur = pad(ln.run);
    const show = tr.blink <= 0 || Math.floor(tr.blink * 8) % 2 === 1;
    if (show) {
      g.fillStyle = pal.ink;
      g.fillText(cur, SCORE_X, cy + 1);
    }
    const cw = g.measureText(`${cur}  `).width;
    g.fillStyle = pal.soft;
    g.fillText(`HI ${pad(ln.hi)}`, SCORE_X - cw, cy + 1);
  }

  /** 热身中：原版开头那只站着眨眼的恐龙旁边的提示。 */
  drawIntro(g, y0, pal, rt) {
    if (Math.floor(rt * 1.6) % 2) return;
    g.font = `700 22px ${MONO}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = pal.ink;
    g.fillText(L('按空格开始 · 等两队都有人', 'PRESS SPACE TO START · waiting for both teams'), W / 2 + 120, y0 + 200);
  }

  /** 「无法访问此网站」：整条跑道变成那张断网页面。 */
  drawNoInternet(g, R, tr, ln, y0, pal, rt) {
    const y = y0 + 52;
    const night = tr.night > 0.5;
    g.fillStyle = night ? '#202124' : '#ffffff';
    g.fillRect(0, y, W, LANE_H - 52);
    const ink = night ? '#e8eaed' : '#202124';
    const sub = night ? '#9aa0a6' : '#5f6368';
    const x0 = 520;
    const grey = night ? '#9aa0a6' : '#535353';
    this.rex(g, x0, y + 92, 'stand', 0, grey, { bg: night ? '#202124' : '#ffffff' }, grey, Math.floor(rt * 1.2) % 4 === 0); // 页面上那只灰色小恐龙（偶尔眨成 × 眼）
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = ink;
    g.font = `500 32px ${FONT}`;
    g.fillText(L('无法访问此网站', 'No internet'), x0, y + 150);
    g.font = `400 17px ${FONT}`;
    g.fillStyle = sub;
    g.fillText(L('请试试以下办法：', 'Try:'), x0, y + 190);
    g.fillText(L('• 检查网线、调制解调器和路由器', '• Checking the network cables, modem, and router'), x0 + 14, y + 218);
    g.fillText(L('• 重新连接到 Wi-Fi', '• Reconnecting to Wi-Fi'), x0 + 14, y + 244);
    g.font = `400 13px ${FONT}`;
    g.fillText('ERR_INTERNET_DISCONNECTED', x0, y + 288);
    const left = ln ? Math.ceil((ln.offUntil - R.now) / 1000) : 0;
    g.textAlign = 'right';
    g.font = `600 15px ${FONT}`;
    g.fillStyle = sub;
    g.fillText(left > 0 ? L(`${left} 秒后重新连接…`, `Reconnecting in ${left}s…`) : L('网线被拔了', 'Cable unplugged'), W - 40, y + 330);
    g.textAlign = 'left';
    g.fillText(L('按空格键即可开始玩小恐龙', 'Press space to play'), x0, y + 330);
  }

  /** 大字：「G A M E  O V E R」加原版的重来按钮，或者冲线的「FINISH」。 */
  drawStamp(g, y0, pal, text, restart) {
    const cy = y0 + 180;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 34px ${MONO}`;
    g.lineWidth = 6;
    g.strokeStyle = pal.bg;
    g.strokeText(text, W / 2 + 160, cy);
    g.fillStyle = pal.ink;
    g.fillText(text, W / 2 + 160, cy);
    if (!restart) return;
    // 重来按钮：圆角方块里一个转圈的箭头
    const [x, y] = [W / 2 + 160, cy + 56];
    g.fillStyle = pal.ink;
    g.beginPath();
    g.roundRect(x - 22, y - 19, 44, 38, 5);
    g.fill();
    g.strokeStyle = pal.bg;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x, y + 1, 10, -Math.PI * 0.3, Math.PI * 1.45);
    g.stroke();
    g.fillStyle = pal.bg;
    g.beginPath();
    g.moveTo(x + 4, y - 15);
    g.lineTo(x + 14, y - 8);
    g.lineTo(x + 3, y - 3);
    g.fill();
  }

  hud(R) {
    if (R.phase !== 'live' || !R.lanes) return null;
    const left = Math.max(0, R.roundLen - (R.now - R.roundStart));
    const [a, b] = TEAMS.map((t) => Math.floor(R.lanes[t].dist));
    const clock = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    return { mid: L(`第 ${R.round} 局`, `Run ${R.round}`), sub: `${a} : ${b} / ${R.course}m · ${clock}` };
  }
}
