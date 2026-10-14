// 确定性检查：只在事件上推进时钟 vs 事件之间也频繁推进，两种方式必须打出完全一样的比赛。
// node tools/determinism.mjs <游戏id> <YYYY-MM-DD> [--party]
import { loadDay, loadMode, titlesOf, partyOpts } from './data.mjs';

const [id, day = 'demo', ...flags] = process.argv.slice(2);
const mode = await loadMode(id);
const data = await loadDay(day);
const asParty = id === 'party' || flags.includes('--party') || flags.includes('--solo');
const extra = id === 'party' ? await partyOpts() : asParty ? { modes: [mode], solo: flags.includes('--solo') } : {};
const RulesClass = asParty ? (await loadMode('party')).Rules : mode.Rules;
const make = () => new RulesClass({ titles: titlesOf(data.sessions), party: flags.includes('--party'), ...extra });

function play(stepMs) {
  const R = make();
  let last = data.events[0]?.t || 0;
  for (const ev of data.events) {
    if (stepMs) for (let t = last + stepMs; t < ev.t && t < last + 3600e3; t += stepMs) R.advance(t);
    R.process(ev);
    last = ev.t;
  }
  return JSON.stringify({ score: R.score, rounds: (R.history || []).map((h) => [h.winner, h.reason, h.mode]) });
}

const a = play(0);
const b = play(1700);
const c = play(250);
const ok = a === b && a === c;
console.log(`${id} ${day}${flags.length ? ' ' + flags.join(' ') : ''}: ${ok ? '✅ 一致 / deterministic' : '❌ 不一致 / drift'}`);
if (!ok) {
  const [x, y] = [JSON.parse(a), JSON.parse(b)];
  console.log('  只在事件上推进 / events only:', x.score, x.rounds.length, '回合');
  console.log('  每 1.7 秒推进 / every 1.7s:', y.score, y.rounds.length, '回合');
}
process.exit(ok ? 0 : 1);
