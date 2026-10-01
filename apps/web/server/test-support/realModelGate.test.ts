// @vitest-environment node
/**
 * 门控模块自身的确定性测试（整改 T02）。**零网络、零凭据、零上游调用**：
 * 全部用例只对纯函数 resolveRealModelGate / requireRealModelConfig /
 * applyEnvOverrides 喂假的 env 对象。
 *
 * 这些断言锁住契约本身——没有它们，"门控"只是一句注释，
 * 任何一次把它改回 available=false 提前 return 的重构都不会被测试拦住。
 */
import { describe, expect, it } from 'vitest'
import {
  REAL_MODEL_CREDENTIAL_VARS,
  REAL_MODEL_ENABLE_VAR,
  RealModelConfigError,
  applyEnvOverrides,
  isRealModelEnabled,
  requireRealModelConfig,
  resolveRealModelGate,
} from './realModelGate.js'

const COMPLETE = {
  MOZHOU_API_KEY: 'k-not-a-real-key',
  MOZHOU_API_BASE: 'http://127.0.0.1:1/v1',
  MOZHOU_MODEL: 'some-model',
}

describe('真实模型门控 · 默认路径（未启用 ⇒ 零上游）', () => {
  it('未设置开关时判定为 disabled，且不携带任何凭据', () => {
    const gate = resolveRealModelGate({})
    expect(gate.kind).toBe('disabled')
    if (gate.kind === 'disabled') {
      // 未启用路径连 config 字段都不该存在，调用方无从误取 key
      expect('config' in gate).toBe(false)
      expect(gate.reason).toContain(REAL_MODEL_ENABLE_VAR)
    }
  })

  it('开关取值不是 "1" 一律 disabled（0/true/空串/大小写变体都不启用）', () => {
    for (const raw of ['0', 'true', 'yes', '', '  ', '01', 'TRUE', 'on']) {
      const env: NodeJS.ProcessEnv = { [REAL_MODEL_ENABLE_VAR]: raw, ...COMPLETE }
      expect(isRealModelEnabled(env), 'raw=' + JSON.stringify(raw)).toBe(false)
      expect(resolveRealModelGate(env).kind).toBe('disabled')
    }
  })

  it('开关首尾空白被裁掉："1 " / " 1 " 视为启用（env 常见尾随空格）', () => {
    for (const raw of ['1 ', ' 1 ', '\t1']) {
      const env: NodeJS.ProcessEnv = { [REAL_MODEL_ENABLE_VAR]: raw, ...COMPLETE }
      expect(isRealModelEnabled(env), 'raw=' + JSON.stringify(raw)).toBe(true)
    }
  })

  it('凭据存在但未启用时仍然是 disabled（门控看开关，不看有没有 key）', () => {
    expect(resolveRealModelGate({ ...COMPLETE }).kind).toBe('disabled')
  })

  it('requireRealModelConfig 在 disabled 状态下拒绝调用（防半吊子用法）', () => {
    expect(() => requireRealModelConfig(resolveRealModelGate({}))).toThrow(/只在/)
  })
})

describe('真实模型门控 · 启用但配置不全 ⇒ 必须失败而不是跳过', () => {
  it('三项缺任意一项，missing 精确指出缺哪个', () => {
    const cases: Array<[string, Record<string, string>, string[]]> = [
      ['缺 KEY', { MOZHOU_API_BASE: COMPLETE.MOZHOU_API_BASE, MOZHOU_MODEL: COMPLETE.MOZHOU_MODEL }, ['MOZHOU_API_KEY']],
      ['缺 BASE', { MOZHOU_API_KEY: COMPLETE.MOZHOU_API_KEY, MOZHOU_MODEL: COMPLETE.MOZHOU_MODEL }, ['MOZHOU_API_BASE']],
      ['缺 MODEL', { MOZHOU_API_KEY: COMPLETE.MOZHOU_API_KEY, MOZHOU_API_BASE: COMPLETE.MOZHOU_API_BASE }, ['MOZHOU_MODEL']],
      ['全缺', {}, [...REAL_MODEL_CREDENTIAL_VARS]],
      ['空串视同缺失', { ...COMPLETE, MOZHOU_API_KEY: '   ' }, ['MOZHOU_API_KEY']],
    ]
    for (const [label, rest, expected] of cases) {
      const gate = resolveRealModelGate({ [REAL_MODEL_ENABLE_VAR]: '1', ...rest })
      expect(gate.kind, label).toBe('enabled')
      if (gate.kind === 'enabled') expect([...gate.missing].sort(), label).toEqual([...expected].sort())
    }
  })

  it('配置不全时 requireRealModelConfig 抛 RealModelConfigError（不返回半成品）', () => {
    const gate = resolveRealModelGate({ [REAL_MODEL_ENABLE_VAR]: '1', MOZHOU_API_KEY: 'k' })
    expect(() => requireRealModelConfig(gate)).toThrow(RealModelConfigError)
  })

  it('错误消息只报变量名，绝不回显凭据值', () => {
    const secret = 'sk-should-never-appear-in-a-message'
    const gate = resolveRealModelGate({ [REAL_MODEL_ENABLE_VAR]: '1', MOZHOU_API_KEY: secret })
    let message = ''
    try {
      requireRealModelConfig(gate)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('MOZHOU_API_BASE')
    expect(message).not.toContain(secret)
  })
})

describe('真实模型门控 · 启用且配置完整', () => {
  it('三项齐全时取到完整配置', () => {
    const gate = resolveRealModelGate({ [REAL_MODEL_ENABLE_VAR]: '1', ...COMPLETE })
    expect(gate.kind).toBe('enabled')
    if (gate.kind === 'enabled') {
      expect(gate.missing).toEqual([])
      expect(requireRealModelConfig(gate)).toEqual({
        apiKey: COMPLETE.MOZHOU_API_KEY,
        apiBase: COMPLETE.MOZHOU_API_BASE,
        model: COMPLETE.MOZHOU_MODEL,
      })
    }
  })

  it('首尾空白被裁掉（copy-paste 来的 key/base 不至于因一个空格而失配）', () => {
    const gate = resolveRealModelGate({
      [REAL_MODEL_ENABLE_VAR]: '1',
      MOZHOU_API_KEY: '  k  ',
      MOZHOU_API_BASE: ' http://127.0.0.1:1/v1 ',
      MOZHOU_MODEL: ' m ',
    })
    expect(requireRealModelConfig(gate).model).toBe('m')
  })
})

describe('applyEnvOverrides · 逐项恢复', () => {
  it('恢复"原本不存在"的键 = 删除，而不是留一个空串', () => {
    const env: NodeJS.ProcessEnv = {}
    const restore = applyEnvOverrides({ MOZHOU_MODEL: 'temporary' }, env)
    expect(env['MOZHOU_MODEL']).toBe('temporary')
    restore()
    expect('MOZHOU_MODEL' in env).toBe(false)
  })

  it('恢复"原本有值"的键 = 精确还原旧值', () => {
    const env: NodeJS.ProcessEnv = { MOZHOU_MODEL: 'original' }
    const restore = applyEnvOverrides({ MOZHOU_MODEL: 'temporary' }, env)
    expect(env['MOZHOU_MODEL']).toBe('temporary')
    restore()
    expect(env['MOZHOU_MODEL']).toBe('original')
  })

  it('值为 undefined 时删除该键（用于清 mock 接缝）', () => {
    const env: NodeJS.ProcessEnv = { MOZHOU_NAMING_PROVIDER: 'mock', KEEP_ME: 'yes' }
    const restore = applyEnvOverrides({ MOZHOU_NAMING_PROVIDER: undefined }, env)
    expect('MOZHOU_NAMING_PROVIDER' in env).toBe(false)
    expect(env['KEEP_ME']).toBe('yes')
    restore()
    expect(env['MOZHOU_NAMING_PROVIDER']).toBe('mock')
  })

  it('只回滚本次改动的键，不碰宿主期间写入的无关键', () => {
    const env: NodeJS.ProcessEnv = { MOZHOU_MODEL: 'original', UNRELATED: 'before' }
    const restore = applyEnvOverrides({ MOZHOU_MODEL: 'temporary' }, env)
    env['UNRELATED'] = 'written-by-someone-else-during-the-test'
    restore()
    expect(env['MOZHOU_MODEL']).toBe('original')
    expect(env['UNRELATED']).toBe('written-by-someone-else-during-the-test')
  })
})