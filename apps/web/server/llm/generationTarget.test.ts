// @vitest-environment node
/**
 * 生成端点统一解析（工单06 · llm/generationTarget.ts）单测。
 *
 * 本模块是「我在跟哪个模型说话」的唯一提问口，测试只钉四件事：
 *
 * 1. **顺序**：注册表 → BYOK。无覆盖层文件 ⇒ 落 BYOK（「没配的人零感知」）；
 *    有文件 ⇒ 走注册表。
 * 2. **同源（核心不变量）**：source='registry' 时 providerId 与 endpoint.baseUrl 来自
 *    同一次解析 —— 账本记的 providerId 就是实际服务的那一家，永不出现「账本 X、请求 Y」。
 *    这正是 tierRouting.ts:146-158 要禁止的状态。
 * 3. **失败带原因**：三类 reason 各自可断言，detail 指向病因（配置键/环境变量名），
 *    不再是裸 null 加散在别处的解释。注册表配了但不可用 ⇒ provider_config_invalid，
 *    **绝不回落 BYOK**（回落正是本票要消灭的行为）。
 * 4. **凭据隔离**：hosted 且无 principal ⇒ hosted_no_principal 显式拒答，即使环境变量里
 *    躺着可用 Key 也不放行（旁路拿部署级凭据替不确定的用户调 LLM = 跨用户串号）。
 *
 * 全部为确定性验证：只读本地临时配置文件与环境变量，不发任何网络请求、不调真实模型。
 * 所有密钥形态的值都是本文件内的占位串（见 PLACEHOLDER），不指向任何真实凭据。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultBookAccessManager } from '../bookAccess.js'
import { TIER_CONFIG_ENV } from './tierRouting.js'
import {
  DEFAULT_GENERATION_PROVIDER_ID,
  NO_PROVIDER_CONFIGURED_DETAIL,
  resolveGenerationTarget,
} from './generationTarget.js'

/** 占位值：仅用于断言「凭据形状被认出来」，不是任何形态的可用凭据。 */
const PLACEHOLDER = 'PLACEHOLDER-NOT-A-REAL-CREDENTIAL'

let dir = ''
/** process.env 的原始快照：BYOK 分支内部会读进程环境变量，必须整段还原。 */
let envBackup: NodeJS.ProcessEnv = {}

/** BYOK 环境变量族：清空它们才能让「无凭据」这一态是确定的（否则吃本机开发者配置）。 */
const BYOK_ENV_KEYS = [
  'MOZHOU_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'MOZHOU_API_BASE',
  'DEEPSEEK_API_BASE',
  'OPENAI_API_BASE',
  'MOZHOU_MODEL',
  'DEEPSEEK_MODEL',
  'MOZHOU_ALLOW_PRIVATE_LLM',
  'MOZHOU_HOSTED',
  'MOZHOU_TIER_CONFIG',
  'MOZHOU_DRAFT_TIER',
  'MOZHOU_GLM_KEY',
] as const

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mozhou-gen-target-'))
  envBackup = { ...process.env }
  for (const key of BYOK_ENV_KEYS) delete process.env[key]
  // 凭据文件落到隔离数据目录，绝不读/写开发者的真实数据根。
  defaultBookAccessManager.setDataRoot(dir)
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  defaultBookAccessManager.setHostedMode(false)
  for (const key of BYOK_ENV_KEYS) delete process.env[key]
  Object.assign(process.env, envBackup)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* Windows 文件锁容忍 */
  }
})

/** 写一份覆盖层 settings.yaml；path 落在当前临时目录内。 */
function writeConfig(name: string, text: string): string {
  const file = join(dir, name)
  writeFileSync(file, text, 'utf8')
  return file
}

/** 注册表形态：providers 声明 + CHAPTER_DRAFTING 档位指向其中一家。 */
function registryConfig(extra: readonly string[] = []): string {
  return [
    'providers:',
    '  glm:',
    '    baseURL: https://open.bigmodel.cn/api/paas/v4',
    '    apiKeyEnv: MOZHOU_GLM_KEY',
    'CHAPTER_DRAFTING:',
    '  quality:',
    '    providerId: glm',
    '    model: tier-model',
    ...extra,
    '',
  ].join('\n')
}

/** 无覆盖层文件：指向一个确定不存在的路径，让「文件不存在 ⇒ null」是确定的。 */
function absentConfigEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { [TIER_CONFIG_ENV]: join(dir, 'absent.yaml'), ...extra }
}

describe('resolveGenerationTarget · 注册表层（source=registry）', () => {
  it('账本 providerId 与实际出站端点同源：providerId=注册表那家，baseUrl 同一次解析', async () => {
    const file = writeConfig('registry.yaml', registryConfig())
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: { [TIER_CONFIG_ENV]: file, MOZHOU_GLM_KEY: PLACEHOLDER },
    })

    expect(resolution.available).toBe(true)
    if (!resolution.available) return
    // 同源断言（本票核心）：账本身份来自注册表档位，出站地址来自同一个 providerId 的注册项。
    expect(resolution.source).toBe('registry')
    expect(resolution.providerId).toBe('glm')
    expect(resolution.endpoint.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(resolution.endpoint.apiKey).toBe(PLACEHOLDER)
    // model 跟随路由声明，与 providerId 同源。
    expect(resolution.model).toBe('tier-model')
    expect(resolution.registryRoute?.selection.route.providerId).toBe('glm')
  })

  it('即使环境变量里躺着 BYOK 诱饵，注册表部署仍只走注册表那家（不被 BYOK 覆盖）', async () => {
    const file = writeConfig('registry.yaml', registryConfig())
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: {
        [TIER_CONFIG_ENV]: file,
        MOZHOU_GLM_KEY: PLACEHOLDER,
        // 诱饵：若实现回落 BYOK，baseUrl/apiKey 会变成这一组。
        MOZHOU_API_KEY: PLACEHOLDER,
        MOZHOU_API_BASE: 'https://decoy.invalid',
      },
    })

    expect(resolution.available).toBe(true)
    if (!resolution.available) return
    expect(resolution.source).toBe('registry')
    expect(resolution.providerId).toBe('glm')
    expect(resolution.endpoint.baseUrl).not.toBe('https://decoy.invalid')
    expect(resolution.endpoint.apiKey).not.toBe(PLACEHOLDER + '-decoy')
  })

  it('档位指向未登记的 providerId ⇒ provider_config_invalid，绝不回落 BYOK', async () => {
    const file = writeConfig(
      'unregistered.yaml',
      [
        'providers:',
        '  glm:',
        '    baseURL: https://open.bigmodel.cn/api/paas/v4',
        '    apiKeyEnv: MOZHOU_GLM_KEY',
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: not-registered',
        '    model: tier-model',
        '',
      ].join('\n'),
    )
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      // BYOK 凭据齐备：若实现错误回落，这里会成功——它必须失败。
      env: { [TIER_CONFIG_ENV]: file, MOZHOU_API_KEY: PLACEHOLDER, MOZHOU_GLM_KEY: PLACEHOLDER },
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    expect(resolution.reason).toBe('provider_config_invalid')
    expect(resolution.detail).toContain('not-registered')
  })

  it('注册表密钥缺失 ⇒ provider_config_invalid，detail 指向缺失的环境变量名', async () => {
    const file = writeConfig('registry.yaml', registryConfig())
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: { [TIER_CONFIG_ENV]: file, MOZHOU_API_KEY: PLACEHOLDER }, // 故意不给 MOZHOU_GLM_KEY
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    expect(resolution.reason).toBe('provider_config_invalid')
    expect(resolution.detail).toContain('MOZHOU_GLM_KEY')
  })

  it('结构非法的覆盖层 ⇒ provider_config_invalid（不吞异常、不回落）', async () => {
    const file = writeConfig('broken.yaml', ['CHAPTER_DRAFTING:', '  - 这不是映射', ''].join('\n'))
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: { [TIER_CONFIG_ENV]: file, MOZHOU_API_KEY: PLACEHOLDER },
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    expect(resolution.reason).toBe('provider_config_invalid')
    expect(resolution.detail.length).toBeGreaterThan(0)
  })
})

describe('resolveGenerationTarget · BYOK 层（source=byok）', () => {
  it('无覆盖层文件 + 环境变量凭据 ⇒ 落 BYOK（没配注册表的人零感知）', async () => {
    const resolution = await resolveGenerationTarget({
      taskType: 'FINAL_EXTRACT',
      env: absentConfigEnv({ MOZHOU_API_KEY: PLACEHOLDER }),
    })

    expect(resolution.available).toBe(true)
    if (!resolution.available) return
    expect(resolution.source).toBe('byok')
    expect(resolution.registryRoute).toBeNull()
    // BYOK 分支的账本身份是包内默认绑定键（与 makeStreamEngine 绑定键一致）。
    expect(resolution.providerId).toBe(DEFAULT_GENERATION_PROVIDER_ID)
    expect(resolution.endpoint.apiKey).toBe(PLACEHOLDER)
  })

  it('注册表与 BYOK 都无凭据 ⇒ no_provider_configured，detail 给出行动指引', async () => {
    const resolution = await resolveGenerationTarget({
      taskType: 'SEMANTIC_ANALYSIS',
      env: absentConfigEnv(),
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    expect(resolution.reason).toBe('no_provider_configured')
    expect(resolution.detail).toBe(NO_PROVIDER_CONFIGURED_DETAIL)
  })

  it('BYOK 端点 baseUrl 未过 SSRF 门禁 ⇒ provider_endpoint_blocked（配了但不可用，不是没配）', async () => {
    const resolution = await resolveGenerationTarget({
      taskType: 'STORYBOARD',
      env: absentConfigEnv({ MOZHOU_API_KEY: PLACEHOLDER, MOZHOU_API_BASE: 'http://127.0.0.1:9/v1' }),
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    // P2 缺陷修复：原先这里与「配置非法」同码 provider_config_invalid，UI 因此把
    // 本机部署的用户指引去填 BYOK 密钥。仍**不是** no_provider_configured（原断言
    // 成立：配了但不可用），只是另立了「门禁按设计拒绝」这一类，好让 UI 讲放行开关。
    expect(resolution.reason).not.toBe('no_provider_configured')
    expect(resolution.reason).toBe('provider_endpoint_blocked')
    // 被拒主机如实带出，UI 靠它点名，不靠解析 detail 散文
    expect(resolution.blockedHost).toBe('127.0.0.1')
    // detail 仍是带病因的原文（下游 NDJSON error 帧逐字不变）
    expect(resolution.detail).toContain('SSRF')
  })
})

/* ----------------------------------------------------------------------------
 * SSRF 门禁拒绝的分类（P2 · 本机模型接入指引误导）。
 *
 * 门禁**未放宽**：这些用例里环回端点一律仍然被拒（available=false）。
 * 变的只是拒绝被归到哪个 reason，好让 UI 给出与真实可行的下一步一致的指引。
 * 全部不发网络请求：拒绝发生在解析期，早于任何出站。
 * ------------------------------------------------------------------------- */
describe('resolveGenerationTarget · SSRF 拒绝的分类', () => {
  it('环回地址 + 未设放行位 ⇒ 仍被拒，且归为 provider_endpoint_blocked（门禁未被放宽）', async () => {
    for (const base of ['http://127.0.0.1:8317/v1', 'http://localhost:8317/v1', 'http://192.168.1.10:8317/v1']) {
      const resolution = await resolveGenerationTarget({
        taskType: 'CHAPTER_DRAFTING',
        env: absentConfigEnv({ MOZHOU_API_KEY: PLACEHOLDER, MOZHOU_API_BASE: base }),
      })

      expect(resolution.available, `门禁必须继续拒绝 ${base}`).toBe(false)
      if (resolution.available) return
      expect(resolution.reason).toBe('provider_endpoint_blocked')
    }
  })

  it('注册表层被门禁拒绝 ⇒ 同样归 provider_endpoint_blocked（穿过 TierProviderError 包装）', async () => {
    const file = writeConfig(
      'loopback.yaml',
      [
        'providers:',
        '  local:',
        '    baseURL: http://127.0.0.1:8317/v1',
        '    apiKeyEnv: MOZHOU_GLM_KEY',
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: local',
        '    model: local-model',
        '',
      ].join('\n'),
    )
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: { [TIER_CONFIG_ENV]: file, MOZHOU_GLM_KEY: PLACEHOLDER },
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    // 关键：注册表路径的错误被 TierProviderError 包了一层，分类必须能穿过包装，
    // 否则同一个门禁拒绝会因来源不同而拿到两个 reason —— UI 又要开始猜。
    expect(resolution.reason).toBe('provider_endpoint_blocked')
    expect(resolution.blockedHost).toBe('127.0.0.1')
    // detail 仍保留 TierProviderError 的 code 与键路径（既有契约，下游逐字依赖）
    expect(resolution.detail).toContain('TIER_ROUTE_PROVIDER_ENDPOINT_REJECTED')
    expect(resolution.detail).toContain('providers.local.baseURL')
  })

  it('非门禁类配置错误仍是 provider_config_invalid（不放宽分类：该分开的不合并）', async () => {
    const file = writeConfig(
      'missing-key.yaml',
      [
        'providers:',
        '  glm:',
        '    baseURL: https://open.bigmodel.cn/api/paas/v4',
        '    apiKeyEnv: MOZHOU_GLM_KEY',
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: glm',
        '    model: tier-model',
        '',
      ].join('\n'),
    )
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: { [TIER_CONFIG_ENV]: file }, // 故意不给 MOZHOU_GLM_KEY
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    // 密钥缺失不是门禁拒绝：不该被 endpoint_blocked 吞掉（否则 UI 会教用户去设放行开关）
    expect(resolution.reason).toBe('provider_config_invalid')
    expect(resolution.blockedHost).toBeUndefined()
  })

  it('显式设放行位后环回端点可用 ⇒ 放行位确实只由部署者环境变量决定', async () => {
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: absentConfigEnv({
        MOZHOU_API_KEY: PLACEHOLDER,
        MOZHOU_API_BASE: 'http://127.0.0.1:8317/v1',
        MOZHOU_ALLOW_PRIVATE_LLM: '1',
      }),
    })

    expect(resolution.available).toBe(true)
    if (!resolution.available) return
    expect(resolution.endpoint.allowPrivateNetwork).toBe(true)
  })
})

describe('resolveGenerationTarget · hosted 凭据隔离', () => {
  it('hosted 且无 principal ⇒ hosted_no_principal，即使环境变量有可用 Key 也拒答', async () => {
    const resolution = await resolveGenerationTarget({
      taskType: 'SEMANTIC_ANALYSIS',
      env: absentConfigEnv({ MOZHOU_API_KEY: PLACEHOLDER, MOZHOU_HOSTED: 'true' }),
    })

    expect(resolution.available).toBe(false)
    if (resolution.available) return
    // 关键：不是 no_provider_configured，而是 hosted_no_principal ——「没主体」与「没配 Key」
    // 是两回事，处置完全不同，不得互相掩盖。
    expect(resolution.reason).toBe('hosted_no_principal')
    expect(resolution.detail).toContain('principal')
  })

  it('hosted + 空 userId / 空白 userId 同样拒答', async () => {
    for (const principal of [undefined, null, { userId: '' }]) {
      const resolution = await resolveGenerationTarget({
        taskType: 'FINAL_EXTRACT',
        principal,
        env: absentConfigEnv({ MOZHOU_API_KEY: PLACEHOLDER, MOZHOU_HOSTED: 'true' }),
      })
      expect(resolution.available).toBe(false)
      if (!resolution.available) expect(resolution.reason).toBe('hosted_no_principal')
    }
  })

  it('hosted + 有 principal ⇒ 放行，按该主体解析（注册表优先）', async () => {
    const file = writeConfig('registry.yaml', registryConfig())
    const resolution = await resolveGenerationTarget({
      taskType: 'FINAL_EXTRACT',
      principal: { userId: 'user-1' },
      env: { [TIER_CONFIG_ENV]: file, MOZHOU_GLM_KEY: PLACEHOLDER, MOZHOU_HOSTED: 'true' },
    })

    expect(resolution.available).toBe(true)
    if (!resolution.available) return
    expect(resolution.source).toBe('registry')
    expect(resolution.providerId).toBe('glm')
  })

  it('local 模式 + 无 principal ⇒ 不拒答（单机共享凭据，行为不变）', async () => {
    const resolution = await resolveGenerationTarget({
      taskType: 'SEMANTIC_ANALYSIS',
      env: absentConfigEnv({ MOZHOU_API_KEY: PLACEHOLDER }),
    })

    expect(resolution.available).toBe(true)
    if (!resolution.available) return
    expect(resolution.source).toBe('byok')
  })
})

describe('resolveGenerationTarget · 失败结果的形状', () => {
  it('Unavailable 恒带 taskType（诊断标签：是哪条生成入口要不到端点）', async () => {
    const resolution = await resolveGenerationTarget({
      taskType: 'STORYBOARD',
      env: absentConfigEnv(),
    })
    expect(resolution.available).toBe(false)
    if (resolution.available) return
    expect(resolution.taskType).toBe('STORYBOARD')
  })

  it('成功的 model 恒等于其 endpoint.model（同源，不另开一个来源）', async () => {
    const file = writeConfig('registry.yaml', registryConfig())
    const resolution = await resolveGenerationTarget({
      taskType: 'CHAPTER_DRAFTING',
      env: { [TIER_CONFIG_ENV]: file, MOZHOU_GLM_KEY: PLACEHOLDER },
    })
    expect(resolution.available).toBe(true)
    if (!resolution.available) return
    expect(resolution.model).toBe(resolution.endpoint.model)
  })
})
