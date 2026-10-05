# 墨舟 (MoZhou / Novel OS) 隔离环境验证记录与实测审计
# (VERIFICATION-LOG.md)

> **审计依据**：`audit-2026-10-03/00-audit-charter.md`（章程口径）、`01-baseline-and-graph-gate.md`（基线与通道）、`06-verification-log.md`（隔离实测）  
> **基线环境**：Node.js v24.18.0 / Windows 11 专业工作站版 10.0.26200 x64 / pnpm 9.15.0 / Git 2.55.0  
> **基线提交**：HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb` (ahead 7) / WORKTREE(42 项未提交改动)  
> **脱敏与隔离声明**：实测全部在系统临时沙箱 `%TEMP%\mozhou-probe-*` 运行；不触碰生产真实书稿库（`mozhou_rt`）、不读取用户真实凭据；零外部模型与在线支付调用；执行完毕临时目录全部清空。  

---

## 一、 实测执行总览表

| 编号 | 验证项目 / 故障场景 | 证据级别 | 基线标签 | 判定结果 | 关键实测结果与事实摘要 | 原始日志/脚本位置 |
|:---:|---|:---:|:---:|:---:|---|---|
| **P01** | 保存中断后重开 | E4 / E7 | WORKTREE | **部分自愈** | 原正文未被破坏；但残留在盘上的 `.mozhou-tmp` 脏文件未被自动清理；后续保存可正常覆盖更新。 | `logs/verification/probe-01-save-interrupt.txt` |
| **P02** | 同章并发竞争保存 | E4 | WORKTREE | **完全成立** | CAS 乐观锁有效：先到者成功升版至 r2，后到者抛出 `ProseRevisionConflictError`（BFF 409），防止丢失更新。 | `logs/verification/probe-02-save-concurrency.txt` |
| **P03** | 同数据根双实例启动 | E4 / E7 | WORKTREE | **部分成立**<br/>(确证死锁) | 1. 正常顺序抢锁有效抛出 `DATA_ROOT_LOCKED`；<br/>2. 已死 PID 可被接管；<br/>3. **确证 PID 复用死锁**：若旧 PID 被系统复用分配给无关存活进程，系统将永久拒绝启动。 | `logs/verification/probe-03-instance-lock.txt` |
| **P04** | 生成停止/切章后晚到结果 | E4 | WORKTREE | **完全隔离** | 晚到候选仅落入 `.mozhou/draft_candidates.jsonl` 候选区，正文文件不受任何污染，切章安全。 | `logs/verification/probe-04-late-generation.txt` |
| **P05** | 采纳与撤销正文/版本一致性 | E4 | WORKTREE | **完全一致** | 采纳后正文与 SQLite 均自增至 r1；撤销后正文回退，但版本采用单调前移至 r2（Forward Step），维持历史单调性。 | `logs/verification/probe-05-accept-undo-consistency.txt` |
| **P06** | 提交成功响应丢失确认与重试 | E4 | WORKTREE | **可确认但无业务幂等** | 客户端重试收到 409 `ChapterPhaseError`；客户端必须通过拉取章节快照比对 `commitId` 确认前次提交。 | `logs/verification/probe-06-commit-retry-lost-ack.txt` |
| **P07** | 提交各阶段失败与二次中断 | E4 / E7 | WORKTREE | **部分成立**<br/>(确证数据丢失) | 1. 6 大阶段单次中断恢复符合预期；<br/>2. **确证二次中断数据丢失**：`recoverForward` 截断后二次断电，再次恢复判为 `untouched`，直接删 journal，**导致追踪流增量永久丢失**。 | `logs/verification/probe-07-commit-stages-and-reinterrupt.txt`<br/>`logs/038-t5-2pc-recovery-reinterrupt.txt` |
| **P08** | 权限不足/磁盘写入失败 | E4 / E7 | WORKTREE | **防御有效但泄漏** | 遇到 `EPERM` 写入拒绝时，原正文未被破坏；但脏临时文件 `.mozhou-tmp` 泄漏残留在磁盘上。 | `logs/verification/probe-08-disk-write-permission-failure.txt` |
| **P09** | 事件账本尾部残缺 | E4 / E7 | WORKTREE | **Fail-Soft 容错** | 账本回读能跳过半截非完整 JSON 行，解析有效事件；但残缺事件数据永久丢失，缺乏告警通知。 | `logs/verification/probe-09-events-ledger-truncation.txt` |
| **P10** | 导出内容与指定版本一致性 | E4 | WORKTREE | **逐字一致** | DOCX 导出为合规标准 OOXML ZIP 包，正文内容、章节标题与盘上提交正典逐字严格对齐。 | `logs/verification/probe-10-export-consistency.txt` |
| **P11** | 旧数据格式打开与迁移自愈 | E4 / E7 | WORKTREE | **100% 自愈重建** | `open()` 遇到旧 `user_version` 严格抛出 `ProjectionVersionMismatchError`；`openOrRebuild()` 自动从 Markdown 完美重建。 | `logs/verification/probe-11-legacy-format-and-rebuild.txt` |

---

## 二、 约束说明：未执行项 (NOT RUN) 与阻塞项 (BLOCKED)

依照 `00-audit-charter.md` §1 授权硬约束，以下领域严禁在本次只读审计中执行，全部显式标明并记录原因：

1. **真实外部模型供应商在线调用 (NOT RUN)**：
   - **原因**：违反只读安全红线，涉及消耗外部真实 API Quota 与密钥外泄风险。已在隔离测试中通过本地 Mock 与内置虚构引擎验证流式状态机。
2. **真实商业支付通道公网打通 (NOT RUN)**：
   - **原因**：全仓未配置任何真实商户密钥与回调域名，后端接口恒定返回 `mock_checkout` 虚拟 URL。
3. **物理硬件掉电与拔盘实验 (NOT RUN)**：
   - **原因**：本次为软件级无损审计，无权限执行物理拔电源或断电实验。通过进程级强杀（`SIGKILL` / `taskkill`）与软件层中断模拟。
4. **通过直接驱动直连 SQLite 生产书稿库 (BLOCKED)**：
   - **原因**：`mozhou_rt` 真实书稿库受只读与 dbhub 连接器红线保护；当前 DSH 环境中 dbhub MCP 工具未对本会话暴露（处于 BLOCKED 状态），严禁绕过连接器私自连接。

---

## 三、 核心实测细节与现场还原

### 1. 提交前滚恢复过程中的二次中断丢数据缺陷 (P07 深度取证)
- **探针脚本**：`logs/t5-probe-2pc-recovery-interrupt.mjs`
- **复现步骤**：
  1. 准备第 1 章草稿，构造携带 2 条追踪流事实的提交请求；
  2. 执行 `commitChapter` 并在 `onStage('event-append')` 时人工模拟断电强杀；此时物理状态为：正文尚未翻转，但事件与追踪流已写入增量；
  3. 重启执行第一次恢复：正文仍为旧版，系统进入 `recoverBackward`，执行 `truncateSync(target.baseBytes)` 将追踪流成功回滚截断至原始大小；
  4. 随后模拟正文已翻转的情形：正文已变为 staged 状态，系统进入 `recoverForward`。其逻辑先执行截断，若在执行重放追加之前**发生二次断电强杀**；
  5. 系统再次重启时，读取目标文件物理大小，发现其等于 `target.baseBytes`。`classifyAppendDiskState` 将其误判为 `untouched`；
  6. 恢复引擎判定所有目标均已就绪，调用 `unlinkSync(journalPath)` 宣布恢复成功并删除日志。
- **实测结果**：追踪流增量被永远清空，正典增量数据发生永久静默丢失。原始日志见 `logs/038-t5-2pc-recovery-reinterrupt.txt`。

### 2. 进程排他锁 PID 复用死锁验证 (P03 取证)
- **探针脚本**：`logs/verification/probe-03-instance-lock.txt`
- **复现步骤**：
  1. 启动实例，在数据目录下写入 `.mozhou_instance.lock`；
  2. 模拟进程异常退出，锁文件残留；
  3. 人工将锁文件中的 PID 修改为当前操作系统中正在运行的一个长驻系统进程（例如 `explorer.exe` 或 `svchost.exe` 的 PID）；
  4. 尝试启动新的服务实例。
- **实测结果**：`process.kill(pid, 0)` 成功返回，代码判定已有实例存活，抛出 `DATA_ROOT_LOCKED` 并退出。服务陷入永久不可启动状态，必须人工物理删除文件。

### 3. SQLite Pragma 默认配置现场核验 (P11 & 日志 035/037)
- **探针输出**：`logs/035-t5-sqlite-pragma-runtime.txt`
- **核验数据**：
  - `PRAGMA busy_timeout;` -> 输出 `5000`（证实默认即为 5 秒，原报告“默认 0”系事实性误报）；
  - `PRAGMA journal_mode;` -> 输出 `wal`；
  - `PRAGMA synchronous;` -> 输出 `2` (FULL)（证实 WAL 下未自动降级为 NORMAL）。
