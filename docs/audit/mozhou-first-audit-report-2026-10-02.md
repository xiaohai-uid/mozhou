# 墨舟 (MoZhou Novel OS) 全维度第一次审查评估报告

- **审查基准时间**：2026-10-02 21:05 (Asia/Shanghai)
- **审查分支与版本**：`feature/windows-local-release` @ `90b45a1` (ahead of origin by 7 commits) · MoZhou v0.3.0 Technical Preview
- **审查执行身份**：`mozhou-audit-team` · `report-synthesizer` (Technical Writer / 综合审查)
- **流程与工程权威**：`mattpocock/skills`（2026-10-01 裁决唯一流程权威）+ UVSD v2.2.1 协议 + DSH Canonical Global Contract

---

## 0. 综合审查总判定 (Executive Summary)

**总体判定**：**工业级状态机内核与高水准创作台，但商业化外壳与自动化发布门禁仍处于初期阶段。整体定位为成熟的技术预览版（Technical Preview），具备优秀的单机可运行度与长篇因果一致性保障，但不具备直接向普通付费消费者交付的商业闭环条件。**

| 维度 | 评分 (A~D) | 核心现状与评价 |
|---|---|---|
| **核心架构与领域建模** | **A (优秀)** | 8 个核心包单向分层，零环依赖（GitNexus 实测 `cycleCount: 0`）；领域九柱与十步生产管线、五态对账、因果契约（CausalContract）严密闭环。 |
| **持久化与掉电耐久性** | **A (优秀)** | 全仓收敛到 `atomicWriteFileSync`（tmp → fsync → rename），杜绝掉电零字节破坏；SQLite WAL + Markdown 双平面存储对账扎实。 |
| **质量防护与机检门禁** | **A- (良好)** | 5 项机械门禁 + 4-gram 去复读 + De-AI 纯算术机检；真实模型测试通过 `realModelGate.ts` 实施确定性门控，根除了以往测试伪装通过与静默扣费漏洞。 |
| **前端交互与创作体验** | **B+ (良好)** | Vite + React + TipTap 现代化工作台；五步建书向导、流式候选采纳（CAS 保护）、分镜漫剧视图；近期补齐了模型设置页（AES-256-GCM 本机加密）与「为什么这么写」上下文回执直达入口。但移动端首启向导缺失，中栏与检视塔存在认知割裂。 |
| **自动化测试与门禁质量** | **B (受阻)** | 包层测试全绿（103 文件 / 910 用例全部通过）；但 Web 层存在 3 处门控回归报错（`productionRoutes.test.ts`），且 ESLint 因测试文件数超限触发 projectService 保护而报错。 |
| **商业化与交付就绪度** | **C- (不达标)** | 支付结算为 Mock URL，微信/支付宝仅有验签无真实下单；会员激活与云备份恒报 501；Windows 安装器未进行商业代码签名（SmartScreen 告警），无版本自动更新（Updater）。 |

---

## 1. 真实运行验证基线（实跑数据与证据）

本审查所有数据均基于 2026-10-02 在本机（Node v24.18.0, pnpm 9.15.0, pwsh 7.6.4）实跑输出：

| 验证项 | 执行命令 | 实测结果 | 耗时 | 证据与状态说明 |
|---|---|---|---|---|
| **工作区类型构建** | `pnpm build` | **exit 0 (passed)** | 1.1s | `tsc -b` 全量通过，无类型错误 |
| **核心包测试套件** | `pnpm run test:packages` | **exit 0 (passed)** | 12.4s | **103 文件通过 / 910 用例通过**（0 失败 / 0 错误） |
| **Web 层测试套件** | `pnpm run test:web` | **exit 1 (failed)** | 13.3s | 122 文件通过，1 文件失败，1 文件跳过；**885 passed / 14 skipped / 3 failed** |
| **代码图谱无环检查** | `pnpm run graph:check` | **exit 0 (passed)** | 1.8s | GitNexus 返回结构化结果：`{"status":"clean","cycleCount":0,"cycles":[]}` |
| **依赖安全高危审计** | `pnpm audit --audit-level high` | **exit 0 (passed)** | 2.5s | 官方 registry 实测：**0 high / 0 critical**（剩余 5 项 moderate 低于门禁线） |
| **全量静态检查 (Lint)** | `pnpm lint` | **exit 1 (failed)** | 4.2s | 10 处错误：8 处为测试文件超限触发 ESLint projectService 报错，1 处为 `gen-adr-refs.mjs` 未使用变量 |

### 1.1 Web 测试 3 处失败根因定位（真实代码回归）
在 `apps/web/server/routes/productionRoutes.test.ts` 中失败的 3 个用例：
1. `禁止通过 session.advance 直接跳步到 commit` (Line 161)
2. `chapter.review 真实执行并生成带哈希锚定的审查报告` (Line 254)
3. `D10：该章无编译凭证时 chapter.review → 409 NO_COMPILED_RECEIPT` (Line 321)

**根本原因**：工作树暂存区新增了 `pipelineRoutes.ts:430-451` 的 `advanceGuard` 门控——当会话推进至 `draft` 步时，若环境未配置大模型 Provider（`no_provider_configured`），该守卫会以 `409 PROVIDER_UNAVAILABLE` 拒绝推进。而旧的集成测试 `productionRoutes.test.ts` 运行在无模型配置的沙盒中，原本预期拿到 `200` 并继续校验后续步序，现被前置拦截为 `409`。
**整改建议**：在 `productionRoutes.test.ts` 中注入测试用 mock provider 环境变量，或在测试中使该测试用例对齐新的 `advanceGuard` 契约。

---

## 2. 核心架构与 8 个 Packages 深度审计

项目采用标准的 Pnpm Monorepo 体系，packages 之间严格自底向上分层，没有任何反向导入或循环导入：

```
@mozhou/kernel (领域九柱 / 零依赖纯逻辑 / 不做任何 IO)
      ▲
      │
@mozhou/data-plane (SQLite WAL 事务门面 / Markdown 目录卡 / 五态对账)
      ▲
      ├─── @mozhou/context-compiler (三通道加权 RRF / 两阶段预算装配 / 可重算回执)
      ├─── @mozhou/runtime (LLM 执行底座 / 能力注册表 / Tier 路由)
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

### 2.1 架构亮点
1. **领域不变量严格固化**：
   - `@mozhou/kernel` 不包含任何数据库或网络调用，定义了领域核心九柱（作品、章、场景、实体卡、事实、时间线事件、关系、文风偏好、审查报告）。
   - 因果契约（`CausalContract`）保证了长篇创作前后事实与时间线的单调性（M2 校验：乱序事件直接拒绝）。
2. **掉电持久落盘收敛**：
   - 生产环境通过 `atomicWriteFileSync`（`packages/data-plane/src/atomic-write.ts:22`）统一收敛落盘，经 `tmp -> fsync -> rename` 三步，解决了早期版本 rename 先于刷盘导致的掉电零字节损坏灾难。
3. **十步生产管线状态机**：
   - 冻结步序（`packages/pipeline/src/steps.ts`）：
     `prepare → compile → draft → review → user_edit → final_extract → continuity_gate → canon_proposal → commit → flywheel_record`。
   - 每一步均有前置与后置条件校验，杜绝跳步与未审先发。
4. **确定性三通道上下文加权装配 (Context Compiler)**：
   - fastembed 本地 CPU 向量模型 + 关键词匹配 + k-hop 实体关联图谱；
   - 引入 WordPiece 精确 Tokenizer 计算，消除字符估算误差；每次编译输出持久化 `ContextReceipt`（编译凭据），实现生成决策的全程可追溯与可重算。
5. **去 AI 味机械门禁**：
   - `@mozhou/quality-engine` 包含 5 项工业级机检门禁：红线词汇扫描（针对中文网文常见套路：章末总结体、预告体、万能比喻等）、4-gram 局部复读检测、De-AI 统计学审查，纯算术实现且零异常抛出（零 throw，全靠 verdict 判决）。

### 2.2 核心架构隐患与技术债
1. **Flywheel Evaluator 子树未导出**：
   - `packages/flywheel/src/evaluator/`（6 个源文件 + 3 个测试）实现了基于 Wilson 区间的高级评估器，但未从 `flywheel/src/index.ts` 导出，且全仓无外部 importer（属「库内就绪、待主干接线」状态）。
2. **起名端点绕过统一出站 Seam (R4)**：
   - 全仓 LLM 出口基本收敛至 `resolveGenerationTarget`（保证 providerId 与实际端点一致以支持账本对账），唯独 `routes/namingRoutes.ts:128` 直接调用 `resolveChatEndpoint`，导致分级路由覆盖对起名无效（工单 22 历史遗留）。

---

## 3. 前端工作台与交互体验 (apps/web)

### 3.1 关键资产与正面体验
1. **首屏五步向导 (WizardOverlay)**：
   - 从书名、立意、题材风格到核心设定，提供极具沉浸感与文学质感的首启体验，支持回退与取消。
2. **对话生成流 (DialogueStream)**：
   - 彻底区分了「生成候选 (Candidate)」与「采纳进正文 (Adopted)」；
   - 实现了 CAS 版本冲突保护与断流半稿防护（`describeDraftResult`：半稿明确保留但不允许直接作为全稿采纳）；
   - 支持采纳后的撤销（Undo）与版本防篡改。
3. **模型配置面板 (ModelSettingsView)**：
   - 补齐了以往「无法在 UI 内录入 API Key」的严重缺陷；
   - 密钥采用 AES-256-GCM 本机加密存储在应用数据根，不随书导出；
   - 针对本机部署（Ollama / vLLM）提供明确的 SSRF 安全门禁放行说明（`MOZHOU_ALLOW_PRIVATE_LLM=1`）。
4. **「为什么这么写」直达按钮 (WhyThisWritingButton)**：
   - 解决了作者面对生成段落不知前情来历的痛点，一键调取当章最近的 `ContextReceipt` 装配详情。
5. **定稿记忆增长如实警告**：
   - 针对 2026-09-27 指出的「提取 0 字仍提示成功」的严重欺瞒体验，`QualityPanel.tsx:181-193` 现已如实弹出 `⚠ 本章已定稿，但叙事记忆零增长` 警示条。

### 3.2 交互缺陷与体验断层
1. **移动端首启向导彻底失效**：
   - `apps/web/src/App.tsx:181-190` 在检测到 `isMobile` 时直接提前返回 `<MobileShell>`，导致 `WizardOverlay` 永远无法在移动端首次加载时渲染，新用户在移动端面临无书可写且无引导的空白界面。
2. **「中栏与检视塔」操作割裂**：
   - 当用户在侧边栏点击质量门、Story Brain、装配看板、变更矩阵等功能时，中栏显示 `PlaceholderView` 占位，右侧检视塔悄悄切换 Tab。对普通作者而言极易产生「中栏坏了」的错觉。
3. **占位文案陈旧违和**：
   - `PlaceholderView.tsx:11-13` 依然显示「随实现票 T41/T42/T43 落地」等内部研发代号，未进行用户侧界面语言封装。
4. **代码图谱暴露于商业主导航**：
   - `views.ts:67-70` 将作为研发调试工具的「代码图谱」堂而皇之放在主导航中，面向终端作者暴露开发内部细节。

---

## 4. 商业化闭环与交付外壳差距

这是当前项目与「可商业化收费软件」之间**差距最大**的领域：

| 商业化维度 | 当前现状 | 商业化标准差距 | 影响严重度 |
|---|---|---|---|
| **订单与在线支付** | `billing/store.ts:180` 直接生成 `mock_checkout` 假链接；`alipay.ts` / `wechat.ts` 仅有回调签名验证，**全仓无任何向上游真实发起下单支付的 API 调用**。 | 无法完成在线收款与结算 | **P0 致命** |
| **会员与许可证激活** | `/api/membership.activate` 在 `systemRoutes.ts:516` 恒定返回 `501 LICENSE_ACTIVATION_NOT_IMPLEMENTED`。 | 无法进行用户鉴权、权益兑换与付费授权绑定 | **P0 致命** |
| **云同步与在线备份** | `/api/cloud-sync.backup` 恒定返回 `501 BACKUP_NOT_IMPLEMENTED`；虽然单机归档备份（.tar.gz）可用，但无多端同步能力。 | 跨设备无缝创作能力缺失 | **P1 严重** |
| **应用分发与安装安全** | Windows 安装器（`MoZhou-0.3.0-windows-x64-setup.exe`，125MB）为 Inno Setup 构建，**未购买商业代码签名证书**；用户下载安装时必被 Windows SmartScreen 提示「未知发布者」强力拦截。 | 转化率与用户信任度断崖式下跌 | **P1 严重** |
| **自动更新 (Updater)** | `src-tauri/tauri.conf.json` 未配置更新服务器；安装器无静默检查更新与差分热更新支持。 | 缺陷无法在线修复，需要用户手动下载覆盖 | **P1 严重** |
| **运行期崩溃与可观测性** | Sentry/Datadog/PostHog 等 SDK 引入数为 0；`shellTelemetry.ts` 仅在本地推导状态，**无任何向外发送的遥测或错误上报通道**；一旦用户机器报错，无法远程定位。 | 售后支持与技术排障成本极高 | **P2 关注** |
| **法务合规与许可证** | 仓库根目录缺少正式的 `LICENSE` 授权文件；安装器内置 Node 24 运行时但未随包附带 Node 官方版权及 NOTICE 文档。 | 存在法律侵权与开源合规风险 | **P2 关注** |

---

## 5. 两次审查演进对比（2026-09-27 vs 2026-10-02）

| 2026-09-27 审查指出的核心阻断 | 2026-10-02 本次审查复核现状 | 改善状态 |
|---|---|---|
| **阻断 1：真实长篇上下文提取 0 字且定稿假装成功** | `QualityPanel.tsx:181-193` 现已如实检测 `totalExtracted === 0` 并弹出警示横幅；`proseRoutes.ts` 显式下发 `deltaExtraction` 留痕。 | **部分解决**（前端诚实报警，但底层仍需优化 LLM 抽取 Prompt） |
| **阻断 2：产品内无法配置大模型密钥 (BYOK)** | 已开发完整的 `ModelSettingsView.tsx` 与后端 AES-256-GCM 加密存储，提供连通性测试与私网地址安全引导。 | **彻底解决 (Fixed)** |
| **阻断 3：收不到钱（Mock 支付链接、无下单、激活 501）** | 代码维持现状：`billing/store.ts:180` 仍为 mock，激活恒为 501。 | **未解决 (Pending)** |
| **阻断 4：CI 与本地测试伪装通过（提前 return 掩盖真实调用）** | 引入 `realModelGate.ts` 门控与 `pnpm run test:real-model`；未配置时显式 skip（14 个用例），错误时非零退出，杜绝伪绿。 | **彻底解决 (Fixed)** |
| **阻断 5：依赖安全高危漏洞** | 完成 S02 最小补丁升级（overrides `fast-uri` 3.1.7, `brace-expansion` 1.1.20/5.0.11），high 漏洞彻底清零。 | **彻底解决 (Fixed)** |
| **阻断 6：图谱检查因同名仓库产生歧义** | `graph:check` 改为 `node .gitnexus/run.cjs check --cycles --json -r .`，锚定当前工作区，彻底消除同名歧义。 | **彻底解决 (Fixed)** |

---

## 6. 行动路线与整改建议 (Actionable Recommendations)

### Phase 1：立即修复（阻断工程闭环项）
1. **修复 `productionRoutes.test.ts` 的门控冲突**：
   - 为该测试文件注入虚拟/测试用 Provider 环境变量，或使该测试明确兼容新的 `advanceGuard` 行为，恢复 Web 全量测试 100% 绿灯。
2. **修复 ESLint 检查超限错误**：
   - 调整 `eslint.config.js` 中 `parserOptions.projectService` 的测试文件匹配配置或提升最大匹配计数限制，移除 `scripts/gen-adr-refs.mjs` 中未使用的 `AMBIG` 变量，恢复 CI Lint 门禁。
3. **修复移动端首启向导缺失**：
   - 在 `apps/web/src/App.tsx` 中将 `WizardOverlay` 挂载逻辑提取到移动端分支之前，确保移动端新用户首次进入时能正常完成五步建书向导。

### Phase 2：体验与产品收口（技术预览版完善）
1. **消除中栏占位页割裂感**：
   - 重构 `PlaceholderView` 与检视塔联动，将质量门、Story Brain、装配看板等直接以内嵌视图形式呈现在中栏，或统一跳转交互，剔除「开发内部排票代号」等违例文案。
2. **将「代码图谱」从商业主导航中剥离**：
   - 移入独立的开发者调试弹窗或以快捷键呼出，避免混淆普通作者的视听。
3. **完善单机诊断日志一键导出**：
   - 在系统中心提供「导出本地诊断日志包（脱敏环境配置 + 数据库校验报告 + 最近报错日志）」功能，为技术预览版用户提供问题反馈渠道。

### Phase 3：商业化准备（后续里程碑）
1. **商业签名与证书采购**：
   - 为 Windows 安装器申请并配置 Authenticode 代码签名证书，解决安装拦截问题。
2. **接通至少一个真实在线支付渠道**：
   - 对接支付宝当面付或微信 Native 扫码支付的真实预下单接口，配合轮询或回调实现自动化权益充值。
3. **补充法律与合规文档**：
   - 补齐仓库根目录 `LICENSE`，在安装向导中展示最终用户许可协议（EULA）与数据隐私承诺。

---

*报告生成完毕，本审查所有结论均来自真实代码、图谱与测试命令输出，附带确切出处。*
