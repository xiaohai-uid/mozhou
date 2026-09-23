# MoZhou Ink Realm / 墨境 — 本地设计 AI 交接提示词

> 配套规格：`docs/superpowers/specs/2026-09-12-mozhou-ink-realm-design.md`
>
> 阶段：Design only。禁止直接修改生产 UI。

把以下内容作为完整任务交给本地设计 AI：

---

你现在负责 `C:\zcode\novel-ai` 的下一代全产品 UI/UX 设计。你的任务不是“换皮”，也不是直接开始改生产代码，而是基于**本机最新代码图谱**，把已经批准的 **MoZhou Ink Realm / 墨境** 设计语言做成颗粒度对齐的完整设计方案与高保真原型。

## 0. 最高优先级输入

先完整读取：

1. `C:\zcode\novel-ai\docs\superpowers\specs\2026-09-12-mozhou-ink-realm-design.md`
2. `C:\zcode\novel-ai\apps\web\DESIGN.md`
3. `C:\zcode\novel-ai\docs\adr\0027-ui-baseline-ink-orbit.md`
4. `C:\zcode\novel-ai\CONTEXT.md`
5. `C:\zcode\novel-ai\AGENTS.md`

然后读取本机最新 GitNexus / `.gitnexus` 代码图谱。**不要只靠上面这份规格，因为本地 HEAD 可能比规格生成时更新。**

如果 `2026-09-12-mozhou-ink-realm-design.md` 在本地不存在，先只同步这份 docs 变更或从仓库 master 获取它；不要覆盖本地未提交工作。对应远端 docs commit 为 `6b01e4433b76dfb6bbc641eea24c448525ca9fbc`。

## 1. 第一阶段必须是代码图谱审计，不得画 UI

从代码图谱建立完整 surface map，至少覆盖：

- `apps/web/src/App.tsx`
- `shell/views.ts`
- Desktop shell：TopBar / CapabilityChannels / PipelineStrip / InspectorTower / Wizard / DesktopToolModals
- Workbench / DialogueStream
- `workbench/editor/*`
- Quality / Story Brain / Context Receipt / Change Matrix
- Works / Bookshelf / Book Source
- Tasks / Style Distill / Novel Breakdown / Rank Scan / Web Search / Cloud Sync / Membership / Capability Square
- MobileShell + 5 hubs + drawers + mobile components
- `canon-graph/*`
- `genre-kits/*`
- `export-suite/*`
- 任何代码图谱中新出现但规格没有列出的 UI / action / state
- `apps/web/server/api.ts`
- `server/routes/*`

你必须把每个 surface 标记为：

- `MOUNTED_TRUTHFUL`
- `MOUNTED_PARTIAL_OR_BLOCKED`
- `CODE_PRESENT_UNMOUNTED`
- `NEW_DESIGN_REQUIREMENT`

并建立：

`功能 → 入口 → 组件 → 子组件 → action → API / state → empty/loading/error/blocked/success → 设计落点`

的追踪表。

**没有完成这张追踪表，不允许进入视觉设计。**

## 2. Truthfulness gate 是硬约束

特别核对 API route 顺序。当前设计不能把以下下游 demo/fallback 数据画成真实在线能力：

- Novel Breakdown
- Web Search
- Rank Scan

如果最新本地代码仍由 `truthfulPreviewRoutes` 在前面 fail-closed，就必须设计真实的 unavailable / not configured 状态，而不是画漂亮的假结果。

同理：

- cloud local-ready ≠ cloud synced
- accepted ≠ committed
- selected pipeline stage ≠ stage executed
- code present ≠ feature shipped
- local preset ≠ AI generation
- mock Canon Graph ≠ real book graph
- future plan ≠ purchasable membership

## 3. 设计方向不可改变

设计语言：

**MoZhou Ink Realm / 墨境**

**东方未来主义 × 文学沉浸空间 × 精密 AI HUD × 高级卡牌信息系统**

核心体验：

> 用户进入自己的小说世界，墨舟是一套悬浮在这个世界之上的专业创作仪器。

不要复制任何现有游戏的 Logo、角色、卡面、图标或官方资产。

## 4. Scene System 必须作为一等公民设计

背景不能是一张烘焙死的图。拆成：

- Scene
- Atmosphere
- Foreground Figure

V1 必须有：背景选择/上传、人物上传/替换/隐藏、人物位置/缩放/透明度、背景焦点、亮度、模糊、暗幕、全局 profile、按作品 override。

人物层必须可以完全关闭。移动端默认关闭人物层。

Scene 是 UI preference，不是 Canon。

## 5. 色彩语义固定

- Gold = 作者主权 / Accept / Confirm / Commit / Publish
- Jade = AI / System / Skill / Analysis / Candidate
- Green = verified / durable success
- Warning = advisory / stale
- Red = blocking / error / destructive

不要重新做成满屏紫蓝 AI 渐变。

## 6. 视觉强度固定

- Skill / Capability Square：90%
- Works / Bookshelf：90%
- Wizard：90%
- Workbench frame / Story Brain：80%
- Book Source / Style Distill：60%
- Rank / Search / Membership：45%
- Inspector / Tasks / Receipt / Matrix：30%
- Prose editor：10%

正文是全产品最安静的地方。

## 7. 颗粒度硬要求

不能只设计一个首页、一个工作台、一个 Skill 页面就说做完。

必须覆盖：

- 17 个一级导航能力
- 8 步 Pipeline
- 4 个 Inspector domain
- Workbench 的问答、choice、skill、provider、stream、error、ledger、chapter navigation
- Quality 的 no-report/pass/blocking/refused/stale/rework/correction
- Story Brain 的 5 类 entity + canon/suspects/believes/invalidated
- Receipt 的 hash/budget/entries/replay/resume
- Matrix 的 3 cell states/rerun
- Desktop auxiliary tools
- Wizard 5 steps
- Mobile 5 hubs + drawers
- Advanced editor / Canon Graph / Genre Kits / Export Suite 等 code-present 子系统
- empty/loading/error/blocked/disabled/current/stale/committed 等所有关键状态

规格中的 Acceptance Matrix 是最低覆盖线，不是建议。

## 8. 允许产出的设计文件

设计阶段允许创建**隔离的设计产物**，不得修改生产 `src` 行为。

建议放在：

`C:\zcode\novel-ai\apps\web\prototypes\ink-realm\`

以及相应 docs 目录。

可以创建：

- token board
- component board
- Scene System prototype
- desktop shell prototype
- Workbench prototype
- Evidence Tower prototype
- 17 capability surface prototypes/specs
- mobile hub prototypes
- coverage matrix
- design review screenshots

不要为了原型去改真实 API、数据库、domain package 或生产 UI。

## 9. 高保真设计必须使用真实字段

如果需要展示数据：

- 优先从真实本地书与真实 API 读取。
- 如果只是版式占位，明确标 `DESIGN FIXTURE`。
- 不允许让 fixture 看起来像当前用户真实状态。
- 不允许伪造 PASS、字数、热榜、云同步、会员授权、实时搜索等产品事实。

## 10. 设计完成时必须提交四份结果

### A. `INK_REALM_SURFACE_MAP.md`
完整代码图谱 → 设计表，逐项证明无遗漏。

### B. `INK_REALM_DESIGN_SYSTEM.md`
Token、材质、排印、颜色语义、卡片类型、按钮、状态、动效、可访问性、响应式。

### C. 高保真原型
Desktop + Mobile，覆盖规格定义的所有产品域；可以用多个 HTML/图像，不要把几十个页面压进一张小图。

### D. `INK_REALM_COVERAGE_REPORT.md`
逐项勾选主规格 §32 Acceptance Matrix，并列出：

- PASS
- BLOCKED_BY_REAL_CAPABILITY
- CODE_PRESENT_UNMOUNTED
- DESIGN_DELTA_FOUND

任何漏项必须写出来，禁止用“整体已覆盖”代替逐项证据。

## 11. 最终 Gate

设计阶段结束时，先停下来给我验收。

在我明确批准之前：

- 不修改 `apps/web/src` 的生产 UI。
- 不重构组件。
- 不安装依赖。
- 不替换 Tailwind / Vite / React。
- 不新增后端接口。
- 不更新 ADR 为“已实施”。
- 不 commit/push 生产实现。

最终目标不是“像某个游戏”，而是：

> **让墨舟像一件来自小说世界里的专业创作仪器，同时对齐当前代码图谱的每一个真实功能颗粒。**

---
