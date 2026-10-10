# 墨舟 (MoZhou / Novel OS) 关键接口行为语义契约总表
# (INTERFACE-CONTRACTS.md)

> **审计基线**：仓库根 `C:\zcode\novel-ai` @ 分支 `feature/windows-local-release` (ahead 7) · HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`  
> **双版本标注**：未修改文件标明 `HEAD:90b45a1`；受 42 项工作区改动影响的文件标明 `WORKTREE(未提交)`  
> **审计口径**：对齐 `audit-2026-10-03/00-audit-charter.md` 与 `07-crosscheck-review.md` 交叉复核裁决（纠正商业支付强保证过度包装、纠正 SQLite 裸函数无锁推演）  

---

## 一、 11 项关键操作契约审计总览矩阵

| 操作序号与名称 | HTTP/IPC 路由与方法 | 核心业务领域符号 | 物理数据落盘点 | 保证强度评级 | 幂等机制与真实行为语义 |
|:---:|---|---|---|:---:|---|
| **01. 保存草稿** | `POST /api/chapter.prose.save` | `LocalDataPlane.saveProseDraft` | `正文/第一卷/第NN章.md`<br/>`.mozhou/manifest.json` | **【中保证】** | **CAS 乐观锁防丢，但非真正幂等**：重复保存携带原 `expectedRevision` 返回 409 冲突，客户端需拉取快照比对。 |
| **02. 采纳候选** | `POST /api/draft.accept` | `draft-accept.ts:acceptDraft` | `.mozhou/candidates/<id>.intent.json`<br/>`正文/第一卷/第NN章.md` | **【强保证】** | **双重 2PC 意图真幂等**：`idempotencyKey` 去重；已执行者直接返回 `alreadyApplied: true`，不重复写盘。 |
| **03. 撤销采纳** | `POST /api/chapter.prose.save` | `DialogueStream.handleUndoAccept` | `正文/第一卷/第NN章.md`<br/>(写新 revision) | **【中保证】** | **前向升版写入（Forward Step）**：非底层回滚；绑定 `afterRevision` CAS 保护，采纳后有新手工编辑则 409 拒绝。 |
| **04. 定稿提交** | `POST /api/chapter.commit` | `commit-orchestration:runChapterCommit`<br/>`chapter.ts:commitChapter` | `.mozhou/pending_commit.json`<br/>`追踪/*.jsonl`, `events.jsonl`<br/>正文 frontmatter committed | **【中保证】**<br/>(原强保证降级) | **预写日志 2PC 编排**：正常单次崩溃可自愈；但**确证二次中断丢数据缺陷**；重试返回 409 拒绝，非幂等返回成功。 |
| **05. 生成候选** | `POST /api/draft.stream` | `pipelineRoutes.ts:546`<br/>`runDraftStep` / `buildDraftContext` | `.mozhou/candidates/<id>.json`<br/>`.mozhou/receipts/rcpt_*.json` | **【中保证】** | **非幂等，流式隔离写入**：每次生成全新 UUID 候选文件；网络重试会导致二次大模型真实 Token 计费。 |
| **06. 取消生成** | 本地 Abort /<br/>`POST /api/draft.cancel` | `DialogueStream.handleStop`<br/>`cancelCandidate` | 候选标记 `cancelled` 或 `partial` | **【弱保证】** | **半稿保护，但缺乏模型端硬截断**：客户端切断流；半稿保留字数（partial）；无法保证外部云端大模型立即停止扣费。 |
| **07. 灾难恢复** | `LocalDataPlane.open()`<br/>`openOrRebuild()` | `recoverPendingCommit`<br/>`rebuildProjectionFromCanon` | 重放追踪流至 SQLite<br/>全量从 Markdown 重建 SQLite | **【强保证】**<br/>(纠正无内存锁) | **确定性自愈**：SQLite 投影可 100% 幂等无损重建；底层为纯函数导出，**缺乏每书互斥锁排队机制**。 |
| **08. 导出作品** | `POST /api/export` | `exportCleanTxt`, `exportSubmissionDocx`<br/>`exportSubmissionEpub` | 内存转换流式输出，服务端零磁盘写入 | **【强保证】** | **纯只读强校验**：防空章守卫（`EXPORT_EMPTY_CHAPTER` 409 拦截），保证出版级格式一致性。 |
| **09. 设备认证** | `POST /api/auth/device-code`<br/>`POST /api/auth/poll` | `account/deviceFlow.ts` | 内存暂存，授权后写入 SQLite 会话表 | **【中保证】** | **OAuth 2.0 设备流标准**：防暴力轮询退避；本地技术预览版弱密码学上下文。 |
| **10. 凭据配置** | `POST /api/models/settings` | `security.ts:encryptSecret`<br/>`decryptSecret` | `settings.json`<br/>AES-256-GCM 密文存储 | **【中保证】** | **本地对称加密存储**：防明文窥探；但密钥来源于本地环境变量或安装密钥，防物理逆向能力有限。 |
| **11. 商业支付** | `POST /api/billing/orders`<br/>`POST /api/billing/webhook` | `BillingStore.createOrder`<br/>`confirmOrderAndGrant` | `dataRoot/billing.sqlite`<br/>(独立 orders / grants 表) | **【弱保证/原型】**<br/>(强制降级) | **仅为本地测试虚拟 Mock 链接**：恒定返回 `mock_checkout` 虚拟 URL；无真实商户与公网打通，禁止标为商用强保证。 |

---

## 二、 核心操作 12 问闭环契约细化表

### 2.1 操作一：保存草稿 (Save Prose Draft)
- **实现源码**：`apps/web/server/routes/proseRoutes.ts:293` [`HEAD:90b45a1`] -> `packages/data-plane/src/chapter.ts:805` [`HEAD:90b45a1`]
- **Q1 权限检查**：本地模式（`MOZHOU_HOSTED=false`）无鉴权；托管模式由 `decodeBookRequest` 检查 `principal.userId`。
- **Q2 输入约束**：非空 `root`、`chapterIndex >= 1`、非空 `body`、必须显式携带 `expectedRevision`（正整数或新建时的 null）。
- **Q3 成功保证**：物理磁盘 `正文/第一卷/第NN章.md` 完成原子替换（`atomicReplace`），frontmatter revision 递增，`manifest.json` 刷新。
- **Q4 一致性边界**：单文件原子替换。正文写入与 manifest 刷新非跨文件事务。
- **Q5 重复调用**：非真正幂等，表现为 409 `PROSE_REVISION_CONFLICT`。
- **Q6 竞争处理**：CAS 乐观锁。核心路径 `proseRoutes.ts` 漏走 `withBookLock`，依赖文件系统层 CAS 抢锁。
- **Q7 超时确认**：主动发起 `POST /api/chapter.prose` 比对 `revision` 与正文哈希。
- **Q8 取消语义**：底层为同步阻塞落盘，连接切断仍会完成磁盘写入。
- **Q9 错误重试**：参数错误 400 不可重试；409 冲突必须由前端做差异核对后带最新 revision 重试。
- **Q10 重启恢复**：以磁盘文件为准。中断遗留的 `.mozhou-tmp` 脏文件不会被自动清除，后续保存会覆盖之。
- **Q11 格式兼容**：YAML Frontmatter 宽容解析缺少字段，版本单调递增。
- **Q12 链路关联**：正文 Markdown 文件未记录任何 `requestId` 或链路 ID，因果链断裂。

---

### 2.2 操作二：采纳候选 (Accept Draft Candidate)
- **实现源码**：`packages/pipeline/src/draft-accept.ts:184` [`HEAD:90b45a1`]
- **Q1 权限检查**：`decodeBookRequest` 校验书籍归属。
- **Q2 输入约束**：`candidateId` 必须存在且处于 `ready` 状态；若为 `partial` 必须显式携带 `allowPartial: true`；必须携带客户端读取基线 `base`。
- **Q3 成功保证**：合成候选内容写入正文；候选标记为 `accepted`；生成意图文件。
- **Q4 一致性边界**：两阶段意图模式（2PC Intent）。先写 `intent.json`，落正文，再写 `state: 'done'`。
- **Q5 重复调用**：**真正幂等**。相同 `idempotencyKey` 命中已完成意图，直接返回 `alreadyApplied: true`，零副作用。
- **Q6 竞争处理**：受版本 CAS 与意图锁双重互斥保护。
- **Q7 超时确认**：使用相同 `idempotencyKey` 重新发起请求，若成功则返回上次执行快照。
- **Q8 取消语义**：进入 `withBook` 事务后不可取消。
- **Q9 错误重试**：`BASE_STALE` 409 错误不可自动重试，需展示文本差异。
- **Q10 重启恢复**：重启检测到 `state: 'intent'` 时，自动比对磁盘正文状态完成前滚或后滚。
- **Q11 格式兼容**：规范化合成文本换行符，产出标准 Markdown。
- **Q12 链路关联**：意图文件完整记录了 `candidateId` 与 `idempotencyKey`，具备因果关联链。

---

### 2.3 操作四：定稿提交 (Commit Chapter with 2PC Orchestration)
- **实现源码**：`packages/pipeline/src/commit-orchestration.ts:191` [`HEAD:90b45a1`] -> `packages/data-plane/src/chapter.ts:569` [`HEAD:90b45a1`]
- **Q1 权限检查**：`proseRoutes.ts:480` 经由 `decodeBookRequest` 校验。
- **Q2 输入约束**：章节必须为 `phase: draft`；盘面版本等于 `expectedRevision`；不存在未决陈旧提案。
- **Q3 成功保证**：正文 frontmatter 翻转为 `committed` 并记录 `commitId`；设定追踪流追加事实；审计事件行入账；SQLite 插入索引行。
- **Q4 一致性边界**：双平面两阶段提交预写日志（`.mozhou/pending_commit.json`）。线性化点为正文原子重命名。
- **Q5 重复调用**：返回 409 `CHAPTER_ALREADY_COMMITTED`，客户端需通过读取快照确认。
- **Q6 竞争处理**：编排层通过相位锁与 revision CAS 拦截并发写者。
- **Q7 超时确认**：客户端拉取章节信息，检查 `commitId` 是否在场。
- **Q8 取消语义**：进入 `commitChapter` 后无法取消；前置提取阶段受 AbortController 约束。
- **Q9 错误重试**：门禁冲突（`hard_conflict`）不可重试，必须作者改稿回炉。
- **Q10 重启恢复**：调用 `recoverPendingCommit`。**注意：前滚阶段二次中断存在静默丢数据缺陷（F-01）**。
- **Q11 格式兼容**：追踪流与事件流采用确定性追加 JSONL，向前兼容未知字段。
- **Q12 链路关联**：全链路注入 `commitId`，在正文、事件账本、飞轮用量与提案中全量串联。

---

### 2.4 操作十一：商业支付、订单与权益 (Billing & Entitlements)
- **实现源码**：`apps/web/server/billing/store.ts:120-250` [`HEAD:90b45a1`]
- **Q1 权限检查**：校验 `userId` 与登录会话。
- **Q2 输入约束**：有效 `planId`（从 catalog 读取防篡改）、非空 `idempotencyKey`、有效支付渠道。
- **Q3 成功保证**：在 `billing.sqlite` 插入订单记录，计算金额；**仅生成虚拟测试链接**。
- **Q4 一致性边界**：SQLite 单本地数据库事务。
- **Q5 重复调用**：唯一约束 `(user_id, idempotency_key)` 拦截，返回既有订单快照。
- **Q6 竞争处理**：SQLite 文件级写锁排他。
- **Q7 超时确认**：客户端依据 `orderId` 查询订单状态。
- **Q8 取消语义**：未支付订单支持超时失效；已支付履约不可逆。
- **Q9 错误重试**：支付异常需重新发起支付流程。
- **Q10 重启恢复**：SQLite WAL 保证本地订单状态机不损坏。
- **Q11 格式兼容**：固定 DDL，无在线迁移机制。
- **Q12 链路关联**：串联 `orderId`、`userId` 与 `grantId`。
- **保证评级纠正说明**：**该接口目前恒定返回 `https://pay.${channel}.com/mock_checkout/${orderId}` 虚拟地址**，无公网支付渠道和商户真实凭据打通。依据 `07-crosscheck-review.md` 驳回项 05 裁决，**强制评定为【弱保证 / 原型级 (PROTOTYPE)】**。
