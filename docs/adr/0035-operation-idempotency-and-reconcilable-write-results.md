---
status: accepted
date: 2026-10-03
description: 'W3 操作幂等与写入结果可对账：操作身份契约（operationId）、结果记录落点与恢复单元、journalVersion 2 迁移与旧程序拒写、应用共享 DTO 落点；含两处对规划示例的有意偏离'
tags:
  - mozhou
---

# 0035. 操作幂等与写入结果可对账（W3 Contract Delta）

- **状态**：Accepted
- **日期**：2026-10-03
- **来源**：[墨舟架构规划与分阶段执行方案](../../docs/plans/2026-10-03-gitnexus-plan-mozhou-architecture-release.md) §7 W3 + §6.4
- **前置**：ADR-0024（章节生产管线事务化编排）· ADR-K-0006（本地数据平面：canon 文件与 SQLite 投影）· ADR-0010（外部编辑对账与双平面同步）

## Context

保存（POST /api/chapter.prose.save）与提交（POST /api/chapter.commit）此前的**唯一冲突防线是 CAS**：请求必须带 expectedRevision（save 可为 null 表示仅新建），服务端与盘上 revision 比对（不等则 409 PROSE_REVISION_CONFLICT），另加写前哈希（PROSE_EXTERNAL_CHANGE）与相位守卫（CHAPTER_COMMITTED）。

这套防线能防"用旧版本覆盖新内容"，但**防不了"我的这次请求到底有没有成功"**：响应在网络上丢失、进程重启、客户端超时重试时，服务端无法凭请求本身判断"这是同一个意图的重试"还是"一次新的意图"。规划 §8 的 IDEM-01 / IDEM-02 / IDEM-03 三条验收（响应丢失后同 ID 重试返回原结果、同 ID 不同内容必须拒绝、成功后又被编辑再重试要区分历史结果与当前版本）**在既有协议下不可做**。

规划 §6.4 给出了操作身份契约的设计意图，但**没有落到本仓库的具体路径与格式**：结果记录放哪里、与 pending-commit journal 什么关系、日志格式怎么迁移、共享 DTO 放哪个目录——都需要在本仓库既有布局（ADR-K-0006 / layout.ts）与既有边界约束（规划 §3.2 / §6.6）下做出可执行的裁决。

## Decision

### D1 操作身份契约（冻结）

新增客户端生成的操作标识 operationId；服务端计算**规范化请求摘要**，按 (principalId, bookId, operationType, operationId) **四元组**作用域定位操作：

- **同 ID 同摘要** → 返回**原操作结果**（不重复变更正文/版本/事件），响应带 replayed 标记；
- **同 ID 不同摘要** → 409 OPERATION_ID_REUSED，零盘上变更；
- **同 ID 但主体/书/操作类型不匹配** → 按 not_found 同形返回（不暴露"存在但不属于你"）；
- **作用域判定必须先于摘要判定**（先判"是不是你的操作"，再判"是不是同一个意图"）。

契约形状（OperationKey / SaveDraftCommand / OperationStatus 判别联合 / 错误码清单）冻结在 evidence/w3-operations/w3-locator-and-contract.md §C。

### D2 结果记录落点与恢复单元

- **落点**：书内运行时区 **.mozhou/operations/<sha256(operationId)>.json**（一操作一文件）。layout.ts 新增常量 RUNTIME_OPERATIONS_DIR，与既有 RUNTIME_RECONCILIATIONS_DIR / RUNTIME_PROPOSALS_DIR 并列；目录**懒创建**。文件名用 sha256 而非裸 operationId，杜绝路径穿越与 NTFS 大小写折叠。
- **与 journal 的关系**：操作身份写进 **pending-commit journal（journalVersion 2）的 operation 字段**，结果文件写在**线性化点（正文相位翻转）之后、删除 journal 之前**。前滚恢复**幂等补写**结果文件；回滚恢复**不写**（事务从未提交）。
- 由此同时满足规划 §6.4.4 的两条：不存在"操作记录说成功、正文却没提交"，也不存在"正文提交了、请求身份却丢了"。
- 结果记录不进入对账面（.mozhou/ 下路径由 isCanonRelPath 判为非 canon），不污染 manifest 基线。

### D3 journal 版本迁移

- **journalVersion 2 成为合法格式**（v2 携带 operation 记录，其余字段与 v1 一致）。
- **读端接受 1 与 2**：v1 走 legacy 恢复路径，不做去重（v1 时代的请求本来就没有 operationId）。
- **写端后置**：只有 v2 读端上线后才开始写 v2（先上读端、再上写端）。
- **旧程序遇 v2 必须拒写**：既有 assertJournalShape 的版本守卫（journalVersion 不等于 1 即抛 PendingCommitConflictError）使旧二进制在读到 v2 journal 时**拒绝打开该书**并保留 journal 与原件——这是**刻意的 fail-closed**，不是缺陷。运维含义：v2 journal 需要 v2 二进制才能恢复，回退到旧二进制时该书会被拒开。

### D4 应用共享 DTO 落点

- **新建 apps/web/shared/**，W3 契约落 operations.ts（类型 + OPERATION_SCHEMA_VERSION）与 operations.schema.ts（运行时校验，browser-safe、零 node 与 server 依赖）。
- **不复用 apps/web/server/api.ts**：规划 §6.6 禁止 UI 到 server 依赖，而该文件正是 UI 当前 type-only import 的对象（全仓 51 处）。把新契约放进它，等于**在已被规划禁止的依赖方向上新建代码**。
- **不新建全局 contracts 包**：规划 §3.2 明确"不为两份 DTO 新建全局 contracts 包"，故落在 app 内。
- 既有 51 处 type-only 的 UI 到 server import **不在本 ADR 处理范围**，归 W5（接口防护）。

### D5 两处对规划示例的有意偏离（需明确记录，避免后人以为写错）

| 规划 §6.4 示例 | 本仓库采用 | 理由 |
|---|---|---|
| SaveDraftCommand 用 **chapterId** | **chapterIndex**（整数） | 全仓章标识一律是 chapterIndex（proseChapterPath / saveProseDraft / commitChapter / UI 契约）。引入 chapterId 会造出**第二套章标识**，与规划 §6.1"每类资源一个权威所有者"冲突 |
| SaveDraftCommand 含 **expectedSourceHash** | **不放**进命令；写前哈希仍由服务端 assertPreWriteHash 对 manifest 基线做 | 客户端从来拿不到基线 hash（/api/chapter.prose 只回 revision 与 body），要求它填就是伪契约。CAS 锚点仍是 expectedRevision；外部改盘由既有 PROSE_EXTERNAL_CHANGE 路径拒绝 |

### D6 摘要规范化的一处硬约束

请求摘要必须对**与写入器一致的规范化正文**计算（写入器会给正文补末尾换行）。若对补齐前的字符串计算，"少一个末尾换行"的重试会被判成**不同意图**并返回 OPERATION_ID_REUSED——**幂等直接失效**。规范化应提取为单一函数由写入器与摘要计算共用。

## Consequences

- IDEM-01 / IDEM-02 / IDEM-03 从"不可做"变为"可做"，且已有实现与用例覆盖（data-plane 与路由两级）。
- 新增一个持久化面（.mozhou/operations/）与一个日志格式版本（journalVersion 2）；**代价是引入格式迁移**，收益是崩溃窗口内"意图—身份—结果"三者原子。
- 旧客户端（不带 operationId）行为**完全不变**，但**明确不承诺跨重启去重**——发布说明与 API 文档必须写明。
- 存在性枚举面（他人 operationId 返回 404 与全新 ID 返回 200 可区分）作为**已声明限制**保留：冻结契约 §C.4 如此规定，且契约实质意图（不泄露他人**结果数据**）已满足（三个结果字段均不出现）。
- .mozhou/operations 不可写会导致该书打不开——这是刻意 fail-closed，运维前提是先修复文件系统（权限/占用/磁盘）。

## 与既有 ADR 的关系

- **对 ADR-0024 是补充，不 supersede**：0024 的"Commit 是唯一正典写入点""恢复=按步边界检查点重跑"等决策全部不变；本 ADR 只是在提交事务里增加了操作身份与结果记录，并把 journal 版本推进到 2。
- **对 ADR-K-0006 是补充**：K-0006 确立的 canon 文件 + SQLite 投影双存储不变；本 ADR 在其运行时区（.mozhou/）下新增一个非 canon 目录。
- **与 ADR-0010 不冲突**：外部编辑对账（EXTERNAL_MODIFIED 五态）与写前哈希的既有语义未变。
- 未发现与任何既有 ADR 的决策冲突，故本 ADR **不 supersede 任何既有条目**。

## 挂账与未验证（不得当作已保障）

- **旧程序遇 v2 journal 拒写**：仅**源码阅读证据**（assertJournalShape 的版本守卫），**未搭回退实验验证**。
- **hosted 跨主体作用域拒绝未端到端**：hosted 模式按主体隔离书根，该路径不可达；local 多主体共用 dataRoot 的作用域拒绝已由 data-plane 与路由两级用例覆盖。
- **保存路径是否引入 journal**：本 ADR 的记录按"提交路径"落地；草稿保存的原子性范围以 W3 实施报告为准。**（2026-10-05 已关闭：见 [docs/archive/2026-10/w3-operations-implementation-report-2026-10-05.md](../archive/2026-10/w3-operations-implementation-report-2026-10-05.md)——保存路径已引入轻量 v2 journal（单空载荷 events 目标），线性化点为正文原子替换，恢复机制与提交路径共用；残余未验证项见该报告 §4.3。）**
- **开销**：实测为**下界证据**（data-plane 级、不含 HTTP/UI/commit），p95 差值属噪声主导；有信息量的是 p50 增量约 3.6ms。
- **清理策略**：初版不做自动清理（沿用规划 §6.4.5），仅提供 countOperationRecords 观测口径；触发压缩的条件（单书超过约 1 万条 / 目录超过约 50MB / 出现保留期需求）需后续卡确认。
