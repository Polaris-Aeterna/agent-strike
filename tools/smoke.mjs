// 冒烟测试：规则 + 画面整个跑一遍（假画布），抓运行时报错。
// node tools/smoke.mjs <游戏id> <YYYY-MM-DD> [--party]
import { loadDay, loadMode, titlesOf, partyOpts } from './data.mjs';

function fakeCtx() {
  const grad = { addColorStop() {} };
  const target = {
    canvas: { width: 1600, height: 960 },
    measureText: (t) => ({ width: String(t).length * 7 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    getLineDash: () => [],
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
};
globalThis.Image = class {};

const [id, day = 'demo', ...flags] = process.argv.slice(2);
const langFlag = flags.find((f) => f.startsWith('--lang='));
if (langFlag) globalThis.AS_LANG = langFlag.slice(7);
const mode = await loadMode(id);
const data = await loadDay(day);
let rt = 0;
const later = [];
const sfx = new Proxy({}, { get: (t, k) => (k === 'ok' ? () => true : () => {}) });
const app = {
  sfx, mode: 'day', rt: () => rt, speed: () => 20, later: (s, fn) => later.push([rt + s, fn]),
  shake() {}, banner() {}, feed() {}, announce() {},
  nameOf: (sid) => sid.slice(0, 6), nameTag: (sid) => sid.slice(0, 6), esc: (s) => String(s), fmtDur: (ms) => `${ms}ms`,
};
const asParty = id === 'party' || flags.includes('--party') || flags.includes('--solo');
const extra = id === 'party' ? await partyOpts() : asParty ? { modes: [mode], solo: flags.includes('--solo') } : {};
const RulesClass = asParty ? (await loadMode('party')).Rules : mode.Rules;
const R = new RulesClass({ titles: titlesOf(data.sessions), party: flags.includes('--party'), ...extra });
// 大乱斗没有自己的画面，用当前这一关的游戏画面
const viewOf = (r) => new (asParty ? extra.modes.find((m) => m.meta.id === r.current.modeId) : mode).View(app);
const cur = () => R.current || R;
let V = viewOf(R);
let vid = cur().modeId;
const g = fakeCtx();
V.reset(cur());
let frames = 0;
let errors = 0;
const step = Math.max(1, Math.floor(data.events.length / 4000));
for (let i = 0; i < data.events.length; i++) {
  const fx = R.process(data.events[i]);
  try {
    // 和 app 一样在换关处切开：前半段给上一关的画面，后半段给新游戏的画面
    let rest = fx;
    for (let cut = rest.findIndex((f) => f.type === 'partySwitch'); cut >= 0; cut = rest.findIndex((f) => f.type === 'partySwitch')) {
      const sw = rest[cut];
      V.apply(rest.slice(0, cut), sw.prev, false);
      rest = rest.slice(cut + 1);
      vid = sw.next.modeId;
      V = new (asParty ? extra.modes.find((m) => m.meta.id === vid) : mode).View(app);
      V.reset(sw.next);
    }
    if (cur().modeId !== vid) {
      vid = cur().modeId;
      V = viewOf(R);
      V.reset(cur());
    }
    V.apply(rest, cur(), false);
    if (i % step === 0) {
      rt += 1 / 30;
      V.update(1 / 30, cur());
      while (later.length && later[0][0] <= rt) later.shift()[1]();
      V.render(g, cur(), 0.8);
      V.hud?.(cur());
      frames++;
    }
    if (i === Math.floor(data.events.length / 2)) V.reset(cur()); // 模拟拖进度条
  } catch (err) {
    errors++;
    if (errors <= 5) console.error(`事件 #${i} (${data.events[i].k}) 出错：`, err.stack.split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`${mode.meta.name}${asParty ? `（${extra.modes.map((m) => m.meta.id).join('/')}）` : ''}：${data.events.length} 个事件，画了 ${frames} 帧，${errors ? `❌ ${errors} 个错误` : '✅ 没有报错'}`);
process.exit(errors ? 1 : 0);
