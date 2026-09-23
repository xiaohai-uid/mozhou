/**
 * 章节朗读（TTS）hook — 对标 legado / readest / koodo-reader 的朗读能力。
 * 使用浏览器原生 speechSynthesis（无新增依赖）；不支持的环境降级为 unsupported 显式态。
 */
import { useCallback, useEffect, useState } from 'react'

export type TtsState = 'unsupported' | 'idle' | 'playing' | 'paused'

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function useTts(): {
  state: TtsState
  speak: (text: string) => void
  pause: () => void
  resume: () => void
  stop: () => void
} {
  const [state, setState] = useState<TtsState>(() => (supported() ? 'idle' : 'unsupported'))

  // 组件卸载（切章/关书）时停声，避免朗读越过当前章节继续。
  useEffect(() => {
    return () => {
      if (supported()) window.speechSynthesis.cancel()
    }
  }, [])

  const speak = useCallback((text: string) => {
    if (!supported()) return
    const synth = window.speechSynthesis
    synth.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    const zhVoice = synth.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('zh'))
    if (zhVoice !== undefined) utter.voice = zhVoice
    utter.onend = () => setState('idle')
    utter.onerror = () => setState('idle')
    synth.speak(utter)
    setState('playing')
  }, [])

  const pause = useCallback(() => {
    if (!supported()) return
    window.speechSynthesis.pause()
    setState('paused')
  }, [])

  const resume = useCallback(() => {
    if (!supported()) return
    window.speechSynthesis.resume()
    setState('playing')
  }, [])

  const stop = useCallback(() => {
    if (!supported()) return
    window.speechSynthesis.cancel()
    setState('idle')
  }, [])

  return { state, speak, pause, resume, stop }
}
