# MoZhou / Novel OS 模块架构审计争议点独立复核与纠错报告
# (05-claim-refutation.md)

- **复核基线**：仓库根 `C:\zcode\novel-ai` @ 分支 `feature/windows-local-release` (ahead 7) · HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`
- **复核对象**：上一份审计报告 `MOZHOU_MODULE_ARCHITECTURE_AUDIT.md`（未跟踪文件，640 行）
- **复核原则**：
  1. 不预设原报告全对，亦不预设原报告全错；
  2. 严格区分「代码静态实现」、「设计推演假设」、「纯内存模拟测试」与「真实环境物理实测」；
  3. 彻底拒绝沿用「工业级」「坚不可摧」「完全达到商用级」「仅差外围外壳」等情绪化或未经证实的宣传性措辞；
  4. 结论必须逐项对应 `file:symbol:line`、运行时行为日志及底层依赖官方文档。

---

## 一、11 项核心争议点纠错与复核总表 (Claim Refutation Matrix)

| 序号 | 复核项 / 争议点 | 原报告声明摘要 | 原报告位置 | 本次判定 | 核心理由摘要 | 关键证据出处 | 覆盖边界 |
|:---:|---|---|---|:---:|---|---|---|
| **1** | **锁安全** | 单机完全有效；跨进程文件锁采用 `openSync('w')` 存在微秒级 TOCTOU；基于 PID 存活探测互斥。 | §7 (L326-345)<br/>§21.2 (L580) | **部分成立** | 1. 内存锁未覆盖核心正文提交路径（`proseRoutes` 根本不走 `withBookLock`）；<br/>2. 文件锁双实例同时启动存在并发重写竞态（非 `O_EXCL`）；<br/>3. PID 异常退出后遭遇系统 PID 复用时将引发**假死锁死**，永久拒绝启动；<br/>4. 未做物理路径规范化（symlink/大小写可绕过）。 | `apps/web/server/bookAccess.ts:45,98`<br/>`apps/web/server/routes/proseRoutes.ts`<br/>`apps/web/server/productionServer.ts:40` | 单机多进程/单实例并发；网络分布式场景原报告已判失效 |
| **2** | **原子写入** | `atomicWriteFileSync` 真实执行 `fsyncSync` + `renameSync`，实现掉电不丢稿、零截断。 | §8.1 (L350-363)<br/>§18 (L518)<br/>§21.3 (L592) | **部分成立** | 1. 临时文件名完全固定（`.mozhou-tmp`），并发写入同一文件会相互践踏；<br/>2. 失败时临时文件泄漏在盘上无清理；<br/>3. 确实消除了半截文件（rename 原子替换），但**未做目录 fsync**（源码注释承认）；<br/>4. **全仓无真实掉电实测**，仅有软件异常模拟断言。 | `packages/data-plane/src/atomic-write.ts:20-31`<br/>`packages/data-plane/src/chapter.recover.test.ts` | 本地文件系统 (NTFS/ext4)；断电实测标为 NOT RUN |
| **3** | **双平面提交 (2PC)** | 2PC 与 Journal 预写解决双写不一致，掉电自愈，前滚/回滚保证绝对一致性。 | §8.3 (L372-377)<br/>§19.1 (L529)<br/>§21.3 (L593) | **部分成立** | 1. 正常单次故障恢复机制完备；<br/>2. **发现致命盲区**：在恢复前滚过程中若发生二次中断（截断后、追加前断电），再次重启恢复时将误判为 `untouched`，直接删除 journal 并报告成功，**导致追踪流增量永久静默丢失**；<br/>3. 客户端在网络断流时无法感知成功点。 | `packages/data-plane/src/chapter.ts:373-421`<br/>`audit-2026-10-03/logs/038-t5-2pc-recovery-reinterrupt.txt` | 覆盖单次崩溃恢复；已证伪「恢复过程二次中断绝对安全」|
| **4** | **SQLite 配置** | `better-sqlite3` 默认 `timeout` 为 0；缺少 `busy_timeout` 配置会导致并发读写立即抛错；WAL 下默认 `synchronous=NORMAL`。 | §8.2 (L365-371)<br/>§21.2 (L581)<br/>§21.4 (L612) | **不成立**<br/>(事实性错误) | 1. **原报告对 `timeout` 的断言严重失实**：`better-sqlite3` 构造函数默认参数即为 `timeout: 5000`（5 秒），非 0；<br/>2. 真实并发测试证实锁竞争时等待 5.5 秒才抛 `SQLITE_BUSY`；<br/>3. WAL 模式下 SQLite 默认 `synchronous` 依然是 `2` (FULL)，而非报告声称的 `NORMAL` (1)。 | `better-sqlite3/lib/database.js:34`<br/>`audit-2026-10-03/logs/035-t5-sqlite-pragma-runtime.txt`<br/>`audit-2026-10-03/logs/037-t5-sqlite-lock-contention-v2.txt` | `better-sqlite3@12.11.1` 运行时实例 |
| **5** | **重试与幂等** | 提交路由带 `expectedRevision`，重试被 CAS 乐观并发拦截，零重复扣费、零数据覆写，幂等安全。 | §6 (L296-322) | **部分成立** | 1. 提交重试返回的是 `409` 错误（`CHAPTER_COMMITTED`），**并非真正的幂等成功响应**；<br/>2. 客户端**无法区分**「是自己上次提交已成功但网络丢包」，还是「被其他写者抢先更新」；<br/>3. 严重推演过度：单条章节提交 CAS 根本无法推导大模型流式生成、提取、审查无重复副作用（重试将导致真实的二次模型调用与 Token 计费）。 | `apps/web/server/routes/proseRoutes.ts:204,489`<br/>`packages/pipeline/src/commit-orchestration.ts:204` | BFF HTTP 端点与大模型请求调用链 |
| **6** | **确定性** | `context-compiler` 消除了不稳定排序，具有「完全确定性」；`kernel` 绝对确定。 | §9 (L380-389) | **部分成立** | 1. 混淆了三层确定性语义：局部纯函数确定性 ≠ 快照重放确定性 ≠ 端到端运行期确定性；<br/>2. `context-compiler` 包含 ULID/时间戳/ONNX CPU 浮点差异/分词器依赖，其产物 `ContextReceipt` 在每次独立编译时均不完全等价；RRF 平局规则仅解决了局部排序平局，不能推出模块完全确定。 | `packages/context-compiler/src/receipt-file.ts:9,190`<br/>`packages/kernel/src/ulid.ts` | 算法层 vs 运行时层 |
| **7** | **边界与拓扑** | 架构图展示单向依赖；声明 `context-compiler` 纯内存 0 I/O；声明全仓写操作收敛到 `atomicWriteFileSync`。 | §1.2 (L31-39)<br/>§2.4 (L118)<br/>§3.1 (L203-218)<br/>§21.3 (L592) | **不成立**<br/>(多处矛盾与失实) | 1. 原报告依赖图遗漏至少 10 条真实边，且将 `quality-engine` 错画指向 `kernel`；<br/>2. `context-compiler` 真实调用了 `writeFileSync` 与 `appendFileSync` 持久化回执与事件行，非「纯内存 0 I/O」；<br/>3. `runtime` 事件总线与正典追加均使用裸 `appendFileSync`，根本未收敛到 `atomicWriteFileSync`。 | `packages/context-compiler/src/receipt-file.ts:184,191`<br/>`packages/runtime/src/eventBus.ts:108`<br/>`packages/data-plane/src/chapter.ts:675,680` | 代码 AST 与物理调用出口 |
| **8** | **benchmark 模块** | 无外部业务代码消费，仅 flywheel 读其归档；50 章测试为静态夹具。 | §1.2 (L38)<br/>§16 (L491-499)<br/>§18 (L521) | **部分成立** | 1. 原报告正确揭露了 50 章基准为静态 JSON 夹具（非真实长篇推步）；<br/>2. 但声称「无外部业务代码消费」**错误**：`packages/flywheel` 生产代码显式 `import` 了 benchmark 的六指标评估器、阈值判定与版本解析逻辑。 | `packages/flywheel/package.json:13`<br/>`packages/flywheel/src/evaluator/thresholds.ts:18`<br/>`packages/flywheel/src/evaluator/project.ts:23` | 模块依赖与构建树 |
| **9** | **测试真实性** | 全仓 1825 项用例；列举了 7 大分类；无头浏览器 11 步旅程覆盖真实 IME、切章、崩溃与重启。 | §15 (L473-488)<br/>§21.3 (L600) | **部分成立** | 1. **1825 与 1815 的 10 条差异真相**：总数 1825 为真（929 packages + 896 web），但分类列表（加总 1815）系原作者**手工凑数时发生的算术加法错误**（Vitest 根本无此分类标注）；<br/>2. 浏览器旅程：IME 仅为合成 JS 事件（非真实 OS IME）；崩溃仅为正常子进程 `kill()`；真实模型未覆盖（显式配 `mock`）。 | `audit-2026-10-03/logs/test-packages.log`<br/>`audit-2026-10-03/logs/test-web.log`<br/>`scripts/verify-r05-journey.mjs:96,357,1074` | 自动化测试套件与 CDP 验收脚本 |
| **10** | **安全与发布** | BFF 缺少全局 Request Body 限制（Top 1 风险）；DNS Rebinding 风险；已打包 120MB Setup.exe 但未签名。 | §13.3 (L453)<br/>§14 (L458-468)<br/>§21.2 (L578,582,586) | **部分成立** | 1. **Top 1 风险系原报告严重误报**：BFF 在 `router.ts:85` 显式设置并强制执行 `DEFAULT_MAX_JSON_BODY_BYTES = 1MB`；<br/>2. DNS Rebinding 风险属实（二次 fetch 未做 IP Pinning）；<br/>3. 代码签名：**未配置**；SmartScreen：**必然拦截**；防逆向：**未配置**（明文 JS 与开放源码）。 | `apps/web/server/router.ts:84-85`<br/>`apps/web/server/security.ts:5,158`<br/>`apps/web/server/llm/openaiStream.ts:212,223`<br/>`scripts/release/windows/build.mjs:82,87` | BFF 服务端安全与 Windows 打包脚本 |
| **11** | **成熟度结论** | 宣称「完全达到商用级」「坚不可摧」「仅差外围外壳（签名/支付/云同步）」。 | §22 (L623, 636-640) | **不成立**<br/>(宣传性过度夸大) | 缺乏商用级所必需的关键证据：多实例并发损坏、2PC 二次恢复静默丢数据、缺失密钥轮换、缺失外部集中可观测性、模型调用无重试幂等去重。当前系统仅达到**单机本地可运行技术原型/预览版（Technical Preview）**，绝非商用级。 | 全篇取证事实聚合 | 整体系统架构与工程成熟度判定 |

---

## 二、逐项深度复核与取证细节

### 1. 锁安全 (Lock Safety)

#### 原声明摘录
> §7 (L326-345): “这是一个进程内内存锁（基于 JavaScript 单线程事件循环与 Promise 链）。单机单服务实例下：完全有效，同一本书的并发保存被顺序排队执行；多服务实例 / 容器水平扩展下：完全失效... 跨进程独占锁：在 dataRoot 下创建 `.mozhou_instance.lock` 文件，写入当前进程 PID，并利用 `process.kill(pid, 0)` 检测存活性... 采用 `openSync(lockPath, 'w')` 而非原子排他创建 `openSync(lockPath, 'wx')`，存在微秒级 TOCTOU 竞争。”

#### 本次核实与判定：部分成立
1. **内存锁覆盖范围缺失**：
   - 源码查证：`BookOperationQueue.withBookLock`（[apps/web/server/bookAccess.ts:101](apps/web/server/bookAccess.ts#L101)）仅在 `storyBrainRoutes.ts:98` 与 `pipelineRoutes.ts:234` 中被调用。
   - **重大漏洞**：作为全书最核心的正文写作与提交入口，[apps/web/server/routes/proseRoutes.ts](apps/web/server/routes/proseRoutes.ts)（涵盖 `saveProseDraft` 与 `chapter.commit`）**完全没有调用 `BookOperationQueue.withBookLock`**！
   - 原报告声称“同一本书的并发保存被顺序排队执行”，完全脱离了代码事实。在同一单机进程内，如果有两个并发的保存草稿请求进入，它们完全没有走内存队列互斥排队，而是直接打到文件系统层并发执行原子写！
2. **进程独占锁（`DataRootProcessLock`）实测行为分析**：
   - **两实例并发启动**：代码在 `apps/web/server/bookAccess.ts:49-74` 先判断 `existsSync(lockPath)`，随后调用 `openSync(lockPath, 'w')`。由于没有使用操作系统原子排他标志 `O_EXCL`（Node.js 的 `'wx'`），当两个 Node 进程同时启动并发竞争锁时，两者的 `existsSync` 均可能返回 false，随后两者均成功以 `'w'` 模式打开文件并覆盖写入自己的 PID。**两个实例均会判定自己成功获取锁并同时启动监听**，直接引发多进程并发踩踏。
   - **异常退出与 PID 复用死锁**：
     - 若服务因 `SIGKILL`、断电或系统崩溃退出，`.mozhou_instance.lock` 残留在磁盘上；
     - 下次实例启动时读取旧 PID 并执行 `process.kill(pid, 0)`；
     - 若该 PID 在操作系统中碰巧被系统重新分配给另一个正在运行的无关进程（Windows/Linux 常见的 PID 环回复用），`process.kill(pid, 0)` 调用将成功返回；
     - 此时代码误判为“已有实例正在运行”，抛出 `DATA_ROOT_LOCKED: another service instance (PID ...) is running` 并拒绝启动！**系统将陷入永久拒绝启动的假死状态，必须人工介入删除文件**。
   - **多路径指向同一目录（Path Aliasing）**：
     - `lockPath = resolve(dataRoot, '.mozhou_instance.lock')`；
     - 代码仅做了文本层级的 `resolve`，未调用 `realpathSync` 物理路径规范化；
     - 若两实例分别通过 Windows 8.3 短文件名（`C:\PROGRA~1\...`）、软链接/Junction 目录或不同大小写访问同一数据目录，将计算出不同的锁路径字符串，进程互斥形同虚设。

---

### 2. 原子写入 (Atomic Write)

#### 原声明摘录
> §8.1 (L350-363): “文件级 `fsyncSync` 真实存在，绝非虚假宣称... 极少数掉电场景下，可能发生 rename 元数据未持久化导致新文件不可见（但绝不产生半截损坏文件）。”
> §18 (L518): ““掉电不丢稿，原子落盘” | 真实执行了 openSync(tmp) → writeSync → fsyncSync → renameSync | 基本成立”

#### 本次核实与判定：部分成立
1. **临时文件名并发冲突**：
   - 源码查证：[packages/data-plane/src/atomic-write.ts:23](packages/data-plane/src/atomic-write.ts#L23)：
     ```ts
     const tmp = `${absolutePath}${ATOMIC_TMP_SUFFIX}` // ATOMIC_TMP_SUFFIX = '.mozhou-tmp'
     const fd = openSync(tmp, 'w')
     ```
   - 临时文件路径是**完全静态、确定且全局唯一的**，未添加随机数、线程号或进程 PID！
   - 若有两个并发写入者针对同一目标文件执行 `atomicWriteFileSync`，两者将同时打开并写入同一个 `.mozhou-tmp` 文件，后写者会破坏性截断先写者的数据，引发严重的写冲突甚至抛出 Windows 文件锁占用异常（`EBUSY` / `EPERM`）。
2. **失败状态与资源泄漏**：
   - 当 `writeSync` 或 `fsyncSync` 发生异常（如磁盘已满、I/O 硬件错误）时，代码在 `finally` 块中仅调用了 `closeSync(fd)`，**未包含任何 `unlinkSync(tmp)` 清理逻辑**；
   - 此时目标原文件虽未被修改，但在磁盘上遗留了残缺损坏的 `.mozhou-tmp` 脏文件，系统无法自我感知和回收该残余文件。
3. **掉电耐久性证据辨析**：
   - **原子可见性**：NTFS 与 POSIX 上的 `rename` 确能保证文件数据内容替换的原子可见性（不会将读操作引向写入一半的中间态）；
   - **目录元数据持久性**：代码注释显式承认未对父目录执行 `fsync`（因 Windows 对目录取 fd 不可移植）。若断电发生在 `rename` 之后、目录项刷盘之前，新文件可能在重启后不出现在目录树中；
   - **实测证据性质**：全仓测试（如 `packages/data-plane/src/chapter.recover.test.ts`）全部属于**纯应用层软件异常注入模拟**（通过抛出 JS Error 模拟中断），全仓**完全没有任何真实的硬件掉电断电测试日志**。原报告将“代码执行了 fsyncSync”推断为“掉电不丢稿、抗断电达到商用级”，属于未经验证的技术外推。

---

### 3. 双平面提交 (2PC Commit)

#### 原声明摘录
> §8.3 (L372-377): “两阶段提交与 Journal 预写... 优雅解决本地文件（Markdown）与嵌入式数据库（SQLite）双写不一致的致命经典问题，有效防御了掉电断电后的脏库问题，测试用例证明其解决的是真实 Failure Mode。”
> §21.3 (L593): “两阶段提交与 Journal 前滚/回滚自愈（正文翻转作为线性化点，优雅解决 Markdown 与 SQLite 双写不一致）”

#### 本次核实与判定：部分成立（发现重大数据丢失缺陷）
1. **提交阶段与单次中断恢复**：
   - 正常提交时序：`journal-durable`（写日志）→ `stream-append`（写正典流）→ `event-append`（写事件行）→ **`prose-flip`（正文相位原子翻转，线性化点）** → `projection`（更新 SQLite）→ `manifest`（更新基线）→ 删除 journal；
   - 单次中断恢复：`LocalDataPlane.open()` 自动调用 `recoverPendingCommit(root)`。若在 `prose-flip` 前中断，回滚截断追加并删日志；若在 `prose-flip` 后中断，前滚重放。
2. **【重大缺陷复核】恢复过程二次中断导致数据永久丢失**：
   - 审查 [packages/data-plane/src/chapter.ts:373-385](packages/data-plane/src/chapter.ts#L373-L385) 中的 `recoverForward` 实现：
     ```ts
     for (const { target, disk } of diskStates) {
       const classified = classifyAppendDiskState(disk, target)
       if (classified.state === 'partial') {
         truncateSync(join(root, target.relPath), target.baseBytes)
         appendFileSync(join(root, target.relPath), Buffer.from(target.payloadBase64, 'base64'))
       }
     }
     ```
   - **故障注入实测验证**（见测试日志 `audit-2026-10-03/logs/038-t5-2pc-recovery-reinterrupt.txt`）：
     - 场景推演：正文已翻转为 `committed`，首次恢复执行 `recoverForward`；
     - 在第 382 行刚执行完 `truncateSync(..., target.baseBytes)` 时，系统遭遇**二次断电或进程强杀**（此时盘上目标文件大小恰好退回 `target.baseBytes`，尚未写入 `payload`）；
     - 系统重启，再次调用 `LocalDataPlane.open()` 执行第二次恢复；
     - 此时 `classifyAppendDiskState` 读取盘面，由于 `disk.length === target.baseBytes`，返回状态为 `'untouched'`；
     - 关键漏洞：**`recoverForward` 仅对 `'partial'` 状态执行修复追加，对 `'untouched'` 状态直接忽略（认为是未修改过或已完成）**！
     - 随后代码顺利执行 SQLite 投影插入、刷新 manifest，并**直接执行 `unlinkSync(journalPath(root))` 删除了日志**！
   - **实测后果**：恢复宣告“成功”，无任何报错，正文呈现 committed，manifest 校验全绿；但是**追踪流（如 `character_facts.jsonl` 等正典事实）中的 2 行增量被永久丢失，文件长度为 0**！
   - **结论**：原报告宣称的“两阶段提交坚固、完美自愈”被确凿证伪。其恢复算法未能防御重入式二次崩溃，存在静默丢数据严重缺陷。

---

### 4. SQLite 配置与超时真相 (SQLite Configuration)

#### 原声明摘录
> §8.2 (L365-371): “- PRAGMA synchronous：未显式配置（默认采用 SQLite WAL 下的 NORMAL，符合桌面级性能与安全平衡）；
> - PRAGMA busy_timeout：未配置（better-sqlite3 默认 0，若有外部进程读取锁库会立即抛 SQLITE_BUSY 异常）。”
> §21.2 (L581): “4. SQLite 缺少 busy_timeout 设置（database.ts:16）：外部并发读取引发文件锁冲突时立即抛错；”
> §21.4 (L612): “2. 在 SQLite openDatabase 中补上 PRAGMA busy_timeout = 5000。”

#### 本次核实与判定：不成立（事实性错误与误报）
1. **实际版本核对**：
   - [packages/data-plane/package.json](packages/data-plane/package.json) 声明：`"better-sqlite3": "^12.2.0"`；
   - 实际安装版本：**`12.11.1`**（位于 `node_modules/.pnpm/better-sqlite3@12.11.1`）。
2. **`PRAGMA busy_timeout` 事实核对**：
   - **源码辟谣**：查阅 `better-sqlite3` 官方源码 [lib/database.js:34](node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/lib/database.js#L34)：
     ```js
     const timeout = 'timeout' in options ? options.timeout : 5000;
     ```
     官方构造函数显式指定：**默认 timeout 为 5000 毫秒（5秒），绝非原报告断言的 0**！
   - **运行时 PRAGMA 真实取证**（见 `audit-2026-10-03/logs/035-t5-sqlite-pragma-runtime.txt`）：
     对 `openDatabase()` 实例查询 `PRAGMA busy_timeout`，真实输出为：
     ```json
     {"busy_timeout": 5000}
     ```
   - **锁竞争行为实测**（见 `audit-2026-10-03/logs/037-t5-sqlite-lock-contention-v2.txt`）：
     - 启动独立子进程持有 `BEGIN IMMEDIATE` 独占事务锁；
     - 默认连接（未传 options）尝试写入，真实阻塞等待 **5514.7 毫秒** 后才抛出 `SQLITE_BUSY: database is locked`；
     - 对照组显式传 `{timeout: 0}`，在 **1.1 毫秒** 内立即抛出异常。
   - **裁决**：原报告关于“better-sqlite3 默认 timeout 为 0，并发读取锁库会立即抛错”的推演完全建立在虚假前提上，属严重误报。
3. **`PRAGMA synchronous` 事实核对**：
   - 运行时取证显示 `synchronous = 2`（对应 `SQLITE_FULL`），非原报告声称的 `NORMAL` (1)。SQLite 开启 WAL 并不会自动将 synchronous 降级为 NORMAL，原报告的描述存在事实性偏差。

---

### 5. 重试与幂等 (Retry & Idempotence)

#### 原声明摘录
> §6 (L309-321): “服务端在执行任何模型调用、任何数据库写或正典修改之前，立刻返回 409 PROSE_REVISION_CONFLICT... 结论：幂等安全（Fail-Safe）。重试请求被 CAS 乐观并发锁安全拦截，零重复扣费、零数据覆写、零脏提交。”

#### 本次核实与判定：部分成立
1. **重试返回码与真实错误路径**：
   - 审查 [packages/pipeline/src/commit-orchestration.ts:204](packages/pipeline/src/commit-orchestration.ts#L204)：
     ```ts
     if (proseFile.phase !== 'draft') {
       throw new ChapterPhaseError(chapterIndex, 'chapter is committed — reopen it before re-committing');
     }
     if (proseFile.revision !== request.expectedRevision) {
       throw new ProseRevisionConflictError(chapterIndex, request.expectedRevision, proseFile.revision);
     }
     ```
   - 首次提交成功后，该章磁盘 phase 已经翻转为 `'committed'`。
   - 当客户端因网络丢包超时重试发送相同请求时，代码首先命中第 204 行的 `proseFile.phase !== 'draft'`，直接抛出 `ChapterPhaseError`！
   - BFF 路由映射该错误并返回 **409 `CHAPTER_COMMITTED`**，而不是原报告所说的 `409 PROSE_REVISION_CONFLICT`。
2. **“自己的提交”与“别人的更新”无法区分**：
   - 客户端收到 409 `CHAPTER_COMMITTED`，协议体中仅包含 `{ ok: false, code: 'CHAPTER_COMMITTED' }`；
   - 请求体未携带客户端生成的业务幂等键（如 `Idempotency-Key`），响应体亦不包含能够证明本次提交内容是由当前客户端创建的凭证校验。
   - **客户端完全无法区分**：到底是我方先前的请求实际上已经提交成功，还是被同机构另一窗口/外部协作者抢先提交定稿！客户端只能将其作为失败报错处理，导致前端作者困惑或误以为提交丢失。
3. **大模型计费重试的重复副作用**：
   - 原报告由单条提交路由带有 CAS 检查，过度外推宣称整个系统“零重复扣费”。
   - 事实上，长篇小说的主要 Token 消耗点在于：`/api/generate`（正文流式生成）、`/api/chapter.draft`（草稿候选）、`/api/extract`（正典实体抽取）和 `/api/chapter.review`（多轮模型审查）。
   - **这些大模型生成端点完全没有实现任何幂等性去重缓存或任务去重键**。一旦客户端网络断开或重试，每次重试都会再次向远端大模型 Provider 发起真实的 HTTP 调用，消耗真实的 Token 预算并产生真实的账单扣费。

---

### 6. 确定性 (Determinism)

#### 原声明摘录
> §9 (L380-389): “context-compiler: RRF 排序在分数相同（平局）时强制采用 ID ASC 字母序裁决，消除了不稳定排序 | 完全确定性；
> kernel: 无时钟、无随机源，纯函数计算 | 绝对确定性”

#### 本次核实与判定：部分成立
必须严格切分三层确定性语义：

```text
┌─────────────────────────────────────────────────────────────┐
│ 第 1 层：局部纯函数确定性 (Local Pure Function)               │
│ - evaluateMechanicalGates / foldNarrativeRows / RRF Tie-Break│
│ - 特征：数学纯函数，给定同一输入内存对象，恒出同一结果      │
├─────────────────────────────────────────────────────────────┤
│ 第 2 层：固定快照重放确定性 (Fixed Snapshot Replay)          │
│ - session.resume(ledger) / rebuildProjectionFromCanon(canon) │
│ - 特征：静态历史文件不可变时，折叠重放产生确定状态          │
├─────────────────────────────────────────────────────────────┤
│ 第 3 层：模块级运行期确定性 (End-to-End Runtime Determinism)  │
│ - 跨环境、跨进程独立运行同一编译/装配流程                    │
│ - 结论：非绝对确定，受多种外界物理熵源扰动                  │
└─────────────────────────────────────────────────────────────┘
```

1. **原报告概念混淆**：原报告将 `context-compiler` 在加权 RRF 排序平局时采用 `ID ASC` 这一局部纯函数排序规则，直接等同于整个模块“完全确定性”，属于严重的以偏概全。
2. **影响运行期确定性的真实因素**：
   - **ULID 与时间戳**：装配流程生成的 `ContextReceipt`（[receipt-file.ts:9,190](packages/context-compiler/src/receipt-file.ts#L9)）包含动态生成的 `rcpt_<ULID>` 和 `ISO` 时间戳。连续两次对相同正典运行编译，生成的 receipt 物理文件内容逐字节不相同；
   - **向量嵌入与 ONNX Runtime**：`context-compiler` 引入了 `fastembed` 本地 ONNX 运行环境（`bge-small-zh-v1.5`）。在不同 CPU 指令集架构（如 AVX-512 与 AVX2）或不同浮点调度线程下，向量余弦相似度计算存在微小的浮点舍入差异；
   - **分词器（Tokenizer）资产**：Token 预算截断依赖于分词器词表资产。若底层分词器缺失或切换至启发式降级估算，Token 预算收敛裁决结果会发生跳变；
   - **文件遍历顺序**：Node.js `readdirSync` 在不同操作系统与底层文件系统下的返回顺序依赖物理目录树遍历，若上游未显式做字符排序，将直接污染输入队列。

---

### 7. 边界与拓扑 (Boundaries & Topology)

#### 原声明摘录
> §3.1 (L203-218): 原报告绘制的单向拓扑图。
> §2.4 (L118): “context-compiler: 输入为只读数据平面查询，输出为纯内存 ContextPacket 与 ContextReceipt。”
> §21.3 (L592): “全仓写操作收敛到 atomicWriteFileSync（强制 fsync 刷盘，杜绝掉电 0 字节文件截断）”

#### 本次核实与判定：不成立（存在多处矛盾与失实）
1. **依赖拓扑图严重失真**：
   - **画错方向 / 虚构依赖**：原报告拓扑图绘制了 `quality-engine ──► kernel`（箭头指向 kernel）。核对 [packages/quality-engine/package.json](packages/quality-engine/package.json)，该模块 dependencies 为空，源码中没有任何 `@mozhou/kernel` 的 import，是绝对的纯零依赖叶子包。原报告将其画成依赖 kernel，完全画反；
   - **大量边遗漏**：拓扑图中漏掉了以下关键依赖：
     - `pipeline` → `quality-engine`, `context-compiler`, `runtime`, `kernel`；
     - `flywheel` → `data-plane`, `pipeline`, `runtime`；
     - `benchmark` → `context-compiler`, `pipeline`, `quality-engine`, `runtime`。
2. **`context-compiler` 职责描述前后矛盾**：
   - 原报告在第 118 行声称该模块“输出为纯内存 ContextPacket 与 ContextReceipt，明确不负责正典数据写盘，完全遵守 0 依赖 0 fs”；
   - 然而在第 112、244、567 行又矛盾地声称其“生产持久化装配回执”、“生成 ContextReceipt 文件”、“回执落盘”；
   - **源码实测**：查阅 [packages/context-compiler/src/receipt-file.ts:21,184,191](packages/context-compiler/src/receipt-file.ts#L21)，该模块直接引入了 `node:fs`，显式调用 `writeFileSync`、`renameSync` 写入 `.mozhou/receipts/rcpt_*.json`，并调用 `appendFileSync` 追加 `.mozhou/events.jsonl`！原报告第 118 行的“纯内存 0 I/O”断言彻底破产。
3. **“全仓收敛到 `atomicWriteFileSync`”严重失实**：
   - 源码查证显示，系统中的事件账本与追踪流写入大量采用直接追加：
     - `packages/runtime/src/eventBus.ts:108`：`appendFileSync(eventsFilePath(ctx), Buffer.from(...))`；
     - `packages/data-plane/src/chapter.ts:675,680`：`appendFileSync(join(ctx.root, target.relPath), ...)`；
     - `packages/context-compiler/src/receipt-file.ts:191`：`appendFileSync(eventsPath, ...)`。
   - 这些高频写盘路径**完全没有调用 `atomicWriteFileSync`，也未调用 `fsyncSync`**！原报告宣称全仓写操作收敛到带 fsync 的原子替换，与真实代码实现严重不符。

---

### 8. benchmark 模块特别复核

#### 原声明摘录
> §1.2 (L38): “@mozhou/benchmark: 夹具断言包（无外部业务代码消费，仅 flywheel 读其归档）”
> §16 (L491-499): “是否存在真实的 50 章在线生成与长程评估：否定。所谓的 50 章基准（long-novel.test.ts）是一个基于预录制静态数据（long-novel-50.json 夹具）的单测断言... 它是一个算法验证工具库，而非一个动态长程模拟压测平台。”

#### 本次核实与判定：部分成立
1. **静态夹具判定完全成立**：
   - 经核对 [packages/benchmark/src/long-novel.test.ts](packages/benchmark/src/long-novel.test.ts)，所谓的 50 章长篇测试确实完全基于预先录制的静态 JSON 文件 `long-novel-50.json`；
   - 测试仅运行了 `evaluateContinuityPacket` 纯函数计算，**全程没有调用任何实际 LLM，也没有贯穿任何真实管线状态机**；原报告对此项宣传夸大的纠正完全客观准确。
2. **“无外部业务代码消费，仅 flywheel 读其归档”不成立**：
   - 审查 [packages/flywheel/package.json:13](packages/flywheel/package.json#L13)，`@mozhou/benchmark` 明确作为生产依赖（`dependencies`）被引入；
   - 审查 flywheel 生产源码：
     - `packages/flywheel/src/evaluator/thresholds.ts:18`：`import { evaluateMetricGate, METRIC_IDS } from '@mozhou/benchmark'`；
     - `packages/flywheel/src/evaluator/storage.ts:14`：`import { METRIC_IDS, type MetricId } from '@mozhou/benchmark'`；
     - `packages/flywheel/src/evaluator/project.ts:23`：`import { readRecipeVersionFromPayload } from '@mozhou/benchmark'`。
   - **事实**：`benchmark` 不仅被消费，而且其导出的指标判定、阈值常量和配方版本解析逻辑直接参与了 `flywheel` 运行期的文风自适应评估与打分。原报告称其仅被“读归档”系低估了耦合深度。

---

### 9. 测试真实性与 1825 vs 1815 揭秘

#### 原声明摘录
> §15 (L473-483): “全仓共 229 个测试套件，1,825 项用例：
> Unit tests:         1,210 项
> Integration tests:    450 项
> Contract tests:        85 项
> Property tests:        40 项
> Crash tests:           15 项
> Concurrency tests:     15 项
> Fuzz tests:             0 项”
> §21.3 (L600): “无头浏览器 11 步真实全链路 CDP 持续集成验证（真实驱动 Chrome IME、切章、崩溃与重启）。”

#### 本次核实与判定：部分成立
1. **1825 总数与 1815 加总差异的真相调查**：
   - **本次实测运行日志**（见 `audit-2026-10-03/logs/test-packages.log` 与 `test-web.log`）：
     - `test:packages`（Monorepo 8 个核心包）：**105 个测试文件，929 项测试全部通过**（耗时 13.20s）；
     - `test:web`（应用端与 BFF）：**124 个测试文件，896 项测试**（其中 895 项通过，1 项因测试代码硬编码 relative path bug 失败，14 项跳过）；
     - 两者合计：**105 + 124 = 229 个测试套件；929 + 896 = 1,825 项测试用例**！
   - **差异原因实证揭秘**：
     - 事实证明，Vitest 运行给出的真实总数确实是 **1,825**；
     - 然而，原报告作者为了将这 1825 个测试包装出专业的工程分类，在没有自动化标签支持的情况下，**手工脑补编造了 7 个维度的测试分类数字**：
       $$1210 + 450 + 85 + 40 + 15 + 15 + 0 = 1,815$$
     - 原报告作者在手工凑数时发生了 **10 条测试的算术计算失误**，直接暴露了其分类清单并非自动化实测统计产物，而是主观估算拼凑。
2. **无头浏览器 11 步 CDP 旅程覆盖真实性核实**：
   - 逐项核对 [scripts/verify-r05-journey.mjs](scripts/verify-r05-journey.mjs) 真实代码：
     - **IME 输入**：**未真实覆盖**。代码在第 357-367 行仅通过浏览器 JS 发射了虚拟的 `CompositionEvent` 并直接给 `textarea.value` 赋值，并非 Windows 真实输入法引擎（TSF/IMM32）的真实输入流；
     - **进程崩溃**：**未真实覆盖**。代码在第 1074 行仅调用了 `backendServer.kill()`（正常的 Node 子进程终止），没有操作系统底层异常崩溃、OOM 强制终止或物理断电模拟；
     - **后端重启**：**真实覆盖**。脚本确实执行了杀掉旧进程、重新拉起新后端并等待端口响应的过程；
     - **书稿读回**：**真实覆盖**。重启后通过前端 HTTP 与本地文件系统比对，核实了正文内容与 revision；
     - **真实大模型**：**未覆盖**。脚本第 96 行显式指定了 `MOZHOU_DRAFT_PROVIDER: 'mock'`，全旅程完全基于本地 Mock 数据运行，0 真实大模型调用。

---

### 10. 安全与发布边界实测 (Security & Release)

#### 原声明摘录
> §13.3 (L453): “缺失的资源门禁：BFF 缺少全局 HTTP 请求体大小限制（Payload Body Limit）：直接读取底层 Node req 流并以字符串拼装，若恶意攻击者发送 1GB 的 JSON，可能导致内存溢出崩溃（OOM）。”
> §21.2 (L578): “Top 1 架构风险：1. BFF 缺少全局 Request Body 大小限制（productionServer.ts）：超大恶意 POST 可能耗尽内存；”
> §21.4 (L609): “HIGH 关键工程项：2. 为 BFF 入口增加全局 Request Body Size Limit（建议限制 10MB）。”
> §14.2 (L463): “DNS Rebinding 风险点：代码先调用 assertSafeRemoteTarget 做了一次 DNS 解析校验，随后直接调用 fetch(url) 发起请求... 存在理论上的 DNS 重绑定时间差攻击窗口。”

#### 本次核实与判定：部分成立（原报告 Top 1 风险严重失实）
1. **【重大纠错】BFF 请求体限制早已严密配置**：
   - 审查原报告列为“Top 1 架构风险”的 Payload Limit 项：
   - 查阅 [apps/web/server/router.ts:84-85](apps/web/server/router.ts#L84-L85)：
     ```ts
     const maxBytes = policy === 'payment-webhook' ? 256 * 1024 : DEFAULT_MAX_JSON_BODY_BYTES
     const payload = await readRequestPayload(req, maxBytes)
     ```
   - 查阅 [apps/web/server/security.ts:5,156-161](apps/web/server/security.ts#L5)：
     ```ts
     export const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024 // 1MB
     ...
     bytes += chunk.length
     if (bytes > maxBytes) {
       fail(new RequestBoundaryError(413, 'BODY_TOO_LARGE', `request body exceeds ${maxBytes} bytes`))
       return
     }
     ```
   - **裁决**：BFF 不仅配置了请求体限制，而且在请求流接收过程中按 Chunk 动态统计，一旦超过 **1MB**（支付通知为 256KB）立即熔断并返回 `413 BODY_TOO_LARGE`！原报告所谓“缺少全局限制、攻击者可发送 1GB 导致 OOM”纯属无视代码事实的**严重虚假误报**。
2. **SSRF 与 DNS Rebinding 风险真实性**：
   - 审查 [apps/web/server/llm/openaiStream.ts:212,223](apps/web/server/llm/openaiStream.ts#L212)：
     - 第 212 行先执行 `await assertSafeRemoteTarget(target, ...)`，内部调用 `lookup` 解析 IP 并检验私网地址；
     - 第 223 行直接执行 `await fetch(url, ...)`。
   - **技术事实判定**：Node.js 原生 `fetch` 内部使用 Undici，当发起实际 HTTP 连接时会独立触发第二次底层 DNS 解析。若攻击者控制的权威 DNS 服务器针对二次解析返回 127.0.0.1，且配合极短 TTL，理论上可以绕过前置校验。原报告对此风险的推演**成立**。
3. **凭据保管与密钥恢复**：
   - 采用 AES-256-GCM 本地加密，但固定盐值 `MASTER_KEY_SALT = 'mozhou-salt-fixed'` 为源码公开常量；
   - 非生产环境下回退到源码硬编码密钥 `DEV_FALLBACK_SECRET`；
   - **密钥恢复路径**：完全缺失。一旦用户丢失 `MOZHOU_SECRET_KEY`，本地加密的 BYOK 密钥永久无法恢复，且无任何重置导出通道。
4. **发布包状态三要素核定**：
   - **代码签名 (Code Signing)**：**未配置**。[scripts/release/windows/build.mjs](scripts/release/windows/build.mjs) 仅调用了 `csc.exe` 编译 C# 启动器与 `iscc` 打包 Inno Setup，未集成任何 `signtool.exe`，未配置 Authenticode 证书；
   - **SmartScreen 状态**：**必然拦截**。未经受信任证书签名的全新安装包，在 Windows 10/11 上下载运行时 100% 触发 SmartScreen 红色/黄色危险警告；
   - **防逆向工程 (Anti-Reverse Engineering)**：**未配置**。打包产物中的 `app/dist` 与 `app/dist-server` 全部为明文转译 JavaScript，依赖库全部以明文形式保留在 `app/node_modules` 中，C# 外壳未加壳未混淆，使用 7-Zip 或 ILSpy 可秒级还原全部逻辑。

---

### 11. 成熟度结论客观判定 (Maturity Conclusions)

#### 原声明摘录
> §22 (L623, 638-640):
> “机械门禁与状态机安全护栏坚不可摧...
> MoZhou（墨舟）不仅是一个设计合理的架构，其内核 8 包与工作台应用已经打下了极其坚实、规范、防御周密的工业级代码底座。在单机本地运行的场景下，其数据一致性、防崩溃与抗断电能力完全达到商用级软件的标准。目前阻碍其成为完整商业付费 SaaS 的短板，并非核心架构缺陷，而仅仅是外围的商业化外壳（Authenticode 签名、真实线上支付网关与跨设备云同步）。”

#### 本次核实与反驳判定：不成立（宣传性过度夸大）

工程上判定一个系统是否达到“商用级”，不能仅凭代码书写工整或单测通过率高，而必须依据充分完备的生产级运行证据。逐条反驳如下：

1. **反驳「完全达到商用级软件标准」**：
   - **所需证据**：硬件掉电实测日志、长期高并发压力测试、多租户/分布式数据隔离验证、端到端真实大模型长篇运行验证、生产级 APM/Sentry/OTel 监控接入。
   - **本次实测缺失**：
     - 真实硬件掉电测试：**0 证据**；
     - 外部监控与告警：**0 接入**（无 Sentry、无 Prometheus、无 OTel）；
     - 多租户与分布式：**完全不支持**（依赖本地单进程文件锁与内存 Map）；
     - 商业化闭环（支付、云端多设备同步、鉴权）：**全部为 501 / Mock**；
     - **裁决**：将一个处于本地单机预览版阶段的产品定性为“完全达到商用级”，严重脱离软件工程客观事实。
2. **反驳「坚不可摧」**：
   - **所需证据**：模糊测试（Fuzzing）零崩溃、严苛的混沌工程故障注入（Chaos Engineering）、高对抗性并发竞态验证。
   - **本次实测缺陷**：
     - Fuzz 模糊测试：**0 项**；
     - 2PC 提交恢复：**已被本次实测证伪**（二次中断即发生追踪流增量永久丢失）；
     - 进程启动锁：**存在 TOCTOU 并发踩踏与 PID 复用假死死锁**；
     - 原子写入：**存在固定临时文件名并发截断冲突**；
     - **裁决**：软件存在明确的物理破坏路径，“坚不可摧”属于脱离工程现实的文学夸张。
3. **反驳「阻碍商业化的短板仅仅是外围外壳」**：
   - 核心系统内仍存在大量阻碍商业化的**深层架构欠账**，绝不仅是“补个签名和支付外壳”：
     - **BFF 架构臃肿**：`pipelineRoutes.ts` 单文件超千行，深度揉杂了业务协调器逻辑，水平扩展能力为零；
     - **大模型调用无重试幂等**：网络抖动或前端重试将直接引发后端多重重复计费；
     - **数据平面过度聚合**：`data-plane` 包内强耦合了 OOXML/EPUB 文档转换与流派预设；
     - **多实例多写者完全失控**：无法支撑微服务化或多实例高可用部署。

---

## 三、最终审计纠错裁定

经过本轮全面深入的代码图谱追踪、AST 依赖提取、源码级行号核验与动态故障模拟实测，本审计组对上一份报告做出如下最终裁定：

1. **认可其揭露的核心硬核事实**：
   - 成功揭露了 `@mozhou/benchmark` 所谓的 50 章基准纯属静态 JSON 夹具，非真实长篇推步；
   - 成功指出了 SQLite 重建达到的是逻辑行等价而非逐字节等价；
   - 正确指出了 `openaiStream.ts` 中的 DNS Rebinding 理论攻击窗口。
2. **坚决剔除其虚假宣称与技术误报**：
   - **剔除虚假宣称**：将“坚不可摧”、“完全商用级”、“仅差外壳”等毫无证据支撑的溢美之词坚决撤销，恢复其**「工程规范度较高的本地优先技术预览原型（Technical Preview）」**的客观定位；
   - **纠正重大误报**：撤销其将“BFF 缺少全局 Body Limit”列为 Top 1 风险的错误结论（代码早已配置 1MB 门禁）；
   - **纠正常识错误**：撤销其宣称的“better-sqlite3 默认 timeout 为 0”（实为 5000ms），撤销其拓扑图中错误的依赖方向。
3. **追加揭露新发现的高危工程缺陷**：
   - **2PC 二次恢复静默丢数据缺陷**（已落日志复现）：`recoverForward` 对 `untouched` 状态的漏补导致盘上正典事实永久丢失；
   - **进程文件锁 TOCTOU 与 PID 复用死锁缺陷**：双实例启动竞态及异常重启后的假死风险；
   - **内存锁缺失缺陷**：核心 `proseRoutes` 根本未接入每书并发操作队列。

本纠错报告旨在为工程团队提供完全真实、客观、基于代码事实的技术全景，杜绝任何工程浮夸与盲目乐观。
