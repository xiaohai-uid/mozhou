# #119 章后回顾面板与提交链自动触发 · 浏览器级交互验证证据

> 2026-10-24 实跑记录。环境：本仓生产构建（`node scripts/launcher.mjs`，PORT=5199，
> `MOZHOU_DATA_ROOT=.tmp-facts-evidence-119` 隔离数据根）。场景一额外带
> `MOZHOU_DRAFT_PROVIDER=mock`（确定性提取缝）；场景二不带该开关（未配置模型）。
> 浏览器驱动：Playwright（真实 Chromium，真实 HTTP 到本机生产服务）。

## 场景一：提交后自动触发 + 面板逐项决断（mock 提取缝）

操作序列（全部真实 UI 点击）：
1. 建书《章后回顾验收书》→ 编辑器写入 27 字正文 → 「落为当前章草稿」。
2. 检视塔「质量门」tab 填定稿说明 → 「确认定稿入账 (Commit)」→ 200（cmit_01M5QDS…）。
3. 切到新增的「章后回顾」tab（检视塔第五个 tab）。

观察到的外部行为：

- 提交完成后面板即呈现：徽标「待决 2」、状态行「上次提取：新增 2 条候选 · 作废旧待决 0
  条（进度同步记录在任务中心）」、两条候选卡（章节事件 / 人物心理状态），各带
  确认 / 编辑 / 拒绝三按钮与「依据：原文摘句 · 来源：第 1 章」。
  → 截图 `01-auto-extracted-pending.png`。
- 点「章节事件」候选的「确认」→ 待决 2 → 1，候选离开待决列表（决断贯通
  /api/facts.decide）。
- 点「人物心理状态」候选的「编辑」→ 三字段结构化编辑表单（人物 / 之前 / 之后，
  预填原值）→ 改为 轻蔑 → 忌惮 → 「编辑后确认」→ 待决归 0，
  显式空态「本章没有待决候选事实——账本只记你认可的事实」。
  → 截图 `02-all-decided-empty.png`。
- 账本盘面核验（`.tmp-facts-evidence-119/books/book-mvmnbxza-cf10152f/.mozhou/fact-ledger/`，
  已随手架清理，此为当时读回）：
  - `fc_01M5QDSZC1B1KJ66BQHMVM9DX1 | event | confirmed | original-payload`（纯确认不写 decidedPayload）；
  - `fc_01M5QDSZC35BDDXWYKJQKPK5MM | psychological_state | confirmed | EDITED->{"summary":"萧炎：轻蔑 → 忌惮",...}`（编辑确认写 decidedPayload，原 payload 不动）。
- 任务进度进既有任务记录体系：`.mozhou/events.jsonl` 当时含两行
  `FactExtractionStarted`（17:02:19.007Z）与 `FactExtractionFinished`（17:02:19.014Z，
  trigger=auto_commit，同 runId，inserted=2）；任务中心（工作流 → 任务中心）事件流水
  以「管线生产」类别呈现这两行（#4 / #5）。→ 截图 `03-task-center-progress-rows.png`。

## 场景二：未配置模型 → 明确失败与重试入口（无 mock 开关重启服务）

同一数据根、去掉 `MOZHOU_DRAFT_PROVIDER` 重启生产服务（真实解析缝，未配任何 Key）：

- 「章后回顾」面板显示横幅「未配置模型：提交后的候选事实提取需要配置写作模型（模型设置）。
  配置后点『重试提取』——绝不假成功。」与「重试提取」按钮。
  → 截图 `04-unconfigured-banner.png`。
- 点「重试提取」→ POST /api/facts.extract 返回 200 {ok:false, code:PROVIDER_UNAVAILABLE}
  → 面板错误位显示「未配置模型：候选事实提取需要配置写作模型（模型设置）。配置后点
  『重试提取』。」，无假候选产生。→ 截图 `05-unconfigured-retry-explicit-failure.png`。

## 同票的其他层验收（非浏览器，测试断言）

- 提交链 HTTP 级集成：`apps/web/server/routes/proseRoutes.commitFacts.test.ts`——
  流式缝注入 300ms 延迟后，/api/chapter.commit 响应在 250ms 内返回且 /api/facts.status
  此时仍为 FactExtractionStarted（提交响应不等提取），随后收口 Finished；未配置 provider
  的提交零进度行（任务跳过 ≠ 假启动）。
- 单元 / 路由面：`apps/web/server/facts/autoExtract.test.ts`（5 例）、
  `apps/web/server/routes/factsRoutes.test.ts` 增补 3 例（status 面 + 手动失败原因持久化）、
  `apps/web/src/facts/ChapterReviewPanel.test.tsx`（12 例）、
  `apps/web/src/shell/InspectorTower.test.tsx` 更新为五 tab 骨架。

## 已知边界（如实声明）

- 「叙事记忆零增长」警告来自正典五族提取缝（/api/chapter.commit 的 canon delta，
  走 FINAL_EXTRACT 生成缝），与候选事实两查（DRAFT_TASK_TYPE 共享缝）是两条独立缝；
  mock 开关不喂 canon 缝，属既有行为，非本票缺陷。
- 验收所用临时数据根 `.tmp-facts-evidence-119` 已在验证后删除；截图与本文为留存证据。
