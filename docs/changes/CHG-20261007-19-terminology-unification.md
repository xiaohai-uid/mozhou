# CHG-20261007-19 — 术语统一：活跃层清扫 + GLOSSARY 词条缺口与门禁补全

- **日期**：2026-10-07
- **执行人**：ZCode 主会话（DSH）
- **分支**：`feature/windows-local-release`（工作区含并行会话未提交改动，见「范围」）

## 1. 需求来源

用户 2026-10-07 指令：`/domain-modeling 统一一下它的术语就是这个文件夹里面这个小说项目的术语`。
用户随后就两个分叉点选定：

1. **历史档案层** → 不改写，只登记（`docs/adr/`、`docs/changes/` 是已定稿决策与变更证据，改写等于篡改记录）。
2. **统一深度** → 全面统一：活跃层用词 + 补 GLOSSARY 词条缺口并修掉过时/自相矛盾的账 + 把 Part 3 禁用词接进 `check:glossary` 防回潮。

## 2. 观察基线（2026-10-07 实测）

- 术语权威 `GLOSSARY.md` 90 词条；`docs/term-map.md`（生成物）90 行；仓库单语境，无 `GLOSSARY-MAP.md`。
- **缺陷 A —— 词条缺口**：`数据面 (Data Plane)` 是全仓核心存储层概念（`@mozhou/data-plane` 包、界面文案、六十五处以上中文用法），但 **Part 1 没有词条**；Part 3 只有一行读写自相矛盾的登记（禁用词列与规范词列都写"数据面"）。活跃层同时混用变体「数据平面」。
- **缺陷 B —— 账过时**：`闸门` 条声称"现存 4 处"并点名 `packages/context-compiler/src/compile.ts:30` 的"硬隔离闸"；实测该处已于 2026-10-05 改为"硬隔离门"，实际残留位置与数量均不同。
- **缺陷 C —— 自相矛盾**：`工单 (Ticket)` 登记为"即议题 (Issue)"，而同一节 `议题 (Issue)` 的 `_Avoid_` 行又把「工单」列为禁用。同一条规则既允许又禁止。
- **缺陷 D —— 门缺口**：`scripts/verify-glossary.mjs` 只校验词条结构、已退役 `CONTEXT` 文件的残留引用、裸 ADR 预算、`AGENTS.md` 流程块与 ADR 文件名，**完全不校验 Part 3 禁用词**，故存量违规无法阻止回潮。
- **缺陷 E —— 冻结层与活跃层混算**：`AGENTS.md` 并不含「门」（GLOSSARY 注 5 的"`AGENTS.md` 章节同用"为过时陈述）；违规主体在历史档案。

## 3. 目标行为

1. 活跃层（仍在被引用、改了不篡改历史的那一层）用词一律符合 `GLOSSARY.md` Part 3。
2. `GLOSSARY.md` 补上 `数据面 (Data Plane)` 词条，修掉过时计数、自相矛盾与残缺表格行，并把"冻结层不追改"确立为显式规则。
3. `check:glossary` 能实际拒绝 Part 3 禁用词，且不误伤冻结档案、生成物与小说语料。

## 4. 范围

- **改动**：`GLOSSARY.md`、`docs/term-map.md`（再生）、`docs/gates.md`、`README.md`、`packages/*/README.md`、`packages/**/*.ts`（仅注释与测试标题）、`apps/web/**`（注释与界面文案）、`apps/web/prototypes/**`、`scripts/**`、`.github/workflows/ci.yml`、`eslint.config.js`、`docker/init/01-init.sql`。
- **不改**：`docs/adr/`、`docs/changes/`（既有）、`docs/specs/`、`docs/handoff/`、`docs/audit/`、`docs/research/`、`docs/spikes/`、`audit-2026-10-03/`、`handoff-results/`、`.scratch/`、根级历史审计报告、`apps/web/src/code-graph/codeGraphData.*`（生成物）。
- **零触碰**：并行会话的未提交改动（`PROJECT-MAP.md` 第 396 行追记、`docs/changes/CHG-20261006-17-*.md`）原样保留；全程未执行任何 git 写操作。
- **非目标**：不改产品行为、类型、契约、依赖拓扑；不重命名任何标识符或文件名（`docs/gates.md` 文件名与 `check:gates` 脚本名保持英文不变）。

## 5. 实际变更

### 5.1 GLOSSARY.md（词条与账）

| 位置 | 变更 |
|---|---|
| §0 使用规则 | 新增规则 6：冻结的历史档案与生成物不追改，只登记 |
| §1.2 | **新增词条 `数据面 (Data Plane)`**（91 词条），`_Avoid_: 数据平面、storage layer、database、后端存储` |
| §2.1 `工单 (Ticket)` | 改为"**已废弃中文俗称**，即议题"，`_Avoid_: 全部`；§2.1 `地图` 条去掉"子议题为工单" |
| §2.2 `闸门` | 删去过时的 `compile.ts:30` 点名与"现存 4 处"，改为指向 Part 3 注记 2 |
| §2.3 `切片 (Slice)` | 从"必须写全纵切"改为：文本/状态片段必须带限定词，UVSD 交付单元一律写全"纵切"（依据：全仓 `正文切片`/`质量切片` 是合法技术义，原规则会产生上百处误报） |
| §2.3 `任务简报` | `_Avoid_` 去掉与议题权威冲突的 `issue` |
| Part 3 表 | 修 `数据面` 残缺行 → `数据平面 → 数据面 Data Plane`；`任务/任务简报 → 议题 Issue`；新增 `工单 → 议题 Issue` 行；`收据/切片` 两行加限定词 |
| Part 3 注记 2/3/5 | 注 2 改为实测的 11 处并逐文件列出；注 3 去掉已废弃的"工单"措辞；注 5 重写为本轮清扫范围与剩余冻结存量 |

### 5.2 活跃层用词清扫（39 文件、约 80 行）

| 规则 | 处数 | 文件数 | 说明 |
|---|---:|---:|---|
| `数据平面` → `数据面` | 24 | 16 | 含界面文案 `apps/web/src/shell/TopBar.tsx:83`、`capability-square/capabilityDetails.ts:21` |
| `门禁` → `门（+限定词）` | 4 | 3 | `scripts/verify-glossary.mjs`、`scripts/release/release-verify.mjs`、`packages/data-plane/src/compaction.ts` + `.test.ts` |
| `门禁` → `门`（文档/脚本/CI） | ~30 | 12 | `README.md`、`docs/gates.md`（含 H1 改「门清单与退出码」）、`scripts/verify-gates-contract.mjs`、`eslint.config.js`、`.github/workflows/ci.yml` 等 |
| 裸 `收据` → `上下文收据` | 6 | 4 | `packages/context-compiler/README.md`、`apps/web/src/draftStream.ts`（含界面文案）、`scripts/verify-mock-journey.mjs` |
| `工单 NN` → 深化 NN / 去悬空指代 | 3 | 3 | `scripts/verify-real-model-journey.mjs`、`verify-real-novel-journey.mjs`、`eslint.config.js`、`docker/init/01-init.sql` |

### 5.3 门禁补全

`scripts/verify-glossary.mjs` 新增第 7 段：对 Part 3 八个禁用词（门禁/闸门/工单/数据平面/熔核/遗留切片/任务简报/裸"收据"）扫描**显式白名单内的活跃层**（8 个目录前缀 + 5 个单文件），带三处显式豁免：

- `GLOSSARY.md`、`docs/term-map.md`、`scripts/verify-glossary.mjs` —— 登记/检测该词本身的三个文件；
- `apps/web/src/code-graph/` —— 生成物，随生成器刷新；
- `scripts/corpus/` —— `'不存在的工单'` 是小说语料里的章标题，不是术语；
- `AGENTS.md|遗留切片` —— 引用已废止名称做更正说明，不是使用它。

## 6. 验收（全部实跑，带退出码）

| 检查 | 命令 | 结果 |
|---|---|---|
| 术语权威门 | `pnpm run check:glossary` | **PASS**，91 词条全部有 `_Avoid_`；活跃层禁用词 **0** 处 |
| 门清单防腐化 | `pnpm run check:gates` | **PASS**（12 个 `pnpm run` 门、11 个脚本路径、铁律在场） |
| 映射表新鲜度 | `pnpm run check:term-map` | **SELF-TEST PASS + FRESH**（91 词条） |
| 包 README | `pnpm run check:readmes` | **PASS** 9/9 |
| 包层测试 | `pnpm run test:packages` | **exit 0**，117 文件 / 1048 用例全通过 |
| Web 层测试 | `pnpm test`（web 段） | **exit 0**，150 文件通过 / 1 跳过，1104 用例通过 / 15 跳过 |
| Lint | `pnpm run lint`（`eslint .`） | **exit 0**，零告警零错误 |
| 图谱环检查 | `pnpm run graph:check` | `{"status":"clean","cycleCount":0,"cycles":[]}` |
| 变更映射 | `node .gitnexus/run.cjs detect-changes -r . --scope all` | 39 文件 / 82 符号 / 522 流程，**risk_level: critical** —— 见「风险」 |

**未通过项（既有，非本轮引入）**：`pnpm run check:architecture` 报 **STALE**。已定位到具体成因：已提交的 `docs/architecture.md` 记 `packages/data-plane` **57 文件 / 15059 行**，而生成器现在算得 **58 文件 / 15073 行**（净 +1 文件 / +14 行）。核实事实：①`git ls-tree -r HEAD -- packages/data-plane/src` 实测 58 个源文件；②`packages/data-plane/src/projection-rebuild.ts`（**72 行**）存在于 HEAD；③CHG-20261007-18 的记录自述该文件是新建的、由 `local-data-plane.ts:72-73` 改为 re-export 把 `rebuildProjectionFromCanon` 逐字下沉。**归因（推断，非逐行核验）**：该次变更新增 72 行文件、同步下移旧实现，净增 14 行，与实测差值逐项吻合——即 CHG-20261007-18 新建了源文件但**未随变更刷新 `docs/architecture.md`**，该生成物在 HEAD 上已陈旧。**本轮未重新生成**（重新生成会把并行会话引入的文件计数混入本变更），如实登记为阻断项。

## 7. 风险与不确定项

- **图谱门禁 risk_level: critical（已披露）**。`detect-changes` 把每个改动 hunk 映射到**外层符号**，因此 `recordWholeBodyAuthorEdit`、`compaction` 等被列为"已改符号"。逐 hunk 复核：**全部改动都是中文注释、测试标题或界面文案字符串，无逻辑、签名、类型、依赖拓扑改动**。这不是"影响面被证明为零"，而是"改动面经人读确认不含可执行语义"；根因级风险由全绿的类型化 lint、267 文件 / 2152 用例测试与 clean 的依赖环检查共同背书。
- **界面文案改动**：`apps/web/src/draftStream.ts` 的 `'上下文已编译（含收据）'` → `'上下文已编译（含上下文收据）'`，`TopBar.tsx` 的 title。已核对无快照或断言依赖该字符串（`draftStream.test.ts:196` 只断言 `toContain('已编译')`；`__snapshots__/` 无命中），测试实跑通过。
- **未经真实浏览器/视觉验收**：本轮为文案与注释改动，未启动 dev server 做浏览器级确认。
- **未提交**：本轮改动全部留在工作区；提交、推送、合流均需另行授权。

## 8. 回滚方法

全部改动为文本替换，可用本轮 `git diff` 逆序还原；`docs/term-map.md` 由 `pnpm run gen:term-map` 再生，`GLOSSARY.md` 与 `scripts/verify-glossary.mjs` 为手改需人工回退。无数据、无 schema、无依赖变更。
