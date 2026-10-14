# 怎么加一个新游戏

每个游戏是 `web/modes/<id>.js` 一个文件，导出三样东西：`meta`、`Rules`、`View`。
`modes/cs.js` 是完整的参考实现，先读它。

同一条 AI 事件流喂给所有游戏，每个游戏只决定「这个动作在我这里是什么」。

## 事件（规则层收到的东西）

```js
{ t: 毫秒时间戳, src: 'claude'|'codex', sid: 会话id, k: 种类, tool, tgt, ok, hs, n, sub }
```

| k | 含义 | 出现频率（一天，粗略） |
|---|---|---|
| `shell` | 跑命令。`ok:false` 是报错，`hs:true` 是测试/编译通过/git commit | 很多 |
| `read` | 读文件、搜代码 | 很多 |
| `edit` | 改代码 | 中 |
| `web` | 上网查资料 / 浏览器 | 中 |
| `misc` | 其它工具 | 少 |
| `agent` | 派出子代理 | 少 |
| `think` | 思考 | 很多（几乎每条消息） |
| `compact` | 上下文压缩 | 很少 |
| `done` | 一轮任务完成 | 中 |
| `prompt` | 人类发了一条消息 | 少 |
| `abort` | 人类打断了它 | 很少 |
| `apierr` | API 报错 | 很少 |
| `ask` / `answer` | 它开始等你 / 你回复了（底座已处理，见下） | 很少 |
| `pr` | 开了 PR | 很少 |
| `tokens` | 烧了 `n` 个输出 token（不算动作，不会让人上场） | 很多 |

`sub:1` 表示这是子代理干的活（已经算在主会话头上）。

**节奏参考**：两队都在场的时间里，一天大约只有 300～600 个动作（shell/read/edit/web/misc/agent）。
CS 每回合中位数约 10 个动作。设计数值时照这个来，不要指望一回合有几百个动作。

## Rules（规则层）

继承 `core.js` 里的 `Rules`。它已经处理好：

- 玩家创建、上场（`join`）、5 分钟没动作挂机下场（`bench`）、每队最多 `maxPerTeam` 人；
- 两队都有人（混战模式：总共 ≥2 人）才进入 `phase='live'` 并开始第 1 回合，否则 `'warmup'`；
- 通用统计：`p.k d a hs dmg ops errs done tok asks prompts waitMax`（`k/d/a/hs/dmg` 由你的规则去加）；
- 「它在等你」：`ask` 开始计时，40 秒内 `answer` 算及时，超时算「爆炸」。你只需要实现钩子；
- 回合：`this.endRound(winner, reason, fx, '横幅上的原因文字')` 结束本回合并自动开下一回合；
- 平衡：伤害 / 进度乘上 `this.balanceMult(p.team) * this.sizeMult()`（均衡火力 + 人少时单发更痛）；
- `this.foes(p)`：活着的敌人（混战模式下两队都在打对面，只有一队时自己人互打）。

常用钩子（都可选，见 `core.js` 顶部注释）：

```js
init()                         // 重置时建自己的状态（注意：在子类构造函数之前被调用，配置请从 this.opts 读）
initPlayer(p)                  // 给玩家加字段：p.hp = 100 ...
onEnter(p, fx) / onLeave(p, fx)
onRoundStart(fx) / onRoundEnd(winner, fx)
onEvent(p, ev, r, fx)          // 核心。r() 是确定性随机数
onTokens(p, n, fx)
onTick(fx)                     // 比赛进行中每次时间前进；用于计时器
timers()                       // 返回定时器的绝对时刻（毫秒），比如 [this.roundStart + this.roundLen]；时钟会准点停在这些时刻
onWait(p, fx) / onAnswer(p, wait, fx) / onWaitTimeout(p, fx)
check(fx)                      // 判断回合结束
ghostOk(ev)                    // 倒下的人还能处理哪些事件（默认只有 agent）
```

`static defaults = { ffa: true, maxPerTeam: 6, ... }` 可以改默认配置。`this.opts.party` 为真时是在「大乱斗」里，
**一回合要短**（大约 10～30 个动作就该分出胜负），并且一定要调用 `endRound`。

**硬性规定**：规则层里不许用 `Math.random()`、`Date.now()`、DOM。随机数只能用 `r()`
（或 `rng(hash(...))`）。同样的事件序列必须打出完全一样的结果——回放拖进度条靠这个。
按时间触发的规则（定时涨垃圾、缩圈、回合时间到）要在 `timers()` 里登记，并且在 `onTick` 里按 `this.now`
准点结算；这样不管时钟推进得多密，结果都一样（用 `tools/determinism.mjs` 检查）。

### fx（规则层吐出来的效果）

规则通过往 `fx` 里 push 对象告诉画面发生了什么。下面这些 **app 会统一处理**（击杀播报、横幅、音效），
你的 View 只需要画自己的动画：

| type | 字段 | app 怎么处理 |
|---|---|---|
| `join` / `bench` | `sid`, `idle` | 小字播报上场 / 挂机 |
| `kill` | `killer`(可为 null), `victim`, `weapon`, `hs`, `cause`, `assist` | 右上角击杀播报。`cause`：`human`=你打断的，`bug`，`net`，`c4`，`zone`=毒圈，其它=普通 |
| `roundEnd` | `winner`, `reason`, `reasonText`, `score` | 中间横幅「X 队赢下第 N 回合」+ 音效 |
| `phase` | `phase` | 开打 / 热身横幅 |
| `wait` / `waitDone` / `waitBoom` / `waitLate` | `sid`, `wait` | 用 `meta.wait` 的文字出横幅 |
| `prompt` / `pr` | `sid` | 小字播报 / 横幅 |
| `announce` | `text`, `sub`, `cls`('gold'/'bad'/'claude'/'codex'), `ms` | 大横幅（比如「双杀！」「最后一圈！」） |
| `note` | `text`（用 `{0}` `{1}` 占位）, `sids` | 右上角一行小字，占位符会换成彩色名字 |

其它 type 随便你定义，只有你自己的 View 会看。

## View（画面层）

```js
export class View {
  constructor(app)
  reset(R)               // 新比赛 / 拖进度条 / 大乱斗切过来时调用：按规则状态重建画面
  apply(fx, R, busy)     // 一批效果。busy=true 表示倍速很高，少放点特效
  update(dt, R)          // dt 秒（真实时间）
  render(g, R, scale)    // 画整个世界。坐标系固定 1600×960，app 已经设好变换；scale 是世界→屏幕的缩放
  hud(R)                 // 返回 { mid, sub } 显示在顶部比分中间（可选 pips: { claude: [活着?], codex: [...] }）；返回 null 用默认
}
```

`app` 提供：

```js
app.sfx.shot(weapon) / headshot() / bite() / boom(big) / beep() / good() / round(win)
app.sfx.ok(priority) → bool         // 自己合成声音前先问一下（有节流）
app.sfx.tone(freq, dur, vol, type, toFreq, delay) / app.sfx.burst(dur, freq, vol, filterType)
app.rt()                            // 真实时间（秒）
app.later(sec, fn)                  // 延迟执行（拖进度条会清空）
app.mode                            // 'live' | 'day' | 'duel'
app.speed()                         // 回放倍速
app.shake(sec, magnitude)           // 震屏
app.nameOf(sid)
```

`fxkit.js` 有现成的：`Particles`（飘字、光环、火花、爆炸、弹道）、`pill`（名字牌）、`hpBar`、`emoji`、`fontFor(scale)`。
`core.js` 有 `COLOR` / `DEEP`（队伍颜色）、`actText(ev)`（「Bash · npm test」这种气泡文字）。

画面层可以用 `Math.random()`，它只管好看。画面里的东西（坐标、动画）不要写回规则层。

## meta

```js
export const meta = {
  id: 'cs', name: 'CS 爆破', icon: '🔫', desc: '一句话介绍',
  roundWord: '回合',                        // 横幅里「赢下第 N ___」
  wait: { start, sub, done, boom },          // 「它在等你」的文案，{a} 会换成名字
  legend: [['🔫 跑命令', '开枪'], ...],      // 图例
};
```

## 中英双语（必须）

游戏面向中文和英文玩家。所有给人看的文字都写成 `L('中文', 'English')`（`import { L } from '../i18n.js'`）：
画布上的字、fx 里的 `text` / `sub` / `reasonText` / 武器名、`hud()` 的返回值都算。

- `meta` 在加载时就求值，所以文字字段要写成 getter：`get name() { return L('…', '…'); }`（`desc`、`roundWord`、`wait`、`legend` 同理）。
- 规则层可以在发出 fx 时调用 `L()`；切换语言时 app 会把回放重算一遍。**语言绝不能影响比赛结果**：
  别拿翻译后的文字做判断，内部状态用 id。
- 英文尽量用原版游戏的经典台词（First Blood!、Winner Winner, Chicken Dinner!、It's super effective!），也要短到能放进同样的位置。
- 检查：`node tools/i18n-check.mjs web/modes/<id>.js`，会列出没包进 `L()` 的中文（注释不算）。

## 自测

没有自己的会话记录也能测：把日期换成 `demo`，用 `web/demo.js` 生成的虚构数据。
（`--solo` 表示按 app 里真实的样子运行：外面套一层外壳，只有一队在场时自动内战。）


```bash
node tools/sim.mjs <id> demo                  # 虚构数据，谁都能跑
node tools/sim.mjs <id> 2026-10-09            # 你自己记录里的某一天
node tools/sim.mjs <id> 2026-10-12            # Claude 人多的一天
node tools/sim.mjs <id> 2026-10-09 --party    # 大乱斗里的短回合
node tools/smoke.mjs <id> 2026-10-09          # 画面层冒烟测试（假画布），必须没有报错
node tools/smoke.mjs <id> 2026-10-09 --lang=en  # 英文也要跑
node tools/i18n-check.mjs web/modes/<id>.js   # 没翻译的中文
node tools/determinism.mjs <id> 2026-10-09     # 时钟推进疏密不同，结果必须一样
```

然后在浏览器里看：`http://127.0.0.1:8765/?game=<id>&day=2026-10-09`。
