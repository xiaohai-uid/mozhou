# 双端验收、发行与公开发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans task-by-task；最后用verification-before-completion。严格区分准备完成与已发布。

**Goal:** 同版公网应用与Windows安装包可被真实用户获得并完成工作。
**Architecture:** 构建一次、按哈希验收、发布相同资产；单节点持久化后端、独立Windows本地后端。
**Tech Stack:** pnpm、Tauri/Rust、Node、现有GitHub Actions、WSL act+Docker、标准归档/SHA256。
**Spec:** SPEC.md全部不变量与验收负载。

## T17 — Windows原生应用与干净机器安装

**Modify:** src-tauri/src/main.rs、src-tauri/tauri.conf.json、src-tauri/Cargo.toml；scripts/launcher.mjs；package.json。
**Create:** scripts/build-windows-runtime.mjs、scripts/release/windows-install-check.ps1、src-tauri/capabilities/local-runtime.json（若现有等效能力文件存在先复用）。
**Input:** T05/T07/T09/T10/T13/T15；**Output:** 单机可运行的候选Windows安装包，不依赖开发目录。

- [ ] 先做一条真实vertical slice：Tauri拉起随包Node后端→健康就绪→WebView加载该回环地址→创建临时书→写字→关程序→重开回读。
- [ ] Node与原生模块按安装包的Windows x64/Node ABI在Windows runner构建；不能复制本机Node24的native库给Node22。模型/向量依赖可下载时必须明示大小/失败恢复，核心离线读写不依赖下载成功。
- [ ] Rust管理自己spawn的子进程和PID生命周期。探测空闲端口、设置本次随机bootstrap token、超时失败显示诊断；不得taskkill所有node.exe。
- [ ] 首装无需Node/pnpm/Git；WebView2按官方支持策略处理。安装目录只放程序，书/配置/缓存放用户数据目录，升级不覆盖书。
- [ ] 窗口只允许本次回环服务与明确授权原生命令；外链系统浏览器打开，远程网页不得获得本地文件/命令能力。不能将Tauri所有权限全开以通过测试。
- [ ] 首装、二次启动、端口占用、无网络、中文空格路径、只读书目录、磁盘满、生成中关程序、升级中断、安装覆盖旧版逐项验。
- [ ] 卸载默认保留用户作品；删数据必须是用户单独明确操作，不能跟随安装器清目录。旧安装重新打开书不丢稿/分镜/候选。
- [ ] 签名使用用户证书/托管签名身份；没有签名不伪称已签名。若用户选择发布未签名包，必须在EXTERNAL-INPUTS记录明确选择并在下载页如实提示。

**Commands:** pnpm desktop:build（先确保Tauri CLI已声明为锁定devDependency并确认该脚本真实可运行）；pwsh -File scripts/release/windows-install-check.ps1 -Artifact <实际候选包>
**Pass:** 真Windows标准用户环境，无开发工具，安装包启动且所有本地核心旅程通过；验证UI成功与磁盘内容一致。
**Rollback:** 安装器回到上一版本，用户数据不动；有格式迁移则导出兼容备份再恢复，不能降级代码后强读未知schema。

## T18 — 真模型、50章、负载与故障验收

**Modify:** packages/benchmark/src/long-novel.test.ts（保留原合成规则测试）；现有provider/tests。
**Create:** scripts/release/longform-real.mjs、chaos-check.mjs、cost-evaluation.mjs、journey-check.mjs；evidence/full-release/<run-id>/T18/。
**Input:** T06/T07/T10/T13/T15/T16/T17的可运行端；经用户认可的实际测试预算；**Output:** 真正验收报告及最终Max额度catalog。

- [ ] 每个脚本默认只操作自己mkdtemp/独立测试账号的书；参数传真实书根时直接拒绝。凭据只从受控secret引用读取。
- [ ] longform-real通过实际HTTP生产命令，不直接调用测试内部advance冒充UI链；50章生成→采纳→review→proposal→commit，每5章进程重启回读。
- [ ] 固定最少6个跨章锚点：第1章埋伏笔/第10章前不可揭密/第20章道具转移/第30章角色状态变化/第40章偿还承诺/第50章闭环。用对照事实表验证引用、泄漏、状态和结局；保存实际文本给独立人审。
- [ ] 合成500章150万字只测规模；不要把它合并成“50章真模型通过”。记录真实总字数、每章长度、模型任务/重试/成本。
- [ ] 故障注入：模型中断、空finish、429、503、取消后迟到chunk；accept写后进程kill；commit中断；DB不可写；备份中断；订单回调重放；每例验证零静默覆盖、幂等与可恢复状态。
- [ ] 按SPEC跑20浏览会话/2并发生成、2小时混合流；采集p50/p95、错误率、内存、打开FD/句柄、磁盘、队列深度。失败阈值必须停止发布，不把timeout调大掩盖。
- [ ] cost-evaluation至少覆盖30个代表性真实请求（短/长/审查/拆书/分镜各类），按实际上游usage、费率日期、重试测p95和最坏上界。用T02公式形成明确调用单位/单次上限/周期总额度。
- [ ] 冻结Max正式catalog和UI数字，重新跑T02价格测试与T15额度并发回归。受新catalog影响的证据必须刷新，不能沿用旧权益版本。
- [ ] 实际阅读至少开篇、关键转折、结局及全部机械标红章；任何关键跨章事实矛盾/泄密/空章/复读导致不可读，都返回对应实现任务，不能靠模型自评分掩盖。

~~~text
报告每章：chapterIndex, contentHash, revision, commitId, receiptId, provider,
model, inputTokens, outputTokens, attempts, costFen, continuityFindings,
humanReviewStatus, restartReadbackHash。
区分：real-provider、synthetic、fault-injection；不得统计混合后给“通过率100%”。
~~~

**Commands:** 由本项创建的4个scripts/release脚本分别执行；参数仅用预算、baseURL、测试账户secret引用。上游费用到预算80%先估算剩余可完成度，达到100%确定性终止并保存checkpoint，不能无限继续。
**Pass:** 满足SPEC阈值、实际作品已消费审阅、预算未越界、Max额度不亏穿冻结预算；缺真实凭据/预算则blocked。
**Rollback:** 保留测试书/报告，暂停新任务；不删失败章或重新挑一份好样本顶替。

## T19 — 独立安全与一致性复验

**Files:** T03–T18修改集；NEW evidence/.../T19/review.md、negative-cases.json。
**Input:** 最终候选源码+此前证据；**Output:** 独立审阅者的结果，不能由实施AI同时署名。

- [ ] 复验本交接原始覆盖问题、跨租户完整路由矩阵、回调真实性/幂等、额度竞争、备份路径、SSRF/模型注入、Windows本地Origin/权限。
- [ ] 检查隐藏假实现：静态样例冒充结果、只改HUD状态、短路skip、后端未注册路由、旧dist、HTML伪装DOCX、只读projection缺原文、删除失败日志。
- [ ] 比较任务before/after源码；测试变更必须对应实际契约变化，不能把安全断言删掉。原普通保存回归必须仍通过。
- [ ] dependency audit + licence + secret扫描只输出定位/脱敏标识，禁止在日志展示密钥。HIGH/CRITICAL依赖与有利用路径漏洞必须修或有明确安全替代，不能静默忽略。
- [ ] 每个blocker给失败输入、真实结果、目标文件、通过条件；修复后仅重跑受影响路径，再做最终全量。

**Pass:** 数据丢失、越权、付款/额度错误、无法安装、真实provider链路失败均为0个未解决阻断项。用户/独立审阅者确认证据范围。
**Rollback:** 本项不改数据；发现问题返回负责的T任务，清除受影响任务verified状态直到重验。

## T20 — 当前源码的正式候选与CI/发布通道

**Modify:** scripts/build-release.mjs、.github/workflows/ci.yml、release.yml、package.json、src-tauri版本、README.md、Dockerfile/compose真实交付面。
**Create:** scripts/release/verify-artifacts.mjs、release-manifest.json生成逻辑；Windows构建/验收job；必要的workflow_dispatch发布输入。
**Input:** T19无阻断、同版Web/Windows候选；**Output:** private/draft release资产、真实CI结果、最终sourceCommit。

- [ ] 修现有build-release脚本：不一开始rm整个release-artifacts；在同盘唯一staging目录构建，路径resolve校验后压缩/校验，完成才替换“当前候选”索引。失败保留上一可用资产。
- [ ] 版本只设一个来源，同步根package/Tauri/Cargo/README/下载页；版本值在确认无冲突后登记EXTERNAL-INPUTS.releaseVersion。不得仅改说明称v1.0。
- [ ] 构建出Windows安装包、hosted运行包、SBOM、SHA256SUMS、manifest（commit、sourceTree、版本、OS/ABI、文件大小/sha256、必要迁移和rollback范围）。
- [ ] 解压到无原repo访问的临时目录启动；Windows从安装包安装；验证创建书/生成/采纳/付款权益/保存/重启，不止测首页200或membership字符串。
- [ ] 本地完整命令顺序：workspace build→lint→workspace test→web typecheck→web test→web build→fresh graph analyze/check/detect_changes→dependency/security扫描→资产安装和旅程。
- [ ] release.yml改为可显式选择sourceCommit的workflow_dispatch，默认draft；CI校验输入commit确为已验收分支commit。修旧tag自动公开发布语义，不能在未过门禁的tag push触发公开release。
- [ ] 验证/构建与公开publish分job；Windows job用Windows runner实际构建native依赖，Linuxjob验hosted；等所需job全部成功，不能用依赖job的成功替代目标job。
- [ ] 新增测试/benchmark/安全验收应进入相关CI；真实Key测试不能在普通PR泄露secret，受保护环境中跑，缺条件不得给发布绿灯。
- [ ] 在做任何push前读全局GITHUB-ACTIONS-LOCAL-CI-GATE.md；不要照抄未来job名。当前源码CI为.github/workflows/ci.yml、job novel-os；修改后按实际YAML确认。

~~~powershell
# 示例仅适用于实际存在且需验证的novel-os job；gate会绑定实际SHA。
$releaseSha = git rev-parse HEAD
& C:\Users\a1691\.zcode\bin\git-push-gate.cmd -Remote origin -TargetRef refs/heads/codex/mozhou-full-release-20260915 -Workflow .github/workflows/ci.yml -Job novel-os -SourceCommit $releaseSha
~~~

- [ ] act/Docker无法运行或job失败→BLOCKED，不raw push。Windows hosted runner不能被Linux act证明；本地可模拟验证后仍需真实Windows CI与安装。
- [ ] 当前远程可能分叉：fetch后重新确认ahead/behind，在执行分支合并/解决冲突，再跑受影响回归。不能force推覆盖别人提交，也不能拿fetch前的证据绑定merge后的新commit。
- [ ] 在workflow_dispatch中固定已验收commit，不传工作树dirty文件；所有产物验证完后签名并再核对文件hash。报告留在外部evidence/CI artifacts，避免提交报告导致被验SHA循环改变。
- [ ] T20 对打包、启动器、部署或workflow的修改仍须独立审阅；将相对T19的diff和受影响复验补入T19证据，绑定最终源码及签名后的资产哈希。T19旧结论不能自动覆盖后来改动。

**Pass:** 最终same SHA的全部required jobs成功；候选包可安装/恢复；manifest与sha256匹配；发布内容尚未公开。
**Rollback:** 保留上一个Release及部署目录；撤回draft候选不删旧版；不能删库回滚付款。

## T21 — 同版公开发布与发布后实际验收

**Files:** 无需再改产品源码；最终CI/Release配置；evidence/.../T21/。
**Input:** T20资产与SHA、T16服务环境、required外部条件全部ready、用户本次发布授权及既定门禁。
**Output:** 已公开可访问的站点、可下载Windows包与完整结果报告。

- [ ] 发布前以工具重新读取候选commit/版本/manifest/必需CI状态、未决blocker、商户及model可用性。check-handoff脚本只能证明任务表结构，不能自动签发发布权限。
- [ ] 将已验收hosted包部署到版本目录并切流；dataRoot独立不覆写。回调从原服务平滑保留到新服务，不能遗失在途订单。
- [ ] 公开同一个draft release资产，不临时重建另一包；GitHub Release下载名/Windows架构/版本/sha256与网站一致。不可把缺验收版标正式版。
- [ ] 从公开HTTPS网址注册新账号，建书→真生成→采纳→定稿→分镜→导出→退出重登→核对；访问他人bookId拒绝。
- [ ] 从公开下载链接重新下载Windows包，核对sha256，干净机器安装→本地建书→生成→保存→重启；连接账号确认权益且不上传本地书。
- [ ] 微信和支付宝各有一次已授权真实支付成功证据（可复用同版同商户同实际链路刚取得的T14证据，若回调域名/逻辑变更则重验）；校验金额、订单与权益一次性到账、查单/退款可用。
- [ ] 实施一次服务端版本回滚演练再恢复新版本，已保存作品/订单/权益保持一致；不可仅说“有备份”。
- [ ] 观察30分钟真实基础请求/错误/写入/回调指标，无新的阻断错误；免费资源剩余额度与告警可见。

**最终报告：**

~~~json
{
  "status": "released",
  "sourceCommit": "实际40位SHA",
  "version": "实际版本",
  "website": "实际HTTPS地址",
  "windowsDownload": "实际公开下载地址",
  "windowsSha256": "实际64位hash",
  "paymentEvidence": ["微信真实回执摘要", "支付宝真实回执摘要"],
  "realProviderEvidence": "真实记录路径",
  "installEvidence": "干净机器记录路径",
  "rollbackEvidence": "实际演练路径",
  "openBlockers": []
}
~~~

**Pass:** 公开地址真实可用、资产相同、所有required证据齐全且独立核查真实，openBlockers为空；不是填完上面JSON就发布成功。
**Failure:** 保留诚实状态release-blocked，关闭新付费订单入口但继续处理已支付订单；回到上一已验证应用版本，保留数据与支付处理。
