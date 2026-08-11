# 墨舟 V1.2 Release Report（Journey ⑧ + Journey ⑨）

日期：2026-08-11。V1.2 = Journey ⑧ 正文 Undo/Redo（已 Accepted）+ Journey ⑨ 光标/选区/精确 AI 插入（本报告）。

## 1. Journey ⑨ 冻结行为（8 问题最终实现语义）

| # | 语义 | 实现 |
|---|------|------|
| 1 | 无选区插入位置 | 点击「插入正文」时刻的 editor target（caret）——服务端 `position` splice；末尾即旧版追加 |
| 2 | 有选区 | 按钮「替换选中内容」；`mode=replace` 只替换目标区间（`range`），前后文不变 |
| 3 | 生成期间移动 caret | 用**点击插入时的最新 target**（普通续写不绑定生成开始坐标；`targetRef` 由 textarea `onSelect` 实时跟踪） |
| 4 | 生成期间选区被改 | bound selection snapshot（发送时选区非空才建立，`{start,end,text}` 会话级 map）→ 替换前本地比对 → 不一致 → 「选中内容已发生变化」确认（复用 ContentChanged 视觉），绝不静默覆盖 |
| 5 | 插入后 caret | 插入/替换内容末尾 + textarea 重新聚焦（`restoreSelection`） |
| 6 | Undo AI 插入 | 正文 + 光标/选区恢复到插入前（history 每层带 `selection`） |
| 7 | Redo | 正文恢复 + 光标在插入内容末尾 |
| 8 | 保存 | 自动/显式保存不清 undo 栈、不动 selection/target（实测 caret 保持） |

补充冻结规则（用户批准指令并入）：DOM focus ≠ editor target（blur 不重置）；纯 caret 移动不创建 undo entry；force 不 silent clamp（越界 400，只跳过用户已确认的内容冲突）；No new DB / No new API / No new dependency；位置/区间为 UTF-16 code unit（与 selectionStart 一致）。

## 2. Contract

- **chat**：`selection?: {start,end,text}`（校验与正文区间一致，注入 `[所选片段]`，不持久化）。
- **insert（同一 endpoint）**：`mode: "insert"|"replace"`、`position`、`range {start,end}`、`expectedContent`；省略 position = 旧版末尾追加（兼容）。
- 错误：`409 ContentChanged`（expectedContent ≠ 当前正文，force 跳过）、`400`（消息/角色/已插入/空/target 非法/mode 非法）、`404`（归属）。
- 索引：UTF-16 code unit；中文/emoji 混排契约测试。

## 3. Architecture Delta

- 新增：`InsertTarget` 契约、`useBodyHistory` selection 维度、editor target state、bound selection map（前端会话级）、`[所选片段]` 注入。
- 删除：旧"生成时整章快照 ≠ 当前 → 必然 409"语义（J9 收紧为 expectedContent 第一层 + selection 第二层）。
- **No new DB / No migration**（0010/0011/0012 追踪正常，未修改历史迁移）。
- **No new API**（insert/chat 同 endpoint 扩展）。
- **No new dependency**。
- Architecture creep：无（未引入 selection engine/command bus/富文本）。

## 4. Implementation（核心文件）

- `lib/novels/chapter-chat.ts` — insert 精确位置/替换 + 两层冲突；chat selection 注入。
- `app/api/v1/novels/[id]/chapters/chat/route.ts` — selection 校验。
- `app/api/v1/novels/[id]/chapters/messages/[messageId]/insert/route.ts` — target 解析/类型门禁（string/NaN 偷渡 → 400）。
- `components/features/undo-history.ts` — selection-aware history（纯逻辑 + hook）。
- `components/features/chapter-editor-view.tsx` — target state / bound map / 按钮文案 / 两层冲突 UI / caret 恢复。

## 5. Automated Verification（真实执行数字）

- typecheck：PASS（0 错误）；eslint：PASS（0 问题）
- unit：40/40；contract：117/117（http）；**total 157/157**
- build：37/37 static pages
- **gate:milestone 连续 3 次 PASS（157/157 ×3，含最终 force 测试）**；此前 3 次（不含 force 补充）同样 157/157 ×3
- 一次不可复现偶发：某次 gate 中 chapter-continuation 10 个插入测试 404（单文件 23/23、全量 http 117/117、后续 gate ×3 均全绿）——记录为环境性偶发，未发现根因，无代码路径可解释（详见 Known Constraints）。

## 6. Browser Acceptance（真实交互）

- **J9 A–T 全部 PASS**（20 项）：caret 中间/开头/末尾插入、replace selection、blur persistence、生成期间移动 caret、无关编辑不阻塞、bound conflict（H/I/J）、Undo/Redo insert/replace（含选区恢复仍选中）、保存不影响 caret、章节切换/刷新会话级、duplicate click、stale server race（契约层）。
- 性能：52,698 字正文中间插入 205ms（无冻结，不引入 rope/piece-table）。
- **真实 LLM 最终 smoke PASS**：真实模型（one-api 默认）→ SSE 913 字真实候选 → caret=3 精确插入（位置 3 splice，1058 字）→ 保存往返 → Undo（145 字 + caret 恢复 3）→ Redo（1058 + caret 916）。

## 7. Regression Browser Smoke（V1.1/V1.2 核心链）

登录 ✓ / 作品打开 ✓ / 章节打开 ✓ / 正文保存+刷新存在 ✓ / AI chat（SSE+落库）✓ / 风格（保存/选择/[风格] 注入）✓ / 技能（选择/[技能] 注入）✓ / J9 精确 insertion ✓ / J8 Undo/Redo ✓ / selection replace ✓ / websearch 回流（【引用资料】+来源）✓ / sync 页（未配置 push → 真实错误「尚未配置同步」）✓

## 8. Release Hygiene

- 生产代码：无 TODO/FIXME/console.log；无硬编码凭据/API key；`localhost:3001` 仅为 `ONEAPI_BASE_URL` env 默认值。
- MOCK_*（draw/distill/deconstruct/websearch）：全部 `*_PROVIDER === "mock"` env 门控（测试/本地），生产不启用；websearch 降级带 `degraded: true` 显式标注。
- `dav.example.com`：仅存在于契约测试（sync-push.test.ts）。
- **排除功能 fake UI 最小处理**：会员「升级为会员」mock 开通移除 → disabled + 暂未开放；作品导出/备份卡片 → disabled + 暂未开放标注；审查记录区保留显式「界面示意」说明。
- 测试账号密码仅存在于测试文件（合成值）；`.test-port`/`.next-dev.log` gitignore。

## 9. Security（insert seam 审查）

- Authentication：401 ✓；chapter/message ownership：404 ✓（IDOR 测试）；malformed JSON：400 ✓；range abuse：position/range 全量校验（整数/边界/start≤end，8 类非法 target 400）✓；**force 不绕过 target 校验**（越界 + force → 400）✓；duplicate insert：400 ✓；force 不绕过 ownership/auth ✓；style/skill 路径无回归 ✓。

## 10. Known Constraints（真实剩余）

- **External-provider smoke pending credentials**：真实 WebDAV smoke 待真实凭据（BLOCKED，不伪造；代码 audit 通过——未配置时 push 返回真实错误）。
- undo/selection history 与 bound selection 为当前编辑会话级（不跨刷新/设备；刷新后消息降级为普通插入，不误伤）。
- 一次不可复现的 404 测试偶发（见 §5）；Next 16 项目级 dev server 锁 = 同仓库已有 dev server 时 gate 无法启动（A3 已接受约束）。

## 11. Git

- branch：main；commits（V1.2）：`bdfaf7e` spec → `8092d77` feat → `9bda1c4` acceptance → `7e09a65` fix(mode) → `429942e` hygiene → `19900a1` security test（另含 V1.1 hardening `4c88825` 与 J8 系列）。
- git status：干净（仅 `figma-upload/` 未跟踪，按要求不提交）；无 secrets/temp 文件入库。

## 12. Deployment

- 仓库无既有生产部署流程（无 CI/CD/平台配置）。
- **Release-ready code complete. Deployment requires: external deployment target & credentials（Vercel/Cloudflare/自托管 + 生产 DATABASE_URL/AUTH_SECRET/ONEAPI 配置）——不猜不注册。**

## 13. 结论

**Journey ⑨：ACCEPTED 就绪。V1.2：RELEASE READY**（typecheck/lint/157 测试/build/gate×4/浏览器 A–T/回归 smoke/真实 LLM smoke/hygiene/安全审查全部通过）。

## 14. Production Deployment Gate（2026-08-11 追加）

| 阶段 | 结果 | 证据 |
|------|------|------|
| PG1 Production Readiness Audit | **PASS（无发布阻断项）** | cookie HttpOnly/SameSite=Lax/secure(prod)；CSRF 由 SameSite+JSON-only 覆盖；LLM 滥用由登录门槛+配额 429 兜底（无 IP 限流=记录，不阻断）；同源部署无 CORS 需求；错误响应不泄 stack（`{"error":"未登录"}`）；生产代码无 console 日志；待部署者项=HTTPS+密钥（部署指南列明） |
| PG2 测试稳定性 | **PASS（三个根因已修复）** | ① Turbopack 并发首次请求编译竞态（dev-only：请求 404/500[EPERM manifest]）→ global-setup 预热全部 API 路由（重试至非 404）；② 端口文件时序竞态（预热长 await 致 worker 读到残留端口）→ 写端口提前到 ready 后；③ chat 压缩测试未消费 SSE body（中间态历史）→ 测试 await r.text() 同步。修复后全量 http **20 轮 0 失败**（此前 ~50%）+ gate:milestone ×3 PASS。commit 03fe791 |
| PG3 真实生产构建 | **PASS** | clean build（Compiled 3.2s + 37/37 static）→ `next start`（production）→ 首页/login 200、API 未登录 401（JSON 无泄漏）；无 MOCK 自动启用；无 dev-only 假设 |
| PG4 真实数据库 | **PASS** | **Fresh install**：空库按序应用 13 个迁移 SQL（0000-0012，drizzle-kit CLI 在 Windows spinner 挂起→手动 SQL 为官方替代路径）→ production 起服→注册 201/登录 200/建作品/章节/保存 200/读取 MATCH；**Existing data**：既有账号登录+作品/章节/消息读取正常（V1.1→V1.2 无 schema 变化，无无关 migration） |
| PG5-7 部署 | **BLOCKED（缺外部 target/凭据）** | 仓库无既有公网部署目标（部署指南=Docker compose/Vercel 流程，密钥需部署者设置；不自己注册服务）。本地 production 实例（next start + dev 库）执行替代 smoke：**浏览器全链路 PASS**——注册/登录/建项目/章节/编辑/保存/刷新持久化；真实 LLM→caret=3 精确插入→Undo（caret 恢复）→Redo；style 创建/选择；auth isolation（登出 401→重登恢复）；production logs 无 secret |
| PG8 WebDAV | **Sync not production-verified** | 无真实凭据；未配置时 push 返回真实错误「尚未配置同步」，UI 保持未配置状态，绝不伪装成功 |
| PG9 公网 Abuse | **PASS（本地生产实例）** | 未登录受保护资源 401；IDOR 匿名 401；malformed JSON 400；错误响应无 stack/secret；**oversized 记录**：2MB 正文保存成功（Next 16 route handler 默认限制之上）——低危（登录+配额约束、注入链 BODY_REF_LIMIT 截断），不阻断，建议后续加显式正文大小上限 |
| PG10 Release Decision | **CODE RELEASE READY / DEPLOYMENT BLOCKED ONLY BY EXTERNAL TARGET OR CREDENTIAL** | 非 GO（公网部署未执行）、非 NO-GO（无产品 blocker）。最小外部动作：① 公网服务器或 Vercel 项目 + 域名（HTTPS）② 生产 DATABASE_URL/AUTH_SECRET/ONEAPI_TOKEN（公网 one-api 或同机容器）③ 可选：真实 WebDAV 凭据（Sync 生产验证） |
