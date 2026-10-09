# CHG-20261008-29 保存路径 journal 崩溃恢复用例（议题 #98）

> 触发：GitHub 议题 [#98](https://github.com/xiaohai-uid/mozhou/issues/98)。基线 HEAD `0729a79`。

## 1. 需求来源

议题 #98（2026-10-05 双轴审查挂账）：`saveProseDraft` 没有故障注入接缝（对比 `commitChapter` 有 `request.onStage`）；`recovery-reentry` 的 REC-01~04 全部构造自**提交**路径；「保存形状 journal 触发 `recoverPendingCommit`」此前**没有被任何测试直接执行**。

## 2. 手段替换（说明为何没加接缝）

票据建议「给 `saveProseDraft` 加一个最小故障注入接缝」。本轮**未加接缝**，理由：`packages/data-plane/src/chapter.ts` 正被另一条工作线改动（该线已停摆约 25 小时，123 个在制文件未提交），对其做代码改动无法安全精确暂存。

改用**等价且更稳**的做法：只新增测试文件，按 `saveProseDraft` 的**真实写盘顺序**在临时书根上手工复现两个崩溃窗口的现场，再调用既有恢复入口。票据的**目标**（覆盖保存形状 journal 的崩溃恢复）达成；**手段**由「回调接缝」换为「手工构造崩溃现场」，且不依赖内部阶段名，更不易随实现漂移。

## 3. 实际变更

新增 `packages/data-plane/src/save-journal-recovery.test.ts`（2 用例）：

| 用例 | 现场 | 断言 |
|---|---|---|
| 崩溃窗口一 | journal 已落盘（`writeJournal` 之后）、正文未更新 | 恢复**回滚**：journal 移除、半份临时文件清扫、正文/版本保持崩溃前值、events 账本零字节变化、不留半份身份记录、重开平面 `verifyBaseline` 自洽、恢复幂等 |
| 崩溃窗口二 | 正文已 `atomicReplace`、收尾未完成（manifest / 操作结果 / 删 journal 未做） | 恢复**前滚**：journal 移除、操作结果补齐、manifest 与盘一致、正文/版本正确 |

**据以推导 journal 形状与写入顺序的源码位置**（写进测试文件头注，可复查）：`chapter.ts` 写 journal 1283–1292（`writeJournal` 317–319 落 `.mozhou/pending-commit.json`）、字段集 `PendingCommitJournal` 264–278、`appends` 目标形状 254–262、保存路径的空载荷 events 目标 1276–1282、顺序 journal(1283) → 正文(1295) → manifest(1296–1297) → 结果(1299–1311) → 删 journal(1312)。恢复入口 `recoverPendingCommit(root)`，`chapter.ts:546`。

## 4. 验证（主会话亲验）

| 检查 | 命令 | 结果 |
|---|---|---|
| 测试通过 | `pnpm vitest run packages/data-plane/src/save-journal-recovery.test.ts` | **2/2 通过**，exit 0 |
| **负例对照（证明会咬）** | 把 3 处 `recoverPendingCommit(bookRoot)` 临时改为空操作后重跑 | **2/2 失败**（断言 journal 未被移除等），exit 1 |
| 还原完整性 | 还原后 `sha256sum -c` | **OK**（`0e62ddc1f090155c0f2426e60dbaac4d276cbfb6ac4ea1cfb8ca4f1771bce93a`，与探针前逐字节一致） |
| 既有测试无干扰 | `pnpm vitest run packages/data-plane/src/recovery-reentry.test.ts` | 43/43 通过，exit 0 |
| 新增静态环门 | `node scripts/check-import-cycles.mjs` | `PASS 587 个模块 / 1675 条内部边，0 个依赖环`，exit 0 |

## 5. 语义澄清（本轮发现，重要）

保存形状 journal 的 `appends` **只有一个空载荷 events 目标**，因此恢复**不改写正文**：

- 窗口一是**原子回滚**——正文保持崩溃前的旧 revision（`expect(afterRecovery.revision).toBe(1)`），差异体现在 journal 与半份临时文件被清除，而**不是**正文变成新版本；
- 窗口二是**前滚补齐账务**——正文已是新版本（崩溃发生在正文替换之后），恢复补的是 manifest 与操作结果记录。

票据原措辞「注入保存中途失败后，恢复能回读出正确正文与版本」若按「恢复后正文变成新版本」读，与本仓恢复语义**冲突**；本用例按真实语义断言，**未放宽任何断言**。该语义澄清已写进测试文件注释。

## 6. 未做与未验证（如实）

- **未新增 `saveProseDraft` 的 `onStage` 接缝**（见 §2 的手段替换说明）。
- **未跑全量 vitest / typecheck / 图谱门禁**：本轮只新增一个测试文件，全量门由主会话在收口时统一跑。
- 用例覆盖的是**保存路径**的两个崩溃窗口；提交路径的 REC-01~04 由既有 `recovery-reentry.test.ts` 覆盖，两者互不替代。

## 7. 回滚

`git revert <本提交>`（删除该测试文件即可，无生产代码依赖）。
