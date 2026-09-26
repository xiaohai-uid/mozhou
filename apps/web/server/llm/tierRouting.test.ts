// @vitest-environment node
/**
 * 分级路由接线胶水单测（apps/web · llm/tierRouting.ts）。
 *
 * 覆盖的失败路径与不变量：
 *   - 覆盖层落点缺省 = ~/.mozhou/settings.yaml（规格 §6）；MOZHOU_TIER_CONFIG 仅作覆盖位；
 *   - **文件不存在 ⇒ null（不覆盖、不抛错）**——本接线最重要的安全属性；
 *   - 文件存在但结构非法 ⇒ TierConfigError 上抛（不回落到硬编码）；
 *   - 多叶子未指定 tier ⇒ NoProviderError 上抛（不静默挑一个），且报错含补救操作位；
 *   - 叶子声明 api_key_ref ⇒ TierRouteUnsupportedError 显式拒绝（不静默忽略凭据声明）；
 *   - **端点由 providers 注册表按 providerId 解析**（resolveTierEndpoint）：
 *       · 命中 ⇒ baseURL/apiKey 取自注册表，与账本 providerId 同源；
 *       · providerId 未登记 ⇒ TierProviderError NOT_REGISTERED（绝不回落 BYOK）；
 *       · baseURL 未过 SSRF 门禁（非 http(s) / 本地主机名 / 环回 / 私有 / 保留）⇒ 拒绝；
 *       · apiKeyEnv 指向的环境变量缺失/空白 ⇒ KEY_MISSING（不静默用别的密钥）；
 *       · 私有地址仅在部署者显式 MOZHOU_ALLOW_PRIVATE_LLM=1 时放行（配置文件无权设置）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NoProviderError, TierConfigError } from '@mozhou/runtime'
import type { ProviderRegistry } from '@mozhou/runtime'
import {
  applyTierModel,
  resolveDraftTierRoute,
  resolveTierEndpoint,
  tierConfigPath,
  tierRouteTraceLine,
  TierProviderError,
  TierRouteUnsupportedError,
  PRIVATE_NETWORK_ENV,
  TIER_CONFIG_ENV,
  TIER_NAME_ENV,
} from './tierRouting.js'
import type { DraftTierRoute } from './tierRouting.js'
import type { ResolvedEndpoint } from './types.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mozhou-tier-route-'))
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows 文件锁容忍
  }
})

function write(name: string, text: string): string {
  const file = join(dir, name)
  writeFileSync(file, text, 'utf8')
  return file
}

const BYOK_ENDPOINT: ResolvedEndpoint = {
  baseUrl: 'https://api.example.test',
  apiKey: 'sk-test',
  model: 'byok-model',
}

describe('tierConfigPath（覆盖层落点）', () => {
  it('缺省 = ~/.mozhou/settings.yaml（规格 §6），MOZHOU_TIER_CONFIG 优先且空白串视为未设', () => {
    expect(tierConfigPath({})).toBe(join(homedir(), '.mozhou', 'settings.yaml'))
    expect(tierConfigPath({ [TIER_CONFIG_ENV]: '   ' })).toBe(join(homedir(), '.mozhou', 'settings.yaml'))
    expect(tierConfigPath({ [TIER_CONFIG_ENV]: join(dir, 'custom.yaml') })).toBe(join(dir, 'custom.yaml'))
  })
})

describe('resolveDraftTierRoute', () => {
  it('无覆盖层文件 ⇒ null：不覆盖、不抛错（保持既有行为的唯一开关）', async () => {
    const route = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: join(dir, 'absent.yaml') })
    expect(route).toBeNull()
  })

  it('单叶子：未指定 tier 也自动采用该叶子（规格 §6 示例形态）', async () => {
    const file = write(
      'single.yaml',
      ['CHAPTER_DRAFTING:', '  quality:', '    providerId: deepseek', '    model: tier-model', ''].join('\n'),
    )
    const route = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: file })
    expect(route?.configPath).toBe(file)
    expect(route?.selection).toMatchObject({
      taskType: 'CHAPTER_DRAFTING',
      tier: 'quality',
      route: { providerId: 'deepseek', model: 'tier-model' },
    })
  })

  it('多叶子未指定 tier ⇒ NO_PROVIDER_TIER 上抛（不静默挑一个），且报错含补救操作位', async () => {
    const file = write(
      'multi.yaml',
      [
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: deepseek',
        '    model: tier-model',
        '  fast:',
        '    providerId: deepseek',
        '    model: fast-model',
        '',
      ].join('\n'),
    )
    const err = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: file }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoProviderError)
    expect((err as NoProviderError).code).toBe('NO_PROVIDER_TIER')
    expect((err as NoProviderError).configKeyPath).toBe('CHAPTER_DRAFTING')
    expect((err as NoProviderError).message).toContain('quality / fast')
    // 补救路径必须可发现：环境变量名就在报错里（否则多叶子配置只能持续硬失败）
    expect((err as NoProviderError).message).toContain(TIER_NAME_ENV)
  })

  it('叶子声明 api_key_ref ⇒ 显式拒绝（密钥只来自注册表 apiKeyEnv，不静默忽略凭据声明）', async () => {
    const file = write(
      'keyref.yaml',
      [
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: deepseek',
        '    model: tier-model',
        '    api_key_ref: MOZHOU_GLM_KEY',
        '',
      ].join('\n'),
    )
    const err = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: file }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TierRouteUnsupportedError)
    expect((err as TierRouteUnsupportedError).code).toBe('TIER_ROUTE_API_KEY_REF_UNSUPPORTED')
    expect((err as TierRouteUnsupportedError).keyPath).toBe('CHAPTER_DRAFTING.quality.api_key_ref')
    expect((err as TierRouteUnsupportedError).message).toContain('MOZHOU_GLM_KEY')
    // 补救路径必须可发现：密钥的唯一来源（注册表 apiKeyEnv）就在报错里
    expect((err as TierRouteUnsupportedError).message).toContain('apiKeyEnv')
    expect((err as TierRouteUnsupportedError).message).toContain('providers')
  })

  it('多叶子 + 显式 tier：命中指定叶子', async () => {
    const file = write(
      'multi.yaml',
      [
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: deepseek',
        '    model: tier-model',
        '  fast:',
        '    providerId: glm',
        '    model: fast-model',
        '',
      ].join('\n'),
    )
    const route = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: file, [TIER_NAME_ENV]: 'fast' })
    expect(route?.selection.tier).toBe('fast')
    expect(route?.selection.route.providerId).toBe('glm')
  })

  it('显式 tier 缺失 ⇒ NO_PROVIDER_TIER，键路径 task_type.tier 且列出可用 tier', async () => {
    const file = write(
      'single.yaml',
      ['CHAPTER_DRAFTING:', '  quality:', '    providerId: deepseek', '    model: tier-model', ''].join('\n'),
    )
    const err = await resolveDraftTierRoute({
      [TIER_CONFIG_ENV]: file,
      [TIER_NAME_ENV]: 'turbo',
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoProviderError)
    expect((err as NoProviderError).configKeyPath).toBe('CHAPTER_DRAFTING.turbo')
    expect((err as NoProviderError).message).toContain('quality')
  })

  it('文件存在但结构非法 ⇒ TierConfigError 上抛（宁败不猜，不回落到硬编码）', async () => {
    const file = write(
      'bad.yaml',
      ['CHAPTER_DRAFTING:', '  quality:', '    providerId: deepseek', ''].join('\n'),
    )
    const err = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: file }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TierConfigError)
    expect((err as TierConfigError).code).toBe('TIER_CONFIG_STRUCTURE_INVALID')
    expect((err as TierConfigError).keyPath).toBe('CHAPTER_DRAFTING.quality.model')
  })

  it('明文密钥进覆盖层 ⇒ TierConfigError PLAINTEXT_KEY（密钥本体永不入配置文件）', async () => {
    const file = write(
      'leak.yaml',
      [
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: deepseek',
        '    model: tier-model',
        '    apiKey: sk-leaked',
        '',
      ].join('\n'),
    )
    const err = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: file }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TierConfigError)
    expect((err as TierConfigError).code).toBe('TIER_CONFIG_PLAINTEXT_KEY')
  })

  it('解析结果带出同文件的 providers 注册表（端点解析的唯一来源）', async () => {
    const file = write(
      'registry.yaml',
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
    const route = await resolveDraftTierRoute({ [TIER_CONFIG_ENV]: file })
    expect(route?.providers['glm']).toEqual({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKeyEnv: 'MOZHOU_GLM_KEY',
    })
  })
})

/** 构造活动路由（端点解析单测用；providers 即注册表内容）。 */
function routeWith(providerId: string, providers: ProviderRegistry, model = 'tier-model'): DraftTierRoute {
  return {
    configPath: join(dir, 'settings.yaml'),
    selection: { taskType: 'CHAPTER_DRAFTING', tier: 'quality', route: { providerId, model } },
    providers,
  }
}

const GLM_REGISTRY: ProviderRegistry = {
  glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'MOZHOU_GLM_KEY' },
}

describe('resolveTierEndpoint（providerId → 实际出站端点，账本一致性的落点）', () => {
  it('注册表命中：baseURL 与密钥取自注册表，model 取叶子声明，providerId 与实际端点同源', () => {
    const endpoint = resolveTierEndpoint(routeWith('glm', GLM_REGISTRY), { MOZHOU_GLM_KEY: 'sk-glm' })
    expect(endpoint).toEqual({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-glm',
      model: 'tier-model',
      allowPrivateNetwork: false,
    })
    // 端点身份就是账本里那个 providerId 对应的注册表条目：换成另一个 id 即换成另一个端点。
    const other = resolveTierEndpoint(
      routeWith('glm', {
        ...GLM_REGISTRY,
        other: { baseURL: 'https://api.other.test/v1', apiKeyEnv: 'MOZHOU_OTHER_KEY' },
      }),
      { MOZHOU_GLM_KEY: 'sk-glm' },
    )
    expect(other.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
  })

  it('密钥两侧空白被裁掉（空白串按缺失处理，不发出去当 401 源）', () => {
    const endpoint = resolveTierEndpoint(routeWith('glm', GLM_REGISTRY), { MOZHOU_GLM_KEY: '  sk-glm  ' })
    expect(endpoint.apiKey).toBe('sk-glm')
  })

  it('providerId 未登记 ⇒ NOT_REGISTERED，消息含 providerId / 叶子键路径 / 应登记的注册表键路径，绝不回落 BYOK', () => {
    const route = routeWith('glm', {})
    const err = (() => {
      try {
        resolveTierEndpoint(route, { MOZHOU_GLM_KEY: 'sk-glm' })
        return null
      } catch (error) {
        return error
      }
    })()
    expect(err).toBeInstanceOf(TierProviderError)
    const providerErr = err as TierProviderError
    expect(providerErr.code).toBe('TIER_ROUTE_PROVIDER_NOT_REGISTERED')
    expect(providerErr.keyPath).toBe('CHAPTER_DRAFTING.quality.providerId')
    expect(providerErr.message).toContain('glm')
    expect(providerErr.message).toContain('providers.glm')
    expect(providerErr.message).toContain('BYOK')
    expect(providerErr.configPath).toBe(route.configPath)
  })

  it('baseURL 非法（非 http(s) / 本地主机名 / 环回 / 私有 / 保留 / 不可解析）⇒ 一律拒绝并指向 providers.<id>.baseURL', () => {
    const badUrls = [
      'ftp://api.example.test/v1',
      'not-a-url',
      'http://api.example.test/v1', // 公网也强制 HTTPS（既有门禁语义）
      'http://localhost:8080/v1',
      'http://foo.localhost/v1',
      'http://127.0.0.1:8080/v1',
      'http://[::1]:8080/v1',
      'http://10.1.2.3/v1',
      'http://172.16.5.5/v1',
      'http://192.168.1.5/v1',
      'http://169.254.10.10/v1',
      'http://100.64.1.1/v1',
      'http://0.0.0.0/v1',
      'http://224.0.0.1/v1',
    ]
    for (const baseURL of badUrls) {
      const err = (() => {
        try {
          resolveTierEndpoint(
            routeWith('glm', { glm: { baseURL, apiKeyEnv: 'MOZHOU_GLM_KEY' } }),
            { MOZHOU_GLM_KEY: 'sk-glm' },
          )
          return null
        } catch (error) {
          return error
        }
      })()
      expect(err, baseURL).toBeInstanceOf(TierProviderError)
      expect((err as TierProviderError).code, baseURL).toBe('TIER_ROUTE_PROVIDER_ENDPOINT_REJECTED')
      expect((err as TierProviderError).keyPath, baseURL).toBe('providers.glm.baseURL')
    }
  })

  it('私有地址只在部署者显式 MOZHOU_ALLOW_PRIVATE_LLM=1 时放行（配置文件无权设置该开关）', () => {
    const route = routeWith('local', { local: { baseURL: 'http://127.0.0.1:11434/v1', apiKeyEnv: 'MOZHOU_LOCAL_KEY' } })
    // 缺省（无逃生位）⇒ 拒绝
    expect(() => resolveTierEndpoint(route, { MOZHOU_LOCAL_KEY: 'k' })).toThrow(TierProviderError)
    // 部署者授权 ⇒ 放行，且端点标记 allowPrivateNetwork 供出站侧一致处理
    const endpoint = resolveTierEndpoint(route, { MOZHOU_LOCAL_KEY: 'k', [PRIVATE_NETWORK_ENV]: '1' })
    expect(endpoint).toEqual({
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'k',
      model: 'tier-model',
      allowPrivateNetwork: true,
    })
  })

  it('apiKeyEnv 指向的环境变量缺失或空白 ⇒ KEY_MISSING，消息含变量名与键路径，不静默用别的密钥', () => {
    const route = routeWith('glm', GLM_REGISTRY)
    const missing = (() => {
      try {
        resolveTierEndpoint(route, {})
        return null
      } catch (error) {
        return error
      }
    })()
    expect(missing).toBeInstanceOf(TierProviderError)
    expect((missing as TierProviderError).code).toBe('TIER_ROUTE_PROVIDER_KEY_MISSING')
    expect((missing as TierProviderError).keyPath).toBe('providers.glm.apiKeyEnv')
    expect((missing as TierProviderError).message).toContain('MOZHOU_GLM_KEY')

    const blank = (() => {
      try {
        resolveTierEndpoint(route, { MOZHOU_GLM_KEY: '   ' })
        return null
      } catch (error) {
        return error
      }
    })()
    expect((blank as TierProviderError).code).toBe('TIER_ROUTE_PROVIDER_KEY_MISSING')
  })
})

describe('applyTierModel（模型覆盖）', () => {
  it('route 为 null ⇒ 端点原样返回（无配置时行为与接线前一致，BYOK model 不受影响）', () => {
    expect(applyTierModel(BYOK_ENDPOINT, null)).toBe(BYOK_ENDPOINT)
  })

  it('route 存在 ⇒ 覆盖端点 model，其余字段（baseUrl/apiKey/allowPrivateNetwork）不动', () => {
    const route: DraftTierRoute = {
      configPath: join(dir, 'x.yaml'),
      selection: {
        taskType: 'CHAPTER_DRAFTING',
        tier: 'quality',
        route: { providerId: 'glm', model: 'tier-model' },
      },
      providers: GLM_REGISTRY,
    }
    const applied = applyTierModel(BYOK_ENDPOINT, route)
    expect(applied).toEqual({ ...BYOK_ENDPOINT, model: 'tier-model' })
    expect(applied.baseUrl).toBe(BYOK_ENDPOINT.baseUrl)
    expect(applied.apiKey).toBe(BYOK_ENDPOINT.apiKey)
  })
})

describe('tierRouteTraceLine（不许静默生效）', () => {
  it('留痕含 task_type / tier / providerId 覆盖前后值、实际出站端点及来源文件', () => {
    const line = tierRouteTraceLine(
      {
        configPath: join(dir, 'settings.yaml'),
        selection: {
          taskType: 'CHAPTER_DRAFTING',
          tier: 'quality',
          route: { providerId: 'glm', model: 'tier-model' },
        },
        providers: GLM_REGISTRY,
      },
      { defaultProviderId: 'deepseek', endpointBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
    )
    expect(line).toContain('task_type=CHAPTER_DRAFTING')
    expect(line).toContain('tier=quality')
    expect(line).toContain('providerId=deepseek→glm')
    expect(line).toContain('model=tier-model')
    // 注册表落地后 providerId 与端点是同一家：留痕把二者并排写出，便于事后核对
    expect(line).toContain('endpoint=https://open.bigmodel.cn/api/paas/v4')
    expect(line).toContain('settings.yaml')
  })

  it('无覆盖层文件（route 为 null）时不产生留痕——本函数只在覆盖生效时被调用', () => {
    // 留痕是「覆盖生效」的证据，端点来源由 resolveTierEndpoint 决定；此处只钉住
    // 「providerId 与 endpoint 并排出现」这一可核对性，避免退化成只记 providerId 的账本。
    const line = tierRouteTraceLine(
      {
        configPath: join(dir, 'settings.yaml'),
        selection: {
          taskType: 'CHAPTER_DRAFTING',
          tier: 'quality',
          route: { providerId: 'deepseek', model: 'tier-model' },
        },
        providers: {},
      },
      { defaultProviderId: 'deepseek', endpointBaseUrl: 'https://api.deepseek.com' },
    )
    expect(line).toContain('providerId=deepseek→deepseek')
    expect(line).toContain('endpoint=https://api.deepseek.com')
  })
})
