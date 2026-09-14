/**
 * 漫剧分镜视图测试（T04 · 组件级，mock HTTP）：
 * - 无书空态；有书加载章节与源快照；
 * - 生成候选 → 镜头卡呈现画面/对白/时长/提示词（正反面）；
 * - 编辑对白 → 显式保存 payload 携带 expectedRevision:null → 成功提示 r1；
 * - 409 冲突：本地编辑文本不丢 + 冲突横幅出现；
 * - 导出 Markdown/JSON 内容完整；导出 JSON 可被导入按钮重新读入工作区；
 * - 切书（key 重挂载）后晚到的生成响应不应用到新书视图。
 * 真实模型/E2E 不在本文件范围（无 provider 环境，见 server 侧 generate.test）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoryboardView } from './StoryboardView'
import { okJson } from '../test/http'
import type { BookInfo } from '../shell/workbenchStorage'
import type { StoryboardDocument } from './types'

const BOOK_A: BookInfo = { root: 'C:/tmp/book-a', bookId: 'book_aaaa', title: '雾港失真' }
const BOOK_B: BookInfo = { root: 'C:/tmp/book-b', bookId: 'book_bbbb', title: '深巷回声' }

const SOURCE = {
  bookId: 'book_aaaa',
  chapterIndex: 1,
  revision: 3,
  phase: 'draft' as const,
  sha256: 'a'.repeat(64),
}

function candidateDoc(overrides: Record<string, unknown> = {}): StoryboardDocument {
  return {
    schemaVersion: 1,
    id: 'sb_01JBGZ000000000000000000AA',
    revision: 0,
    title: '灯塔夜谈（候选）',
    characters: [{ id: 'cheng_wei', name: '程蔚', appearance: '短发记者', origin: 'source' }],
    shots: [
      {
        id: 'shot_01', sceneId: 'scene_01', order: 1, location: '灯塔脚下', timeOfDay: '夜',
        framing: 'wide', cameraMovement: 'slow push-in',
        visual: '浓雾漫上礁石，灯塔黑影立于雾线之上',
        characterIds: ['cheng_wei'],
        dialogue: [{ speakerId: 'cheng_wei', text: '你听，潮水退下去的声音。' }],
        narration: '', sound: '退潮卵石声',
        estimatedDurationSeconds: 6, imagePrompt: 'wide lighthouse fog',
        videoPrompt: 'push in', negativePrompt: 'text',
        sourceQuote: '雾从灯塔脚下漫上来', origin: 'source', adaptationNote: '开场定调',
      },
    ],
    warnings: [],
    source: SOURCE,
    options: { aspectRatio: '9:16', targetDurationSeconds: 90, visualStyle: '银白冷调', language: 'zh-CN' },
    totalEstimatedDurationSeconds: 6,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    generation: { provider: 'openai-compatible', model: 'test-model' },
    ...overrides,
  } as StoryboardDocument
}

function routeFetch(routes: Record<string, (body: Record<string, unknown>) => Response | Promise<Response>>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const path = url.startsWith('http') ? new URL(url).pathname : url
    const handler = routes[path]
    if (handler === undefined) throw new Error('unexpected fetch: ' + path)
    const body = init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    return await handler(body)
  })
}

function savedDoc(): StoryboardDocument {
  return candidateDoc({ revision: 2, id: 'sb_01JBGZ000000000000000000BB' })
}

/** jsdom Blob 无 text()：用 FileReader 读全文。 */
async function blobText(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('StoryboardView（T04 闭环）', () => {
  it('无书 → 显式空态引导建书', () => {
    vi.stubGlobal('fetch', routeFetch({}))
    render(<StoryboardView book={null} />)
    expect(screen.getByTestId('storyboard-empty')).toBeTruthy()
  })

  it('生成候选 → 镜头卡呈现画面/对白/时长/提示词；背面含原文锚与改编说明', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: '雾从灯塔脚下漫上来…' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      throw new Error('unexpected fetch: ' + path)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<StoryboardView book={BOOK_A} />)

    await waitFor(() => expect(screen.getByTestId('sb-source-info')).toBeTruthy())
    await user.click(screen.getByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())
    // U04 默认工作视图：单镜编辑器 + 场景分组序列
    expect((screen.getByTestId('sb-f-visual') as HTMLInputElement).value).toContain('浓雾漫上礁石')
    expect(screen.getByTestId('sb-seq-1')).toBeTruthy()
    expect(screen.getByTestId('sb-tab-source')).toBeTruthy()
    // 切卡片视图：原文锚/背面等卡面元素
    await user.click(screen.getByTestId('sb-view-cards'))
    expect(screen.getByText(/浓雾漫上礁石/)).toBeTruthy()
    expect(screen.getByText(/潮水退下去的声音/)).toBeTruthy()
    expect(screen.getByText(/约6s/)).toBeTruthy()
    // 提示词在背面（显式翻面可见）
    expect(screen.queryByText(/wide lighthouse fog/)).toBeNull()
    await user.click(screen.getByRole('button', { name: '背面' }))
    expect(screen.getByText(/wide lighthouse fog/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(5) // works/capabilities/source/storyboards/generate
  })

  it('U07 景别中文主显示：标题无裸英文代号，英文收进 title；景别下拉全中文', async () => {    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())

    // 工作视图镜头标题：中文景别 + 英文入 title（候选镜头 framing=wide）
    const titleEl = screen.getByTitle('景别 wide')
    expect(titleEl.textContent).toBe('大远景')
    const head = titleEl.closest('.sb-shot-title')
    expect(head?.textContent).not.toMatch(/wide|medium|close|detail/)

    // 卡片视图标题同样中文
    await user.click(screen.getByTestId('sb-view-cards'))
    const cardTitle = screen.getByTitle('景别 wide')
    expect(cardTitle.textContent).toBe('大远景')

    // 景别下拉（卡片编辑面板）选项全中文（value 仍是数据代号，不属界面文案）
    await user.click(screen.getByRole('button', { name: '编辑' }))
    const framingSelect = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'wide'))
    expect(framingSelect).not.toBeNull()
    for (const opt of framingSelect!.options) {
      expect(opt.textContent).not.toMatch(/wide|medium|close|detail/)
      expect(['大远景', '中景', '特写', '细节']).toContain(opt.textContent)
    }
  })

  it('U04 原文对照并排（sb-duo）：引文与编辑框同面板，编辑与「改编说明」标签同源同步', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())

    await user.click(screen.getByTestId('sb-tab-source'))
    const panel = screen.getByTestId('sb-panel-source')
    // 同一面板内：原文引文（左）+ 编辑框（右）
    expect(panel.textContent).toContain('原文锚')
    const duoArea = screen.getByLabelText('改编说明（并排编辑）') as HTMLTextAreaElement
    await user.type(duoArea, '台词前置制造张力')
    expect(duoArea.value).toBe('开场定调台词前置制造张力') // fixture 原值「开场定调」+ 追加

    // 与「改编说明」标签同一状态源：切换后值一致
    await user.click(screen.getByTestId('sb-tab-adapt'))
    expect((screen.getByLabelText('改编说明') as HTMLInputElement).value).toBe('开场定调台词前置制造张力')
  })

  it('编辑对白后显式保存：payload expectedRevision=null、服务端返回 r1；文本全程不被清空', async () => {
    const user = userEvent.setup()
    let savedPayload: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      if (path === '/api/storyboard.save') {
        savedPayload = init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        return okJson({ ok: true, id: 'sb_01JBGZ000000000000000000AA', revision: 1, sourceStale: false })
      }
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())

    await user.click(screen.getByTestId('sb-view-cards'))
    await user.click(screen.getByRole('button', { name: '编辑' }))
    const lineInput = screen.getByDisplayValue('你听，潮水退下去的声音。') as HTMLInputElement
    await user.clear(lineInput)
    await user.type(lineInput, '听，潮声和二十年前一样。')
    expect((screen.getByDisplayValue(/听，潮声和二十年前一样/) as HTMLInputElement).value).toBe('听，潮声和二十年前一样。')

    await user.click(screen.getByTestId('sb-save'))
    await waitFor(() => expect(screen.getByTestId('sb-notice')).toHaveTextContent('已保存 r1'))
    expect(savedPayload).not.toBeNull()
    const expected = (savedPayload as unknown as Record<string, unknown>)['expectedRevision']
    expect(expected).toBeNull()
    // 保存成功后编辑文本仍在（错误/保存路径都不清空用户文本）
    expect((screen.getByDisplayValue(/听，潮声和二十年前一样/) as HTMLInputElement).value).toBe('听，潮声和二十年前一样。')
  })

  it('409 冲突：本地编辑保留 + 冲突横幅；不静默覆盖', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      if (path === '/api/storyboard.save') {
        return new Response(JSON.stringify({ ok: false, code: 'STORYBOARD_REVISION_CONFLICT', error: 'revision 冲突', storedRevision: 5 }), { status: 409 })
      }
      if (path === '/api/storyboard') return okJson({ ok: true, document: savedDoc(), sourceStale: false })
      throw new Error('unexpected fetch: ' + path)
    }))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())

    await user.click(screen.getByTestId('sb-view-cards'))
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.type(screen.getByDisplayValue('你听，潮水退下去的声音。'), '（作者补充）')
    await user.click(screen.getByTestId('sb-save'))
    await waitFor(() => expect(screen.getByTestId('sb-conflict')).toBeTruthy())
    // 本地编辑原样保留
    expect((screen.getByDisplayValue(/（作者补充）/) as HTMLInputElement).value).toContain('（作者补充）')
    expect(confirmSpy).not.toHaveBeenCalled() // 冲突不需要确认框——横幅给显式取舍
  })

  it('导出 JSON 可被「导入 JSON」重新读入工作区；Markdown 含画面/对白/时长/提示词', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true) // 生成后候选为 dirty：导入替换需确认（U06）
    let captured: { blob: Blob; name: string } | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [{ id: 'sb_01JBGZ000000000000000000BB', title: '灯塔夜谈（候选）', revision: 2, sourceStale: false, updatedAt: '2026-09-13T01:00:00.000Z' }], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      if (path === '/api/storyboard') return okJson({ ok: true, document: savedDoc(), sourceStale: false })
      throw new Error('unexpected fetch: ' + path)
    }))
    // jsdom 无 createObjectURL：先补再 spy
    const urlCtor = URL as unknown as Record<string, unknown>
    if (typeof urlCtor['createObjectURL'] !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true, writable: true })
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true, writable: true })
    }
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      captured = { blob: blob as Blob, name: 'captured' }
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())

    // Markdown 导出
    await user.click(screen.getByTestId('sb-export-md'))
    await waitFor(() => expect(captured).not.toBeNull())
    const md = await blobText((captured as unknown as { blob: Blob }).blob)
    expect(md).toContain('### 镜头 1')
    expect(md).toContain('浓雾漫上礁石')
    expect(md).toContain('对白 程蔚')
    expect(md).toContain('约 6s（估计）')
    expect(md).toContain('wide lighthouse fog')
    expect(md).toContain('原文（引：雾从灯塔脚下漫上来）')

    // JSON 导出 → 导入回工作区
    captured = null
    await user.click(screen.getByTestId('sb-export-json'))
    await waitFor(() => expect(captured).not.toBeNull())
    const jsonText = await blobText((captured as unknown as { blob: Blob }).blob)
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    expect(parsed['id']).toBe('sb_01JBGZ000000000000000000AA')

    const file = new File([jsonText], 'export.json', { type: 'application/json' })
    const input = screen.getByText('导入 JSON').querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)
    await waitFor(() => expect(screen.getByTestId('sb-notice')).toHaveTextContent('JSON 已导入工作区'))
    expect(screen.getByTestId('sb-shots')).toBeTruthy()
  })

  it('切书（key 重挂载）：晚到的生成响应不应用到新书视图', async () => {
    let resolveGen: ((res: Response) => void) | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') {
        return await new Promise<Response>((resolve) => { resolveGen = resolve })
      }
      throw new Error('unexpected fetch: ' + path)
    }))
    const { rerender } = render(<StoryboardView key={BOOK_A.root} book={BOOK_A} />)
    const generateBtn = await screen.findByTestId('sb-generate')
    void userEvent.setup().click(generateBtn)
    await waitFor(() => expect(resolveGen).not.toBeNull())

    // 切书：App 以 key 重挂载 —— 旧组件卸载，其 aliveRef=false
    rerender(<StoryboardView key={BOOK_B.root} book={BOOK_B} />)
    expect(screen.queryByTestId('sb-shots')).toBeNull()
    expect(screen.queryByText(/雾港失真/)).toBeNull()

    // 晚到响应落地：旧实例已卸载，不得渲染任何镜头到当前（B 书）视图
    ;(resolveGen as unknown as (res: Response) => void)(okJson({ ok: true, candidate: candidateDoc() }))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('sb-shots')).toBeNull()
    expect(screen.getAllByTestId('storyboard-root').length).toBe(1) // 只剩 B 书实例
  })

  it('打开已保存版本：stale 如实标注', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [{ id: 'sb_01JBGZ000000000000000000BB', title: '灯塔夜谈（旧版）', revision: 2, sourceStale: true, updatedAt: '2026-09-13T01:00:00.000Z' }], skippedInvalid: 0 })
      if (path === '/api/storyboard') return okJson({ ok: true, document: savedDoc(), sourceStale: true })
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await waitFor(() => expect(screen.getByText('灯塔夜谈（旧版）')).toBeTruthy())
    expect(screen.getByText('源已变更')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '打开' }))
    await waitFor(() => expect(screen.getByTestId('sb-notice')).toHaveTextContent('源章节在保存后已被修改'))
    expect(screen.getByTestId('sb-shots')).toBeTruthy()
  })
})

/* R1/R2 复核票回归（review-20260914）：探针缺陷的产品级回归 asserting 正确行为。 */
describe('StoryboardView（R1/R2 保存链路）', () => {
  /** R1 验收：B 打开 r1 → A 存 r2 → B 收 409 且文本保留 → B 显式以 r2 重试 → 落盘 r3 含 B 文本。 */
  it('409 冲突读 document.revision；显式重试发送 expectedRevision=服务器 revision', async () => {
    const user = userEvent.setup()
    const saveBodies: Array<Record<string, unknown>> = []
    let saveCalls = 0
    let currentServerRevision = 1
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      if (path === '/api/storyboard.save') {
        saveCalls += 1
        saveBodies.push(init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {})
        if (saveCalls === 1) {
          currentServerRevision = 2 // 模拟客户端 A 抢先存了 r2
          return new Response(JSON.stringify({ ok: false, code: 'STORYBOARD_REVISION_CONFLICT', error: 'revision 冲突', storedRevision: 2 }), { status: 409 })
        }
        currentServerRevision = 3
        return okJson({ ok: true, id: 'sb_01JBGZ000000000000000000AA', revision: 3, sourceStale: false })
      }
      if (path === '/api/storyboard') {
        return okJson({ ok: true, document: candidateDoc({ revision: currentServerRevision }), sourceStale: false })
      }
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())
    await user.click(screen.getByTestId('sb-view-cards'))
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.type(screen.getByDisplayValue('你听，潮水退下去的声音。'), '（B的补充）')

    await user.click(screen.getByTestId('sb-save'))
    const conflict = await screen.findByTestId('sb-conflict')
    expect(conflict).toHaveTextContent('服务器为 r2') // R1：读 document.revision，非 undefined
    expect((screen.getByDisplayValue(/（B的补充）/) as HTMLInputElement).value).toContain('（B的补充）')

    await user.click(screen.getByTestId('sb-conflict-retry'))
    await waitFor(() => expect(screen.getByTestId('sb-notice')).toHaveTextContent('已保存 r3'))
    expect(saveBodies[1]?.['expectedRevision']).toBe(2) // R1：显式基线=服务器 revision，非陈旧闭包的 1
    expect((screen.getByDisplayValue(/（B的补充）/) as HTMLInputElement).value).toContain('（B的补充）')
  })

  /** R2 验收：保存响应延迟期间的新编辑不被覆盖、不被标记已保存。 */
  it('保存进行中的编辑：成功后文本保留且保持 dirty', async () => {
    const user = userEvent.setup()
    let finishSave: ((res: Response) => void) | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      if (path === '/api/storyboard.save') {
        return await new Promise<Response>((resolve) => { finishSave = resolve })
      }
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())
    await user.click(screen.getByTestId('sb-view-cards'))
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.type(screen.getByDisplayValue('你听，潮水退下去的声音。'), '（保存前）')
    await user.click(screen.getByTestId('sb-save'))

    // 保存挂起期间继续编辑（对白输入框仍展开）
    await user.type(screen.getByDisplayValue(/（保存前）/) as HTMLInputElement, '（保存中补充）')

    ;(finishSave as unknown as ((res: Response) => void) | null)?.(okJson({ ok: true, id: 'sb_01JBGZ000000000000000000AA', revision: 2, sourceStale: false }))
    await waitFor(() => expect(screen.getByTestId('sb-notice')).toHaveTextContent('已保存 r2'))
    expect(screen.getByTestId('sb-notice')).toHaveTextContent('保存期间你还有新修改')
    // R2 核心：保存中的输入原样保留，且工作区保持 dirty
    expect(screen.getByDisplayValue(/（保存中补充）/)).toBeTruthy()
    expect(screen.getByText('● 未保存修改')).toBeTruthy()
  })

  /** R2 验收：挂起保存期间切章 → 晚到成功响应被丢弃（不污染新章工作区）。 */
  it('切章丢弃挂起保存的晚到成功响应', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finishSave: ((res: Response) => void) | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({
        ok: true,
        chapters: [
          { chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 },
          { chapterIndex: 2, title: '涨潮', phase: 'draft', wordCount: 80, revision: 1 },
        ],
      })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      if (path === '/api/storyboard.save') {
        return await new Promise<Response>((resolve) => { finishSave = resolve })
      }
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())
    await user.click(screen.getByTestId('sb-save'))
    await user.selectOptions(screen.getByTestId('sb-chapter-select'), '2')
    await waitFor(() => expect(screen.getByTestId('sb-workspace-empty')).toBeTruthy())

    ;(finishSave as unknown as ((res: Response) => void) | null)?.(okJson({ ok: true, id: 'sb_01JBGZ000000000000000000AA', revision: 1, sourceStale: false }))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('sb-shots')).toBeNull() // 晚到响应未重建工作区
    expect(screen.queryByText(/已保存 r1/)).toBeNull()
  })

  /** R1 验收：畸形 revision 永不触发非法保存（重试按钮禁用 + 显式报错）。 */
  it('服务器 revision 未知（-1）时重试禁用', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
      if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
      if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
      if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
      if (path === '/api/storyboard.save') {
        return new Response(JSON.stringify({ ok: false, code: 'STORYBOARD_REVISION_CONFLICT', error: 'revision 冲突', storedRevision: 2 }), { status: 409 })
      }
      if (path === '/api/storyboard') {
        return new Response(JSON.stringify({ ok: false, error: 'storyboard file unreadable' }), { status: 500 })
      }
      throw new Error('unexpected fetch: ' + path)
    }))
    render(<StoryboardView book={BOOK_A} />)
    await user.click(await screen.findByTestId('sb-generate'))
    await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())
    await user.click(screen.getByTestId('sb-save'))
    const retry = await screen.findByTestId('sb-conflict-retry')
    expect((retry as HTMLButtonElement).disabled).toBe(true)
  })

  /** U05 键盘可达：软键盘弹出（visualViewport resize）时滚入当前编辑字段与底部工具栏；mobile-only。 */
  it('visualViewport 收缩时滚入焦点字段与工具栏；桌面宽度不动作', async () => {
    const user = userEvent.setup()
    let resizeHandler: (() => void) | null = null
    const realVv = window.visualViewport
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: (_type: string, handler: () => void) => { resizeHandler = handler },
        removeEventListener: () => {},
      },
    })
    const realInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }) // 390 模拟手机

    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function scrolledIntoView(this: Element) { scrolled.push(this) }

    try {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
        if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '灯塔夜谈', phase: 'draft', wordCount: 100, revision: 3 }] })
        if (path === '/api/storyboard.source') return okJson({ ok: true, source: SOURCE, title: '灯塔夜谈', characterCount: 100, excerpt: 'x' })
        if (path === '/api/storyboards') return okJson({ ok: true, items: [], skippedInvalid: 0 })
        if (path === '/api/storyboard.generate') return okJson({ ok: true, candidate: candidateDoc() })
        throw new Error('unexpected fetch: ' + path)
      }))
      render(<StoryboardView book={BOOK_A} />)
      await user.click(await screen.findByTestId('sb-generate'))
      await waitFor(() => expect(screen.getByTestId('sb-shots')).toBeTruthy())

      const toolbar = document.querySelector('[data-testid="sb-work-toolbar"]')
      expect(toolbar).not.toBeNull()

      const input = screen.getByTestId('sb-f-visual') as HTMLInputElement
      input.focus()
      expect(document.activeElement).toBe(input)

      if (resizeHandler === null) throw new Error('visualViewport resize listener not registered')
      const fireResize = resizeHandler as () => void
      fireResize()
      expect(scrolled).toContain(input)
      expect(scrolled).toContain(toolbar)

      // mobile-only：桌面宽度（≥768）不动作
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
      const before = scrolled.length
      fireResize()
      expect(scrolled.length).toBe(before)
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: realVv })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: realInnerWidth })
    }
  })
})
