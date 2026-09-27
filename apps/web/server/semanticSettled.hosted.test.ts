// @vitest-environment node
/**
 * hosted 模式下的落定语义批次：必须显式拒答，绝不借用共享端点。
 *
 * 缺陷形态：reconciliation runtime 是按书根常驻的进程级单例，onSettled 是长生命周期闭包，
 * settle 由 watcher 定时器触发——发生时没有 principal。而凭据在 hosted 下按 userId 分目录。
 * 曾经无条件 resolveChatEndpoint(process.env)（不传 userId），于是落到共享那一档：
 * A 用户的落定语义分析用 B 用户的 Key 调 LLM，静默、无日志。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSettledSemanticAnalysis } from './semanticSettled.js'

const ENV_KEYS = ['MOZHOU_HOSTED', 'MOZHOU_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'] as const
const saved = new Map<string, string | undefined>()

beforeEach(() => {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key])
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = saved.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})

const REQUEST = {
  root: 'C:/does-not-matter',
  proposalId: 'prp_1',
  upstreamChanges: [],
  affectedChapters: [1],
} as const

describe('hosted 模式：拿不到 principal 就显式拒答', () => {
  it('即便进程环境里有可用 Key，hosted 下也不得拿它去调 LLM', async () => {
    process.env.MOZHOU_HOSTED = 'true'
    process.env.MOZHOU_API_KEY = 'sk-should-not-be-used'
    const outcome = await runSettledSemanticAnalysis({ ...REQUEST, deps: undefined })
    // 显式拒答，且理由要说清是无 principal 而不是没配 Key——两者处置完全不同。
    expect(outcome.status).toBe('skipped')
    if (outcome.status === 'skipped') {
      expect(outcome.reason).toBe('hosted_no_principal')
      expect(outcome.batch).toBeNull()
    }
  })

  it('非 hosted 时理由仍是 provider_unavailable（不误报成无 principal）', async () => {
    delete process.env.MOZHOU_HOSTED
    process.env.MOZHOU_API_KEY = ''
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.OPENAI_API_KEY
    const outcome = await runSettledSemanticAnalysis({ ...REQUEST, deps: undefined })
    expect(outcome.status).toBe('skipped')
    if (outcome.status === 'skipped') {
      expect(outcome.reason).toBe('provider_unavailable')
    }
  })

  it('测试注入的 deps 不受 hosted 守卫影响（注入是显式契约，非默认解析）', async () => {
    process.env.MOZHOU_HOSTED = 'true'
    const evaluate = () =>
      Promise.resolve({ verdict: 'ok' as const, findings: [], outputTokens: 0 })
    const outcome = await runSettledSemanticAnalysis({ ...REQUEST, deps: { evaluate } })
    if (outcome.status === 'skipped') {
      expect(outcome.reason).not.toBe('hosted_no_principal')
    }
  })
})
