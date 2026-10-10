# 07 · 对抗式交叉复核审查报告
# (07-crosscheck-review.md)

- **复核基线**：仓库根 `C:\zcode\novel-ai` @ 分支 `feature/windows-local-release` (ahead 7) · HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`
- **复核输入**：`audit-2026-10-03\` 下 `01-baseline-and-graph-gate.md`、`02-module-inventory-and-boundaries.md`、`03-author-path-trace.md`、`04-interface-contracts.md`、`05-claim-refutation.md`、`06-verification-log.md` 全部产物
- **复核原则**：
  1. **完全对抗式视角**：以最严苛的工程怀疑态度，审查本团队其他成员产物中的漏洞、臆测、笔误、越界外推与证据脱节问题；
  2. **事实与未知彻底分离**：严禁将“未实测的假设”表述为“已证实的事实”，凡缺乏直接运行或源码依据的结论坚决要求降级或驳回；
  3. **逐条回溯源码**：亲自对关键证据引用的行号、符号、物理路径执行二次核验，杜绝虚构文件名与路径幻觉。

---

## 一、 交叉复核核心裁决摘要

本次对抗式交叉复核共抽查核验了 **22 条关键技术结论**，全面审查了全团队已产出的 6 份审计文档。主要发现如下：

1. **整体成果扎实度**：
   - 团队在「真实运行单元清点（14 单元）」、「SQLite timeout=5000ms 辟谣」、「1825 vs 1815 算术计算漏洞揭露」、「2PC 二次恢复静默丢数据缺陷复现」以及「BFF 1MB 请求体限制事实查正」等核心命题上，证据扎实、逻辑严密，经二次源码与日志复核**完全成立**。
2. **审查揭出的 6 项重大偏差与瑕疵（已驳回）**：
   - ❌ **虚构物理路径幻觉**：`02` 报告在表 2.3.1 中臆造了 `<book>/chapters/ch-*.md`、`<book>/.mozhou/runtime-events.jsonl` 等路径；实际代码为 `正文/第一卷/第0001章.md` 与 `.mozhou/events.jsonl`；
   - ❌ **虚构导出器源码文件名**：`03` 报告在导出路径中臆造了 `docx-submission-exporter.ts`、`epub-submission-exporter.ts`、`txt-clean-exporter.ts`；实际源码文件名为 `docx-export.ts`、`epub-export.ts`、`txt-clean.ts`；
   - ❌ **正典目录混淆**：`03` 报告多处将追踪流目录 `追踪/` 误写为设定目录 `设定/`（如误写为 `设定/事实.jsonl`）；
   - ❌ **React 异步生命周期误判**：`03` 报告将 React 18 的 `useEffect` 状态持久化断言为“同 Tick 同步写入，不存在未落盘风险”，忽视了浏览器渲染调度异步性；
   - ❌ **Mock 商业支付过度包装**：`04` 报告将仅生成 `mock_checkout` 虚拟 URL 且无任何真实商户凭据的商业支付模块评定为最高等级「强保证 (STRONG)」，严重违反事实与未知分离原则；
   - ❌ **锁保护范围过度外推**：`04` 报告声称 `rebuildProjectionFromCanon` 受 `withBookLock` 保护，但源码查证证实该函数为裸函数导出，内部根本未获取该锁。

---

## 二、 抽查通过项清单 (Verified & Sound Claims)

本审计员亲自回到 HEAD:90b45a1 源码、工作区活代码与运行时配置，对下列 16 条关键结论进行了逐行二次核对，**确认全部属实、证据确凿、可完全追溯**：

| # | 被抽查结论 | 来源文档与位置 | 核查源码 / 配置出处 | 核对结果与事实分析 |
|:---:|---|---|---|:---:|
| **V01** | `src-tauri` 仅 12 行空壳代码，不拉起 Node 服务端 | `02` (L60, Card 11) | `src-tauri/src/main.rs:1-12` | **通过**。确为 12 行原生外壳，仅有 `println!`，未见任何 sidecar 或 node 进程拉起。 |
| **V02** | `benchmark` 生产代码零运行时 JS 依赖（全为 `import type`） | `02` (L130, Card 08) | `packages/benchmark/src/index.ts`<br/>`metrics.ts`, `run.ts` | **通过**。生产代码全部为算法纯函数，外部 `@mozhou/*` 依赖编译后全部被 tsc 擦除。 |
| **V03** | `quality-engine/de-ai` 具备浏览器安全独立子路径导出 | `02` (L136, Card 02) | `packages/quality-engine/package.json:8-17`<br/>`dist/de-ai.js` | **通过**。子路径成功剔除 `node:crypto` 与 `node:fs`，被 `EditorQualityTelemetry.tsx` 安全消费。 |
| **V04** | `apps/web/src` 跨层直接引用服务端 `billingCatalog` 单例 | `02` (L141, §2.1.2) | `apps/web/src/public/PublicSite.tsx:12` | **通过**。前端直接 `import { billingCatalog } from '../../server/billing/catalog'`，形成穿透。 |
| **V05** | `MoZhou.cs` Win32 命名 Mutex 互斥与托盘编排逻辑 | `02` (L194, §2.2.3) | `scripts/release/windows/MoZhou.cs:38-58` | **通过**。`Local\MoZhou-{SHA256}` 互斥体及双击唤醒浏览器逻辑逐行对应。 |
| **V06** | 导出路由具备防空章守卫（`EXPORT_EMPTY_CHAPTER` 409） | `04` (L260, §2.8) | `apps/web/server/routes/exportRoutes.ts:60-68` | **通过**。检测到 `content.trim().length === 0` 时严格返回 409 拦截。 |
| **V07** | 文学审查缺乏 Context 凭证时强制返回 `NO_COMPILED_RECEIPT` | `03` (L258, §2.7) | `apps/web/server/routes/pipelineRoutes.ts:793-801` | **通过**。`resolveCompiledAnchor(root, chapterIndex)` 为空时拒绝虚构凭证。 |
| **V08** | 采纳候选具备意图文件（Intent Pattern）双向真幂等 | `04` (L95, §2.2) | `packages/pipeline/src/draft-accept.ts:192-238` | **通过**。`findIntentByKey` 配合 `idempotencyKey`，二次提交直接返回 `alreadyApplied: true`。 |
| **V09** | `better-sqlite3` 构造函数默认 timeout = 5000ms（非 0） | `05` (L21, 142) | `node_modules/.../better-sqlite3/lib/database.js:34`<br/>`logs/035`, `logs/037` | **通过**。官方代码显式赋值 5000，运行时 pragma 及并发实测 5.5s 阻断完全吻合。 |
| **V10** | `atomicWriteFileSync` 采用确定性固定临时文件名且无目录 fsync | `05` (L19, 70) | `packages/data-plane/src/atomic-write.ts:20-31` | **通过**。`tmp = ${path}.mozhou-tmp`，并发互踩风险属实，注释承认无目录 fsync。 |
| **V11** | 进程独占锁存在 PID 复用死锁风险 | `05` (L18, 48)<br/>`06` (L33, 96) | `apps/web/server/bookAccess.ts:51-68`<br/>`logs/verification/probe-03` | **通过**。当写入存活系统进程 PID 时，`kill(pid, 0)` 返回成功致使服务永久拒启。 |
| **V12** | 2PC 提交恢复在二次中断下导致正典增量永久静默丢失 | `05` (L20, 93)<br/>`06` (L37, 137) | `packages/data-plane/src/chapter.ts:379-385`<br/>`logs/038`, `probe-07` | **通过**。`recoverForward` 对 `size === baseBytes` 误判为 `untouched`，丢弃增量并删 journal。 |
| **V13** | BFF 服务端已严密配置 1MB 请求体限制（超标 413 熔断） | `05` (L27, 215) | `apps/web/server/router.ts:84-85`<br/>`security.ts:5, 158` | **通过**。`DEFAULT_MAX_JSON_BODY_BYTES = 1MB` 真实生效，推翻旧报告 Top 1 风险。 |
| **V14** | Vitest 全仓总数 1,825 项属实（1815 系人工心算失误） | `05` (L26, 178) | `logs/test-packages.log` (929)<br/>`logs/test-web.log` (896) | **通过**。929 + 896 = 1825。原报告 7 类数字相加得 1815，确为凑数时的算术失误。 |
| **V15** | Windows 发布安装包未配置签名且源码无混淆防逆向 | `05` (L27, 240) | `scripts/release/windows/build.mjs:82, 87-94` | **通过**。仅调用 `csc` 与 `iscc`，无 `signtool`，`app/dist` 均为明文 JS。 |
| **V16** | 旧版 SQLite 投影在 `openOrRebuild` 下 100% 幂等自愈 | `06` (L41, 245) | `packages/data-plane/src/local-data-plane.ts:451`<br/>`probe-11` | **通过**。`PRAGMA user_version = 1` 错配时，成功从 Markdown 全量重建表结构并升版至 2。 |

---

## 三、 驳回项清单 (Rejected / Defective Claims)

以下 6 项结论存在事实性错误、虚构路径或严重推定过度，**正式予以驳回，必须由执笔者在最终总结中修正**：

### 1. 【驳回 01 · 严重度: HIGH】`02` 报告表 2.3.1 臆造正典与事件物理路径
- **原文位置**：`audit-2026-10-03/02-module-inventory-and-boundaries.md` 第 213–219 行（表 2.3.1 持久化矩阵）。
- **原文问题**：
  - 行 213 将正典书稿路径写为：`<book>/chapters/ch-*.md`；
  - 行 215 将事件账本路径写为：`<book>/.mozhou/runtime-events.jsonl`；
  - 行 217 将文风画像路径写为：`<book>/.mozhou/preference/<book>/style-profiles.yaml`。
- **事实与代码证据**：
  - 查阅唯一布局真源 [packages/data-plane/src/layout.ts:25,60-89](packages/data-plane/src/layout.ts#L25)：
    - 正文章节唯一合法路径为：`正文/第一卷/第0001章.md`（常量 `VOLUME_ONE_PROSE_DIR`）；
    - 事件账本唯一合法路径为：`.mozhou/events.jsonl`（常量 `RUNTIME_EVENTS_PATH`）；
    - 文风画像唯一合法路径为：`文风.md`（书根根目录常量 `STYLE_PROFILE_PATH`）。
- **要求修正**：表 2.3.1 必须彻底替换为 `layout.ts` 规定的真实 POSIX 路径，严禁使用类似通用开源软件的臆测路径。

---

### 2. 【驳回 02 · 严重度: MEDIUM】`03` 报告虚构导出器源码文件名
- **原文位置**：`audit-2026-10-03/03-author-path-trace.md` 第 384–386 行（步骤 2.10）。
- **原文问题**：
  - 宣称 `txt` 导出实现于 `packages/data-plane/src/txt-clean-exporter.ts`；
  - 宣称 `docx` 导出实现于 `packages/data-plane/src/docx-submission-exporter.ts`；
  - 宣称 `epub` 导出实现于 `packages/data-plane/src/epub-submission-exporter.ts`。
- **事实与代码证据**：
  - 查阅 `packages/data-plane/src/` 目录树，上述三个带 `-exporter.ts` 的文件**在仓库中根本不存在（Glob 结果为 0）**！
  - 真实源码文件名对应为：`txt-clean.ts`、`docx-export.ts`、`epub-export.ts`。
- **要求修正**：修正所有引用位置为真实文件名，剔除 `-exporter` 幻觉后缀。

---

### 3. 【驳回 03 · 严重度: MEDIUM】`03` 报告混淆「设定」目录与「追踪」目录
- **原文位置**：`audit-2026-10-03/03-author-path-trace.md` 第 309、311 行（步骤 2.8）与第 477 行（表第 5 类）。
- **原文问题**：
  - 第 309 行：“核对正文与所有目标追踪流（`设定/*.jsonl`）的写前哈希”；
  - 第 311 行：“向 `设定/事实.jsonl` 等目标文件追加增量”；
  - 第 477 行：“已提交正典：正文 + `设定/*.jsonl`”。
- **事实与代码证据**：
  - `packages/data-plane/src/layout.ts:24-36` 明确定义：`设定/` 是实体卡片目录（`设定/人物`、`设定/物品` 等 Markdown 文件）；而五族 JSONL 追踪流属于 `追踪/` 目录（`追踪/事实.jsonl`、`追踪/认知.jsonl` 等）。
- **要求修正**：将所有提及追踪流 jsonl 的父级目录统一更正为 `追踪/`。

---

### 4. 【驳回 04 · 严重度: LOW】`03` 报告将 React 18 `useEffect` 误述为同步落盘
- **原文位置**：`audit-2026-10-03/03-author-path-trace.md` 第 61–63 行（步骤 2.1）与第 88 行。
- **原文问题**：“React 状态 `setBook(nextBook)` 更新后，触发 `useEffect` 执行 `saveWorkbenchState`，同步写入浏览器的 `localStorage`... 不存在未落盘风险。”
- **事实与代码证据**：
  - 在 React 18 并发渲染模型中，`useEffect` 属于**浏览器完成绘制（Paint）后的被动异步回调**。若组件在渲染后、浏览器空闲前被异常切断（如进程崩溃或页面卡死刷新），`useEffect` 根本不会被调度执行。
- **要求修正**：说明前端 `localStorage` 的暂存存在毫秒级异步窗口，不能等同于“同步无延迟物理落盘”。

---

### 5. 【驳回 05 · 严重度: HIGH】`04` 报告将 Mock 支付过度包装为「强保证 (STRONG)」
- **原文位置**：`audit-2026-10-03/04-interface-contracts.md` 第 337、345、377 行（操作十一）。
- **原文问题**：将商业支付、订单与权益评为「强保证 (STRONG)」，并在 Q3/Q4/Q5 中极力强调其具备“生产级双重幂等与事务级权益开通”。
- **事实与代码证据**：
  - 查阅 [apps/web/server/billing/store.ts:180](apps/web/server/billing/store.ts#L180)：
    ```ts
    const checkoutUrl = `https://pay.${channel}.com/mock_checkout/${orderId}`
    ```
  - 系统当前的支付网关**恒定返回 `mock_checkout` 虚拟测试链接**！全仓没有配置任何真实商户凭据；外部供应商支付调用被章程显式标为 `NOT RUN`。
- **要求修正**：**必须将商业支付接口的保证强度由【强保证 (STRONG)】降级为【弱保证 / 原型级 (PROTOTYPE)】**，并明确声明“该强保证仅指本地 SQLite 表内的事务状态机在单元测试中成立，真实商业发布支付链条未接入”。

---

### 6. 【驳回 06 · 严重度: MEDIUM】`04` 报告虚构 `rebuildProjectionFromCanon` 的内存锁保护
- **原文位置**：`audit-2026-10-03/04-interface-contracts.md` 第 236 行（操作七 Q6 竞争处理）。
- **原文问题**：“多个调用方竞争时如何处理？由 DataRootProcessLock（进程级）与 withBookLock（书籍级）严格排他锁阻断，禁止多实例并发重建同一个库。”
- **事实与代码证据**：
  - 查阅 [packages/data-plane/src/local-data-plane.ts:451](packages/data-plane/src/local-data-plane.ts#L451)：`rebuildProjectionFromCanon` 是一个独立的纯底层导出函数，其内部直接执行 `removeProjectionFiles(root)` 与 `openDatabase`，**根本没有引入任何 `withBookLock` 机制**！
  - `withBookLock` 属于 `apps/web/server/bookAccess.ts`，数据平面包根本不能逆向依赖它。若有两个本地线程或直调入口并发调用重建，两者将直接在文件系统层互删 SQLite 抛出 `EPERM`。
- **要求修正**：删除“由 withBookLock 严格阻断并发重建”的不实描述，指出其底层缺乏每书重建互斥排队机制。

---

## 四、 事实与未知分离专项核查

对照 `00-audit-charter.md` §5 的三段式要求，对本轮审计中容易滑向“过度推定”的关键条目进行清点：

| 争议点 / 声称项 | 当前被混淆的表述 | 实际事实状态 | 为什么证据不足 / 缺什么证据 | 最小补证方法 |
|---|---|:---:|---|---|
| **掉电不丢稿** | 宣称“抗断电能力完全达到商用级” | **未验证** | 全仓只有纯软件抛 Error 模拟断言；缺失真实硬件断电、拔盘与掉电缓存刷盘验证。 | 在物理机上配置可编程电源插座或 Linux 虚拟机执行硬件硬断电（Kill VM）实验。 |
| **真实长篇 50 章连载能力** | 曾被宣传为“已自动化打通 50 章长程连载” | **未验证** (已证伪) | `long-novel-50.json` 纯属静态 JSON 夹具，零真实 LLM 参与。 | 编写驱动脚本接入 DeepSeek API，完整跑完 50 章真实流水线并计算留存。 |
| **商业微信/支付宝回调** | 宣称具备“企业级支付回调验签强保证” | **未验证** | 仅有本地静态单元测试，未在公网接收真实微信/支付宝服务器发起的 Webhook。 | 在公网服务器配置商户号并使用微信沙箱环境发起真实 0.01 元付款。 |
| **Windows 文件锁跨平台通用性** | 将 Windows 下独占句柄导致的 `rename` `EPERM` 泛化为通用写入失败防御 | **部分成立** (平台限定) | POSIX (Linux/macOS) 允许对已打开读句柄的文件进行 `rename` 覆盖，行为与 Windows 不一致。 | 在 Linux/macOS 环境下运行 `probe-08`，观察非 Windows 平台文件占用行为差异。 |

---

## 五、 图谱门禁（GitNexus）实际覆盖与能力缺口核定

针对本轮审计中对 GitNexus 图谱工具的使用真实性进行全面穿透审计：

### 1. 真实性判定
- 各成员确实实际运行了 GitNexus CLI（v1.6.10-rc.123），并在 `audit-2026-10-03/logs/` 下留下了真实日志（`020-029`, `040-044`）；
- `gitnexus check --cycles -r "C:\zcode\novel-ai"` 的运行结果真实有效，证明代码库无循环依赖。

### 2. 必须明确披露的图谱门禁缺口（Blind Spots）
依据 `01-baseline-and-graph-gate.md` §4，以下 5 项本次**客观未过图谱门禁**，不得宣称图谱已全量验证：
1. **未提交工作区活代码（42 项改动）**：
   - 为遵守“禁止修改被审计仓库”纪律，本轮审计明令禁止运行会改写 `AGENTS.md` 的裸 `gitnexus analyze`；
   - 现存图谱索引建于 `2026-10-02 21:22`，**未包含工作区未提交改动**（如 `assemble.ts` 中的 `summarizeByChannel`）；
   - **裁决**：凡触及工作区改动的文件，图谱召回结果只能代表 HEAD，不能作为工作区拓扑证明。
2. **Rust / Tauri 桌面宿主（`src-tauri`）**：
   - GitNexus 仅支持 TS/JS/Python，对 Rust 原生源码零解析，图谱完全盲区。
3. **C# 桌面启动器（`MoZhou.cs`）**：
   - C# 源码未被纳入图谱节点，Win32 Mutex 与子进程管道编排完全脱离图谱视线。
4. **Junction 软链接动态解析**：
   - Pnpm 工作区在 Windows 下通过 Junction 链接包代码，GitNexus 静态分析将其视为普通包引用，未反映动态文件链接。
5. **HTTP / IPC 跨进程边界与数据所有权**：
   - 前端 `fetch('/api/...')` 到后端路由的动态字符串映射，图谱无法建立强引用边。

---

## 六、 必须在最终报告中降级为「未验证 / 部分成立」的条目清单

在编制最终的综合审计总结报告时，执笔人**必须强制执行下列降级规则**，严禁沿用任何溢美或未经证实的断言：

1. **条目一：商业支付与会员系统**
   - 原始声称：“强保证 (STRONG)，双重幂等与事务级权益开通”；
   - **强制降级为**：**【未验证 (UNVERIFIED) / 原型挂账 (PROTOTYPE)】**；
   - 降级理由：后端恒定返回 `mock_checkout` 虚拟 URL，无真实支付网关集成与公网实测证据。
2. **条目二：掉电耐久性与断电不丢稿**
   - 原始声称：“抗断电能力完全达到商用级软件标准”；
   - **强制降级为**：**【部分成立 (PARTIAL) / 真实断电未验证】**；
   - 降级理由：代码虽有 `fsyncSync`，但未做目录 fsync，且全仓无任何物理硬件掉电实测证据。
3. **条目三：2PC 提交事务自愈**
   - 原始声称：“坚不可摧，前滚/回滚保证绝对一致性”；
   - **强制降级为**：**【部分成立 (PARTIAL) / 存在二次中断静默丢数据严重缺陷】**；
   - 降级理由：`probe-07` 与 `logs/038` 确证 `recoverForward` 截断后二次崩溃会导致追踪流正典增量永久丢失。
4. **条目四：单书并发写入队列**
   - 原始声称：“单机单实例下完全有效，同一本书的并发保存被顺序排队执行”；
   - **强制降级为**：**【部分成立 (PARTIAL) / 核心 proseRoutes 漏锁】**；
   - 降级理由：`proseRoutes.ts`（正文草稿保存与提交）完全未接入 `BookOperationQueue.withBookLock`。
5. **条目五：系统整体成熟度定性**
   - 原始声称：“完全达到商用级标准，仅差外围外壳”；
   - **强制降级为**：**【本地优先高防御度技术原型 / 预览版 (Technical Preview)】**；
   - 降级理由：缺乏外部监控、无多实例支持、大模型重试无去重、支付与云同步未打通。
