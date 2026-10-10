# 墨舟 (MoZhou / Novel OS) 技术规格说明书
# 阶段二：写入所有权、并发规则与进程锁防假死设计
# (NEXT-ROUND-02-CONCURRENCY-OWNERSHIP.md)

- **文档类型**：系统架构、并发控制与写入所有权技术规格说明书 (Technical Specification)
- **基线版本**：HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb` / WORKTREE(42项未提交改动)
- **责任模块**：
  - 服务端宿主与并发排队：`apps/web/server/bookAccess.ts`, `apps/web/server/productionServer.ts`
  - 核心业务路由：`apps/web/server/routes/proseRoutes.ts`, `apps/web/server/routes/pipelineRoutes.ts`
  - 本地存储与持久化出口：`packages/data-plane/src/atomic-write.ts`, `packages/data-plane/src/chapter.ts`
- **关联缺陷**：`FINDINGS.md` F-02 (CRITICAL: 进程排他锁 PID 复用与假死), F-03 (HIGH: 原子写入固定临时文件践踏), F-04 (HIGH: 提交路径缺少单书并发队列锁保护)
- **编制依据**：`00-audit-charter.md`, `01-baseline-and-graph-gate.md`, `02-module-inventory-and-boundaries.md`, `04-interface-contracts.md`, `06-verification-log.md` (probe-02, probe-03 实测日志), `07-crosscheck-review.md` 驳回项裁决

---

## 一、 核心概念澄清与并发可达性分析

在制定具体的并发规则之前，必须首先建立对 Node.js 单线程事件循环与 Windows 多进程运行拓扑的严谨认知，彻底厘清并发冲突的**真实可达场景**，防止在不存在风险的地方过度设计，或在真正脆弱的边界漏防。

### 1.1 单线程事件循环中的同步连续操作不可交错 (Single-Thread Synchronous Atomicity)

Node.js 主进程在单个线程中执行 JavaScript。根据事件循环规格，**一段连续执行的同步代码（不包含 `await`、Promise 回调、I/O 回调、`process.nextTick` 或定时器）是不可被其他并发 HTTP 请求打断的**。

**关键推论与反证**：
- 在单个 Node.js 进程内部，如果函数 `A` 连续调用 `openSync`、`writeSync`、`renameSync`，期间没有任何异步 yield，那么即使外部有 1000 个 HTTP 请求同时到达操作同一个文件，这些请求的处理函数也必须在事件循环队列中排队等待，**绝不可能发生「请求 1 刚写完 tmp，尚未 rename，就被请求 2 抢占并重写 tmp」的代码交错**。
- 因此，在单进程模型下，纯同步函数（如既有的 `atomicWriteFileSync`）在单线程内部天然具备时序原子性。

### 1.2 真实并发冲突的客观可达路径 (True Concurrency Scenarios)

那么，既有代码中暴露出的并发冲突、临时文件覆盖与文件损坏风险，究竟是在何种物理场景下真实可达的？经审计复核，确证为以下两大场景：

#### 场景 1：多进程同时访问同一数据根目录 (Cross-Process Contention on Same DataRoot)
- **物理现象**：
  1. 用户在未受控环境下启动了两个 Node.js 进程（例如开发者在一个终端运行 `pnpm --filter @mozhou/web dev`，又在另一个终端运行 `pnpm start` 或 `MoZhou.exe`），且两者指向相同的 `cwd` 或 `MOZHOU_DATA_ROOT`；
  2. 两个独立的 OS 进程拥有独立的 Node.js 运行时和独立的线程。它们向同一个文件（例如 `正文/第一卷/第0001章.md.mozhou-tmp`）并发执行 `openSync(tmp, 'w')`；
  3. **后果**：后启动的进程直接截断或覆盖正在被前一个进程写入的临时文件，随后双方执行 `renameSync`，引发文件内容错乱或 Windows 下的 `EPERM` / `EBUSY` 文件锁定错误。
- **可达性判定**：**完全可达**。完全依赖进程锁（`DataRootProcessLock`）的有效性来阻断。

#### 2. 异步处理流水线中穿插异步等待点 (Async Pipeline Yield Contention)
- **物理现象**：
  1. 在 `apps/web/server/routes/proseRoutes.ts:475` 处理 `/api/chapter.commit`（定稿提交）时，整个编排函数 `runChapterCommit` 是 `async` 函数；
  2. 在函数内部存在多个异步 `await` 点：`await extractDelta(...)`（调用云端大模型，耗时可达 5~30 秒）、`await gate(...)`、`await runFlywheelRecord(...)`；
  3. 当作者在前端快速双击提交，或者多个客户端针对同一本书的同一章节并发发起 `commit` 时，由于请求处理函数在 `await` 处释放了事件循环控制权，**多个请求会并发进入同一个章节的处理管线**；
  4. 虽然最终落盘调用了同步写入，但在进入落盘前，两个请求读取到了相同的基线，分别发起了各自的异步操作，随后交错写入文件和追加事件，导致状态破坏。
- **可达性判定**：**完全可达**。正是因为 `proseRoutes` 缺少进程内单书队列锁保护而引发。

---

## 二、 进程排他锁防假死设计 (DataRoot Lock & PID Disambiguation)

### 2.1 既有实现的严重缺陷分析 (F-02 复盘)

审查 `apps/web/server/bookAccess.ts:41-80` 的 `DataRootProcessLock` 既有实现：
```ts
if (existsSync(lockPath)) {
  const raw = readFileSync(lockPath, 'utf8').trim()
  const pid = parseInt(raw, 10)
  if (!isNaN(pid) && pid > 0) {
    try {
      process.kill(pid, 0) // 发送空信号探测进程存活性
      throw new Error(`DATA_ROOT_LOCKED: another service instance (PID ${pid}) is running...`)
    } catch (killErr: unknown) {
      if ((killErr as NodeJS.ErrnoException).code !== 'ESRCH') throw killErr
      // ESRCH 说明进程不存在，可以接管
    }
  }
}
```

**两大严重隐患**：
1. **PID 循环复用导致的「误判假死」**：
   - 操作系统（尤其是 Windows）分配 PID 并不是无限单调递增的，PID 空间通常在 4 位到 5 位整数之间循环重用。
   - 当 MoZhou 异常崩溃（例如蓝屏、断电或 `taskkill /f` 强杀）遗留了 `.mozhou_instance.lock`（内含 PID 例如 `1234`）。
   - 计算机重启后，系统启动其他无害进程（如 `svchost.exe`、`chrome.exe` 等）恰好被分配了 PID `1234`。
   - 此时用户再次启动墨舟，执行 `process.kill(1234, 0)` 会成功返回！墨舟误以为上一代服务仍存活，**抛出 `DATA_ROOT_LOCKED` 并拒绝启动**。
   - **校正澄清**：在审计探针中该现象曾被冠以“永久死锁”，需要指出的是，该状态并非理论上不可打破的死锁，但在终端用户视角下，**只要该无关进程不退出，墨舟就永远无法启动，除非用户知晓内幕并手动进入隐藏目录删除 `.mozhou_instance.lock`**。这在商业消费级软件中属于致命的可用性阻断。
2. **锁检查与占有的 TOCTOU 竞态 (Time-of-Check to Time-of-Use)**：
   - 既有代码先检查 `existsSync(lockPath)`，随后再 `openSync(lockPath, 'w')`。
   - 如果两个实例几乎同时启动，两者都判断旧 PID 不存活，然后几乎同时以 `'w'` 模式打开文件。
   - `openSync(path, 'w')` 在文件已存在时会直接将其截断（truncate），缺乏操作系统的原子排他保障（即未指定 `O_CREAT | O_EXCL` 标志）。

---

### 2.2 跨平台三维防冲突锁设计 (Robust Process Lock Protocol)

为彻底根治 PID 复用误判与启动竞态，设计一套**「Win32 命名 Mutex + 原子排他锁文件 + 实例上下文指纹」**的三维复合排他机制。

#### 2.2.1 锁文件数据结构：从单纯 PID 升级为实例全息指纹
锁文件 `.mozhou_instance.lock` 严禁只写入一行简单的 PID 纯文本，必须包含结构化 JSON 全息指纹：

```json
{
  "schemaVersion": 1,
  "instanceGuid": "d9b2e6a1-8f43-4c92-b871-3a018f62c019",
  "pid": 24892,
  "processStartTime": 1727920115000,
  "startedAtIso": "2026-10-03T01:48:35.000Z",
  "nodeVersion": "v24.18.0",
  "cwd": "C:\\zcode\\novel-ai",
  "dataRoot": "C:\\zcode\\novel-ai\\.mozhou_data",
  "heartbeatTimestamp": 1727920120000
}
```

#### 2.2.2 存活性复合判别算法 (Composite Liveness Verification)
当新启动进程探测到磁盘已存在 `.mozhou_instance.lock` 时，执行三阶梯递进鉴别：

```
[检测到锁文件]
      │
      ▼
【第一阶梯：OS PID 物理存活性】
调用 process.kill(lockInfo.pid, 0)
  ├─► 抛出 ESRCH ──► 进程已彻底消亡 ──► 安全接管锁
  └─► 探测成功 (进程存在) ──► 进入第二阶梯
      │
      ▼
【第二阶梯：进程启动时间戳与指纹核验】
Windows 下通过 Windows API (GetProcessTimes) 或 WMI/wmic 
跨平台下通过读 /proc/<pid>/stat 或启动时间核对
  ├─► 当前存活进程的创建时间晚于锁文件记录的 processStartTime 
  │   ──► 实锤为 PID 复用！原墨舟进程已死，当前 PID 属于新进程 ──► 安全接管锁
  └─► 进程创建时间吻合或无法获取时间戳 ──► 进入第三阶梯
      │
      ▼
【第三阶梯：心跳衰减与安全租约 (Heartbeat Lease)】
检查 (Date.now() - lockInfo.heartbeatTimestamp)
  ├─► 心跳超时大于阈值 (如 30 秒无刷新) ──► 判定为异常僵尸进程 ──► 记录日志并接管
  └─► 心跳新鲜有效 (<= 30 秒) ──► 确证为真实墨舟实例在运行 ──► 抛出明确冲突拒绝
```

#### 2.2.3 操作系统级原子抢锁 (O_CREAT | O_EXCL)
在文件系统层，彻底废除无保护的 `openSync(path, 'w')`，使用底层操作系统原子互斥标志：
- 打开模式使用 **`constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY`**（即 Node.js 中的 `'wx'` 模式）。
- 在操作系统内核层面，若文件已存在，`openSync` 必定直接抛出 `EEXIST` 错误，不存在先判断后写入的竞态窗口。
- 只有成功以 `wx` 模式创建文件的唯一实例，才获得锁所有权。

#### 2.2.4 Windows 平台专属加强：结合 MoZhou.cs 命名 Mutex
在 Windows 商业发行版中，`scripts/release/windows/MoZhou.cs` 已建立了 `Local\MoZhou-{SHA256(dataRoot)}` 的命名互斥体。
Node.js 服务端在启动时：
1. 校验环境变量 `MOZHOU_HOSTED_MUTEX` 是否由 C# 启动器注入；
2. 如果是由 `MoZhou.exe` 拉起的子进程，其父进程已经持有内核 Mutex，此时 Node 进程锁主要负责记录运行时指纹与 PID，供排障与外部 CLI 检测；
3. 如果是独立控制台启动（`pnpm start`），Node 执行严格的 `O_EXCL` 与心跳租约防死锁算法。

---

## 三、 进程内单书写入队列与 proseRoutes 提交锁强化 (Single-Book Execution Queue)

### 3.1 既有漏锁现状审查 (F-04 确证)

在系统审计过程中发现，MoZhou 内部虽然在 `apps/web/server/bookAccess.ts:98-117` 实现了 `BookOperationQueue.withBookLock`，并且在部分路由中应用：
- `apps/web/server/routes/pipelineRoutes.ts:234`（`ensureChapterScaffold` 脚手架创建）：已包裹 `withBookLock`；
- `apps/web/server/routes/storyBrainRoutes.ts:98`（故事脑操作）：已包裹 `withBookLock`；
- `apps/web/server/storyboard/store.ts:207`（分镜保存）：已包裹 `withBookLock`。

**致命漏洞**：
在作者最核心的写作与提交路由 `apps/web/server/routes/proseRoutes.ts` 中：
- `POST /api/chapter.prose.save`（保存正文）：**完全没有使用 `withBookLock`**，直接调用 `withBook(...)` 执行保存；
- `POST /api/chapter.commit`（定稿提交）：**完全没有使用 `withBookLock`**，直接进入包含长耗时外部大模型抽取的 `runChapterCommit`。

虽然 `withBook` 会借用数据平面的句柄，但 `withBook` 的既有实现（`packages/data-plane/src/with-plane.ts`）**根本不提供串行化异步锁**，它仅仅是一个打开和关闭 `LocalDataPlane` 的资源借用包装器。这导致多请求并发提交时，长达数秒的异步提取完全处于无锁状态。

---

### 3.2 建立全量覆盖的进程内单书串行化队列协议

为保障单书数据的一致性，在 BFF 路由层与数据平面层之间强制建立**「单书写操作串行化屏障（Per-Book Write Queue）」**。

#### 3.2.1 锁管理对象规约
统一使用 `apps/web/server/bookAccess.ts` 中的 `defaultBookAccessManager.queue` 作为全局单例队列管理器。

#### 3.2.2 锁范围与细粒度策略
- **读操作（Get / Read）**：保持并发非阻塞（如 `getWorksOverview`、`readProseChapter`、`getChapterReview`），无须获取排他锁；
- **写操作（Mutations）**：**必须**显式在 `withBookLock` 作用域内执行。受保护操作包括：
  1. `POST /api/chapter.prose.save`（正文草稿保存）
  2. `POST /api/chapter.commit`（长篇定稿提交编排）
  3. `POST /api/draft.accept`（候选采纳）
  4. `POST /api/chapter.rework`（回炉重开）
  5. `POST /api/chapter.review`（写评审报告）
  6. `POST /api/proposal.decide` / `discard`（正典提案决策）
  7. `POST /api/reconciliation.absorb`（外部修改吸收）

#### 3.2.3 `proseRoutes.ts` 锁注入改造规约

**改造点 1：正文保存 (`chapter.prose.save`)**
```ts
// 改造前：
withBook(root, (plane) => {
  const result = plane.saveProseDraft(...)
  ...
})

// 规范改造后：
await defaultBookAccessManager.queue.withBookLock(root, async () => {
  return withBook(root, (plane) => {
    const beforeBody = expectedRevision === null
      ? ''
      : readProseChapter(root, proseChapterPath(chapterIndex)).body
    const result = plane.saveProseDraft({ chapterIndex, body: rawBody, expectedRevision, title, confirmExternalOverwrite })
    ...
    json(200, { ok: true, chapterIndex: result.chapterIndex, revision: result.revision, ... })
  })
})
```

**改造点 2：定稿提交 (`chapter.commit`)**
在 `proseRoutes.ts:519` 执行 `runChapterCommit` 时，必须由单书队列加锁：
```ts
// 规范改造后：
const outcome = await defaultBookAccessManager.queue.withBookLock(root, async () => {
  return runChapterCommit({
    root,
    chapterIndex,
    summary,
    expectedRevision,
    usage: usageFacts,
    extractDelta: ...
    afterRecord: ...
  })
})
```
通过将整个 `runChapterCommit`（含大模型增量抽取、门禁核验、2PC 物理写入、飞轮记账）纳入 `withBookLock`，彻底防止同书多章节或同章节并发提交导致的写前哈希漂移、临时日志交错和状态竞争。

---

## 四、 核心状态唯一合法写入者与更新协议 (Data Ownership & Single-Writer Protocol)

为消除架构中多处随意直接调用 `appendFileSync`、绕过持久化契约的隐式耦合，明确界定四大核心状态的唯一合法写入者（Single Legitimate Writer）与交互协议：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MoZhou 写入所有权拓扑规约                         │
└────────────────────────────────────────────────────────────────────────┘

 [创作者 / 前端 UI]
       │
       ▼ (HTTP 契约)
 ┌──────────────────────────────────────────────────────────────────────┐
 │                     apps/web/server (BFF 路由层)                      │
 │    唯一持有: BookOperationQueue (单书锁) & DataRootProcessLock (进程锁)│
 └──────┬────────────────────┬────────────────────┬─────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
 ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 │ @mozhou/     │     │ @mozhou/     │     │ apps/web/    │
 │ data-plane   │     │ runtime      │     │ server/auth  │
 └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
        │                    │                    │
        ▼                    ▼                    ▼
【状态 1：正典与大纲】  【状态 2：事件账本】   【状态 4：用户与凭据】
· 正文 Markdown       · events.jsonl       · provider_settings.json
· 大纲 outline.json   · 严格只追加          · accounts.json
· 追踪流 *.jsonl      · 成对闭合约束       · billing.sqlite
· 唯一写: data-plane  · 唯一写: PublishBus  · AES-256-GCM 本地加密
        │
        ▼ (派生投影，100% 可重建)
【状态 3：SQLite 投影】
· runtime.sqlite (只读派生副本)
· 唯一更新者: LocalDataPlane (populateProjection / initProjection)
```

### 4.1 状态 1：书稿正典与追踪流 (Canon Manuscripts & Tracking Streams)

- **物理载体**：
  - 章节正文：`<book>/正文/<卷>/第NN章.md`（带 YAML Frontmatter）；
  - 书籍元数据与大纲：`<book>/book.json`、`<book>/大纲/*.json`；
  - 五族事实追踪流：`<book>/追踪/*.jsonl`（`RUNTIME_TRACKING_STREAMS`）。
- **唯一合法写入者**：**`@mozhou/data-plane`（物理数据平面）**。
- **更新协议与落盘规约**：
  1. **禁止直接写主文件**：所有写入操作必须通过统一的原子写入出口；
  2. **禁止固定临时文件名（F-03 修复）**：彻底废止 `${absolutePath}.mozhou-tmp` 的静态文件名。在 `atomicWriteFileSync` 中，必须为临时文件注入随机因子与进程标识：
     ```ts
     const randomSuffix = randomBytes(6).toString('hex')
     const tmp = `${absolutePath}.tmp.${process.pid}.${Date.now()}.${randomSuffix}`
     ```
     确保同一目录下的并发写入或异常残留绝对不会发生临时文件相互践踏覆盖。
  3. **定稿提交走严格 2PC 规约**：遵循 `NEXT-ROUND-01-RECOVERY-SAFETY.md` 规定的数学自愈闭环。

---

### 4.2 状态 2：事件账本 (Runtime Events Ledger)

- **物理载体**：`<book>/.mozhou/events.jsonl`（`packages/data-plane/src/layout.ts:11`，常量 `RUNTIME_EVENTS_PATH`）。
- **唯一合法写入者**：**`@mozhou/runtime` 中的 `PublishBus` 单例**。
- **更新协议与落盘规约**：
  1. **收敛直接 I/O 调用**：禁止在业务代码中任意调用 `node:fs.appendFileSync` 向事件账本写裸数据；
  2. **成对事件强制约束（Event Pairing Invariant）**：
     - `TaskStarted` 必须有对应的 `TaskFinished` 闭合；
     - 存在未闭合的同类 Head 事件时，禁止开启新同类 Head，否则直接抛出 `PairingError`；
  3. **撕裂行容错与单调 Seq**：
     - 每行事件必须包含严格单调递增的整数 `seq`；
     - 读取端遇到尾部破损行（未换行的截断 JSON）执行 Fail-soft 跳过，但必须向系统诊断日志输出告警，禁止静默吞没。

---

### 4.3 状态 3：SQLite 投影数据库 (SQLite Projection Database)

- **物理载体**：`<book>/.mozhou/runtime.sqlite`。
- **唯一合法更新者**：**`@mozhou/data-plane` 中的 `LocalDataPlane` 投影引擎**。
- **定位与架构原则**：
  - **只读派生副本原则**：SQLite 投影仅仅是服务于前端高频多维查询（如树形大纲检索、事实关联过滤）的加速索引，**绝对不是数据所有权的最终源头**。
  - **确定性重建原则**：在任何时刻物理删除 `.mozhou/runtime.sqlite`，调用 `rebuildProjectionFromCanon(root)` 必须能够在零数据丢失的前提下，完全依据 Markdown 与 JSONL 原始正典 100% 幂等重建该库。
- **更新协议**：
  1. 数据库打开统一经过 `openOrRebuild`，校验 `user_version === PROJECTION_SCHEMA_VERSION`；
  2. 投影数据更新严格封装在本地 SQLite 事务中完成；
  3. 业务代码（如 BFF 路由）一律通过 `LocalDataPlane` 暴露的面向对象接口读写，严禁外溢执行任意的 Raw SQL 修改语句。

---

### 4.4 状态 4：账户、凭据与商业订单 (Auth, Provider Credentials & Billing)

- **物理载体**：
  - 供应商端点与密钥：`<dataRoot>/users/<userId>/provider_settings.json`；
  - 账户注册与设备表：`<dataRoot>/accounts/accounts.json`；
  - 商业化订单与权益：`<dataRoot>/billing.sqlite`；
  - 实例加密根密钥：`<dataRoot>/installation.key`。
- **唯一合法写入者**：**`apps/web/server` 对应的内部专有服务**：
  - 密钥配置：`defaultProviderSettingsManager`（`apps/web/server/llm/providerSettings.ts`）；
  - 账户认证：`defaultSessionManager` / `defaultDeviceFlowManager`；
  - 订单权益：`defaultBillingStore`（`apps/web/server/billing/store.ts`）。
- **更新协议与安全规约**：
  1. **主密钥强制保护**：明文 API Key 必须使用由 `installation.key` 派生的 AES-256-GCM 加密后方可落盘；
  2. **多租户严格路径隔离**：托管模式下，每个用户的配置文件必须隔离在独立的 `users/<userId>/` 沙箱路径内，禁止符号链接穿透；
  3. **订单变更 ACID 事务收敛**：支付回调与权益生效必须在 `billing.sqlite` 的单事务内原子完成，严禁拆分为多步无保护的异步操作。

---

## 五、 技术方案实施落位指南 (Implementation Blueprint)

为确保上述规格能以最小开销、最高确定性合入工程，制定如下代码级改动清单：

### 5.1 修改点 1：重构 `packages/data-plane/src/atomic-write.ts`
- **目标**：彻底消除 F-03 临时文件固定命名踩踏缺陷。
- **改动规范**：
  ```ts
  import { randomBytes } from 'node:crypto'
  import { closeSync, fsyncSync, openSync, renameSync, writeSync, unlinkSync } from 'node:fs'

  export function atomicWriteFileSync(absolutePath: string, content: string): void {
    const nonce = randomBytes(6).toString('hex')
    const tmp = `${absolutePath}.tmp.${process.pid}.${Date.now()}.${nonce}`
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, content)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(tmp, absolutePath)
    } catch (err) {
      try { unlinkSync(tmp) } catch { /* ignore cleanup failure */ }
      throw err
    }
  }
  ```

### 5.2 修改点 2：重构 `apps/web/server/bookAccess.ts` 中的 `DataRootProcessLock`
- **目标**：彻底消除 F-02 PID 复用误判与启动假死缺陷。
- **改动规范**：
  - 写入结构化锁指纹（`instanceGuid`, `processStartTime`, `heartbeatTimestamp`）；
  - 引入心跳更新定时器（每 10 秒刷新锁文件的 `heartbeatTimestamp`，`timer.unref()`）；
  - 发现已有锁文件时，结合 `process.kill(pid, 0)`、心跳超时窗口（> 30s 视作僵尸进程）与启动时间戳综合裁决；
  - 打开锁文件采用 `openSync(lockPath, 'wx')` 原子互斥。

### 5.3 修改点 3：补齐 `apps/web/server/routes/proseRoutes.ts` 锁保护
- **目标**：彻底消除 F-04 核心写作与提交路径缺少并发队列保护的问题。
- **改动规范**：
  - 在 `POST /api/chapter.prose.save` 路由处理块中，将 `withBook` 调用包裹进 `defaultBookAccessManager.queue.withBookLock(root, ...)`；
  - 在 `POST /api/chapter.commit` 路由处理块中，将 `runChapterCommit` 调用包裹进 `defaultBookAccessManager.queue.withBookLock(root, ...)`。

---

## 六、 验收门禁与测试用例规划 (Verification & Regression Gates)

阶段二设计实施后，必须通过以下三大硬性回归门禁方可宣告完成：

1. **门禁 GATE-CONC-01：同书并发提交排他与保序验证**
   - **测试文件**：`apps/web/server/routes/proseRoutes.concurrency.test.ts`
   - **验证逻辑**：在隔离测试沙箱中，使用同一个 `root` 同时发起两次 `/api/chapter.commit` 请求。验证第二次请求必须等待第一次请求完全退出释放锁后方可执行，或者直接因版本已变被 409 拒绝，严禁并发交织进入 `runChapterCommit`。
2. **门禁 GATE-CONC-02：锁文件异常残留接管测试 (PID 复用反脆弱)**
   - **测试文件**：`apps/web/server/test-support/instanceLock.test.ts`
   - **验证逻辑**：向 `.mozhou_instance.lock` 写入当前系统中存在的一个无关活进程 PID，但注入过期的时间戳与心跳（如 60 秒前）。验证新实例调用 `acquire()` 能够识破该进程并非墨舟实例，成功接管旧锁并正常启动，不发生假死阻断。
3. **门禁 GATE-CONC-03：原子写入并发独立性测试**
   - **测试文件**：`packages/data-plane/src/atomic-write.test.ts`
   - **验证逻辑**：模拟多进程/多任务对同一个目标路径高频并发执行 `atomicWriteFileSync`，验证盘上临时文件携带各自的随机后缀，彼此互不干扰，最终目标文件保持完整性，零截断文件残留。

---

> **阶段二规约结语**：本技术规格说明书以严谨的工程事实，理清了 MoZhou 在单线程事件循环与多进程拓扑下的并发可达性，消除了 PID 检测误判造成的假死风险，封堵了核心提交路径的漏锁漏洞，并牢固确立了四大核心状态的唯一合法写入者与更新规约，为系统的工业级可信度提供了坚固的并发安全底座。
