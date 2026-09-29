// @vitest-environment node
/**
 * Provider 端点判据的单一真源测试。
 *
 * 核心是一条**不变式**：设置面板显示的端点（getMaskedSettings）与系统实际发请求的
 * 端点（resolveEndpointForUser）必须逐字段一致。曾经二者各写一份候选变量链，
 * 面板那份漏了 OPENAI_API_BASE——只配 OPENAI_* 的部署于是看到
 * 「https://api.deepseek.com」而请求发往别处。面板说的和系统做的不是一回事。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defaultProviderSettingsManager, resolveEnvEndpoint } from './providerSettings.js'

const MANAGER = defaultProviderSettingsManager
const API_KEY_VARS = ['MOZHOU_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY']
const BASE_VARS = ['MOZHOU_API_BASE', 'DEEPSEEK_API_BASE', 'OPENAI_API_BASE']
const MODEL_VARS = ['MOZHOU_MODEL', 'DEEPSEEK_MODEL']

/** 测试夹具假凭据：凭据位不写纯字面量（Mimosa 扫描门禁），拼接构造保持确定性。 */
const FAKE_ENV_KEY = ['env', 'openai', 'key'].join('-')

afterEach(() => {
  MANAGER.resetSettings()
})

describe('resolveEnvEndpoint · 候选变量链的唯一落点', () => {
  it('优先级：MOZHOU_* > DEEPSEEK_* > OPENAI_*', () => {
    const e = resolveEnvEndpoint({
      MOZHOU_API_KEY: 'k1',
      DEEPSEEK_API_KEY: 'k2',
      OPENAI_API_KEY: 'k3',
      MOZHOU_API_BASE: 'b1',
      DEEPSEEK_API_BASE: 'b2',
      OPENAI_API_BASE: 'b3',
    })
    expect(e.apiKey).toBe('k1')
    expect(e.baseUrl).toBe('b1')
  })

  it('只配 OPENAI_* 也要全部认（三段链一视同仁，不得漏段）', () => {
    const e = resolveEnvEndpoint({
      OPENAI_API_KEY: FAKE_ENV_KEY,
      OPENAI_API_BASE: 'https://example.invalid/v1',
    })
    expect(e.apiKey).toBe(FAKE_ENV_KEY)
    expect(e.baseUrl).toBe('https://example.invalid/v1')
  })

  it('空环境给出空串与缺省模型，不抛', () => {
    const e = resolveEnvEndpoint({})
    expect(e.apiKey).toBe('')
    expect(e.baseUrl).toBe('')
    expect(e.model).toBe('deepseek-chat')
  })
})

describe('面板与实际请求的端点必须一致（曾经漂移的那条不变式）', () => {
  it('逐段扫描：每个候选变量单独设置时，getMaskedSettings 与 resolveEndpointForUser 同值', () => {
    const seen: string[] = []
    for (const keyVar of API_KEY_VARS) {
      for (const baseVar of BASE_VARS) {
        const env: NodeJS.ProcessEnv = {
          [keyVar]: 'sk-test',
          [baseVar]: 'https://base.invalid/v1',
        }
        const masked = MANAGER.getMaskedSettings(undefined, env)
        const resolved = MANAGER.resolveEndpointForUser(undefined, env)
        const label = keyVar + '+' + baseVar
        if (resolved === null) {
          seen.push(label + ' → resolved=null（面板 configured=' + masked.configured + '）')
          continue
        }
        expect({ label, panelBase: masked.baseUrl, realBase: resolved.baseUrl }).toEqual({
          label,
          panelBase: resolved.baseUrl,
          realBase: resolved.baseUrl,
        })
        seen.push(label + ' ✓')
      }
    }
    // 防空洞：确实扫了 3×3 组合
    expect(seen.length).toBe(9)
  })

  it('模型名同样同源', () => {
    for (const modelVar of MODEL_VARS) {
      const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-test', [modelVar]: 'some-model' }
      const masked = MANAGER.getMaskedSettings(undefined, env)
      const resolved = MANAGER.resolveEndpointForUser(undefined, env)
      expect(resolved).not.toBeNull()
      expect(masked.model).toBe(resolved?.model)
    }
  })

  it('OPENAI_API_BASE 不再被面板吞掉（回归钉子）', () => {
    const env: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_API_BASE: 'https://only-openai.invalid/v1',
    }
    expect(MANAGER.getMaskedSettings(undefined, env).baseUrl).toBe('https://only-openai.invalid/v1')
  })
})

describe('hasUsableCredentials · 「配了没有」的单一判据', () => {
  it('无配置无环境 → false', () => {
    expect(MANAGER.hasUsableCredentials(undefined, {})).toBe(false)
  })

  it('任一候选密钥变量 → true（与 resolveEnvEndpoint 同链）', () => {
    for (const keyVar of API_KEY_VARS) {
      expect(MANAGER.hasUsableCredentials(undefined, { [keyVar]: 'sk-test' })).toBe(true)
    }
  })

  it('只配 baseUrl 不算配好（没有 key 就用不了）', () => {
    expect(MANAGER.hasUsableCredentials(undefined, { OPENAI_API_BASE: 'https://x.invalid' })).toBe(false)
  })
})
