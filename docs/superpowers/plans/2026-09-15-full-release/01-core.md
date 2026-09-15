# 核心安全与生产链 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement task-by-task. 单写入者；步骤使用 checkbox，全部证据绑定当前源码。

**Goal:** 修复生成覆盖，完成可恢复的真实章节生产链。
**Architecture:** 保留现有 packages，生成先落候选，作者受控采纳，再经既有十步状态机定稿。
**Tech Stack:** TypeScript、Node、better-sqlite3、Vitest、React。
**Spec:** SPEC.md、CONTRACTS.md C1–C3。

## 全局约束与命令

下面的相对路径从 C:/zcode/novel-ai 解析。每个 NEW 文件明确是待创建，不表示已存在。
运行命令用当前原生命令，不用 npm 代替 pnpm。PowerShell 必须 7。

~~~powershell
node .gitnexus/run.cjs impact makeDraftProviderBinding --file packages/pipeline/src/draft-step.ts --direction upstream --repo C:\zcode\novel-ai
node .gitnexus/run.cjs detect-changes --scope staged --repo C:\zcode\novel-ai
node .gitnexus/run.cjs check --cycles --json --repo C:\zcode\novel-ai
~~~

索引过期先备份生成说明文件，然后 analyze，复核 AGENTS/CLAUDE diff 仅为图谱块。HIGH/CRITICAL 要报告并补调用方验收。这里禁止把旧图谱的 clean 当新源码的 clean。

## T00 — 保存现状并建立可回滚执行分支

**Files:** 当前所有已修改文件；本交接；NEW evidence/full-release/<run-id>/T00/。
**Input:** 当前工作树；不是只取 HEAD（未提交修复必须保留）。
**Output:** baseline.json、本地备份路径、执行分支、product-inputs.json。

- [ ] git status --porcelain=v1 / rev-parse HEAD / diff --binary / diff --cached --binary 分别保存在仓库外的唯一审计目录；逐个列出未跟踪文件，不采集浏览器缓存/凭据。
- [ ] 对 tracked 产品源码、配置、lockfile及拟保留未跟踪修复逐文件 SHA256；把这些输入的排序列表做整体摘要。排除本交接、evidence、dist、node_modules、.git/.gitnexus，避免证据自引用。
- [ ] 把实际待保留文件复制到仓库外原样备份，并回读核对哈希；写明恢复是单文件拷回，禁止整仓 reset。
- [ ] 在原目录 git switch -c codex/mozhou-full-release-20260915（名字已存在则核查它，不重置）。逐文件审阅现有22项修复，归为 baseline，不混入后来任务。
- [ ] 刷新图谱并查无环；验证本交接及现有测试，明确 stage 文件后做本地 baseline commit；不得 push。

**Pass:** 备份回读匹配、dirty来源登记、无作者内容丢失、分支正确。备份失败不开始改代码。
**Rollback:** 只撤销本任务新建分支/说明需保留的更改；作者原内容从逐文件备份恢复，先比较 hash。

## T01 — 先验证部署、商户、模型和邮件前提

**Files:** EXTERNAL-INPUTS.json；scripts/launcher.mjs、apps/web/server/productionServer.ts、src-tauri/src/main.rs（本项只读）；NEW evidence/.../T01/。
**Consumes:** T00 基线；**Produces:** 可运行环境报告与凭据名称清单，绝非密钥。

- [ ] 读取 SPEC 官方链接，记录检索日期、可用免费资源和商业条款。默认 Oracle 持久VM + Cloudflare接入 + Supabase Auth；免费资源不足就列 blocked，不切临时磁盘。
- [ ] 在用户已开通的目标主机测 uname/Node/原生 SQLite/磁盘写读后重启；确认不是同容器临时层。ARM 不可用不能悄悄换 x64 包。
- [ ] 记录 HTTPS 域名/回调域名、可部署 region、卷容量、SSH权限、备份目的地是否可用；不要修改真实小说或生产账号。
- [ ] 微信 Native、支付宝已签约的扫码/收银台产品逐一验证商户/AppID/回调配置的存在性。只用官方 SDK 文档，不用私人收款码替代订单回调。
- [ ] 确认真模型服务允许当前商业用途；只读取配置存在性。注册/重置邮件必须实际收发，不拿 Supabase 默认测试邮件证明生产可用。
- [ ] Windows 构建工具、Tauri CLI、Rust、WebView2、代码签名条件分别记录。缺项只阻塞相应任务，其余继续。

**Pass:** 每项是 ready 或明确 blocked+缺项，不得写 assumed-ready。公网发布必须全部 required 状态 ready。
**Rollback:** 删除的只能是该次探针临时文件/进程；不动用户云资源与安全设置。

## T02 — 冻结19/39方案与可测成本合同

**Files:** SPEC.md 的方案；NEW apps/web/server/billing/catalog.ts、catalog.test.ts；EXTERNAL-INPUTS.json。
**Input:** 用户价格、OpenWrite方法、T01服务能力；**Output:** catalog version与成本计算规则；不发支付订单。

- [ ] 固定 pro_monthly=1900/max_monthly=3900/CNY；基本编辑/导出/备份不受付费限制。删除永久、团队同步占位商品。
- [ ] 将每项高级能力列在 entitlementKeys 集合，价格只在服务端保存一次，UI从catalog API读取。
- [ ] 固定 Max 次数上限计算；成本参数在 T18 用真实值替换，变更catalog version。没有实测数据就不对外销售Max。

~~~js
// 这是必须实现/测试的纯计算，不是当前已经通过的商业测算。
function maxIncludedCalls({priceFen, feeFen, taxReserveFen, infraReserveFen, modelBudgetFen, p95CallFen}) {
  for (const v of [priceFen,feeFen,taxReserveFen,infraReserveFen,modelBudgetFen,p95CallFen])
    if (!Number.isFinite(v) || v < 0) throw new Error('INVALID_COST_INPUT');
  if (p95CallFen <= 0) throw new Error('MISSING_REAL_COST');
  const spendable = Math.min(modelBudgetFen, priceFen-feeFen-taxReserveFen-infraReserveFen);
  if (spendable <= 0) throw new Error('NO_POSITIVE_MARGIN');
  return Math.floor(spendable/p95CallFen);
}
// 纯fixture，只测试计算：价格3900、总预留1000、模型预算1500、p95成本5分 → 300次。
// 严禁把300或竞品3500直接当最终额度。
~~~

- [ ] Max 采用每月模型成本上限1500分作为初始经营保护建议；必须同时按单请求最大输入/输出tokens和重试上界验证最坏成本。为长篇请求显示更高单位消耗，不隐藏额外工具收费。
- [ ] catalog.test.ts 包含负数/NaN/0成本拒绝、价款不由客户端覆盖、到期保留作品访问、月末续费、同订单权益不重复。

**Command:** pnpm --filter @mozhou/web test -- server/billing/catalog.test.ts
**Pass:** 价格正确、权益明确、无无限平台推理；最终 managedCalls 的数值在 T18实测后写入catalog并重验。本项 verified 不代表可以出售。
**Rollback:** 未生效catalog可撤回；已售订单必须保留原priceVersion，不改历史权益。

## T03 — 固定候选契约和失败回归

**Files:** packages/pipeline/src/draft-step.ts、index.ts；apps/web/server/routes/pipelineRoutes.ts；NEW packages/pipeline/src/draft-candidate.ts、draft-candidate.test.ts。
**Input:** C2；**Output:** 新候选类型/持久态/错误码；此时不得先删旧安全回归。

- [ ] 构建后运行本目录 regressions/verify-stream.mjs；当前版本应退出1并显示原文丢失。再运行 verify-manual-save.mjs，应退出0。前者是 bug 证据，后者是不能退化的约束。
- [ ] 用临时书写新的语义测试：创建原文A与r1；开始生成B后未采纳；断言正文仍A、r1与原hash不变、candidate=B。
- [ ] NEW candidate API 索引/读写仅接受服务端生成id，schema/body/status/base校验。终态 append delta 拒绝。
- [ ] 加 ready/partial/cancelled/accepted 跨进程重开回读；重建projection后candidate不丢失；断流不写成ready。

~~~ts
// 放入 draft-candidate.test.ts；create/stream/read 使用C2所定义实现。
expect(after.body).toBe(before.body);
expect(after.revision).toBe(before.revision);
expect(afterHash).toBe(beforeHash);
expect(candidate.status).toBe('ready');
expect(candidate.text).toBe('模型候选B');
~~~

**Command:** pnpm exec vitest run packages/pipeline/src/draft-candidate.test.ts
**Pass:** 先红后绿；status迁移完整；候选与正文隔离。
**Rollback:** 删除的只限本任务新候选测试书；不删除已有正文目录。

## T04 — 流式写入改为候选，封闭所有旁路

**Files:** packages/pipeline/src/draft-step.ts、draft-candidate.ts、index.ts、draft-step.test.ts；apps/web/server/routes/pipelineRoutes.ts、llm/openaiStream.ts；NEW server/routes/draftCandidates.test.ts。
**Input:** T03；**Output:** C2 stream/cancel/accept端点与统一写边界。

- [ ] impact makeDraftProviderBinding/persistProse/runDraftStep。每一个调用点按UI候选或受控管线分类，禁止保留默认“直接正文落盘”的分支。
- [ ] makeDraftProviderBinding 的stream只appendCandidateDelta；runDraftStep读取候选结果，不再从正文取生成结果；显式映射旧生成/续写模式到replace/continue。
- [ ] 实现C2采纳的书锁、版本+hash校验、意图/完成日志、幂等恢复。不能只在HTTP端加expectedRevision而包层仍可覆盖。
- [ ] AbortSignal 从HTTP请求断开/显式cancel经streamOpenAiChat到底层fetch和candidate；收尾前重查status。取消后的延迟chunk不写盘、不继续付费重试。
- [ ] 测：两窗口、两并发生成、同id重试不同body、生成中保存、外部编辑发生于两delta之间、取消后chunk、accept写后断进程、重启同accept重放。
- [ ] 按新C2适配复制回归的HTTP请求字段，但不能改“未采纳原文不变、外部改动保留、旧base不能写入”的断言。保留审计原脚本作为原始证据。

**Commands:** pnpm test；pnpm --filter @mozhou/web test -- server/routes/draftCandidates.test.ts
**Pass:** 新回归全绿；手工保存/定稿保护仍通过；无后门直接persistProse。
**Rollback:** 回退本项代码；保留新候选/accept-intent文件，旧版不得自动清理未知版本数据。若已迁移用户文件，先停写，按intent恢复。

## T05 — 真正采纳、选择插入、冲突恢复的编辑体验

**Files:** apps/web/src/workbench/DialogueStream.tsx、editor/ProseEditorPanel.tsx、editor/ProseEditorPanel.isolation.test.tsx；apps/web/src/shell/workbenchStorage.ts；src/lib/post.ts。
**Input:** T04；**Output:** UI Candidate→Accept→Active Draft，只有成功回读后显示已保存。

- [ ] 初次打开以服务器/本地后端快照为源；有本地未保存缓存就展示恢复/对比，不用空缓存覆盖盘上正文。
- [ ] candidate id与bookId/chapterIndex/base一起保存UI状态；切书、切章、迟到响应不得写入当前新书。
- [ ] 选择插入/替换记开始时 selection、文本hash；作者生成时编辑导致base过期→409，保留两份文本、显示差异、提供复制/读最新/明确覆盖。
- [ ] “采纳”调用C2 accept，不再先改localStorage却称已落盘。返回成功后刷新快照与缓存、记录Undo一次可逆编辑；Undo需新revision保存，不倒退服务器历史。
- [ ] 本任务在真实浏览器连接本地后端操作（安装版Windows整体验收留到T17）：输入中文/IME、保存/重启、拒绝AI候选、采纳/撤销、双窗口冲突、选区变化、切书/刷新恢复；截图对应每个磁盘结果。

**Command:** pnpm --filter @mozhou/web test -- src/workbench
**Pass:** 不依赖mock证明落盘；UI与真实后端/文件逐项一致；committed仍只读，显式重开成功后才可编辑。
**Rollback:** 恢复UI代码但保留缓存旧值，不清空作者缓存作为“修复”。

## T06 — 接通实际十步生产与恢复

**Files:** packages/pipeline/src/session.ts、review-step.ts、extract-step.ts、proposal-port.ts、record-step.ts、watcher-checkpoint.ts；apps/web/server/routes/pipelineRoutes.ts；NEW productionRoutes.ts、productionRoutes.test.ts；src/quality/QualityPanel.tsx、src/shell/PipelineStrip.tsx。
**Input:** T04已采纳草稿；C3；**Output:** 服务端命令编排、真实检查点/提案/定稿。

- [ ] 从packages/pipeline/src/index.ts核实实际签名；NEW productionRoutes 在 api.ts注册，现有十步方法逐步接线，不另造状态机。
- [ ] start→prepare/compile→draft候选/accept→review→user-edit→extract→continuity gate→proposal decisions→commit→record 按 PIPELINE_STEPS 的实际词表实现，不能按本行示意顺序覆盖仓库合法状态机。
- [ ] review接真实语义reviewer（T07提供端点），报告版本锚定；机械门和文学建议各自显示，不让LLM判定正典事实真伪。
- [ ] 每次用户改稿都使旧review/gate/proposal输入stale；重审失败不自动修改作者稿；自动回炉最多2次，第3次交作者。
- [ ] 定稿前重查所有confirmed提案、当前source hash、报告、书归属与task开闭态。事务提交失败不能显示成功；record失败仅标派生状态degraded，不删除已定稿内容。
- [ ] 测无session、错书同taskRef、重放commit、cancel/review await竞态、未决proposal重启、每一步kill/resume；每本书最多一个有效写会话。
- [ ] 对公开session.advance删除/降为内部操作，测试不能直接跳到commit。

**Command:** pnpm exec vitest run packages/pipeline/src/t18-pipeline.test.ts packages/pipeline/src/t19-rework.test.ts；pnpm --filter @mozhou/web test -- server/routes/productionRoutes.test.ts
**Pass:** 从真实UI完成一章并回读正文/正典/receipt/ledger；不是只有10个按钮能亮。T07未完成时真模型部分保持blocked，可继续确定性测试。
**Rollback:** 保留旧commit与事务日志；只撤销当前新任务，不能抹掉历史事件装作未发生。

## T07 — 可配置、可取消、可核算的模型通道

执行依赖为 T04 + T09：可以提前阅读和编写本地通道测试，但必须等 T08/T09 的身份与隔离完成，再将含公网用户设置的本任务标 verified。任务编号不是执行排序，tasks.json 的依赖和数组顺序优先。

**Files:** apps/web/server/llm/openaiStream.ts、draftContext.ts、routes/pipelineRoutes.ts、storyboard/generate.ts；NEW providerSettings.ts、routes/providerRoutes.ts、providerRoutes.test.ts；UI设置接入现有shell。
**Input:** T01真实服务条件；**Output:** 每用户/安装的端点配置、共享传输与使用量记录，提供T06语义reviewer。

- [ ] 正式API可配置并实际调用OpenAI-compatible端点；不只支持启动环境变量。hosted加密存每用户BYOK，local存系统凭据库/后端安全存储，不入localStorage/书目录。
- [ ] 验证base URL、重定向每一跳、DNS解析、私网/metadata地址与请求大小；公网不允许用MOZHOU_ALLOW_PRIVATE_LLM放开用户任意URL。受运营批准的私网上游只由部署配置设置。
- [ ] model/provider/configVersion、上下文receipt、token usage、timeout/cancel原因记录在任务结果中；redact Key/Authorization及原文敏感字段。
- [ ] 通用传输支持20s连接/30s流空闲/180s总时限；429/503只在可重试条件内最多3次且计入成本。无finish frame、半JSON、工具参数非法要失败，不将HTTP200当成功。
- [ ] 结构化review/拆书/分镜最多2次定向修复，总3次尝试；达到上限保留失败材料、可人工重试，不静默换demo。
- [ ] “测试连接”用一个最小无私密输入请求，回显模型名/延迟/脱敏错误；不能只ping URL。

**Command:** pnpm --filter @mozhou/web test -- server/llm；新增 providerRoutes.test.ts 精确运行。
**Pass:** 真模型短请求成功并消费产物；缺Key路径诚实；取消真实连接；两用户Key隔离。T18再验长文。
**Rollback:** 保留旧配置版本，回滚指向前一有效配置；不得导出解密Key。


