# CHG-20261010-13 第十一轮复核点算收口（文档数字与指代清账）

> 触发：第十一轮独立对抗复核（verdict `release`，连续第八次；本轮要求证伪上一批文档修正、点算上一轮列出的残余未核实项、并首次复核 `packages/kernel` 与前端 React 逻辑）报出的结果。基线 HEAD `519e65c` → `140fbd5`。

## 1. 本轮的两个结果

**（a）上一批 9 处文档修正全部成立，证伪失败。** 复核员逐条读码核实：验签确实无条件 fail-closed（`wechat.ts:94-98` / `alipay.ts:63-66`，`grep NODE_ENV apps/web/server/billing/` 仅命中测试文件）；duplication 确已接入 CI（`graph-gate.yml:54-73`，push 到 master/main 与 PR 均触发）；flywheel 三条路由确实可达（`routePolicies.ts:121-123` 标 `book` 作用域，README 未声称免鉴权）；`VIEW_IDS` 实算 23、`CAPABILITY_SQUARE_GROUPS` 恰 17；`InkBackground.tsx` 不存在、src 内无 WebGL；导出数 8/29/13 复算一致。

**（b）点算残余项时成功证伪两处，另发现三处「改完仍不一致」。** 已全部清账（7 处、7 个文件）：

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| 1 | `packages/pipeline/README.md:23` | 称「194 个具名导出」 | 实测 **204**，改为带口径与日期的实测值 |
| 2 | `packages/quality-engine/README.md:22` | 称「67 个具名导出」 | 实测 **78**，同上（同口径下 flywheel 的 159 精确命中，证明口径本身没问题） |
| 3 | `README.md`（根）`src-tauri/` 行 | 称「<15MB 体积，<40MB 内存」 | **本仓自己认定不可达的原始指标**：`CHG-20261006-14:25-26` 写明二者「客观物理互斥」——自带 `node.exe` 单文件即 80MB，安装包必然超 15MB；空闲 RAM 为 65~85MB。改为如实描述并指向该记录（Tauri exe 单独实测 8.44MB，`<15MB` 对它成立） |
| 4 | `apps/web/README.md:22` | 称「src 约 3.6 万 / server 约 2.8 万行」 | 两种口径都对不上：含测试 `src` 39,040 / `server` 40,860；去测试 `src` 27,550 / `server` 18,197。改为带口径的实测值 |
| 5 | `packages/runtime/README.md:9` | 上一轮把数字改对了（13 条 `export * from`）但**指代仍错**——写成「`src/recipe/` 其余 13 条」 | 实际 13 是 `src/index.ts` 总数、`src/recipe/` 只贡献 3 条；已改对指代 |
| 6 | `docs/adr/CODE-DUPLICATION-INVENTORY.md:119` | 小节标题仍写「B. `NODE_ENV` 缺失导致验签降级——已核实」，与上一轮已更新的正文（「该行为已不存在」）自相矛盾 | 标题改为「曾导致…——已关闭（R2 修复后不存在），边界仍要说清」 |
| 7 | `apps/web/MOBILE_UI_BRIEF.md:11` | 「前端技术栈」以现在时列着「原生 WebGL 着色器」 | 拆成两行：技术栈只列真实存在的；WebGL 单列为「目标（尚未实现，勿当作现状）」并注明 src 内无 WebGL |

## 2. 复核员对未覆盖面的新发现（全部为低且实际不可达）

- `packages/kernel/src/protection.ts:matchStaleDependencies` 排序比较器非反对称（`id` 相同、`kind` 不同时返回 0）——因 `id` 带类型前缀而**不可达**。
- `packages/kernel/src/ulid.ts:newUlid` 溢出分支 `time += 1` 后不更新 `lastTime`，理论上破坏同进程单调性——需单毫秒 2^80 次递增，**不可达**。
- `apps/web/src/**/WebSearchView.tsx:39` 复制后 `setTimeout` 无清理、`:22` 搜索无竞态防护（快速重复提交可被旧响应覆盖）——React 18 下无害。
- **明说未发现高/中缺陷**：`packages/kernel/**`（schema / 品牌类型 / 不变量 / compaction / entity-directory / ULID）逐读未见真缺陷；`packages/benchmark`（dist 未入库、被 flywheel 三模块依赖，非死代码）、`scripts/corpus`、`scripts/embedding-calib`（只写 `docs/research/*.md` 报告，无脏写仓库）均未见问题。

## 3. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0：包层并行段 119 文件 / **1066 例** + 独占台架段 3 例 + web 段 **1299 例**（15 skipped） |
| `pnpm build` / `pnpm lint` | exit 0 |
| `node scripts/check-import-cycles.mjs` | `PASS 595 模块 / 1703 边 / 0 依赖环` |
| `pnpm graph:check` | `cycleCount: 0` |
| `pnpm run check:readmes` / `check:gates` / `check:glossary` | 全部 exit 0 |
| 干净 HEAD（`140fbd5`）副本上的五个文档门 | architecture / term-map **FRESH**，glossary / gates / readmes **0** |
| 数字复测（主会话自己做，不采信转述） | 具名导出 `flywheel 159 / pipeline 204 / quality-engine 78`；行数含测试 `src 39,040 / server 40,860`、去测试 `src 27,550 / server 18,197` |

## 4. 收敛判断（本轮结论）

复核员在其报告末尾**主动给出收敛建议**，原文：

> 「边际收益判断：已很低。前十轮已从 13 项阻断收敛到「零代码缺陷」，本轮我又一次证伪失败——九处修正全部成立，新扫的三个未覆盖面（kernel/评测脚本/web 状态机）只捞到不可达理论项与文档数字。继续加轮次预计只能产出文档措辞级发现；建议把剩余文档数字（pipeline/quality-engine/Tauri 内存/WebGL）一次性清账后**转入收敛**，把资源移到真实运行时路径（真模型、act CI、安装器签名）而非再开对抗轮。」

它点名的四类文档数字**已在本提交一次性清账**。其「转入收敛」的判断与本会话的独立证据一致：连续八轮 `release`、最后两轮的全部发现都是文档陈旧声称、本轮新覆盖的三个面只捞到不可达理论项。

**因此本会话的对抗轮次到此收敛**，不再新开轮次。剩下的都属**需要用户或环境才能推进**的项（见 §5），而非可由再一轮复核消除的缺陷。

## 5. 仍未修 / 未验证（如实，全部需要用户或环境）

- **`#99` 真模型路径**：本机无任何 API key（`MOZHOU_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`），验收要求实跑记录——不拿 mock 冒充。
- **未推送**：act 本地 CI 门未跑（需 Docker 与推送决定）；`.gitnexus/` 索引不入库。
- **安装器未签名**：需代码签名证书。
- **真实 Supabase 未连**：生产改密路径的修复需接口变更（让 `confirmPasswordReset` 返回 `userId`），且无法本地验证。
- **Tauri 桌面入口未编译运行**（不在发行产物内）。
- **4 个 moderate 依赖漏洞未修**（`fast-uri` / `brace-expansion` ×2 / `sprintf-js`）；0 high / 0 critical。
- **根 README 的内存数字未实测**：判 `<40MB` 为假的依据是本仓自己的 `CHG-20261006-14`（自证），本次未重新实测内存。
- 产品决定类：真实生成路径未接配额；`listUserBooks` 是无调用方死代码；被拒绝的预留仍停留 `reserved`；文档数字无自动校验。
- 一处未复现的偶发（`quota.test.ts:110`，主会话 9 次未复现）。

## 6. 并发说明（精确暂存）

`README.md`（根）被并行会话改过 4 行术语，故从 `HEAD:` 版本出发只替换 Tauri 那一行，经 `git hash-object -w` + `git update-index --cacheinfo` 入索引；`git diff --cached` 中他人术语改动行数 **0**。其余 6 个文件动手前干净。生成物无需刷新（本批只改 `.md`）。

## 7. 回滚

`git revert 140fbd5`。回滚后上述 7 处会恢复为陈旧/错误表述，其中根 README 会重新出现本仓自己认定不可达的「<40MB 内存」声称。
