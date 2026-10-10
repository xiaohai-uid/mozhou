# CHG-20261010-06 主会话独立清扫收口 + 生成物陈旧修复 + 墙钟台架隔离

> 触发：第四轮复核判 `release` 之后，主会话自己做了一次**不依赖子代理转述**的独立清扫（全仓裸 `writeFileSync` 扫描 + 干净 HEAD 副本上的门复跑），又查出四类问题。基线 HEAD `6502582` → `fac8a2a`。

## 1. 本批修完的项（3 个提交）

| 提交 | 内容 |
|---|---|
| `5969b45` | 5 类「裸写 / 固定 `.tmp`」收口；备份 zip 落盘改原子并**回读校验 sha256**；共享原语 `atomicWriteFileSync` 参数由 `string` 加宽为 `string \| Buffer`；主会话补上子代理遗漏的 `saveProfileSnapshot` |
| `b40f20d` | 刷新 `docs/architecture.md` 与 `docs/term-map.md`——**HEAD 自身原本过不了 CI 的 doc 门** |
| `fac8a2a` | 墙钟规格台架移出并行池，消除「50 章全弧 <5s」的假红（规格断言一字未改） |

## 2. 关键发现（全部由主会话自查得出）

| 级别 | 发现 | 后果 / 处置 |
|---|---|---|
| 中 | `apps/web/server/routes/backupRoutes.ts` 备份 zip 裸写，且对外 `sha256` 取自**内存 buffer** 而非盘上字节 | 截断时盘上是半份 zip 却以「带哈希的备份」被列出/下载，而哈希对不上文件。→ 原子落盘 + 回读校验，不一致即删文件报错 |
| 中 | `packages/data-plane/src/book-backup.ts` restore 循环每文件裸写，注释却写「原子落盘写入新目录」 | 崩溃不走 catch，留半份目录无人清理。→ 逐文件原子 + 注释改为「逐文件原子，目录整体非原子」并写明崩溃后果 |
| 中低 | `packages/flywheel/src/storage.ts` `rewriteObservations` 整表重写裸写，注释称「读侧撕裂容忍使中断安全」 | 该声称**经证过度**：行级容忍兜不住整表截断（静默丢尾行，resume 不自动补）。→ 原子化 + 注释重写 |
| 低 | `apps/web/server/memo/memoStore.ts`、`packages/context-compiler/src/receipt-file.ts`、`packages/flywheel/src/semantic/report-store.ts` 固定 `.tmp` 名 + rename | 并发写者互截（`existsSync` 预检是 TOCTOU）。→ 共享原子写，预检语义保留 |
| **中** | **`docs/architecture.md` 与 `docs/term-map.md` 在 HEAD 上就陈旧** | **HEAD 自身过不了 CI 的 doc gates**（ci.yml 的 Doc gates 步骤跑这两个检查）。此前把这条 STALE 归因给并行会话未提交改动，是**错的**——在 `git archive HEAD` 的干净副本上实跑同样 STALE |
| 中 | `packages/context-compiler/src/l1-lifecycle-bench.test.ts` 的 `expect(durationMs).toBeLessThan(5000)` 是**墙钟**断言 | 与其余 118 个文件并行时 CPU/IO 争用把它推过预算：同一提交全量跑**红**、单独跑**绿**、重跑又**绿**。→ 移出并行池、独占非并行跑 |

**归因证据（生成物陈旧）**：最后一次重生成是 `7e02bdb`（2026-10-07）。此后 `a0f4473` 新增 `projection-rebuild.ts`、`8fb9798` 新增 `save-journal-recovery.test.ts`（57→59 文件 / 25→26 测试文件），我本批的 pipeline 与 web 提交又上移了行数——**部分由本会话自己造成**，仓库没有提交时再生成的守卫（无 husky / simple-git-hooks）。

## 3. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm exec vitest run packages/data-plane/src packages/flywheel/src packages/context-compiler/src` | exit 0，50 文件 / **489 例** |
| `pnpm --filter @mozhou/web exec vitest run server/routes server/memo` | exit 0，**357 例**（13 skipped） |
| `pnpm build` / `web typecheck` / `pnpm lint` | 全部 exit 0 |
| `pnpm run test:packages`（隔离后） | 并行段 118 文件 / 1059 例 + 台架段 1 文件 / 3 例，exit 0 |
| 负例探针（台架预算改 1ms） | **红**：`AssertionError: expected 2225 to be less than 1` → 证明断言是活的、文件真被执行、没被静默跳过；还原后 `git diff` 对该文件为空 |
| 干净 HEAD 副本（`fac8a2a`）上五个文档门 | architecture FRESH / term-map FRESH / glossary 0 / gates 0 / readmes 0 —— **全过** |
| `scripts/check-import-cycles.mjs` | `PASS 594 模块 / 1694 边 / 0 依赖环` |
| `pnpm duplication`（阈值 17%） | 总重复 15.86%，exit 0 |
| `gitnexus check` | `clean / cycleCount 0` |
| `pnpm audit --registry=https://registry.npmjs.org` | 0 high / 0 critical、4 moderate（R5 结论，见 CHG-20261010-05） |
| `impact(atomicWriteFileSync)` | 186 影响 / 159 直接 / 44 流程 / 20 模块，risk **CRITICAL**——该评级来自扇出度量，**不是语义风险**：本次只加宽参数类型，对既有传字符串的调用方逐字节等价（`writeFullSync` 内 `typeof content === 'string'` 分支与改前完全相同）。索引落后 HEAD 24 个提交，扇出数仅供方向参考 |

## 4. 仍未修 / 未验证（如实）

- **hosted 模式下 restore 崩溃残留目录可见**：进程若在写完 `book.json` 之后崩溃，`listUserBooks` 会把它当有效作品列出但缺章（仅源码推断，未构造真实 kill 验证）。
- **receipt / report 的 `existsSync` 预检仍是 TOCTOU**：最终 rename 竞争未修（不发明新语义）。
- **并发写者互截只在单进程内由原语保证**：未做多进程与掉电实测。
- **4 个 moderate 依赖漏洞未修**（`fast-uri` / `brace-expansion` ×2 / `sprintf-js`）。
- **生成物没有自动再生成的守卫**：仓库无 husky / simple-git-hooks，漂移只能靠 CI 的 doc gates 兜住（红即拦）。
- **「50 章 <5s」这条规格在 `docs/` 与 ADR 里查不到出处**（ADR-0016 全文无 5s / 墙钟字样），只在测试自身注释里被称为规格。本次未改该数值，也未把它升格为文档化规格。
- **`scripts/build-release.mjs` 无来源戳**（`check:gates` 已登记的已知缺口）：该打包入口的产物无法自证来自哪个提交。`scripts/release/windows/build.mjs` 已有戳（CHG-21），此处未补。
- 沿用：安装器签名、未推送（未跑 act 本地 CI 门）、Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）、真实微信/支付宝联调、`naming` 502 真实模型路径。

## 5. 并发说明（精确暂存）

工作区含停摆工作线的 126 个未提交文件。本批提交逐文件核验夹带情况：

- `packages/context-compiler/src/receipt-file.ts` 混有对方的 1 行术语改动（`receipt 文件名合法性守卫`→`receipt 路径检查`）：从 `HEAD:` 版本出发只套本轮两处改动，经 `git hash-object -w` + `git update-index --cacheinfo` 入索引；`git diff --cached` 中他人术语行数 **0**。
- `packages/flywheel/src/evaluator/storage.ts` 的 1 行改动（`回归守卫`→`回归检查`）经核实是**对方的**，未入索引。
- 生成物刷新用「HEAD + 本轮改动」的树对象（`git write-tree` + `git archive`）作为测量环境，避免把对方的未提交改动计入包内源码行数。
- 其余文件逐个 grep 确认无夹带。

## 6. 回滚

按提交逐个 `git revert`；`fac8a2a` 三个文件必须一起回滚（只回 `package.json` 会让台架文件既被排除又无人跑）；`receipt-file.ts` 回滚需保留对方的术语改动（勿整文件 checkout）。
