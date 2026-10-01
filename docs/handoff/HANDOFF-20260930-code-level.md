---
date: 2026-09-30
description: '墨舟（MoZhou Novel OS）代码级交接文档 · 供外部 AI 审核 · 历史基线 + 2026-09-30 整改'
tags:
  - mozhou
  - handoff
  - audit
---

# 墨舟（MoZhou Novel OS）交接文档 · 审核版

> **这份文档的用途**：把「读代码就能得到、但读起来费 token」的结论预先落到
> `文件:行号`，让审核 AI 把预算只花在**判断**上，不花在**搜集**上。
>
> **阅读顺序建议**：§1 三分钟定位 → §2 验证基线（**先读 2.0 的可信度规则**）→ §3 图谱事实 →
> §4 架构地图 → §5 风险台账（需要你判断的部分）→ §6 明确未验证的维度。
>
> **本文档的写法约定**：凡是结论都带 `文件:行号`；凡是实跑过的命令都写进 §2，并标明
> 运行时间、HEAD、dirty 指纹与日志路径；凡是我没验证的，写「未验证」而不猜。

---

## 0. 审核者请注意的四件事

1. **仓库有三个同名兄弟**（GitNexus 图谱都叫 mozhou）。本文档对应的是
   `C:\zcode\novel-ai`。用 GitNexus MCP 查询时传绝对路径，否则会命中
   `C:\Users\a1691\Documents\antigravity\happy-newton` 或 `C:\zcode\novel-ai-closure`
   的旧索引。
2. **.gitnexus/ 不在 git 里**（被 `.git/info/exclude` 排除）。入库的图谱产物是
   `apps/web/src/code-graph/codeGraphSnapshot.ts` + `codeGraphData.json`，二者由
   `pnpm graph:snapshot` 从本机索引生成。**读 git diff 时不要以为这两个文件是手写的。**
3. **工作树有未提交改动**（见 §1 表格与 §2.4）。其中 `AGENTS.md` / `CLAUDE.md` 与两份图谱产物
   是**刷新图谱的正常副作用**；`docs/handoff/HANDOFF-20260930-code-level.md`（本文档）
   与 T02/T03/T05 的代码改动是**本轮整改的增量**。两类改动性质不同，请分开评估。
4. **本文档自身经历过一次整改**（2026-09-30）。上一版把「本机实跑结果」写成了
   「可直接采信、不必重跑」，并宣称跑完了「CI 的全部 5 道门禁」。这两条都是错的，
   原因见 §2.0。**§2.1 的历史结论一律按「待核对的历史证据」对待。**

---

## 1. 一句话定位与当前坐标

**墨舟 = 本地优先（local-first）的长篇小说 AI 辅助创作操作系统。** 卖点不是「能生成文字」，
而是**生成过程是一个可审计、可回滚、有确定性因果契约的工业状态机**。

| 项 | 值 | 出处 |
|---|---|---|
| 包名 / 版本 | mozhou 0.3.0（private） | `package.json:2-4` |
| 版本定位 | 技术预览版 / 社区免费，**付费通道未开放** | `README.md:9-12` |
| Node / 包管理 | >=22，pnpm@9.15.0 | `package.json:6-9` |
| 工作区 | packages/* + apps/* | `pnpm-workspace.yaml:1-3` |
| 当前分支 | feature/windows-local-release | `git rev-parse --abbrev-ref HEAD` |
| HEAD | dc0f7f3ddb2ed58be326d4002c902f852778e2cc（全 40 位，本轮实测） | `git rev-parse HEAD` |
| 工作树 | 5 项未提交（2 自动块 + 2 图谱产物 + 1 未跟踪文档） | `git status --porcelain=v1` |
| 远端 | https://github.com/xiaohai-uid/mozhou | `.gitnexus/meta.json` 的 remoteUrl |
| 主线形态 | apps/web（Vite + React + TipTap AST + Tailwind）+ packages/*（8 个库）+ src-tauri（桌面壳） | `README.md:120-136` |
| 已删除的遗留面 | app/（旧 Next.js 应用，750 个跟踪文件）已于 2026-09-20 移出仓库 | `CONTEXT.md:284-286` |

**主线与遗留面不要再混淆**：旧文档 `docs/handoff/HANDOFF-20260917.md` 仍把 apps/web
描述为 Next.js、把门禁说成 11 项、列出 app/ 目录——**这三处均已过时**。
那份文档整体建议只当历史档案读（本轮**不**批量改写它，见 R6）。

---

## 2. 验证基线

### 2.0 先读这一节：历史结果为什么不能直接采信

上一版本文档写了三条**没有证据支撑**的断言，本轮逐条纠正：

| 上一版原文 | 问题 | 现状 |
|---|---|---|
| 「§2 已验证基线（请直接采信，不必重跑）」 | 把「某台机器某时刻跑过」当成「结论永久有效」。命令、依赖、环境变量、HEAD、dirty 任一变化都可能使结论失效 | 已删除。改为：**只有在 HEAD、dirty 清单、配置与命令都相同且能定位到原始日志时**才可复用；否则必须重跑受影响检查 |
| 「我跑完了 CI 的全部 5 道门禁」 | `.github/workflows/ci.yml` 里是 8 个步骤（含 pnpm audit --audit-level high 与 Web build），不是 5 道；且上一轮报告**没有覆盖依赖审计与 Web 构建**这两项 | 已改为如实陈述：上轮报告覆盖的是 build / lint / 包层测试 / Web typecheck / Web 测试，**依赖审计与 Web 构建未覆盖** |
| 「9-27 审查报告有三处已被本轮推翻」 | 只给了结论，没给「哪三处、凭什么」。本机跑通真实模型**不能**推翻「托管 CI 从未执行真实模型」这个结论——两者是不同的事实 | 已删除该汇总。改为区分**本机真实模型成功**与**托管 CI 行为**两件事，见 R1 |

> **审核提示**：如果你只从本文档拿一件事，请拿这一件——
> **「测试全绿」在整改前不能证明真实模型链路被验证过**。原因与修复见 R1。

### 2.1 历史基线（上一轮执行端报告，**待核对**）

下表是上一版文档 §2 的内容。**逐行标注了来源日志的定位结果**：
本轮在 `.dsh-audit/`、`evidence/`、`artifacts/` 下检索过，**没有找到**这些结果对应的原始日志，
因此一律标注为「执行端报告，原始日志未定位，未独立复现」。

共同上下文（据上一版文档自述）：HEAD dc0f7f3，dirty = 4 个图谱产物文件，
运行日期 2026-09-30（无更精确时间戳可考）。

| 门禁 | 命令 | 上轮报告结果 | 来源日志 | 本轮定位结论 |
|---|---|---|---|---|
| 工作区类型构建 | pnpm build | exit 0，0 错误 | 未定位 | 执行端报告，原始日志未定位，未独立复现 |
| Web 类型检查 | pnpm --filter @mozhou/web typecheck | exit 0 | 未定位 | 同上 |
| 静态检查 | pnpm lint | exit 0，无输出 | 未定位 | 同上 |
| 包层测试 | pnpm test（当时根 vitest run） | 102 文件 / 891 用例全过，12.9s | 未定位 | 同上（但**本轮复现出完全相同的 102 文件 / 891 用例**，见 §2.2 交叉核对） |
| Web 层测试 | pnpm --filter @mozhou/web test | 115 文件 / 854 过 + 1 skipped，36.3s | 未定位 | 同上（本轮为 855 过 + 14 skipped，差额已逐项解释，见 §2.2） |
| 图谱环检查 | npx gitnexus check --cycles --repo mozhou | 「No circular imports found.」 | 未定位 | 同上；且该结论的**可证明范围**见 §3.2 |
| 图谱索引新鲜度 | node .gitnexus/run.cjs status | up-to-date（索引 commit = HEAD） | 未定位 | 同上 |
| 真实模型端到端 | 见上轮 §2.1 | 「实际执行，未跳过」 | 未定位 | 同上；**且该路径本轮已证伪为不可复现**，见 R1 |

**关于「CI 全部 5 道门禁」的准确口径**：`.github/workflows/ci.yml:29-49` 的实际步骤是
安装依赖 → pnpm audit --audit-level high（`ci.yml:31-32`）→ pnpm build（`33-34`）→
pnpm lint（`37-38`）→ 包层测试（`39-43`）→ Web typecheck（`44-45`）→ Web 测试（`46-47`）→
Web build（`48-49`）。**依赖审计与 Web 构建这两项，上一轮报告没有覆盖。**

### 2.2 本轮（2026-09-30 整改后）实测结果

**本节结果全部由本轮真实运行产生。** 运行上下文：
HEAD dc0f7f3ddb2ed58be326d4002c902f852778e2cc，Node v24.18.0，pnpm 9.15.0，pwsh 7.6.4，
运行时刻 2026-09-30 13:42-13:43（+08:00）。
**七项检查在同一个 dirty 路径集合下完成**（dirty 路径指纹 SHA256 =
2A795872E3F19499D8E37465B11E49DD910CBE747272DDC2905FC0C240F37B63，18 条路径），
说明结果来自同一棵冻结的工作树。

> **该指纹的确切含义（勿过度解读）**：它是对 `git status --porcelain` 输出的**路径列表**取哈希，
> **不包含文件内容**。内容级锚定请用最终树的逐文件 SHA256 清单：
> `.dsh-audit/repair-20260930/T07/final-tree-sha256.txt`（18 个文件逐条 SHA256 + 字节数）。
> 整改前那 5 个文件的**整改前**内容锚定在 `.dsh-audit/repair-20260930/00-preflight/sha256-manifest.txt`。
>
> 逐项结果（命令/起止时间/退出码/日志路径）见 `.dsh-audit/repair-20260930/T07/t07-results.json`。

| 检查 | 命令 | 退出码 | 耗时 | 结论 |
|---|---|---|---|---|
| 工作区类型构建 | pnpm build | 0 | 1s | **passed** |
| 静态检查 | pnpm lint | 0 | 28s | **passed**（首次失败原因见下） |
| 全量测试（根入口） | pnpm test | 0 | 26s | **passed** |
| Web 类型检查 | pnpm --filter @mozhou/web typecheck | 0 | 5s | **passed** |
| Web 构建 | pnpm --filter @mozhou/web build | 0 | 7s | **passed**（需可写 TEMP，见下） |
| 依赖审计 | pnpm audit --audit-level high | 1 | 0s | **blocked（外部原因）** |
| 图谱环检查 | pnpm run graph:check | 0 | 3s | **passed**（当轮为工具文字；S01 后改为结构化字段，见 §2.6） |

**pnpm test 的两层明细**（这是本轮 T03 修复后的关键证据）：

| 层 | 结果 |
|---|---|
| 包层（test:packages） | **102 文件通过 / 891 用例通过** |
| Web 层（test:web） | 115 文件通过 + 1 文件跳过；**855 用例通过 / 14 用例跳过** |

**与历史基线的交叉核对（重要）**：

- 包层 **102 文件 / 891 用例**与上一轮报告**完全一致**——即使上轮日志未定位，这一项在本轮独立复现。
- Web 层从「854 通过 + 1 跳过」变为「855 通过 + 14 跳过」，差额**逐项可解释**：
  - 本轮新增门控测试 `apps/web/server/test-support/realModelGate.test.ts` **+14 个用例**；
  - 整改前三份真实模型测试用「提前 return」伪装通过，整改后变成 `it.skipIf` 的 **skipped**：
    namingRoutes 2 + firstChapter 2 + featureSweep 9 = **13 个**；
  - 855 = 854 + 14 − 13 ✓，14 skipped = 1（原有 storyboard 冒烟）+ 13 ✓。
  **即：整改把 13 个「假装跑过的绿」变成了「显式声明的跳过」。**

**两处首次失败及其处置（如实记录，不掩盖）**：

1. **lint 首次 exit 1**：我新增的 `apps/web/server/test-support/` 目录未被 eslint 的
   projectService 登记，报 `Parsing error … was not found by the project service`。
   这正是该配置**自身注释**（`eslint.config.js:12-14`：「allowDefaultProject 不支持递归 glob，
   新 server 测试目录需在此补一行」）预告的情形。已按同一口径补登记
   （`eslint.config.js:36-40`），复跑 **exit 0**。
2. **web build 首次 exit 1**：`[vite:esbuild-transpile] remove %TEMP%\esbuild-…: Access is denied`
   ——esbuild 在系统 TEMP 清理临时文件被拒。**与代码无关**。判别实验：把 `TEMP`/`TMP`
   指向工作区内可写目录后，**同一条命令 exit 0 并正常产出**（日志
   `.dsh-audit/repair-20260930/T07/web-build-isolated-temp.log`）。批次随后统一使用可写 TEMP。
   **这是本机环境缺陷，不是产品缺陷**；在 CI（ubuntu-24.04）上不适用。

**依赖审计为何是 blocked 而不是 failed**：`pnpm audit` 返回
`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS` —— 本机 registry 指向 `registry.npmmirror.com`，
该镜像**不实现** audit 端点（日志 `audit.log`）。这是**外部服务能力缺失**，不是依赖存在漏洞。
按计划要求「依赖审计外部失败单列 blocked，不绕过」，本轮**不修改 registry 配置、不跳过该项**。
**因此「依赖漏洞门禁是否通过」在本轮仍是未验证项**（见 §6.11）——
不过 R03 已改用官方 registry 单次执行并取得真实结果（见 §2.5 R03）。

### 2.3 日志索引（本轮）

| 用途 | 日志路径 |
|---|---|
| 整改前状态快照（5 文件副本 + SHA256 + git diff） | `.dsh-audit/repair-20260930/00-preflight/` |
| T02 门控验收：未启用+凭据存在 ⇒ skipped 且零上游 | `.dsh-audit/repair-20260930/T02-acceptance/A1-not-enabled.log` |
| T02 门控验收：启用+缺配置 ⇒ 非零 | `.dsh-audit/repair-20260930/T02-acceptance/A2-enabled-missing-config.log` |
| T02 门控验收：启用+上游不可达 ⇒ 非零 | `.dsh-audit/repair-20260930/T02-acceptance/A3-unreachable.log` |
| T02 门控验收：受控观察服务（请求数+失败传播） | `.dsh-audit/repair-20260930/T02-acceptance/A4-observation.log` |
| T02 门控验收：两进程并行隔离 | `.dsh-audit/repair-20260930/T02-acceptance/A5-proc1.log` / `A5-proc2.log` |
| T02 门控验收：test:real-model 无配置时拒绝启动 | `.dsh-audit/repair-20260930/T02-acceptance/A6a-real-model-no-config.log` |
| T05 图谱导出：包装器路径 + APPDATA 隔离 + 缺包装器失败 | `.dsh-audit/repair-20260930/T05-graph/` |
| T07 全量验证批次（7 项 + 结果 JSON） | `.dsh-audit/repair-20260930/T07/` |
| R01 argv 判别实验（Windows + WSL 双平台） | `.dsh-audit/repair-20260930/R01-argv/probe-windows.log` / `probe-posix.log` |
| R01 POSIX 真实包装器端到端（3/3 仓库） | `.dsh-audit/repair-20260930/R01-argv/wrapper-e2e-posix.log` |
| R01 POSIX 完整导出（blocked 证据） | `.dsh-audit/repair-20260930/R01-argv/export-posix-real.log` |
| R01 缺包装器引导（非循环） | `.dsh-audit/repair-20260930/R01-argv/missing-wrapper-r01.log` |
| R02 重建索引 / 重新导出 / 绝对路径检查 | `.dsh-audit/repair-20260930/R02-reindex/` |
| R03 官方 registry 审计 | `.dsh-audit/repair-20260930/R03-audit/audit-official.log` |

### 2.4 本轮改动的归属（不要把两类改动混为一谈）

| 文件 | 归属 | 说明 |
|---|---|---|
| AGENTS.md、CLAUDE.md | **非本轮** | GitNexus 自动维护的 gitnexus:start 数字块 |
| apps/web/src/code-graph/codeGraphSnapshot.ts、codeGraphData.json | **非本轮创作，本轮重新生成过** | 图谱产物；本轮因 T05 修复后重跑 pnpm graph:snapshot 而重新生成，内容集合与整改前**完全一致**（见 §3.1 注） |
| docs/handoff/HANDOFF-20260930-code-level.md | **本轮** | 本文档（T01/T04/T06） |
| T02/T03/T05 涉及的代码与配置 | **本轮** | 见 §5 R1/R2/R6 的修复说明 |

### 2.5 整改后续 R01–R03（2026-09-30 第二轮，独立复核驱动）

独立复核（`independent-review-followup.json`，verdict = `PARTIAL_ACCEPTANCE`）提出三项：
R01 POSIX 查询引号、R02 重建索引、R03 官方 registry 依赖审计。逐项结果如下。

#### R01 · POSIX 查询引号处理 —— 已修复并双平台实测

复核指出的缺陷**成立**：`.gitnexus/run.cjs:313` 是 `shell: process.platform === 'win32'`，
即 **Windows 经 cmd.exe、POSIX 直接透传 argv**。而整改第一版在**所有平台**都给查询加了双引号，
POSIX 上这对引号会**原样进入 Cypher 查询**。

判别实验（`.dsh-audit/repair-20260930/R01-argv/probe.mjs`，忠实复刻 run.cjs 的 shell 语义，
接收端是一个只回显 argv 的 stub）：

| 平台 | 旧策略（一律加引号） | 新策略（Windows 仅对含空白实参加引号） |
|---|---|---|
| Windows（win32, viaShell=true） | 查询 OK，但 **-r 的含空格路径被切成两段** | 两种情形均**逐字符相等** |
| Linux（WSL Ubuntu, viaShell=false） | **查询被塞进字面双引号**（实测收到 "MATCH (c:Community) … DESC"，引号是内容的一部分） | 两种情形均**逐字符相等** |

日志：`R01-argv/probe-windows.log` / `R01-argv/probe-posix.log`。

修复（`scripts/export-code-graph.mjs`）：

- 新增 `isWindows` 与 `shellArg()`：**仅 Windows** 且实参含空白时加引号；POSIX 原样透传。
- 对 **-r 的仓库路径**与查询**分别**处理——`-r` 同样会被二次切分。
- 删除「POSIX 下 sh 同样会剥掉这对引号」的错误注释。
- **未编辑被忽略的生成包装器**（`.gitnexus/run.cjs`），因此重建索引不会丢补丁。
- 缺包装器的引导命令改为**非循环**：原文让人跑 `pnpm run graph:analyze`，而该脚本本身就是
  `node .gitnexus/run.cjs analyze`，依赖的正是缺失的那个文件。现改为先用分析器 CLI 直接生成
  （`npx gitnexus@latest analyze` / `pnpm dlx gitnexus@latest analyze`），依据是
  `.gitnexus/run.cjs:23-26` 自述「该文件由 gitnexus analyze 写入」。

| 验收项 | 结果 |
|---|---|
| Windows 现有环境导出 | **exit 0**（17s），8133 nodes / 16017 relations |
| POSIX argv 与查询逐字符相等 | **passed**（`probe-posix.log`：旧策略 MANGLED、新策略 exact） |
| POSIX 真实包装器端到端 | **passed**：真实 wrapper + 真实 CLI + 含空格查询，3/3 目标仓库 **exit 0** 且返回 `{"markdown":…,"row_count":5}`（`wrapper-e2e-posix.log`） |
| POSIX 完整导出 | **blocked**：WSL 侧 gitnexus 未登记本仓库（`Repository "/mnt/c/zcode/novel-ai" not found`，可用列表里没有本仓库）。**不是代码缺陷**，是「本仓库在 WSL 侧没有索引」这一环境事实 |
| 失败不改旧产物 | **passed**：POSIX 导出失败后两份产物 SHA256 不变 |
| 缺包装器 | **exit 1**，引导命令可执行、非循环，产物 SHA256 不变 |

> **不得据此声明「跨平台已通过」**：POSIX 上被证明的是**引号语义与包装器契约**，
> 不是「本仓库在 POSIX 上能完整导出」。后者仍是 **blocked**。

#### R02 · 重建包含本轮修改的图谱 —— 已完成

前置：`gitnexus` 进程数 0（无并发索引写者）；已保存 dirty 内容指纹与产物哈希。

1. **重建**：`node .gitnexus/run.cjs analyze` → **exit 0**（85s），
   增量 `changed=11, added=4, deleted=0`，结果 `8,926 nodes | 20,129 edges | 626 clusters | 497 flows`。
2. **重新导出**：`pnpm run graph:snapshot` → **exit 0**，8133 nodes / 16017 relations / 4112 out-of-scope。
3. **检查（绝对仓库路径，避开 `--repo mozhou` 歧义）**：
   `node .gitnexus/run.cjs check --cycles --json -r C:\zcode\novel-ai`
   → **exit 0**，返回结构化字段 `{"status":"clean","cycleCount":0,"cycles":[]}`。
   **这次拿到的是工具的真实字段，不再是「No circular imports」那句文字。**
4. **索引核对**：`meta.indexedAt = 2026-09-30T05:58:41.157Z`，`files=815`，`fileHashes=815`；
   本轮新增的 `realModelGate.ts` / `realModelGate.test.ts` / `run-real-model-tests.mjs` /
   `export-code-graph.mjs` 全部 **PRESENT**。
5. **产物来源**：两份产物同源于该索引（`indexedAt` 一致、`commit=dc0f7f3`），
   `worktreeDirty: true` ⇒ **这是含未提交改动的快照，不是纯 HEAD 快照**。
6. **受影响检查重跑**：build / lint / test / web typecheck / web build 全部 **exit 0**；
   依赖快照的 `CodeGraphView.test.tsx`、`CodeNodeExplorer.test.tsx` 通过；
   测试计数不变（包层 102 文件 / 891 用例；Web 层 855 通过 + 14 跳过）。

**本轮新发现：`pnpm run graph:check` 的 `--repo mozhou` 存在真实歧义**
（**已于 §2.6 S01 修复**，此处保留原始证据）。
不加 `-r` 时工具直接报错并列出**三个**名为 mozhou 的仓库：

```
Multiple repositories indexed. Specify which one with the "repo" parameter.
Available: …, mozhou (C:\Users\a1691\Documents\antigravity\happy-newton), …,
mozhou (C:\zcode\novel-ai), mozhou (C:\zcode\novel-ai-closure), …
```

即仓库自带门禁 `gitnexus check --cycles --repo mozhou`（`package.json:26`）**无法确定它在检查哪一个**
——它可能一直在检查兄弟仓库 `happy-newton`。本轮**未改**该脚本（超出 R01–R03 范围，
且改成绝对路径会让提交的脚本绑定本机），但**可信任的调用式是带绝对路径的那一条**（上面第 3 点）。
建议后续收敛为跨平台取 `process.cwd()` 的包装脚本。

#### R03 · 官方 registry 依赖审计 —— 已执行，**failed**（真实高危项）

单次命令，未持久修改 registry、未改 lockfile、未打印凭据：

```
pnpm audit --audit-level high --registry=https://registry.npmjs.org
```

- **exit 1**，耗时 2s；`11 vulnerabilities found / Severity: 5 moderate | 6 high`。
- 4 条 distinct 高危公告，落在 2 个包上：

| 包 | 严重度 | 受影响版本 | 修复版本 | 公告 |
|---|---|---|---|---|
| brace-expansion | high | <1.1.19 | >=1.1.19 | GHSA-6j4f-fj2g-mc7p |
| brace-expansion | high | <1.1.20 | >=1.1.20 | GHSA-qhr7-859c-m2p7 |
| fast-uri | high | =3.1.6 | >=3.1.7 | GHSA-58mr-gqgx-xq4g |
| fast-uri | high | >=3.0.0 <3.1.7 | >=3.1.7 | GHSA-qw65-cvwx-89v3 |

- 依赖链（审计原文）：`apps/web → @mozhou/flywheel → @mozhou/benchmark → @mozhou/pipeline → @mozhou/runtime → ajv@8.20.0 → fast-uri@3.1.6`（14 条路径）。
- registry 前后均为 `https://registry.npmmirror.com/`（未变）；`pnpm-lock.yaml` git 状态为空、未被改动。
- **按计划不扩大范围**：本轮只报告，**不做升级**。
- 注意：`pnpm audit` **不带** `--registry` 时仍会因 npmmirror 不实现 audit 端点而失败——
  那正是 §2.2 里 blocked 的来源。**两者不矛盾**：镜像端点缺失是 blocked，
  官方 registry 的结果是 **failed（确有真实高危项）**。

### 2.6 安全与图谱门禁补修 S01–S02（2026-09-30 第三轮）

计划：`security-and-graph-gate-plan.json`。

#### S01 · 图谱检查入口 —— 已修复

**问题**：`package.json` 的 `graph:check` 是 `gitnexus check --cycles --repo mozhou`。
索引里存在**三个**同名 mozhou 仓库（见 §2.5 R02），该命令无法确定检查的是哪一个。

**修复**（`package.json:28`）：

```
"graph:check": "node .gitnexus/run.cjs check --cycles --json -r ."
```

`README.md:150` 同步说明。根 pnpm 脚本的 cwd 即仓库根，故 `-r .` 既不硬编码 C 盘路径、
也不靠同名选择仓库。

| 验收项 | 结果 |
|---|---|
| `pnpm run graph:check` 与绝对路径调用一致 | **IDENTICAL**：两者 JSON 逐字符相同，exit 0 |
| 包装器不存在 | **exit 1**（MODULE_NOT_FOUND），**不假通过** |
| 既有不同路径工作副本（`C:\zcode\novel-ai-closure`） | `-r .` 与 `-r <该副本绝对路径>` 结果 **IDENTICAL**，exit 0 |
| **判别实验** `-r ..` | **exit 1**，`Repository ".." not found` —— 证明 `-r` 是**cwd 相对路径**，不是静默默认仓库（该报错的可用列表里仍列着三个 mozhou） |

日志：`S01-S02/s01-*.log`。

#### S02 · 高危依赖最小补丁 —— 已完成，门禁通过

**先分辨生产/开发**（`pnpm why ... -r`，日志 `S01-S02/why-*.log`）：

| 目标 | 版本 | 归属 | 父依赖与其范围 |
|---|---|---|---|
| fast-uri | 3.1.6 → **3.1.7** | **生产** | `@mozhou/runtime → ajv@8.20.0`，要求 `^3.0.1` ✓ |
| brace-expansion | 1.1.18 → **1.1.20** | 开发 | `minimatch@3.1.5`，要求 `^1.1.7` ✓ |
| brace-expansion | 5.0.9 → **5.0.11** | 开发 | `minimatch@10.2.6`，要求 `^5.0.8` ✓ |

三条目标全部是**同 major 最小补丁**；父依赖范围原生满足，**未改任何父依赖**。
`brace-expansion` **有两条版本线**，必须分别限定——单一 override 会把 5.x 压到 1.x 从而破坏 minimatch@10。

**机制**：`package.json:39-45` 的 pnpm overrides 追加三条，**保留**原有 `tar` / `js-yaml` override
与 `fastembed@2.1.0` patch：

```
"fast-uri": "3.1.7",
"brace-expansion@^1.0.0": "1.1.20",
"brace-expansion@^5.0.0": "5.0.11"
```

**锁文件**：`pnpm-lock.yaml` 共 **+18 / −16**，含**三类**变化：

1. **override 声明**（`pnpm-lock.yaml:7-12`）：新增上述三条目标 override。
2. **三个目标包及其快照引用**：`fast-uri@3.1.6 → 3.1.7`、`brace-expansion@1.1.18 → 1.1.20`、
   `brace-expansion@5.0.9 → 5.0.11`，以及 `ajv@8.20.0` / `minimatch@3.1.5` / `minimatch@10.2.6`
   快照里对它们的引用。
3. **`packages/context-compiler` 的既有依赖分类漂移被一并纠正**（`pnpm-lock.yaml:128-138`）：
   该 importer 的 `'@mozhou/data-plane'` 从 `devDependencies` 归位到 `dependencies`。

第 3 类**不是本次升级引入的**，而是 **HEAD 中就已存在的锁文件与 manifest 不一致**：
`packages/context-compiler/package.json` 一直把 `@mozhou/data-plane` 声明在 `dependencies`
（与 `'@mozhou/kernel'`、`fastembed` 同列，`devDependencies` 为空），
而提交的锁文件把它记成了 `devDependencies`。本次 `pnpm install` 只是让锁文件与 **HEAD 的既有声明**对齐，
**未改动该 package.json**（对它的 `git diff` 为空）。
**该变化保留**——它修正的是分类漂移，不是扩大升级范围。

`pnpm install` 与 `pnpm install --frozen-lockfile` 均 **exit 0**（可重现）。

> 注：`pnpm install` 需按仓库既有要求设 `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`（与 CI 同款）；
> 不设时 `preinstall` 守卫会 exit 1——这是**既有环境要求**，与本次改动无关。

**门禁判定**：`pnpm audit --audit-level high --registry=https://registry.npmjs.org`
→ **exit 0**，`5 vulnerabilities / Severity: 5 moderate`，**无 high / critical**。
registry 前后均为 `https://registry.npmmirror.com/`（未持久修改）。

**变更摘要（三类计数分别记录，勿混同）**：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| **高危漏洞实例数** | 6 high | **0 high** |
| 漏洞实例总数 | 11（6 high + 5 moderate） | 5（全 moderate） |
| 已消除的受影响版本实例 | 3：`fast-uri@3.1.6`、`brace-expansion@1.1.18`、`brace-expansion@5.0.9` | 0 |
| 针对的公告数 | 4 条 GHSA（fast-uri 2 条、brace-expansion 2 条） | 0 条 high |
| 依赖路径数 | fast-uri 14 条、brace-expansion 7 条 | 路径数不变，版本已换 |

**仍存在的 5 项 moderate（低于门禁线，如实列出，本轮未修）**——
诊断命令 `pnpm audit --audit-level moderate` **仅用于枚举**，**门禁仍是 high**：

| 包 | 受影响版本 | 修复版本 | 公告 | 路径数 | 本轮是否可同 major 修复 |
|---|---|---|---|---|---|
| fast-uri | >=3.0.0 <3.1.8 | >=3.1.8 | GHSA-hrr3-gc8f-f4qj | 14 | 可（3.1.7→3.1.8），但**超出本轮指定目标** |
| brace-expansion | <1.1.21 | >=1.1.21 | GHSA-q2hr-2g5m-vwhr | 27 | 可（1.1.20→1.1.21），同上 |
| brace-expansion | >=4.0.0 <5.0.12 | >=5.0.12 | GHSA-q2hr-2g5m-vwhr | 7 | 可（5.0.11→5.0.12），同上 |
| vitest | >=2.1.0 <4.1.11 | >=4.1.11 | GHSA-82fw-gwwq-j7x9 | 5 | **不可**：需跨 major（2→4） |
| @vitest/mocker | >=2.1.0 <4.1.11 | >=4.1.11 | GHSA-82fw-gwwq-j7x9 | 5 | **不可**：同上 |

> **不得把「6 → 0 high」读成「已无漏洞」**：门禁线以上已清零，线以下仍有 5 项 moderate。
> 其中 3 项存在同 major 补丁（`3.1.8` / `1.1.21` / `5.0.12`），本轮**按计划只做已确认的高危目标**，
> 未越界升级；另 2 项需 vitest 跨 major，明确不在范围。

**回归与索引**：build / lint / test / web typecheck / web build / `pnpm graph:check`
全部 **exit 0**；包层 102 文件 / 891 用例，Web 层 855 通过 + 14 跳过（真实模型默认未启用）。
图谱索引因 `package.json` / `README.md` 变更而**受影响**，已串行重建
（`changed=5`，8,930 节点 / 20,133 边）并重新导出（8137 节点 / 16021 关系）；
索引与两份产物同源（`indexedAt=2026-09-30T06:20:29.907Z`、`commit=dc0f7f3`）。

---

---

## 3. 代码图谱事实

### 3.1 规模与健康度

**先分清两组数字**（上一版把它们混在一张表里，容易被误读）：

| 口径 | 指标 | 值 | 出处 |
|---|---|---|---|
| **索引统计** | 索引文件数 | **815** | `.gitnexus/meta.json` 的 stats.files（S02 重建后） |
| **索引统计** | 节点数 | **8930** | stats.nodes |
| **索引统计** | 关系边数 | **20133** | stats.edges |
| **索引统计** | 社区 / 执行流 | 626 / 497 | stats.communities / stats.processes |
| **入库产物** | 导出节点数 | **8137** | `codeGraphData.json` 的 nodes.length（S02 重建后实测） |
| **入库产物** | 导出关系数 | **16021** | relations.length |
| **入库产物** | out-of-scope 未导出关系 | 4112 | 导出器运行时输出；16021 + 4112 = 20133 |
| 快照 | schemaVersion / commit | 22 / dc0f7f3 | `codeGraphSnapshot.ts` 头部 |
| 快照 | worktreeDirty / branch | true / feature/windows-local-release | 同上 |
| 向量检索 | capabilities.vectorSearch | **unavailable**，故查询走 BM25+FTS | `codeGraphSnapshot.ts` 的 capabilities |

> **索引重建前后对照（三次）**：原始 811 文件 / 8866 节点 / 20038 边，产物 8076 / 15934 / 4104；
> R02 重建后 815 / 8926 / 20129，产物 8133 / 16017 / 4112；
> **S02 重建后（当前）815 / 8930 / 20133，产物 8137 / 16021 / 4112**。

**节点数为何两个口径不同**：导出器只导出**带 filePath 的节点**
（`scripts/export-code-graph.mjs:115-117` 的 `WHERE n.filePath IS NOT NULL`），
Community / Process 节点与它们的边被显式跳过（`export-code-graph.mjs:159-167`）。
**4104 条 out-of-scope 关系是有意截断，不是数据缺失**；用图谱判断覆盖度时请注意这一点。

> **本轮注（确定性）**：T05 修复后重跑 pnpm graph:snapshot，产物的**节点集合与关系集合
> 与整改前完全一致**（逐项集合比较通过），但**数组顺序不同**。原因是导出器按 n.id 排序，
> 而 GitNexus 对大量 Function 节点返回空/截断 id（导出器自己的注释 `export-code-graph.mjs:49-54`
> 已说明），导致排序不稳定。**这是一个既有的确定性缺陷，本轮未修**（超出 T05 范围），
> 在此记录：同一索引两次导出会得到字节不同但语义相同的产物。

### 3.2 依赖拓扑（**无环结论的适用范围**）

```
kernel          →  (无依赖，零 @mozhou 引用)
data-plane      →  kernel
context-compiler→  kernel, data-plane
runtime         →  kernel, data-plane
quality-engine  →  (无依赖，真叶子)
pipeline        →  kernel, data-plane, context-compiler, quality-engine, runtime
benchmark       →  kernel, context-compiler, pipeline(仅类型), quality-engine, runtime
flywheel        →  kernel, data-plane, pipeline, runtime, benchmark
```

**这条拓扑的推导方式**：由各 `packages/*/package.json` 的依赖声明 + 源码 import 语句归纳。

**「无环」这个结论能证明什么、不能证明什么**（上一版说得过满，此处收紧）：

- ✅ **可以证明**：在**已检查的 import 关系**上，八个包之间没有形成环。
- ⚠️ **不能证明**：完整的运行时依赖无环。`tsconfig.json:3-12` 的 project references 只固定
  **构建顺序**（kernel → data-plane → context-compiler → runtime → pipeline → quality-engine →
  benchmark → flywheel，其中 runtime 与 context-compiler 是无依赖兄弟、顺序可互换），
  **构建顺序不是运行时依赖图的证据**。
- ✅ **R02 已取得结构化计数**：`node .gitnexus/run.cjs check --cycles --json -r <绝对仓库路径>`
  返回 `{"status":"clean","cycleCount":0,"cycles":[]}`（exit 0）。这比「No circular imports」那句文字强，
  但仍**只覆盖该工具实际建边的范围**——它证明的是「在 GitNexus 已建边的 import 关系上无环」，
  不是「全仓运行时依赖图无环」。
- ✅ **`pnpm run graph:check` 已修正（S01）**：原为 `gitnexus check --cycles --repo mozhou`，
  而索引里有**三个**同名 mozhou 仓库，无法确定检查的是哪一个。现改为
  `node .gitnexus/run.cjs check --cycles --json -r .`（cwd 相对），见 §2.6 S01。

**为什么这个拓扑值得注意**：全仓唯一「想形成环」的地方是 pipeline 第 10 步要调飞轮学习器。
代码里显式挡住了——`packages/pipeline/src/commit-orchestration.ts:29` 写着
「依赖方向 flywheel→pipeline 禁止反向 import，故由编排方注入」，并用注入的 afterRecord
接缝解决。**这是被设计出来的接缝，不是偶然没成环。**

### 3.3 关键枢纽符号与其调用方

| 符号 | 位置 | 生产代码调用方 | 风险判读 |
|---|---|---|---|
| atomicWriteFileSync | `packages/data-plane/src/atomic-write.ts:22` | 11 处：chapter.ts(atomicReplace/createChapterDraft)、create-book.ts、entity-cards.ts(create/update)、impact.ts(runTraversal)、manifest.ts(writeManifest)、negative-learning.ts、reconciliation.ts | **高扇出单点**。改它 = 改全部落盘路径 |
| resolveGenerationTarget | `apps/web/server/llm/generationTarget.ts` | 生产侧至少 11 个文件（deltaExtractor.ts、semanticSettled.ts、storyboard/generate.ts、proseRoutes.ts、pipelineRoutes.ts、storyboardRoutes.ts 等） | **统一 LLM 出口 seam**；起名端点是唯一例外（见 R4） |
| RuntimeEngine | `packages/runtime/src/engine.ts:112` | 生产仅 1 处：`apps/web/server/routes/pipelineRoutes.ts` 的 makeStreamEngine；其余全是测试 | 边界干净 |
| LocalDataPlane | `packages/data-plane/src/local-data-plane.ts:92` | 生产经 static open 进入 | 事务门面 |
| ChapterProductionSession | `packages/pipeline/src/session.ts:235` | 生产经 runChapterCommit 编排进入 | 十步状态机 |
| commitChapter | `packages/data-plane/src/chapter.ts:569` | 生产仅 local-data-plane.ts 一处；其余全是测试 | 写入唯一路径 |
| compile | `packages/context-compiler/src/compile.ts:228` | **生产调用链**：`apps/web/server/routes/pipelineRoutes.ts:593` buildDraftContext → `apps/web/server/draftContext.ts:160` runCompileStep → `packages/pipeline/src/compile-step.ts:203` compile（本轮已核实，见 T04/R5） | **不是死代码** |
| runQualityReview | `packages/quality-engine/src/review.ts:88` | **生产调用链**：`apps/web/server/routes/pipelineRoutes.ts:791` executeChapterReview → `packages/pipeline/src/review-step.ts:248` runReviewStep → `packages/pipeline/src/review-step.ts:172` runQualityReview（本轮已核实，见 T04/R5） | **不是死代码** |
| assertAutomationReadOnly | `packages/kernel/src/protection.ts:52` | **未发现生产引用**（检索范围见 R5） | 需人工确认，见 R5 |

> **图谱的两个已知失真，请勿据此下判断**：
>
> 1. **CALLS 边不记录纯 import 关系**。例如 ChapterProductionSession 在图谱里只有 3 个
>    入边（都在 session.ts 内部），看起来像「没人用」；实际上包 @mozhou/pipeline 被全仓大量
>    import。**判断影响面请以 package.json + grep import 为准。**
> 2. **跨包符号解析会漏报**。上一版把 compile 与 runQualityReview 标成「只有测试调用方」
>    就是这个失真的直接产物——真实的调用链跨了 apps/web → packages/pipeline →
>    packages/context-compiler 三层，图谱没有把它连起来。
>    **「图谱里没有调用边」≠「没有调用路径」**；反过来，**也不能用「import 存在」替代运行路径证据**
>    ——必须实际读出调用链（如 T04 所做）才算数。

---

## 4. 架构地图

### 4.1 八个包的职责与最重要入口

| 包 | 职责 | 最重要符号 | 位置 | 依赖 |
|---|---|---|---|---|
| @mozhou/kernel | 领域类型与**不变量守卫**。零依赖纯函数域，不做任何 IO | assertAutomationReadOnly | `kernel/src/protection.ts:52` | 无 |
| @mozhou/data-plane | 本地 SQLite WAL + Markdown 目录卡 + 五态对账。**事务门面** | LocalDataPlane | `data-plane/src/local-data-plane.ts:92` | kernel |
| @mozhou/context-compiler | 三通道加权 RRF 召回 + 两阶段预留预算装配 + 可重算回执 | compile | `context-compiler/src/compile.ts:228` | kernel, data-plane |
| @mozhou/quality-engine | 机械门禁 + 4-gram 去复读 + De-AI。**零 throw，靠 verdict** | runQualityReview | `quality-engine/src/review.ts:88` | 无 |
| @mozhou/pipeline | 十步章节生产会话状态机 + 提交编排 | ChapterProductionSession | `pipeline/src/session.ts:235` | 上述四者 |
| @mozhou/runtime | LLM 执行引擎 + 能力注册表 + 两级 tier 路由 | RuntimeEngine.execute | `runtime/src/engine.ts:141` | kernel, data-plane |
| @mozhou/flywheel | 作者偏好学习 + 风格画像（StyleProfile 唯一写者） | runPreferenceLearning | `flywheel/src/learner.ts:45` | kernel, data-plane, pipeline, runtime, benchmark |
| @mozhou/benchmark | 6 指标机械基准 + 阈值表**唯一真源** | runBenchmark | `benchmark/src/run.ts:104` | 几乎全为类型引用 |

十步流水线（冻结词表，`packages/pipeline/src/steps.ts:11-22`）：

```
prepare → compile → draft → review → user_edit → final_extract
        → continuity_gate → canon_proposal → commit → flywheel_record
```

### 4.2 后端分层与路由分发

```
生产入口  apps/web/server/productionServer.ts:131   裸 node:http，/api/* → router，其余 → dist/ 静态
开发入口  apps/web/server/api.ts:645                 Vite 插件注入同一 router
路由核心  apps/web/server/router.ts:42                ApiRouter.dispatch
装配器    apps/web/server/api.ts:604                  18 个路由模块按固定顺序 .use()（实际调用在 :607-624）
策略表    apps/web/server/routePolicies.ts:24         FAIL-CLOSED：未登记 = 403
错误码    apps/web/server/routeCodes.ts:15             跨文件契约常量
```

**分发顺序有语义**：healthRoutes 必须排第一（`api.ts:606-607` 有注释说明）；
truthfulPreviewRoutes 排第 6（`api.ts:612`），**先注册**以遮蔽后面 crawlerRoutes
（`api.ts:614`）里的 /api/novel-breakdown、/api/web-search、/api/rank-scan。
**改注册顺序会静默改变对外行为**——这是最容易踩的坑。

**重要更正（上一版说成「统一返回 501」，不准确）**：`truthfulPreviewRoutes.ts` 是**条件拦截**，
不是无条件 501：

| 端点 | 拦截条件 | 出处 |
|---|---|---|
| /api/novel-breakdown | **仅当**无环境 key（MOZHOU_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY 全空）**且** body.allowHeuristic !== true 时返回 501 | `truthfulPreviewRoutes.ts:17-30` |
| /api/web-search | **仅当** defaultSearchProvider.isConfigured() 为假时返回 501 | `truthfulPreviewRoutes.ts:32-39` |
| /api/rank-scan | **仅当** MOZHOU_LIVE_RANKINGS !== '1' 时返回 501 | `truthfulPreviewRoutes.ts:41-48` |

也就是说：**配了真实 key / 真实搜索源 / 开了实时榜单之后，这三个端点是会放行到下游处理器的**。
把它当成「恒 501 的桩」会在配好上游后误判行为。

### 4.3 端点总览

**先给可复核的计数，再给结论**（上一版直接写「共约 85 个端点」「真实调用 LLM 的只有 4 个」，
两个数字都没有给出可复核的口径，本轮改正）：

- 可复核计数：`apps/web/server/routes/*.ts`（排除 `*.test.ts`）中
  `path === '/api/…'` 的**分发点共 98 处**（本轮实测）。
- 路由模块 18 个，注册顺序见 `api.ts:607-624`。

| 文件 | path === '/api/…' 分发点 |
|---|---|
| pipelineRoutes.ts | 16 |
| accountRoutes.ts | 14 |
| systemRoutes.ts | 12 |
| worksRoutes.ts | 10 |
| storyBrainRoutes.ts | 7 |
| reconciliationRoutes.ts | 6 |
| billingRoutes.ts | 5 |
| proseRoutes.ts | 5 |
| storyboardRoutes.ts | 5 |
| crawlerRoutes.ts | 4 |
| managedModelRoutes.ts | 4 |
| backupRoutes.ts | 3 |
| providerRoutes.ts | 3 |
| truthfulPreviewRoutes.ts | 3 |
| exportRoutes.ts | 1 |
| **合计** | **98** |

**「有几个端点会真实出站调用模型」——上一版的「4 个」是漏报，且它自己的 R4 说「其余 4 个」
与那张表自相矛盾**（表里已含 /api/naming，那么「其余」只有 3 个）。本轮按
「生产代码里所有真实出站调用点」重新枚举，得到**至少 6 个端点/路径**：

| 端点 | 出站调用点 | 出站方式 |
|---|---|---|
| POST /api/draft.stream | `routes/pipelineRoutes.ts:372` | streamOpenAiChat（直连，NDJSON 流） |
| POST /api/chapter.commit | `routes/proseRoutes.ts:529-530` → `analysis/deltaExtractor.ts:415` | resolveGenerationTarget({taskType:'FINAL_EXTRACT'}) → streamOpenAiChat |
| POST /api/storyboard.generate | `routes/storyboardRoutes.ts:97` → `storyboard/generate.ts:123` | resolveGenerationTarget({taskType:'STORYBOARD'}) → streamOpenAiChat |
| POST /api/naming | `routes/namingRoutes.ts:140` | resolveChatEndpoint → streamOpenAiChat（**绕过统一 seam**，见 R4） |
| POST /api/llm/test | `routes/providerRoutes.ts:79` → `llm/openaiStream.ts:312` | testConnection（**真实出站**，max_tokens:1 探活；上一版完全没提） |
| 非端点：落定语义分析旁路 | `server/semanticSettled.ts:121` → `llm/semanticEvaluator.ts:162` | resolveGenerationTarget({taskType:'SEMANTIC_ANALYSIS'}) → streamOpenAiChat（由 reconciliation watcher 定时触发，**不是任何 HTTP 端点**） |

> **未完成的部分（如实标注）**：上表是按「streamOpenAiChat / testConnection 的所有生产调用点」
> 枚举的，覆盖 `apps/web/server` 下的直接出站。**未覆盖**：
> (a) `packages/runtime` 的 RuntimeEngine.execute 经 `packages/runtime/src/adapter/openai-compat.ts`
> 出站的路径是否还有别的触发端点；(b) 定时/后台任务里可能存在的其他出站。
> **因此上表应读作「已核实至少 6 个」，不是「恰好 6 个」。** 完整穷尽需要另开一项工单。

诚实报「未就绪」的端点（这是**特性不是缺陷**，勿当 bug 报）：

| 端点 | 行为 |
|---|---|
| POST /api/cloud-sync.backup | 恒 501 BACKUP_NOT_IMPLEMENTED |
| POST /api/membership.activate | 恒 501 LICENSE_ACTIVATION_NOT_IMPLEMENTED |
| POST /api/web-search | 未配搜索源 → 501（配了则放行，见 §4.2） |
| POST /api/rank-scan | 未开实时榜单源 → 501（开了则放行） |
| POST /api/naming | 未配模型 → 501 NAMING_NOT_CONFIGURED |

### 4.4 前端消费方式

- **唯一 fetch 原语**：`src/lib/post.ts:16-32`（POST JSON，非 2xx 或 ok:false 即抛，
  error.name = 契约错误码）。无 base URL、无重试、仅同源。
- 上层封装 `src/api/client.ts` 的 MoZhouApiClient（33 个方法，自动注入 bookId/root），
  但**很多视图绕过它直接调 post()**——这是既有风格，不是缺陷，但改接口时要 grep 全 src/。
- **没有 React Query / Zustand**。每个视图自持 useState + useCallback，动作后手动重取。
- 导航注册表：`src/shell/views.ts:19-71`，25 个视图 / 7 组。

---

## 5. 风险台账（**这一节需要你投入判断力**）

### R1 · 真实模型测试的门禁 —— **本轮已修复**，附残余风险

**整改前的事实**（三份 *.realModel.test.ts + 一处 storyboard 冒烟）：

| 缺陷 | 位置（整改前） | 后果 |
|---|---|---|
| 硬编码本机绝对路径读 key | namingRoutes.realModel.test.ts:28、pipelineRoutes.firstChapter.realModel.test.ts:31、realModel.featureSweep.test.ts:29 | 换机器必然失败；含本机用户名且已提交进 git |
| 硬编码代理端口与模型名 | 同上 :29-31 / :32-42 | 机器绑定 |
| **未配置时提前 return** | namingRoutes.realModel.test.ts:67（beforeAll）、:136-139（每个 it） | **vitest 记为 passing** ⇒ 「CI 全绿」不能证明真实链路跑过 |
| 测试自行放开 SSRF 门禁 | namingRoutes.realModel.test.ts:73 等 | 测试替部署者做了安全决策 |
| storyboard 真机冒烟**自动**出站 | storyboard/generate.test.ts:271-276（整改前） | 只要 shell 里有 MOZHOU_API_KEY/DEEPSEEK_API_KEY/OPENAI_API_KEY 任一（**这正是 README 记载的常规 BYOK 配置**）就自动发真实请求 ⇒ 跑一次普通 pnpm test = 一次无人预期的计费调用 |

**本轮修复**（详见 `apps/web/server/test-support/realModelGate.ts` 的契约注释）：

1. 新增统一门控 `apps/web/server/test-support/realModelGate.ts`，
   开关是 **MOZHOU_RUN_REAL_MODEL_TESTS=1**；凭据只认显式传入的
   MOZHOU_API_KEY / MOZHOU_API_BASE / MOZHOU_MODEL
   （与 `llm/providerSettings.ts:53-57` 的生产变量链一致）。
2. 未启用 ⇒ it.skipIf ⇒ **skipped**（不是 passing），零上游请求。
3. 启用但三项任一缺失 ⇒ requireRealModelConfig() 在 beforeAll 抛
   RealModelConfigError ⇒ **suite 失败、退出码非零**，不退化成 skip。
4. 启用且上游不可达/鉴权失败 ⇒ 断言失败 ⇒ **非零**。
5. 门控**不碰** MOZHOU_ALLOW_PRIVATE_LLM：是否授权环回端点由部署者决定。
6. 每份测试文件的环境变量**逐项恢复**（applyEnvOverrides），书根用 mkdtempSync、
   端口用 listen(0)，故两个并行进程互不共享。
7. 新增显式入口 pnpm run test:real-model（`scripts/run-real-model-tests.mjs`）：
   配置缺失时**启动前就拒绝**并非零退出，绝不静默 skip。
8. 确定性守卫（SSRF 反向断言）**不受门控影响，任何时候都跑**。

**本轮实测证据**（日志见 §2.3）：

| 验收项 | 结果 |
|---|---|
| 未启用 + 凭据存在 | 12 用例中 1 passed / 11 skipped，**观察服务计数 = 0** |
| 启用 + 缺配置 | 退出码 **1**，RealModelConfigError 指出缺 MOZHOU_API_BASE/MOZHOU_MODEL |
| 启用 + 受控不可达 | 退出码 **1**，2 failed / 1 passed，日志无凭据 |
| 启用 + 受控可达观察服务 | 观察服务收到 **3 次**请求，退出码 **1**，日志无凭据 |
| 两进程并行 | 两进程各自退出 **1**，合计 4 次请求，**无 EADDRINUSE**，临时目录无新增残留 |
| test:real-model 无配置 | 退出码 **1**，打印「缺少必需配置 …」 |
| 全量 pnpm test 默认零真实模型 | 14 skipped，**未配置任何 MOZHOU_* 真实模型变量** |

**残余风险（如实列出）**：

1. **真实模型的生成/采纳质量本轮未验收**。本轮只验证了「门控正确」，
   **没有**用付费或计费不明的上游跑过一次真实生成。若要验收真实质量，
   需用户显式提供已确认费用的配置并授权。
2. 观察服务证明的是**门控与失败传播**，**它本身不是真实模型验收**。
3. 「托管 CI 从未执行真实模型」这个结论**依然成立**：本机跑通不能推翻它。
   修复后的正确表述是——**CI 里这些用例现在是显式 skipped，而不是「悄悄 pass」**。
4. 启用+缺配置时，vitest 摘要行仍会显示「Tests 3 skipped (3)」，但**文件级为 failed 且退出码 1**。
   判据必须看退出码/文件级结果，**不能只看 Tests 计数行**——这一点已在 A2 日志中显式记录。

### R2 · pnpm test 不执行 apps/web 的任何测试 —— **本轮已修复**

**整改前**：根 `vitest.config.ts:5` 的 include 只有 `packages/*/src/**/*.test.ts`；
而 apps/web 有 131 个测试文件（`apps/web/vitest.config.ts:9` 覆盖 src/** 与 server/**）。
本地开发者只跑 pnpm test 会以为全绿。

**本轮修复**（T03）：

| 入口 | 整改后 |
|---|---|
| pnpm test（根 `package.json`） | pnpm run test:packages && pnpm run test:web，任一层失败即非零 |
| pnpm run test:packages | 原 vitest run（包层） |
| pnpm run test:web | pnpm --filter @mozhou/web test |
| CI（`.github/workflows/ci.yml:39-47`） | 保留分层诊断，把原来的 pnpm test 步骤改为 pnpm run test:packages，**避免 Web 层重复运行** |
| README | `README.md:77-85` 明示完整本地检查命令；`README.md:142-143` 说明分层与真实模型入口 |

**验收证据**：本轮 pnpm test **exit 0**，日志中**同时出现两层报告**
（包层 102 文件 / 891 用例；Web 层 115 文件 / 855 通过 + 14 跳过），见 §2.2。

**残余**：pnpm test 现在是串行两层，本地全量耗时增加（这是「不漏跑」的代价）。

### R3 · 代码图谱作为产品功能暴露在主导航，且数据有噪声 —— **本轮记录，不擅自改**

- `src/shell/views.ts:67-70` 有导航组 **「开发 · Local」**，把「代码图谱」放进商业产品主导航。
- 入库图谱数据实测：**39 条自环边**，分类为 **CALLS = 25**、**ACCESSES = 14**（本轮实测）。
  导出器未过滤。悬空边 0（这点是好的）。
- 快照头部自报 branch: feature/windows-local-release、worktreeDirty: true——
  把内部开发信息暴露在 UI 数据里。

**本轮诊断（T06，见 R3.1）**：自环边**不等于**代码有循环 import；
「是否隐藏图谱导航」「是否在产物里去掉 branch/dirty 元数据」属于**产品范围选择**，
本轮**记录待决定，不擅自隐藏或删除**。

#### R3.1 39 条自环边的诊断

| 问题 | 本轮结论 |
|---|---|
| 39 条自环是什么 | CodeRelation 自环（source === target），按类型：CALLS 25 / ACCESSES 14 |
| 能否用「自环数」替代「循环 import 数」 | **不能**。两者是不同的关系类型，量纲不同 |
| 抽样看是否都是真递归 | 抽样显示多为**语义访问边**（如 Function:apps/web/src/code-graph/CodeNodeExplorer.tsx:relations [ACCESSES]）与函数内自引用，**不是**模块级循环依赖 |
| 是否有节点合并/映射误差造成的假自环 | **未验证**——需要逐条核对图谱的节点合并逻辑，本轮未做 |
| 是否要删除全部自环 | **不**。有真递归（如 `packages/benchmark/src/long-novel.test.ts` 的 expiredFact 重复出现）与语义访问边混在一起，一刀切会丢信息。**有证据才列修复方案** |

### R4 · /api/naming 绕过了统一的 LLM 出口 —— **本轮确认为有意设计，保留**

其余 LLM 端点都经 resolveGenerationTarget（`apps/web/server/llm/generationTarget.ts`，
它保证 providerId 与实际出站 endpoint 同源，从而账本可信）。
但 `routes/namingRoutes.ts:128` 直接调 resolveChatEndpoint：

```
const endpoint = resolveChatEndpoint(process.env, principal.userId)
```

**这是规格要求，不是漂移**：工单 `.scratch/mozhou-mvp/issues/22-openwrite-parity-memo-naming.md:11`
原文写着「POST /api/naming 走 BYOK 端点（resolveChatEndpoint），未配置模型时
501 NAMING_NOT_CONFIGURED 诚实报错」。

**后果**：层 2（registry/tier 路由）配置对起名功能无效，起名只能走 BYOK。
**本轮决定**：**先保留**。不把起名强改为统一 LLM seam、不新增 NAMING 领域 taskType
（两者都在本轮范围之外，且会改动 LLM 路由契约）。

> 补充事实：`server/semanticSettled.ts:18` 也出现 resolveChatEndpoint，但那是**注释里
> 引用的历史写法**；实际调用在 `semanticSettled.ts:121`，用的是 resolveGenerationTarget。
> 所以生产路由层直接绕过 seam 的**只有** `namingRoutes.ts:128` 一处。

### R5 · 关键符号「图谱不可见」 —— **本轮已核实（T04）**

上一版把四项列为「疑似死代码」，并请审核者花预算复核。**本轮已复核完毕**：

| 项 | 定义 | 生产调用链 | 规格意图 | 检索范围 | 结论 |
|---|---|---|---|---|---|
| compile | `packages/context-compiler/src/compile.ts:228` | `apps/web/server/routes/pipelineRoutes.ts:593` → `apps/web/server/draftContext.ts:160` → `packages/pipeline/src/compile-step.ts:203` | 上下文装配主入口 | 全仓 grep + 逐跳读调用方 | **已接线，非死代码** |
| runQualityReview | `packages/quality-engine/src/review.ts:88` | `apps/web/server/routes/pipelineRoutes.ts:791` → `packages/pipeline/src/review-step.ts:248` → `packages/pipeline/src/review-step.ts:172` | 质量门主入口 | 同上 | **已接线，非死代码** |
| assertAutomationReadOnly | `packages/kernel/src/protection.ts:52` | **未发现生产引用** | I1 工件级保护守卫；注释称「作者/应用壳的人工写路径不走此守卫——保护位约束的只是自动流程」 | 全仓 grep：命中仅 protection.ts:52（定义）、protection.test.ts（5 处）、`docs/research/t51-grill-learner-protocols.md:76`、图谱产物 | **未发现生产引用**；**本轮不删除、不补接线** |
| packages/flywheel/src/evaluator/ 子树 | 6 个源文件（project/run/storage/thresholds/types/wilson）+ 3 个测试 | **未从 flywheel/src/index.ts 导出，且无外部 importer** | ADR `docs/adr/0008-evaluation-engine-as-first-class-system.md` 把它定义为一等系统；`packages/benchmark/src/version-matrix.test.ts:105` 注释写「learner/evaluator **未来**同一读法」 | grep evaluator（全仓，排除 node_modules）+ 检查 flywheel/src/index.ts 全部 export | **分类：库内实现，待接线**（有 ADR 意图 + 「未来」注释佐证，不是遗留垃圾） |

**方法学纪律（请连同结论一起采信）**：

- **未接线 ≠ 死代码**。四项里两项有生产调用链，一项有 ADR 规格意图，一项（assertAutomationReadOnly）
  只有「未发现引用」这一条事实——**「没搜到」不等于「不存在」**，故不据此删除。
- **图谱漏边 ≠ 生产缺陷**。compile / runQualityReview 的误判就是图谱跨包解析漏报造成的。
- 本轮**没有修改任何业务代码**（T04 是纯只读取证）。若确认 assertAutomationReadOnly
  需要接线，**另列**具体用户路径、授权与验收标准，不在本轮范围。

### R6 · 已知文档漂移

| 位置 | 漂移 | 本轮处置 |
|---|---|---|
| `docs/handoff/HANDOFF-20260917.md` | 说 apps/web 是 Next.js、门禁 11 项、存在 app/ 目录——三处均已过时 | **标为历史档案，不批量改写** |
| `README.md:3` | 头部宣称「5 项机械门禁」；而 9-17 文档说 11 项 | README 是新的（v0.2.1 已按实际修正过宣称），**以 README 为准** |
| `packages/context-compiler/src/index.ts:1-2` | 头部注释仍写「骨架占位」，CONTEXT_COMPILER_VERSION 仍是 '0.0.0' 占位值，但函数体已完整实现 | 记录，**本轮未改**（改版本号涉及对外契约） |
| `docs/adr/` | **编号重复**：0001~0007 各有两个不同主题的文件（如 0001-novel-kernel-over-skill-adapter.md 与 0001-writing-context-boundaries.md） | **按完整文件名引用，不重新编号**。全文已遵循此约定 |
| `scripts/export-code-graph.mjs:8` | 硬编码 %APPDATA%\npm\node_modules\gitnexus\…，换机器 pnpm graph:snapshot 直接失败 | **本轮已修复（T05）**，见下 |

#### R6.1 T05 修复：图谱导出可移植性

**整改前**：export-code-graph.mjs 直连 %APPDATA%\npm\node_modules\gitnexus\dist\cli\index.js
（:8），与仓库其余部分（.gitnexus/run.cjs、AGENTS.md、hooks）各自选用的调用路径不一致。

**本轮修复**：runCypher 改为通过既有包装器 node .gitnexus/run.cjs cypher 调用，
保留 -r <绝对仓库路径> 与结构化 JSON 解析；移除 APPDATA 拼接；**不新增**另一套 CLI 解析器、
不引入自动安装策略。

**关键技术事实（实测，非推断）**：

1. `.gitnexus/run.cjs:301-314` 的直接执行入口用 stdio: 'inherit' 启动 gitnexus。
   由于父进程给 run.cjs 的 stdout 是一根管道，孙进程继承同一 fd ⇒ **JSON 仍能回到调用方**。
   已在真实运行中验证。
2. **Windows 上必须给查询加一对双引号**。`run.cjs:313` 用 shell: true 拉起 gitnexus，
   cmd.exe 会按空格**再切一次**实参，把含空格的 Cypher 查询撕成十几个 token
   （实测报错：too many arguments for 'cypher'. Expected 1 argument but got 13）。
   用双引号包住后 cmd.exe 还原为单个 token，CLI 收到裸查询。
3. 包装器缺失 ⇒ 明确抛错并 exit 1，**不写入部分新快照**。

**验收证据**（日志见 §2.3）：

| 验收项 | 结果 |
|---|---|
| 从仓库实际运行 pnpm graph:snapshot | **exit 0**，9s，产出 293 communities / 497 processes / 8076 nodes / 15934 relations / 4104 out-of-scope |
| 两份产物来自同一索引 | 是：indexedAt=2026-09-30T04:42:01.380Z、commit=dc0f7f3、schemaVersion=22 |
| **改变 APPDATA 的隔离环境** | 把 APPDATA 指向空目录后仍 **exit 0** 且输出一致（整改前必然 ENOENT） |
| 缺包装器 | 抛 Missing .gitnexus/run.cjs 并 **exit 1**，两份旧产物 SHA256 **不变** |
| 未验证平台 | **仅验证 Windows**；POSIX 下引号处理按 sh 语义推断，**未实跑** |

**同时发现（未修）**：导出器按 n.id 排序，而 GitNexus 对大量 Function 节点返回空/截断 id
（`export-code-graph.mjs:49-54` 自述），导致同一索引两次导出的**数组顺序不稳定**
（集合相同、顺序不同）。属既有确定性缺陷，超出 T05 范围，记录待办。

### R7 · kernel、data-plane、pipeline、runtime 四个包没声明 test 脚本

**本轮实测确认**：@mozhou/benchmark / context-compiler / flywheel / quality-engine
有 test: vitest run；kernel / data-plane / pipeline / runtime 为**无 test 脚本**。

但它们**确实有测试文件**，根 `vitest.config.ts:5` 的 include 覆盖了它们，所以测试**会跑**。
只是单包 pnpm --filter @mozhou/kernel test 会失败。属配置不一致，非功能缺陷。

**本轮决定**：**不做批量整改**（T06 明确排除）。

---

## 6. 明确**未验证**的维度（请勿当作已确认）

1. **未验证**：Windows 安装器的实际安装/运行体验。只有静态产物报告
   （`windows-install-check-report.json`：WebView2 已检测、未签名、125MB）。
   signatureStatus: "NotSigned" —— 签名证书仍未采购。
2. **未验证**：容器与 systemd 部署。MOZHOU_DATA_ROOT / MOZHOU_SECRET_KEY 只做了代码级确认
   （`apps/web/server/dataRoot.ts:17-23`、`llm/providerSettings.ts:91-97` 生产缺失即拒绝启动），
   **没有实跑容器**。
3. **未验证**：真实模型生成/采纳的**质量**（本轮只验证门控，见 R1 残余风险）。
4. **未验证**：`evidence/real-novel-journey/` 的长篇旅程（9-27 报告称「生成 0 字 / 五族 0 行」）。
5. **未验证**：packages/flywheel/src/evaluator/ 子树是「有意 WIP」还是「漏接线」的**最终判定**
   （本轮给出「库内实现，待接线」的**分类**，依据是 ADR 意图 + 「未来」注释；未经产品确认）。
6. **未验证**：安全扫描（Mimosa）的当前结论。仓库内 .mimosa/reports/ 有 16 份历史
   task-review 报告，本轮未逐份审阅。
7. **未验证**：性能。Web 构建产物体积与首屏加载（本轮只验证了构建能成功）。
8. **未验证**：`scripts/verify-real-model-journey.mjs` 本轮未执行（会消耗真模型额度）。
9. **未验证**：assertAutomationReadOnly 是否真的无生产引用——只能声明「在已列检索范围内未发现」。
10. **未验证**：§4.3 的出站调用清单是否穷尽（已核实的口径见该节说明）。
11. **已修复并通过门禁（S02）**：官方 registry 审计现为 **exit 0**，
    **0 high / 0 critical**；仍有 **5 项 moderate**（低于 `--audit-level high` 门禁线）未修，
    其中 3 项存在同 major 补丁但**超出本轮指定目标**，2 项需 vitest 跨 major。
    见 §2.6 S02 的明细表。**不得据此声明「已无漏洞」。**
12. **未验证**：POSIX/macOS 上的图谱导出与真实模型门控（本轮仅在 Windows 实跑）。
13. **已消除（R02）**：索引已重建为 `indexedAt=2026-09-30T05:58:41.157Z`，
    本轮新增文件已入索引，§3.1 的规模数字对应该索引。
    **但**：本仓库在 **WSL/POSIX 侧仍无索引**，故「POSIX 上的完整导出」仍是 blocked（见 §2.5 R01）。

---

## 7. 给审核 AI 的具体委托建议

按**性价比**排序，从上往下做，每项都自带了前置结论，你只需判断：

| 优先级 | 委托内容 | 你要输出的 | 为什么值得你先看 |
|---|---|---|---|
| **P0** | 复核 §2.1 的历史结论是否还有残留的「免检」暗示 | 是/否 + 位置 | 本轮的整改主题就是「别把历史当免检」 |
| **P0** | 复核 §5 R1 的门控契约是否有绕过路径（例如直接跑 vitest 且设了开关但配置不全） | 是/否 + 证据 | 影响「绿灯到底证明了什么」这条根本信任链 |
| **P1** | 复核 §3.2 依赖 DAG 是否真的无环（**用 import 关系，不要用构建顺序**） | 是/否 | 上一版在此处把构建顺序当成了运行时依赖证据 |
| **P1** | 审 §4.3 的端点清单有无遗漏端点（上一版的「4 个」已证为漏报） | 补漏 | 我按 streamOpenAiChat/testConnection 调用点枚举，可能漏掉经 runtime 适配器出站的路径 |
| **P2** | 判断 §5 R3 的图谱自环（39 条）是否要过滤 | 接受 / 需改 | 需先区分真递归与语义访问边；本轮只做了抽样 |
| **P2** | 判断 §5 R4 绕过 seam 是否为设计债 | 接受 / 需改 | 工单 22 已明文要求 BYOK，本轮据此保留 |
| **P3** | 扫 §5 R6 的文档漂移是否要批量修 | 优先级排序 | 事实已列全，你只需定优先级 |

**你不需要做的事**（本轮已做完并给了出处与日志）：

- 跑 pnpm build / pnpm lint / pnpm test / Web typecheck / Web build —— §2.2 有本轮实跑结果与日志路径
- 复核 §5 R5 的四项「死代码嫌疑」—— 本轮已逐项核实（T04）
- 复核 R1 的门控是否真的生效 —— 本轮有 6 组受控验收（§2.3）
- 复核 T05 的包装器兼容性 —— 本轮已实跑 + APPDATA 隔离验证
- 探索八个包的职责与入口 —— §4.1 已成表
- 摸后端路由分发链路 —— §4.2 已成图（含条件拦截的更正）

---

## 8. 关键文件速查

| 想了解 | 去读 |
|---|---|
| 领域术语规范（本项目的「宪法」） | `CONTEXT.md`（286 行，术语 + _Avoid_ 反义词表） |
| 当前 API 契约全集 | `.scratch/mozhou-mvp/contracts/api-contract.md`（第 27 节是最新 DELTA-006） |
| 工单体系（23 个） | `.scratch/mozhou-mvp/issues/NN-<slug>.md` |
| 决策记录（30 个，**编号有重复，引用须带完整文件名**） | `docs/adr/`，例如 `docs/adr/0008-evaluation-engine-as-first-class-system.md` |
| 商业化对标调研 | `.scratch/openwrite-research-20260929/openwrite-commercialization-vs-mozhou.md` |
| 上次完整审查报告（**其结论部分需重新核对，见 §2.0**） | `artifacts/audit-20260927/商业化就绪度审查报告.md` |
| CI 门禁定义（8 步） | `.github/workflows/ci.yml` |
| 发布工作流 | `.github/workflows/release.yml` |
| 安全扫描工作流 | `.github/workflows/security.yml` |
| 图谱导出器（本轮已修复可移植性） | `scripts/export-code-graph.mjs` |
| 真实模型测试门控（本轮新增） | `apps/web/server/test-support/realModelGate.ts` |
| 真实模型显式入口（本轮新增） | `scripts/run-real-model-tests.mjs` |
| 图谱环检查（S01 已修正） | `pnpm run graph:check` → `node .gitnexus/run.cjs check --cycles --json -r .`，输出 `{"status":"clean","cycleCount":0,"cycles":[]}` |
| 工程规矩 | `AGENTS.md`（UVSD v2.2.1 协议） |

---

*本文档基于 dc0f7f3ddb2ed58be326d4002c902f852778e2cc 于 2026-09-30 生成并整改，
并按独立复核（`independent-review-followup.json`）完成 R01–R03 补修（见 §2.5），
再按 `security-and-graph-gate-plan.json` 完成 S01–S02 补修（见 §2.6）。
所有 文件:行号 引用在生成时均已验证存在；§2.1 的历史结果已逐条标注来源定位结论，
§2.2 / §2.5 / §2.6 为实跑结果并附日志路径与 SHA256；§6 的未验证清单为如实声明。
**索引已按 S02 重建**，故 §3.1 的数字对应当前索引。*
