# CHG-20261006-03 — 11 模块唯一真源缺口矩阵复核与最新状态裁决（证据记录）

- 日期：2026-10-06；执行者：动态工作流「缺口核实员」（ZCode）
- 需求来源：动态工作流任务——建立唯一真源缺口矩阵 `docs/plans/2026-10-06-spec-gap-matrix.md`；逐项以本地当前代码（含工作区最新在制实现）核实 11 个模块真实状态（done/partial/missing/deferred），提供 file:line 证据与缺口说明；重点裁决两份旧清单四处矛盾与 9 月 23 日后新增提交；排除项记 deferred。
- **主产物：`docs/plans/2026-10-06-spec-gap-matrix.md`**（矩阵、基线、git status 原样清单、11 模块矩阵、四点裁决全在主产物）。

## 核验命令台账（2026-10-06 本会话实跑）

| 命令 | 关键输出 |
|---|---|
| `git log -1 --format="%H %ci %s"` | `40cd257000f2590df61e4922a16344c500a5aa87 2026-10-05 18:01:54 +0800 fix(lint): …` |
| `git rev-parse --short HEAD` | `40cd257` |
| `git branch --show-current` | `feature/windows-local-release` |
| `git status` | 24 项 modified / 16 项 untracked（含 review-step、editor AST 化及 compaction 草稿等用户在制产物，已完整原样记录进矩阵） |
| `pnpm test` 基线状态 | 编排脚本 spawn 报错：`WorkflowError: world.run 'pnpm' did not run to completion (spawn_error): spawn C:\Users\a1691\AppData\Roaming\npm\pnpm ENOENT`；判定 **red-environmental**（环境问题，非测试失败，主链可继续） |
| Read `NovelEditorCanvas.tsx` / `prose-ast.ts` | 引入 `@tiptap/react` 3.31.4，`useEditor` contenteditable 块级渲染，已非 `<textarea>`，带 SceneBreak 节点与 ChineseIndent 自动缩进 |
| Read `proseEditRoutes.ts` / `api.ts` / `ProseEditorPanel.tsx` / `InlineDiffViewer.tsx` | `/api/prose.edit.stream` NDJSON 契约已由 `api.ts:613` 装配，Bubble 动作已与流式编辑、InlineDiffViewer 挂载及 AST 局部替换串联 |
| Read `packages/kernel/src/compaction.ts` / grep `compactedIntoVolumeId` | 仅 schema 字段定义（`kernel-schema.ts:256`）与召回过滤（`recall.ts:395`），生产写值全仓恒赋 `null`；compaction.ts 纯函数草稿无导出无生产消费 |
| Read `flywheel` / `learner.ts` / `evaluator/run.ts` | StyleLearner 已在生产运行；AuthorPreferenceLearner 与 TaskModelEvaluator 已实现但无 Web BFF 及前端调用（`README.md:25` 声明无调用方） |
| Read `src-tauri/src/main.rs` / `tauri.conf.json` | 全文 12 行空壳，无 sidecar 启动托管与生命周期逻辑，无 externalBin 配置 |
| Read `TensionSparkWidget.tsx` / `WorkbenchHub.tsx` | 前 7 点硬编码 `[20, 38, 30, 60, 48, 75, 68]`；生产调用未传分数与描述，恒走诚实未接入分支 |
| Read `MobileComposer.tsx` / `WorkbenchHub.tsx` | 移动端三技能按钮仅追加纯文本标签；请求 `/api/draft.stream` 时 `activeSkills: []` 硬编码为空 |
| Read `VersionHistoryDrawer.tsx` | 全文 44 行，明确提示版本历史未接入，无 diff 计算与回滚交互 |
| Read `CanonGraphView.tsx` | 已有点击节点呼出 Modal 弹窗建契约落后端逻辑，无画布 drag-to-connect 手势交互 |
| Read `genrePresets.ts` / `genre-kits.ts` / `systemRoutes.ts` / `GenreKitMarketplaceView.tsx` | 8 题材预设完整，原子安全写，`/api/genre-kit.apply` 路由及前端工坊四段齐备 |
| Read `long-novel.test.ts` / `verify-real-model-journey.mjs` | 全仓无 30+ 章真实生产 E2E，`long-novel.test.ts` 为静态 JSON fixture 单元断言 |
| 排除项核实 | 书源解析器、跨章并发写作、Max 会员额度销售（`catalog.ts:97` sellable: false）、process-tree 工具（已决议移除）均核验确凿 |

## 11 模块最新状态汇总

- **done (1)**: genre-presets
- **partial (5)**: editor-ast, inline-ai, flywheel, mobile-tension, graph-connect
- **missing (5)**: compaction, tauri, mobile-skills, mobile-history, longform-e2e
- **deferred (4)**: 书源 HTML 规则解析器, 跨章并发写作, Max 会员额度销售, process-tree 外挂工具

## 验证与声明

- 诚实边界：所有状态与 file:line 均依据当前本地工作区实际代码确证，未凭旧清单断言。
- 规则遵守：零产品代码修改，仅产出矩阵文档与变更记录；未执行任何 git commit/push/reset 操作。
