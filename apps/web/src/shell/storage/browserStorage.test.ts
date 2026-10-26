/**
 * 统一浏览器存储适配器（browserStorage）单元测试
 *
 * 覆盖指标：
 * 1. 强类型泛型接口与键名集中字典常量和键构造器；
 * 2. 正常环境下的安全 JSON 序列化、类型验证器与读取回退；
 * 3. 原始字符串安全读写及异常吞咽；
 * 4. 捕获 QuotaExceededError 并透明平滑回退到 InMemory Map 机制；
 * 5. 无痕/隐私模式与跨域沙箱（SecurityError 或 localStorage 不可用）回退机制；
 * 6. MemoryStorageAdapter 纯内存实现契约校验；
 * 7. isQuotaExceededError 与 isSecurityError 判定逻辑。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryStorageAdapter,
  STORAGE_KEYS,
  candidateCacheKey,
  createStorageAdapter,
  defaultStorage,
  draftBaselineKey,
  draftCacheKey,
  editorProjectionKey,
  exportMemoryDrafts,
  getStorageItem,
  getStoragePersistStatus,
  getStorageRawString,
  isQuotaExceededError,
  isSecurityError,
  removeStorageItem,
  setStorageItem,
  setStorageRawString,
} from './browserStorage'

describe('browserStorage 存储键字典与构造器', () => {
  it('STORAGE_KEYS 包含预定义白名单键', () => {
    expect(STORAGE_KEYS.WORKBENCH_STATE).toBe('mozhou.workbench.v1')
    expect(STORAGE_KEYS.DRAFT_CACHE_PREFIX).toBe('mozhou.draft.cache')
    expect(STORAGE_KEYS.DRAFT_BASELINE_PREFIX).toBe('mozhou.draft.baseline')
    expect(STORAGE_KEYS.CANDIDATE_CACHE_PREFIX).toBe('mozhou.candidate.cache')
    expect(STORAGE_KEYS.EDITOR_PROJECTION_PREFIX).toBe('mozhou.editor.projection')
    expect(STORAGE_KEYS.SCENE_PREFERENCE).toBe('mozhou.scene.v1')
    expect(STORAGE_KEYS.WIZARD_DONE).toBe('mozhou.wizard.done')
    expect(STORAGE_KEYS.SKILLS_ACTIVE).toBe('mozhou.skills.active')
  })

  it('键构造器生成符合前缀规范的唯一键名', () => {
    expect(draftCacheKey('ch_bk1_1')).toBe('mozhou.draft.cache.ch_bk1_1')
    expect(draftBaselineKey('ch_bk1_1')).toBe('mozhou.draft.baseline.ch_bk1_1')
    expect(candidateCacheKey('cand_bk1_1')).toBe('mozhou.candidate.cache.cand_bk1_1')
    expect(editorProjectionKey('ch_bk1_1')).toBe('mozhou.editor.projection.ch_bk1_1')
  })
})

describe('MemoryStorageAdapter 内存存储实现', () => {
  it('满足 StorageAdapter 基础读写清空契约', () => {
    const memory = new MemoryStorageAdapter()
    expect(memory.isMemoryFallback).toBe(true)
    expect(memory.getItem('foo')).toBeNull()

    memory.setItem('foo', 'bar')
    expect(memory.getItem('foo')).toBe('bar')
    expect(memory.has('foo')).toBe(true)
    expect(memory.size).toBe(1)
    expect(memory.keys()).toEqual(['foo'])

    memory.removeItem('foo')
    expect(memory.getItem('foo')).toBeNull()
    expect(memory.has('foo')).toBe(false)
    expect(memory.size).toBe(0)

    memory.setItem('a', '1')
    memory.setItem('b', '2')
    memory.clear()
    expect(memory.size).toBe(0)
    expect(memory.getItem('a')).toBeNull()
  })
})

describe('强类型泛型安全存取 (getStorageItem / setStorageItem)', () => {
  afterEach(() => {
    window.localStorage.clear()
    defaultStorage.reset()
  })

  interface TestPayload {
    name: string
    count: number
    active?: boolean
  }

  it('支持复杂 JSON 对象的强类型写入与读取', () => {
    const payload: TestPayload = { name: '墨舟', count: 42, active: true }
    const ok = setStorageItem('test.item', payload)
    expect(ok).toBe(true)

    const loaded = getStorageItem<TestPayload>('test.item')
    expect(loaded).toEqual(payload)
  })

  it('不存在的键返回 null 或 fallback', () => {
    expect(getStorageItem('test.nonexistent')).toBeNull()
    expect(getStorageItem('test.nonexistent', { fallback: '默认值' })).toBe('默认值')
  })

  it('遇到非法/损坏的 JSON 文本时静默回退，绝不抛出 SyntaxError', () => {
    window.localStorage.setItem('test.corrupted', '{bad json')
    const result = getStorageItem<TestPayload>('test.corrupted', {
      fallback: { name: 'fallback', count: 0 },
    })
    expect(result).toEqual({ name: 'fallback', count: 0 })
  })

  it('支持类型验证器 (validator)，校验失败时回退', () => {
    const isPayload = (v: unknown): v is TestPayload =>
      typeof v === 'object' && v !== null && typeof (v as TestPayload).name === 'string'

    setStorageItem('test.valid', { name: '有效', count: 1 })
    setStorageItem('test.invalid', { count: 2 }) // missing name

    const valid = getStorageItem<TestPayload>('test.valid', { validator: isPayload })
    expect(valid).toEqual({ name: '有效', count: 1 })

    const invalid = getStorageItem<TestPayload>('test.invalid', {
      validator: isPayload,
      fallback: { name: 'default', count: 0 },
    })
    expect(invalid).toEqual({ name: 'default', count: 0 })
  })

  it('支持原始字符串读写与删除 (getStorageRawString / setStorageRawString / removeStorageItem)', () => {
    expect(getStorageRawString('test.str', '空')).toBe('空')
    setStorageRawString('test.str', '你好墨舟')
    expect(getStorageRawString('test.str')).toBe('你好墨舟')

    removeStorageItem('test.str')
    expect(getStorageRawString('test.str', '已删')).toBe('已删')
  })
})

describe('异常判定函数 (isQuotaExceededError / isSecurityError)', () => {
  it('正确识别各类配额超限异常', () => {
    const domEx = new DOMException('Quota exceeded', 'QuotaExceededError')
    expect(isQuotaExceededError(domEx)).toBe(true)

    const safariEx = { code: 22, name: 'QuotaExceededError', message: 'QuotaExceededError' }
    expect(isQuotaExceededError(safariEx)).toBe(true)

    const firefoxEx = { code: 1014, name: 'NS_ERROR_DOM_QUOTA_REACHED' }
    expect(isQuotaExceededError(firefoxEx)).toBe(true)

    const genericMsg = { message: 'The quota has been exceeded.' }
    expect(isQuotaExceededError(genericMsg)).toBe(true)

    expect(isQuotaExceededError(new Error('Other error'))).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
  })

  it('正确识别受限环境安全异常 (SecurityError)', () => {
    const domEx = new DOMException('Access denied', 'SecurityError')
    expect(isSecurityError(domEx)).toBe(true)

    const mockSec = { code: 18, name: 'SecurityError' }
    expect(isSecurityError(mockSec)).toBe(true)

    expect(isSecurityError(new Error('Other'))).toBe(false)
    expect(isSecurityError(null)).toBe(false)
  })
})

describe('QuotaExceeded 与受限沙箱回退机制', () => {
  let mockStore: Record<string, string>

  beforeEach(() => {
    mockStore = {}
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('写入遭遇 QuotaExceededError 时捕获异常并转入内存暂存，标记持久化失败并提供可恢复出口', () => {
    let quotaAlertCount = 0
    const failingStorage: Storage = {
      length: 0,
      clear: () => { mockStore = {} },
      getItem: (k: string) => mockStore[k] ?? null,
      key: () => null,
      removeItem: (k: string) => { delete mockStore[k] },
      setItem: (k: string, v: string) => {
        if (k === 'quota.bomb') {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        }
        mockStore[k] = v
      },
    }

    const adapter = createStorageAdapter(() => failingStorage)
    adapter.onQuotaExceeded(() => {
      quotaAlertCount++
    })
    expect(adapter.isMemoryFallback).toBe(false)
    expect(adapter.hasQuotaExceeded).toBe(false)
    expect(adapter.lastWritePersisted).toBe(true)

    // 1. 正常写入可进原生存储，setStorageItem / setStorageRawString 返回 true
    const normalOk = setStorageRawString('normal.key', 'ok', adapter)
    expect(normalOk).toBe(true)
    expect(mockStore['normal.key']).toBe('ok')
    expect(adapter.lastWritePersisted).toBe(true)

    // 2. 触发 QuotaExceededError：setStorageRawString 返回 false（明确告知调用方未完成持久化落盘）
    const bombOk = setStorageRawString('quota.bomb', 'large draft data', adapter)
    expect(bombOk).toBe(false) // 杜绝虚假保存成功
    expect(adapter.hasQuotaExceeded).toBe(true)
    expect(adapter.lastWritePersisted).toBe(false)
    expect(quotaAlertCount).toBe(1)

    // 3. 原生存储未保存 bomb，但当前会话内存保留暂存防丢
    expect(mockStore['quota.bomb']).toBeUndefined()
    expect(adapter.getItem('quota.bomb')).toBe('large draft data')

    // 4. 提供可恢复出口：可导出内存暂存的草稿条目
    const memoryDrafts = exportMemoryDrafts(adapter)
    expect(memoryDrafts['quota.bomb']).toBe('large draft data')

    // 5. 状态探测接口真实反映降级现状
    const status = getStoragePersistStatus(adapter)
    expect(status.hasQuotaExceeded).toBe(true)
    expect(status.lastWritePersisted).toBe(false)

    // 6. 新实例重新打开（模拟重启应用）：原生存储只包含 normal.key，证明未虚假写入物理磁盘
    const reloadedAdapter = createStorageAdapter(() => failingStorage)
    expect(reloadedAdapter.getItem('normal.key')).toBe('ok')
    expect(reloadedAdapter.getItem('quota.bomb')).toBeNull()
  })

  it('当 localStorage 不可用或访问被安全沙箱拦截（SecurityError）时自动降级到内存 Map', () => {
    const securityBlockedStorage: Storage = {
      length: 0,
      clear: () => {},
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      key: () => null,
      removeItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    }

    const adapter = createStorageAdapter(() => securityBlockedStorage)
    expect(adapter.isMemoryFallback).toBe(true)

    // 写入与读取完全安全无报错
    expect(() => adapter.setItem('private.key', 'secret')).not.toThrow()
    expect(adapter.getItem('private.key')).toBe('secret')
    expect(adapter.isMemoryFallback).toBe(true)
  })

  it('当原生存储完全为 null（如非浏览器或极端沙箱环境）时正常运行', () => {
    const adapter = createStorageAdapter(() => null)
    expect(adapter.isMemoryFallback).toBe(true)

    expect(getStorageItem('null.env', { fallback: 'default' }, adapter)).toBe('default')
    setStorageItem('null.env', { foo: 'bar' }, adapter)
    expect(getStorageItem('null.env', undefined, adapter)).toEqual({ foo: 'bar' })
  })
})
