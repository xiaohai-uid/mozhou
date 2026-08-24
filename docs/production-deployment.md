# 墨舟 Production Deployment Runbook（V1.2 首次上线实测版）

> 状态：**已真实跑通（2026-08-11）**。本文只记录验证过的步骤；未验证的理论步骤不写。

## 1. 架构总览

```text
Cloud Run (asia-northeast1)
├── mozhou-web      # 墨舟 Web（Next.js `next start`, 公网 HTTPS）
└── mozhou-one-api  # one-api 网关（公网 HTTPS，Neon PostgreSQL 持久化）
Neon PostgreSQL (us-east-2, 免费计划)
├── neondb   # 墨舟主库（35 个迁移，0000–0034）
└── oneapi   # one-api 独立库（避免 users 表冲突）
Google Secret Manager：DATABASE_URL / AUTH_SECRET / ONEAPI_TOKEN / ONEAPI_DB_URL / ONEAPI_SESSION_SECRET
```

## 2. Prerequisites

- `gcloud` CLI 已安装并登录：`gcloud auth login`（浏览器 OAuth）
- 有效计费账号（`gcloud billing accounts list` 显示 OPEN=True）
- 生产 GCP project：`mozhou-prod`（PN 663535144874），region `asia-northeast1`
- Neon 项目连接串（免费计划即可；区域任意 AWS 区，Tokyo 优先）

## 3. GCP Project 与 API

```bash
gcloud projects create mozhou-prod --name="MoZhou Production"
gcloud config set project mozhou-prod
gcloud config set run/region asia-northeast1
# 计费链接（账号 OPEN 后）：
gcloud billing projects link mozhou-prod --billing-account=<ACCOUNT_ID>
# 启用 API（注意：不要用 cloudrun.googleapis.com —— 用 gcloud run deploy 会自动启用 run.googleapis.com）
gcloud services enable artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com billingbudgets.googleapis.com
# 预算提醒（$10/月，50/90/100%）
gcloud billing budgets create --billing-account=<ACCOUNT_ID> --display-name=mozhou-prod --budget-amount=10 \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

## 4. Neon

1. console.neon.tech 创建项目 → 复制连接串（含密码）。
2. 建 one-api 独立库（避免两应用 users 表冲突）：

```bash
psql "<主库连接串>" -c "CREATE DATABASE oneapi;"
```

## 5. Secrets（Google Secret Manager，全部 secretAccessor 授权给运行服务账号）

```bash
SA=663535144874-compute@developer.gserviceaccount.com   # 项目默认 compute SA
gcloud secrets create DATABASE_URL --project=mozhou-prod --data-file=<(echo -n "postgresql://...neondb?sslmode=require")
gcloud secrets create AUTH_SECRET --project=mozhou-prod --data-file=<(python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip('='))")
gcloud secrets create ONEAPI_TOKEN --project=mozhou-prod --data-file=-   # one-api 部署后生成的令牌
gcloud secrets create ONEAPI_DB_URL --project=mozhou-prod --data-file=<(echo -n "postgres://...oneapi?sslmode=require")   # ⚠️ one-api 只认 postgres:// 前缀
gcloud secrets create ONEAPI_SESSION_SECRET --project=mozhou-prod --data-file=<(echo -n "<随机≥32字符>")
for s in DATABASE_URL AUTH_SECRET ONEAPI_TOKEN ONEAPI_DB_URL ONEAPI_SESSION_SECRET; do
  gcloud secrets add-iam-policy-binding $s --project=mozhou-prod \
    --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```

**坑**：one-api 的 SQL_DSN 只识别 `postgres://` 前缀（`postgresql://` 会被当 MySQL 导致启动失败）。

## 6. 数据库迁移（生产空库）

drizzle-kit CLI 在 Windows 有挂起史 → 用官方等价手动路径（**hash = SQL 文件 LF 归一化后的 sha256**）：

```bash
# 1) 建 tracking 表
psql "$DB" -c "CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);"
# 2) 按序执行当前全部迁移 0000-0034（drizzle/ 目录，ON_ERROR_STOP=1，失败即停）
for f in drizzle/000*.sql; do psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"; done
# 3) 落 tracking（sha256(LF 内容) + journal when）
python - <<'EOF'
import hashlib, json, subprocess
for e in json.load(open("drizzle/meta/_journal.json"))["entries"]:
    h = hashlib.sha256(open(f"drizzle/{e['tag']}.sql","rb").read().replace(b"\r\n",b"\n")).hexdigest()
    subprocess.run(["psql","$DB","-q","-c",f"INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ('{h}',{e['when']});"],check=True)
EOF
# 4) 验证：tracking 应等于当前 journal 条目数（本版本 35 条，0000-0034），
#    并确认 generation_jobs/generation_steps/generation_attempts/generation_events/
#    usage_ledger 等任务运行时表存在。
```

## 7. 构建镜像

镜像源受限环境（docker.io 不通）用 ARG 覆盖基础镜像：

```bash
cd app
docker build --build-arg BASE_IMAGE=docker.1ms.run/library/node:22-alpine -t mozhou-web:<SHA> .
docker tag mozhou-web:<SHA> asia-northeast1-docker.pkg.dev/mozhou-prod/mozhou/mozhou-web:<SHA>
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
docker push asia-northeast1-docker.pkg.dev/mozhou-prod/mozhou/mozhou-web:<SHA>
```

**坑**：`next build` 在 NODE_ENV=production 下收集路由模块时校验 AUTH_SECRET/DATABASE_URL → Dockerfile builder 阶段用构建期占位 ARG（不进最终镜像）。

## 8. 部署 mozhou-web

```bash
gcloud run deploy mozhou-web \
  --image=asia-northeast1-docker.pkg.dev/mozhou-prod/mozhou/mozhou-web:<SHA> \
  --region=asia-northeast1 --project=mozhou-prod --allow-unauthenticated \
  --min-instances=0 --max-instances=2 --cpu=1 --memory=1Gi --timeout=300 \
  --set-env-vars=NODE_ENV=production,ONEAPI_BASE_URL=https://mozhou-one-api-<hash>-an.a.run.app \
  --update-secrets=AUTH_SECRET=AUTH_SECRET:1,DATABASE_URL=DATABASE_URL:1,ONEAPI_TOKEN=ONEAPI_TOKEN:1
```

- Dockerfile 已含 `ENV HOSTNAME=0.0.0.0`；运行时使用 `next start`
- PORT 由 Cloud Run 注入，并作为 `next start -p` 的端口传入

## 9. 部署 one-api

```bash
docker tag justsong/one-api:latest asia-northeast1-docker.pkg.dev/mozhou-prod/mozhou/one-api:latest
docker push ...
gcloud run deploy mozhou-one-api \
  --image=asia-northeast1-docker.pkg.dev/mozhou-prod/mozhou/one-api:latest \
  --region=asia-northeast1 --project=mozhou-prod --allow-unauthenticated \
  --min-instances=0 --max-instances=2 --cpu=1 --memory=1Gi --timeout=300 \
  --set-env-vars=TZ=Asia/Shanghai \
  --update-secrets=SQL_DSN=ONEAPI_DB_URL:2,SESSION_SECRET=ONEAPI_SESSION_SECRET:1
```

one-api 读 PORT env → Cloud Run 自动 8080。部署后初始化：

1. 登录默认 root/123456 → **立即 PUT /api/user/self 改强密码**（生产禁用默认密码）
2. `PUT /api/option/` 设 ModelRatio（value 为 JSON 字符串；新模型缺 ratio 会 404）
3. 建渠道：`POST /api/channel/`（type=1 sensenova base_url=https://token.sensenova.cn；type=50 bigmodel base_url=https://open.bigmodel.cn/api/paas/v4）
4. 渠道测试：`GET /api/channel/test?id=N`
5. 建令牌 `POST /api/token/` → key 从 oneapi 库 tokens 表读取 → 入 Secret Manager ONEAPI_TOKEN

## 10. 生产 Smoke（真实 run.app HTTPS）

- API 级：注册/登录/登出 401/重登/建作品/章节/保存/刷新持久化/Unicode/malformed 400/IDOR 404/越界 400/错误响应无 stack
- 浏览器级：SSE 多 delta 采样（300ms 高频采样看长度递增）、caret 精确插入（真实按键定位）、Undo/Redo、选区替换、selection source conflict（改选区后替换 → 冲突横幅 → 取消/force）、Style 创建/选择/聊天、Skill 注入、Websearch 真实 Bing 回流、Sync 未配置态、20k 长章节

### V1.3 上线记录（2026-08-15，工作台 A 版 + Skill 运行时）

- 迁移：0022_skill-runtime / 0023_skill-runs-run-id / 0024_runtime-artifacts / 0025_artifact-bindings / 0026_skills-contract 已全部应用到 Neon（tracking 27 条）
- 镜像：asia-northeast1-docker.pkg.dev/mozhou-prod/mozhou/mozhou-web:ticket08-final（sha256:87dc608fea32，含 code-review 修复轮）
- 线上 revision：mozhou-web-00028-guv（100% 流量；canary 先以 --no-traffic + --tag=candidate 验证后切流）
- 回滚命令（切回 V1.2 稳定版 00026-gus）：
```bash
gcloud run services update-traffic mozhou-web --region=asia-northeast1 --project=mozhou-prod \
  --to-revisions=mozhou-web-00026-gus=100
```
- 注意：回滚到 00026-gus 后，迁移 0022-0026 仍在库中（向前兼容的加表迁移，不破坏旧代码路径）。

### V1.3 上线后维护 2（2026-08-15，landing 重设计上线）

- 重设计：修复 rounded-card 圆角类未定义（此前所有卡片直角）+ 榜单风格（紫色序号 01-06 / eyebrow / 元数据行 / hover 提亮），参考番茄榜单深色紫罗兰风
- 新 revision：mozhou-web-00034-wiv（镜像 landing-v2，sha256:e6cd8d9684b0），100% 流量

### V1.3 上线后维护（2026-08-15，AR 清理 + landing 文案去零界道种）

- AR 清理：删除 11 个未引用 mozhou-web 旧镜像（commercial-*/p0b-*/7db6ec4/9b9138c 及无 tag 孤儿），34→23 digest；保留全部 revision 引用与 v1.2.0 版本 tag
- 零界道种：本地 dev 库作品（novel 3）+ 生产首页/组件/deconstruct mock/vendor 文档全部替换为中性示例
- 新 revision：mozhou-web-00032-dax（镜像 landing-clean3，sha256:e0202c6bc0a3），100% 流量
## 11. 回滚

```bash
# 当前 revision 出问题 → 一条命令切回上一稳定 revision（保留历史 revision 与镜像）
gcloud run services update-traffic mozhou-web --region=asia-northeast1 --project=mozhou-prod \
  --to-revisions=mozhou-web-00004-wnl=100
# 代码修复必须走：Git → test → commit → rebuild image → redeploy（禁止进容器改）
```

## 11.1 Release Candidate 门禁（2026-08-17）

本轮验收将“应用真实链路”与“生产拓扑部署”分开判定：

| 门禁 | 当前状态 | 证据 / 剩余条件 |
|---|---|---|
| R1 Deployment ownership | DOCUMENTED / PENDING FREEZE | Web 与 one-api 分离部署；Web 通过 `ONEAPI_BASE_URL` 使用 HTTPS；one-api 独立持久化库与 Secret Manager。发布负责人需冻结 provider/model/endpoint/credential/billing ownership。 |
| R2 Infrastructure readiness | LOCAL COMPOSE PASS / REMOTE VERIFY PENDING | compose 已为 one-api 增加 HTTP readiness，并让 prod app 等待 one-api healthy；Cloud Run 仍需确认服务就绪、HTTPS 可达、Secret 注入。 |
| R3 Remote real smoke | LOCAL PASS / REMOTE PENDING | 本地真实 CLI smoke 与 Edge normal slice 已通过；正式上线前需从部署后的 Web 发起一次真实 PUBLIC_FREE inference，取得 delta/done、attempt/ledger 与 usage 证据。 |
| R4 Final browser acceptance | LOCAL PASS / DEPLOYED TOPOLOGY PENDING | 本地 Edge 已通过注册、建作、保存、真实 AI、插入、刷新和重入；仍需在最终部署拓扑执行一次冷启动后的真人路径，并验证一次停止生成。 |

R1–R4 未全部满足前，状态保持 `RELEASE CANDIDATE — NORMAL PUBLIC_FREE REAL SLICE PASS; PRODUCTION TOPOLOGY ACCEPTANCE PENDING`。不得将本地 `localhost:3001` smoke 直接等同于 Cloud Run 正式上线通过，也不得为填满异常 Gate 而新增第二个 Provider 或改动已经通过的 AI 主链。

## 12. 成本保护

- min 0 / max 2 / 1 vCPU / 1GiB / 无 GPU / scale-to-zero（冷启动几秒可接受）
- $10/月预算 + 50/90/100% 阈值提醒（预算只是提醒，不是硬 cutoff）
- Free Tier 覆盖：Cloud Run 200 万请求/月、36 万 GB-秒、18 万 vCPU-秒；Artifact Registry 0.5GB；Secret Manager 6 版本


## 任务运行时部署说明（2026-08-17，ADR-0007 / 票 01-10）

- 形态：选项 A——请求内执行 + PostgreSQL 全持久化 + 事件补发 + 失败人工重试。Cloud Run 无常驻 worker，不部署后台进程。
- 数据：generation_jobs/steps/attempts/events + usage_ledger（迁移 0027-0030）。
- 恢复：任务状态全部在 DB；浏览器断开经 GET /api/v1/runtime/jobs/[jobId]/events?afterSeq=N 补发；失败任务经 POST /api/v1/runtime/jobs/[jobId]/retry 人工重试（仅未产生结果的 step）；卡死任务经 .../end 人工结束。
- 运维观察：GET /api/v1/runtime/jobs 列任务；usage_ledger 为调用级账本（本期无定价表，全部 unpriced，不显示 0 元）。
- 扩展预留：TaskWorker.claimFilter/drain 已实现并测试；未来如需异步执行（长拆解/自动日更），以独立 runner（Cloud Run Job 或常驻小服务）消费队列即可，门面与 worker 语义不变。
