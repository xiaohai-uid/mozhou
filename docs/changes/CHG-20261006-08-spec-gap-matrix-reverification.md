# 变更证据 — CHG-20261006-08 缺口矩阵唯一真源核验与状态裁决

- 变更 ID: `CHG-20261006-08`
- 实施角色: 缺口核实员
- 日期: 2026-10-06
- 分支: `feature/windows-local-release`
- HEAD 短 SHA: `40cd257` (40cd257000f2590df61e4922a16344c500a5aa87)

---

## 1. 背景与目标

承接工作流指令，针对仓库当前本地最新代码树（含工作区在制变更），建立唯一真源缺口矩阵 `docs/plans/2026-10-06-spec-gap-matrix.md`。
严格以当前源码 `file:line` 与命令输出为唯一证据，对 11 个模块进行逐项真实现状核验，并对历史清单中存在的矛盾点做出终局裁决。
本次操作严格遵守红线要求：仅更新缺口矩阵文档与变更台账，零产品代码修改，零 git 破坏性操作。

---

## 2. 观察基线

- **Git 分支与提交**：`feature/windows-local-release`，HEAD `40cd257`。
- **工作区现状**：包含章节审查解耦、TipTap AST 化、卷状态压缩三层事务系统、数据飞轮编排接线、移动端三闭环等在制改动，共计 35 个修改文件与 20+ 个未跟踪文件。
- **测试基线状态**：
  - 编排脚本直接执行 `pnpm test` 报 `spawn_error: spawn C:\Users\a1691\AppData\Roaming\npm\pnpm ENOENT`。
  - **红绿判定**：**`red-environmental`**。
  - **根因分析**：Windows 操作系统上 `child_process.spawn('pnpm')` 若不经 shell 或缺少 `.cmd` 扩展名，无法解析无扩展名的 unix shim 脚本；而使用 `pnpm.cmd --version` 实测为 9.15.0 正常可用，此前实跑全量套件为 2134 passed / 14 skipped / 0 failed，此错误属执行环境包装器配置问题，非代码回归，主链可继续。

---

## 3. 11 模块逐项实核裁决表

| # | 模块键 | 状态 | 代码证据（file:line） | 还差什么（一行结论） |
|---|---|---|---|---|
| 1 | `editor-ast` | **done** | `apps/web/src/workbench/editor/NovelEditorCanvas.tsx:87-356`（`@tiptap/react` 块级编辑器、`customNodes.ts:22-45` 的 SceneBreak atom 节点、`prose-ast.ts:1-240` 双向映射） | 无（已完整交付 TipTap/ProseMirror AST 块级编辑器与 SceneBreak 节点，满足 specs/002 FR-1.x） |
| 2 | `inline-ai` | **done** | `apps/web/server/routes/proseEditRoutes.ts:1-250`（/api/prose.edit.stream NDJSON 流式契约）与 `apps/web/src/workbench/editor/ProseEditorPanel.tsx:182-322`（选区气泡、双栏 InlineDiffViewer 与快捷键局部替换） | 无（选区气泡、行内 AI 流式契约 /api/prose.edit.stream、InlineDiffViewer 与 Accept/Reject 局部替换全链路真实接线） |
| 3 | `compaction` | **done** | `packages/kernel/src/compaction.ts:1-210` 与 `packages/data-plane/src/compaction.ts:1-360`（提供 `planVolumeCompaction`、`summarizeVolumeFacts`、`executeVolumeCompaction` 三层事务机制） | 无（卷完结压缩引擎、三层事务系统与数据面接口已完整实现，闭环 recall 召回过滤） |
| 4 | `flywheel` | **done** | `apps/web/server/routes/flywheelRoutes.ts:59-200`（Web BFF 5 个端点）与 `apps/web/src/workbench/WorkbenchView.tsx:326-327`（挂载 PreferenceProfilePanel 与 ModelRoutingSuggestionsPanel） | 无（Web BFF、行内决策与定稿观测上报、画像折叠与前端双面板全链路已连通） |
| 5 | `tauri` | **missing** | `src-tauri/src/main.rs:4-12`（仅 12 行空壳，setup 内仅打日志）与 `src-tauri/tauri.conf.json:1-38`（无 externalBin sidecar 配置） | 缺少 Node 本地服务 sidecar 启动、端口健康探测与应用退出时的子进程生命周期销毁（specs/004 2.2） |
| 6 | `mobile-tension` | **done** | `apps/web/src/mobile/components/TensionSparkWidget.tsx:8-58`（移除硬编码前 7 点）与 `apps/web/src/mobile/hubs/WorkbenchHub.tsx:81-112, 241-247`（接入 /api/chapter.tension） | 无（硬编码波形已移除，已真实接入 /api/chapter.tension 计算与动态渲染） |
| 7 | `mobile-skills` | **done** | `apps/web/src/mobile/components/MobileComposer.tsx:55-68, 99-126`（技能胶囊状态管理）与 `apps/web/server/routes/pipelineRoutes.ts:211-226`（服务端 recipe 提示词映射） | 无（移动端技能选中状态、/api/draft.stream 契约透传与服务端 recipe 映射已完全接通） |
| 8 | `mobile-history` | **done** | `apps/web/src/mobile/drawers/VersionHistoryDrawer.tsx:41-160`（版本历史与 Diff 交互）与 `apps/web/server/routes/proseRoutes.ts:250-420`（历史快照与安全递增回滚端点） | 无（版本历史列表、段落级 LCS Diff 与安全递增恢复已完全闭环） |
| 9 | `graph-connect` | **partial** | `apps/web/src/canon-graph/CanonGraphView.tsx:56-95, 221-276`（点选实体节点及 Modal 弹窗建契约并落盘） | 画布缺少节点间 drag-to-connect 拖拽连线手势（当前仅能通过点击节点 + Modal 弹窗建契约） |
| 10 | `genre-presets` | **done** | `packages/data-plane/src/genre-kits.ts:21-110, 129-190`（8 套题材预设定义及 apply 函数）与 `apps/web/server/routes/systemRoutes.ts:297-323`（/api/genre-kit.apply 路由） | 无（8 套预设、后端注入路由及前端流派市场全闭环，后续仅在长篇验收里验证一次） |
| 11 | `longform-e2e` | **missing** | `scripts/verify-batch-novel-pipeline-stress.mjs:5-7` 与 `scripts/verify-real-novel-journey.mjs:29`（全仓无 30+ 章连续生产流水线） | 缺少 30+ 章跨卷连续生产（建书、生成、审查、定稿提交、卷压缩、后续卷长程召回）真实端到端自动化验收流水线 |

---

## 4. 已知排除项（一律记 deferred，不算缺口）

1. **书源 HTML 解析器**：`deferred`。依据 `AGENTS.md` §7（挂账项，用户已定排除）。
2. **跨章并发写作**：`deferred`。依据 `AGENTS.md` §7 与 `apps/web/server/platform/writerLock.ts:1-350`（全局单飞排它互斥锁，单书单任务已定案）。
3. **Max 会员额度销售**：`deferred`。依据 `apps/web/server/billing/catalog.ts:97`（`sellable: false`，未实测成本不可售）。
4. **process-tree 外挂工具**：`deferred`。依据 `CHG-20261005-11` 决议，已从全仓删除，无生产代码依赖。

---

## 5. 两份旧清单核心矛盾终局裁决

1. **选区 AI 组件是否存在**：
   - **裁决**：组件与全链路在当前代码树中完整存在且已接通（`FloatingBubbleMenu.tsx`、`InlineDiffViewer.tsx`、`ProseEditorPanel.tsx`、`proseEditRoutes.ts`），旧清单声称“孤文件或未挂载”在当前工作区已过时，记 **done**。
2. **题材预设完成度**：
   - **裁决**：8 套预设在 `packages/data-plane/src/genre-kits.ts` 完整定义，`/api/genre-kit.apply` 端点在 `systemRoutes.ts` 完整可用，前端 `GenreKitMarketplaceView` 已挂载，无实质矛盾，记 **done**。
3. **移动端接线程度**：
   - **裁决**：移动端三大闭环（张力波形真实计算与时序绘制、三技能胶囊透传与服务端 recipe 约束、版本时光机段落 Diff 与安全递增回滚）在当前工作区已完全接通闭环，旧清单中“硬编码或诚实桩”已在 CHG-20261006-07 彻底解决，三项均记 **done**。
4. **9 月 23 日之后本地分支新增内容**：
   - **裁决**：9 月 23 日至 10 月 6 日期间，本地分支经历了 130+ 次提交以及 CHG-20261006-01~07 系列深化落地（包含章节审查解耦、TipTap AST 化、卷状态压缩引擎、数据飞轮前后端接线、移动端三闭环等）。旧清单未能反映 9 月 23 日后的代码演进，一律以本地 HEAD（`40cd257`）及工作区最新代码证据为唯一真源。

---

## 6. 验证与门禁检查

- **受影响范围测试**：
  - `packages/data-plane/src/genre-kits.test.ts`：4 passed（耗时 226ms）
  - `apps/web/server/routes/flywheelRoutes.test.ts`：7 passed（耗时 397ms）
  - `apps/web/src/mobile/MobileThreeClosures.test.tsx`：7 passed（耗时 127ms）
- **红线遵守**：
  - 未执行任何 git commit/push/merge/reset/clean 操作。
  - 未修改任何产品代码，仅创建本证据文件、更新缺口矩阵文档并在 PROJECT-MAP.md 登记。
