# one-api PUBLIC_FREE Bootstrap

> Local development / recovery runbook for MoZhou's real PUBLIC_FREE one-api gateway.
> Target: even if the container is deleted, Docker restarts, or Windows restarts,
> the PUBLIC_FREE chain can be restored from persistent storage + secret injection + this runbook.

## Preconditions

- Docker / Docker Desktop running
- one-api upstream image pinned by digest:
  `justsong/one-api@sha256:a55fb5181854aa0823cc04797ee875dfc5a953c0deb5e7e7ec39a8148e70cbc3`
- persistent storage: Docker named volume (created by compose)
- SenseNova credential available in Windows environment variable: `SENSENOVA_API_KEY`
- local MoZhou `app/.env` has `ONEAPI_TOKEN` pointing to a valid one-api token

## Architecture

```text
MoZhou (app/.env)
   │ ONEAPI_BASE_URL / ONEAPI_TOKEN
   ▼
one-api (justsong/one-api@sha256:a55fb...cbc3)
   │ persistent volume: /data/one-api.db (SQLite)
   ▼
SenseNova PUBLIC_FREE (https://token.sensenova.cn)
   │ model: deepseek-v4-flash
   ▼
OpenAI-compatible /v1/chat/completions
```

Secrets are **not** baked into the image:
- `SENSENOVA_API_KEY` is injected at channel-creation time via the one-api API.
- `ONEAPI_TOKEN` is created inside one-api and stored in the persistent SQLite DB.
- `app/.env` is local-only and gitignored.

## Start one-api

From repo root:

```bash
# Local Windows/WSL: explicitly use the host-network overlay
AUTH_SECRET=dev ONEAPI_TOKEN=dev docker compose \
  -f docker-compose.yml \
  -f docker-compose.windows.yml \
  up -d --no-deps one-api
```

> The Windows overlay exists because Docker Desktop + WSL bridge networking is
> unreliable for `token.sensenova.cn` on this machine. It is NOT auto-loaded.
> Production / Cloud Run / Linux hosts must run the base compose only:
> `docker compose up -d --no-deps one-api` (standard bridge network).

## Health check

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000
# 200
docker inspect --format='{{.State.Health.Status}}' mozhou-one-api
# healthy
```

## Configure channel (first bootstrap / after volume loss)

Login as root (fresh one-api default is `root` / `123456`; change in real environments):

```bash
curl -s -c /tmp/oc.txt -X POST http://127.0.0.1:3000/api/user/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"root","password":"123456"}'
```

Create the SenseNova channel:

```bash
export SENSENOVA_API_KEY="<SENSENOVA_API_KEY>"
cat > /tmp/channel.json <<JSON
{
  "name": "SenseNova Free PUBLIC_FREE",
  "type": 1,
  "key": "$SENSENOVA_API_KEY",
  "base_url": "https://token.sensenova.cn",
  "models": "deepseek-v4-flash",
  "model_mapping": "",
  "group": "default",
  "status": 1
}
JSON
curl -s -b /tmp/oc.txt -X POST http://127.0.0.1:3000/api/channel/ \
  -H 'Content-Type: application/json' --data @/tmp/channel.json
```

**Critical:** `base_url` must be `https://token.sensenova.cn` (no `/v1`).
one-api appends `/v1/chat/completions`; adding `/v1` creates `/v1/v1/chat/completions` → 404.

## Configure ModelRatio

`deepseek-v4-flash` must exist in one-api `ModelRatio`, otherwise one-api fails with
`model ratio not found: deepseek-v4-flash`.

```bash
# Read current ratio, add deepseek-v4-flash, then PUT the full object.
# Example minimal value (0.07 ≈ deepseek-chat class):
curl -s -b /tmp/oc.txt -X PUT http://127.0.0.1:3000/api/option/ \
  -H 'Content-Type: application/json' \
  -d '{"key":"ModelRatio","value":"{\"deepseek-v4-flash\":0.07}"}'
```

> If the volume already exists, this is already persisted and does not need to be repeated.

## Configure token

Create a token that MoZhou will use:

```bash
curl -s -b /tmp/oc.txt -X POST http://127.0.0.1:3000/api/token/ \
  -H 'Content-Type: application/json' \
  -d '{"name":"mozhou-smoke","remain_quota":500000,"expired_time":-1,"unlimited_quota":true}'
```

The response contains `data.key`. Copy that key into `app/.env` as `ONEAPI_TOKEN`.
Never commit it.

## Configure MoZhou

`app/.env` (local, gitignored):

```dotenv
ONEAPI_BASE_URL=http://localhost:3000
ONEAPI_TOKEN=<ONEAPI_TOKEN>
```

- Local Windows host-network overlay: use `http://localhost:3000`.
- Standard bridge compose (Linux/production): use `http://localhost:3001`.

## Smoke

```bash
cd app
npm run smoke:real-llm
```

PASS requires:

```text
HTTP 200
eventSequence: start → phase → delta ≥ 1 → done
audit:
  sourceClass=PUBLIC_FREE
  provider=one-api
  model=deepseek-v4-flash
  terminalStatus=succeeded
```

## Failure diagnosis

| Symptom | Cause / check |
|---|---|
| `invalid token` / `record not found` | one-api token does not exist; recreate token and update `app/.env` |
| `model ratio not found: deepseek-v4-flash` | `ModelRatio` missing; configure it |
| `404` and upstream path `/v1/v1/chat/completions` | channel `base_url` incorrectly includes `/v1`; use `https://token.sensenova.cn` |
| `network unreachable` / `connection timed out` | Docker bridge to SenseNova unstable on this machine; use `docker-compose.windows.yml` host network, or fix host network/proxy |
| `AiTimeout` / `provider_network` | SenseNova free API is rate-limited/flaky; wait and retry smoke |

## Recovery after reboot

1. Docker Desktop starts.
2. Start containers (Windows/WSL):
   ```bash
   AUTH_SECRET=dev ONEAPI_TOKEN=dev docker compose \
     -f docker-compose.yml \
     -f docker-compose.windows.yml \
     up -d --no-deps one-api
   ```
3. Health check returns `healthy`.
4. Verify channel/token/ModelRatio persisted (see verification commands below).
5. Run smoke.

## Recovery after deleting container

The container is disposable. All one-api configuration lives in the named volume
`novel-ai_oneapi-data` → `/data/one-api.db` (SQLite).

1. If the container is gone, recreate it (Windows/WSL):
   ```bash
   AUTH_SECRET=dev ONEAPI_TOKEN=dev docker compose \
     -f docker-compose.yml \
     -f docker-compose.windows.yml \
     up -d --no-deps one-api
   ```
2. Health check.
3. Verify persisted configuration:
   ```bash
   curl -s -c /tmp/oc.txt -X POST http://127.0.0.1:3000/api/user/login \
     -H 'Content-Type: application/json' -d '{"username":"root","password":"123456"}'
   curl -s -b /tmp/oc.txt http://127.0.0.1:3000/api/channel/
   curl -s -b /tmp/oc.txt http://127.0.0.1:3000/api/token/
   curl -s -b /tmp/oc.txt http://127.0.0.1:3000/api/option/
   ```
   Expected: channel `SenseNova Free PUBLIC_FREE`, token `mozhou-smoke`, ModelRatio contains `deepseek-v4-flash`.
4. Run smoke.

### If the volume is also lost

The channel/token/ModelRatio are gone. Re-run the bootstrap sections above
(Configure channel, Configure ModelRatio, Configure token), then update `app/.env`
if the token changed, then run smoke.

## Verification commands

```bash
# Channel
curl -s -b /tmp/oc.txt http://127.0.0.1:3000/api/channel/ | python3 -m json.tool

# Token
curl -s -b /tmp/oc.txt http://127.0.0.1:3000/api/token/ | python3 -m json.tool

# ModelRatio
curl -s -b /tmp/oc.txt http://127.0.0.1:3000/api/option/ | grep ModelRatio
```

## Secret handling

- `app/.env` is gitignored (`app/.gitignore` has `.env*`).
- Do not commit `app/.env`, one-api DB backups, logs, traces, or any file containing
  `ONEAPI_TOKEN`, `SENSENOVA_API_KEY`, cookies, or PostgreSQL URLs.
- **one-api persistent database is secret-bearing runtime data.**
  `one-api.db` contains channel credentials, token metadata, model configuration and
  ModelRatio. Do not commit or distribute it. Backups must be treated as credentials.
- If a real secret is found in a tracked file, do not rewrite history; report as
  `SECURITY_BLOCKER` and rotate the credential.
