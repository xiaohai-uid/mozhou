/**
 * 朗读控件：接入编辑器顶栏（对标 legado 朗读 / readest TTS）。
 * 状态机：unsupported 显式禁用（不假装可用）→ idle → playing ⇄ paused。
 */
import React from 'react'
import { useTts } from './useTts'

const BTN =
  'text-xs px-2.5 py-1 text-zinc-300 hover:text-zinc-100 bg-zinc-800/60 hover:bg-zinc-700/80 rounded border border-zinc-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

export const TtsControl: React.FC<{ text: string }> = ({ text }) => {
  const { state, speak, pause, resume, stop } = useTts()

  if (state === 'unsupported') {
    return (
      <button type="button" className={BTN} disabled title="当前环境不支持语音朗读（浏览器未提供 speechSynthesis）" data-testid="tts-unsupported">
        🔊 朗读
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="tts-control">
      {state === 'playing' ? (
        <button type="button" className={BTN} onClick={pause} data-testid="tts-pause" title="暂停朗读">
          ⏸ 暂停
        </button>
      ) : (
        <button
          type="button"
          className={BTN}
          onClick={() => (state === 'paused' ? resume() : speak(text))}
          data-testid="tts-play"
          title={state === 'paused' ? '继续朗读' : '朗读本章正文（浏览器语音合成）'}
        >
          🔊 {state === 'paused' ? '继续' : '朗读本章'}
        </button>
      )}
      {state !== 'idle' && (
        <button type="button" className={BTN} onClick={stop} data-testid="tts-stop" title="停止朗读">
          ⏹ 停止
        </button>
      )}
    </span>
  )
}
