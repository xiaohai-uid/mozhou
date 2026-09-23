/**
 * Scene System 背景层（ADR-0028 · 规格 §3/§4）：
 * L0 场景图（内置 CSS 画/上传图）→ L1 氛围（暗角+颗粒）→ L2 暗幕+前景人物。
 * 装饰层全部 pointer-events:none、不入键盘序；人物与背景独立、可换可关；
 * 正文可读区由 Reading Slate/面板自身遮蔽达成 ≈90–96% 视觉保护。
 */
import type { CSSProperties } from 'react'
import type { SceneProfile } from './scenePreference'

export function SceneLayer({ profile, focus = 0.5 }: { profile: SceneProfile; focus?: number }): JSX.Element {
  const uploadedBg = profile.customBg !== undefined && profile.customBg !== ''
  const focusX = Math.max(0, Math.min(100, profile.focusX + (focus - 0.5) * 8))
  const layerStyle: CSSProperties = {
    filter: `brightness(${profile.brightness}%) blur(${profile.blur}px)`,
    backgroundPosition: `${focusX}% ${profile.focusY}%`,
    ...(uploadedBg ? { backgroundImage: `url(${profile.customBg})` } : {}),
  }
  const figure = profile.figure
  return (
    <>
      <div
        className={
          'scene-layer ' + (uploadedBg ? 'has-upload ' : '') + `v-${profile.sceneId}`
        }
        style={layerStyle}
        aria-hidden="true"
      />
      <div className="scene-atmosphere" aria-hidden="true" />
      <div className="scene-veil" style={{ '--scene-veil': profile.veil } as CSSProperties} aria-hidden="true" />
      {figure.enabled && (
        <div
          className={`scene-figure pos-${figure.anchor}`}
          style={{ '--scene-figure-opacity': figure.opacity } as CSSProperties}
          aria-hidden="true"
        >
          <div
            className="sil"
            style={{
              transform: `scale(${figure.scale})`,
              // 上传立绘替换占位剪影：豁免剪影的 mask/圆角，保留透明通道原形（P2 修订）。
              ...(profile.customFigure !== undefined && profile.customFigure !== ''
                ? {
                    backgroundImage: `url(${profile.customFigure})`,
                    WebkitMaskImage: 'none',
                    maskImage: 'none',
                  }
                : {}),
            }}
          />
        </div>
      )}
    </>
  )
}
