# 墨舟部署指南（当前栈 · 2026-09-26 重写）

> 本文描述**本仓库实际交付的栈**：Node 22 + 本地优先文件 canon + SQLite 投影，
> 入口为 `apps/web/dist-server/productionServer.js`，默认只监听 `127.0.0.1`。
>
> 历史文档 `docs/production-deployment.md` 描述的是 Next.js `next start` + Postgres/drizzle
> + one-api + Cloud Run 的另一套应用，**该应用不在本仓库中**（无 `app/`、无 `drizzle/`），
> 照其操作会失败。需要归档背景时再读它。

## 1. 部署形态

| 形态 | 入口 | 适用 |
|---|---|---|
| 源码直跑 | `pnpm build && pnpm --filter @mozhou/web dev` | 开发 |
| 本地运行时 | `node scripts/launcher.mjs`（或 `启动墨舟.bat` / `start.sh`） | 单机自用 |
| 容器 | `docker compose up -d --build` | 单机自用（隔离运行环境） |
| systemd | `deploy/mozhou.service` + Caddy | 常驻主机 |

**四种形态都只绑定回环地址。** 公网部署当前不可用，原因见 §7。

## 2. 必填配置

### `MOZHOU_DATA_ROOT` —— 数据根（书稿与账户数据的落点）

未设置时回落为 `<cwd>/.mozhou_data`。**容器与 systemd 部署必须显式设置**：
写进镜像层的数据会随容器重建一起消失，且不报任何错。

```bash
MOZHOU_DATA_ROOT=/var/mozhou_data
```

空串与纯空白等同于未设置（不会解析成 cwd）。

### `MOZHOU_SECRET_KEY` —— 凭据加密主密钥

加密 BYOK（用户自带 Key）凭据。**当 `NODE_ENV=production` 或 `MOZHOU_HOSTED=true` 时必填**：
缺失则服务在开始监听前直接退出（exit 1），不会回退到源码可见的默认密钥。

```bash
export MOZHOU_SECRET_KEY="$(openssl rand -base64 48)"   # 至少 32 字符
```

本地单机（非 production、非 hosted）保留零配置回退，便于开发。

> ⚠️ 该密钥用于解密已落盘的凭据文件。**变更它会使既有 `provider-settings.enc` 无法解密**
> （表现为「需要重新保存 API Key」），请与数据卷一同备份。

### 可选：AI 上游

```bash
MOZHOU_API_KEY=...        # 或 DEEPSEEK_API_KEY / OPENAI_API_KEY
MOZHOU_API_BASE=https://api.deepseek.com
MOZHOU_MODEL=deepseek-chat
```

未配置时生成能力显式报不可用（不会静默使用演示数据）。

## 3. 容器部署

```bash
export MOZHOU_SECRET_KEY="$(openssl rand -base64 48)"
docker compose up -d --build
docker compose ps          # 等待 mozhou 变为 healthy
```

- 数据持久化在命名卷 `mozhou-data`（容器内 `/data`）。
  `docker compose down` **不会**删除它；只有 `docker compose down -v` 会。
- `mozhou` 服务带 healthcheck，打 `/api/health`。
- 宿主端口映射锁定 `127.0.0.1:${MOZHOU_PORT:-5173}`。

`docker-compose.yml` 中的 `legacy-infra` profile（postgres / one-api / crawl4ai）
是旧 SaaS 栈的兼容设施，不属于默认发行面，且其中 `app` 服务的 build context
指向本仓库不存在的目录，**无法构建**。不要启用它。

## 4. systemd 部署

见 `deploy/README.md`。要点：

- 环境变量放 `/etc/mozhou/mozhou.env`（权限 0600），`deploy/mozhou.service` 通过
  `EnvironmentFile` 读取。
- `WorkingDirectory=/opt/mozhou` 决定未显式设置时的默认数据根，务必同时显式设置
  `MOZHOU_DATA_ROOT`。
- 服务收到 SIGTERM 会先排空在途请求（最多 10 秒）再退出，`systemctl restart` 安全。

## 5. 健康检查与日志

### `/api/health`

```json
{
  "ok": true,
  "status": "ok",
  "dataRoot": "/data",
  "dataRootSource": "env",
  "dataRootWritable": true,
  "hostedMode": false,
  "uptimeSeconds": 42,
  "pid": 1
}
```

| 字段 | 含义 |
|---|---|
| `status` | `ok` = 数据根可写；`degraded` = 不可写，返回 **503** |
| `dataRootSource` | `env` = 被显式钉到卷上；`default` = 回落 cwd |
| `dataRoot` | 实际解析出的绝对路径 |

**排障用法**：容器里 `dataRootSource` 报 `default` 即说明卷没接上，数据正落在可丢的
容器层。仅看 `ok: true` 判断不出来——启动时会 mkdir 出数据根，未挂卷时它同样可写。

### 日志

单行 JSON 落 stdout/stderr（`docker logs` / `journalctl` 直接可读可检索）：

```json
{"ts":"2026-09-26T11:05:09.200Z","level":"info","event":"http.request","requestId":"muia9gsu-1","method":"GET","path":"/api/health","status":200,"durationMs":2.36}
```

- `warn` / `error` 落 stderr，其余落 stdout。
- 每个响应带 `X-Request-Id`，与日志的 `requestId` 同源，可据此串起一次请求的全部日志。
- 只记录路径不记录 query（避免令牌进日志）；凭据从不写入日志。
- 客户端提前断开的请求记为 `status: 499`。

当前**没有**外部 APM / 指标 / 分布式追踪接入，只有本地日志面。

## 6. 备份与恢复

数据根即全部状态（文件 canon + SQLite 投影 + 凭据）。备份 = 备份数据根目录。

- 容器：备份命名卷 `mozhou-data`（`docker run --rm -v mozhou-data:/data ...` 或卷快照）。
- **备份必须放在与数据不同的故障域**；产品内 `backups/` 目录默认写在数据根内，
  与主数据同盘，不能当作灾备。
- 恢复：把数据根还原到原位，启动服务即可（SQLite WAL 与 canon 基线自带恢复语义）。
- **同时备份 `MOZHOU_SECRET_KEY`**，否则恢复后用户凭据无法解密。

### 单实例约束

同一数据根同时只允许一个实例：第二个实例启动即报
`DATA_ROOT_LOCKED: another service instance (PID …) is running on dataRoot: …`。
这是有意的排他保护，不是故障。

## 7. 已知限制（勿误以为可用）

| 限制 | 说明 |
|---|---|
| 公网 / 多用户部署不可用 | 生产服务器只接受 loopback 的 `Host`/`Origin`，域名或反代后每个 `/api/*` 都会被判 `UNTRUSTED_HOST` 拒绝。`deploy/README.md` 的 hosted 路径因此当前不可用。 |
| 付费通道未开放 | 会员支付与许可证激活尚未作为可用能力发布；代码内的 billing 对账 worker 无调度器驱动。 |
| 原生安装器未发布 | 不提供 Windows/macOS 签名安装器；Tauri 原生安装与代码签名是独立发布面。 |
| 无外部 APM / 指标 | 见 §5。 |

## 8. 上线前核对

- [ ] `MOZHOU_DATA_ROOT` 指向持久卷，且已显式设置
- [ ] `MOZHOU_SECRET_KEY` 已设置（≥32 字符随机串）并已纳入备份
- [ ] `/api/health` 返回 200，且 `dataRootSource` 为 `env`
- [ ] 日志可经 `docker logs` / `journalctl` 读到 `server.listening`
- [ ] 备份任务已配置，且备份落在与数据不同的故障域
- [ ] 恢复演练至少实测一次（还原数据根 + 密钥，确认作品列表完整）
