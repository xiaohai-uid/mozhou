# 墨舟 (MoZhou)

AI 小说写作平台 —— 自有品牌 · 模型自由 · 数据自有

## 产品线划分（2026-08-30 起，ADR-0025）

- **`apps/web + packages/*` 是 Novel OS 2.0 主线**：pnpm monorepo（`@mozhou/kernel` / `data-plane` / `context-compiler` / `pipeline` / `runtime` / `flywheel` / `benchmark` 等），新的 Story Kernel 与 quality-engine 能力只在这里落地。
- **`app/` 是遗留应用面（legacy）**：V1.x Next.js 单体，**只接收迁移/安全/可靠性修复**，不再新增核心能力；迁移完成前其用户数据导出/读取能力保持可用。

## 快速开始（开发环境）

```bash
# Novel OS 2.0 主线（packages/* + apps/web）
pnpm install
pnpm build
pnpm test

# 1. 启动基础设施（Postgres+pgvector、one-api 网关）— legacy 应用依赖
docker compose up -d

# 2. 启动遗留 Web 应用（开发模式）
cd app
npm install
npm run dev
# 打开 http://localhost:3000（若 3000 被占用会自动换端口，见终端输出）
```

- one-api 控制台: http://localhost:3001 （默认账号 root / 密码 123456，见容器日志）
- 初始化渠道与令牌（DeepSeek + Qwen + 应用令牌）：
  `DEEPSEEK_API_KEY=sk-xxx QWEN_API_KEY=sk-xxx bash scripts/init-one-api.sh`
  （不传 key 会创建占位渠道，之后在控制台补填；应用令牌 key 在控制台「令牌」页查看）
- Postgres 端口 **5433**（避开本机 WSL 原生 Postgres 的 5432）；pgvector 扩展已启用（docker/init/01-init.sql）

## 发布前真实模型门禁

发布前在 `app/` 目录执行：

```bash
npm run gate:release
```

这条命令会依次执行完整测试、生产构建和真实 one-api smoke。真实 smoke 需要 `.env` 中配置可用的 `DATABASE_URL`、`AUTH_SECRET`、`ONEAPI_BASE_URL` 和 `ONEAPI_TOKEN`；它会启动临时 Web 服务，验证真实 SSE、消息持久化和候选插入，结束后自动清理测试账号与作品。不要把它加入日常开发门禁，也不要用 `CHAT_PROVIDER=mock` 代替发布前验证。

如需保留服务和测试账号做浏览器复验，单独执行 `npm run smoke:real-llm -- --keep`，完成后手动清理该账号。

## 结构

```
packages/            Novel OS 核心包（kernel/data-plane/context-compiler/pipeline/runtime/flywheel/benchmark/…）
apps/web             Novel OS 2.0 UI（Vite + React，主线）
app/                 遗留 Next.js 应用（legacy，只收迁移/安全/可靠性修复）
docs/adr/            架构决策记录
docs/specs/          规格文档（chapter-pipeline-spec 等）
docker-compose.yml   Postgres(pgvector) + one-api 编排
.scratch/            本地工单 tracker
prototype/           原型（pipeline-engine.prototype.html）
CONTEXT.md           设计决策记录（grill-with-docs）
```

## 技术栈

- **Novel OS 主线**: TypeScript 5.5 + Node 22 + pnpm workspace + Vitest；UI 为 Vite + React（apps/web）
- **遗留 app/**: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui；PostgreSQL 16 + pgvector + Drizzle ORM；one-api 网关

## 设计来源

墨舟为自有品牌产品。功能方法论参考对 OpenWrite v1.3.2 的完整逆向分析（提示词结构/交互流程），代码与文案全原创；Agent 管线理念借鉴 DeterminFlow（AGPL-3.0，仅理念，无代码依赖）。
