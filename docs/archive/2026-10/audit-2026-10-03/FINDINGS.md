# 墨舟 (MoZhou / Novel OS) 架构审计缺陷与隐患发现清单
# (FINDINGS.md)

> **审计基线**：仓库根 `C:\zcode\novel-ai` @ 分支 `feature/windows-local-release` (ahead 7) · HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`  
> **状态标注**：所有源码行号均标注来源（`HEAD:90b45a1` 或 `WORKTREE(未提交)`）  
> **审计依据**：聚合 `01-07` 各文档技术结论与隔离实测日志  
> **严重性等级**：
> - **CRITICAL (致命)**：可导致数据静默丢失、不可恢复损坏、系统永久死锁；
> - **HIGH (高危)**：高概率引发并发写冲突、服务异常中断、重复扣费或安全拦截；
> - **MEDIUM (中危)**：资源泄漏、缺乏排队互斥、误报误诊、部分未覆盖分支；
> - **LOW (低危)**：代码异味、异步时序瑕疵、未使用的死代码。  

---

## 一、 发现清单总览表 (12 项)

| 编号 | 严重性 | 缺陷名称 | 触发条件 | 潜在影响与后果 | 源码位置与证据 | 实测日志 |
|:---:|:---:|---|---|---|---|:---:|
| **F-01** | **CRITICAL** | 2PC 提交前滚二次中断致正典追踪流永久静默丢失 | 在 `recoverForward` 截断目标文件后、重放追加前再次断电 | 追踪流增量被误判为 `untouched`，删除日志宣布成功，增量永久丢失 | `packages/data-plane/src/chapter.ts:379-385` [`HEAD:90b45a1`] | `probe-07`<br/>`logs/038` |
| **F-02** | **CRITICAL** | 进程独占锁遭遇操作系统 PID 复用引发假死死锁 | 进程异常崩溃残留锁文件，且该 PID 被系统重新分配给存活进程 | 系统误判已有实例存活，永久抛 `DATA_ROOT_LOCKED` 拒绝启动 | `apps/web/server/bookAccess.ts:51-68` [`HEAD:90b45a1`] | `probe-03` |
| **F-03** | **HIGH** | 原子写临时文件固定导致并发保存互相践踏损坏 | 两个调用方并发调用 `atomicWriteFileSync` 保存同一目标文件 | 相互覆盖损坏 `.mozhou-tmp`，触发 `EBUSY` 或写入半截数据 | `packages/data-plane/src/atomic-write.ts:20-31` [`HEAD:90b45a1`] | `probe-01` |
| **F-04** | **HIGH** | 核心正文写路径完全漏锁引发文件级竞争 | 并发调用 `/api/chapter.prose.save` 或 `/api/chapter.commit` | 核心路由未走 `withBookLock`，并发直冲物理磁盘引发写竞争 | `apps/web/server/routes/proseRoutes.ts:293,480` [`HEAD:90b45a1`] | 源码核查 |
| **F-05** | **HIGH** | 大模型生成与提取重试缺乏全局去重导致重复计费 | 网络抖动或超时后客户端重发 `draft.stream` 或提交重试 | 缺乏生成/提取端点业务幂等键，重发必定产生二次大模型真实扣费 | `apps/web/server/routes/pipelineRoutes.ts:546` [`WORKTREE`]<br/>`proseRoutes.ts:519` [`HEAD`] | 架构推演 |
| **F-06** | **HIGH** | Windows 发布安装包缺少代码签名遭 SmartScreen 拦截 | 用户在 Windows 10/11 正常下载运行 `MoZhou-Setup-0.3.0.exe` | 操作系统弹出全屏蓝色警告拦截，用户信任度归零，无法直接运行 | `scripts/release/windows/build.mjs:82,87` [`HEAD:90b45a1`] | 脚本核查 |
| **F-07** | **MEDIUM** | 数据根锁文件创建缺乏原子排他标志存在竞态 | 两实例同时启动访问同一数据根目录 | 两者 `existsSync` 均返回 false，同时以 `'w'` 覆盖写，双实例同时启动 | `apps/web/server/bookAccess.ts:51` [`HEAD:90b45a1`] | 源码核查 |
| **F-08** | **MEDIUM** | 原子写失败未清理残留 `.mozhou-tmp` 脏文件 | 磁盘满或写入被 `EPERM` 拦截 | 脏临时文件永久泄漏残留在正文同级目录，启动无自动清理机制 | `packages/data-plane/src/atomic-write.ts:24` [`HEAD:90b45a1`] | `probe-08` |
| **F-09** | **MEDIUM** | 事件账本尾部破损行静默丢弃缺乏系统告警 | 进程在 `appendFileSync` 期间异常终止写入半截 JSON 行 | `readStoredLines` 跳过残缺行，虽不崩溃但破坏审计链条完整性 | `packages/runtime/src/eventBus.ts:168` [`HEAD:90b45a1`] | `probe-09` |
| **F-10** | **MEDIUM** | 前端客户端跨层穿透直接引用服务端 billingCatalog 单例 | 前端组件加载与打包 | 破坏前后端解耦边界，将服务端特权定价逻辑泄露打包进前端 bundle | `apps/web/src/public/PublicSite.tsx:12` [`HEAD:90b45a1`] | `logs/040` |
| **F-11** | **LOW** | 商业支付当前仅为虚拟 Mock 链接无法商用发布 | 触发任何在线购买会员或套餐操作 | 后端恒定返回 `mock_checkout` 虚拟 URL，无真实商户与凭据接入 | `apps/web/server/billing/store.ts:180` [`HEAD:90b45a1`] | 源码核查 |
| **F-12** | **LOW** | 桌面外壳 `src-tauri` 为 12 行空壳代码存在架构分叉 | 执行 `pnpm tauri dev` 或桌面打包 | Tauri 壳不拉起服务端，真正桌面由 `MoZhou.cs` 编排，版本号滞后 | `src-tauri/src/main.rs:1-12` [`HEAD:90b45a1`] | 源码核查 |

---

## 二、 重点发现深度技术剖析

### F-01 (CRITICAL): 2PC 提交前滚二次中断致正典追踪流永久静默丢失
- **触发条件**：作者提交章节，正文 frontmatter 相位已翻转为 `committed`，系统进入 `recoverForward` 阶段。当恢复逻辑调用 `truncateSync(target.baseBytes)` 将物理追踪流文件截回原长度后，尚未执行 `appendFileSync` 补齐追加数据时，机器再次发生掉电或进程被强杀（二次中断）。
- **技术根因**：
  查阅 [packages/data-plane/src/chapter.ts:379-385](packages/data-plane/src/chapter.ts#L379-L385)：
  ```ts
  // 1) 补齐半截追加（partial ⇒ 归零重放，保证逐字节确定性）
  for (const { target, disk } of diskStates) {
    const classified = classifyAppendDiskState(disk, target)
    if (classified.state === 'partial') {
      truncateSync(join(root, target.relPath), target.baseBytes)
      appendFileSync(join(root, target.relPath), Buffer.from(target.payloadBase64, 'base64'))
    }
  }
  ```
  在二次恢复重启时，系统重新读取盘面。由于在首次中断中文件已被截断，此时 `disk.length === target.baseBytes`。`classifyAppendDiskState` 依据长度相等将其分类为 `state: 'untouched'`！
  恢复状态机误认为该文件“尚未被本次提交修改且处于初始完好状态”，跳过重放，并在后续调用 `unlinkSync(journalPath)` 删除预写日志 `pending_commit.json`。
- **后果影响**：由于预写日志被删，正文 frontmatter 永久标记为 `committed`，但对应的设定追踪流数据彻底丢失，形成致命的软性数据静默丢失。
- **修复方案**：`recoverForward` 期间严禁直接物理截断原文件；必须使用独立 temporary journal 或带事务的 shadow 文件，或者在 `classifyAppendDiskState` 中结合 `target.payloadBase64` 的比对判定。

---

### F-02 (CRITICAL): 进程独占锁遭遇操作系统 PID 复用引发假死死锁
- **触发条件**：墨舟后台服务进程因断电或异常崩溃退出，数据根目录下的 `.mozhou_instance.lock` 遗留在磁盘中。用户在数小时或数天后重新启动服务，此时操作系统将先前崩溃进程的 PID 分配给了一个正在运行的无关系统常驻进程（如 `explorer.exe`、`svchost.exe` 或其他后台软件）。
- **技术根因**：
  查阅 [apps/web/server/bookAccess.ts:51-68](apps/web/server/bookAccess.ts#L51-L68)：
  ```ts
  try {
    process.kill(pid, 0)
    // 进程存活，抛错拒绝
    throw new RequestBoundaryError(
      `DATA_ROOT_LOCKED: another service instance (PID ${pid}) is running...`
    )
  } catch (error) {
    // 只有在抛出 ESRCH (进程不存在) 时才允许接管
  }
  ```
  `process.kill(pid, 0)` 仅检查操作系统中是否存在该 PID。只要该 PID 被系统其他进程复用，调用就会成功返回，代码立即认定“原服务实例仍在运行”。
- **后果影响**：用户无论重启多少次应用，都会收到 `DATA_ROOT_LOCKED` 致命错误，应用陷入永久无法启动的假死状态，必须技术人员手动介入删除 `.mozhou_instance.lock`。
- **修复方案**：在锁文件中除了记录 PID 外，必须记录进程启动时间戳与进程创建唯一 Token；在 Windows 下优先使用命名内核互斥体（Named Mutex，如 `MoZhou.cs` 的做法）。

---

### F-03 (HIGH): 原子写临时文件固定导致并发保存互相践踏损坏
- **触发条件**：同一服务实例在毫秒级并发收到针对同一目标文件（如同一章节）的写入请求，或多标签页同时触发自动草稿保存。
- **技术根因**：
  查阅 [packages/data-plane/src/atomic-write.ts:23](packages/data-plane/src/atomic-write.ts#L23)：
  ```ts
  const tmp = `${absolutePath}${ATOMIC_TMP_SUFFIX}` // '.mozhou-tmp'
  const fd = openSync(tmp, 'w')
  ```
  临时文件名完全静态固定，无随机数，无线程或请求上下文隔离。
- **后果影响**：后发请求打开临时文件会破坏性截断先发请求正在写入的数据；在 Windows NTFS 上，甚至会因为文件句柄冲突直接抛出 `EPERM` 或 `EBUSY` 异常导致保存崩溃。
- **修复方案**：临时文件命名必须采用 `randomUUID()` 或 `process.pid + hrtime()`，如 `${absolutePath}.${randomUUID()}.tmp`。
