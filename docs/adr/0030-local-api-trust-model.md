# ADR-0030 · 本地 API 信任模型

日期：2026-09-28 · 状态：已接受（代码已同步） · 来源：代码图谱全仓体检发现 `security.ts` 有 6 个符号零引用

## 背景

`apps/web/server/security.ts` 里存在一整块从未接线的守卫：

| 符号 | 定义行 | 生产引用 | 测试引用 |
|---|---|---|---|
| `readJsonBody` | 旧 :220 | 0 | 0 |
| `getBootstrapToken` | 旧 :234 | 0 | 0 |
| `rotateBootstrapToken` | 旧 :238 | 0 | 0 |
| `verifyBootstrapToken` | 旧 :243 | 1（仅同文件 `assertBootstrapToken` 调用） | 0 |
| `assertBootstrapToken` | 旧 :251 | 0 | 0 |
| `assertValidCsrfToken` | 旧 :276 | 0 | 0 |

核验方式：PowerShell 逐行扫描 `apps` + `packages` 下 486 个 `.ts`/`.tsx` 源文件（排除 `node_modules`/`dist`/生成快照），非图谱推断；199 个测试文件中提及这 5 个守卫的有 **0** 个。

沿革：`0e14fb9 fix(security): enforce local API trust boundary` 引入 bootstrap 守卫；`78e5d79 feat(T08)` 另建了一套并行的会话与 CSRF 体系（`apps/web/server/auth/session.ts` 的 `assertCsrf`）。结果：**两份 CSRF 实现，两份都未被生产路径调用**——`security.ts` 那份已按本 ADR 删除，`session.ts` 的 `assertCsrf` 仅剩单元测试（生产零调用方，客户端从不回传 `x-csrf-token`）。当前生效的跨站缓解是会话 Cookie 的 `SameSite=Lax` 与 `assertTrustedRequest` 的 loopback + Origin 一致性。

## 关键事实：HTTP 投递的 bootstrap token 是安全剧场

bootstrap token 的作用是拒绝「非本应用发起的本机请求」。要有真实防御力，它的**投递信道必须比被保护的信道更特权**。当前仓库不存在更特权的信道：

- `src-tauri` 内 `invoke_handler` 命中 0、`#[tauri::command]` 命中 0
- `apps/web/package.json` 内 `@tauri-apps/api` 依赖数 0
- `apps/web/server/productionServer.ts:27-28` 直接把 `apps/web/dist/index.html` 当静态文件发送

因此 token 只能经 HTTP 下发，而 HTTP 正是它要守的那条路：任何本机进程 `GET /` 即可取到 token，防御力为零。把它接进路由只会制造「看起来有防护」的假象，比不接更危险。

## 决定

1. **信任域 = loopback 源 + 浏览器 Origin 一致性。** 生效守卫是 `assertTrustedRequest`（`apps/web/server/security.ts:107`，由 `apps/web/server/router.ts:82` 调用），它要求 Host 解析到 loopback，且 Origin 存在时必须等于 loopback API 源。

2. **明确接受：同机同用户进程在信任域内。** `security.ts:114` 的 `if (origin === undefined) return` 是有意为之——不带 Origin 头的请求放行。`curl` 不带 Origin，所以**本机任意进程可驱动全部 API**。这是单机桌面应用的有意取舍，不视为缺陷。

3. **删除 5 个从未接线的守卫及其独占的 `node:crypto` import。** 保留 `assertTrustedRequest` / `readRequestPayload` / `parseCookies` / `RateLimiter` / `assertSafeBookRoot` / `assertSafeParentDirectory`（这些有真实调用方）。删除的是生产 0 引用、测试 0 引用的代码，不违反 AGENTS.md 规则 21（未删除任何测试）。

4. **不采用令牌式 CSRF 防线。** `security.ts` 中那份重复实现已删；`auth/session.ts` 的 `assertCsrf` 保留但**未接线**（生产零调用方，仅有单元测试），因为客户端从不回传 `x-csrf-token`。跨站写请求的实际缓解是会话 Cookie 的 `SameSite=Lax` 与 `assertTrustedRequest` 的 loopback + Origin 一致性；登录响应也不再下发 `csrfToken`，避免发出无人回传的装饰性令牌。

## 要做真防护的前置条件（另立工单，不在本 ADR）

若将来要把「同机进程」移出信任域，必须先建立特权信道：

1. 在 `src-tauri` 加 `#[tauri::command]`，由 Rust 侧把 token 交给 webview；
2. `apps/web` 引入 `@tauri-apps/api`；
3. 桌面端走 IPC 取 token，HTTP 路径不带 token 即拒。

**已知覆盖缺口（开工前必须接受）**：该方案只覆盖桌面端。Vite dev（`src-tauri/tauri.conf.json:8` `devUrl=http://localhost:5173`）与 50 个 route test 文件、6 个 HTTP 测试夹具全部需要另开豁免路径。`src-tauri` 目前未编译验证过。

## 后果

- 安全面清点：已接线的守卫（`assertTrustedRequest` 等）有测试；未接线的重复实现已删除；`assertCsrf` 是唯一保留的未接线守卫（有单元测试、生产零调用方），本 ADR 显式记录这一状态，见决定 4，不再声称「没有第三种状态」。
- 边界守卫 `assertTrustedRequest` 有端到端覆盖：`apps/web/src/release-hardening.test.ts:87,94` 与 `apps/web/server/routes/accountRoutes.test.ts:161`（经 HTTP 路径，非直接 import）。
- 本 ADR 是 `security.ts` 的威胁模型真源。代码若要越过 loopback+Origin 边界，须先改本 ADR。