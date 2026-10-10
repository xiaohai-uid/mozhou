# 墨舟（MoZhou）功能商用生产级最终复盘与交接报告

审计日期：2026-08-13（最终部署复核）  
范围：功能层，不含支付、订阅和会员商业化；包含本轮已授权的生产迁移、部署和 smoke。  
当前结论：**核心写作/导入/追踪/候选变更/拆解/长短榜已上线并通过本轮证据；封面为 configuration_required；WebDAV 尚无真实凭据 E2E；核心非支付生产范围 PASS，全量含外部配置能力为 CONDITIONAL PASS。**

> 本文是当前工作区的最终事实包，供无法访问本地仓库、数据库和 Obsidian Vault 的网页端 AI 阅读。它覆盖本轮实现、验证证据、部署平台、参考资料、剩余阻断项和执行边界。

## 1. 最终裁决

网页端 AI 在收到本轮最新事实后给出的只读裁决：

```text
OVERALL
CONDITIONAL PASS

CORE WRITING RELEASE CANDIDATE
PASS

FULL NON-PAYMENT FEATURE COMMERCIAL READINESS
CONDITIONAL PASS

PRODUCTION RELEASE
CORE SCOPE DEPLOYED / FULL FEATURE SCOPE CONDITIONAL
```

当前可以使用的准确名称：

> **MoZhou Core Non-Payment Production Release**

中文：

> **墨舟核心非支付生产版本**

当前不能使用的名称：

- 包含未配置外部 Provider 的全部非支付功能完全验收版；
- oh-story 13 项能力全部原生完成；
- 全量非支付能力已经全部 Production Accepted；
- 封面或 WebDAV 已经在没有外部配置时通过。

## 2. 项目与部署平台

### 2.1 线上已确认平台

| 层 | 平台/服务 | 用途 | 当前事实 |
|---|---|---|---|
| Web 应用 | Google Cloud Run，服务 `mozhou-web` | Next.js standalone Web 与 API | 最终部署，100% 流量到 `mozhou-web-00008-hzq` |
| LLM 网关 | Google Cloud Run，服务 `mozhou-one-api` | OpenAI 兼容请求、渠道路由、SSE | 已有线上服务；墨舟 Web 通过运行时变量连接 |
| 主数据库 | Neon PostgreSQL，文档记录数据库 `neondb` | 用户、作品、章节、消息、设定、技能、用量、追踪 | 已有线上数据库；本轮本地迁移已应用 |
| one-api 数据库 | Neon PostgreSQL 独立数据库 `oneapi` | one-api 用户、渠道、模型、令牌与网关数据 | 与墨舟主库分离 |
| 镜像 | Google Artifact Registry | 保存 Web/one-api 容器镜像 | 既有部署链路使用 |
| 密钥 | Google Secret Manager | `DATABASE_URL`、`AUTH_SECRET`、`ONEAPI_TOKEN` 等 | 既有部署链路使用，值未写入本文 |
| 上游模型 | SenseNova/DeepSeek、智谱 GLM 等，经 one-api 接入 | 文本生成 | 本地真实 one-api smoke 已成功；渠道可能随时间变化 |

线上入口记录为：

`https://mozhou-web-7ecwvlclyq-an.a.run.app`

生产区域记录为 Google Cloud `asia-northeast1`（东京）。既有资料记录 Cloud Run 使用 1 vCPU、1 GiB、最小 0、最大 2、请求超时 300 秒。本轮生产 Neon 已迁移到记录数 21，Web 流量已切换到新 revision。

### 2.2 本地平台

| 层 | 本地实现 |
|---|---|
| Web 开发 | Windows，`C:\zcode\novel-ai\app`，Next.js 16 App Router |
| 数据库 | Docker Compose PostgreSQL 16 + pgvector，宿主端口记录为 5433 |
| 本地 one-api | Docker Compose，宿主端口记录为 3001 |
| 开发访问 | `http://localhost:3000`（或测试动态端口） |
| 测试 | Vitest 单元/HTTP 契约、动态 Next dev server、测试 provider |
| 发布构建 | `tsc --noEmit` + `next build` |
| 真实模型验证 | 本地 Next server + 本地/既有 one-api 真实 SSE |

### 2.3 线上与本地的边界

```text
浏览器
  -> Cloud Run mozhou-web（线上）或本地 Next server
  -> 墨舟 API / service
  -> one-api
  -> SenseNova/DeepSeek/GLM 等模型渠道
  -> SSE
  -> 墨舟数据库
```

本轮同时验证本地候选、生产 Neon、Cloud Run 新 revision 和线上 API smoke；未配置的外部能力仍按配置要求/未验收处理。

## 3. 本轮已经完成并验证的功能

### 3.1 首写黄金路径

新作品不再只创建一个空作品然后把作者留在“人物库/世界观/章节均为 0”的页面。现在统一通过原子入口创建：

```text
作品
→ 第一章
→ 首写 workflow
→ 章节编辑器
```

已具备：

- `POST /api/v1/novels` 与 `/bootstrap` 的 `requestKey` 幂等；
- 作品、第一章和 workflow 同事务创建；
- 历史零章节作品可通过 `start-writing` 恢复；
- 章节 owner 校验和 `revision`；
- 创建成功后 UI 直接跳转章节编辑器；
- 正文保存、刷新恢复和章节对话链。

### 3.2 AI 上下文与候选变更

最终模型输入已经按语义分层：

```text
SYSTEM
  BaseIdentity
  ModeContract
  作品/Canon/RAG
  当前章节正文参考
  Style
  Skill
  压缩摘要

MESSAGES
  保留的历史
  当前 user message（最后一条）
```

已修复/验证：

- 基础“墨舟中文小说写作助手”身份提示；
- 当前用户消息真正进入 provider；
- 压缩后的 kept history 真正替换发送历史；
- 作品绑定和 owner 边界；
- 生成先写 Candidate，不直接污染正文；
- `generationKey`、`requestHash` 幂等；
- provider 完成、失败、停止和刷新恢复状态；
- 确认插入前检查章节 `revision`、正文和选区；
- 重复确认不重复修改正文；
- discard/撤销路径；
- 失败时 fail-closed。

### 3.3 正文导入

`story-import` 已从“只复制提示词/需要人工工作流”升级为一个原生基础闭环：

```text
用户选择拥有使用权的正文
  -> POST /api/v1/novels/import
  -> 作品 + 第一章 + workflow + 正文同事务落库
  -> 进入章节编辑器
```

导入约束和证据：

- 书名 1–100 字；正文至少 200 字，最多 200000 字；
- 首章 `revision=1`；
- 用户请求键唯一；
- 重试返回原作品/原章节，不覆盖原正文；
- UI 在拆解页提供“直接导入为新作品并开始写作”；
- 测试覆盖正文保真、workflow、revision、幂等和过短输入拒绝。

### 3.4 作品级追踪与结算

`storyrepo` 已有 Web 原生基础适配器和数据库真源：

- `novel_trackings`：作品级追踪状态和 `stateRevision`；
- `story_tracking_records`：章节结算记录；
- `story_reviews`：审查历史；
- `story_workflow_runs`：幂等键、运行状态、输出和错误；
- 章节 owner 校验；
- 结算幂等；
- 机检六项检查；
- 机检不通过时为 `rejected`，不写入完成态；
- 通过后才更新追踪、章节记录和审查历史；
- `expectedStateRevision` + 条件更新防止并发覆盖；
- UI 可显式填写本章结果、人物状态、承诺和读者已知信息；
- 未提供事实时不自动猜测、不把正文复制成事实。

当前必须诚实理解为：

> 作品级追踪已经具备可审计的事务基础和显式事实合并能力；它不是“自动从整本小说可靠提取所有人物、伏笔、时间线和读者认知”的完整 AI 事实提取系统。

### 3.5 拆解结果资产

`POST /api/v1/deconstruct/analyze` 已增加运行记录：

- `deconstruction_runs` 表；
- 请求键幂等；
- 正文 SHA-256 和长度记录，不重复保存正文；
- `running/completed/failed` 状态；
- 结果 JSON 持久化；
- 失败状态和错误消息持久化；
- `GET /api/v1/deconstruct/runs` 只返回当前用户记录；
- 作品绑定时验证 owner；
- 拆解页刷新后可查看已保存结果。

这已经满足“分析结果不是一次性临时响应”的基础产品要求；本轮已补齐长篇 Stage 0–6、短篇 Stage 0/2–6 的结构化产物、重试、修复、恢复和下游 reference consumer，并通过网页端 Stage 1 PASS。

### 3.6 真实性与安全边界

- 外部搜索/书源/榜源失败时返回空结果和 `degraded`，不再用固定样例冒充实时结果；
- 同步凭据改为 AES-256-GCM 密文存储，旧明文拒绝；
- 技能删除增加 owner 约束；
- 所有作品、章节、会话和运行记录按当前用户隔离；
- 生产测试模式与真实 provider 模式分开标识；
- 外部能力未配置时显示明确状态，不伪造“已可用”。

## 4. oh-story 资料与能力矩阵

完整 vendor 快照位置：

`C:\zcode\novel-ai\app\lib\story\vendor\oh-story`

包含 13 项：

| 能力 | 当前状态 | 墨舟适配器/事实 |
|---|---|---|
| story | native | `/workspace` 工作台和导航 |
| story-cover | configuration_required | `/api/v1/story/cover`；缺真实图片 Provider，明确返回 503 CONFIGURATION_REQUIRED |
| story-deslop | native | `/api/v1/tools/checks` 机检；完整改写仍需明确写作调用 |
| story-import | native | `/deconstruct` + `POST /api/v1/novels/import` |
| story-long-analyze | native | `/api/v1/deconstruct/analyze`；真实 one-api、阶段产物、重试、恢复和 reference consumer |
| story-long-scan | native | `/api/v1/rankings`；番茄真实榜源、来源标识、抓取时间、重试和 degraded |
| story-long-write | native | `/projects` + `/chapter` + 章节 chat/candidate/mutation |
| story-review | native | `/api/v1/tools/checks` + 作品页审查/结算 |
| story-setup | native | `/api/v1/novels/bootstrap` |
| story-short-analyze | native | `/deconstruct` + `/api/v1/deconstruct/analyze`；真实 one-api、阶段产物、重试、恢复和 reference consumer |
| story-short-scan | native | `/api/v1/rankings`；番茄真实榜源、来源标识、抓取时间、重试和 degraded |
| story-short-write | native | `/chat` 独立写作对话 |
| storyrepo | native | `GET/POST /api/v1/novels/[id]/tracking` |

vendor 文件存在只代表源资料保真，不代表对应能力已经成为墨舟的完整生产功能。当前注册表保持这种差异，避免把“复制技能”误写成“功能已完成”。

## 5. 尚未达到全量商用级的阻断项

### 5.1 长短篇拆解已通过 Stage 1，仍有模型质量边界

当前已经完成：

```text
合法自有正文
→ one-api JSON 三段分析
→ 运行状态
→ 结果落库
→ UI 恢复/回流
```

长篇返回 Stage 0–6，短篇返回 Stage 0、2–6；阶段资产有稳定 `id/kind/schemaVersion`、必填字段校验、失败 fail-closed、运行记录、owner 隔离和下游 reference consumer。网页端已裁决 Stage 1 PASS。边界是：它不是无限长小说的自动全书知识图谱。

### 5.2 榜单扫描已接入真实番茄来源，仍需多源扩展

长篇与短篇当前均使用番茄小说真实榜源，返回真实书名、`source`、`capturedAt`、URL，并对 429/5xx/超时重试；失败返回空列表+degraded，不展示虚构样例。本轮线上两个榜单均 HTTP 200、各返回 5 条真实行。当前仍是单一来源，不应表述为多平台全量扫榜。

### 5.3 封面依赖真实图片 Provider

`story-cover` 当前不能称生产完成。至少还需要真实图片模型、失败处理、媒体存储、预览/版本和平台尺寸验证。当前 `/api/v1/draw` 是文本候选抽卡，不是完整封面生产管线。

### 5.4 WebDAV 缺真实凭据 E2E

同步凭据存储安全基线已改善，但没有真实 WebDAV 账户完成上传、断网、重试、错误和恢复 smoke。因此同步应继续被视为“已接入配置/适配层，待真实凭据验收”，不能称生产同步已验收。

### 5.5 生产部署与线上 smoke

本轮已执行：

- 构建并推送最终镜像 `commercial-20260813-0005`；Artifact Registry manifest-list digest 为 `sha256:64803b30e2ea57535014094c82f19043e5406587068fcc1438953222fd7ba7e0`，Cloud Run revision 实际解析的 Linux 镜像 digest 为 `sha256:aeac314e12f24fe02b35be9cb2bb5f68aa716a7dd3b07f43d5fcfdb030fae749`；
- Cloud Run revision `mozhou-web-00008-hzq`，100% 流量；旧 revision `mozhou-web-00007-kt5` 仍保留为回滚候选，之前稳定 revision `mozhou-web-00006-wic` 亦保留；
- Neon migration 0013–0020，迁移记录数 21；
- 线上注册、作品/首章、正文保存、真实 SSE、候选持久化、确认插入、刷新恢复 smoke；
- 候选 revision 独立烟测：注册 201、能力清单 200/13 项、长短榜各 5 条真实 Fanqie 数据、封面 503/CONFIGURATION_REQUIRED、原子首写 201；
- 切流后的线上黄金路径：注册 201 → 作品/首章 201 → 正文保存 200 → 真实 SSE 200（start/delta×48/done，364 字，约27秒）→ 消息持久化 → 确认插入 200 → 刷新正文一致；
- 线上长/短榜真实源 smoke；
- 线上短篇拆解真实 one-api smoke；
- 旧 revision `mozhou-web-00006-wic` 保留为回滚目标。

封面和 WebDAV 没有被伪造为通过：封面线上返回 `503 CONFIGURATION_REQUIRED`；WebDAV 因没有真实 endpoint/凭据，未进行真实上传验收。

## 6. 验证证据

### 6.1 最新本地门禁

执行命令：

```text
npm run gate:milestone
```

结果：

- `tsc --noEmit`：PASS；
- Vitest：23 个测试文件、194 个测试 PASS；
- `next build`：PASS；干净 Docker 构建也 PASS（改用系统字体栈，移除构建期 Google Fonts 网络依赖）；
- 生产构建生成 42/42 页面/路由；
- 新路由包含 `/api/v1/deconstruct/runs`、`/api/v1/deconstruct/runs/[runId]/reference`、`/api/v1/novels/import` 和 `/api/v1/story/cover`；
- `git diff --check`：未发现空白错误（仅有 Windows LF/CRLF 警告）。

### 6.2 数据库迁移

执行：

```text
npm run db:generate
npm run db:migrate
```

结果：

- 0013–0018 已在此前阶段生成并应用；
- 0019 `deconstruction_runs` 已生成并应用；
- 迁移可重复执行；
- 当前本地数据库 schema 与代码一致。
- 生产 Neon 已通过 advisory lock + transaction 应用 0013–0020，`migrationCount=21`；

### 6.3 真实模型 smoke

执行：

```text
node scripts/smoke-real-llm.mjs
```

结果：

```text
A1 SMOKE: PASS
注册测试账号
作品/章节创建 + 正文保存
SSE start/delta/done
AI 消息持久化
刷新后仍可读取
确认插入正文
正文再次真实保存
```

最终 revision 的线上真实 SSE 产生 48 个 delta、364 字真实文本；候选持久化、确认插入和刷新恢复均成功。最终 revision 的 Cloud Run 日志同时证明 payload observer 收到 `current_user_present=true`、`message_roles=["user"]`、`system_sections=["base_identity","mode_contract","chapter_reference","skill"]`。线上短篇拆解第二次复验 HTTP 200，Stage `[0,2,3,4,5,6]`。测试账号已清理；账号、密码、令牌和数据库连接信息不写入本文。

### 6.4 浏览器黄金路径

此前已用真实浏览器验证：

```text
注册
→ UI 创建作品
→ 进入章节编辑器
→ 保存正文
→ 刷新仍在
→ 真实模型生成候选
→ 确认插入
→ 刷新后正文和消息仍在
```

线上 API smoke 已通过；本轮未重新录制浏览器视频，但核心浏览器路径已有此前真实浏览器证据，生产 revision 已完成 API/模型/数据库链路复核。

## 7. 参考资料及其吸收边界

### OpenWrite 逆向资料

用途：产品结构、身份提示、工具面、上下文压缩、服务端 gating 的参照。  
已吸收：写作助手身份基座、上下文分层、用户消息优先、候选写回边界、真实能力状态区分。  
未照搬：逆向版本混杂、终端命令、管理面、供应链和会员实现。

### 灵笔 / LingBi 资料

用途：本地优先写作循环和候选变更契约。  
已吸收：Canon/作品资料是一等上下文；生成候选、确认后写入；Mutation/owner/fail-closed；真实 consumer 验收。  
边界：历史 Flutter/LingBi 产品线、`lingbi-next`/Fusion 和墨舟当前 Web 不是同一个产品或数据库。

### 零界道种资料

用途：内容生产工作流、状态追踪和长篇连续性需求参照。  
已吸收：状态、追踪、章节结算、事实与读者视图分层的产品要求。  
边界：零界道种是独立 AI 漫剧生产项目；EP01 分镜/提示词不是墨舟小说正文，不能直接当成墨舟作品资产。

### oh-story / `worldwonderer/oh-story-claudecode`

用途：13 项小说技能、长篇生产协议、拆解资产、storyrepo 追踪、封面和榜单方法。  
已完成：完整 vendor 快照、13 项能力注册表、适用能力的原生 Web adapter、明确 provider/source gating。  
边界：skill 文档、shell/Python 引擎和 vendor 文件不能自动成为 Next.js 生产 API；需要逐项接入、持久化和真实 consumer 验收。

### 《星渊剑主》、DeterminFlow 等

《星渊剑主》是长文上下文测试材料，不是零界道种或生产用户作品。DetermininFlow 是状态机、校验、重试和预算的方法论，不是墨舟线上依赖。

## 8. 当前代码状态与交接文件

主要候选改动集中在：

- `app/lib/novels/service.ts`：首写、导入、恢复、章节 owner/事务；
- `app/lib/novels/chapter-chat.ts`：上下文、Candidate、SSE、幂等和冲突；
- `app/lib/story/tracking.ts`：作品级追踪结算；
- `app/lib/story/checks.ts`：共享六项机检；
- `app/lib/schema.ts`：追踪和拆解运行表；
- `app/lib/story/capabilities.ts`：oh-story 13 项能力注册表；
- `app/app/api/v1/novels/import/route.ts`；
- `app/app/api/v1/novels/[id]/tracking/route.ts`；
- `app/app/api/v1/deconstruct/analyze/route.ts`；
- `app/app/api/v1/deconstruct/runs/route.ts`；
- `app/components/features/projects-view.tsx`；
- `app/components/features/deconstruct-view.tsx`；
- `app/drizzle/0013_*.sql` 至 `app/drizzle/0019_lethal_slapstick.sql`；
- `app/lib/story/vendor/oh-story/`。

相关交接资料：

- `docs/mozhu-web-ai-handoff-context-2026-08-12.md`：部署平台、产品边界、原始问题、参考项目；
- `docs/project-data-package-v1.3.md`：前一轮项目数据包；
- `docs/mozhu-full-materials-audit-report-2026-08-12.md`：小说资料与参考材料审计；
- `docs/mozhu-writing-context-contract-repair-final-plan-2026-08-12.md`：上下文契约修复计划；
- `docs/production-deployment.md`：既有 Cloud Run 部署 runbook；
- `docs/mozhu-commercial-functionality-audit-2026-08-12.md`：早期审计，部分结论已被本文更新；
- `app/lib/story/vendor/oh-story/storyrepo/SKILL.md` 与其 `references/`：storyrepo 原始生产协议。

## 9. 下一步唯一正确的发布路径

如果要继续冲击“全量非支付能力商用级”，顺序应固定为：

```text
1. 为封面接入真实图片 provider、媒体存储、预览/版本/尺寸适配
2. 提供真实 WebDAV 凭据后做上传/失败/重试/恢复 smoke
3. 扩展第二个及以上真实榜源，并继续验证解析质量和 degraded
4. 本地全量门禁与线上浏览器人工回归
5. 保留回滚 revision，完成发布后观察
```

当前 revision 回滚命令：

```text
gcloud run services update-traffic mozhou-web --region=asia-northeast1 --project=mozhou-prod --to-revisions=mozhou-web-00007-kt5=100
```

封面和 WebDAV 外部配置完成后，应重新执行对应真实 E2E，并再次交给网页端 AI 做最终能力裁决。
