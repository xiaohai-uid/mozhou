# 墨舟 (MoZhou / Novel OS) 下一轮方案输入与演进约束
# (NEXT-ROUND-INPUT.md)

> **文档属性**：架构演进输入材料（只提供有依据的改进方向与硬约束，不输出盲目重构代码）  
> **基线标识**：HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb` / WORKTREE(42 项未提交改动)  
> **输入来源**：`audit-2026-10-03` 下 01–07 阶段产物与实测发现清单 `FINDINGS.md`  

---

## 一、 最先需要处理的高危风险清单 (Top 3 Priority Fixes)

在启动任何功能迭代或架构扩展之前，必须优先收敛以下 3 项已被隔离实测确证的系统级隐患：

### 1. 修复 2PC 提交恢复前滚二次中断丢数据缺陷 (F-01)
- **风险等级**：**CRITICAL (致命)**
- **涉及模块与文件**：`@mozhou/data-plane` 中的 `packages/data-plane/src/chapter.ts:379-385` [`HEAD:90b45a1`]。
- **问题本质**：`recoverForward` 在执行 `truncateSync(target.baseBytes)` 后与 `appendFileSync` 重放补齐之间若发生二次断电强杀，再次重启时物理长度 `size === baseBytes` 会被误判为 `untouched`，导致删除预写日志宣布恢复成功，增量事实永久静默丢失。
- **改进约束**：
  - 严禁在恢复未完成前直接原地物理破坏性截断原正典追踪流文件；
  - 必须采用**影子增量补齐（Shadow Staging File）**或在恢复日志中显式打入 `forward_in_progress` 二级状态位；
  - 验收条件：二次故障注入探针 `probe-07` 重测通过，连续两次断电强杀后重启，追踪流增量数据完整无缺。

### 2. 根治数据根进程独占锁 PID 复用死锁 (F-02)
- **风险等级**：**CRITICAL (致命)**
- **涉及模块与文件**：`apps/web/server` 中的 `apps/web/server/bookAccess.ts:51-68` [`HEAD:90b45a1`]。
- **问题本质**：依赖脆弱的 `process.kill(pid, 0)`。当实例异常退出残留锁文件，而旧 PID 被操作系统重新分配给其他无关运行进程时，应用陷入永久无法启动的假死状态。
- **改进约束**：
  - 锁文件中除记录 PID 外，必须引入当前进程启动时间戳与随机 Instance Token；
  - 在 Windows 发行版下，统一收敛到 `MoZhou.cs` 已实现的 Win32 命名内核互斥体（`Named Mutex: Local\MoZhou-{hash}`），由 OS 内核自动在进程死亡时释放句柄；
  - 验收条件：探针 `probe-03` 重测通过，残留 PID 为系统存活进程时，系统能依据启动签名智能识别并安全接管锁。

### 3. 原子写临时文件名唯一化与正文写路径补锁 (F-03 & F-04)
- **风险等级**：**HIGH (高危)**
- **涉及模块与文件**：
  - `packages/data-plane/src/atomic-write.ts:23` [`HEAD:90b45a1`]
  - `apps/web/server/routes/proseRoutes.ts:293,480` [`HEAD:90b45a1`]
- **问题本质**：`atomicWriteFileSync` 使用固定 `.mozhou-tmp` 后缀导致并发写同一文件时数据践踏；且核心正文写路径 `proseRoutes.ts` 完全未调用 `BookOperationQueue.withBookLock`。
- **改进约束**：
  - 临时文件名必须采用高熵唯一名：`${absolutePath}.${randomUUID()}.tmp`；
  - 在 `proseRoutes.ts` 中针对 `saveProseDraft` 与 `chapter.commit` 显式接入 `defaultBookAccessManager.withBookLock`；
  - 临时文件失败在 `finally` 必须增加显式 `unlinkSync` 兜底清理；
  - 验收条件：探针 `probe-01` 与并发写入测试通过，磁盘零脏文件泄漏。

---

## 二、 必须保持的系统不变量 (Invariants to Preserve)

后续方案无论如何演进，绝不能破坏以下已经证明合理的底层架构红线：

1. **正典文件最终权威不变量 (Canon File Sovereignty)**：
   - 物理 Markdown 文件（`正文/第一卷/第NN章.md`）与纯文本 JSONL 流（`追踪/*.jsonl`、`.mozhou/events.jsonl`）是书籍数据的唯一权威真源；
   - SQLite 数据库（`.mozhou/runtime.sqlite`）**必须严格保持为从属、可丢弃的只读投影**，正文文本严禁写入 SQLite；
   - 任何时刻物理删除 SQLite 库，系统均能通过 `rebuildProjectionFromCanon` 100% 幂等无损自愈。
2. **两阶段提交原子性不变量 (2PC Linearization)**：
   - 定稿提交的线性化点（Linearization Point）恒定为**正文 Markdown frontmatter 中的相位翻转（`atomicReplace` 写入 `phase: committed`）**；
   - 翻转前任何崩溃必须能够安全后滚（Recover Backward）；翻转后任何崩溃必须能够前滚补齐（Recover Forward）。
3. **版本 CAS 乐观锁防静默覆盖不变量**：
   - 所有修改正文的写接口（保存草稿、采纳候选、撤销采纳、定稿提交）必须强制在调用链上传递并校验 `expectedRevision`；
   - 严禁引入无版本参数的“盲保存”或“强制静默覆盖”端点。
4. **上下文凭证不可变不变量 (Receipt Immutability per INV-R2)**：
   - `.mozhou/receipts/rcpt_<ULID>.json` 一经落盘，内容绝对不可篡改；任何修正必须铸造全新 ULID 新证；
   - 质量审查必须基于真实的 `ContextCompiled` 凭证锚点，严禁伪造锚点。

---

## 三、 需要调整的架构边界与迁移约束

### 1. 消除跨层穿透引用 (BFF / Client Boundary Clean-up)
- **当前违例**：`apps/web/src/public/PublicSite.tsx:12` 直接引用了服务端特权代码 `apps/web/server/billing/catalog.ts` 的 `billingCatalog` 单例。
- **调整方案**：将产品价格与套餐元数据抽离到共享包（如 `@mozhou/kernel`）纯类型契约中，或由前端统一通过 `GET /api/billing/plans` HTTP 接口异步获取，严禁将服务端包含敏感加签逻辑的文件打入前端 bundle。

### 2. 收敛 Windows 桌面宿主双轨制 (Desktop Host Consolidation)
- **当前违例**：`src-tauri` 为 12 行空壳代码，桌面打包由 `MoZhou.cs`（C# 托盘编排）+ `desktop-server.mjs` 实际承担，两处架构形态分叉，版本号脱节（0.2.0 vs 0.3.0）。
- **调整方案**：
  - 明确产品主推形态：若采用轻量 WebView2 + C# 托盘宿主（`MoZhou.exe`），应将 `src-tauri` 正式归档并移除冗余脚本；
  - 统一全仓版本号契约，杜绝 `Cargo.toml`、`package.json` 与安装包脚本之间的版本漂移。

### 3. 数据根路径判定双轨制统一 (Data Root Unification)
- **当前违例**：`dataRoot.ts` 在缺少环境变量时静默回落到 `cwd/.mozhou_data`，而发行版入口 `desktop-server.mjs` 则强制要求 `MOZHOU_DATA_ROOT` 缺失直接抛错退出。
- **调整方案**：收敛为单一的 `resolveDataRoot()` 共享模块，规定统一的回落规则与退出行为，避免因运行入口不同导致数据写入不同物理目录。

---

## 四、 商业发布前的未决问题与准入要求 (Go/No-Go Gate)

若产品拟推向真正的用户桌面版本或商业化运营，必须满足以下准入硬指标，当前状态一律判定为 **NOT READY (未就绪)**：

1. **代码签名证书就绪**：必须在 CI 打包流水线中配置受信任机构颁发的代码签名证书，执行 `signtool.exe` 对 `MoZhou.exe` 与安装包进行数字签名，消除 Windows Defender / SmartScreen 拦截；
2. **大模型重试幂等去重网关**：在大模型网关层建立基于 `operationId` 的全局调用账本，拦截网络超时导致的重复流式生成与提取扣费；
3. **真实商业支付联调**：接入真实的微信/支付宝官方商户平台，完成公网异步 Webhook 验签、丢单补单对账与掉单轮询实测，替换当前的 `mock_checkout` 虚拟链接；
4. **前端编译代码混淆与防逆向**：在发布构建脚本中引入生产级代码混淆（Terser / Obfuscator），对核心商业规则与敏感加密逻辑进行防护。

---

## 五、 演进纪律声明 (Anti-Corruption Rules)

1. **禁止为了“迎合架构图整洁”而虚构抽象层**：不得无故拆分已经高内聚的 `data-plane`，不得凭空引入沉重的 ORM 框架或分布式消息中间件；
2. **禁止破坏本地优先纯粹性**：墨舟的核心壁垒是“纯本地离线可用、数据全归作者所有”，任何云同步或账户能力必须作为可选插件外挂，严禁强依赖远程云端服务才能开机写作；
3. **禁止将未实测的方案作为既成事实**：所有迁移与修复方案必须附带可复核的自动化测试套件（Vitest）与系统级探针，通过真实运行结果验收。
