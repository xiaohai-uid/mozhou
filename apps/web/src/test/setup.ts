// 组件测试公共装配：jest-dom 匹配器（toBeInTheDocument/toBeDisabled/…）。
import '@testing-library/jest-dom/vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 分级路由覆盖层落点的测试隔离（L1 确定性纪律：测试零真实 HOME 依赖）。
// hasDraftProvider()（/api/capabilities、/api/capability-square 的 providerAvailable 与
// /api/draft.stream 前置闸）在 BYOK 未配时会读 ~/.mozhou/settings.yaml；若指向开发机的真实
// 配置，「未配置 provider」类负路径断言就会随本机环境漂移（有人 dogfood 过就会红）。
// 这里统一指向一个必然不存在的路径；需要覆盖层的测试自行设置 MOZHOU_TIER_CONFIG
// （见 server/routes/pipelineRoutes.tierRoute.test.ts 与 server/llm/tierRouting.test.ts）。
// 变量名与 apps/web/server/llm/tierRouting.ts 的 TIER_CONFIG_ENV 同源（此处不 import 该模块，
// 避免把 server/llm 的重依赖拖进每个组件测试）。
process.env['MOZHOU_TIER_CONFIG'] = join(
  tmpdir(),
  `mozhou-vitest-absent-tier-config-${randomUUID()}`,
  'settings.yaml',
)
