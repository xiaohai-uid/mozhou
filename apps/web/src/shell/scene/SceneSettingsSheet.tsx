/**
 * 墨境场景设置 Sheet（ADR-0028 · 规格 §3.5）：右侧 non-blocking 四分区
 * （场景/氛围/人物/作用域），实时预览；仅删除作品覆盖需确认。
 * 上传走完整校验链：格式白名单 → 尺寸预算 → 最低分辨率 → 预览/应用/移除。
 */
import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { BookInfo } from '../workbenchStorage'
import { useSheetA11y } from '../useSheetA11y'
import {
  DEFAULT_SCENE_PROFILE,
  SCENE_UPLOAD_BUDGET,
  hasBookOverride,
  isPersistableDataUrl,
  updateScopedProfile,
  clearBookOverride,
} from './scenePreference'
import type { SceneId, SceneProfile, ScenePreference } from './scenePreference'

const BUILT_IN_SCENES: readonly { id: Exclude<SceneId, 'custom'>; label: string }[] = [
  { id: 'silver-atrium', label: '银白中庭' },
  { id: 'city-night', label: '海城 · 夜' },
  { id: 'cloud-sea', label: '云海之上' },
  { id: 'rain-city', label: '雨夜都市' },
  { id: 'library', label: '旧书房斋' },
]

type SheetTab = 'scene' | 'atmosphere' | 'figure' | 'scope'
const TABS: readonly { id: SheetTab; label: string }[] = [
  { id: 'scene', label: '场景' },
  { id: 'atmosphere', label: '氛围' },
  { id: 'figure', label: '人物' },
  { id: 'scope', label: '作用域' },
]

interface UploadError {
  readonly title: string
  readonly why: string
}

/** exactOptionalPropertyTypes：移除可选键须 delete（解构剔除会产生未用变量）。 */
function withoutCustomBg(profile: SceneProfile): SceneProfile {
  const rest = { ...profile }
  delete rest.customBg
  return rest
}
function withoutCustomFigure(profile: SceneProfile): SceneProfile {
  const rest = { ...profile }
  delete rest.customFigure
  return rest
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function decodeDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('图片解码失败：文件已损坏或编码不完整'))
    image.src = dataUrl
  })
}

/** 人物层透明度检测：降采样扫描 alpha；环境不支持 canvas 时返回 null（跳过校验）。 */
async function imageHasTransparency(dataUrl: string): Promise<boolean | null> {
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('decode failed'))
      image.src = dataUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 48
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(image, 0, 0, 48, 48)
    const data = context.getImageData(0, 0, 48, 48).data
    for (let i = 3; i < data.length; i += 4) {
      const alpha = data[i]
      if (alpha !== undefined && alpha < 250) return true
    }
    return false
  } catch {
    return null
  }
}

export function SceneSettingsSheet({
  preference,
  book,
  onChange,
  onClose,
}: {
  preference: ScenePreference
  book: BookInfo | null
  onChange: (next: ScenePreference) => void
  onClose: () => void
}): JSX.Element {
  const bookId = book?.bookId ?? null
  const overrideExists = hasBookOverride(preference, bookId)
  const [scope, setScope] = useState<'global' | 'book'>(bookId !== null && overrideExists ? 'book' : 'global')
  const [tab, setTab] = useState<SheetTab>('scene')
  const [bgError, setBgError] = useState<UploadError | null>(null)
  const [figureError, setFigureError] = useState<UploadError | null>(null)
  const [bgSessionOnly, setBgSessionOnly] = useState(false)
  const [figureSessionOnly, setFigureSessionOnly] = useState(false)
  const bgFileRef = useRef<HTMLInputElement | null>(null)
  const figureFileRef = useRef<HTMLInputElement | null>(null)

  const { panelRef } = useSheetA11y(true, onClose)

  /** 变更落偏好并广播（同会话移动端即时跟随）。 */
  const change = (next: ScenePreference): void => {
    onChange(next)
    window.dispatchEvent(new Event('mozhou:scene-refresh'))
  }

  const activeProfile = scope === 'book' && bookId !== null
    ? (preference.books[bookId] ?? preference.global)
    : preference.global
  const patchProfile = (update: (profile: SceneProfile) => SceneProfile): void => {
    change(updateScopedProfile(preference, bookId, scope, update))
  }
  const patchFigure = (update: (figure: SceneProfile['figure']) => SceneProfile['figure']): void => {
    patchProfile((profile) => ({ ...profile, figure: update(profile.figure) }))
  }
  const rangeFill = (value: number, min: number, max: number): CSSProperties =>
    ({ '--fill': `${((value - min) / (max - min)) * 100}%` }) as CSSProperties

  const handleUpload = async (
    kind: 'bg' | 'figure',
    file: File | undefined,
  ): Promise<void> => {
    const isBackground = kind === 'bg'
    const setError = isBackground ? setBgError : setFigureError
    const accept = isBackground ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/png', 'image/webp']
    const budget = isBackground ? SCENE_UPLOAD_BUDGET.backgroundBytes : SCENE_UPLOAD_BUDGET.figureBytes
    const budgetLabel = isBackground ? '8MB' : '4MB'
    const minWidth = isBackground ? SCENE_UPLOAD_BUDGET.minBackgroundWidth : SCENE_UPLOAD_BUDGET.minFigureWidth
    if (file === undefined) return
    setError(null)
    if (!accept.includes(file.type)) {
      setError({
        title: '无法使用该' + (isBackground ? '背景' : '立绘'),
        why: `格式不支持：${file.type || '未知类型'}。仅接受 ${isBackground ? 'JPG / PNG / WebP' : '透明 PNG / WebP（人物层需要透明通道）'}。`,
      })
      return
    }
    if (file.size > budget) {
      setError({
        title: '无法使用该' + (isBackground ? '背景' : '立绘'),
        why: `超出资源预算：${(file.size / 1024 / 1024).toFixed(1)}MB > ${budgetLabel}（规格 §30 尺寸预算）。请压缩后重试。`,
      })
      return
    }
    try {
      const dataUrl = await readAsDataUrl(file)
      const dims = await decodeDimensions(dataUrl)
      if (dims.width < minWidth) {
        setError({
          title: '无法使用该' + (isBackground ? '背景' : '立绘'),
          why: `分辨率过低：${dims.width}×${dims.height}。建议宽度 ≥ ${minWidth}px，否则世界层会明显发糊。`,
        })
        return
      }
      if (!isBackground) {
        // 人物层需要透明通道：整图不透明的立绘会遮住世界层（P2 修订）。
        const transparent = await imageHasTransparency(dataUrl)
        if (transparent === false) {
          setError({
            title: '无法使用该立绘',
            why: '人物层需要透明背景——检测到整图不透明。请提供透明 PNG / WebP。',
          })
          return
        }
      }
      const persistable = isPersistableDataUrl(dataUrl)
      if (isBackground) {
        setBgSessionOnly(!persistable)
        patchProfile((profile) => ({ ...profile, sceneId: 'custom', customBg: dataUrl }))
      } else {
        setFigureSessionOnly(!persistable)
        patchProfile((profile) => ({ ...profile, customFigure: dataUrl }))
      }
    } catch (cause) {
      setError({
        title: '无法使用该' + (isBackground ? '背景' : '立绘'),
        why: (cause as Error).message,
      })
    }
  }

  return (
    <aside
      ref={panelRef}
      className="scene-sheet mat-scene-glass"
      role="dialog"
      aria-label="墨境场景设置"
    >
        <div className="scene-sheet-head">
          <div>
            <div className="kicker">SCENE SYSTEM · 墨境</div>
            <b style={{ fontFamily: 'var(--serif)', fontSize: 15 }}>场景设置（实时预览）</b>
          </div>
          <button type="button" className="quiet-btn" onClick={onClose} data-testid="scene-sheet-close" data-autofocus>
            收起 ✕
          </button>
        </div>

        <div className="scene-sheet-tabs" role="tablist" aria-label="场景设置分区">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              className="scene-sheet-tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="scene-sheet-body">
          {tab === 'scene' && (
            <div>
              <div className="kicker">BUILT-IN SCENE · 内置静态场景</div>
              <div className="scene-opt-grid">
                {BUILT_IN_SCENES.map((scene) => (
                  <button
                    key={scene.id}
                    type="button"
                    className={`scene-opt v-${scene.id}`}
                    aria-pressed={activeProfile.sceneId === scene.id}
                    onClick={() => patchProfile((profile) => withoutCustomBg({ ...profile, sceneId: scene.id }))}
                  >
                    <em>{scene.label}</em>
                  </button>
                ))}
              </div>
              <div className="scene-ctl">
                <div className="lr"><span>上传背景（JPG / PNG / WebP · ≤8MB）</span></div>
                <button type="button" className="btn" style={{ width: '100%' }} onClick={() => bgFileRef.current?.click()}>
                  选择本地图片…
                </button>
                <input
                  ref={bgFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event) => {
                    void handleUpload('bg', event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                {activeProfile.customBg !== undefined && activeProfile.customBg !== '' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <img
                      src={activeProfile.customBg}
                      alt="背景预览"
                      style={{ width: 72, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--hairline-strong)' }}
                    />
                    <span className="mono muted" style={{ fontSize: 10, flex: 1 }}>
                      已应用上传背景{bgSessionOnly ? ' · 图片较大，仅本次会话保留' : ''}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setBgSessionOnly(false)
                        setBgError(null)
                        patchProfile((profile) => withoutCustomBg({ ...profile, sceneId: 'city-night' }))
                      }}
                    >
                      移除
                    </button>
                  </div>
                )}
                {bgError !== null && (
                  <div className="ir-unavailable" style={{ marginTop: 8 }} role="alert">
                    <b style={{ color: 'var(--warning)' }}>{bgError.title}</b>
                    <br />
                    <span>{bgError.why}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'atmosphere' && (
            <div>
              <div className="scene-ctl">
                <div className="lr"><span>背景亮度</span><b>{activeProfile.brightness}%</b></div>
                <input
                  type="range" className="scene-range" min={30} max={130} value={activeProfile.brightness}
                  style={rangeFill(activeProfile.brightness, 30, 130)}
                  onChange={(event) => patchProfile((profile) => ({ ...profile, brightness: Number(event.target.value) }))}
                />
              </div>
              <div className="scene-ctl">
                <div className="lr"><span>背景模糊</span><b>{activeProfile.blur}px</b></div>
                <input
                  type="range" className="scene-range" min={0} max={14} value={activeProfile.blur}
                  style={rangeFill(activeProfile.blur, 0, 14)}
                  onChange={(event) => patchProfile((profile) => ({ ...profile, blur: Number(event.target.value) }))}
                />
              </div>
              <div className="scene-ctl">
                <div className="lr"><span>Shadow veil / 暗幕强度</span><b>{activeProfile.veil.toFixed(2)}</b></div>
                <input
                  type="range" className="scene-range" min={20} max={85} value={Math.round(activeProfile.veil * 100)}
                  style={rangeFill(activeProfile.veil * 100, 20, 85)}
                  onChange={(event) => patchProfile((profile) => ({ ...profile, veil: Number(event.target.value) / 100 }))}
                />
              </div>
              <div className="scene-ctl">
                <div className="lr">
                  <span>Scene focus X / Y（视差焦点）</span>
                  <b>{activeProfile.focusX} / {activeProfile.focusY}</b>
                </div>
                <input
                  type="range" className="scene-range" min={0} max={100} value={activeProfile.focusX}
                  style={rangeFill(activeProfile.focusX, 0, 100)}
                  aria-label="场景焦点 X"
                  onChange={(event) => patchProfile((profile) => ({ ...profile, focusX: Number(event.target.value) }))}
                />
                <input
                  type="range" className="scene-range" min={0} max={100} value={activeProfile.focusY}
                  style={{ ...rangeFill(activeProfile.focusY, 0, 100), marginTop: 6 }}
                  aria-label="场景焦点 Y"
                  onChange={(event) => patchProfile((profile) => ({ ...profile, focusY: Number(event.target.value) }))}
                />
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => patchProfile((profile) => ({ ...profile, focusX: 50, focusY: 38 }))}
                  >
                    重置焦点（50 / 38）
                  </button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
                氛围层只做统一可读性处理：暗幕、暗角、颗粒、焦点。颗粒与装饰层恒 pointer-events:none，不入键盘顺序。
              </p>
            </div>
          )}

          {tab === 'figure' && (
            <div>
              <div className="scene-ctl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>前景人物层</span>
                <button
                  type="button"
                  className="scene-toggle"
                  role="switch"
                  aria-checked={activeProfile.figure.enabled}
                  aria-label="前景人物层开关"
                  data-testid="scene-figure-toggle"
                  onClick={() => patchFigure((figure) => ({ ...figure, enabled: !figure.enabled }))}
                />
              </div>
              <div className="scene-ctl">
                <div className="lr"><span>锚点</span></div>
                <div className="actions">
                  {(['left', 'center', 'right'] as const).map((anchor) => (
                    <button
                      key={anchor}
                      type="button"
                      className="btn"
                      aria-pressed={activeProfile.figure.anchor === anchor}
                      onClick={() => patchFigure((figure) => ({ ...figure, anchor: anchor }))}
                    >
                      {anchor === 'left' ? '左' : anchor === 'center' ? '中' : '右'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="scene-ctl">
                <div className="lr"><span>人物缩放</span><b>{activeProfile.figure.scale.toFixed(2)}×</b></div>
                <input
                  type="range" className="scene-range" min={60} max={160} value={Math.round(activeProfile.figure.scale * 100)}
                  style={rangeFill(activeProfile.figure.scale * 100, 60, 160)}
                  onChange={(event) => patchFigure((figure) => ({ ...figure, scale: Number(event.target.value) / 100 }))}
                />
              </div>
              <div className="scene-ctl">
                <div className="lr"><span>人物透明度</span><b>{activeProfile.figure.opacity.toFixed(2)}</b></div>
                <input
                  type="range" className="scene-range" min={20} max={100} value={Math.round(activeProfile.figure.opacity * 100)}
                  style={rangeFill(activeProfile.figure.opacity * 100, 20, 100)}
                  onChange={(event) => patchFigure((figure) => ({ ...figure, opacity: Number(event.target.value) / 100 }))}
                />
              </div>
              <div className="scene-ctl">
                <div className="lr"><span>上传替换人物（透明 PNG / WebP · ≤4MB）</span></div>
                <button type="button" className="btn" style={{ width: '100%' }} onClick={() => figureFileRef.current?.click()}>
                  选择人物立绘…
                </button>
                <input
                  ref={figureFileRef}
                  type="file"
                  accept="image/png,image/webp"
                  hidden
                  onChange={(event) => {
                    void handleUpload('figure', event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                {activeProfile.customFigure !== undefined && activeProfile.customFigure !== '' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <span className="mono muted" style={{ fontSize: 10, flex: 1 }}>
                      已应用上传人物{figureSessionOnly ? ' · 图片较大，仅本次会话保留' : ''}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setFigureSessionOnly(false)
                        setFigureError(null)
                        patchProfile((profile) => withoutCustomFigure(profile))
                      }}
                    >
                      移除
                    </button>
                  </div>
                )}
                {figureError !== null && (
                  <div className="ir-unavailable" style={{ marginTop: 8 }} role="alert">
                    <b style={{ color: 'var(--warning)' }}>{figureError.title}</b>
                    <br />
                    <span>{figureError.why}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'scope' && (
            <div>
              <div className="scene-ctl">
                <div className="lr"><span>作用域</span></div>
                <div className="actions">
                  <button type="button" className="btn" aria-pressed={scope === 'global'} onClick={() => setScope('global')}>
                    全局默认
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={scope === 'book'}
                    disabled={bookId === null}
                    title={bookId === null ? '尚未建书——先在工作台建书' : undefined}
                    onClick={() => setScope('book')}
                  >
                    当前作品 override
                  </button>
                </div>
              </div>
              <div className="ctl">
                <div className="lr"><span>危险动作（需确认）</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      if (window.confirm('恢复全局默认场景？这将清除全局场景/氛围/人物偏好，只影响界面设置。')) {
                        change({ ...preference, global: { ...DEFAULT_SCENE_PROFILE } })
                      }
                    }}
                  >
                    恢复默认场景（全局）
                  </button>
                </div>
              </div>
              <div className="card" style={{ padding: '10px 12px', marginTop: 6 }}>
                <p className="mono muted" style={{ margin: 0, fontSize: 11 }}>
                  {bookId !== null && overrideExists
                    ? '当前生效：BOOK OVERRIDE'
                    : '当前生效：GLOBAL PROFILE（继承）'}
                </p>
              </div>
              {bookId !== null && (
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!overrideExists}
                    data-testid="scene-clear-override"
                    onClick={() => {
                      if (window.confirm('删除当前作品的场景覆盖并回退全局默认？此操作仅影响界面偏好，不触碰正典与正文。')) {
                        change(clearBookOverride(preference, bookId))
                        setScope('global')
                      }
                    }}
                  >
                    删除作品覆盖（恢复全局）
                  </button>
                </div>
              )}
              <p className="muted" style={{ fontSize: 11, lineHeight: 1.7, marginTop: 12 }}>
                Scene 是界面偏好，不是小说 Canon：任何改动不触碰正典、正文、Receipt、Pipeline 状态。云同步未上线，不宣称 Scene 已云同步。切书时自动切换对应 Profile。
              </p>
            </div>
          )}
        </div>
      </aside>
  )
}
