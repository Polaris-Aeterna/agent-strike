// 用真实数据跑一个游戏的规则，看平衡：node tools/sim.mjs <游戏id> <YYYY-MM-DD 或 demo> [--party] [--solo] [--raw]
import { loadDay, loadMode, titlesOf, partyOpts } from './data.mjs';

const [id, day = 'demo', ...flags] = process.argv.slice(2);
const langFlag = flags.find((f) => f.startsWith('--lang='));
if (langFlag) globalThis.AS_LANG = langFlag.slice(7);
if (!id) {
  console.log('用法：node tools/sim.mjs <游戏id> <YYYY-MM-DD> [--party] [--raw]');
  process.exit(1);
}
const mode = await loadMode(id);
const data = await loadDay(day);
const asParty = id === 'party' || flags.includes('--party') || flags.includes('--solo');
const extra = id === 'party' ? await partyOpts() : asParty ? { modes: [mode], solo: flags.includes('--solo') } : {};
const RulesClass = asParty ? (await loadMode('party')).Rules : mode.Rules;
const R = new RulesClass({ titles: titlesOf(data.sessions), balance: !flags.includes('--raw'), party: flags.includes('--party'), ...extra });
const counts = {};
const reasons = {};
let acts = 0;
let roundActs = [];
let cur = 0;
const t0 = performance.now();
for (const ev of data.events) {
  const fx = R.process(ev);
  if (R.phase === 'live' && ['shell', 'read', 'edit', 'web', 'misc', 'agent'].includes(ev.k)) {
    acts++;
    cur++;
  }
  for (const f of fx) {
    counts[f.type] = (counts[f.type] || 0) + 1;
    if (f.type === 'roundEnd') {
      reasons[f.reason] = (reasons[f.reason] || 0) + 1;
      roundActs.push(cur);
      cur = 0;
    }
  }
}
const ms = performance.now() - t0;
const s = R.summary();
roundActs.sort((a, b) => a - b);
const med = roundActs[Math.floor(roundActs.length / 2)] ?? 0;
console.log(`${mode.meta.name}  ${day}${flags.length ? ' ' + flags.join(' ') : ''}`);
console.log(`  比分 Claude ${s.score.claude} : ${s.score.codex} Codex   回合 ${s.rounds}   原因 ${JSON.stringify(reasons)}`);
console.log(`  比赛中的动作 ${acts}，每回合动作数中位数 ${med}（最少 ${roundActs[0] ?? '-'}，最多 ${roundActs.at(-1) ?? '-'}）`);
console.log(`  MVP ${s.mvp?.name ?? '-'}   耗时 ${ms.toFixed(0)}ms / ${data.events.length} 个事件`);
console.log(`  效果统计 ${JSON.stringify(counts)}`);
if (s.stages) console.log(`  关卡 ${s.stages.map((x) => `${x.mode}:${x.winner || '平'}`).join(' ')}`);
