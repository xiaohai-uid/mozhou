# source-map —— 本轮涉及的符号、真实行号、调用方与影响面

> 基线：`feature/windows-local-release` / `dc0f7f3ddb2ed58be326d4002c902f852778e2cc`（工作区有他人未提交改动）。
> **本轮没有修改任何产品源码**，因此此表是「结论所依据的代码位置」，不是「改动清单」。
> 行号均在本轮开工前实测（`target-file-hashes.json` 记录当时 sha256），未因本轮而变化。

## 1. 多章上下文（切片 B）的关键符号

| 符号 | 位置 | 职责 | 本轮观察到的行为 |
|---|---|---|---|
| `recentStoryText(plane, chapterIndex)` | `apps/web/server/draftContext.ts:34` | 取最近 3 章（`MAX_RECENT_CHAPTERS=3`，每章尾部截 12000 字符）的正文切片 | 第 2 章生成时取到第 1 章正文 |
| `structuralFallback(...)` | `apps/web/server/draftContext.ts:49` | 三通道召回全空时的结构层兜底包 | 本轮未触发（见 start 帧 contextMode） |
| `buildDraftContext({root, chapterIndex, authorPrompt})` | `apps/web/server/draftContext.ts:103` | Web 生成链路的**唯一**上下文入口；`storyText: recent` 在 :164/:169 同时进入召回激活查询与正文档位 | 第 2 章请求的 `storyText` 非空 |
| `assemble()` 的 `storyRendered` | `packages/context-compiler/src/assemble.ts:445` | 把 `storyText` 渲染进 `packet.text`（正文保尾，超预算丢最旧） | 第 1 章四段全部出现在最终 prompt 中 |
| `/api/draft.stream` | `apps/web/server/routes/pipelineRoutes.ts:524` | NDJSON 流；:593 调 `buildDraftContext`；:627 把 `context.packet.text` 原样放进 start 帧的 `prompt` | **本轮的上下文到达证据就取自这一帧** |

**上下文到达的判据口径**：不用「另调一次编译函数」或「token 数变多」当证据，而是断言
**这次真实请求 start 帧里的 `prompt`**（＝`makeStreamEngine` 交给 `streamOpenAiChat` 的
`modelPrompt`，见 `pipelineRoutes.ts:608` 与 `:372`）包含第 1 章夹具的 4 个稀有事实。
产物：`artifacts/context-chapter2.txt`（sha256 记在 `artifacts/phase-b.json`）、
`artifacts/context-chapter2.frames.ndjson`（原始帧）。

## 2. 取消与恢复（切片 C）的关键符号

| 符号 | 位置 | 职责 | 本轮观察到的行为 |
|---|---|---|---|
| `/api/draft.stream` 断流传播 | `pipelineRoutes.ts:603-604`（`new AbortController()` / `res.on('close', () => abortController.abort())`）、`:619`（signal 传给 `makeStreamEngine`） | 浏览器 `reader.cancel()` → TCP 复位 → `res` 的 `close` → abort | 受控替身侧记录到 `connection_closed`（`artifacts/controlled-upstream-events.json`） |
| `streamOpenAiChat(...)` 的 `externalSignal` | `apps/web/server/llm/openaiStream.ts:203,217-220` | 外部 abort → 中止到底层 `fetch` | 取消后客户端不再收到任何帧 |
| `makeDraftProviderBinding(opts)` | `packages/pipeline/src/draft-step.ts:194` | 逐 delta 只写候选；:226 `aborted()` 判定；:233-237 取消后的迟到 chunk 不落盘；:243-252 取消后写 draft 状态 partial | 取消后候选为 `partial`，正文/revision/hash 零变化 |
| `appendCandidateDelta(root,id,delta)` | `packages/pipeline/src/draft-candidate.ts:179` | 仅 `streaming` 态可追加；终态抛 `CANDIDATE_TERMINAL` | 取消后迟到 delta 抛错并被 :274-286 分支吞成 partial 而不是污染文本 |
| `finishCandidate(root,id,status)` | `draft-candidate.ts:192` | 收尾成 `ready` / `partial` / `failed` | 正常完成 → ready |
| `cancelCandidate(root,id)` | `draft-candidate.ts:201` | `streaming`/`partial` → `cancelled`；其他终态抛 `CANDIDATE_TERMINAL`（全文件唯一取消真源） | 显式 `/api/draft.cancel` 对 partial 候选 200 → cancelled；对 ready 候选会 409（本轮未制造该态） |
| `acceptDraftCandidate(root,id,rev,allowPartial)` | `draft-candidate.ts:212` | 只有 `ready`（或显式 `allowPartial` 的 `partial`）可被采纳 | 对 `partial` 候选不带 `allowPartial` ⇒ `CANDIDATE_NOT_ACCEPTABLE` 409 |
| `/api/draft.cancel` | `pipelineRoutes.ts:684` | 显式取消入口 | 本轮与其对照路径（断流自动取消）分别观察 |
| `/api/draft.accept` | `pipelineRoutes.ts:700` / `packages/pipeline/src/draft-accept.ts` | CAS(revision+sha256) + 幂等键落盘 | 同幂等键重放 `alreadyApplied=true` 且不新增版本 |
| `/api/chapter.prose.save` | `apps/web/server/routes/proseRoutes.ts:293` | 作者编辑落盘（expectedRevision 守卫） | 取消后作者可继续编辑（r1 → r2） |
| `/api/chapter.prose` | `proseRoutes.ts:265` | 章快照读取；`body` 是**盘上原文（含 YAML frontmatter）** | 本轮所有正文比对都先剥 frontmatter 再逐字比 |

**术语边界（本轮实测口径）**，三件事必须分开陈述：

1. **`/api/draft.cancel`**：只改候选状态（`draft-candidate.ts:201`），不动正文，也不保证上游已停。本轮在
   C-control 里单独观察：对 `partial` 候选返回 200/cancelled。
2. **浏览器关闭流**（`DialogueStream.tsx:135` 卸载 / `:140` 切书切章 `readerRef.current.cancel()`）：
   本轮用等价的 HTTP 流中止复现，观察到服务端 `res` close → abort。
3. **上游是否真的停止**：**只有受控替身**能证明（`connection_closed` @ 首帧后 ~8ms）。
   真实公网上游侧无观测手段，属于未验证范围。

## 3. 调用方清单（谁在用这几条路径）

| 调用方 | 是否本轮实际跑到 | 证据 |
|---|---|---|
| 作者 UI（React `DialogueStream`） | **否**（本会话无浏览器工具，见 REVIEW-ME §未验证） | 代码阅读：`DialogueStream.tsx:191` fetch `/api/draft.stream`、`:399` fetch `/api/draft.accept`、`:135/:140` `reader.cancel()` |
| **非主调用方：Node HTTP 客户端（本轮取证脚本）** | **是** | `handoff-results` 全部断言；与 UI 走同一批应用路由，不是直连数据平面 |
| 测试替身（本地受控上游 `fixtures/controlled-upstream.mjs`） | 是 | `artifacts/controlled-upstream*.json` |
| 真实模型（SenseNova `token.sensenova.cn/v1`，`deepseek-v4-flash`） | 是 | `artifacts/phase-b.json`、`artifacts/phase-c-real.json`、`calls.json` |
| 既有 vitest 回归（mock provider） | 是 | `test-logs/focused-*.log`、`test-logs/pnpm-test.log` |
| `/api/draft.cancel` 的**产品调用方** | **不存在** | 全仓 grep（`*.ts/tsx/mjs/js/md`）只有 `:684` 的定义、`routePolicies.ts:110` 的策略登记、`tenancy.test.ts:289`、`fullJourney.test.ts:144`、`draftCandidates.test.ts:240,291`、`CONTRACTS.md:60`。UI 无停止按钮 |

## 4. 影响面（本轮未改代码，故为「若要改这些符号会打到谁」）

- `buildDraftContext` 的调用方只有 `pipelineRoutes.ts:593` 一处（另有 `draftContext.test.ts`）。
- `cancelCandidate` 的调用方：`pipelineRoutes.ts:692`、`draft-step.ts:229,235`、
  `draft-candidate.test.ts`、`draft-accept.test.ts`。
- `appendCandidateDelta` 的调用方：`draft-step.ts:239` 一处。
- 本轮因此**没有**触发 `.gitnexus` impact 的必要（无编辑）；图谱 `check --cycles` 结果
  `{"status":"clean","cycleCount":0}` 见 `test-logs/graph-check.log`。
