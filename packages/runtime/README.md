# @mozhou/runtime

有状态执行引擎：档位路由、能力注册表、配方、事件适配。

## Owns

- 档位路由的配置解析与选择（`src/tierConfig.ts`、`src/tierRouting.ts`）。
- 能力注册表 `CapabilityRegistry`（`src/registry.ts`）。
- 能力配方（`src/recipe/`，`createDraftRecipe` 是唯一具名导出，其余 12 条为 `export * from`）。
- 供应商适配的**纯解析**层：`src/adapter/openai-compat.ts`、`src/adapter/anthropic-events.ts`、`src/adapter/errors.ts`。
- `NovelRuntime`、事件总线、会话重放、任务运行时。

## Depends on

`@mozhou/data-plane`、`@mozhou/kernel`。

## Extension points

- 注册新供应商适配器 → 在 `ctx` 注册表登记，无需改本包。
- `selectTierRoute` / `toProviderOverride`：档位选择的公开面，被 `apps/web/server/llm/tierRouting.ts:30` import。

## Known limitations

- **本包必须保持浏览器安全。** 它不能引入 `node:fs` / `node:os`：
  `apps/web/server/llm/tierRouting.ts` 从本包 import `selectTierRoute`，把 IO 层塞进来会
  打爆 Vite 客户端包并反转依赖方向。IO、SSRF 门、环境变量密钥解析都属于 web 层。
- `src/adapter/openai-compat.ts` 与 `anthropic-events.ts` **只做解析，不做传输**；
  真实出网只有 `apps/web/server/llm/openaiStream.ts` 一条路径。这是刻意的单出网口设计。
