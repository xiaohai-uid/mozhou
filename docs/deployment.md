# 墨舟公网部署指南（V1.0）

> 状态：基建就绪（Dockerfile standalone + compose prod profile），**生产密钥需部署者设置**。
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

# 3. 迁移数据库（app 首次启动后执行）
cd app && npx drizzle-kit migrate
```

### B. 托管 Postgres（Neon/Supabase）+ Vercel

1. 创建托管 Postgres，执行 `app/drizzle/*.sql`（0000-0009 按序）或 `npx drizzle-kit migrate`
2. Vercel 环境变量：`DATABASE_URL` / `AUTH_SECRET` / `ONEAPI_BASE_URL` / `ONEAPI_TOKEN`
3. one-api 必须独立公网部署（HTTPS），`ONEAPI_BASE_URL` 指向它
4. `next build` 产物直接部署（standalone 已在 next.config 启用）

## 上线前安全核对（本仓库已就绪项 ✅ / 待部署者项 ⚠️）

| 项 | 状态 |
|---|---|
| `.env` 已 gitignore（密钥不入库） | ✅ |
| 生产缺 AUTH_SECRET 启动抛错 | ✅ |
| compose 强制注入 AUTH_SECRET/ONEAPI_TOKEN（`${VAR:?}` 语法） | ✅ |
| sync 密码加密存储 | ⚠️ 当前明文（schema 已标注）；上线前应改加密列 |
| HTTPS / 反向代理（Caddy/Nginx） | ⚠️ 部署环境配置 |
| CSP / security headers | ⚠️ next.config 可加 `headers()`（见 Next 文档） |
| API 频率限制（chat 防滥用） | ⚠️ 当前仅抽卡配额；上线前建议加 rate limit |

## 遗留（不影响上线，V1.1 切片）
- 会员支付（收款渠道）
- projects 审查记录 / 导出备份
- 书源 HTML 规则解析器（当前简化 title 提取）
- sync 文件级同步执行（当前仅配置保存）
