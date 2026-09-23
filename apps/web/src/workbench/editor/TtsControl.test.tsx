/**
 * 朗读控件测试：
 * - 无 speechSynthesis 环境：显式 unsupported 禁用（不假装可用）；
 * - 有支持：朗读本章调用 speak 且正文完整传入、zh-CN 语音、暂停/停止状态机。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TtsControl } from './TtsControl'

class FakeUtterance {
  text: string
  lang = ''
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

function makeSynth() {
  return {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => [{ lang: 'zh-CN', name: '测试语音' }]),
  }
}

const originalSpeech = (globalThis as Record<string, unknown>)['speechSynthesis']
const originalUtterance = (globalThis as Record<string, unknown>)['SpeechSynthesisUtterance']

afterEach(() => {
  const g = globalThis as Record<string, unknown>
  if (originalSpeech === undefined) delete g['speechSynthesis']
  else g['speechSynthesis'] = originalSpeech
  if (originalUtterance === undefined) delete g['SpeechSynthesisUtterance']
  else g['SpeechSynthesisUtterance'] = originalUtterance
  vi.restoreAllMocks()
})

describe('TtsControl', () => {
  it('环境不支持：按钮禁用且不假装可用', () => {
    render(<TtsControl text="正文" />)
    expect(screen.getByTestId('tts-unsupported')).toBeDisabled()
  })

  it('点击朗读：正文完整传入语音合成并进入播放态', async () => {
    const synth = makeSynth()
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)

    const user = userEvent.setup()
    render(<TtsControl text="江水初涨，渡口无人。" />)
    await user.click(screen.getByTestId('tts-play'))

    expect(synth.speak).toHaveBeenCalledTimes(1)
    const utter = synth.speak.mock.calls[0]?.[0] as FakeUtterance
    expect(utter.text).toBe('江水初涨，渡口无人。')
    expect(utter.lang).toBe('zh-CN')
    expect(screen.getByTestId('tts-pause')).toBeInTheDocument()
    expect(screen.getByTestId('tts-stop')).toBeInTheDocument()
  })

  it('播放态暂停、停止回到朗读态', async () => {
    const synth = makeSynth()
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)

    const user = userEvent.setup()
    render(<TtsControl text="正文" />)
    await user.click(screen.getByTestId('tts-play'))
    await user.click(screen.getByTestId('tts-pause'))
    expect(synth.pause).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('tts-play')).toHaveTextContent('继续')

    await user.click(screen.getByTestId('tts-stop'))
    expect(synth.cancel).toHaveBeenCalled()
    expect(screen.getByTestId('tts-play')).toHaveTextContent('朗读本章')
  })
})
