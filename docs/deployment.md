# 墨舟公网部署指南（V1.0）

> 状态：基建就绪（Dockerfile 使用 `next start` + compose prod profile），**生产密钥需部署者设置**。
> 本文件是部署前置清单，逐项完成后才可上线。

## 前置：三个必须设置的环境变量（缺一不可，缺则启动失败）

```bash
# 1. 生产会话密钥（必须 ≥32 字符随机串；缺失则 next 启动即抛错，防伪造 JWT）
export AUTH_SECRET="$(openssl rand -base64 48)"

# 2. one-api 网关地址：
#    - 同机容器部署：http://one-api:3000（compose 默认）
#    - 独立公网部署：https://your-oneapi.example.com（需 HTTPS）
export ONEAPI_BASE_URL="http://one-api:3000"

# 3. one-api 应用令牌（在 one-api 后台创建；注意：令牌有权限，勿泄露）
export ONEAPI_TOKEN="sk-xxx"
```

## 部署方式

### A. 单机 Docker（推荐起步）

```bash
# 1. 基础设施（postgres + one-api）
docker compose up -d

# 2. 生产全栈（app + 基础设施；需设置上述 3 个环境变量）
export AUTH_SECRET=... ONEAPI_BASE_URL=... ONEAPI_TOKEN=...
docker compose --profile prod up -d --build

# 3. 先对 app 实际使用的 compose 网络数据库执行全部迁移
#    不要直接在宿主机执行 `cd app && npx drizzle-kit migrate`：
#    宿主机 .env 通常指向 localhost:5433，而 prod app 使用 postgres:5432，
#    两者可能是不同数据库。
docker run --rm --network novel-ai_default \
  -v "$PWD/app:/src:ro" -w /src node:22-alpine sh -lc \
  'cp -a /src/. /tmp/mozhou-app && cd /tmp/mozhou-app && npm ci --ignore-scripts >/dev/null && DATABASE_URL=postgres://mozhou:mozhou_dev@postgres:5432/mozhou npx drizzle-kit migrate'
```

迁移容器必须加入运行中的 compose 网络，并使用与 `app` 服务完全相同的
`DATABASE_URL`。若 compose 项目名不是 `novel-ai`，将 `--network` 改为实际的
`<compose-project>_default`。当前仓库的迁移文件必须按 `app/drizzle/0000-0034`
顺序全部应用；迁移完成后再执行 `docker compose --profile prod up -d --build`。

单机 compose 会先等待 Postgres 健康，再等待 one-api 的 HTTP 根端点就绪后启动生产 Web 容器。one-api 进程异常退出时由 Docker 的 `restart: unless-stopped` 负责拉起；Web 不会因为运行中的 one-api 临时不可达而整体退出，AI 请求仍由 Provider Boundary 按稳定错误语义 fail-closed。

部署前必须确认基础设施就绪：

```bash
docker compose ps
curl -fsS http://127.0.0.1:3001/ >/dev/null
curl -fsS http://127.0.0.1:3000/ >/dev/null
```

云端部署不使用 localhost：`ONEAPI_BASE_URL` 必须指向已部署的 HTTPS one-api 服务；Web 与 one-api 的部署成功、端点可达、Secret 注入和一次真实 PUBLIC_FREE smoke 是同一套上线验收条件，不能只以 Web 容器启动成功代替。

### B. 托管 Postgres（Neon/Supabase）+ Vercel

1. 创建托管 Postgres，针对生产 `DATABASE_URL` 按序执行当前全部 `app/drizzle/*.sql`（0000-0034）或 `npx drizzle-kit migrate`；不要连接开发机 localhost 数据库
2. Vercel 环境变量：`DATABASE_URL` / `AUTH_SECRET` / `ONEAPI_BASE_URL` / `ONEAPI_TOKEN`
3. one-api 必须独立公网部署（HTTPS），`ONEAPI_BASE_URL` 指向它
4. 执行 `next build` 后以托管平台的标准 Next.js 运行时部署（本仓库 Dockerfile 使用 `next start`）

## 上线前安全核对（本仓库已就绪项 ✅ / 待部署者项 ⚠️）

| 项 | 状态 |
|---|---|
| `.env` 已 gitignore（密钥不入库） | ✅ |
| 生产缺 AUTH_SECRET 启动抛错 | ✅ |
| compose 强制注入 AUTH_SECRET/ONEAPI_TOKEN（`${VAR:?}` 语法） | ✅ |
| sync 密码加密存储 | ✅ AES-256-GCM（lib/sync/credentials.ts，密钥派生自 AUTH_SECRET，v1:iv:tag:ciphertext）；历史明文行解密时报「请重新保存」，重存即迁移（2026-08-22 复核） |
| HTTPS / 反向代理（Caddy/Nginx） | ⚠️ 部署环境配置 |
| CSP / security headers | ⚠️ next.config 可加 `headers()`（见 Next 文档） |
| API 频率限制（AI 昂贵端点 + 登录防爆破） | ✅ 固定窗口内存限流（lib/http/rate-limit.ts；多实例部署需换共享存储） |

## 遗留（不影响上线，V1.1 切片）
- 会员支付（收款渠道）
- projects 审查记录 / 导出备份
- 书源 HTML 规则解析器（当前简化 title 提取）
- sync 文件级同步执行（当前仅配置保存）

## 可观测性挂载点（2026-08-22 明确）

- **存活/就绪**：`/api/v1/health` 即挂载点——compose healthcheck、负载均衡、uptime 监控（UptimeRobot 等）统一打这里；503 = db 不可达。
- **错误追踪**：当前无外部 APM。接入 Sentry 类服务时挂在 Next 的 `instrumentation.ts` / `global-error.tsx` 两处（路由级错误已有可读文案 + 审计轨迹，见 `lib/chat/user-facing-error.ts`），无需改业务代码。
- **日志**：容器 stdout（`docker logs`）即日志面；结构化改造留待接入 APM 时一并做。

## 数据备份（自托管 compose 栈）

Postgres 数据卷（`db-data`）是唯一持久状态；应用容器无状态，可随时重建。

### 每日备份（宿主机 cron）

```bash
# crontab -e，每天 04:00 备份，保留 14 天
0 4 * * * docker exec $(docker ps -qf name=mozhou-db) pg_dump -U mozhou mozhou | gzip > /var/backups/mozhou-$(date +\%F).sql.gz && find /var/backups -name 'mozhou-*.sql.gz' -mtime +14 -delete
```

### 恢复演练（上线前必须实测一次）

```bash
gunzip -c /var/backups/mozhou-2026-08-21.sql.gz | docker exec -i $(docker ps -qf name=mozhou-db) psql -U mozhou mozhou
# 验证：登录一个既有账号，确认作品列表完整
```

### 用户侧导出

作品级导出（含正文/审查记录）走产品内导出功能；整库备份是运营者责任，两者互补。

## 实机演练记录（2026-08-22，商用就绪轮）

| 项 | 结果 | 证据 |
|---|---|---|
| 生产构建（next build） | ✅ | 本地 `npm run build` 通过（CI 亦会跑） |
| 容器化启动 + env 契约 | ✅ | `mozhou-web:nextstart-debug2` 容器注入 DATABASE_URL/AUTH_SECRET/ONEAPI_* 后正常启动 |
| 跨边界 DB 连接 + 迁移 | ✅ | 独立 drill 库 `drizzle-kit migrate` 31 表；容器内注册 201 / 登录 200 |
| 健康探测 | ✅（代码层） | `/api/v1/health` 契约测试通过；演练镜像早于该端点故 404，属预期 |
| 真实 LLM 冒烟 | ✅（2026-08-22 补测通过） | 根因=one-api 缺 glm 渠道。修复：增配智谱免费渠道（`glm-4.5-flash`，type=50 OpenAICompatible，base=`open.bigmodel.cn/api/paas/v4`，ModelRatio 归零；经验见 OB《one-api 渠道配置经验》）。复跑证据：渠道测试 7.9s ✓；dev 起服（无 mock）注册→bootstrap→`POST /api/v1/chat` → 200 text/event-stream，36 事件 / 5.4s / 无降级标记，回答切题 |
| 当前代码镜像重建 | ⛔ BLOCKED（本机网络） | `docker compose build` 的容器内 `npm ci` 无法走宿主代理（host.docker.internal→192.168.1.191 拒连）。**修复：Docker Desktop 设置代理或在 Dockerfile 用镜像源 BASE_IMAGE 后重跑** |

> 演练方法（可复跑）：`docker exec mozhou-postgres-local psql -U mozhou -c 'CREATE DATABASE mozhou_drill'` →
> `set DATABASE_URL=...mozhou_drill&& npx drizzle-kit migrate`（注意：env 必须在 cmd.exe 内部传递）→
> `docker run -d -p 3101:8080 -e DATABASE_URL=... -e AUTH_SECRET=... mozhou-web:nextstart-debug2` →
> curl register/login 回环。
