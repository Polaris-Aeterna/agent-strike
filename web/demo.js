// 演示数据：电脑上没有 Claude / Codex 记录的人也能玩。生成虚构的一天：4 个 Claude 会话 vs 3 个 Codex 会话。
// Demo data for people without any Claude / Codex logs: a made-up day, 4 Claude sessions vs 3 Codex sessions.
import { rng } from './core.js';

const PROJECTS = {
  claude: ['refactor-auth', 'paper-revision', 'landing-page', 'data-pipeline', 'fix-flaky-tests'],
  codex: ['rust-rewrite', 'docs-i18n', 'ml-experiments', 'api-gateway', 'mobile-app'],
};
const FILES = ['main.py', 'app.tsx', 'README.md', 'auth.go', 'model.py', 'index.html', 'paper.tex', 'utils.rs', 'test_api.py', 'schema.sql', 'server.ts', 'train.py'];
// [命令, 跑成功算不算「爆头」（测试 / 编译 / 提交）]
const CMDS = [['npm test', true], ['pytest', true], ['git status', false], ['python3 train.py', false], ['cargo build', false], ['latexmk', true], ['ls', false], ['git commit', true], ['docker compose up', false], ['go test', true]];
const TOOLS = {
  claude: { read: 'Read', edit: 'Edit', shell: 'Bash', web: 'WebSearch', agent: 'Agent' },
  codex: { read: 'exec', edit: 'apply_patch', shell: 'exec', web: 'web_search', agent: 'spawn_agent' },
};

/** 生成一天的事件。同一个 seed 永远生成同一天。 */
export function demoDay(seed = 7) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const start = new Date(2026, 0, 15, 9, 0, 0).getTime();
  const end = start + 7 * 3600e3;
  const events = [];
  const sessions = {};
  for (const src of ['claude', 'codex']) {
    const n = src === 'claude' ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const sid = `demo-${src}-${i}`;
      sessions[sid] = { src, title: PROJECTS[src][i], cwd: PROJECTS[src][i] };
      let t = start + r() * 40 * 60e3 + i * 15 * 60e3;
      while (t < end) {
        // 一段干活：几轮对话，然后去忙别的
        const turns = 2 + Math.floor(r() * 5);
        for (let k = 0; k < turns && t < end; k++) {
          t = turn(events, sid, src, t, r, pick);
          t += 5e3 + r() * 50e3;
        }
        t += (3 + r() * 14) * 60e3;
      }
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { sessions, events };
}

/** 一轮对话：你发一条消息，AI 思考、读文件、改代码、跑测试……最后交差。 */
function turn(events, sid, src, t0, r, pick) {
  let t = t0;
  const tools = TOOLS[src];
  const ev = (k, extra = {}) => events.push({ t: Math.round(t), src, sid, k, ...extra });
  ev('prompt');
  const steps = 4 + Math.floor(r() * 14);
  for (let i = 0; i < steps; i++) {
    t += 1500 + r() * 9000;
    ev('think');
    ev('tokens', { n: 100 + Math.floor(r() * 900) });
    t += 300 + r() * 1500;
    const x = r();
    if (x < 0.3) ev('read', { tool: tools.read, tgt: pick(FILES), ok: true });
    else if (x < 0.53) ev('edit', { tool: tools.edit, tgt: pick(FILES), ok: r() > 0.06 });
    else if (x < 0.83) {
      const [cmd, test] = pick(CMDS);
      const ok = r() > 0.12;
      ev('shell', { tool: tools.shell, tgt: cmd, ok, ...(test && ok ? { hs: true } : {}) });
    } else if (x < 0.9) ev('web', { tool: tools.web, tgt: 'search', ok: true });
    else if (x < 0.94) {
      // 派出子代理：一阵猛干
      ev('agent', { tool: tools.agent });
      const burst = 6 + Math.floor(r() * 18);
      for (let b = 0; b < burst; b++) {
        t += 400 + r() * 2500;
        const kind = r() < 0.5 ? 'read' : 'shell';
        ev(kind, { tool: tools[kind], tgt: pick(FILES), ok: r() > 0.08, sub: 1 });
      }
    } else if (x < 0.965) {
      // 停下来等你回复
      ev('ask', { tool: 'AskUserQuestion' });
      t += 4e3 + r() * r() * 150e3;
      ev('answer', { tool: 'AskUserQuestion' });
    } else if (x < 0.975) ev('compact');
    else if (x < 0.98) ev('apierr');
    else ev('misc', { tool: 'TodoWrite', tgt: '', ok: true });
  }
  t += 1000 + r() * 5000;
  ev('think');
  ev('tokens', { n: 300 + Math.floor(r() * 1500) });
  ev('done');
  if (r() < 0.05) ev('pr');
  if (r() < 0.015) ev('abort');
  return t;
}
