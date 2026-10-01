# @mozhou/web

产品本体：创作工作台 UI + 本地 BFF。**这是应用，不是库**——没有 `src/index.ts`。

## Owns

- UI（`src/`，含工作台、流式对话、正文编辑器、分镜、检视塔）。
- 本地 BFF（`server/`，手写 `node:http` 路由 + 安全策略 + 供应商设置 + 账户/计费）。
- 出网的**唯一路径**：`server/llm/openaiStream.ts`（含 SSRF 与密钥范围校验）。

## Depends on

其余 7 个 `@mozhou/*` 包全部依赖。

## Extension points

- 新增 HTTP 路由：在 `server/routes/` 加模块并到 `server/api.ts` 接线；
  每条路由须在 `server/routePolicies.ts` 声明安全策略，否则默认拒绝。

## Known limitations

- **全仓体量最大**（src 约 3.6 万行 / server 约 2.8 万行），承担了 UI + BFF 双重职责。
- `src/api.test.ts` 是黑盒集成套件（起真实 `node:http` 打真实 `apiMiddleware`），不是契约复述；
  它的体量跟的是纵向旅程，不是复制来的形状。
- **安全注意**：`scripts/launcher.mjs`（即 `pnpm start`）**不设 `NODE_ENV`**，
  而 `server/billing/wechat.ts` 与 `alipay.ts` 的验签降级只由 `NODE_ENV === "production"` 把关。
  `server/productionServer.ts:37` 启动即 `assertMasterKeyConfigured()`，
  所以缺主密钥时会拒绝启动——但**验签降级路径不受此保护**。
  详见 [`docs/gates.md`](../docs/gates.md) 与 `CODE-DUPLICATION-INVENTORY.md` 的相关条目。
