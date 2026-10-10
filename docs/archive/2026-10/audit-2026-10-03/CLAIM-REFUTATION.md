# 墨舟 (MoZhou / Novel OS) 架构审计原报告纠错表
# (CLAIM-REFUTATION.md)

> **审计基线**：仓库根 `C:\zcode\novel-ai` @ 分支 `feature/windows-local-release` (ahead 7) · HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`  
> **复核对象**：上一份审计报告 `MOZHOU_MODULE_ARCHITECTURE_AUDIT.md`（未跟踪文件，640 行）  
> **审计口径**：`audit-2026-10-03/00-audit-charter.md`，对齐 `05-claim-refutation.md` 与 `07-crosscheck-review.md` 对抗式交叉复核裁决  
> **审计员**：module-mapper-2 (深度综合) · 审计日期：2026-10-03  

---

## 一、 11 项争议点纠错与复核总览表

| 序号 | 争议点 / 审计命题 | 原报告声明与位置 | 本次独立判定 | 核心纠错理由与代码/实测证据 | 适用范围与覆盖边界 |
|:---:|---|---|:---:|---|---|
| **01** | **锁安全与并发控制** | §7 (L326-345): 单机单服务下完全有效，同一本书并发保存被顺序排队；跨进程文件锁带存活探测。 | **部分成立** | 1. **内存锁漏锁核心路径**：`BookOperationQueue.withBookLock` 仅在 `storyBrainRoutes` 与 `pipelineRoutes` 挂载，核心正文写路径 `proseRoutes.ts`（涵盖 `saveProseDraft` 与 `chapter.commit`）**完全未走此锁**（`HEAD:90b45a1`）；<br/>2. **文件锁非原子排他**：`bookAccess.ts:51` 采用 `openSync('w')` 而非 `O_EXCL` (`'wx'`)，双实例并发启动存在重写竞态；<br/>3. **PID 复用假死死锁**：若实例异常退出且旧 PID 被系统复用分配给无关存活进程，`process.kill(pid, 0)` 误判导致系统永久抛 `DATA_ROOT_LOCKED` 拒绝启动（实测 `probe-03` 证实）。 | 单机多进程/并发线程；跨物理机分布式锁原报告已判失效。 |
| **02** | **原子落盘与掉电耐久性** | §8.1 (L350-363), §18 (L518): 真实执行 `fsyncSync` + `renameSync`，掉电不丢稿，抗断电达到商用级。 | **部分成立**<br/>(真实断电未验证) | 1. **临时文件名完全固定**：`atomicWriteFileSync`（`atomic-write.ts:23` `HEAD:90b45a1`）使用确定性后缀 `.mozhou-tmp`，并发写同一文件会发生互踩破坏；<br/>2. **失败无清理**：I/O 失败时在 `finally` 仅关闭 fd，脏临时文件泄漏在磁盘上（实测 `probe-01`, `probe-08`）；<br/>3. **未做目录 fsync**：代码注释显式承认未对父目录执行 fsync，断电可能丢失目录项索引；<br/>4. **掉电测试缺失**：全仓均为应用层软件抛 Error 模拟断言，**真实物理硬件掉电/拔盘未验证（标为 NOT RUN）**。 | 本地单机文件系统 (NTFS/ext4)；硬件级掉电属于未验证盲区。 |
| **03** | **双平面提交 2PC 与事务自愈** | §8.3 (L372-377), §19.1 (L529): 2PC 与 Journal 预写解决双写不一致，掉电自愈，前滚/回滚保证绝对一致性。 | **部分成立**<br/>(发现严重缺陷) | 1. 正常单次故障恢复机制完备；<br/>2. **重大自愈盲区（二次中断丢数据）**：`packages/data-plane/src/chapter.ts:379-385`（`HEAD:90b45a1`）在 `recoverForward` 过程中若遭遇二次中断（截断后、追加前再次断电），二次重启恢复时将把 `size === baseBytes` 误判为 `untouched`，直接删除 journal 并报告成功，**导致追踪流正典增量永久静默丢失**（实测 `logs/038` 与 `probe-07` 证实）。 | 单次进程崩溃自愈成立；二次中断自愈被实测证伪。 |
| **04** | **SQLite 配置与并发行为** | §8.2 (L365-371), §21.4 (L612): better-sqlite3 默认 timeout 为 0；缺少 busy_timeout；WAL 下默认 synchronous=NORMAL。 | **不成立**<br/>(原报告事实性错误) | 1. **默认 timeout 辟谣**：`better-sqlite3` 官方构造函数（`better-sqlite3/lib/database.js:34`）默认参数显式定义 `timeout: 5000`（5秒），根本不是 0！实测并发锁竞争时等待 5.5 秒才抛 `SQLITE_BUSY`（`logs/037`）；<br/>2. **WAL synchronous 辟谣**：SQLite 官方规范及运行时 PRAGMA 实测证实，开启 WAL 后默认 `synchronous` 依然是 `2` (FULL)，而非原报告声称的 `NORMAL` (`logs/035`)。 | `better-sqlite3@12.11.1` 运行时实例配置与官方规范。 |
| **05** | **提交重试与幂等机制** | §6 (L296-322): expectedRevision 保证提交幂等，重试被 CAS 乐观并发拦截，零重复扣费、零数据覆写。 | **部分成立** | 1. **409 非真正幂等**：章节提交重试收到的是 `409 CHAPTER_COMMITTED`（`proseRoutes.ts:599` `HEAD:90b45a1`），客户端无法直接区分是自己重试还是他人篡改；<br/>2. **模型调用重试重复扣费**：单章 CAS 仅保护正文磁盘写，大模型流式生成与 Final Extract 增量抽取在动盘前执行，重试必定产生真实的二次模型调用与 Token 计费。 | BFF HTTP 端点与外部大模型调用链。 |
| **06** | **系统确定性边界** | §9 (L380-389): context-compiler 消除了不稳定排序，具有完全确定性；kernel 绝对确定。 | **部分成立** | 1. **混淆三层确定性语义**：局部纯函数确定性 ≠ 快照重放确定性 ≠ 端到端运行期确定性；<br/>2. **非完全确定**：`context-compiler` 包含 ULID 生成、时间戳、ONNX CPU 浮点差异及分词器环境依赖，多次独立运行产生的 `ContextReceipt` 并不完全相同；RRF 平局规则仅解决局部排序，不能推导系统完全确定。 | 算法层 vs 运行时层。 |
| **07** | **模块依赖边界与文件 I/O 收敛** | §1.2 (L31-39), §2.4 (L118), §21.3 (L592): 架构单向依赖；context-compiler 纯内存 0 I/O；写操作收敛到 atomicWriteFileSync。 | **不成立**<br/>(多处失实与矛盾) | 1. **依赖图严重失真**：原报告依赖图遗漏至少 10 条真实边，且将 `quality-engine` 错画指向 `kernel`；<br/>2. **物理 I/O 声称失实**：`context-compiler` 真实调用 `writeFileSync` 写 `receipts/` 物理文件，非纯内存 0 I/O；<br/>3. **未收敛原子写**：`runtime` 事件总线与数据平面正典增量追加大量直接使用裸 `appendFileSync`，根本未收敛到 `atomicWriteFileSync`。 | 代码 AST、模块依赖图与物理 I/O 出口。 |
| **08** | **benchmark 模块性质** | §1.2 (L38), §16 (L491-499): 无外部业务代码消费，仅 flywheel 读其归档；50 章测试为静态夹具。 | **部分成立** | 1. 正确揭露了 50 章长程基准为静态 JSON 夹具（非真实在线连载）；<br/>2. 但声称「无外部业务代码消费」**错误**：`packages/flywheel` 生产代码显式导入了 benchmark 的六指标评估器、阈值判定与版本解析逻辑（`flywheel/package.json:13`）。 | 模块构建树与生产代码依赖。 |
| **09** | **测试套件真实性与分类统计** | §15 (L473-488), §21.3 (L600): 全仓 1825 项用例；列举了 7 大分类；无头浏览器旅程覆盖真实 IME、崩溃自愈。 | **部分成立**<br/>(破获凑数算术错误) | 1. **1825 vs 1815 破案**：全仓测试总数 1825（packages 929 + web 896）属实；但原报告给出的 7 分类（加总为 1815）的 10 项缺口，系原作者**手工主观凑数时的算术加法失误**（Vitest 原生根本无此类目标记）；<br/>2. **无头浏览器限制**：IME 仅为合成 JS 模拟事件；崩溃仅为正常子进程 kill；大模型完全为 mock。 | 自动化测试套件与 CDP 验收脚本。 |
| **10** | **系统安全与发布规范** | §13.3 (L453), §14 (L458-468): BFF 缺 Request Body 限制为 Top 1 风险；DNS Rebinding 风险；安装包未签名。 | **部分成立**<br/>(纠正重大误报) | 1. **Top 1 风险系原报告严重误报**：BFF 在 `router.ts:85`（`HEAD:90b45a1`）早已显式配置并强制执行 `DEFAULT_MAX_JSON_BODY_BYTES = 1MB` 流式熔断；<br/>2. **DNS Rebinding 属实**：二次 fetch 缺少 IP Pinning 校验；<br/>3. **安装包缺陷属实**：Windows 安装包未配置数字签名（SmartScreen 必然拦截）、明文 JS 无混淆防逆向。 | BFF 网关防护与 Windows 发布打包脚本。 |
| **11** | **商业成熟度整体定性** | §22 (L623, 636-640): 宣称「完全商用级」「坚不可摧」「仅差外壳（签名/支付/云同步）」。 | **不成立**<br/>(宣传性过度夸大) | 缺乏商用级所必需的关键指标支持：2PC 二次恢复静默丢数据、多实例启动互踩、大模型重试无去重重复扣费、支付为虚拟 mock。当前定性应为**工程规范度较高的本地优先技术预览原型 (Technical Preview)**，绝非商用级。 | 系统架构全景成熟度判定。 |

---

## 二、 逐项纠错深度技术论证

### 1. 锁安全 (Lock Safety)
- **原报告声明**：单机单服务实例下完全有效，同一本书的并发保存被顺序排队执行；跨进程通过 PID 探测互斥。
- **本次复核证据**：
  1. 查阅 `apps/web/server/bookAccess.ts:101`（`BookOperationQueue.withBookLock`），该锁仅在 `storyBrainRoutes.ts` 与 `pipelineRoutes.ts` 部分操作中被引用。而处理正文草稿保存与定稿提交的核心路由 `apps/web/server/routes/proseRoutes.ts`（`saveProseDraft` / `chapter.commit`）**完全没有调用 `withBookLock`**。在同一进程内发起并发保存，请求直接穿透到文件系统层并发执行原子写，原报告声称的“顺序排队执行”与源码直接相悖；
  2. 查阅 `bookAccess.ts:51`，进程锁先执行 `existsSync` 再执行 `openSync('w')`，未设置操作系统排他标志 `O_EXCL` (`'wx'`)，高并发同时拉起两进程存在覆盖抢锁漏洞；
  3. `probe-03` 实测表明：当进程被强制杀死后，若操作系统将残留 PID 分配给系统无关存活进程，下次启动时 `process.kill(pid, 0)` 将成功返回，引发永久假死死锁。

### 2. 原子写入 (Atomic Write)
- **原报告声明**：文件级 `fsyncSync` 真实存在，实现掉电不丢稿、零截断。
- **本次复核证据**：
  1. 查阅 `packages/data-plane/src/atomic-write.ts:23`：临时文件后缀固定为 `.mozhou-tmp`，未引入随机数、PID 或线程标识。并发写同一目标文件必定产生写冲突甚至 `EBUSY` 异常；
  2. `atomic-write.ts` 源码注释显式承认未对父目录执行 `fsync`；
  3. 全仓所有测试（包括 `chapter.recover.test.ts`）全部为纯软件抛 Error 模拟，**全仓无任何物理断电、拔盘与掉电刷盘实测记录**。原报告将软件模拟外推为“掉电不丢稿商用级”属于未经验证的过度断言。

### 3. 双平面提交 2PC (Two-Phase Commit)
- **原报告声明**：2PC 与预写日志解决双写不一致，掉电自愈，前滚/回滚保证绝对一致性。
- **本次复核证据**：
  1. 单次故障恢复逻辑虽具备，但在 `audit-2026-10-03/logs/038-t5-2pc-recovery-reinterrupt.txt` 与 `probe-07` 的严密实测中发现严重漏洞：
  2. 当系统处于 `recoverForward` 状态时，首先执行 `truncateSync(target.baseBytes)` 将文件截断回基准大小，若在执行后续 `appendFileSync` 之前再次断电发生**二次中断**；
  3. 下次重启时，代码读取物理盘面发现 `size === baseBytes`，错误将其分类为 `untouched`，进而跳过内容补偿并直接调用 `unlinkSync` 删除预写日志 `pending_commit.json`，**导致追踪流增量永久静默丢失**。

### 4. SQLite 配置 (SQLite Pragma)
- **原报告声明**：better-sqlite3 默认 timeout 为 0；缺少 busy_timeout；WAL 下默认 synchronous=NORMAL。
- **本次复核证据**：
  1. 查阅 `node_modules/.../better-sqlite3/lib/database.js:34`，构造函数默认形参为 `timeout = 5000`；
  2. 查阅 `audit-2026-10-03/logs/035-t5-sqlite-pragma-runtime.txt`，运行时 PRAGMA 实测证实 `busy_timeout` 恒为 5000ms；
  3. 查阅 `audit-2026-10-03/logs/037-t5-sqlite-lock-contention-v2.txt`，并发锁竞争测试严格在 5.5 秒后超时抛出 `SQLITE_BUSY`；
  4. 查阅 SQLite 官方文档与日志实测，WAL 模式下 `synchronous` 默认值依然是 `2` (FULL)。原报告关于 SQLite 配置的两大核心断言系事实性错误。

### 5. 重试与幂等 (Retry & Idempotency)
- **原报告声明**：提交路由带 expectedRevision，重试被 CAS 拦截，零重复扣费、零数据覆写。
- **本次复核证据**：
  1. 查阅 `proseRoutes.ts:599`，章节定稿提交成功后盘面已进入 `committed` 状态，重复提交返回的是 HTTP 409 `CHAPTER_ALREADY_COMMITTED`，客户端不能据此确证前次提交是否成功，需拉取快照比对 `commitId`；
  2. 大模型生成（`draft.stream`）与终稿事实提取（`FINAL_EXTRACT`）缺乏服务端全局业务防重去重机制，网络超时导致的请求重试将发起全新的外部大模型请求，造成重复 Token 扣费。

### 6. 确定性 (Determinism)
- **原报告声明**：context-compiler 消除了不稳定排序，具有完全确定性。
- **本次复核证据**：
  1. 查阅 `packages/context-compiler/src/receipt-file.ts:9,190` 与 `packages/kernel/src/ulid.ts`，`ContextReceipt` 包含随时间单调递增的 ULID 与执行时间戳，且本地向量模型受 ONNX CPU 浮点舍入及分词器影响；
  2. 确定性仅存在于给定快照下的 RRF 平局排序规则，端到端运行期不具备完全确定性。

### 7. 边界与拓扑 (Architecture Topology)
- **原报告声明**：单向依赖无环；context-compiler 纯内存 0 I/O；写操作收敛到 atomicWriteFileSync。
- **本次复核证据**：
  1. 原报告拓扑图遗漏了 `flywheel -> benchmark`、`web-client -> billingCatalog` 等至少 10 条真实边，且将 `quality-engine` 画为依赖 `kernel`（实际 quality-engine 零依赖）；
  2. `packages/context-compiler/src/receipt-file.ts:184` 显式调用 `writeFileSync` 写回执文件，调用 `appendFileSync` 写事件行，并非纯内存 0 I/O；
  3. `packages/runtime/src/eventBus.ts:108` 与 `packages/data-plane/src/chapter.ts:675` 大量使用裸 `appendFileSync`，全仓写操作并未收敛到 `atomicWriteFileSync`。

### 8. benchmark 模块 (Benchmark Role)
- **原报告声明**：无外部业务代码消费，仅 flywheel 读其归档；50 章测试为静态夹具。
- **本次复核证据**：
  1. 查阅 `packages/flywheel/src/evaluator/thresholds.ts:18` 与 `project.ts:23`，flywheel 生产代码显式 `import { evaluateChapterRules, parseBenchmarkProfile } from '@mozhou/benchmark'`；
  2. 原报告所谓“无外部业务代码消费”失实；但其认定 50 章基准为静态夹具属实。

### 9. 测试真实性 (Test Suite Provenance)
- **原报告声明**：全仓 1825 项用例；列举 7 大分类；无头浏览器旅程覆盖真实 IME。
- **本次复核证据**：
  1. Vitest 真实执行结果为 1825 项通过（packages 929 + web 896，见 `logs/test-packages.log` 与 `logs/test-web.log`）；
  2. 原报告所列 7 分类数字相加为 1815 项，经查系原作者在手工编排分类时发生的手工心算加法失误（Vitest 根本无此类目分组）；
  3. CDP 验收脚本 `scripts/verify-r05-journey.mjs` 中的 IME 输入系通过合成 `dispatchEvent` 触发，大模型配置为 mock。

### 10. 安全与发布 (Security & Release)
- **原报告声明**：BFF 缺少 Request Body 限制为 Top 1 风险；DNS Rebinding 风险；安装包未签名。
- **本次复核证据**：
  1. 查阅 `apps/web/server/router.ts:85` 与 `security.ts:5,158`，BFF 在网关底层显式强制了 `DEFAULT_MAX_JSON_BODY_BYTES = 1MB` 限制，超限立即抛出 413 熔断。原报告 Top 1 风险系重大误报；
  2. 查阅 `scripts/release/windows/build.mjs:82,87`，发布流程未配置签名，源码未经混淆，属于明文技术预览形态。

### 11. 商业成熟度定性 (Maturity Verdict)
- **原报告声明**：完全达到商用级标准，坚不可摧，仅差外壳。
- **本次复核证据**：
  综合上述 10 项缺陷（尤其是 2PC 二次恢复静默丢数据、多实例启动互踩、大模型重复扣费、商业支付仅为虚拟 mock），原报告关于“商用级”的断言属于严重的宣传性夸大。当前真实成熟度判定为：**本地优先高防御度技术原型 / 预览版 (Technical Preview)**。
