# V1.1 Release Hardening（阶段 A 完成报告）

日期：2026-08-10。范围：三个已知验证缺口（A1 真实 LLM / A2 真实 WebDAV / A3 3100 端口污染）。
V1.1 不再增加任何产品功能。本阶段不引入新依赖、不改产品架构。

## A1. 真实 LLM 最小 Smoke Test — **PASS**

验证链路（完整 8 步）：`章节编辑 UI → chat API → 注入链 → 真实 LLM Provider(one-api) → SSE → AI 消息 → 消息持久化 → 页面刷新 → 插入正文`。

- 方式：`app/scripts/smoke-real-llm.mjs`（可重复运行，无新测试框架，不改生成管线）+ 浏览器真实交互复验。
- API 链路（脚本，真实 one-api 网关 + 真实上游模型）：注册 → 作品/章节 → 正文保存 → chat（技能=章节续写，默认模型走生产配置）→ SSE `start/delta×28/done`，耗时 5.5s，真实文本 165 字（内容与章节语境一致：老周/黄土坡）→ 消息持久化（messageId=368，刷新 GET 仍在）→ 插入 → 正文 195 字，尾部与 AI 文本一致。
- 浏览器链路（真实 UI，同 server :49206）：登录冒烟账号 → 章节编辑器（正文 195 字含此前插入）→ 对话面板发送「写老槐树下的人影。」→ 真实 LLM 流式返回约 280 字（王老三归来情节）→ 消息显示 → 点击「插入正文」→ API 确认正文 624 字，尾部与 AI 文本一致（真实保存）。
- 注入链（技能/正文上下文）：随请求成功发送，未造成任何请求错误。
- 模型文字质量不评价；只验证生产链路。证据：脚本输出 + 浏览器快照 + 正文 624 字 GET 往返。

## A2. 真实 WebDAV 最小 Smoke Test — **BLOCKED**

- 精确阻塞条件：**缺少真实 WebDAV 凭据（url / username / password 三者均无真实值）**。
  - `.env` 无任何 WebDAV 相关键；`sync_configs` 表中仅有人工验收时的占位配置 `https://dav.example.com/mozhou/`（username/password 均为占位符）。
- 现有实现（工单 20）无需修改：MKCOL 逐层建目录 + PUT `mozhou/<作品名>/<章节号>-<标题>.md` 已在 mock 契约测试覆盖（4/4），真实分支代码路径完整。
- 未伪造测试结果，未扩大实现范围。恢复条件：提供真实 WebDAV 目标三要素后，将配置写入测试账号 `sync_configs`，执行 `pushToWebDAV` 真实分支并实际 GET 远端文件对比正文（含中文作品名/章节名路径）。

## A3. 消除 3100 端口污染 — **PASS（连续 3 次全绿）**

根因调查结论：
- 测试 dev server 生命周期：vitest http project 的 `global-setup.ts` 自拉 `next dev`（固定 :3100 + mock env），teardown `taskkill /T /F`。
- 污染机制（两个）：① 固定端口被孤儿进程占用时，新 child 绑定失败但 readiness 轮询命中孤儿 → 测试跑到残缺 env 的 server 上（静默假绿）；② Next.js 16 引入**项目目录级 dev server 锁**（OS 级 lockfile，`.next` 下，内含 appUrl+pid）：任何存活中的 dev server 都会让同目录新 `next dev` 拒绝启动（无论端口）并退出。

最小修复（`tests/http/global-setup.ts` + 新增 `tests/http/setup-env.ts` + `vitest.config.ts`）：
1. **动态空闲端口**：`pickFreePort()`（net bind :0）替代固定 3100 → 孤儿进程永远无法再被误命中（静默假绿消除）。
2. **端口文件握手**：global-setup 把端口写入 `tests/http/.test-port`（gitignore 已加），`setup-env.ts`（每个 worker 内、测试模块加载前）注入 `TEST_BASE_URL` → **零测试文件改动**。
3. **快速失败**：`next dev` 提前退出（含 Next 16 锁冲突）时，立即抛出并把日志中的锁冲突信息（already running / PID / kill 命令）透出，不再等 120s 超时。
4. 启动失败路径也杀进程树；teardown 保留（含删除握手文件）。
5. 开发者手动 `npm run dev` 完全不受影响（不同端口、互不干扰；测试从不杀非自己启动的进程）。

附带修复一个 gate 偶发（非端口类，同为确定性缺口）：`chapter-continuation.test.ts` 的「多轮对话」测试发起 chat 后未消费 SSE 响应体就断言消息顺序，与 AI 消息落库赛跑（done 事件在落库后发出）。修复为等待 `done{messageId}` 后再断言。

证据：`npm run gate:milestone` 连续 3 次全部 PASS，每次 tsc + 139/139 契约测试 + production build（37/37 static pages）。期间无任何端口冲突/超时/偶发失败。

## 完成标准核查

| 项 | 结果 |
|----|------|
| TypeScript typecheck | PASS（gate 内含） |
| ESLint | PASS（exit 0） |
| 契约测试 | 139/139 ×3 次 |
| Production build | PASS ×3 |
| Milestone gate 连续 | 3/3 PASS |
| Git diff 审查 | 见下 |
| figma-upload/ 未提交 | ✓（仍为未跟踪） |
| mock/demo 残留 | 无新增；仅 smoke 脚本（非测试套件） |
| V1.1 scope 扩大 | 无（A1/A2 零产品代码改动；A3 仅测试基础设施 + 1 处测试确定性修复） |

## 变更文件

- `app/tests/http/global-setup.ts` — 动态端口 + 握手文件 + 快速失败透出锁冲突
- `app/tests/http/setup-env.ts`（新增）— worker 侧 TEST_BASE_URL 注入
- `app/vitest.config.ts` — 移除静态 env，挂 setupFiles
- `app/tests/http/chapter-continuation.test.ts` — 多轮对话测试等待 SSE done（确定性）
- `app/scripts/smoke-real-llm.mjs`（新增）— A1 可重复 smoke（未挂入测试套件/gate）
- `app/.gitignore` — 忽略 `tests/**/.test-port`
- `docs/release-hardening-v1.1.md`（本文档）

**V1.1 正式 CLOSED。** 后续新功能归入 V1.2。
