# 墨舟 (MoZhou Novel OS) 全维度综合审查评估报告 (Master Audit Report)

- **报告日期**：2026-10-02 21:18 (Asia/Shanghai)
- **审查基准分支与版本**：`feature/windows-local-release` @ `90b45a1` · MoZhou v0.3.0 Technical Preview
- **报告组织**：`mozhou-audit-team`
  - 核心引擎审计员：`core-auditor` (t1)
  - 前端工作台审计员：`web-auditor` (t2)
  - 质量与工程门禁审计员：`qa-auditor` (t3)
  - 综合评估与主笔：`report-synthesizer` (t4 / t5)
- **工程与流程权威**：`mattpocock/skills`（2026-10-01 裁决唯一流程权威）+ UVSD v2.2.1 协议 + DSH Canonical Global Contract

---

## 0. 综合审查总判定 (Executive Summary)

**总评级**：**工业级状态机内核与高完成度写作台，工程底座扎实严谨，但商业化外壳与自动化发布门禁处于初期阶段。整体定位为成熟的技术预览版（Technical Preview），具备优秀的单机可运行度与长篇因果一致性保障，但不具备直接向普通付费消费者交付的商业闭环条件。**

```
┌────────────────────────────────────────────────────────────────────────┐
│                        墨舟 (MoZhou) 评级总览                          │
├──────────────────────┬────────┬────────────────────────────────────────┤
│ 审计维度             │ 评级   │ 核心特征                               │
├──────────────────────┼────────┼────────────────────────────────────────┤
│ 1. 核心架构与数据流  │ A (优) │ 8包单向零环分层，十步管线状态机，双回炉│
│ 2. 持久化与因果契约  │ A (优) │ tmp→fsync→rename 原子落盘，五态对账    │
│ 3. 质量门禁与上下文  │ A- (良)│ 5项机械门禁，De-AI纯算术，3通道加权RRF │
│ 4. 前端工作台体验    │ B+ (良)│ TipTap沉浸画布，CAS采纳防护，回执直达  │
│ 5. 测试套件与工程门禁│ B (阻) │ 1812用例1795通，Web层3处回归，ESLint超限│
│ 6. 商业化与交付外壳  │ C- (缺)│ 支付为Mock，激活恒501，未签名安装器    │
└──────────────────────┴────────┴────────────────────────────────────────┘
```

---

## 1. 核心引擎与数据流架构审查（Packages 架构与质量）

根据 `core-auditor` 对 `packages/` 下核心包的深度审查，全套内核展现了极高的领域抽象水准与工程规范性：

### 1.1 八包单向拓扑与依赖零环
仓库采用标准的 Pnpm Monorepo 体系，各核心包职责高度收敛，自底向上构建：
```
@mozhou/kernel (领域九柱 / 零依赖纯函数 / 零 IO)
      ▲
      │
@mozhou/data-plane (SQLite WAL 事务门面 / Markdown 目录卡 / 五态对账)
      ▲
      ├─── @mozhou/context-compiler (三通道加权 RRF / 两阶段预算装配 / 可重算回执)
      ├─── @mozhou/runtime (多模型运行时底座 / 能力注册表 / Tier 路由)
      │         ▲
      ▼         │
@mozhou/quality-engine (5 项机械门禁 / 4-gram 去复读 / De-AI 纯算术机检，真叶子零依赖)
      ▲         │
      │         │
@mozhou/pipeline (十步生产会话状态机 / commit 编排 / 异常回炉)
      ▲
      ├─── @mozhou/benchmark (L1 确定性连续性断言 / 50 章长弧生命周期台架)
      └─── @mozhou/flywheel (创作者文风画像 StyleProfile / 偏好飞轮)
```
- **GitNexus 图谱验证**：执行 `graph:check` 返回 `{"status":"clean","cycleCount":0,"cycles":[]}`，证实八包之间**严格零循环依赖**。
- **构建与测试**：`tsc -b` 全量通过；包层 103 个测试文件 / 910 项单元与端到端测试 **100% PASS (11.59s)**。

### 1.2 十步流水线（@mozhou/pipeline）
冻结步序（`packages/pipeline/src/steps.ts:11-22`）：
$$\text{prepare} \to \text{compile} \to \text{draft} \to \text{review} \to \text{user\_edit} \to \text{final\_extract} \to \text{continuity\_gate} \to \text{canon\_proposal} \to \text{commit} \to \text{flywheel\_record}$$
- **单一真源与崩溃恢复**：会话进度以事件账本为唯一真源，任意步骤崩溃后均可通过 `receiptId` 或会话指针断点续跑；
- **双回炉策略 (Double Rework Loops)**：
  1. *文学审查回炉*：`review` 步发现硬性缺陷时回炉至 `draft/user_edit`，硬上限为 2 次（避免死循环消耗 Token）；
  2. *连续性门禁回炉*：`continuity_gate` 发现事实冲突时由作者显式驱动回炉，全量重提取；
- **并发与断流保护**：实现每书全局单飞锁（防止并发写破坏）；网络断流时生成半稿打上 `partial: true` 标记，禁止直接充当整章定稿。

### 1.3 Story Brain 与双平面数据架构（@mozhou/kernel, @mozhou/data-plane）
- **核心不变量 (I1-I6)**：保证历史 Commit 不可篡改，严格落实 M2 时间线单调性（乱序插入直接拒绝）；
- **双平面存储与五态对账**：
  - *正典文件面 (Canon)*：人类可读的 Markdown 实体卡与时间线；
  - *数据库投影面 (SQLite WAL)*：基于 `better-sqlite3` 的查询缓存，支持在删库或版本失配时由正典文件**逐字节幂等重建**；
  - *五态对账引擎*：在启动期和运行期自动检测盘上外部编辑，提供检出、隔离、作者确认与吸收闭环；
- **掉电耐久性**：全仓写操作收敛到 `atomicWriteFileSync`（`tmp → fsync → rename`），杜绝系统突然掉电导致的零字节截断破坏。

### 1.4 五项机械门禁与 De-AI 纯算术引擎（@mozhou/quality-engine）
- **零 Throw 纯算术机检**：
  1. 字数窗口硬门禁（2,000 ~ 6,000 字区间）；
  2. 占位符拦截（阻止大模型未展开的 `[待续]`、`TODO`、`XXX`）；
  3. AI 红线正则表（针对中文网文常见套路：章末总结体、预告体、万能比喻等）；
  4. 相邻段落 5-gram 滑窗复读检测（内置对话回环智能豁免）；
  5. 单章 4-gram 词频方差检测；
- 配合 `PARA-001` 段落瀑布和 `REV-001` 哈希防篡改，确保正文哪怕改动一个标点，旧的 PASS 审查报告立即失效（Fail-Closed）。

### 1.5 确定性三通道加权 RRF 上下文装配（@mozhou/context-compiler）
- **融合公式**：采用确定性倒数排名融合 $RRF(d) = \sum \frac{w_i}{60 + \text{rank}_i}$；
- **三通道并发召回**：
  - 通道 1：BM25 关键词检索；
  - 通道 2：k-hop (2-hop) 知识图谱实体与伏笔关联遍历；
  - 通道 3：纯本地 CPU 向量检索（bge-small-zh-v1.5 模型，断网冷启通过测试）；
- **预算两阶段装配**：基于 `ExactTokenizer` 进行精确 Token 计算，生成包含 `recomputationHash` 的持久化回执文件（ContextReceipt），实现生成决策全程可审计与可重算。

---

## 2. 前端工作台与交互体验审查（apps/web）

根据 `web-auditor` 的专项审查，前端在功能完整度与网文特化交互上表现抢眼，遵循严格的类型契约：

### 2.1 架构分层与双端壳
- **视口自适应双端架构**（`App.tsx`）：桌面端承载四维检视塔与复杂工作台，`< 768px` 自动切入轻量级 `MobileShell`；
- **类型安全视图注册中心**（`views.ts`）：统一注册 20+ 个功能视图，未实现视图统一导向 `PlaceholderView` 显式占位，无空白死路由；
- **API Client 与契约解耦**：封装类型安全 SDK `MoZhouApiClient` 与 `post.ts`，支持对 409 冲突的精细恢复与错误码透出。

### 2.2 核心工作台亮点
1. **沉浸式网文画布（`ProseEditorPanel.tsx` / `NovelEditorCanvas.tsx`）**：
   - 特化排版支持：`Enter` 自动补全网文两全角空格缩进（`\n　　`），提供一键规范排版；
   - 快捷动作：行首 `/` 呼出 `SlashCommandMenu`（快速切分 POV 视点、插入角色卡），选中文本呼出 `FloatingBubbleMenu`；
   - **浏览器端本地 De-AI 遥测（`EditorQualityTelemetry.tsx`）**：纯 JS 算法在前端实时计算 4-gram 复读、Tier 1 必阻断词与正典纯净度评分，完全零 Token 消耗、零 Node 依赖。
2. **AI 结对生成流（`DialogueStream.tsx`）**：
   - 生成与采纳严格二阶段分离（Generated Candidate $\neq$ Adopted Prose）；
   - 具备 CAS 版本冲突检测与断流半稿防护，提供采纳后的安全撤销（Undo）。
3. **漫剧分镜独立工作台（`StoryboardView.tsx`）**：
   - 972 行独立高质量模块，支持原文引文与改编镜头双栏并排对照（`sb-duo`）；
   - 全中文景别选择（大远景/中景/特写/细节），集成 `dirtyGuard` 防止切章导致镜头编辑丢失。
4. **模型配置面板（`ModelSettingsView.tsx`）**：
   - 补齐了以往「无法在界面内配置大模型密钥」的严重缺陷；
   - 密钥采用 AES-256-GCM 本机加密存储在应用数据根，不随书导出；提供 SSRF 私网地址安全放行指引（`MOZHOU_ALLOW_PRIVATE_LLM=1`）与一键连通性测试。
5. **「为什么这么写」装配溯源（`WhyThisWritingButton.tsx`）**：
   - 允许作者在正文面对疑似偏差的剧情时，一键调取当章最近的 ContextReceipt 装配详情，打通黑盒上下文。

### 2.3 前端关键风险与交互断层
1. **全局缺失 React Error Boundary**：全仓 `apps/web/src` 检索发现未设置顶层或模块级 Error Boundary，一旦某个子组件抛出未捕获异常，将直接导致整页 React 树卸载白屏；
2. **正文写作层缺页面离开二次确认**：当正文存在未保存编辑（dirty）时，刷新浏览器或关闭标签页无 `beforeunload` 拦截，存在丢失字数的风险；
3. **网络请求缺超时与重试**：`src/lib/post.ts` 采用裸 `fetch`，未包装 `AbortController` 超时机制，当网络悬挂时可能导致界面按钮长期处于 loading 禁用态；
4. **移动端首启向导缺失**：`App.tsx:181-190` 在检测到 `isMobile` 时直接返回 `<MobileShell>`，位于 `wizardOpen` 渲染之前，新用户在移动端首次打开时完全看不到建书向导；
5. **中栏与检视塔割裂**：侧边栏点击质量门、Story Brain、装配看板时，中栏显示占位页，右侧检视塔悄悄切换 Tab，极易让非工程师用户误判为界面故障。

---

## 3. 测试套件、工程门禁与交付物审查（QA 维度）

根据 `qa-auditor` 的全面压测与门禁核验，项目的测试资产体量巨大，但当前工作树存在未合入的门控冲突：

### 3.1 测试套件执行全景 (2026-10-02 实跑)
当前全仓库包含 **227 个测试文件 / 1812 个测试用例**：

| 测试分层 | 文件数 | 用例数 | 通过数 | 跳过数 | 失败数 | 耗时 | 状态 |
|---|---|---|---|---|---|---|---|
| **包层测试 (packages)** | 103 | 910 | 910 | 0 | 0 | 11.59s | **100% PASS** |
| **Web 层测试 (apps/web)**| 124 | 902 | 885 | 14 | 3 | 13.31s | **FAILED (3 失败)** |
| **全仓测试总计** | **227** | **1812** | **1795** | **14** | **3** | **24.90s** | **99.06% 通过率** |

#### 3 处 Web 测试失败定位（回归缺陷）
失败用例均位于 `apps/web/server/routes/productionRoutes.test.ts`：
- `禁止通过 session.advance 直接跳步到 commit` (Line 161)
- `chapter.review 真实执行并生成带哈希锚定的审查报告` (Line 254)
- `D10：该章无编译凭证时 chapter.review → 409 NO_COMPILED_RECEIPT 且不产报告` (Line 321)
**原因归结**：暂存区近期新增的 `pipelineRoutes.ts:430-451` 的 `advanceGuard` 拦截——在推进到 `draft` 步时，若未配置大模型 Provider，会直接以 `409 PROVIDER_UNAVAILABLE` 拒绝前进。而 `productionRoutes.test.ts` 作为一个既有的无 Provider 隔离环境集成测试，仍预期拿到 `200` 并继续验证后续链路，从而被拦截失败。

### 3.2 旅程与 E2E 真实性取证
- **`verify:mock-journey`**：全链 HTTP mock 旅程执行通过，证据落盘；
- **`verify:real-model`**：严格执行「未配置 Key 时如实输出 BLOCKED 证据」，未配置时不报虚假 PASS，杜绝欺瞒；
- **`verify-r05-journey`**：通过 Headless Chrome CDP 真实驱动浏览器走完 11 步编辑旅程，包括保存、采纳、选区替换、撤销、切章等，**100% 全绿通过并保存截图**；
- **`verify-usability-evidence`**：4 项切片物理落盘取证通过。

### 3.3 静态检查与工程门禁
- **TypeScript**：`pnpm build`（`tsc -b`）与 Web `typecheck` **0 错误**；
- **ESLint (`pnpm lint`)**：处于 **FAIL (exit 1)**，报 10 处错误：
  - 1 处：`scripts/gen-adr-refs.mjs:7:7` 存在未使用的变量 `AMBIG`；
  - 9 处：9 个脚本触发 `parserOptions.projectService.maximumDefaultProjectFileMatchCount` 溢出（阈值上限 80，当前匹配文件数达 89）；
- **代码规范门禁**：`check:glossary`、`check:architecture`、`check:gates`、`check:term-map`、`check:readmes` 全部通过；
- **未引用符号审计**：`audit:unreferenced` 检出 14 个真实零引用孤儿符号；
- **依赖漏洞与安全**：`pnpm audit --audit-level high` 为 **0 漏洞**（S02 治理有效，消除了 fast-uri 与 brace-expansion 全部 high 漏洞）。

### 3.4 部署交付物核验（Windows / Docker）
- **Windows 本地安装器**：`scripts/release/windows/build.mjs` 成功产出 **120.01MB** 的 `MoZhou-0.3.0-windows-x64-setup.exe`，内置 Node 24.18.0 + 生产依赖 + 纯 CPU better-sqlite3。经 `windows-install-check.ps1` 校验通过。**但证书签名缺失（NotSigned）**，下载运行时 Windows SmartScreen 必会报未知发布者弹窗；
- **本地发布包**：`build-release.mjs` 正常生成 `local-runtime.tar.gz`、`web-dist.tar.gz`、`docker.tar.gz` 三套归档；
- **Docker 部署隐患**：根目录 `docker-compose.yml` 混合了 legacy-infra 服务并配置了强制变量插值（如 `${AUTH_SECRET}`），导致未配环境变量直接跑 `docker compose up` 时在 Compose 解析期即失败；而发布包内的 Docker 归档已净化。

---

## 4. 商业化外壳与交付就绪度差距

这是当前项目与「可商业化收费软件」之间**差距最大**的领域，也是本次审查认定的核心短板：

| 商业化维度 | 当前代码现状 | 商业化差距 | 严重等级 |
|---|---|---|:---:|
| **在线支付与结算** | `billing/store.ts:180` 返回 `mock_checkout` 假链接；`alipay.ts`/`wechat.ts` 仅有通知验签，**全仓无任何向上游真实发起预下单支付的 API 调用**。 | 无法完成实际在线资金闭环 | **P0 致命** |
| **会员与许可证激活** | `/api/membership.activate` 在 `systemRoutes.ts:516` 恒定返回 `501 LICENSE_ACTIVATION_NOT_IMPLEMENTED`。 | 无法对付费用户发放授权、校验权益兑换码 | **P0 致命** |
| **云同步与在线备份** | `/api/cloud-sync.backup` 恒定返回 `501 BACKUP_NOT_IMPLEMENTED`；虽支持本地归档导出（.tar.gz），但无跨端同步机制。 | 缺少多端协同与云端防丢能力 | **P1 严重** |
| **应用分发与安全拦截** | Windows 安装器（120MB）**未购买任何商业代码签名证书**；用户下载安装时必被 Windows SmartScreen 提示「未知发布者」强力拦截。 | 极度损害初次转化率与信任度 | **P1 严重** |
| **版本自动更新** | `src-tauri/tauri.conf.json` 未配置更新服务器；安装器无静默检查更新与差分热更新支持。 | 缺陷无法在线热修复，依赖手动覆盖安装 | **P1 严重** |
| **运行期崩溃与可观测性** | Sentry/Datadog 等监控 SDK 引入数为 0；`shellTelemetry.ts` 仅在本地推导状态，**无任何向外发送的遥测或错误上报通道**。 | 客户端发生异常时开发者无法远程定位 | **P2 关注** |
| **法务合规与许可证** | 仓库根目录缺少正式的 `LICENSE` 授权文件；安装器内置 Node 24 运行时但未随包附带 Node 官方版权及 NOTICE 文档。 | 存在潜在开源许可证侵权合规风险 | **P2 关注** |

---

## 5. 两次审查演进对比（2026-09-27 vs 2026-10-02）

对照 2026-09-27 商业化审查指出的关键硬阻断，近期整改进展显著，多项高危缺陷已彻底消除：

| 2026-09-27 审查指出的核心阻断 | 2026-10-02 本次审查复核现状 | 改善状态 |
|---|---|:---:|
| **阻断 1：真实长篇上下文提取 0 字且定稿假装成功** | `QualityPanel.tsx:181-193` 现已如实检测 `totalExtracted === 0` 并弹出警示横幅；`proseRoutes.ts` 显式下发 `deltaExtraction` 留痕。 | **部分解决**（前端诚实报警，底层仍可优化 Prompt） |
| **阻断 2：产品内无法配置大模型密钥 (BYOK)** | 已开发完整的 `ModelSettingsView.tsx` 与后端 AES-256-GCM 加密存储，提供连通性测试与私网地址安全引导。 | **彻底解决 (Fixed)** |
| **阻断 3：收不到钱（Mock 支付链接、无下单、激活 501）** | 代码维持现状：`billing/store.ts:180` 仍为 mock，激活恒为 501。 | **未解决 (Pending)** |
| **阻断 4：CI 与本地测试伪装通过（提前 return 掩盖真实调用）** | 引入 `realModelGate.ts` 门控与 `pnpm run test:real-model`；未配置时显式 skip（14 个用例），错误时非零退出，杜绝伪绿。 | **彻底解决 (Fixed)** |
| **阻断 5：依赖安全高危漏洞** | 完成 S02 最小补丁升级（overrides `fast-uri` 3.1.7, `brace-expansion` 1.1.20/5.0.11），high 漏洞彻底清零。 | **彻底解决 (Fixed)** |
| **阻断 6：图谱检查因同名仓库产生歧义** | `graph:check` 改为 `node .gitnexus/run.cjs check --cycles --json -r .`，锚定当前工作区，彻底消除同名歧义。 | **彻底解决 (Fixed)** |

---

## 6. 演进路线与分期行动方案 (Actionable Roadmap)

### Phase 1：立即修复（恢复工程门禁与稳定性闭环 · 1~3 天）
1. **修复 `productionRoutes.test.ts` 门控冲突**：
   - 在测试用例中注入虚拟/测试用 Provider 环境变量（如 `MOZHOU_DRAFT_PROVIDER=mock`），或对齐 `advanceGuard` 返回契约，恢复 Web 层测试 100% 绿灯；
2. **解除 ESLint 检查超限错误**：
   - 在 `eslint.config.js` 中调高 `parserOptions.projectService.maximumDefaultProjectFileMatchCount` 阈值至 120，并移除 `scripts/gen-adr-refs.mjs:7:7` 未使用的 `AMBIG` 变量，恢复全仓 `pnpm lint` 门禁；
3. **增加 React Error Boundary 与防丢守卫**：
   - 在 `App.tsx` 顶层和关键工作台视图包裹 Error Boundary，防止偶发组件错误导致白屏；
   - 在 `ProseEditorPanel` 挂载 `window.onbeforeunload`，当画布处于 dirty 状态时提示确认，防止误触刷新丢稿；
4. **修复移动端首启向导缺失**：
   - 在 `apps/web/src/App.tsx` 中将 `WizardOverlay` 挂载逻辑提取到移动端分支之前，确保移动端新用户首次进入时能正常完成五步建书向导。

### Phase 2：产品打磨与技术预览版收口（体验优化 · 1~2 周）
1. **消除中栏占位页割裂感**：
   - 重构 `PlaceholderView` 与检视塔联动，将质量门、Story Brain、装配看板等直接以内嵌视图形式呈现在中栏，或统一跳转交互，剔除「开发内部排票代号」等研发黑话；
2. **将「代码图谱」从商业主导航剥离**：
   - 移入独立的开发者调试弹窗或以快捷键呼出，避免混淆普通作者的视听；
3. **完善单机诊断日志一键导出**：
   - 在系统中心提供「导出本地诊断日志包（脱敏环境配置 + 数据库校验报告 + 最近报错日志）」功能，为技术预览版用户提供问题反馈渠道；
4. **修复根目录 `docker-compose.yml`**：
   - 消除不必要的必填环境变量依赖，使其能像发布包内 Docker 一样一键体验。

### Phase 3：商业化准备（正式商业版本里程碑 · 1~2 个月）
1. **商业签名与证书采购**：
   - 为 Windows 安装器申请并配置 Authenticode 代码签名证书，解决安装拦截问题；
2. **接通至少一个真实在线支付渠道**：
   - 对接支付宝当面付或微信 Native 扫码支付的真实预下单接口，配合轮询或回调实现自动化权益充值；
3. **补齐法律合规文档**：
   - 补齐仓库根目录 `LICENSE`，在安装向导中展示最终用户许可协议（EULA）与数据隐私承诺。

---

*报告生成时间：2026-10-02 21:18 · 墨舟审查组 (mozhou-audit-team)*
