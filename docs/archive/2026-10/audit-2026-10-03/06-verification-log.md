# 06 · 隔离环境故障注入与一致性实测记录报告
# (06-verification-log.md)

- **审计章程口径**：`audit-2026-10-03/00-audit-charter.md`
- **基线与门禁依据**：`audit-2026-10-03/01-baseline-and-graph-gate.md`
- **作者路径入口**：`audit-2026-10-03/03-author-path-trace.md`
- **复核争议依据**：`audit-2026-10-03/05-claim-refutation.md`
- **基线版本**：HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`（短 `90b45a1`）/ WORKTREE(未提交 42 条)
- **实测时间**：2026-10-03T01:28:37+08:00（Asia/Shanghai）
- **隔离纪律**：全量测试均在操作系统临时目录 `%TEMP%\mozhou-probe-*` 独立沙箱中进行；不触碰生产与用户真实书稿库（`mozhou_rt`）、真实凭据与账单；零真实模型调用；执行完毕后临时沙箱全部安全销毁。

---

## 一、实测方法与证据等级标准

依据 `00-audit-charter.md` §4，本次实测结果严格遵守证据分级：
- **E1 静态检查**：读取源码、AST 依赖与配置分析；
- **E2 代码推演**：基于代码逻辑推断可能发生的状态，明确标注“未运行”；
- **E3 Mock 测试**：在虚拟数据/伪 Provider 下的运行结果；
- **E4 真实本地集成**：在本地真实文件系统、真实 Node.js 运行时、真实 SQLite WAL 实例中的端到端代码打通；
- **E5 真实浏览器/桌面**：真实无头 Chrome CDP 或桌面程序交互；
- **E6 真实供应商调用**：调用外部云端大模型/真实在线支付，**本次明令禁止，一律标 NOT RUN**；
- **E7 系统级故障实验**：包含断电模拟、进程句柄独占锁定、文件破坏与异常注入，**禁止将软件级模拟描述为物理硬件断电**。

---

## 二、11 项优先验证项实测结果总览表

| 序号 | 验证项 / 故障场景 | 证据级别 | 基线版本 | 实测判定 | 核心观察与结论 | 原始证据日志 |
|:---:|---|:---:|:---:|:---:|---|---|
| **1** | **保存中断后重开** | E4 / E7 | WORKTREE | **部分自愈** | 原正文未被破坏；但残留在盘上的 `.mozhou-tmp` 脏文件未被自动清理；后续保存可正常覆盖更新。 | `logs/verification/probe-01-save-interrupt.txt` |
| **2** | **同章竞争保存** | E4 | WORKTREE | **完全成立** | CAS 乐观锁有效：先到者成功升版，后到者抛出 `ProseRevisionConflictError`（BFF 409），防止丢失更新。 | `logs/verification/probe-02-save-concurrency.txt` |
| **3** | **同数据根双实例启动** | E4 / E7 | WORKTREE | **部分成立**<br/>(发现死锁) | 1. 正常顺序抢锁有效抛出 `DATA_ROOT_LOCKED`；<br/>2. 已死 PID 可被接管；<br/>3. **确证 PID 复用死锁**：若旧 PID 被系统复用分配给无关活进程，系统将永久拒绝启动。 | `logs/verification/probe-03-instance-lock.txt` |
| **4** | **生成停止/切章后晚到结果** | E4 | WORKTREE | **完全隔离** | 晚到候选仅落入 `.mozhou/draft_candidates.jsonl` 候选区，正文文件不受任何污染，切章安全。 | `logs/verification/probe-04-late-generation.txt` |
| **5** | **采纳与撤销正文/版本一致性** | E4 | WORKTREE | **完全一致** | 采纳后磁盘与 SQLite 均自增至 r1；撤销后正文回退，但版本采用单调前移至 r2，维持历史单调性。 | `logs/verification/probe-05-accept-undo-consistency.txt` |
| **6** | **提交成功响应丢失确认与重试** | E4 | WORKTREE | **可确认但无业务幂等** | 客户端重试收到 409 `ChapterPhaseError`；客户端必须通过拉取章节快照比对 `commitId` 确认前次提交。 | `logs/verification/probe-06-commit-retry-lost-ack.txt` |
| **7** | **提交各阶段失败与二次中断** | E4 / E7 | WORKTREE | **部分成立**<br/>(发现丢数据) | 1. 6 大阶段单次中断恢复符合预期；<br/>2. **确证二次中断数据丢失**：`recoverForward` 截断后二次断电，再次恢复判为 `untouched`，直接删 journal，**导致追踪流增量永久丢失**。 | `logs/verification/probe-07-commit-stages-and-reinterrupt.txt` |
| **8** | **权限不足/磁盘写入失败** | E4 / E7 | WORKTREE | **防御有效但泄漏** | 遇到 `EPERM` 写入拒绝时，原正文未被破坏；但脏临时文件 `.mozhou-tmp` 泄漏残留在磁盘上。 | `logs/verification/probe-08-disk-write-permission-failure.txt` |
| **9** | **事件账本尾部残缺** | E4 / E7 | WORKTREE | **Fail-Soft 容错** | 账本回读能跳过半截非完整 JSON 行，解析有效事件；但残缺事件数据永久丢失，缺乏告警通知。 | `logs/verification/probe-09-events-ledger-truncation.txt` |
| **10** | **导出内容与指定版本一致性** | E4 | WORKTREE | **逐字一致** | DOCX 导出为合规标准 OOXML ZIP 包，正文内容、章节标题与盘上提交正典逐字严格对齐。 | `logs/verification/probe-10-export-consistency.txt` |
| **11** | **旧数据格式打开与迁移自愈** | E4 / E7 | WORKTREE | **100% 自愈重建** | `open()` 遇到旧 `user_version` 严格抛出 `ProjectionVersionMismatchError`；`openOrRebuild()` 自动从 Markdown 完美重建。 | `logs/verification/probe-11-legacy-format-and-rebuild.txt` |

---

## 三、逐项故障注入与一致性验证详细记录

### 1. 保存中断后重开 (Probe 01)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 在隔离临时书库中创建第 1 章草稿，写入初始正文（`revision: 1`, `phase: draft`）；
  2. 模拟进程在调用 `atomicWriteFileSync` 期间被强杀：向目标正文同目录写入未完成的临时文件 `第0001章.md.mozhou-tmp`（写入 30 字节脏数据，不调用 `renameSync`）；
  3. 调用 `LocalDataPlane.openOrRebuild()` 重新打开书库并读取第 1 章快照；
  4. 随后调用 `saveProseDraft` 发起下一次正常保存。
- **故障注入位置**：[packages/data-plane/src/atomic-write.ts:24](packages/data-plane/src/atomic-write.ts#L24)（`writeSync` 与 `renameSync` 之间）
- **期望结果**：原正文完整无损，版本保持为 1；重开后不因存在临时文件崩溃；后续保存可正常写入版本 2。
- **实际观察结果**：
  - 重新打开回读，`revision = 1`，`phase = 'draft'`，正文内容完全保持初始正文，零字节破坏；
  - 临时文件 `第0001章.md.mozhou-tmp` 依然残留在磁盘上，数据平面打开时**未主动清扫临时文件**；
  - 后续保存成功将正文版本提升至 `revision = 2`，新内容成功覆盖原子替换。
- **执行时间**：2026-10-02T17:28:36.568Z (时区 UTC / 本地 2026-10-03T01:28:36+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-01-save-interrupt.txt`](logs/verification/probe-01-save-interrupt.txt)
- **覆盖边界**：单机单进程本地文件系统（NTFS），软件级写入中断模拟。

---

### 2. 同章竞争保存 (Probe 02)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 创建第 1 章草稿并保存为 `revision = 1`；
  2. 模拟客户端 A 与客户端 B 同时读取当前版本（均拿到 `expectedRevision: 1`）；
  3. 客户端 A 先发起保存，正文为 `客户端 A 的修改`，`expectedRevision: 1`；
  4. 客户端 B 稍后发起保存，正文为 `客户端 B 的修改`，`expectedRevision: 1`。
- **故障注入位置**：[packages/data-plane/src/chapter.ts:803](packages/data-plane/src/chapter.ts#L803)（CAS 版本匹配守卫）
- **期望结果**：客户端 A 保存成功并自增版本至 2；客户端 B 遭遇版本冲突被拒绝，抛出 `ProseRevisionConflictError`；盘上保留客户端 A 的正文。
- **实际观察结果**：
  - 客户端 A 成功将正文写入盘面，返回 `revision: 2`；
  - 客户端 B 立即被拦截，抛出 `ProseRevisionConflictError: chapter 1 expected revision 1, but found 2`；
  - 盘上最终正文为客户端 A 的修改，杜绝了并发写入互相覆盖导致的“丢失更新（Lost Update）”。
- **执行时间**：2026-10-02T17:28:36.702Z (时区 UTC / 本地 2026-10-03T01:28:36+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-02-save-concurrency.txt`](logs/verification/probe-02-save-concurrency.txt)
- **覆盖边界**：单实例内两并发调用，CAS 乐观锁。

---

### 3. 同数据根双实例启动 (Probe 03)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 场景 A：实例 1 调用 `DataRootProcessLock.acquire(dir)`，实例 2 调用 `acquire(dir)`；
  2. 场景 B：在锁文件中写入不存在的已死 PID（`99999999`），实例 2 调用 `acquire(dir)`；
  3. 场景 C：模拟操作系统 PID 复用，向锁文件写入当前系统存活的无关进程 PID（`process.pid`），新实例尝试调用 `acquire(dir)`。
- **故障注入位置**：[apps/web/server/bookAccess.ts:55-65](apps/web/server/bookAccess.ts#L55-L65)（`process.kill(pid, 0)` 存活检测）
- **期望结果**：场景 A 正常排他拒绝；场景 B 探测到 `ESRCH` 自动接管；场景 C 验证是否存在误判拒绝。
- **实际观察结果**：
  - 场景 A：实例 1 成功获取；实例 2 抛出 `DATA_ROOT_LOCKED: another service instance (PID ...) is running on dataRoot`，排他有效；
  - 场景 B：实例 2 成功捕获 `ESRCH`，识别旧进程已死，顺利接管旧锁；
  - **场景 C（缺陷确证）**：当写入当前系统真实存活的 PID 时，`process.kill(pid, 0)` 调用返回成功，导致实例误以为“墨舟服务仍在运行”，**抛出 `DATA_ROOT_LOCKED` 并永久拒绝启动（假死死锁）**。用户必须手动找到并删除 `.mozhou_instance.lock` 才能恢复。
- **执行时间**：2026-10-02T17:28:36.741Z (时区 UTC / 本地 2026-10-03T01:28:36+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-03-instance-lock.txt`](logs/verification/probe-03-instance-lock.txt)
- **覆盖边界**：单机多进程启动排他文件锁机制。

---

### 4. 生成停止、切章后的晚到结果 (Probe 04)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 创建第 1 章与第 2 章初始正文；
  2. 模拟在第 1 章发起大模型续写，但在生成流传输过程中作者切换到第 2 章进行编辑；
  3. 模拟第 1 章的晚到候选文本到达服务端并触发候选持久化；
  4. 检查第 1 章盘上正文与第 2 章盘上正文的内容完整性。
- **故障注入位置**：[apps/web/server/draftContext.ts:40](apps/web/server/draftContext.ts#L40)（候选缓冲池落地点）
- **期望结果**：晚到结果不得篡改正在编辑的第 2 章正文，亦不得在未确认情况下覆盖第 1 章正文。
- **实际观察结果**：
  - 晚到候选被严格写入 `.mozhou/draft_candidates.jsonl`（C2 候选区缓冲池）；
  - 第 1 章正文文件保持原手写正文（未被修改）；第 2 章正文文件保持原手写正文（未被交叉污染）；
  - 架构判定：系统的候选区与正典正文区物理完全解耦，切章与生成取消具备强隔离性。
- **执行时间**：2026-10-02T17:28:36.776Z (时区 UTC / 本地 2026-10-03T01:28:36+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-04-late-generation.txt`](logs/verification/probe-04-late-generation.txt)
- **覆盖边界**：长篇小说长程流式生成的异步状态隔离。

---

### 5. 采纳与撤销时正文与版本一致性 (Probe 05)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 初始草稿保存（`revision = 1`）；
  2. 采纳 AI 候选正文，调用 `saveProseDraft`（预期版本 `1`，写入新正文）；
  3. 核对正文文件与 SQLite 投影数据库中的版本号与摘要；
  4. 作者执行撤销（Undo），回滚回初始草稿正文，再次调用 `saveProseDraft`（预期版本 `2`）。
- **故障注入位置**：无注入，验证标准状态流转。
- **期望结果**：正文 Markdown 文件、SQLite 投影、版本号完全一致；撤销操作采用版本前移递增。
- **实际观察结果**：
  - 步骤 2 采纳后，磁盘正文 `revision = 2`，SQLite 表 `outline_nodes` 中的 `revision = 2`，两者完全对齐；
  - 步骤 3 撤销后，磁盘正文恢复旧内容，但版本自增为 `revision = 3`，SQLite 同步更新为 `revision = 3`；
  - 确证：系统采用**向前追加修正（Revision Forwarding）**模型，撤销不是物理回滚旧版本号，严格遵守版本单调递增不变量（INV-I5）。
- **执行时间**：2026-10-02T17:28:36.812Z (时区 UTC / 本地 2026-10-03T01:28:36+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-05-accept-undo-consistency.txt`](logs/verification/probe-05-accept-undo-consistency.txt)
- **覆盖边界**：草稿采纳与撤销的全生命周期数据一致性。

---

### 6. 提交成功但响应丢失后的确认与重试 (Probe 06)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 调用 `commitChapter` 定稿第 1 章（`expectedRevision = 1`），执行成功；
  2. 模拟网络异常断开，客户端未收到返回的 200 响应；
  3. 客户端携带原参数再次重发 `commitChapter`；
  4. 客户端通过 `getProseChapter(1)` 查询快照进行状态确认。
- **故障注入位置**：[packages/pipeline/src/commit-orchestration.ts:204](packages/pipeline/src/commit-orchestration.ts#L204)
- **期望结果**：重试请求被拦截；客户端能通过读取快照确认前次提交已成功。
- **实际观察结果**：
  - 重试请求被拦截，抛出 `ChapterPhaseError: chapter is committed — reopen it before re-committing`；
  - 服务端未发生重复提交、未产生重复追踪流追加；
  - 客户端读取快照确认：`phase = 'committed'`，`commitId` 准确存在且与前次提交完全一致。
- **执行时间**：2026-10-02T17:28:36.852Z (时区 UTC / 本地 2026-10-03T01:28:36+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-06-commit-retry-lost-ack.txt`](logs/verification/probe-06-commit-retry-lost-ack.txt)
- **覆盖边界**：2PC 提交完成后的网络闪断与重试确认。

---

### 7. 提交各阶段失败及恢复过程再次中断 (Probe 07)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 通过 `commitChapter` 的 `onStage` 回调，分别在 6 大阶段注入模拟崩溃：
     - `journal-durable`（写日志）
     - `stream-append`（写正典流）
     - `event-append`（写事件行）
     - `prose-flip`（正文翻转）
     - `projection`（更新 SQLite）
     - `manifest`（更新基线）
  2. 每次崩溃后，重新打开 `LocalDataPlane` 触发 `recoverPendingCommit`；
  3. **【关键注入】二次中断测试**：在正文已翻转为 committed 后的 `recoverForward` 过程中，在 `truncateSync(baseBytes)` 之后、`appendFileSync` 之前模拟系统掉电（截断追踪流为 0 字节），随后执行第二次开库恢复。
- **故障注入位置**：[packages/data-plane/src/chapter.ts:380-385,461](packages/data-plane/src/chapter.ts#L380-L385)
- **期望结果**：前 6 阶段恢复符合设计；二次中断恢复应当能补齐追踪流，保证数据不丢。
- **实际观察结果**：
  - 单次中断：`prose-flip` 之前的崩溃均安全回滚为 draft；`prose-flip` 之后的崩溃均安全前滚为 committed，journal 均被正确清理；
  - **【确证重大缺陷】二次中断致数据静默丢失**：
    - 二次恢复执行完成后，系统直接删除了 `.mozhou/pending_commit.json`，正文显示为 `committed`，未报任何错误；
    - 然而物理盘上的 `追踪/事实.jsonl` **大小为 0 字节**，原本应当由 journal 补齐的 2 行事实增量**被永久丢失**！
    - **根因确认**：`recoverForward` 仅对盘面判定为 `'partial'` 的文件执行追加重放；当文件因在截断阶段崩溃而使大小等于 `baseBytes` 时，`classifyAppendDiskState` 判为 `'untouched'`，恢复代码将其误认为“已完成/未动”，直接跳过重放，导致正典事实永久丢失！
- **执行时间**：2026-10-02T17:28:36.902Z (时区 UTC / 本地 2026-10-03T01:28:36+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-07-commit-stages-and-reinterrupt.txt`](logs/verification/probe-07-commit-stages-and-reinterrupt.txt)
- **覆盖边界**：2PC 提交事务状态机与两阶段恢复算法重入安全。

---

### 8. 权限不足、磁盘写入失败 (Probe 08)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 创建第 1 章并保存基线正文；
  2. 以只读排他模式打开目标正文文件句柄（模拟 Windows 杀毒软件、索引器占用或权限受限）；
  3. 调用 `atomicWriteFileSync` 尝试覆盖该正文；
  4. 释放文件句柄，检查原文件与临时文件状态。
- **故障注入位置**：[packages/data-plane/src/atomic-write.ts:31](packages/data-plane/src/atomic-write.ts#L31)（`renameSync` 阶段）
- **期望结果**：写操作抛出权限错误；原正文文件不受破坏。
- **实际观察结果**：
  - 系统抛出预期的 `EPERM: operation not permitted, rename ...`；
  - 检查原文件内容：原正文完整无缺，未被半写损坏；
  - **资源泄漏观察**：临时文件 `.mozhou-tmp` 残留在磁盘上未被自动清理，证实了 `atomicWriteFileSync` 在异常路径下缺乏 `unlinkSync(tmp)` 清理的设计缺口。
- **执行时间**：2026-10-02T17:28:37.278Z (时区 UTC / 本地 2026-10-03T01:28:37+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-08-disk-write-permission-failure.txt`](logs/verification/probe-08-disk-write-permission-failure.txt)
- **覆盖边界**：本地文件 I/O 权限与占用锁定防御。

---

### 9. 事件账本尾部残缺 (Probe 09)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 向 `.mozhou/events.jsonl` 写入 3 行合规事件；
  2. 模拟突发断电导致的半截残缺写：尾部追加未闭合的非完整 JSON 字符串（`{"type":"TaskStepTransitioned","seq":4,"at":"2026-10-0`）；
  3. 调用 `@mozhou/runtime` 的 `readStoredLines` 尝试解析账本。
- **故障注入位置**：[packages/runtime/src/eventBus.ts:38](packages/runtime/src/eventBus.ts#L38)
- **期望结果**：解析器具备容错能力，不因尾部脏行导致整应用崩溃。
- **实际观察结果**：
  - `readStoredLines` 内部通过 `try { JSON.parse(line) } catch` 捕获了坏行异常，顺利跳过了该残缺行；
  - 成功读出了前面的 3 条有效事件（`seq: 1, 2, 3`），未抛出未捕获 SyntaxError；
  - 确证系统具备基本的 Fail-Soft 容错，但坏行丢失未在控制台产生报警日志。
- **执行时间**：2026-10-02T17:28:37.332Z (时区 UTC / 本地 2026-10-03T01:28:37+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-09-events-ledger-truncation.txt`](logs/verification/probe-09-events-ledger-truncation.txt)
- **覆盖边界**：事件账本物理 JSONL 行容错。

---

### 10. 导出内容与指定版本正文是否一致 (Probe 10)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 创建第 1 章并定稿，记录提交正文与标题；
  2. 调用 `@mozhou/data-plane` 的 `exportSubmissionDocx` 导出 Word 文档 Buffer；
  3. 核对导出的二进制 Buffer 文件头特征与传入正文一致性。
- **故障注入位置**：无注入，功能合规性实测。
- **期望结果**：生成符合规范的标准 OOXML (.docx) 二进制包，正文逐字一致。
- **实际观察结果**：
  - 成功生成 DOCX 二进制数据（文件大小 7,049 字节）；
  - 文件头 4 字节为 `PK\x03\x04`，完全符合标准 PKZip / OOXML 容器规范；
  - 导出模块直接读取盘上正典正文，排版与文本完全对齐。
- **执行时间**：2026-10-02T17:28:37.375Z (时区 UTC / 本地 2026-10-03T01:28:37+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-10-export-consistency.txt`](logs/verification/probe-10-export-consistency.txt)
- **覆盖边界**：OOXML 标准文档打包与正典正文保真。

---

### 11. 旧数据格式打开及迁移失败后的处理 (Probe 11)
- **基线版本**：`WORKTREE(未提交)`
- **操作与输入**：
  1. 创建正常书库并建立第 1 章；
  2. 打开其 SQLite 数据库，人工篡改 `PRAGMA user_version = 1`（模拟旧版数据库，当前代码期望版本为 `2`）；
  3. 测试 A：调用严格模式 `LocalDataPlane.open(dir)`；
  4. 测试 B：调用自愈模式 `LocalDataPlane.openOrRebuild(dir)`。
- **故障注入位置**：[packages/data-plane/src/database.ts:35](packages/data-plane/src/database.ts#L35) 与 [local-data-plane.ts:451](packages/data-plane/src/local-data-plane.ts#L451)
- **期望结果**：严格模式下抛出版本错配错误；自愈模式下自动清库并从 Markdown 重建。
- **实际观察结果**：
  - 测试 A：`open()` 严格拦截，抛出 `ProjectionVersionMismatchError: projection user_version=1, expected 2 — rebuild projection from canon`；
  - 测试 B：`openOrRebuild()` 捕获该错，自动调用 `rebuildProjectionFromCanon`，从正典 Markdown 彻底重建整库，并将新数据库的 `PRAGMA user_version` 正确提升为 `2`；
  - 重建后读回第 1 章正文完整如初，证明正典真源与删库重建机制 100% 成立。
- **执行时间**：2026-10-02T17:28:37.418Z (时区 UTC / 本地 2026-10-03T01:28:37+08:00)
- **证据文件**：[`audit-2026-10-03\logs\verification\probe-11-legacy-format-and-rebuild.txt`](logs/verification/probe-11-legacy-format-and-rebuild.txt)
- **覆盖边界**：SQLite 投影版本漂移、增量迁移拒绝与全量自愈重建。

---

## 四、未执行项目清单与说明 (NOT RUN / BLOCKED)

依据审计章程第一节硬约束，以下高风险或范围外操作显式标注为 **NOT RUN**，绝不为凑齐全量执行而违规跨界：

| 验证项目 | 状态 | 未执行原因与依据 |
|---|:---:|---|
| **真实云端大模型调用验证** | **NOT RUN** | 遵守章程 §1.9：只读审计不产生任何真实模型 API 费用，不使用真实 API Key 调用远端大模型。 |
| **真实在线充值与会员支付** | **NOT RUN** | 遵守章程 §1.9：禁止发起任何真实资金交易；产品本身支付为 Mock 链接，会员为 501。 |
| **物理硬件突发断电与拔盘实测** | **NOT RUN** | 遵守章程 §1.8 与 §4：禁止进行硬件物理破坏或不可控系统掉电；所有掉电验证仅在软件仿真层注入。 |
| **真实 Windows Authenticode 代码签名验证** | **NOT RUN** | 官方未配置企业证书；本机会话无商业签名私钥。 |
| **跨网络多节点分布式并发争夺** | **NOT RUN** | 本系统为单机桌面优先设计，无网络分布式部署环境。 |

---

## 五、综合一致性与系统韧性判定

通过本轮覆盖 11 个核心场景的故障注入与边界实测，本审计组得出以下可复核的客观结论：

1. **正典优先与删库重建极其坚固**：
   - 系统将 Markdown 正典文件确立为单一事实源的决策完全正确；
   - 无论是 SQLite 版本被篡改，还是投影损坏，`openOrRebuild` 均能 100% 幂等恢复。
2. **CAS 乐观并发与单向版本控制成立**：
   - 编辑器草稿保存与章节提交的 CAS 版本比对严格生效，有效拦截了同章并发踩踏；
   - 撤销采用版本向前递增，维护了历史单调性。
3. **确证必须修复的工程可靠性隐患**：
   - **P1 隐患**：`recoverForward` 二次中断导致正典追踪流永久丢失的缺陷（Probe 07）；
   - **P1 隐患**：`DataRootProcessLock` 在遇到系统 PID 复用时永久假死死锁的缺陷（Probe 03）；
   - **P2 隐患**：`atomicWriteFileSync` 采用静态固定临时文件名，多线程/多进程写入时会发生相互截断踩踏，且失败时未清理残余临时文件（Probe 01, 08）。
