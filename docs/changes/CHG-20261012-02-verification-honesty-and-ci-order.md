# CHG-20261012-02 — 验收判定的诚实性与发布 CI 顺序

- 日期：2026-10-12；执行：ZCode（AI 辅助）。
- 需求来源：本机只读调查报告《墨舟验收体系》给出的三条源码级发现（P0 假 PASS、P1 发布 CI 顺序、P1 本地证据身份）。三条均先对着源码复核成立，再修。
- 基线：feature/windows-local-release，HEAD 8907eac01c267e96a60025f2bf0e35a98580ef9c，工作区有未提交改动。未提交、未合并、未推送。
- 范围：仅验收脚本与发布 workflow；未改任何 `apps/`、`packages/` 应用代码，未新增依赖，未放宽任何门。

## 一、P0：长篇验收脚本会在断言未通过时判 PASS

- 复核结论成立，且比报告描述更严重。`scripts/verify-longform-e2e.mjs` 的 `restartOk` 只比书 id 与首末章正文字数，不能证明中间章节未漂移；`summary.json` 的 `status` 与台账的「状态: PASS」均为写死，`compactionVerified` / `genrePresetVerified` 只作布尔字段记录、不进入通过条件。
- **已落盘的历史证据自身即证明**：`evidence/longform-journey/2026-10-06T13-41-19-856Z/summary.json` 与 `…T13-46-12-725Z/summary.json` 均为 `status: "PASS"` 而 `compactionVerified: false`。按新判定这两次应为 FAIL。
- 修改：
  - 新增 `chapterCorpusDigest()`：逐章取 (章号, 相位, 版本, 正文 SHA-256) 拼成语料哈希；重启前后逐章比对，任一章漂移或缺失即不一致。
  - 判定改为派生：`restartOk && compactionVerified && genrePresetVerified` 三者全真才 `PASS`，否则 `FAIL` 并 `process.exitCode = 1`。
  - 台账与 summary 不再写死结论：重启/压缩/题材三段按实际结果条件化输出；新增 `mismatchedChapters`、`verdictFailures` 字段。

## 二、P1：发布 CI 的测试与构建顺序错位且重复

- 复核结论成立。`.github/workflows/release.yml` 原为「`pnpm test`（含 web 测试）→ typecheck → web 测试（重复一次）→ 构建 web」，即 web 测试全部早于 web 构建；`ci.yml` 的顺序是先构建 `apps/web` 再跑 web 测试（部分用例依赖 `dist-server` 产物）。
- 修改：`pnpm test` 改为 `pnpm run test:packages`，并把 web 测试移到「Build web and production server」之后，与 `ci.yml` 顺序一致；web 测试不再重复执行。真实模型门仍在 web 构建之后，位置未变。

## 三、P1：本地验收证据用短 HEAD 标识未提交源码

- 复核结论成立。多个验收脚本以 `git rev-parse --short HEAD` 作 `sourceCommit`，脏工作区下会把「跑的是未提交源码」记成干净提交；仓内既有 `scripts/release/lib/source-stamp.mjs` 已实现 `-dirty` 语义，但未在这些脚本使用。
- 修改（复用既有 source-stamp，不新造格式）：
  - `scripts/release/real-model-gate.mjs`、`scripts/verify-longform-e2e.mjs`：改为 `...sourceStampFields()`，证据含完整 `sourceCommitSha`、`dirty`、`dirtyFiles`。
  - `scripts/verify-real-model-journey.mjs`、`scripts/verify-real-novel-journey.mjs`、`scripts/verify-mock-journey.mjs`、`scripts/verify-batch-novel-pipeline-stress.mjs`：`sourceCommit` 改为 dirty-aware 值（完整 SHA + `-dirty` 后缀）。
  - 全仓 `scripts/` 已无 `rev-parse --short HEAD` 残留。

## 四、验证（本轮实际执行）

- 已实跑并留下可复现结果：
  - `node scripts/verify-longform-e2e.mjs`（缺凭据）→ 退出 1，模块图加载正常；以不可达端点跑 BLOCKED 路径 → 退出 2，`summary.json` 含 `sourceCommit: 8907eac…-dirty`、`dirtyFiles: 34`。
  - `node scripts/release/real-model-gate.mjs`（缺凭据）→ 退出 2，`result.json` 含 `sourceCommitSha` / `dirty: true` / `dirtyFiles: 34`。
  - `node scripts/verify-mock-journey.mjs` → 端到端 `VERIFIED`、退出 0，证据戳为 `8907eac…-dirty`（真实旅程跑通，来源戳改动无回归）。
  - 摘要函数在真实完整 31 章书上验证：`chaptersPresent: 31`、两次运行语料哈希一致（确定性）；同一函数对只有 2 章的残留书根报 `31:MISSING`（缺失即判不一致）。
  - `node --check` + `eslint` 覆盖全部改动脚本，无问题；`pnpm lint` 退出 0；`doc-gates` / `graph-check`（clean, 0 环）/ `import-cycles`（605 模块 / 0 环）/ `duplication` 全部退出 0；`release.yml` 经 YAML 解析通过。
- 未验证（如实标注）：
  - longform 的 PASS 路径与 FAIL 分支**未端到端实跑**（需真实模型凭据，本机 BLOCKED）；新判定逻辑以源码、lint、语法与摘要函数实测为据，未以真实 31 章全流程证明。
  - `release.yml` 的改动**未在 GitHub Actions 或 `act` 上执行**（本机无 Docker/托管 CI 运行），仅静态校验 YAML 与顺序推理。
  - 测试套件未重跑：本轮未改应用/包代码，且这些脚本无测试耦合（已核对无测试引用），沿用上一轮 122/1089 与 160/1338 的有效结果。

## 五、剩余缺口（本轮未做，需用户决定）

- 报告的试验 A/B/C（Playwright 真实浏览器验收、Promptfoo 规则评估集、发布门故障注入）未启动：前两者需新增依赖与可能的模型费用，属新增范围，未擅自引入。
- 长期缺口不变：签名、独立 Windows 安装验收、真实模型发布门凭据。
