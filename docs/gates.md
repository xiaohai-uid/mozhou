# 门清单与退出码 (Gates)

> 本文件是墨舟**全部门的唯一清单**：每个门跑什么、退出码是什么、有没有 BLOCKED 状态、是否接进 CI。
>
> **2026-10-02 新增。此前全仓没有任何文档写过门的退出码契约**——`AGENTS.md`、`docs/agents/*.md`、`GLOSSARY.md` 中 `退出码` 命中数为 0。每个门的语义只能靠读源码推断。本文件补上这个缺口。
>
> 退出码数字的出处见每行 `file:line`。

## 一条铁律

> ### BLOCKED 不是 PASSED。
>
> 门的第三种状态是「**没跑成**」，不是「跑过且通过」。任何自动化消费门时，**只看退出码会把两者混为一谈**。

正确消费方式，按优先级：

1. 门写了 `result.json` 之类的结构化产物 → **读 `status` 字段**，别读退出码。
2. 门支持 `--strict` 之类的严格开关 → 在 CI 中**启用它**。
3. 两者都没有 → 该门的 BLOCKED 状态目前**无法被自动化区分**，这是已知缺口，不要假装它能被区分。

## 门清单

| 门 | 命令 | 退出码（出处） | BLOCKED | 在 CI |
|---|---|---|---|---|
| **术语单一权威** | `pnpm run check:glossary` | 0 通过 `scripts/verify-glossary.mjs:89` · 1 失败 `:92` | 无此状态 | ✅ `ci.yml` |
| **包 README 契约** | `pnpm run check:readmes` | 0 四段齐备 · 1 缺 README 或缺段 `scripts/verify-package-readmes.mjs` | 无此状态 | ✅ `ci.yml` |

| **中英术语映射新鲜度** | `pnpm run check:term-map` | 0 一致 · 1 与生成器输出不符 `scripts/gen-term-map.mjs --check` | 无此状态 | ✅ `ci.yml` |

| **门清单防腐化** | `pnpm run check:gates` | 0 一致 · 1 清单与仓库现实脱节 `scripts/verify-gates-contract.mjs` | 无此状态 | ✅ `ci.yml` |

| **架构地图新鲜度** | `pnpm run check:architecture` | 0 一致（无显式 exit，自然落透） · 1 陈旧 `scripts/gen-architecture.mjs:140` | 无此状态 | ✅ `ci.yml` |
| **真实模型旅程** | `pnpm run verify:real-model` | 0 VERIFIED · 1 FAILED · **0 BLOCKED** · **2 BLOCKED `--strict`** | `status: 'BLOCKED'` `scripts/verify-real-model-journey.mjs:76` | ❌ 未接入 |
| 无引用审计 | `pnpm run audit:unreferenced` | 2 `scripts/audit-unreferenced.mjs:112` | 无 | ❌ |
| 代码图谱检查 | `pnpm run graph:check` | 由 runner 决定 `.gitnexus/run.cjs:321` | 无 | ❌ |
| 真实模型测试 | `pnpm run test:real-model` | 1 `scripts/run-real-model-tests.mjs:53`、`:78` · 透传 `result.status` `:80` | 无 | ❌ |
| 真实小说旅程 | `node scripts/verify-real-novel-journey.mjs` | 2 `scripts/verify-real-novel-journey.mjs:31` | 无 | ❌ |
| R05 端到端旅程 | `node scripts/verify-r05-journey.mjs` | 0 `scripts/verify-r05-journey.mjs:1249` | 无 | ❌ |
| 草稿上下文测量 | `node scripts/measure-draft-context.mjs` | 2 `:229`、`:238`、`:242` · 1 `:246` | 无 | ❌ |
| 覆盖率 | `pnpm run coverage:check`（仅报告状态） | 0 配置就绪 · 1 配置缺失 | 无 | ❌ 未接入 |
| 克隆检测 | `pnpm run duplication` | 见 jscpd（`.github/workflows/graph-gate.yml:54-73` 的 duplication job；0 未超阈值 / 非 0 超阈值） | 无 | ✅ `graph-gate.yml` |

| 既有 CI 链 | `pnpm build` / `lint` / `test:packages` / `--filter @mozhou/web typecheck` / `test` / `build` / `pnpm audit` | pnpm 标准 | 无 | ✅ `ci.yml:32-49` |

| **门清单在 CI 列一致性** | `node scripts/check-gates-ci-column.mjs` | 0 一致 · 1 脱节 · 2 用法错误 | 无此状态 | ✅ `ci.yml` |
| **文档裸数字** | `node scripts/check-doc-numbers.mjs` | 0（默认只报不拦）· `--strict` 有发现即 1 | 无此状态 | ✅ `ci.yml`（只报不拦） |
| **生成物新鲜度（按索引）** | `node scripts/check-generated-freshness.mjs` | 0 一致 · 1 陈旧 · 2 环境错误 | 无此状态 | ❌ 未接入（在 pre-commit 钩子里，见下） |

> 末两行 2026-10-10 补：`check-gates-ci-column.mjs` 校验本表「在 CI」列与 `.github/workflows/`
> 的实际内容一致（双向：点名 workflow 的必须在其中找到该命令；标 ❌ 的不许出现在任何 workflow）。
> 之所以需要它——此前 `check:gates` 只拿**硬编码的三个门名**去比对 ci.yml，于是「克隆检测」
> 那一行写着「❌ 未接入」而它早已是 `graph-gate.yml` 的作业，门一声不响。
> `check-doc-numbers.mjs` 扫活文档里的裸规模数字（旁边既无日期也无命令指针），只报不拦——
> 两轮「声称 vs 现实」审计清的 15 处陈旧声称几乎全是这类数字，先让漂移可见再决定阈值。
> `check-generated-freshness.mjs` 把**索引**那棵树导出到临时目录再判生成物是否一致——直接在工作区
> 跑 `--check` 会把他人未提交的改动算成陈旧（只能降级为告警），而告警挡不住「自己的提交把生成物
> 改陈旧」（同类漂移在 2026-10-10 会话里出现 4 次），索引语义没有这个问题，故做成阻断。
> 前两者都接进了 `ci.yml` 的 Doc gates 步骤、`scripts/ci-gate.mjs doc-gates` 与仓库的 pre-commit
> 钩子；生成物新鲜度只在钩子里（CI 的检出是干净的，用 `gen-*.mjs --check` 即可）。

## `verify:real-model` 的完整契约

这是全仓唯一有 BLOCKED 语义的门，所以单列。

**结构化产物**（权威通道）：`evidence/real-model-journey/<RUN_ID>/result.json`，字段 `kind, status, sourceCommit, command, exitCode, scope, provider, result, limitations`。

| status | 默认退出码 | `--strict` 退出码 | 含义 |
|---|---|---|---|
| `VERIFIED` | 0 | 0 | 真实模型端到端旅程跑通 |
| `FAILED` | 1 | 1 | 跑过了，但旅程失败 |
| `BLOCKED` | 0 | **2** | **根本没跑**（缺密钥），不构成任何能力证据 |

`status` 取值来自 `scripts/verify-real-model-journey.mjs:76`（BLOCKED）、`:318`（VERIFIED）、`:347`（FAILED）。

**为什么默认是 0**：`:15` 的原始注释显式选择——*「未配置密钥时：如实写出 BLOCKED 证据并以 0 退出——不伪造成功，也不假装跑过」*。这是**有意**的决定，不是疏忽，且有历史运行记录依赖它。

`--strict` 的加入（2026-10-02）**不改变默认行为**：`result.json` / `run.log` / stdout 在不带该参数时与改动前**逐字节相同**（SHA-256 已实测比对，见该次提交的验证记录）。`--strict` 只做一件事——让 BLOCKED 的退出码变成 2，使 CI 与 agent 能把它读成「没跑」。

**当前实际用哪个**：该门**未接入 CI**，也不被任何仓内自动化消费（`grep real-model .github/workflows/*.yml` → 0 命中）。所以今天两种退出码都不会破坏任何东西——这也是能安全加 `--strict` 而不改默认的原因。

## 术语映射语义更正（2026-10-02）

独立复核确认 `docs/term-map.md` 初版存在**证据语义错误**：生成器只做字符串边界匹配，
把模板字符串里的英文词、注释、JS 内建方法名都算成了领域映射。已修复并降级统计口径：

| | 初版 | 更正后 |
|---|---|---|
| 标为「已验证」 | 58 | **27 声明 + 5 局部同名 + 10 引用 + 1 仅测试** |
| 完全无匹配 | 30 | **45** |

两处已确认的误报：`Scene` 曾指向 `chapter.ts` 的 Markdown 模板字符串（真声明在
`kernel-schema.ts:191`）；`切片 Slice` 曾指向 `prose.slice(0,20)` 内建方法。

修复内容：匹配前剥离行注释、块注释与所有字符串字面量；「声明」必须**带 export**；
非导出的同名声明降级为「局部同名」。并新增 `pnpm gen:term-map --self-test`，
含 2 个正例与 4 个反例（Scene 必须解析到 kernel 声明；slice/issue/ticket/contract
不得被判为导出声明），由 `check:term-map` 每次运行，作为回归防线。

> **58 不能被解读为 58 个可靠领域映射**；只有「声明」一栏才是领域证据。

## 已知缺口（不假装已解决）

**退出码在全仓不统一。** 同一种「失败」在不同脚本里可能是 1 也可能是 2，没有共同语义：

| 值 | 谁在用 |
|---|---|
| 0 | 通过 / 也表示 BLOCKED（`verify-real-model-journey`） |
| 1 | `verify-glossary`、部分 measure-draft-context、`run-real-model-tests` 的失败分支 |
| 2 | `audit-unreferenced`、`verify-real-novel-journey`、measure-draft-context 的多数分支、`--strict` 下的 BLOCKED |

本文件**记录现状**而不是假装已统一。统一退出码是一次独立的、需要逐个脚本确认调用方的改动，不在本轮范围内。

## 相关

- 术语规则见 [`GLOSSARY.md`](../GLOSSARY.md)；本文件只讲门，不定义术语。
- 决策记录见 [`docs/adr/INDEX.md`](./adr/INDEX.md)。
- CI 里文档门的实际位置：`.github/workflows/ci.yml` 的 `Doc gates` 步骤。
---

## 实测基线（2026-10-02）

| 项 | 实测值 | 出处 |
|---|---|---|
| 包层测试 | **以 `pnpm run test:packages` 实测为准**（2026-10-10 实测：并行段 119 文件 / 1066 例 + 独占台架段 1 文件 / 3 例，全部通过；原记 103 文件 / 910 例已过期） | `pnpm run test:packages` 实跑 |
| 覆盖率 | **未启用**。`vitest.config.ts` 已配好 coverage 段，但 `@vitest/coverage-v8` 未安装，
| 直接 `--coverage` 会报 MISSING DEPENDENCY | `pnpm run coverage:check` |
| 克隆检测 | **已实跑验证**（2026-10-10）：总重复 15.8% < 阈值 17%（`.jscpd.json`），exit 0；把阈值临时调到 0.01 时 exit 1 并报 `found too many duplicates`，证明该门会拦。命令走 `npx --yes jscpd@3.5.10`（需现场下载 jscpd） | `.jscpd.json` |
| | 覆盖率阈值 | **刻意未设** —— DSH 的「逐文件 100%」按其 §七 判断不适用于本仓；阈值须由人看过真实数字后再定 |

> 启用覆盖率需要 `pnpm add -D @vitest/coverage-v8`。本仓库**刻意未擅自添加该依赖**：
> 它会改动 `pnpm-lock.yaml` 并引入供应链变更，需显式授权。

## 门清单已知缺口（可见，不阻塞）

> 本节标题与本文件上方既有的「已知缺口（不假装已解决）」是两个不同的小节：
> 后者记录**退出码语义现状**，是本轮之前就有的内容；本节只记录**门清单自身没覆盖到的路径**。
> `check:gates` 的 GAP 输出逐字指向本节标题，改名时必须同步改
> `scripts/verify-gates-contract.mjs` 里的指引文案，否则引用会指向不存在的小节。
>
> 本节由 `check:gates`（`scripts/verify-gates-contract.mjs` 检查 6/7）在每次运行时同步打印，
> 目的是让「清单声称覆盖了全部门」这句话不再靠自觉。下列条目中，**第 1 条已于 2026-10-10 关闭**，
> 第 2、3 条是**真实存在的缺口**；门把它们打印为 `GAP` 而不是悄悄放过，门默认不因此变红，
> 因为它们是存量问题，一次全量阻断只会让门常红而无人处理。**谁该修、修前要什么授权，写在每条下面。**

1. **[已关闭 2026-10-10] `scripts/build-release.mjs` 产出的交付物没有来源戳。**
   该脚本是 `package.json` 的 `build:release` / `package`，也是 `.github/workflows/release.yml:149`
   「Build truthful release assets」的实际执行者；它产出三个 tar 归档
   （`build-release.mjs:163-181`）。
   **修复**：`build-release.mjs` 现复用既有的 `scripts/release/lib/source-stamp.mjs`
   （`readSourceStamp`），把戳写入 bundle 目录的 `BUILD-STAMP.json`
   （`build-release.mjs:100`），字段与 `scripts/release/windows/build.mjs` 完全一致
   （`sourceCommit` / `sourceCommitSha` / `dirty` / `dirtyFiles`）；该文件随
   local-runtime 与 docker 两个 tar 归档一起分发。脏工作区会得到 `-dirty` 后缀与脏文件数。
   `check:gates` 检查 6 因此从 `GAP` 变为「全部交付物入口都有来源戳引用」。
   **未变的部分**：`build-release.mjs` 的 `web-dist` 归档直接打包 `apps/web/dist`，
   不含此戳文件；本条的关闭只覆盖带 bundle 目录的两个归档，不改变 web-dist 归档的内容。

2. **`scripts/check-import-cycles.mjs` 在本清单之外。**
   它由 `.github/workflows/graph-gate.yml:43-44` 在 CI 中执行（退出码 0 无环 / 1 有环 / 2 用法错，
   定义见 `scripts/check-import-cycles.mjs:151`、`:158`、`:102`），但**既不在本清单，也不在
   `package.json` 的任何 script**，因此本地无法用 `pnpm run` 复现这条 CI 门。
   **本轮刻意未把它并入本清单表**：并表会改动既有章节的表格结构，且需要先确认
   `graph-gate.yml` 是否有独立退出码语义约定（0/1/2 与本文件「退出码未统一」的已知缺口相关）。
   谁该修：门清单的维护者，与退出码统一那一次独立变更一并处理。

3. **`scripts/release/real-model-gate.mjs` 的 0/1/2 契约在本清单之外。**
   它由 `.github/workflows/release.yml:76` 执行，是发布路径上唯一的真实模型门；
   退出码契约写在脚本头部 `real-model-gate.mjs:21`（`0 VERIFIED · 1 FAILED · 2 BLOCKED`），
   实现见 `:118`（`const exitCode = 2`）、`:121`（`status: 'BLOCKED'`）、`:208`。
   本文件「`verify:real-model` 的完整契约」一节只覆盖 `scripts/verify-real-model-journey.mjs`，
   **没有覆盖这个发布路径包装层**，而两者的 BLOCKED 语义恰好相反（前者默认 0，后者必须非 0）。
   **本轮刻意未补写该契约小节**：该门只在 `release.yml` 消费、不在 `ci.yml`，
   写它的退出码表需要先确认凭据缺失时的托管行为，属独立变更。
   谁该修：门清单维护者，与发布路径的真实模型门一起登记。

### 开关 `--strict-gaps`

`check:gates` 默认把上面这类缺口打印为 `GAP` 而不阻断。加 `--strict-gaps` 会把缺口升级为阻断项（exit 1）。

- **默认关闭**，且**只能收紧、不能放宽**：它只把 `GAP` 提升为 `problems`，
  没有任何「开了开关就少报几项」的分支。
- **本仓库没有任何 CI 或 pnpm script 使用它**（`Select-String -Path .github/workflows/*.yml,package.json -Pattern 'strict-gaps'` → 0 命中，2026-10-10 实跑）。
  现状下 CI 行为与本节引入前完全一致。
- 开关存在的理由只有一个：让「缺口检测逻辑真的能触发」可以被实跑证明。
  **本轮的五门验收一律用默认模式**，strict 模式只用于正例演示，不作为验收依据。
- 想开启它的人需要先知道：开启即意味着仍开放的缺口（第 2、3 条）会立刻让 CI 变红，
  必须先补齐缺口（或把它们降级为已解决）再开。
