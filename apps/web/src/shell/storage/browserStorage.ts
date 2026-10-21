/**
 * 统一浏览器存储适配器（Browser Storage Adapter）
 *
 * 核心设计目标：
 * 1. 强类型泛型接口与键名集中字典（STORAGE_KEYS / StorageKey）；
 * 2. 安全 JSON 序列化与反序列化，防损坏与类型崩塌；
 * 3. QuotaExceededError 与 DOMException 异常捕获；
 * 4. 无痕模式 / 受限沙箱 / 异常崩溃时的内存 Map (InMemoryStorage) 自动透明回退机制；
 * 5. 消除各业务模块直接 naked 访问 window.localStorage，提供统一可观察、可测试的存储层。
 */

export const STORAGE_KEYS = {
  WORKBENCH_STATE: 'mozhou.workbench.v1',
  DRAFT_CACHE_PREFIX: 'mozhou.draft.cache',
  DRAFT_BASELINE_PREFIX: 'mozhou.draft.baseline',
  CANDIDATE_CACHE_PREFIX: 'mozhou.candidate.cache',
  EDITOR_PROJECTION_PREFIX: 'mozhou.editor.projection',
  SCENE_PREFERENCE: 'mozhou.scene.v1',
  WIZARD_DONE: 'mozhou.wizard.done',
  SKILLS_ACTIVE: 'mozhou.skills.active',
} as const

export type KnownStorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
export type StorageKey = KnownStorageKey | `${KnownStorageKey}.${string}` | (string & {})

export function draftCacheKey(chapterKey: string): string {
  return `${STORAGE_KEYS.DRAFT_CACHE_PREFIX}.${chapterKey}`
}

export function draftBaselineKey(chapterKey: string): string {
  return `${STORAGE_KEYS.DRAFT_BASELINE_PREFIX}.${chapterKey}`
}

export function candidateCacheKey(chapterKey: string): string {
  return `${STORAGE_KEYS.CANDIDATE_CACHE_PREFIX}.${chapterKey}`
}

export function editorProjectionKey(chapterKey: string): string {
  return `${STORAGE_KEYS.EDITOR_PROJECTION_PREFIX}.${chapterKey}`
}

export interface BrowserStorageOptions<T> {
  readonly fallback?: T
  readonly validator?: (value: unknown) => value is T
}

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  readonly isMemoryFallback?: boolean
  readonly lastWritePersisted?: boolean
  readonly hasQuotaExceeded?: boolean
}

/**
 * 判断是否为配额超出异常（QuotaExceededError）
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014
    )
  }
  if (err && typeof err === 'object') {
    const errorRecord = err as { name?: unknown; code?: unknown; message?: unknown }
    if (
      errorRecord.name === 'QuotaExceededError' ||
      errorRecord.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      errorRecord.code === 22 ||
      errorRecord.code === 1014
    ) {
      return true
    }
    if (typeof errorRecord.message === 'string' && /quota/i.test(errorRecord.message)) {
      return true
    }
  }
  return false
}

/**
 * 判断是否为安全限制/沙箱受限异常（SecurityError）
 */
export function isSecurityError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'SecurityError' || err.code === 18
  }
  if (err && typeof err === 'object') {
    const errorRecord = err as { name?: unknown; code?: unknown }
    return errorRecord.name === 'SecurityError' || errorRecord.code === 18
  }
  return false
}

/** 纯内存回退存储实现，符合基础 Web Storage 读写契约 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, string>()
  public readonly isMemoryFallback = true

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }

  public removeItem(key: string): void {
    this.store.delete(key)
  }

  public clear(): void {
    this.store.clear()
  }

  public has(key: string): boolean {
    return this.store.has(key)
  }

  public get size(): number {
    return this.store.size
  }

  public keys(): string[] {
    return Array.from(this.store.keys())
  }
}

/** 包装实际的 localStorage 或其替身，处理 Quota / 安全异常并自动切换为内存回退 */
export class BrowserStorageAdapter implements StorageAdapter {
  private memoryFallback: MemoryStorageAdapter | null = null
  private _hasQuotaExceeded = false
  private _lastWritePersisted = true
  private _nativeAvailable: boolean | null = null
  private readonly quotaListeners = new Set<(key: string, error: unknown) => void>()

  constructor(private readonly getNativeStorage: () => Storage | null = () => defaultGetLocalStorage()) {}

  private getNativeSafe(): Storage | null {
    try {
      return this.getNativeStorage()
    } catch {
      return null
    }
  }

  public get isMemoryFallback(): boolean {
    if (this.memoryFallback !== null) return true
    if (this._nativeAvailable !== null) return !this._nativeAvailable
    const native = this.getNativeSafe()
    if (!native) {
      this._nativeAvailable = false
      return true
    }
    try {
      const testKey = '__mozhou_test__'
      native.setItem(testKey, '1')
      native.removeItem(testKey)
      this._nativeAvailable = true
      return false
    } catch {
      this._nativeAvailable = false
      return true
    }
  }

  public get hasQuotaExceeded(): boolean {
    return this._hasQuotaExceeded
  }

  public get lastWritePersisted(): boolean {
    return this._lastWritePersisted
  }

  public onQuotaExceeded(listener: (key: string, error: unknown) => void): () => void {
    this.quotaListeners.add(listener)
    return () => this.quotaListeners.delete(listener)
  }

  public getMemoryEntries(): ReadonlyArray<[string, string]> {
    if (!this.memoryFallback) return []
    return this.memoryFallback.keys().map((k) => [k, this.memoryFallback!.getItem(k)!])
  }

  public getItem(key: string): string | null {
    if (this.memoryFallback && this.memoryFallback.has(key)) {
      return this.memoryFallback.getItem(key)
    }
    const native = this.getNativeSafe()
    if (!native) {
      this.ensureMemoryFallback()
      return this.memoryFallback!.getItem(key)
    }
    try {
      return native.getItem(key)
    } catch {
      this.ensureMemoryFallback()
      return this.memoryFallback!.getItem(key)
    }
  }

  public setItem(key: string, value: string): void {
    const native = this.getNativeSafe()
    if (!native) {
      this.ensureMemoryFallback()
      this.memoryFallback!.setItem(key, value)
      this._lastWritePersisted = false
      return
    }
    try {
      native.setItem(key, value)
      this._lastWritePersisted = true
      if (this.memoryFallback && this.memoryFallback.has(key)) {
        this.memoryFallback.removeItem(key)
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        // 配额超出：立即标记配额异常与非持久态，并转存内存保证运行现场不崩
        this._hasQuotaExceeded = true
        this._lastWritePersisted = false
        this.ensureMemoryFallback()
        this.memoryFallback!.setItem(key, value)
        for (const listener of this.quotaListeners) {
          try {
            listener(key, err)
          } catch {
            // ignore
          }
        }
        return
      }
      if (isSecurityError(err)) {
        this._lastWritePersisted = false
        this.ensureMemoryFallback()
        this.memoryFallback!.setItem(key, value)
        return
      }
      this._lastWritePersisted = false
      throw err
    }
  }

  public removeItem(key: string): void {
    if (this.memoryFallback) {
      this.memoryFallback.removeItem(key)
    }
    const native = this.getNativeSafe()
    if (native) {
      try {
        native.removeItem(key)
      } catch {
        // ignore
      }
    }
  }

  public clear(): void {
    if (this.memoryFallback) {
      this.memoryFallback.clear()
    }
    const native = this.getNativeSafe()
    if (native) {
      try {
        native.clear()
      } catch {
        // ignore
      }
    }
  }

  public reset(): void {
    this.memoryFallback = null
    this._hasQuotaExceeded = false
    this._lastWritePersisted = true
    this._nativeAvailable = null
  }

  private ensureMemoryFallback(): void {
    if (!this.memoryFallback) {
      this.memoryFallback = new MemoryStorageAdapter()
    }
  }
}

function defaultGetLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // SecurityError in private browsing or iframe sandbox
    return null
  }
  return null
}

/** 全局默认存储实例 */
export const defaultStorage = new BrowserStorageAdapter()

/** 工厂函数：用于创建隔离的存储适配器（测试或特定作用域） */
export function createStorageAdapter(getNativeStorage?: () => Storage | null): BrowserStorageAdapter {
  return new BrowserStorageAdapter(getNativeStorage)
}

/**
 * 强类型读取（带泛型支持、验证器与回退机制）
 */
export function getStorageItem<T>(
  key: StorageKey,
  options: BrowserStorageOptions<T> & { readonly fallback: T },
  adapter?: StorageAdapter,
): T
export function getStorageItem<T>(
  key: StorageKey,
  options?: BrowserStorageOptions<T>,
  adapter?: StorageAdapter,
): T | null
export function getStorageItem<T>(
  key: StorageKey,
  options?: BrowserStorageOptions<T>,
  adapter: StorageAdapter = defaultStorage,
): T | null {
  const fallback = options?.fallback ?? null
  try {
    const raw = adapter.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (options?.validator) {
      return options.validator(parsed) ? parsed : fallback
    }
    return parsed as T
  } catch {
    return fallback
  }
}

/**
 * 读取原始字符串（不经 JSON 序列化）
 */
export function getStorageRawString(
  key: StorageKey,
  fallback = '',
  adapter: StorageAdapter = defaultStorage,
): string {
  try {
    const val = adapter.getItem(key)
    return val ?? fallback
  } catch {
    return fallback
  }
}

/**
 * 强类型安全写入（自动序列化为 JSON，返回物理持久化是否成功）
 * 若遭遇配额超限转入内存暂存，返回 false 告知调用方未完成持久化。
 */
export function setStorageItem<T>(
  key: StorageKey,
  value: T,
  adapter: StorageAdapter = defaultStorage,
): boolean {
  try {
    const raw = JSON.stringify(value)
    adapter.setItem(key, raw)
    if (adapter.lastWritePersisted === false) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * 写入原始字符串（返回物理持久化是否成功）
 * 若遭遇配额超限转入内存暂存，返回 false 告知调用方未完成持久化。
 */
export function setStorageRawString(
  key: StorageKey,
  value: string,
  adapter: StorageAdapter = defaultStorage,
): boolean {
  try {
    adapter.setItem(key, value)
    if (adapter.lastWritePersisted === false) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * 查询当前存储持久化状态
 */
export function getStoragePersistStatus(adapter: StorageAdapter = defaultStorage): {
  readonly isMemoryFallback: boolean
  readonly hasQuotaExceeded: boolean
  readonly lastWritePersisted: boolean
} {
  return {
    isMemoryFallback: adapter.isMemoryFallback ?? false,
    hasQuotaExceeded: adapter.hasQuotaExceeded ?? false,
    lastWritePersisted: adapter.lastWritePersisted ?? true,
  }
}

/**
 * 导出内存回退暂存区的所有未落盘草稿条目（提供可恢复出口）
 */
export function exportMemoryDrafts(adapter: StorageAdapter = defaultStorage): Record<string, string> {
  if (adapter instanceof BrowserStorageAdapter) {
    const res: Record<string, string> = {}
    for (const [k, v] of adapter.getMemoryEntries()) {
      res[k] = v
    }
    return res
  }
  return {}
}

/**
 * 删除键
 */
export function removeStorageItem(
  key: StorageKey,
  adapter: StorageAdapter = defaultStorage,
): void {
  try {
    adapter.removeItem(key)
  } catch {
    // ignore
  }
}
