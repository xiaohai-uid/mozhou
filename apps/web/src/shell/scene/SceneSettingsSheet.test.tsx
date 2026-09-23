/**
 * Scene System 测试（ADR-0028）：Scene 是本地 UI preference（不是 Canon）——
 * 偏好持久化/按书 override/回退语义、Sheet 的四分区交互与上传校验错误路径
 * （格式/预算）、人物层开关。图片解码路径依赖真实 Image 解码，浏览器验收覆盖。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneLayer } from './SceneLayer'
import { SceneSettingsSheet } from './SceneSettingsSheet'
import {
  DEFAULT_SCENE_PROFILE,
  SCENE_STORAGE_KEY,
  clearBookOverride,
  loadScenePreference,
  resolveSceneProfile,
  saveScenePreference,
  updateScopedProfile,
} from './scenePreference'
import type { ScenePreference } from './scenePreference'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const BOOK = { root: 'C:/tmp/b', bookId: 'book-1', title: '潮汐之上' }

describe('scenePreference（本地 UI 偏好，非 Canon）', () => {
  it('默认偏好：全局 profile + 空书覆盖；无存储时静默回退', () => {
    const preference = loadScenePreference()
    expect(preference.version).toBe(1)
    expect(preference.global).toEqual(DEFAULT_SCENE_PROFILE)
    expect(preference.books).toEqual({})
  })

  it('保存后可还原；损坏 JSON 静默回退默认', () => {
    const preference: ScenePreference = {
      version: 1,
      global: { ...DEFAULT_SCENE_PROFILE, veil: 0.7 },
      books: { 'book-1': { ...DEFAULT_SCENE_PROFILE, sceneId: 'library' } },
    }
    saveScenePreference(preference)
    expect(loadScenePreference().global.veil).toBe(0.7)
    expect(loadScenePreference().books['book-1']?.sceneId).toBe('library')

    window.localStorage.setItem(SCENE_STORAGE_KEY, '{broken json')
    expect(loadScenePreference().global).toEqual(DEFAULT_SCENE_PROFILE)
  })

  it('解析语义：无书用 global；有书无 override 继承 global；有书有 override 用 override', () => {
    const preference: ScenePreference = {
      version: 1,
      global: { ...DEFAULT_SCENE_PROFILE, sceneId: 'city-night' },
      books: { 'book-1': { ...DEFAULT_SCENE_PROFILE, sceneId: 'library' } },
    }
    expect(resolveSceneProfile(preference, null).sceneId).toBe('city-night')
    expect(resolveSceneProfile(preference, 'book-1').sceneId).toBe('library')
    expect(resolveSceneProfile(preference, 'book-2').sceneId).toBe('city-night')
  })

  it('作用域更新：book scope 写 override（从 global 复制起步）；clear 回退', () => {
    const initial: ScenePreference = { version: 1, global: { ...DEFAULT_SCENE_PROFILE }, books: {} }
    const updated = updateScopedProfile(initial, 'book-1', 'book', (profile) => ({ ...profile, blur: 6 }))
    expect(updated.books['book-1']?.blur).toBe(6)
    expect(updated.global.blur).toBe(DEFAULT_SCENE_PROFILE.blur)

    const cleared = clearBookOverride(updated, 'book-1')
    expect(cleared.books['book-1']).toBeUndefined()
  })
})

describe('SceneLayer（L0 场景 / L1 氛围 / L2 暗幕+人物）', () => {
  it('默认渲染：场景层 + 氛围 + 暗幕；装饰层不入键盘序；figure 默认关闭（银白方向）', () => {
    const { container } = render(<SceneLayer profile={DEFAULT_SCENE_PROFILE} />)
    expect(container.querySelector('.scene-layer')).not.toBeNull()
    expect(container.querySelector('.scene-atmosphere')).not.toBeNull()
    expect(container.querySelector('.scene-veil')).not.toBeNull()
    expect(container.querySelector('.scene-figure')).toBeNull() // ADR-0029 默认无前景人物
    for (const element of Array.from(container.querySelectorAll('div'))) {
      expect(element.getAttribute('tabindex')).toBeNull()
    }
    const withFigure = { ...DEFAULT_SCENE_PROFILE, figure: { ...DEFAULT_SCENE_PROFILE.figure, enabled: true } }
    const { container: shown } = render(<SceneLayer profile={withFigure} />)
    expect(shown.querySelector('.scene-figure')).not.toBeNull()
  })

  it('人物关闭：不渲染 figure；上传背景：has-upload 且背景图内联', () => {
    const noFigure = { ...DEFAULT_SCENE_PROFILE, figure: { ...DEFAULT_SCENE_PROFILE.figure, enabled: false } }
    const { container: hidden } = render(<SceneLayer profile={noFigure} />)
    expect(hidden.querySelector('.scene-figure')).toBeNull()

    const uploaded = { ...DEFAULT_SCENE_PROFILE, sceneId: 'custom' as const, customBg: 'data:image/png;base64,xyz' }
    const { container: withUpload } = render(<SceneLayer profile={uploaded} />)
    const layer = withUpload.querySelector('.scene-layer')
    expect(layer?.className).toContain('has-upload')
    expect(layer?.getAttribute('style')).toContain('data:image/png;base64,xyz')
  })
})

describe('SceneSettingsSheet（四分区 · 上传校验 · 作用域）', () => {
  function firstPayload(onChange: ReturnType<typeof vi.fn>): ScenePreference {
    const call = onChange.mock.calls[0]
    if (call === undefined) throw new Error('onChange 未被调用')
    return call[0] as ScenePreference
  }

  function setup(preference?: ScenePreference) {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <SceneSettingsSheet
        preference={preference ?? { version: 1, global: { ...DEFAULT_SCENE_PROFILE }, books: {} }}
        book={BOOK}
        onChange={onChange}
        onClose={onClose}
      />,
    )
    return { onChange, onClose }
  }

  it('四分区 tab 渲染 + Escape 关闭', () => {
    const { onClose } = setup()
    for (const label of ['场景', '氛围', '人物', '作用域']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('人物层开关：点击翻转 enabled 并上报 onChange', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('tab', { name: '人物' }))
    fireEvent.click(screen.getByTestId('scene-figure-toggle'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = firstPayload(onChange)
    expect(next.global.figure.enabled).toBe(true) // 银白默认关闭 → 点击开启
  })

  it('上传校验：非白名单格式 → 显式错误且不改偏好', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('tab', { name: '场景' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([71, 73, 70])], 'x.gif', { type: 'image/gif' })] },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('格式不支持')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('上传校验：超出尺寸预算 → 显式错误且不改偏好', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('tab', { name: '场景' }))
    const bigBytes = new Uint8Array(9 * 1024 * 1024)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File([bigBytes], 'big.png', { type: 'image/png' })] },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('超出资源预算')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('作用域：book override 下编辑写入 books；覆盖存在时删除按钮可用', () => {
    const preference: ScenePreference = {
      version: 1,
      global: { ...DEFAULT_SCENE_PROFILE },
      books: { 'book-1': { ...DEFAULT_SCENE_PROFILE, blur: 6 } },
    }
    const { onChange } = setup(preference)
    fireEvent.click(screen.getByRole('tab', { name: '氛围' }))
    // 作用域默认：已有 override 的书落在 book scope
    const brightnessSlider = screen.getAllByRole('slider')[0]
    if (brightnessSlider === undefined) throw new Error('missing brightness slider')
    fireEvent.change(brightnessSlider, { target: { value: '120' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = firstPayload(onChange)
    expect(next.books['book-1']?.brightness).toBe(120)
    expect(next.global.brightness).toBe(DEFAULT_SCENE_PROFILE.brightness)

    fireEvent.click(screen.getByRole('tab', { name: '作用域' }))
    expect(screen.getByTestId('scene-clear-override')).toBeEnabled()
  })

  it('无覆盖时删除按钮禁用（诚实空态）', () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: '作用域' }))
    expect(screen.getByTestId('scene-clear-override')).toBeDisabled()
  })
})
