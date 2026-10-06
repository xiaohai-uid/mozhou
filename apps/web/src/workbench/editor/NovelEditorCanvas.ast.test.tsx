/**
 * NovelEditorCanvas AST 化组件测试（CHG-20261006-02 同变新增）。
 *
 * 验收锚点：
 * - 旧 textarea 草稿无损打开（渲染后正文纯文本契约不变，场景节点真实呈现）；
 * - 选区不漂移（setSelection 走真实 PM transaction，onSelectionChange 的
 *   UTF-16 偏移与所选原文逐字一致）；
 * - replaceRange 局部替换走字符串切片语义（区间外逐字节不变），可撤销（undo 恢复原文）；
 * - 中文输入即时回写 Active Draft 契约（onChange 纯文本）。
 */
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NovelEditorCanvas } from './NovelEditorCanvas'
import type { NovelEditorCanvasHandle } from './NovelEditorCanvas'

// jsdom 未实现 document.elementFromPoint（PM posAtCoords 依赖）——点击定位走空兜底。
beforeAll(() => {
  document.elementFromPoint = (): Element | null => null
})

const DRAFT = '　　夜雨敲窗，灯焰摇了三摇。\n***\n　　他推门而入，风雪灌满衣襟。'

function setup(value = DRAFT) {
  const onChange = vi.fn()
  const onSelectionChange = vi.fn()
  const ref = createRef<NovelEditorCanvasHandle>()
  const view = render(
    <NovelEditorCanvas
      ref={ref}
      value={value}
      onChange={onChange}
      onSelectionChange={onSelectionChange}
    />,
  )
  return { onChange, onSelectionChange, ref, view }
}

async function waitEditor(view: ReturnType<typeof render>): Promise<HTMLElement> {
  const editorEl = await waitFor(() => {
    const el = view.container.querySelector<HTMLElement>('[role="textbox"]')
    if (el === null) throw new Error('editor not ready')
    return el
  })
  return editorEl
}

describe('NovelEditorCanvas · AST 化', () => {
  it('旧 textarea 草稿无损打开：场景切分行呈现为场景节点，正文契约不变', async () => {
    const { view } = setup()
    const editorEl = await waitEditor(view)
    // 场景切分行 = 真 ProseMirror 场景节点（atom），DOM 带标注
    const sceneBreak = editorEl.querySelector('[data-scene-break]')
    expect(sceneBreak).not.toBeNull()
    expect(sceneBreak!.getAttribute('data-marker')).toBe('***')
    // 段落文本原样呈现（含全角缩进——round-trip 无损）
    expect(editorEl.textContent).toContain('　　夜雨敲窗，灯焰摇了三摇。')
    expect(editorEl.textContent).toContain('　　他推门而入，风雪灌满衣襟。')
  })

  it('中文输入即时回写：onChange 收到含新字的纯文本（Active Draft 契约）', async () => {
    const { onChange, view } = setup('　　开头一句。')
    const editorEl = await waitEditor(view)
    // jsdom 无浏览器默认输入行为：直接改 DOM，由 PM 的 DOMObserver 捕获变更生成
    // transaction（与真实 IME 提交后的 DOM 落字同路径）。
    editorEl.innerHTML = '<p>　　开头一句。钟声响了</p>'
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as string | undefined
      expect(last).toBe('　　开头一句。钟声响了')
    })
  })

  it('setSelection → onSelectionChange：UTF-16 偏移与所选原文逐字一致（选区不漂移）', async () => {
    const { onSelectionChange, ref, view } = setup()
    await waitEditor(view)
    // '　　夜雨敲窗，灯焰摇了三摇。\n***\n...' 选中「夜雨敲窗」= 文本偏移 [2, 6)
    ref.current!.setSelection(2, 6)
    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith({ from: 2, to: 6, selectedText: '夜雨敲窗' })
    })
  })

  it('replaceRange 走字符串切片语义（跨场景块替换不破坏其余行），undo 恢复原文', async () => {
    const { onChange, ref, view } = setup()
    await waitEditor(view)
    const value = DRAFT
    // 把 '***' 场景行（文本偏移 [15, 18)）替换为 '---'：区间外逐字节不变
    const from = value.indexOf('***')
    const to = from + 3
    ref.current!.replaceRange(from, to, '---')
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as string | undefined
      expect(last).toBe(value.slice(0, from) + '---' + value.slice(to))
    })
    // 撤销：Accept 可撤销（显式 undo 入口，等效 Mod-Z 走同一 PM history）
    ref.current!.undo()
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as string | undefined
      expect(last).toBe(value)
    })
  })

  it('onChange 回写后不再触发二次同步（受控环无死循环）', async () => {
    const { onChange, ref, view } = setup('　　单段。')
    await waitEditor(view)
    ref.current!.replaceRange(4, 4, '插入') // 纯插入
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as string | undefined
      expect(last).toBe('　　单段插入。')
    })
    const count = onChange.mock.calls.length
    await new Promise((r) => setTimeout(r, 50))
    expect(onChange.mock.calls.length).toBe(count) // 值同步 effect 不回写
  })

  it('一键网文排版：首行全角双空格缩进与对白直双引号归一化（FR-1.1）', () => {
    const raw = '他说道："今夜必有风雪。"\n"那就战吧！"她拔出了剑。'
    const { onChange, view } = setup(raw)
    const btn = view.getByRole('button', { name: '一键网文排版' })
    userEvent.setup()
    btn.click()
    expect(onChange).toHaveBeenCalledWith('　　他说道：“今夜必有风雪。”\n　　“那就战吧！”她拔出了剑。')
  })
})
