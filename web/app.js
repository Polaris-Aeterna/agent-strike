// AGENT STRIKE 外壳：菜单、数据、回放进度条、直播、计分板、击杀播报、横幅。
// 具体怎么玩在 modes/<游戏>.js 里，这里只负责把 AI 事件喂给当前游戏的规则，再把效果交给它的画面。
import { TEAMS, COLOR, TEAM_NAME, REAL_TEAM_NAME, WORLD, clamp, setCivilNames } from './core.js';
import { Sfx } from './sfx.js';
import { L, lang, setLang } from './i18n.js';

// 悬浮窗（文档画中画）打开时，游戏画面和顶栏搬到那个小窗口里：取元素、尺寸、动画都跟着当前窗口走
let pip = null;
const win = () => pip || window;
const $ = (s) => pip?.document.querySelector(s) || document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s), ...(pip ? pip.document.querySelectorAll(s) : [])];
const SPEEDS = [1, 5, 20, 60, 200, 600];
const MODE_IDS = ['party', 'cs', 'moba', 'br', 'kart', 'poke', 'fight', 'tetris', 'mc', 'pvz', 'soccer', 'taiko', 'pac', 'snake', 'mono', 'sus', 'birds', 'ddz', 'dino', 'farm', 'plane'];
const MODES = {};
const NEW_MODES = new Set(['birds', 'ddz', 'dino', 'farm', 'plane']);

function store(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式下存不了也没关系 */
  }
}
const settings = { balance: store('as.balance', true), sound: store('as.sound', true), game: store('as.game', 'party') };
const sfx = new Sfx(() => settings.sound);

// ================================================================ 页面上写死的文字（中 / EN）

// i18n-dict-start：中英对照表
const UI = {
  skip: ['⏩ 快进空闲', '⏩ Skipping idle'],
  board: ['计分板', 'Scoreboard'],
  boardTip: ['按住 Tab 也可以', 'Or hold Tab'],
  legend: ['图例', 'Legend'],
  legendTip: ['快捷键 H', 'Shortcut: H'],
  balance: ['均衡', 'Balance'],
  balanceTip: ['打开后比效率，不比谁开的会话多', 'Compare efficiency, not how many sessions each side runs'],
  sound: ['声音', 'Sound'],
  langTip: ['切换语言 / Switch language', 'Switch language / 切换语言'],
  menu: ['菜单', 'Menu'],
  restart: ['从头开始', 'Restart'],
  playTip: ['空格', 'Space'],
  keys: ['快捷键：空格 暂停 · ← → 快退快进 · 1-6 切换速度 · Tab 计分板 · H 图例 · Esc 关闭', 'Keys: Space pause · ← → seek · 1-6 speed · Tab scoreboard · H legend · Esc close'],
  tagline: ['用你电脑上真实的 Claude 和 Codex 会话，打一场游戏大杂烩', 'Your real Claude and Codex sessions, replayed as a mash-up of classic games'],
  step1: ['选游戏', 'Pick a game'],
  step2: ['选比赛', 'Pick a match'],
  live: ['直播', 'Live'],
  liveDesc: ['现在正在跑的会话直接上场。你和 AI 的每一步，都会马上变成游戏里的动作。', 'Sessions running right now take the field. Every step you and your AI take shows up in the game instantly.'],
  liveGo: ['进入直播', 'Go live'],
  days: ['按天回放', 'Replay a day'],
  daysDesc: ['挑一天，那天所有 Claude 会话对那天所有 Codex 会话。', "Pick a day: that day's Claude sessions vs that day's Codex sessions."],
  onlyBoth: ['只看两边都上场的日子', 'Only days where both sides played'],
  duel: ['1v1 跨时空单挑', '1v1 across time'],
  duelDesc: ['任挑一个 Claude 会话和一个 Codex 会话，从各自开头同时开打。', 'Pick any Claude session and any Codex session; both start from their first move at the same time.'],
  searchClaude: ['搜 Claude 会话…', 'Search Claude sessions…'],
  searchCodex: ['搜 Codex 会话…', 'Search Codex sessions…'],
  duelGo: ['开打', 'Fight'],
  pip: ['悬浮窗', 'Pop out'],
  starsTip: ['高光时刻', 'Highlights'],
  pipTip: ['放进一个浮在所有窗口最上面的小窗口，边干活边看', 'Float the game above all your windows while you work'],
  pipNote: ['📺 游戏正在桌面悬浮窗里运行', '📺 The game is running in the floating window'],
  pipBack: ['收回到这里', 'Bring it back'],
  demo: ['演示', 'Demo'],
  demoDesc: ['电脑上没有 Claude / Codex 记录也能玩：用一份虚构的会话数据开打。', 'No Claude / Codex logs on this machine? Play with a made-up day of sessions.'],
  demoGo: ['开始演示', 'Play the demo'],
  privacy: ['只读取本机的 ~/.claude 和 ~/.codex 会话记录，不会修改它们，也不会上传。', 'Reads ~/.claude and ~/.codex on this machine only. Never modifies or uploads anything.'],
};
// i18n-dict-end

function applyStaticText() {
  const pick = (key) => L(...(UI[key] || [key, key]));
  for (const el of $$('[data-i18n]')) el.textContent = pick(el.dataset.i18n);
  for (const el of $$('[data-i18n-ph]')) el.placeholder = pick(el.dataset.i18nPh);
  for (const el of $$('[data-i18n-title]')) el.title = pick(el.dataset.i18nTitle);
  for (const el of $$('.lang')) el.textContent = lang === 'en' ? '中文' : 'EN'; // i18n-ok：按钮显示另一种语言
  document.title = 'AGENT STRIKE';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
}

/** 切换语言：页面文字马上换；回放会从头重算一遍到当前位置，让游戏里的播报也换过来。 */
function switchLang() {
  setLang(lang === 'en' ? 'zh' : 'en');
  applyStaticText();
  if (!S.R) {
    renderGames();
    renderDays();
    searchSessions('claude');
    searchSessions('codex');
    return;
  }
  if (S.tl) {
    const m = S.m;
    const label = S.mode === 'day' && S.day ? dayLabel(S.day) : S.label;
    S.label = label;
    buildReplay();
    seek(m);
  }
  updateLegend();
  if (!$('#board').hidden) renderBoard();
  if (S.ended) endMatch();
}

// ================================================================ 小工具

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const two = (n) => String(n).padStart(2, '0');

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return L(`${s} 秒`, `${s}s`);
  const m = Math.floor(s / 60);
  if (m < 60) return L(`${m} 分 ${s % 60} 秒`, `${m}m ${s % 60}s`);
  return L(`${Math.floor(m / 60)} 小时 ${m % 60} 分`, `${Math.floor(m / 60)}h ${m % 60}m`);
}

// ================================================================ 比赛状态

const S = {
  mode: null, // 'live' | 'day' | 'duel'
  R: null, // 规则（大乱斗时是外层）
  V: null, // 当前游戏的画面
  vid: null,
  events: [],
  idx: 0,
  tl: null,
  m: 0,
  speed: 20,
  playing: false,
  ended: false,
  label: '',
  base: 0,
  heat: null,
  marks: [],
  es: null,
  sessions: {},
  game: settings.game,
};
const views = {};
let later = [];
let shake = { t: 0, mag: 0 };
let rt = 0;
let lastBeep = 0;

const cur = () => (S.R ? S.R.current || S.R : null);
const metaOf = (id) => MODES[id]?.meta || {};
const nameOf = (sid) => cur()?.players.get(sid)?.name || S.R?.titles?.[sid] || sid?.slice(0, 8) || '?';
const teamOf = (sid) => cur()?.players.get(sid)?.team;
const nameTag = (sid) => `<span class="n ${teamOf(sid) || ''}">${esc(nameOf(sid))}</span>`;
const YOU = () => `<span class="n human">${L('你', 'You')}</span>`;
const fill = (text, sid) => esc(text || '').replace('{a}', `</span>${nameTag(sid)}<span>`);

const app = {
  sfx,
  get mode() {
    return S.mode;
  },
  rt: () => rt,
  speed: () => (S.tl ? S.speed : 1),
  later: (sec, fn) => later.push({ at: rt + sec, fn }),
  shake: (t, mag) => (shake = { t, mag }),
  banner: (html, cls, ms) => banner(html, cls, ms),
  feed: (html, cls) => feed(html, cls),
  announce: (text, sub, cls, ms) => announce(text, sub, cls, ms),
  nameOf,
  nameTag,
  esc,
  fmtDur,
};

function viewFor(id) {
  if (!views[id]) views[id] = new MODES[id].View(app);
  return views[id];
}

/** 让画面和规则对齐（新比赛、拖进度条、大乱斗换关之后）。 */
function syncView(target) {
  const c = target || cur();
  setCivilNames(c.civilNames);
  const id = c.modeId;
  S.vid = id;
  S.V = viewFor(id);
  later = [];
  S.V.reset(c);
}

/** 大乱斗：所有游戏轮着来。单独玩一个游戏也套同一个外壳，只有一队在场时它会把这队分成 A、B 两边内战。 */
function createRules(titles) {
  const opts = { titles, balance: settings.balance };
  const modes = S.game === 'party' ? MODE_IDS.filter((id) => id !== 'party' && MODES[id]).map((id) => MODES[id]) : [MODES[S.game]];
  return new MODES.party.Rules({ ...opts, modes, solo: S.game !== 'party' });
}

const isParty = () => S.game === 'party';

// ================================================================ 横幅 / 播报

function banner(html, cls = '', ms = 2600) {
  const el = $('#banner');
  el.innerHTML = html;
  el.className = `show ${cls}`;
  clearTimeout(banner.timer);
  banner.timer = setTimeout(() => (el.className = cls), ms);
}

// 大字播报排队放：「第一滴血」和「双杀」同时来，就一个接一个播
const announceQueue = [];
let announceBusyUntil = 0;
function announce(text, sub = '', cls = 'gold', ms = 1800) {
  if (rt < announceBusyUntil) {
    if (announceQueue.length < 3) announceQueue.push([text, sub, cls, ms]);
    return;
  }
  announceBusyUntil = rt + Math.min(1.2, ms / 1000);
  showAnnounce(text, sub, cls, ms);
}
function pumpAnnounce() {
  if (announceQueue.length && rt >= announceBusyUntil) announce(...announceQueue.shift());
}

function showAnnounce(text, sub, cls, ms) {
  sfx.announce(cls === 'bad');
  const el = $('#announce');
  el.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  el.className = '';
  void el.offsetWidth;
  const size = text.length > 34 ? ' xlong' : text.length > 18 ? ' long' : '';
  el.className = `show ${cls}${size}`;
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => (el.className = `${cls}${size}`), ms);
}

function feed(html, cls = '') {
  const box = $('#killfeed');
  const el = document.createElement('div');
  el.className = `kf ${cls}`;
  el.innerHTML = html;
  box.prepend(el);
  while (box.children.length > 7) box.lastChild.remove();
  setTimeout(() => el.classList.add('fade'), 7000);
  setTimeout(() => el.remove(), 7700);
}

function stageCard(f) {
  const el = $('#stage');
  el.innerHTML = `<div class="ico">${f.icon || '🎪'}</div><div class="no">${isParty() ? L(`第 ${f.stage} 关`, `STAGE ${f.stage}`) : f.civil ? L('⚔ 内战', '⚔ CIVIL WAR') : L('⚔ 正式对战', '⚔ REAL MATCH')}</div><div class="nm">${esc(f.name)}</div>${f.note ? `<div class="nt">${esc(f.note)}</div>` : ''}`;
  el.className = '';
  void el.offsetWidth;
  el.className = 'show';
  clearTimeout(stageCard.timer);
  stageCard.timer = setTimeout(() => (el.className = ''), 1700);
  sfx.stage();
}

// ================================================================ 效果分发

function applyFx(list) {
  if (!list.length) return;
  const busy = list.length > 40 || (S.tl && S.speed >= 200);
  // 换关：每一段效果交给产生它的那一关的画面（一次可能连着换好几次关）
  let rest = list;
  for (let cut = rest.findIndex((f) => f.type === 'partySwitch'); cut >= 0; cut = rest.findIndex((f) => f.type === 'partySwitch')) {
    const sw = rest[cut];
    run(rest.slice(0, cut), sw.prev || cur(), busy);
    rest = rest.slice(cut + 1);
    syncView(sw.next);
    if (!busy) stageCard(sw);
    updateLegend();
  }
  run(rest, cur(), busy);
}

function run(list, R, busy) {
  if (!list.length) return;
  S.V.apply(list, R, busy);
  const m = R.modeMeta || metaOf(R.modeId);
  for (const f of list) {
    switch (f.type) {
      case 'join':
        if (!busy && R.phase === 'live') feed(L(`↗ ${nameTag(f.sid)} 上场`, `↗ ${nameTag(f.sid)} joins`), 'note');
        break;
      case 'bench':
        if (!busy && f.idle && R.phase === 'live') feed(L(`💤 ${nameTag(f.sid)} 挂机下场`, `💤 ${nameTag(f.sid)} went AFK`), 'note');
        break;
      case 'kill':
        killfeed(f);
        break;
      case 'prompt':
        if (!busy) feed(`💬 ${YOU()} → ${nameTag(f.sid)}`, 'note');
        break;
      case 'pr':
        banner(L(`🏆 ${esc(nameOf(f.sid))} 提交了 PR`, `🏆 ${esc(nameOf(f.sid))} opened a PR`), 'gold');
        break;
      case 'wait': {
        const w = m.wait || {};
        banner(`<span>${fill(w.start || L('⏳ {a} 在等你回复', '⏳ {a} is waiting for you'), f.sid)}</span><small>${esc(w.sub || L('40 秒内回它就算及时', 'Reply within 40s'))}</small>`, 'bad', 3500);
        sfx.beep();
        break;
      }
      case 'waitDone':
        banner(`${esc((m.wait || {}).done || L('✂️ 及时回复', '✂️ Replied in time'))}<small>${L(`${esc(nameOf(f.sid))} 只等了 ${fmtDur(f.wait)}`, `${esc(nameOf(f.sid))} waited only ${fmtDur(f.wait)}`)}</small>`, 'gold');
        feed(L(`✂️ ${YOU()} 及时回复了 ${nameTag(f.sid)}（${fmtDur(f.wait)}）`, `✂️ ${YOU()} answered ${nameTag(f.sid)} in ${fmtDur(f.wait)}`), 'big');
        sfx.good();
        break;
      case 'waitBoom':
        banner(`<span>${fill((m.wait || {}).boom || L('💥 {a} 等你等太久了', '💥 {a} waited too long'), f.sid)}</span>`, 'bad', 3000);
        sfx.boom(true);
        break;
      case 'waitLate':
        feed(L(`⌛ ${YOU()} 让 ${nameTag(f.sid)} 等了 ${fmtDur(f.wait)}`, `⌛ ${YOU()} kept ${nameTag(f.sid)} waiting ${fmtDur(f.wait)}`), 'note');
        break;
      case 'phase':
        if (f.phase === 'live') {
          if (!isParty()) banner(L('⚔️ 人到齐了，开打！', '⚔️ Everyone is here — fight!'), 'gold', 2200);
        }
        else if (!busy) banner(L('⏸ 人不够了<small>进入热身，等更多会话动起来</small>', '⏸ Not enough players<small>Warmup until more sessions get busy</small>'), '', 2200);
        break;
      case 'roundEnd': {
        const word = isParty() ? L('关', 'stage') : m.roundWord || L('回合', 'round');
        const stage = f.stageName ? L(`《${esc(f.stageName)}》`, ` — ${esc(f.stageName)}`) : '';
        const sub = `${esc(f.reasonText || '')}${f.reasonText ? ' · ' : ''}${f.score.claude} : ${f.score.codex}`;
        if (f.civil) banner(L(`第 ${f.round} ${word}${stage} · 内战`, `${word} ${f.round}${stage} · civil war`) + `<small>${esc(f.reasonText || '')}${L(' · 不计分', ' · no points')}</small>`, 'gold');
        else if (f.winner) banner(L(`${TEAM_NAME[f.winner]} 队赢下第 ${f.round} ${word}${stage}`, `Team ${TEAM_NAME[f.winner]} wins ${word} ${f.round}${stage}`) + `<small>${sub}</small>`, f.winner);
        else banner(L(`第 ${f.round} ${word}${stage} 平局`, `${word} ${f.round}${stage} is a draw`) + `<small>${sub}</small>`, '');
        sfx.round(true);
        break;
      }
      case 'announce':
        announce(f.text, f.sub, f.cls, f.ms);
        break;
      case 'note':
        if (!busy || f.cls === 'big') feed(esc(f.text).replace(/\{(\d)\}/g, (_, i) => nameTag(f.sids?.[i])), f.cls || 'note');
        break;
    }
  }
}

function killfeed(f) {
  const special = {
    human: [YOU(), `✋ ${esc(f.weapon || L('打断', 'interrupt'))}`],
    bug: ['', `🐛 ${esc(f.weapon || 'Bug')}`],
    net: ['', L('📡 网络', '📡 Network')],
    c4: ['', `💣 ${esc(f.weapon || 'C4')}`],
    zone: ['', `☠️ ${esc(f.weapon || L('毒圈', 'Blue Zone'))}`],
  }[f.cause];
  const [left, weapon] = special || [f.killer ? nameTag(f.killer) : '', esc(f.weapon || '')];
  const assist = f.assist ? ` <span class="tag">+</span> ${nameTag(f.assist)}` : '';
  const wb = f.wallbang ? `<span class="tag" title="${L('穿墙', 'Wallbang')}">🧱</span>` : '';
  const hs = f.hs && !special ? '<span class="tag">🎯</span>' : '';
  feed(`${left}${assist} <span class="w">${weapon}</span>${wb}${hs} ${nameTag(f.victim)}`, f.hs ? 'big' : '');
}

// ================================================================ 回放时间线

class Timeline {
  constructor(events, capAt) {
    this.src = [];
    this.mt = [];
    this.duration = 0;
    if (!events.length) return;
    let m = 0;
    this.pt(events[0].t, 0);
    for (let i = 1; i < events.length; i++) {
      const gap = events[i].t - events[i - 1].t;
      const cap = capAt(i);
      if (gap > cap) {
        this.pt(events[i - 1].t, m);
        m += cap;
        this.pt(events[i].t, m);
      } else m += gap;
    }
    this.pt(events[events.length - 1].t, m);
    this.duration = m;
  }

  pt(s, m) {
    const n = this.src.length;
    if (n && this.src[n - 1] === s) this.mt[n - 1] = m;
    else {
      this.src.push(s);
      this.mt.push(m);
    }
  }

  find(arr, v) {
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  toSrc(m) {
    if (!this.src.length) return 0;
    const i = this.find(this.mt, m);
    if (i >= this.src.length - 1) return this.src[this.src.length - 1];
    const span = this.mt[i + 1] - this.mt[i];
    return this.src[i] + (span ? ((m - this.mt[i]) * (this.src[i + 1] - this.src[i])) / span : 0);
  }

  toMatch(s) {
    if (!this.src.length) return 0;
    const i = this.find(this.src, s);
    if (i >= this.src.length - 1) return this.mt[this.mt.length - 1];
    const span = this.src[i + 1] - this.src[i];
    return this.mt[i] + (span ? ((s - this.src[i]) * (this.mt[i + 1] - this.mt[i])) / span : 0);
  }

  slope(m) {
    const i = this.find(this.mt, m);
    if (i >= this.src.length - 1) return 1;
    const span = this.mt[i + 1] - this.mt[i];
    return span ? (this.src[i + 1] - this.src[i]) / span : 1;
  }
}

const titlesOf = (sessions) => Object.fromEntries(Object.entries(sessions).map(([sid, m]) => [sid, m.title]));

function startReplay(events, sessions, opts) {
  stopLive();
  S.mode = opts.mode;
  S.label = opts.label;
  S.base = opts.base || 0;
  S.events = events;
  S.sessions = sessions;
  buildReplay();
  S.speed = SPEEDS.find((s) => s >= S.tl.duration / (8 * 60e3)) || SPEEDS[SPEEDS.length - 1];
  S.m = 0;
  S.idx = 0;
  S.playing = true;
  S.ended = false;
  enterGame(true);
  renderSpeeds();
  if (!S.marks.length) {
    const missing = TEAMS.filter((t) => !events.some((e) => e.src === t && e.k !== 'tokens'));
    $('#hint').textContent = missing.length
      ? L(
        `这段记录里 ${missing.map((t) => REAL_TEAM_NAME[t]).join('、')} 没有上场，团队游戏会变成内战：同一队分成 A、B 两边打（不计分）。`, // i18n-ok：L() 跨行
        `${missing.map((t) => REAL_TEAM_NAME[t]).join(' and ')} never showed up here, so team games turn into a civil war: one team split into A vs B (no points).`,
      )
      : L('两队很少同时在场，大部分时间在热身；同时在场的片段会正常开打。', 'The teams rarely overlap, so it is mostly warmup; overlapping stretches play normally.');
  }
}

function buildReplay() {
  const titles = titlesOf(S.sessions);
  S.R = createRules(titles);
  // 先静默打一遍：哪段在热身（快进），每回合在哪结束（进度条上的小点）
  const pre = createRules(titles);
  const live = new Uint8Array(S.events.length);
  const ends = [];
  const stars = [];
  S.events.forEach((ev, i) => {
    live[i] = pre.phase === 'live' ? 1 : 0;
    for (const f of pre.process(ev)) {
      if (f.type === 'roundEnd') ends.push({ t: pre.now, winner: f.winner });
      // 高光时刻：所有大字播报（双杀、吃鸡、僵尸吃掉你的脑子……）
      if (f.type === 'announce' && f.text) stars.push({ t: pre.now, text: f.text, sub: f.sub || '', mode: (pre.current || pre).modeId, cls: f.cls || 'gold' });
    }
  });
  S.tl = new Timeline(S.events, (i) => (live[i] ? 5000 : 250));
  S.marks = ends.map((e) => ({ m: S.tl.toMatch(e.t), winner: e.winner }));
  // 同一句话连着刷屏的只留第一次
  S.stars = stars
    .map((x) => ({ ...x, m: S.tl.toMatch(x.t) }))
    .filter((x, i, a) => !a.slice(Math.max(0, i - 3), i).some((y) => y.text === x.text && x.m - y.m < 60e3));
  const N = 360;
  const heat = { claude: new Float32Array(N), codex: new Float32Array(N) };
  for (const ev of S.events) {
    if (ev.k === 'tokens' || ev.k === 'think') continue;
    const bin = Math.min(N - 1, Math.floor((S.tl.toMatch(ev.t) / (S.tl.duration || 1)) * N));
    heat[ev.src][bin]++;
  }
  S.heat = heat;
  clearHud();
  syncView();
}

function seek(m) {
  S.m = clamp(m, 0, S.tl.duration);
  const target = S.tl.toSrc(S.m);
  S.R.reset();
  S.idx = 0;
  while (S.idx < S.events.length && S.events[S.idx].t <= target) S.R.process(S.events[S.idx++]);
  S.R.advance(target);
  clearHud();
  syncView();
  updateLegend();
  S.ended = false;
  $('#endscreen').hidden = true;
}

function stepReplay(dt) {
  if (!S.playing || S.ended) return;
  S.m = Math.min(S.tl.duration, S.m + dt * 1000 * S.speed);
  const target = S.tl.toSrc(S.m);
  let guard = 5000;
  while (S.idx < S.events.length && S.events[S.idx].t <= target && guard--) applyFx(S.R.process(S.events[S.idx++]));
  applyFx(S.R.advance(target));
  if (S.m >= S.tl.duration && S.idx >= S.events.length) endMatch();
}

function endMatch() {
  S.ended = true;
  S.playing = false;
  $('#btnPlay').textContent = '▶';
  const s = S.R.summary();
  const award = (k, p, sub) => (p ? `<div class="award"><div class="k">${k}</div><div class="v" style="color:${COLOR[p.team]}">${esc(p.name)}</div><div class="s">${sub}</div></div>` : '');
  setCivilNames(null);
  const top = s.score.claude > s.score.codex ? 'Claude' : 'Codex';
  const winner = s.score.claude === s.score.codex ? L('平局', 'Draw') : L(`${top} 队获胜`, `Team ${top} wins`);
  const t = s.teams;
  const stages = isParty() && s.stages?.length
    ? `<div class="stages">${s.stages.filter((x) => !x.civil).map((x) => `<span class="${x.winner || ''}" title="${esc(metaOf(x.mode).name || x.mode)}">${metaOf(x.mode).icon || '?'}</span>`).join('')}</div>${s.stages.some((x) => x.civil) ? `<p class="dim">${L(`另有 ${s.stages.filter((x) => x.civil).length} 关是只有一队在场的内战，不计分`, `Plus ${s.stages.filter((x) => x.civil).length} one-team civil-war stages (no points)`)}</p>` : ''}`
    : '';
  $('#endscreen').innerHTML = `
    <h2>${L('比赛结束', 'Match over')} · ${esc(metaOf(S.game).name)} · ${esc(S.label)}</h2>
    <div class="final"><span class="c">${s.score.claude}</span> : <span class="x">${s.score.codex}</span></div>
    <div>${winner}${settings.balance ? L('（均衡火力）', ' (balanced firepower)') : L('（真实火力）', ' (raw firepower)')}</div>
    ${stages}
    <div class="awards">
      ${award('🏅 MVP', s.mvp, s.mvp ? L(`${s.mvp.k} 杀 · ${s.mvp.done} 次任务完成 · ${Math.round(s.mvp.dmg)} 伤害`, `${s.mvp.k} kills · ${s.mvp.done} tasks done · ${Math.round(s.mvp.dmg)} damage`) : '')}
      ${award(L('🎯 神枪手（测试/编译通过）', '🎯 Sharpshooter (tests/builds passed)'), s.sharpshooter?.hs ? s.sharpshooter : null, s.sharpshooter ? L(`${s.sharpshooter.hs} 次爆头`, `${s.sharpshooter.hs} headshots`) : '')}
      ${award(L('🐛 最多 Bug', '🐛 Most bugs'), s.buggiest?.errs ? s.buggiest : null, s.buggiest ? L(`报错 ${s.buggiest.errs} 次`, `${s.buggiest.errs} errors`) : '')}
      ${award(L('⌛ 等你最久', '⌛ Waited on you longest'), s.waited?.waitMax ? s.waited : null, s.waited ? L(`等了 ${fmtDur(s.waited.waitMax)}`, `waited ${fmtDur(s.waited.waitMax)}`) : '')}
      ${['claude', 'codex'].map((k) => `<div class="award"><div class="k">${L(`${REAL_TEAM_NAME[k]} 队`, `Team ${REAL_TEAM_NAME[k]}`)}</div><div class="v">${L(`${t[k].players} 个会话 · ${t[k].ops} 次操作`, `${t[k].players} sessions · ${t[k].ops} actions`)}</div><div class="s">${L(`报错 ${t[k].errs} · 完成任务 ${t[k].done}`, `${t[k].errs} errors · ${t[k].done} tasks done`)} · ${Math.round(t[k].tok / 1000)}k token</div></div>`).join('')}
    </div>
    ${S.stars?.length ? `<div class="endstars"><b>⭐ ${L('高光时刻', 'Highlights')}</b>${S.stars.filter((x) => x.cls !== 'claude' && x.cls !== 'codex').slice(0, 6).map((st) => `<span class="star ${st.cls}" data-i="${S.stars.indexOf(st)}">${metaOf(st.mode).icon || ''} ${esc(st.text)}</span>`).join('')}<button id="btnAllStars">${L(`全部 ${S.stars.length} 条`, `All ${S.stars.length}`)}</button></div>` : ''}
    <div class="row"><button class="primary" id="btnAgain">${L('再看一遍', 'Watch again')}</button><button id="btnBack">${L('回菜单', 'Back to menu')}</button></div>`;
  $('#endscreen').hidden = false;
  $('#btnAgain').onclick = () => {
    seek(0);
    S.playing = true;
    $('#btnPlay').textContent = '⏸';
  };
  $('#btnBack').onclick = openMenu;
  const all = $('#btnAllStars');
  if (all) all.onclick = () => {
    $('#endscreen').hidden = true;
    renderStars();
    $('#stars').hidden = false;
  };
  for (const el of $('#endscreen').querySelectorAll('.star')) el.onclick = () => jumpToStar(Number(el.dataset.i));
}

// ================================================================ 直播

function startLive() {
  stopLive();
  S.mode = 'live';
  S.label = L('直播', 'Live');
  S.R = createRules({});
  S.events = [];
  S.tl = null;
  clearHud();
  syncView();
  enterGame(false);
  $('#hint').textContent = L('正在连接…', 'Connecting…');
  const es = new EventSource('/api/live');
  S.es = es;
  es.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'hello') {
      for (const [sid, m] of Object.entries(data.sessions)) S.R.setTitle(sid, m.title);
      data.events.sort((a, b) => a.t - b.t);
      for (const ev of data.events) S.R.process(ev);
      S.R.advance(Date.now());
      syncView();
      updateLegend();
      $('#hint').textContent = '';
    } else if (data.type === 'session') {
      S.R.setTitle(data.sid, data.meta.title);
    } else if (data.type === 'ev') {
      for (const ev of data.events) applyFx(S.R.process(ev));
    }
  };
  es.onerror = () => {
    $('#hint').textContent = L('和本地服务器的连接断了，正在重连…', 'Lost the local server, reconnecting…');
  };
}

function stopLive() {
  if (S.es) S.es.close();
  S.es = null;
}

// ================================================================ 画布

const canvas = $('#game');
const ctx = canvas.getContext('2d');
const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };

function resize() {
  const w = win();
  const [innerWidth, innerHeight] = [w.innerWidth, w.innerHeight];
  view.dpr = w.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * view.dpr);
  canvas.height = Math.round(innerHeight * view.dpr);
  const inGame = !$('#hud').hidden;
  const top = inGame ? $('#topbar').offsetHeight + 6 : 0;
  const bottom = inGame && !$('#playbar').hidden ? $('#playbar').offsetHeight + 4 : 0;
  const availW = innerWidth - 12;
  const availH = innerHeight - top - bottom - 6;
  view.scale = Math.min(availW / WORLD.w, availH / WORLD.h);
  view.ox = (innerWidth - WORLD.w * view.scale) / 2;
  view.oy = top + (availH - WORLD.h * view.scale) / 2 + 3;
  drawTimeline();
}
window.addEventListener('resize', resize);

function render(dt) {
  const { dpr, scale, ox, oy } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let sx = 0;
  let sy = 0;
  if (shake.t > 0) {
    shake.t -= dt;
    sx = (Math.random() * 2 - 1) * shake.mag;
    sy = (Math.random() * 2 - 1) * shake.mag;
  }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sx * scale), dpr * (oy + sy * scale));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WORLD.w, WORLD.h);
  ctx.clip();
  if (S.R && S.V) {
    S.V.render(ctx, cur(), scale);
  } else {
    // 菜单背景：随便挑一个游戏的空场地
    menuBackdrop();
  }
  ctx.restore();
}

let backdrop = null;
function menuBackdrop() {
  if (!backdrop && MODES.cs) {
    backdrop = { V: new MODES.cs.View(app), R: new MODES.cs.Rules() };
    backdrop.V.reset(backdrop.R);
  }
  if (backdrop) backdrop.V.render(ctx, backdrop.R, view.scale);
}

// ================================================================ HUD

function clearHud() {
  announceQueue.length = 0;
  announceBusyUntil = 0;
  $('#killfeed').innerHTML = '';
  $('#banner').className = '';
  $('#announce').className = '';
  $('#stage').className = '';
  later = [];
}

function clockText() {
  const t = cur().now;
  if (!t) return '';
  if (S.mode === 'duel') {
    const s = Math.max(0, Math.round((t - S.base) / 1000));
    const hms = `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
    return L(`开打后 ${hms}`, `+${hms} in`);
  }
  const d = new Date(S.mode === 'live' ? Date.now() : t);
  const hms = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return S.mode === 'live' ? hms : L(`${d.getMonth() + 1}月${d.getDate()}日 ${hms}`, `${MONTHS[d.getMonth()]} ${d.getDate()} ${hms}`);
}

let hudTick = 0;
function updateHud(dt) {
  hudTick -= dt;
  if (hudTick > 0 || !S.R) return;
  hudTick = 0.1;
  const c = cur();
  $('#score-claude').textContent = S.R.score.claude;
  $('#score-codex').textContent = S.R.score.codex;
  const h = c.phase === 'live' ? S.V.hud?.(c) : null;
  for (const team of TEAMS) {
    const pips = h?.pips?.[team] || c.field(team).map((p) => p.alive);
    $(`#pips-${team}`).innerHTML = pips.map((a) => `<i class="pip${a ? '' : ' dead'}"></i>`).join('');
  }
  if (h) {
    $('#roundNo').textContent = (isParty() ? L(`第 ${S.R.round + 1} 关`, `Stage ${S.R.round + 1}`) : h.mid || '') + (c.civil ? L(' · ⚔ 内战', ' · ⚔ civil war') : '');
    $('#roundTimer').textContent = h.sub || '';
  } else if (c.phase === 'live') {
    $('#roundNo').textContent = L(`第 ${c.round} ${c.modeMeta?.roundWord || '回合'}`, `${c.modeMeta?.roundWord || 'Round'} ${c.round}`);
    $('#roundTimer').textContent = '';
  } else {
    $('#roundNo').textContent = L('热身中', 'Warmup');
    const absent = TEAMS.filter((t) => !c.field(t).length).map((t) => TEAM_NAME[t]);
    const need = c.ffa ? L('等第二个会话', 'Need 2 sessions') : L(`等 ${absent.join('、')}`, `Waiting: ${absent.join(', ')}`);
    $('#roundTimer').textContent = c.ffa ? need : TEAMS.some((t) => !c.field(t).length) ? need : '--:--';
  }
  $('#clock').textContent = clockText();
  const badge = $('#modeBadge');
  badge.textContent = S.mode === 'live' ? '● LIVE' : S.mode === 'duel' ? '1v1' : 'DEMO';
  badge.className = S.mode === 'live' ? 'live' : '';
  const gm = metaOf(S.game);
  const stage = isParty() ? ` · ${L(`第 ${S.R.round + 1} 关`, `Stage ${S.R.round + 1}`)} ${c.modeMeta.icon} ${c.modeMeta.name}` : '';
  $('#gameName').textContent = `${gm.icon || ''} ${gm.name || ''}${stage}`;
  if (S.tl) {
    $('#skip').hidden = !(S.playing && S.tl.slope(S.m) > 3);
    const left = (S.tl.duration - S.m) / S.speed / 1000;
    $('#remain').textContent = L(`剩 ${Math.floor(left / 60)}:${two(Math.floor(left) % 60)}`, `${Math.floor(left / 60)}:${two(Math.floor(left) % 60)} left`);
    drawTimeline();
  }
  if (!$('#board').hidden) renderBoard();
}

function drawTimeline() {
  const c = $('#timeline');
  if (!S.tl || $('#playbar').hidden) return;
  const dpr = win().devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.beginPath();
  g.roundRect(0, 6, w, h - 12, 5);
  g.fill();
  const N = S.heat.claude.length;
  let max = 1;
  for (let i = 0; i < N; i++) max = Math.max(max, S.heat.claude[i], S.heat.codex[i]);
  const mid = h / 2;
  const bw = w / N;
  for (let i = 0; i < N; i++) {
    const a = Math.sqrt(S.heat.claude[i] / max) * (mid - 7);
    const b = Math.sqrt(S.heat.codex[i] / max) * (mid - 7);
    if (a) {
      g.fillStyle = 'rgba(236,138,95,0.75)';
      g.fillRect(i * bw, mid - a, Math.max(1, bw - 0.5), a);
    }
    if (b) {
      g.fillStyle = 'rgba(79,168,255,0.75)';
      g.fillRect(i * bw, mid, Math.max(1, bw - 0.5), b);
    }
  }
  for (const mk of S.marks) {
    g.fillStyle = mk.winner ? COLOR[mk.winner] : '#aaa';
    g.beginPath();
    g.arc((mk.m / S.tl.duration) * w, 3, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(245,196,81,0.9)';
  for (const st of S.stars || []) {
    const sx = (st.m / S.tl.duration) * w;
    g.beginPath();
    g.moveTo(sx, h - 6);
    g.lineTo(sx - 3, h);
    g.lineTo(sx + 3, h);
    g.fill();
  }
  const x = (S.m / (S.tl.duration || 1)) * w;
  g.fillStyle = '#fff';
  g.fillRect(x - 1, 0, 2, h);
}

/** 高光时刻列表：点一条就跳过去看。 */
function renderStars() {
  const list = S.stars || [];
  const fmt = (t) => {
    const d = new Date(t);
    return `${two(d.getHours())}:${two(d.getMinutes())}`;
  };
  $('#stars').innerHTML = `<h2>⭐ ${L('高光时刻', 'Highlights')} <span class="dim">· ${list.length}</span></h2>
    <p class="dim">${L('点一条，跳到那一刻前面一点开始看。', 'Click one to jump just before it happened.')}</p>
    <div class="starlist">${list.map((st, i) => `<div class="star ${st.cls}" data-i="${i}"><span class="ico">${metaOf(st.mode).icon || '⭐'}</span><span class="tx"><b>${esc(st.text)}</b>${st.sub ? `<small>${esc(st.sub)}</small>` : ''}</span><span class="tm">${S.mode === 'duel' ? '' : fmt(st.t)}</span></div>`).join('') || `<p class="dim">${L('这场还没有高光时刻', 'No highlights yet')}</p>`}</div>`;
}

function jumpToStar(i) {
  const st = S.stars?.[i];
  if (!st) return;
  $('#stars').hidden = true;
  seek(Math.max(0, st.m - Math.max(4000, S.speed * 2000)));
  S.playing = true;
  $('#btnPlay').textContent = '⏸';
}

function renderBoard() {
  const c = cur();
  const rows = (team) => [...c.players.values()]
    .filter((p) => p.team === team && (p.ops || p.k || p.d))
    .sort((a, b) => Number(b.onField) - Number(a.onField) || b.k - a.k || b.ops - a.ops)
    .map((p) => `<tr class="${p.onField ? '' : 'off'}"><td title="${esc(p.name)}">${esc(p.name)}</td><td>${p.onField ? (p.alive ? L('在场', 'In') : L('倒下', 'Down')) : L('挂机', 'AFK')}</td><td>${p.k}</td><td>${p.d}</td><td>${p.a}</td><td>${p.hs}</td><td>${Math.round(p.dmg)}</td><td>${p.ops}</td><td>${p.errs}</td><td>${p.done}</td></tr>`)
    .join('');
  const head = `<tr>${[L('会话', 'Session'), L('状态', 'Status'), L('杀', 'K'), L('死', 'D'), L('助攻', 'A'), L('爆头', 'HS'), L('伤害', 'Dmg'), L('操作', 'Actions'), L('报错', 'Errors'), L('完成', 'Done')].map((x) => `<th>${x}</th>`).join('')}</tr>`;
  const civil = c.civil ? `<p class="dim">${L(`⚔ 内战：只有 ${REAL_TEAM_NAME[c.civil]} 在场，分成 A、B 两边打，不计入两队比分`, `⚔ Civil war: only ${REAL_TEAM_NAME[c.civil]} is here, split into A vs B — no team points`)}</p>` : '';
  const stage = civil + (isParty() ? `<p class="dim">${L(`大乱斗第 ${S.R.round + 1} 关 · ${esc(c.modeMeta.name)}（这张表只算本关）`, `Party stage ${S.R.round + 1} · ${esc(c.modeMeta.name)} (this table covers this stage only)`)}</p>` : '');
  $('#board').innerHTML = stage + TEAMS.map((t) => `
    <div class="teamhead ${t}"><b>${L(`${TEAM_NAME[t]} 队`, `Team ${TEAM_NAME[t]}`)} · ${c.civil ? c.score[t] : S.R.score[t]}</b><span class="dim">${L(`${c.field(t).length} 人在场`, `${c.field(t).length} on the field`)}</span></div>
    <table>${head}${rows(t) || `<tr><td class="dim">${L('还没有会话上场', 'No sessions yet')}</td></tr>`}</table>`).join('');
}

const commonLegend = () => [
  [L('🤖 子代理干的活', '🤖 Subagent work'), L('算在派它出去的那个会话头上', 'Credited to the session that spawned it')],
  [L('💤 5 分钟没动静', '💤 Idle for 5 minutes'), L('挂机下场，有动作再回来', 'Goes AFK, rejoins on its next action')],
  [L('⚖ 均衡火力', '⚖ Balanced firepower'), L('按两队最近的行动频率调整，比效率不比数量', 'Scaled by recent activity: efficiency, not volume')],
];

function updateLegend() {
  const c = cur();
  const m = c ? c.modeMeta || metaOf(c.modeId) : metaOf(S.game);
  const rows = (m.legend || []).concat(commonLegend());
  const party = S.game === 'party' ? `<p class="dim">${L('大乱斗：每关换一个游戏，下面是当前这一关的玩法。', 'Party Mix: every stage is a different game. This is how the current one works.')}</p>` : '';
  $('#legendBody').innerHTML = `<h2>${m.icon || ''} ${esc(m.name || '')}${L('：AI 在干嘛 → 游戏里发生什么', ': what the AI does → what happens in game')}</h2>${party}
    <div class="legend-grid">${rows.map(([a, b]) => `<div><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('')}</div>`;
}

function renderSpeeds() {
  $('#speeds').innerHTML = SPEEDS.map((s) => `<button data-s="${s}" class="${s === S.speed ? 'on' : ''}">${s}×</button>`).join('');
}

// ================================================================ 进入 / 退出

function enterGame(replay) {
  $('#menu').hidden = true;
  $('#loading').hidden = true;
  $('#endscreen').hidden = true;
  $('#hud').hidden = false;
  $('#playbar').hidden = !replay;
  $('#hint').textContent = '';
  $('#btnPlay').textContent = '⏸';
  $('#btnBalance').classList.toggle('on', settings.balance);
  $('#btnSound').textContent = settings.sound ? '🔊' : '🔇';
  updateLegend();
  resize();
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function loading(text) {
  $('#loadingText').textContent = text;
  $('#loading').hidden = false;
}

const WEEK = '日一二三四五六'; // i18n-ok：只在中文里用
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(day) {
  const d = new Date(`${day}T00:00:00`);
  return L(`${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`, `${WEEK_EN[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`);
}

function renderGames() {
  $('#games').innerHTML = MODE_IDS.map((id) => {
    const m = MODES[id]?.meta;
    if (!m) return `<div class="game off"><div class="ico">🚧</div><div class="nm">${L('施工中', 'Coming soon')}</div><div class="ds">${id}</div></div>`;
    const fresh = NEW_MODES.has(id) ? '<span class="new">NEW</span>' : '';
    return `<div class="game${id === S.game ? ' sel' : ''}" data-id="${id}">${fresh}<div class="ico">${m.icon}</div><div class="nm">${esc(m.name)}</div><div class="ds">${esc(m.desc)}</div></div>`;
  }).join('');
}

async function openMenu() {
  if (pip) pip.close();
  stopLive();
  S.mode = null;
  S.R = null;
  S.V = null;
  S.playing = false;
  clearHud();
  $('#hud').hidden = true;
  $('#board').hidden = true;
  $('#legend').hidden = true;
  $('#endscreen').hidden = true;
  $('#menu').hidden = false;
  renderGames();
  resize();
  try {
    const data = await getJSON('/api/days');
    menuDays = data.days;
    $('#liveCounts').innerHTML = `<span class="claude"><b>${data.active.claude}</b>${L('Claude 会话', 'Claude sessions')}</span><span class="codex"><b>${data.active.codex}</b>${L('Codex 会话', 'Codex sessions')}</span>`;
    renderDays();
  } catch (err) {
    $('#days').innerHTML = `<div class="dim">${L('读不到会话列表：', 'Could not load sessions: ')}${esc(err.message)}${L('。可以先玩 🎮 演示', '. You can still play the 🎮 Demo')}</div>`;
  }
  searchSessions('claude');
  searchSessions('codex');
}

let menuDays = [];
function renderDays() {
  const both = $('#onlyBoth').checked;
  const days = menuDays.filter((d) => !both || (d.claude && d.codex));
  const max = Math.max(1, ...menuDays.map((d) => d.claude + d.codex));
  $('#days').innerHTML = days.map((d) => `
    <div class="item${d.claude && d.codex ? '' : ' oneside'}" data-day="${d.day}">
      <div class="t">${dayLabel(d.day)}</div>
      <div class="r"><span class="c">${d.claude}</span> vs <span class="x">${d.codex}</span></div>
      <div class="m">${d.day}${d.claude && d.codex ? '' : L(' · 单边', ' · one-sided')}</div>
      <div class="bars"><i style="width:${(d.claude / max) * 100}%;background:var(--claude)"></i><i style="width:${(d.codex / max) * 100}%;background:var(--codex)"></i></div>
    </div>`).join('') || `<div class="dim">${menuDays.length ? L('没有符合条件的日子', 'No matching days') : L('没找到会话记录。试试右边的 🎮 演示', 'No session logs found. Try the 🎮 Demo')}</div>`;
}

const picked = { claude: null, codex: null };
const searchTimers = {};
function searchSessions(src) {
  clearTimeout(searchTimers[src]);
  searchTimers[src] = setTimeout(async () => {
    const q = $(src === 'claude' ? '#qClaude' : '#qCodex').value;
    const box = $(src === 'claude' ? '#listClaude' : '#listCodex');
    try {
      const { sessions } = await getJSON(`/api/sessions?src=${src}&q=${encodeURIComponent(q)}`);
      box.innerHTML = sessions.map((s) => {
        const d = new Date(s.start);
        const mb = s.size / 2 ** 20;
        return `<div class="item${picked[src]?.sid === s.sid ? ' sel' : ''}" data-sid="${s.sid}" data-title="${esc(s.title)}">
          <div class="t">${esc(s.title)}</div>
          <div class="r dim">${mb >= 1 ? mb.toFixed(0) + 'MB' : Math.max(1, Math.round(s.size / 1024)) + 'KB'}</div>
          <div class="m">${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())} · ${esc(s.cwd)}</div>
        </div>`;
      }).join('') || `<div class="dim">${L('没找到', 'Nothing found')}</div>`;
    } catch (err) {
      box.innerHTML = `<div class="dim">${esc(err.message)}</div>`;
    }
  }, 180);
}

async function playDay(day) {
  loading(L(`正在解析 ${dayLabel(day)} 的会话记录…（第一次会慢一点）`, `Parsing sessions from ${dayLabel(day)}… (slower the first time)`));
  try {
    const data = await getJSON(`/api/day?day=${day}`);
    S.day = day;
    startReplay(data.events, data.sessions, { mode: 'day', label: dayLabel(day) });
  } catch (err) {
    $('#loading').hidden = true;
    alert(L(`解析失败：${err.message}`, `Parsing failed: ${err.message}`));
  }
}

async function playDemo() {
  const { demoDay } = await import('./demo.js');
  const { events, sessions } = demoDay();
  S.day = null;
  startReplay(events, sessions, { mode: 'day', label: L('演示', 'Demo') });
}

async function playDuel(a, b) {
  loading(L(`正在解析「${a.title}」和「${b.title}」…`, `Parsing "${a.title}" and "${b.title}"…`));
  try {
    const [da, db] = await Promise.all([
      getJSON(`/api/session?src=claude&sid=${a.sid}`),
      getJSON(`/api/session?src=codex&sid=${b.sid}`),
    ]);
    const first = (evs) => (evs.find((e) => e.k !== 'tokens') || evs[0] || { t: 0 }).t;
    const ta = first(da.events);
    const shift = ta - first(db.events);
    const events = da.events.concat(db.events.map((e) => ({ ...e, t: e.t + shift }))).sort((x, y) => x.t - y.t);
    const title = (d, fallback) => Object.values(d.sessions)[0]?.title || fallback;
    startReplay(events, { ...da.sessions, ...db.sessions }, { mode: 'duel', label: `${title(da, a.title)} vs ${title(db, b.title)}`, base: ta });
  } catch (err) {
    $('#loading').hidden = true;
    alert(L(`解析失败：${err.message}`, `Parsing failed: ${err.message}`));
  }
}

// ================================================================ 输入

$('#games').onclick = (e) => {
  const it = e.target.closest('.game');
  if (!it || !it.dataset.id) return;
  S.game = settings.game = it.dataset.id;
  save('as.game', S.game);
  renderGames();
};
$('#btnLive').onclick = () => {
  sfx.unlock();
  startLive();
};
$('#onlyBoth').onchange = renderDays;
$('#days').onclick = (e) => {
  const it = e.target.closest('.item');
  if (!it) return;
  sfx.unlock();
  playDay(it.dataset.day);
};
for (const src of ['claude', 'codex']) {
  $(src === 'claude' ? '#qClaude' : '#qCodex').oninput = () => searchSessions(src);
  $(src === 'claude' ? '#listClaude' : '#listCodex').onclick = (e) => {
    const it = e.target.closest('.item');
    if (!it) return;
    picked[src] = { sid: it.dataset.sid, title: it.dataset.title };
    it.parentElement.querySelectorAll('.item').forEach((x) => x.classList.toggle('sel', x === it));
    $('#btnDuel').disabled = !(picked.claude && picked.codex);
  };
}
$('#btnDemo').onclick = () => {
  sfx.unlock();
  playDemo();
};
$('#btnDuel').onclick = () => {
  sfx.unlock();
  playDuel(picked.claude, picked.codex);
};

$('#btnMenu').onclick = openMenu;
$('#btnPip').onclick = togglePip;
$('#btnStars').onclick = () => {
  renderStars();
  $('#stars').hidden = !$('#stars').hidden;
};
$('#stars').onclick = (e) => {
  const it = e.target.closest('.star');
  if (it) jumpToStar(Number(it.dataset.i));
};
$('#btnPipBack').onclick = togglePip;
$('#btnPip').hidden = !('documentPictureInPicture' in window);
for (const el of $$('.lang')) el.onclick = switchLang;
$('#btnBoard').onclick = () => {
  $('#board').hidden = !$('#board').hidden;
  if (!$('#board').hidden) renderBoard();
};
$('#btnLegend').onclick = () => ($('#legend').hidden = !$('#legend').hidden);
$('#btnSound').onclick = () => {
  settings.sound = !settings.sound;
  save('as.sound', settings.sound);
  $('#btnSound').textContent = settings.sound ? '🔊' : '🔇';
  sfx.unlock();
};
$('#btnBalance').onclick = () => {
  settings.balance = !settings.balance;
  save('as.balance', settings.balance);
  $('#btnBalance').classList.toggle('on', settings.balance);
  banner(settings.balance ? L('⚖ 均衡火力：比效率，不比数量', '⚖ Balanced firepower: efficiency, not volume') : L('🔥 真实火力：谁干的活多谁火力猛', '🔥 Raw firepower: the busiest team hits hardest'), 'gold', 2000);
  if (S.mode === 'live') S.R.balance = settings.balance;
  else if (S.tl) {
    const m = S.m;
    buildReplay();
    seek(m);
  }
};
$('#btnPlay').onclick = () => {
  if (S.ended) seek(0);
  S.playing = !S.playing;
  $('#btnPlay').textContent = S.playing ? '⏸' : '▶';
};
$('#btnRestart').onclick = () => {
  seek(0);
  S.playing = true;
  $('#btnPlay').textContent = '⏸';
};
$('#speeds').onclick = (e) => {
  const s = Number(e.target.dataset.s);
  if (!s) return;
  S.speed = s;
  renderSpeeds();
};

const tlWrap = $('#timelineWrap');
let dragging = false;
const seekFromPointer = (e) => {
  const r = tlWrap.getBoundingClientRect();
  seek(clamp((e.clientX - r.left) / r.width, 0, 1) * S.tl.duration);
};
tlWrap.addEventListener('pointerdown', (e) => {
  if (!S.tl) return;
  dragging = true;
  tlWrap.setPointerCapture(e.pointerId);
  seekFromPointer(e);
});
tlWrap.addEventListener('pointermove', (e) => {
  if (dragging) seekFromPointer(e);
});
tlWrap.addEventListener('pointerup', () => (dragging = false));

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || !S.mode) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    $('#board').hidden = false;
    renderBoard();
  } else if (e.key === ' ' && S.tl) {
    e.preventDefault();
    $('#btnPlay').click();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && S.tl) {
    seek(S.m + (e.key === 'ArrowLeft' ? -1 : 1) * Math.max(30e3, S.speed * 10e3));
  } else if (/^[1-6]$/.test(e.key) && S.tl) {
    S.speed = SPEEDS[Number(e.key) - 1];
    renderSpeeds();
  } else if (e.key === 'h' || e.key === 'H') {
    $('#legend').hidden = !$('#legend').hidden;
  } else if (e.key === 'Escape') {
    $('#legend').hidden = true;
    $('#board').hidden = true;
    $('#stars').hidden = true;
  }
}
function onKeyUp(e) {
  if (e.key === 'Tab' && S.mode) $('#board').hidden = true;
}
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

// ================================================================ 桌面悬浮窗（文档画中画）
// 游戏画面放进一个始终浮在最上层的小窗口：你在别的软件里干活，桌面角落一直放着 AI 们打架。

const MOVED = ['#game', '#hud', '#board', '#legend', '#endscreen', '#stars'];

async function togglePip() {
  if (pip) return pip.close();
  if (!('documentPictureInPicture' in window)) return;
  let w;
  try {
    w = await window.documentPictureInPicture.requestWindow({ width: 760, height: 480 });
  } catch {
    banner(L('📺 这个浏览器开不了悬浮窗<small>请用电脑上的 Chrome 或 Edge 打开 http://127.0.0.1:8765</small>', '📺 This browser cannot open a floating window<small>Open http://127.0.0.1:8765 in desktop Chrome or Edge</small>'), 'bad', 4000);
    return;
  }
  const link = w.document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('style.css', location.href).href;
  w.document.head.append(link);
  w.document.title = 'AGENT STRIKE';
  w.document.documentElement.lang = document.documentElement.lang;
  pip = w;
  for (const sel of MOVED) w.document.body.append(document.querySelector(sel));
  w.addEventListener('resize', resize);
  w.addEventListener('keydown', onKeyDown);
  w.addEventListener('keyup', onKeyUp);
  w.addEventListener('pagehide', restorePip, { once: true });
  $('#pipNote').hidden = false;
  link.onload = resize;
  resize();
}

function restorePip() {
  const w = pip;
  if (!w) return;
  pip = null;
  for (const sel of [...MOVED].reverse()) document.body.prepend(w.document.querySelector(sel));
  $('#pipNote').hidden = true;
  resize();
  requestAnimationFrame(frame);
}

// ================================================================ 主循环

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  rt += dt;
  if (S.R) {
    setCivilNames(cur().civilNames);
    if (S.mode === 'live') applyFx(S.R.advance(Date.now()));
    else stepReplay(dt);
    if (cur().modeId !== S.vid) syncView();
    S.V.update(dt, cur());
    pumpAnnounce();
    const due = later.filter((l) => l.at <= rt);
    later = later.filter((l) => l.at > rt);
    for (const l of due) l.fn();
    if ([...cur().waits.values()].some((w) => !w.boom) && rt - lastBeep > 0.9) {
      lastBeep = rt;
      sfx.beep();
    }
    updateHud(dt);
  }
  render(dt);
  win().requestAnimationFrame(frame);
}

// ================================================================ 启动

async function boot() {
  await Promise.all(MODE_IDS.map(async (id) => {
    try {
      MODES[id] = await import(`./modes/${id}.js`);
    } catch (err) {
      console.warn(`mode ${id} not ready:`, err.message);
    }
  }));
  if (!MODES[S.game]) S.game = MODES.party ? 'party' : 'cs';
  applyStaticText();
  resize();
  requestAnimationFrame(frame);
  // 网址参数直接开打：?game=moba&day=2026-10-09 或 ?game=br&live=1
  const q = new URLSearchParams(location.search);
  if (q.get('game') && MODES[q.get('game')]) S.game = q.get('game');
  if (q.get('day')) return playDay(q.get('day'));
  if (q.get('live')) return startLive();
  if (q.get('demo')) return playDemo();
  openMenu();
}

boot();
