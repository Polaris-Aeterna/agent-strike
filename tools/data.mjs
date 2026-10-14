// 测试工具共用：拿到一天（或一场 1v1）的事件。优先读缓存，没有就问本地服务器。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AS_SERVER || 'http://127.0.0.1:8765';

export async function loadDay(day) {
  // 'demo'：用 web/demo.js 生成的虚构数据，没有任何会话记录也能测
  if (day === 'demo') return (await import(path.join(ROOT, 'web', 'demo.js'))).demoDay();
  const file = path.join(ROOT, '.cache', `day-${day}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await fetch(`${BASE}/api/day?day=${day}`);
  if (!r.ok) throw new Error(`拿不到 ${day}：${r.status}（服务器开着吗？python3 server.py）`);
  return r.json();
}

export async function loadMode(id) {
  return import(path.join(ROOT, 'web', 'modes', `${id}.js`));
}

export function titlesOf(sessions) {
  return Object.fromEntries(Object.entries(sessions).map(([sid, m]) => [sid, m.title]));
}

const ALL = ['cs', 'moba', 'br', 'kart', 'poke', 'fight', 'tetris', 'mc', 'pvz', 'soccer', 'taiko', 'pac', 'snake', 'mono', 'sus', 'birds', 'ddz', 'dino', 'farm', 'plane'];

/** 大乱斗要先把能抽到的游戏都加载进来（还没写好的跳过）。 */
export async function partyOpts() {
  const modes = [];
  for (const id of ALL) {
    try {
      modes.push(await loadMode(id));
    } catch {
      /* 还没写好 */
    }
  }
  return { modes };
}

/** app 里单独玩一个游戏时的样子：外面套一层 solo 外壳（负责内战切换）。 */
export async function soloRules(mode, opts) {
  const party = await loadMode('party');
  return new party.Rules({ ...opts, modes: [mode], solo: true });
}
