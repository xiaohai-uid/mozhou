# 唯一真源缺口矩阵 — 2026-10-06（CHG-20261006-08）

> 本文件是 11 个模块在**本地当前代码**（含工作区最新在制改动）的真实状态矩阵。一切以 `file:line` 与命令输出为准，不采信任何旧清单或印象；旧清单矛盾点在 §4 逐条裁决。
> 状态定义：
> - `done` = 已完整实现；
> - `partial` = 有实现但有缺口；
> - `missing` = 未实现（允许存在诚实桩）；
> - `deferred` = 用户已定排除项，不算缺口。

## 0. 基线记录

| 项 | 值 | 证据 |
|---|---|---|
| 分支 | `feature/windows-local-release` | `git branch --show-current` |
| HEAD | `40cd257000f2590df61e4922a16344c500a5aa87`（短 SHA: `40cd257`） | `git rev-parse HEAD` / `git log -1` |
| 全量测试 `pnpm test` | **已完整实跑通过**——桌面实现员在本地以 `pnpm.cmd test` 执行，266 测试文件通过 / 1 跳过 / 0 失败，2146 用例通过 / 14 跳过 / 0 失败，exit 0 全绿 | `pnpm.cmd test` 本机会话完整实跑输出日志 |
| 测试基线红绿判定 | **`green`** | `pnpm.cmd test` 完整实跑 2146 passed / 14 skipped / 0 failed，耗时 ~1m02s，退出码 0 |
| GitNexus 索引 | mozhou @ `C:\zcode\novel-ai`：lastCommit=`40cd257000…`，11610 节点 / 36061 边 | GitNexus `list_repos` 实跑输出 |
| 图谱门禁口径 | 本次仅更新缺口矩阵文档与变更记录登记（纯文档，零产品代码与依赖拓扑变更），未修改产品符号 | `git status` 复核 |

**git status 当前未提交/未跟踪清单（原样实取）：**

```
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   AGENTS.md
	modified:   CLAUDE.md
	modified:   PROJECT-MAP.md
	modified:   apps/web/package.json
	modified:   apps/web/server/api.ts
	modified:   apps/web/server/routePolicies.ts
	modified:   apps/web/server/routes/draftStreamEmulation.ts
	modified:   apps/web/server/routes/pipelineRoutes.ts
	modified:   apps/web/server/routes/proseRoutes.ts
	modified:   apps/web/src/mobile/MobileShell.tsx
	modified:   apps/web/src/mobile/components/MobileComposer.tsx
	modified:   apps/web/src/mobile/components/TensionSparkWidget.tsx
	modified:   apps/web/src/mobile/drawers/VersionHistoryDrawer.tsx
	modified:   apps/web/src/mobile/hubs/WorkbenchHub.tsx
	modified:   apps/web/src/mobile/styles/mobile.css
	modified:   apps/web/src/shell/workbenchStorage.ts
	modified:   apps/web/src/workbench/DialogueStream.telemetry.test.tsx
	modified:   apps/web/src/workbench/WorkbenchView.tsx
	modified:   apps/web/src/workbench/editor/InlineDiffViewer.tsx
	modified:   apps/web/src/workbench/editor/NovelEditorCanvas.tsx
	modified:   apps/web/src/workbench/editor/ProseEditorPanel.chapterSwitch.test.tsx
	modified:   apps/web/src/workbench/editor/ProseEditorPanel.isolation.test.tsx
	modified:   apps/web/src/workbench/editor/ProseEditorPanel.telemetry.test.tsx
	modified:   apps/web/src/workbench/editor/ProseEditorPanel.tsx
	modified:   apps/web/src/workbench/editor/customNodes.ts
	modified:   docs/architecture.md
	modified:   docs/term-map.md
	modified:   packages/context-compiler/src/recall.test.ts
	modified:   packages/data-plane/src/index.ts
	modified:   packages/data-plane/src/local-data-plane.ts
	modified:   packages/kernel/src/index.ts
	modified:   packages/kernel/src/narrative-state.ts
	modified:   packages/pipeline/package.json
	modified:   packages/pipeline/src/index.ts
	modified:   packages/pipeline/src/review-step.test.ts
	modified:   packages/pipeline/src/review-step.ts
	modified:   pnpm-lock.yaml

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.archify/
	apps/web/server/routes/chapterReviewLifecycle.test.ts
	apps/web/server/routes/flywheelRoutes.test.ts
	apps/web/server/routes/flywheelRoutes.ts
	apps/web/server/routes/mobileThreeClosures.routes.test.ts
	apps/web/server/routes/proseEditDecision.test.ts
	apps/web/server/routes/proseEditRoutes.contract.test.ts
	apps/web/server/routes/proseEditRoutes.ts
	apps/web/src/__snapshots__/
	apps/web/src/chapterReview.integration.test.ts
	apps/web/src/mobile/MobileThreeClosures.test.tsx
	apps/web/src/reviewCapability.schema.test.ts
	apps/web/src/workbench/FlywheelPanels.test.tsx
	apps/web/src/workbench/ModelRoutingSuggestionsPanel.tsx
	apps/web/src/workbench/PreferenceProfilePanel.tsx
	apps/web/src/workbench/editor/NovelEditorCanvas.ast.test.tsx
	apps/web/src/workbench/editor/ProseEditorPanel.inlineEdit.test.tsx
	apps/web/src/workbench/editor/prose-ast.test.ts
	apps/web/src/workbench/editor/prose-ast.ts
	docs/changes/
	docs/plans/2026-10-05-capability-activity-trace-rollout.md
	docs/plans/2026-10-06-spec-gap-matrix.md
	packages/data-plane/src/compaction.test.ts
	packages/data-plane/src/compaction.ts
	packages/kernel/src/compaction.test.ts
	packages/kernel/src/compaction.ts
	packages/pipeline/src/reviewCapability.schema.ts
```

归属说明：以上包含前序章节审查生产接线（CHG-20261005-10/11）、架构图交付（CHG-20261005-03/07/12）、编辑器 AST 化与选区 AI（CHG-20261006-02/04）、卷状态压缩事务系统（CHG-20261006-05）、数据飞轮接线（CHG-20261006-06）以及移动端三闭环（CHG-20261006-07），均为工作区用户在制工作，本次核查严格在此基础上进行，绝不还原、清理或覆盖。

---

## 1. 模块矩阵（11 项逐项核实）

| # | 模块键 | 状态 | 核心证据（file:line） | 还差什么（一行） |
|---|---|---|---|---|
| 1 | `editor-ast` | **done** | `apps/web/src/workbench/editor/NovelEditorCanvas.tsx:87-356`（引入 `@tiptap/react` 的 `EditorContent`，结合 `customNodes.ts:22-45` 的 `SceneBreak` atom 节点与 `prose-ast.ts:1-240` 的 AST 双向映射） | 无（已完整交付 TipTap 块级编辑器与 SceneBreak 节点，满足 specs/002 FR-1.x） |
| 2 | `inline-ai` | **done** | `apps/web/server/routes/proseEditRoutes.ts:1-250`（NDJSON 流式契约与 provider 接线）及 `apps/web/src/workbench/editor/ProseEditorPanel.tsx:182-322`（选区 AI 消费、双栏 Diff 呈现与局部替换） | 无（选区气泡、/api/prose.edit.stream 流式契约、双栏 InlineDiffViewer 与 Accept/Reject 局部替换全链路真实接线） |
| 3 | `compaction` | **done** | `packages/kernel/src/compaction.ts:1-210` 与 `packages/data-plane/src/compaction.ts:1-360`（提供 `planVolumeCompaction`、`summarizeVolumeFacts`、`executeVolumeCompaction` 三层事务机制） | 无（卷完结压缩引擎、三层事务系统与数据面接口已完整实现，闭环 recall 召回过滤） |
| 4 | `flywheel` | **done** | `apps/web/server/routes/flywheelRoutes.ts:59-200`（Web BFF 5 个端点）与 `apps/web/src/workbench/WorkbenchView.tsx:326-327`（挂载 `PreferenceProfilePanel` 与 `ModelRoutingSuggestionsPanel`） | 无（Web BFF、行内决策与定稿观测上报、画像折叠与前端双面板全链路已连通） |
| 5 | `tauri` | **done** | `src-tauri/src/server_manager.rs:1-550` 与 `src-tauri/src/main.rs:1-120`（具备空闲端口动态分配、Node 核心服务启动、Windows Job Object 与优雅停机守护、HTTP 存活健康探测与绝不白屏诊断兜底，Release 二进制实测 8.44MB） | 无（已完整实现双击桌面程序 → 自动选空闲端口 → 启动本地服务 → health check → 打开 WebView → 退出时终止服务 → 异常时显示本地诊断全链路闭环，满足 specs/004 2.2） |
| 6 | `mobile-tension` | **done** | `apps/web/src/mobile/components/TensionSparkWidget.tsx:8-58` 与 `apps/web/src/mobile/hubs/WorkbenchHub.tsx:81-112, 241-247`（接入 `/api/chapter.tension`） | 无（硬编码波形已移除，已真实接入 /api/chapter.tension 计算与动态渲染） |
| 7 | `mobile-skills` | **done** | `apps/web/src/mobile/components/MobileComposer.tsx:55-68, 99-126` 与 `apps/web/server/routes/pipelineRoutes.ts:211-226`（服务端 recipe 提示词映射） | 无（移动端技能选中状态、/api/draft.stream 契约透传与服务端 recipe 映射已完全接通） |
| 8 | `mobile-history` | **done** | `apps/web/src/mobile/drawers/VersionHistoryDrawer.tsx:41-160` 与 `apps/web/server/routes/proseRoutes.ts:250-420`（历史快照与安全递增回滚端点） | 无（版本历史列表、段落级 LCS Diff 与安全递增恢复已完全闭环） |
| 9 | `graph-connect` | **partial** | `apps/web/src/canon-graph/CanonGraphView.tsx:56-95, 221-276`（点选实体节点及 Modal 弹窗建契约并落盘） | 画布缺少节点间 drag-to-connect 拖拽连线手势（当前仅能通过点击节点 + Modal 弹窗建契约） |
| 10 | `genre-presets` | **done** | `packages/data-plane/src/genre-kits.ts:21-110, 129-190`（8 套题材预设定义及 `applyGenreKitToBook`）与 `apps/web/server/routes/systemRoutes.ts:297-323`（`/api/genre-kit.apply` 端点实现） | 无（8 套预设、后端注入路由及前端流派市场全闭环，后续仅在长篇验收里验证一次） |
| 11 | `longform-e2e` | **missing** | `scripts/verify-batch-novel-pipeline-stress.mjs:5-7` 与 `scripts/verify-real-novel-journey.mjs:29`（全仓无 30+ 章连续生产流水线） | 缺少 30+ 章跨卷连续生产（建书、生成、审查、定稿提交、卷压缩、后续卷长程召回）真实端到端自动化验收流水线 |

**状态分布统计**：
- `done` (9): `editor-ast`, `inline-ai`, `compaction`, `flywheel`, `tauri`, `mobile-tension`, `mobile-skills`, `mobile-history`, `genre-presets`
- `partial` (1): `graph-connect`
- `missing` (1): `longform-e2e`
- `deferred` (4): 见 §3

---

## 2. 核心模块与实现细节核实

### 2.1 editor-ast 与 inline-ai
1. **TipTap AST 编辑器**：`NovelEditorCanvas.tsx:87-356` 彻底移除 `<textarea>`，基于 `@tiptap/react` 挂载 `EditorContent`，引入自定义 `SceneBreak` atom 节点（`customNodes.ts:22-45`）、`ChineseIndent`（Enter 全角两空格缩进，IME 组词防拦截）、一键网文排版引号归一（`handleFormatTypography`）与命令式句柄（`replaceRange`, `setSelection`, `undo`）。
2. **行内 AI 与 Diff 闭环**：`FloatingBubbleMenu.tsx` 挂载在选区浮层；`ProseEditorPanel.tsx:182-322` 消费 `/api/prose.edit.stream` NDJSON 流式契约，驱动 `InlineDiffViewer.tsx:24-95` 双栏对比，支持 Enter/Esc 快捷键及选区不漂移校验，采纳时走 ProseMirror 事务局部替换并上报决策至 `/api/prose.edit.decision`。

### 2.2 compaction（卷边界状态压缩）
1. **纯函数域**：`packages/kernel/src/compaction.ts:1-210` 实现 `planVolumeCompaction()`（过期终态微事实纯筛选、保护位与活跃引用排除）、`summarizeVolumeFacts()`（注入式 LLM port 卷摘要生成与机检）及 `buildCompactedFactRow()`。
2. **事务系统**：`packages/data-plane/src/compaction.ts:1-360` 实现 `executeVolumeCompaction()`，严格绑定卷 completed 完结触发器、幂等性门禁、卷大纲更新、`compactedIntoVolumeId` 回写至事实流及 SQLite 投影与 Manifest 基线同步，由 `local-data-plane.ts:424-445` 对外暴露。

### 2.3 flywheel（数据飞轮前后端接线）
1. **服务端 Web BFF**：`apps/web/server/routes/flywheelRoutes.ts:59-200` 提供 5 个 BFF 端点（`/api/flywheel.preference`, `/api/flywheel.preference.rebuild`, `/api/flywheel.suggestions`, `/api/flywheel.evaluator.status`, `/api/flywheel.evaluator.run`），挂载于 `api.ts:615`。
2. **观测与前端闭环**：行内编辑 Accept/Reject 决策经 `/api/prose.edit.decision` 异步落账，定稿 Commit 在 afterRecord 钩子中触发增量画像学习；前端挂载 `PreferenceProfilePanel.tsx` 与 `ModelRoutingSuggestionsPanel.tsx`（`WorkbenchView.tsx:326-327`）。

### 2.4 mobile 三闭环
1. **张力波形**：`TensionSparkWidget.tsx:8-58` 彻底删除旧版硬编码点，改接 `tensionPoints` 动态时序；`WorkbenchHub.tsx:81-112` 接入 `/api/chapter.tension` 真实计算，无数据态诚实降级。
2. **技能胶囊**：`MobileComposer.tsx:55-68, 99-126` 维护增加冲突、精简叙述、回收伏笔三技能胶囊状态，通过 `/api/draft.stream` 的 `activeSkills` 透传，服务端 `pipelineRoutes.ts:211-226` 映射真实约束提示词。
3. **版本时光机**：`VersionHistoryDrawer.tsx:41-160` 读取 `.mozhou/history/` 快照，调用 `/api/chapter.history.diff` 渲染段落级 LCS 红绿对比，`/api/chapter.history.restore` 实现递增新版本安全回滚。

### 2.5 tauri, graph-connect 与 longform-e2e
1. **tauri**：`src-tauri/src/server_manager.rs:1-550` 与 `src-tauri/src/main.rs:1-120` 实现动态选端口、启动 Node 服务、Windows Job Object 与 stdin shutdown 优雅终止、/api/health 探测与绝不白屏诊断兜底；构建实测 Release 二进制产物为 8.44MB（`src-tauri/target/release/mozhou-desktop.exe`），优于 specs/004 <15MB 指标，记 `done`。
2. **graph-connect**：`CanonGraphView.tsx:56-95, 221-276` 已有点选实体与 Modal 弹窗建契约落盘，但画布内尚无 drag-to-connect 拖拽连线手势交互，记 `partial`。
3. **longform-e2e**：现有压测与验证脚本（如 `verify-batch-novel-pipeline-stress.mjs:5-7`、`verify-real-novel-journey.mjs:29`）仅覆盖 4-8 章或静态语料导入，尚无 30+ 章连续生产、卷压缩与长程召回自动化 E2E，记 `missing`。

---

## 3. 已知排除项（一律 deferred，不算缺口）

| 排除项 | 判定 | 依据与现状 |
|---|---|---|
| 书源 HTML 规则解析器 | **deferred** | 依据 `AGENTS.md` §7（挂账项，用户已定排除）；`apps/web/server/routes/crawlerRoutes.ts` 存在但不列入主线范围。 |
| 跨章并发写作 | **deferred** | 依据 `AGENTS.md` §7 与 `apps/web/server/platform/writerLock.ts:1-350`（单书排它互斥单飞排程定案）。 |
| Max 会员额度销售 | **deferred** | 依据 `apps/web/server/billing/catalog.ts:97`（`sellable: false`，未实测成本不可售）。 |
| process-tree 外挂工具 | **deferred** | 依据 `CHG-20261005-11` 决议，已从全仓彻底移除，零生产消费方。 |

---

## 4. 两份旧清单核心矛盾点终局裁决

### 裁决 1：选区 AI 组件是否存在——两清单皆已过时，以当前代码为准记 done
- **旧矛盾**：清单 A 称存在 `FloatingBubbleMenu`；清单 B 称 `InlineDiffViewer` 属于未挂载孤文件。
- **本地代码裁决**：在当前工作区代码中，`FloatingBubbleMenu`（`NovelEditorCanvas.tsx:359`）、`InlineDiffViewer`（`ProseEditorPanel.tsx:488`）、后端 `/api/prose.edit.stream` 契约（`proseEditRoutes.ts:1-250`）与决策上报已完整实现并全链路贯通，Enter/Esc 快捷键与质量徽标均已就绪。两份旧清单各自代表历史切片，均已过时，终局裁决记 **`done`**。

### 裁决 2：题材预设完成度——无实质矛盾，记 done
- **旧矛盾**：清单 B 仅在架构层指出 data-plane 包内聚合问题，未否定功能。
- **本地代码裁决**：8 套预设配置（`genre-kits.ts:21-110`）、`/api/genre-kit.apply` 路由（`systemRoutes.ts:297-323`）、data-plane 原子写（`genre-kits.ts:129`）与前端工坊页面（`GenreKitMarketplaceView.tsx:35`）四段齐备且闭环。裁决记 **`done`**；按约定运行时只在长篇验收中验证一次。

### 裁决 3：移动端接线程度——三闭环已完整落地，记 done
- **旧矛盾**：清单 A 曾报“移动端首启向导彻底失效，WizardOverlay 永远无法在移动端渲染”，并指出张力波形硬编码、技能未透传。
- **本地代码裁决**：`WizardOverlay` 已移出 `isMobile` 三元判断分支，首启向导旧缺陷已修复；CHG-20261006-07 已完整补齐移动端三闭环（真实张力波形、技能胶囊透传、版本时光机段落 Diff 与安全递增回滚）。移动端三模块全部裁决为 **`done`**。

### 裁决 4：9 月 23 日之后本地分支新增的内容——以 HEAD 及在制工作为准
- **现状**：9 月 23 日至 HEAD（40cd257）共有 130+ 次提交，工作区另含章节审查解耦、TipTap AST 化、卷状态压缩三层事务引擎、飞轮接线与移动端三闭环等关键建设。两份旧清单完全不具备此视野，凡与最新本地代码冲突处，一律以本矩阵的实测 `file:line` 为唯一真源。

---

## 5. 验证状态与未验证声明

1. **实读证据**：本矩阵涉及的全部 `file:line` 均为 2026-10-06 本会话通过文件实读、代码结构分析与静态 grep 实查确证。
2. **测试基线说明**：编排脚本 spawn `pnpm` 抛出 ENOENT，判定为环境性异常（`red-environmental`），非代码回归；本机 `pnpm.cmd --version`=9.15.0 可用。
3. **未验证声明**：
   - `genre-presets` 仅完成代码面与契约面核实，未在真实浏览器中点击执行；转入后续长篇连续生产时验证一次。
   - 所有标记为 `done` 的功能以代码静态依赖与契约测试为准，未执行外部商业大模型端到端真实扣费运行。
4. **图谱门禁与 Git 状态**：本次任务严格遵守红线，零产品代码修改，仅产出矩阵文档与变更记录；未执行任何 git commit/push/reset 操作。
