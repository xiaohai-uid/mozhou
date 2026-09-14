/**
 * Scene System 本地偏好（ADR-0028 · 规格 §3）。
 * Scene 是界面偏好，不是 Canon：持久化到 localStorage `mozhou.scene.v1`，
 * 任何改动不触碰正典/正文/Receipt/Pipeline 状态。与 workbenchStorage 同纪律：
 * 解析失败/存储不可用一律静默回退（偏好是增强，不是硬依赖）。
 * 上传图持久化预算：dataURL 超限时仅本次会话有效（不落盘），由 UI 明示。
 */

export type SceneId = 'silver-atrium' | 'city-night' | 'cloud-sea' | 'rain-city' | 'library' | 'custom'
export type SceneFigureAnchor = 'left' | 'center' | 'right'

export interface SceneProfile {
  readonly sceneId: SceneId
  /** 上传背景 dataURL（JPG/PNG/WebP；仅 ≤ 持久化预算时写入存储）。 */
  readonly customBg?: string
  /** 上传前景人物 dataURL（透明 PNG/WebP）。 */
  readonly customFigure?: string
  /** 背景亮度（%，30..130）。 */
  readonly brightness: number
  /** 背景模糊（px，0..14）。 */
  readonly blur: number
  /** 暗幕强度（0.2..0.85）。 */
  readonly veil: number
  /** 场景焦点 X/Y（%，视差用）。 */
  readonly focusX: number
  readonly focusY: number
  readonly figure: {
    readonly enabled: boolean
    readonly anchor: SceneFigureAnchor
    readonly scale: number
    readonly opacity: number
  }
}

export interface ScenePreference {
  version: 1
  global: SceneProfile
  books: Record<string, SceneProfile>
}

export const SCENE_STORAGE_KEY = 'mozhou.scene.v1'

export const SCENE_UPLOAD_BUDGET = {
  /** 背景文件预算（字节）。 */
  backgroundBytes: 8 * 1024 * 1024,
  /** 人物文件预算（字节）。 */
  figureBytes: 4 * 1024 * 1024,
  /** dataURL 持久化上限（字符）——超出则仅会话内有效。 */
  persistChars: 1_200_000,
  /** 最低可用宽度（px）。 */
  minBackgroundWidth: 1280,
  minFigureWidth: 600,
} as const

export const DEFAULT_SCENE_PROFILE: SceneProfile = {
  sceneId: 'silver-atrium',
  brightness: 100,
  blur: 0,
  veil: 0.12,
  focusX: 50,
  focusY: 38,
  figure: { enabled: false, anchor: 'right', scale: 1, opacity: 0.6 },
}

function isSceneProfile(value: unknown): value is SceneProfile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as SceneProfile
  return (
    typeof profile.sceneId === 'string' &&
    typeof profile.brightness === 'number' &&
    typeof profile.blur === 'number' &&
    typeof profile.veil === 'number' &&
    typeof profile.figure === 'object' &&
    profile.figure !== null &&
    typeof profile.figure.enabled === 'boolean'
  )
}

export function loadScenePreference(): ScenePreference {
  try {
    const raw = window.localStorage.getItem(SCENE_STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as ScenePreference
      if (parsed.version === 1 && isSceneProfile(parsed.global)) {
        return { version: 1, global: parsed.global, books: parsed.books ?? {} }
      }
    }
  } catch {
    // 解析失败：静默回退默认偏好（增强，不阻塞）。
  }
  return { version: 1, global: DEFAULT_SCENE_PROFILE, books: {} }
}

export function saveScenePreference(preference: ScenePreference): void {
  try {
    window.localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(preference))
  } catch {
    // 持久化失败：静默（会话内仍生效）。
  }
}

/** 有书且有 override 用 override；有书无 override 继承 global；无书用 global。 */
export function resolveSceneProfile(preference: ScenePreference, bookId: string | null): SceneProfile {
  if (bookId === null) return preference.global
  return preference.books[bookId] ?? preference.global
}

export function hasBookOverride(preference: ScenePreference, bookId: string | null): boolean {
  return bookId !== null && preference.books[bookId] !== undefined
}

/** 作用域内更新 profile；scope=book 时写入该书的 override（无则从全局复制起步）。 */
export function updateScopedProfile(
  preference: ScenePreference,
  bookId: string | null,
  scope: 'global' | 'book',
  update: (profile: SceneProfile) => SceneProfile,
): ScenePreference {
  if (scope === 'book' && bookId !== null) {
    const base = preference.books[bookId] ?? preference.global
    return { ...preference, books: { ...preference.books, [bookId]: update(base) } }
  }
  return { ...preference, global: update(preference.global) }
}

export function clearBookOverride(preference: ScenePreference, bookId: string): ScenePreference {
  const books = { ...preference.books }
  delete books[bookId]
  return { ...preference, books }
}

/** dataURL 是否可持久化（超预算只保留在会话内存中）。 */
export function isPersistableDataUrl(dataUrl: string): boolean {
  return dataUrl.length <= SCENE_UPLOAD_BUDGET.persistChars
}
