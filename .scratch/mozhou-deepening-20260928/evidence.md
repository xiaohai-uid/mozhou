# 证据（2026-09-28）

全部论断经**二次 grep 回生产调用点**核实。行数为实跑计数。

## 一、被推翻的判断（我自己犯的错，记在案）

| 初稿说法 | 实测 | 结论 |
|---|---|---|
| 「评估锚点有两条链」是独立缺陷 | `openHeads` 有两道闸门（旧 web 路径从不发 `TaskStarted` ⇒ `openedAtPosition` 恒 null；新窗口 `TaskStarted` 在 `projection.ts:100` 清零） | **症状**，根因是 web 路径不开 session 窗口。`compiledAnchor.ts:19-24` 早就写明了，是我没顺着读 |
| 「`openHeads` 会让旧书永久卡住」 | 同上 | **错**。且 `proseRoutes.proposal.test.ts:351` 已钉住该不变量 |
| 「events.jsonl 需要版本化/回填」 | 全仓 `migrat|schemaVersion|ledgerVersion` 在 events.jsonl 上**零命中** | **不需要**——没有要迁的东西 |
| 「`session.advance` 不带 gate verdict」 | `advance(to, result?)` 有 result 参数；`projection.ts:110-112` 读 `payload.verdict`；`t19-rework.test.ts:161-163` 钉住通过路径 | **错**。真相是机制通了但无人驱动 |
| 「`PreWriteHashMismatchError` 落到 500」 | `chapter.ts:582` 确实抛；`proseRoutes.ts:381,424,477` **有分支**；只有 commit 的 catch 链（:731-741）没有 | **一半对**。不是全端点，是 `/api/chapter.commit` 这一个端点 |

## 二、核查方法

- 抛错类断言**不写新实验**：`chapter.test.ts:422-432` 已证明 `commitChapter` 抛 `PreWriteHashMismatchError`，
  我起草的临时实验是多余的，已删除。**已有测试能证明的事不重复造。**
- 所有「零生产调用方」的结论都是 grep **排除 `dist/`、`node_modules/`** 后计数，
  因为 `@mozhou/*` 解析到编译产物，不排除会把 32 虚报成 184。
- **walker 报的行数有错**：`pipelineRoutes.ts` 它报 862，实跑 **914**。本计划全部采用我自己测的数。

## 三、关键实测数

| 项 | 数 | 出处 |
|---|---|---|
| web 提交路径内联编排 | **254 行** | `proseRoutes.ts:490-743` |
| `proseRoutes.ts` 总长 | 746 | 实跑 |
| `pipelineRoutes.ts` 总长 | **914** | 实跑（walker 报 862，错） |
| 章节号解码内联解析器 | **16** | pipelineRoutes 9 / proseRoutes 5 / storyboardRoutes 2 |
| `assertSafeBookRoot` | **47**，跨 10 文件 | 实跑 |
| 内联错误码字面量 | **84** | route module |
| `routeCodes.ts` 现有码 | **2** | 16 行文件 |
| 「能不能生成」问句 | **21**，散在 7 文件 | 5 个近义函数 |
| `resolveChatEndpoint` 引用 | **14**，跨 5 文件 | 实跑 |
| `withPlane` 生产调用点 / 裸 `open` | 6 / **22** | 实跑 |
| 句柄守卫 | **245 行**（含 7 条自检）守 32 行 adapter | 实跑 |
| `watcher-checkpoint.ts` | 83 行，**零生产调用方** | 实跑 |
| `runFinalExtract` | **零**外部生产调用方 | route 走 `deltaExtractor.extractChapterDelta` |

## 四、门禁基线（写票时的工作区状态）

最后一次全量六门禁，**全绿**：

| 门禁 | 结果 |
|---|---|
| `pnpm build` | ✅ |
| `pnpm --filter @mozhou/web typecheck` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm graph:check` | No circular imports found. ✅ |
| `pnpm test` | 101 文件 / 868 ✅ |
| `pnpm --filter @mozhou/web test` | 98 文件 / 706 通过 + 1 跳过（707） |

**本计划尚未动任何生产代码。** 上述是起点，不是当前状态。

## 五、未覆盖 / 明确未验证

- **未跑任何真实 provider**（环境无 API key）。所有 LLM 相关结论是静态代码分析。
- **未做 Tauri 桌面构建**。
- **句柄泄漏未做压力测试**，只有源码级保证。
- **`semanticSettled.hosted.test.ts` / `providerSettings.test.ts` 在 beforeEach/afterEach 改 `process.env`**，
  跨 worker 干扰**未验证**。
- **GitNexus `impact` / `detect_changes` 从未运行过**——CLAUDE.md 要求「编辑任何符号前必须跑」，
  但索引自 2026-09-27 起陈旧，且本次是只读分析。**实施时必须补跑。**
- **`ROUTE_POLICIES` 条目数（~40）仍只是测试下界**，非实际全量。
- **缺陷 B（`PAIRING_HEAD_UNCLOSED`）未实跑复现**，静态推断。工单 02 已把「先复现、复现不出就停」写成硬要求。
- walker 的文件行数在若干处与实测不符，**只有承重结论被二次核实**，其非承重的行数未逐一校对。

## 六、工作区状态（写票时）

**他人未提交的改动，本计划一律不碰：**
- `apps/web/server/routes/storyBrainRoutes.ts`（他人 hunk 在 `:99` 与 `:105-106`）
- `apps/web/src/code-graph/codeGraphData.json`（4.2MB）
- `apps/web/src/code-graph/codeGraphSnapshot.ts`
- `apps/web/src/wizard/WizardOverlay.test.tsx`
- `scripts/export-code-graph.mjs`

工单 08 涉及 storyBrainRoutes.ts（`withPlane` 调用点）——**实施时必须按 hunk 暂存**，不得整文件 `git add`。
