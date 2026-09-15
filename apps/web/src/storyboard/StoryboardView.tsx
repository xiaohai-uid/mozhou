/**
 * 漫剧分镜视图（T04 · 真实用户闭环）：选择作品与已保存章节 → 设置 → 确认发送 →
 * 生成候选 → 查看原文对应与改编说明 → 编辑镜头/对白/提示词 → 显式保存 →
 * 重新打开或导出（JSON/Markdown）。
 *
 * 纪律（brief.storyboard）：
 * - 源自磁盘章节（/api/storyboard.source），模型输出不可信（服务端校验）；
 * - 生成候选不写盘；显式保存走 /api/storyboard.save（expectedRevision 乐观并发，
 *   409 保留本地编辑——冲突横幅给出明确取舍，绝不静默覆盖）；
 * - 切书/卸载后晚到响应一律丢弃（alive 哨兵 + App 侧 key 重挂载）；
 * - 错误不清空用户文本；导出不调用付费媒体生成；
 * - stale 为派生属性：源已变更如实标注，不拦截人工保存（作者主权）；
 * - 视觉：本视图局部银白金属卡样式（.sb-root 作用域），全量推广待 T05 用户签样。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { post } from '../lib/post'
import type { BookInfo } from '../shell/workbenchStorage'
import type { WorksOverviewResponse } from '../../server/api'
import { setStoryboardSaveState } from './dirtyGuard'
import type {
  AdaptationOptions,
  Shot,
  ShotDialogueLine,
  StoryboardDocument,
} from './types'
import './storyboard.css'

interface SourceInfo {
  readonly source: StoryboardDocument['source']
  readonly title: string
  readonly characterCount: number
  readonly excerpt: string
}

interface SavedListItem {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly sourceStale: boolean
  readonly updatedAt: string
}

const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const
const FRAMINGS = ['wide', 'medium', 'close', 'detail'] as const
const FRAMING_LABELS: Record<Shot['framing'], string> = {
  wide: '大远景', medium: '中景', close: '特写', detail: '细节',
}
/** U07：英文景别代号收进 title 提示，不在界面裸显；数据层仍存英文代号。 */
const FRAMING_EN: Record<Shot['framing'], string> = {
  wide: 'wide', medium: 'medium', close: 'close', detail: 'detail',
}
/** 镜头标题里的景别片段：中文主显示 + title 携英文代号。 */
function FramingLabel({ framing }: { framing: Shot['framing'] }): JSX.Element {
  return <span title={`景别 ${FRAMING_EN[framing]}`}>{FRAMING_LABELS[framing]}</span>
}

function emptyShot(order: number): Shot {
  return {
    id: `shot_manual_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`,
    sceneId: 'scene_01',
    order,
    location: '',
    timeOfDay: '日',
    framing: 'medium',
    cameraMovement: 'static',
    visual: '',
    characterIds: [],
    dialogue: [],
    narration: '',
    sound: '',
    estimatedDurationSeconds: 4,
    imagePrompt: '',
    videoPrompt: '',
    negativePrompt: '',
    sourceQuote: '',
    origin: 'adaptation',
    adaptationNote: '人工新增镜头',
  }
}

/** 保存/展示前镜头序重排为 1..N（服务端强校验连续性）。 */
function renumber(shots: readonly Shot[]): Shot[] {
  return shots.map((shot, index) => ({ ...shot, order: index + 1 }))
}

export function StoryboardView({
  book,
  initialChapterIndex,
  onGoToShelf,
  onCreateBook,
}: {
  book: BookInfo | null
  initialChapterIndex?: number | undefined
  /** U03 空态直接动作：去书架选已有作品（桌面注入）。 */
  onGoToShelf?: (() => void) | undefined
  /** U03 空态直接动作：新建作品（向导，桌面注入）。 */
  onCreateBook?: (() => void) | undefined
}): JSX.Element {
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  /* R1/R2 修复根因=闭包陈旧：保存链路一律经 ref 读最新值；响应归属按 ref 守卫。 */
  const docRef = useRef<StoryboardDocument | null>(null)
  const docIsSavedRef = useRef(false)
  const savingRef = useRef(false)
  /** 编辑计数器：保存起点捕获，响应时比较——保存期间的新编辑保持 dirty（R2）。 */

  const [chapters, setChapters] = useState<WorksOverviewResponse['chapters'] | null>(null)
  const [chapterIndex, setChapterIndex] = useState(initialChapterIndex ?? 1)
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [doc, setDoc] = useState<StoryboardDocument | null>(null)
  const [docIsSaved, setDocIsSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedList, setSavedList] = useState<SavedListItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [conflict, setConflict] = useState<{ storedRevision: number } | null>(null)
  const [options, setOptions] = useState<AdaptationOptions>({
    aspectRatio: '9:16',
    targetDurationSeconds: 90,
    visualStyle: '银白冷调 · 写实微幻想',
    language: 'zh-CN',
  })
  /* U04：工作视图（默认，序列+单镜编辑）与卡片视图（收藏式，保留） */
  const [viewMode, setViewMode] = useState<'work' | 'cards'>('work')
  const [currentShotId, setCurrentShotId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'source' | 'prompt' | 'adapt'>('source')
  /* U09：生成前明示模型可用性（/api/capabilities） */
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null)

  const root = book?.root ?? null

  /* U09：模型可用性探测（生成前如实呈现，不伪造） */
  useEffect(() => {
    let cancelled = false
    void post<{ providerAvailable: boolean }>('/api/capabilities', {})
      .then((d) => { if (!cancelled && aliveRef.current) setProviderAvailable(d.providerAvailable) })
      .catch(() => { if (!cancelled && aliveRef.current) setProviderAvailable(false) })
    return () => { cancelled = true }
  }, [])

  /* U04：场景分组（按 sceneId 首现顺序）与选中镜头步进 */
  const sceneGroups = useMemo(() => {
    if (doc === null) return [] as { sceneId: string; shots: { shot: Shot; index: number }[]; subtotal: number }[]
    const groups: { sceneId: string; shots: { shot: Shot; index: number }[]; subtotal: number }[] = []
    const byId = new Map<string, { sceneId: string; shots: { shot: Shot; index: number }[]; subtotal: number }>()
    doc.shots.forEach((shot, index) => {
      let g = byId.get(shot.sceneId)
      if (g === undefined) {
        g = { sceneId: shot.sceneId, shots: [], subtotal: 0 }
        byId.set(shot.sceneId, g)
        groups.push(g)
      }
      g.shots.push({ shot, index })
      g.subtotal += shot.estimatedDurationSeconds
    })
    return groups
  }, [doc])

  const totalDuration = useMemo(() => (doc === null ? 0 : Math.round(doc.shots.reduce((a, s) => a + s.estimatedDurationSeconds, 0) * 100) / 100), [doc])
  const currentShot = useMemo(
    () => (doc === null ? null : doc.shots.find((s) => s.id === currentShotId) ?? doc.shots[0] ?? null),
    [doc, currentShotId],
  )
  const currentShotElapsed = useMemo(() => {
    if (doc === null || currentShot === null) return 0
    const idx = doc.shots.findIndex((s) => s.id === currentShot.id)
    return Math.round(doc.shots.slice(0, idx + 1).reduce((a, s) => a + s.estimatedDurationSeconds, 0) * 100) / 100
  }, [doc, currentShot])
  const selectShot = (id: string): void => { setCurrentShotId(id) }
  const stepShot = (delta: number): void => {
    if (doc === null || doc.shots.length === 0) return
    const idx = Math.max(0, doc.shots.findIndex((s) => s.id === (currentShot?.id ?? '')))
    const next = doc.shots[Math.min(doc.shots.length - 1, Math.max(0, idx + delta))]
    if (next !== undefined) setCurrentShotId(next.id)
  }
  /* U04：工作视图相邻镜头键盘步进（[ / ]，输入焦点内不劫持） */
  useEffect(() => {
    if (viewMode !== 'work' || doc === null || doc.shots.length === 0) return
    const handler = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === '[') stepShot(-1)
      if (e.key === ']') stepShot(1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  /* ref 同步（状态声明之后）：保存链路经 ref 读最新 doc/归属。 */
  const editTickRef = useRef(0)
  const savedTickRef = useRef(0)
  useEffect(() => { docRef.current = doc }, [doc])
  useEffect(() => { docIsSavedRef.current = docIsSaved }, [docIsSaved])

  /* U05：移动端软键盘可达——visualViewport 收缩（键盘弹出）时把当前编辑字段
     与底部工具栏滚回可视区；桌面宽度（≥768）不动作。 */
  useEffect(() => {
    if (viewMode !== 'work') return
    const vv = window.visualViewport
    if (vv == null) return
    const keepVisible = (): void => {
      if (window.innerWidth >= 768) return // mobile-only
      const active = document.activeElement
      if (active instanceof HTMLElement && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        active.scrollIntoView({ block: 'center' })
      }
      document.querySelector('[data-testid="sb-work-toolbar"]')?.scrollIntoView({ block: 'nearest' })
    }
    vv.addEventListener('resize', keepVisible)
    return () => vv.removeEventListener('resize', keepVisible)
  }, [viewMode])

  /* U06：脏状态注册到外壳（切页/切书/关抽屉守卫）+ 刷新/关闭前的 beforeunload。
     只有存在工作文档且未保存时才拦；干净文档不拦。
     U05：外壳徽标读同一三态真源——空文档=idle（就绪），不谎报「已保存」。 */
  useEffect(() => {
    setStoryboardSaveState(dirty ? 'dirty' : doc !== null ? 'saved' : 'idle')
  }, [dirty, doc])
  useEffect(() => () => { setStoryboardSaveState('idle') }, [])
  useEffect(() => {
    if (!dirty || doc === null) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, doc])

  /** 编辑动作统一走 touch（R2 计数+dirty）；生成/打开/导入是换内容，走 resetEditTicks。 */
  const touch = (): void => {
    editTickRef.current += 1
    setDirty(true)
  }
  const resetEditTicks = (): void => {
    editTickRef.current = 0
    savedTickRef.current = 0
  }

  /* ---- 章节目录 ---- */
  useEffect(() => {
    if (root === null) return
    let cancelled = false
    void post<WorksOverviewResponse>('/api/works', { root })
      .then((data) => { if (!cancelled && aliveRef.current) setChapters(data.chapters) })
      .catch(() => { if (!cancelled && aliveRef.current) setChapters([]) })
    return () => { cancelled = true }
  }, [root])

  const loadSource = useCallback(async (index: number): Promise<SourceInfo | null> => {
    if (root === null) return null
    try {
      const data = await post<{ source: StoryboardDocument['source']; title: string; characterCount: number; excerpt: string }>(
        '/api/storyboard.source', { root, chapterIndex: index },
      )
      if (!aliveRef.current) return null
      const info: SourceInfo = { source: data.source, title: data.title, characterCount: data.characterCount, excerpt: data.excerpt }
      setSource(info)
      return info
    } catch (cause) {
      if (aliveRef.current) {
        setSource(null)
        setNotice({ kind: 'err', text: `读取源章节失败：${(cause as Error).message}` })
      }
      return null
    }
  }, [root])

  /* ---- 保存版本列表 ---- */
  const refreshList = useCallback(async (): Promise<void> => {
    if (root === null) return
    try {
      const data = await post<{ items: SavedListItem[] }>('/api/storyboards', { root })
      if (aliveRef.current) setSavedList(data.items)
    } catch {
      if (aliveRef.current) setSavedList([])
    }
  }, [root])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  // 初次挂载/换书后加载当前章源快照（与切章同一条服务端读取路径；chapterIndex 变化走 handleSelectChapter）。
  useEffect(() => {
    if (root !== null) void loadSource(chapterIndex)
  }, [root])

  const handleSelectChapter = (next: number): void => {
    if (dirty && doc !== null && !window.confirm('当前分镜有未保存修改——切换章节将丢弃。继续？')) return
    setChapterIndex(next)
    setSource(null)
    setDoc(null)
    resetEditTicks()
    setDirty(false)
    setConflict(null)
    setNotice(null)
    setEditingId(null)
    void loadSource(next)
  }

  /* ---- 生成候选（不写盘） ---- */
  const handleGenerate = async (): Promise<void> => {
    if (root === null || generating) return
    if (dirty && doc !== null && !window.confirm('当前分镜有未保存修改——重新生成将替换工作区内容。继续？')) return
    setGenerating(true)
    setNotice(null)
    setConflict(null)
    const capturedRoot = root
    const capturedChapter = chapterIndex
    try {
      const info = source !== null ? await Promise.resolve(source) : await loadSource(capturedChapter)
      if (info === null || !aliveRef.current || capturedRoot !== root) return
      const data = await post<{ candidate: StoryboardDocument }>('/api/storyboard.generate', {
        root: capturedRoot,
        chapterIndex: capturedChapter,
        expectedSourceHash: info.source.sha256,
        options,
      })
      if (!aliveRef.current || capturedRoot !== root) return // 晚到响应丢弃
      setDoc(data.candidate)
      setDocIsSaved(false)
      resetEditTicks()
      setDirty(true) // U06：未保存候选受保护（离开路径需确认）
      setEditingId(null)
      setNotice({ kind: 'ok', text: `候选已生成（${data.candidate.shots.length} 镜，估计总时长 ${data.candidate.totalEstimatedDurationSeconds}s）——检查后请显式保存。` })
    } catch (cause) {
      if (!aliveRef.current || capturedRoot !== root) return
      const err = cause as Error
      setNotice({ kind: 'err', text: `生成失败：${err.message}` })
    } finally {
      if (aliveRef.current) setGenerating(false)
    }
  }

  /* ---- 显式保存（expectedRevision 乐观并发；409 保留本地编辑） ----
   * R1：基线 revision 由参数显式传入或取自 ref——不依赖 setState/setTimeout 刷新闭包；
   *     冲突时读 /api/storyboard 的 document.revision 呈现。
   * R2：成功只回写服务端身份字段（id/revision）到当前文档；保存期间的新编辑保留并保持 dirty；
   *     响应必须仍属于当前文档（切章/打开/导入会换文档，晚到响应一律丢弃）。
   * 畸形 revision 显式拒绝，绝不升级为一次非法保存。 */
  const handleSave = async (expectedRevisionOverride?: number | null): Promise<void> => {
    const docAtStart = docRef.current
    if (root === null || docAtStart === null || savingRef.current) return
    const expectedRevision = expectedRevisionOverride !== undefined
      ? expectedRevisionOverride
      : (docIsSavedRef.current ? docAtStart.revision : null)
    if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      setNotice({ kind: 'err', text: `保存中止：基线 revision 非法（${String(expectedRevision)}）——请从「已保存版本」重新打开后再试。` })
      return
    }
    savingRef.current = true
    setSaving(true)
    setNotice(null)
    savedTickRef.current = editTickRef.current
    const capturedRoot = root
    const capturedDocId = docAtStart.id
    try {
      const payload: StoryboardDocument = { ...docAtStart, shots: renumber(docAtStart.shots) }
      const data = await post<{ id: string; revision: number; sourceStale: boolean }>('/api/storyboard.save', {
        root: capturedRoot, document: payload, expectedRevision,
      })
      if (!aliveRef.current || capturedRoot !== root || docRef.current?.id !== capturedDocId) return // 晚到/换文档：丢弃
      setDoc((prev) => (prev === null || prev.id !== capturedDocId ? prev : { ...prev, id: data.id, revision: data.revision }))
      const editedDuringSave = editTickRef.current !== savedTickRef.current
      setDocIsSaved(true)
      setDirty(editedDuringSave)
      setConflict(null)
      setNotice({
        kind: 'ok',
        text: `已保存 r${data.revision}${editedDuringSave ? '（注意：保存期间你还有新修改，尚未保存）' : ''}${data.sourceStale ? '（源章节已变更，分镜标记为 stale）' : ''}。`,
      })
      void refreshList()
    } catch (cause) {
      if (!aliveRef.current || capturedRoot !== root) return
      const err = cause as Error
      if (err.name === 'STORYBOARD_REVISION_CONFLICT') {
        // 409：本地编辑原样保留；读服务器当前 revision（document.revision）供作者显式取舍。
        void post<{ document: StoryboardDocument }>('/api/storyboard', { root: capturedRoot, id: capturedDocId })
          .then((remote) => {
            if (!aliveRef.current || docRef.current?.id !== capturedDocId) return
            const rev = remote.document?.revision
            setConflict({ storedRevision: typeof rev === 'number' && Number.isInteger(rev) && rev >= 1 ? rev : -1 })
          })
          .catch(() => {
            if (aliveRef.current && docRef.current?.id === capturedDocId) setConflict({ storedRevision: -1 })
          })
        setNotice({ kind: 'err', text: '保存冲突：服务器上已有更新版本。你的本地修改完整保留——请选择覆盖方式。' })
      } else {
        setNotice({ kind: 'err', text: `保存失败：${err.message}` })
      }
    } finally {
      savingRef.current = false
      if (aliveRef.current) setSaving(false)
    }
  }

  /** 冲突后的显式重试：以读到的服务器 revision 为基线覆盖远端（作者已知情）。
   *  R1：不经过 setDoc/setTimeout 中转；畸形 revision 直接拒绝，不发非法保存。 */
  const retrySaveWithServerRevision = async (): Promise<void> => {
    if (conflict === null) return
    const rev = conflict.storedRevision
    if (!Number.isInteger(rev) || rev < 1) {
      setNotice({ kind: 'err', text: '无法重试：服务器 revision 未知——请从「已保存版本」重新打开后再试。' })
      return
    }
    setConflict(null)
    await handleSave(rev)
  }

  /* ---- 打开已保存版本 ---- */
  const handleOpenSaved = async (id: string): Promise<void> => {
    if (root === null) return
    if (dirty && !window.confirm('当前有未保存修改——打开已保存版本将丢弃。继续？')) return
    try {
      const data = await post<{ document: StoryboardDocument; sourceStale: boolean }>('/api/storyboard', { root, id })
      if (!aliveRef.current) return
      setDoc(data.document)
      setDocIsSaved(true)
      resetEditTicks()
      setDirty(false)
      setConflict(null)
      setEditingId(null)
      setChapterIndex(data.document.source.chapterIndex)
      void loadSource(data.document.source.chapterIndex)
      setNotice(data.sourceStale
        ? { kind: 'err', text: '已打开保存版本——注意：源章节在保存后已被修改（stale）。' }
        : { kind: 'ok', text: `已打开保存版本 r${data.document.revision}。` })
    } catch (cause) {
      if (aliveRef.current) setNotice({ kind: 'err', text: `打开失败：${(cause as Error).message}` })
    }
  }

  /* ---- 导出（JSON 完整结构 / Markdown 按场景镜头序；均不调用付费媒体生成） ---- */
  const download = (filename: string, content: string, type: string): void => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportJson = (): void => {
    if (doc === null) return
    download(`${doc.id}.json`, JSON.stringify({ ...doc, shots: renumber(doc.shots) }, null, 2), 'application/json')
  }

  const markdownOf = (d: StoryboardDocument): string => {
    const lines: string[] = [
      `# ${d.title}`,
      '',
      `- 作品：${book?.title ?? '未知'} · 第 ${d.source.chapterIndex} 章（${d.source.phase} r${d.source.revision}）`,
      `- 画幅：${d.options.aspectRatio} · 目标总时长：约 ${d.options.targetDurationSeconds}s · 风格：${d.options.visualStyle}`,
      `- 镜头数：${d.shots.length} · 估计总时长：${d.totalEstimatedDurationSeconds}s（估计值，非成片时长）`,
      `- 生成：${d.generation.provider} / ${d.generation.model} · 文档 ${d.id} r${d.revision}`,
      '',
    ]
    const byScene = new Map<string, Shot[]>()
    for (const shot of renumber(d.shots)) {
      const list = byScene.get(shot.sceneId) ?? []
      list.push(shot)
      byScene.set(shot.sceneId, list)
    }
    for (const [sceneId, shots] of byScene) {
      lines.push(`## 场景 ${sceneId}`, '')
      for (const shot of shots) {
        const charName = (id: string): string => d.characters.find((c) => c.id === id)?.name ?? id
        lines.push(`### 镜头 ${shot.order} · ${shot.location || '未填地点'} · ${shot.timeOfDay} · ${shot.framing} · ${shot.cameraMovement} · 约 ${shot.estimatedDurationSeconds}s（估计）`)
        lines.push(`- 画面：${shot.visual || '（未填）'}`)
        for (const line of shot.dialogue) lines.push(`- 对白 ${charName(line.speakerId)}：「${line.text}」`)
        if (shot.narration) lines.push(`- 旁白：${shot.narration}`)
        if (shot.sound) lines.push(`- 音效：${shot.sound}`)
        lines.push(`- 图像提示词：${shot.imagePrompt || '—'}`)
        lines.push(`- 视频提示词：${shot.videoPrompt || '—'}`)
        if (shot.negativePrompt) lines.push(`- 负面提示词：${shot.negativePrompt}`)
        lines.push(`- 来源：${shot.origin === 'source' ? `原文（引：${shot.sourceQuote}）` : '改编新增'}`)
        if (shot.adaptationNote) lines.push(`- 改编说明：${shot.adaptationNote}`)
        lines.push('')
      }
    }
    if (d.warnings.length > 0) lines.push('## 警告', ...d.warnings.map((w) => `- ${w}`), '')
    return lines.join('\n')
  }

  const handleExportMarkdown = (): void => {
    if (doc === null) return
    download(`${doc.id}.md`, markdownOf({ ...doc, shots: renumber(doc.shots) }), 'text/markdown')
  }

  const handleImportJson = (file: File): void => {
    const reader = new FileReader()
    reader.onload = (): void => {
      try {
        const raw = reader.result
        if (typeof raw !== 'string') throw new Error('无法读取文件：内容不是文本')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (typeof parsed['id'] !== 'string' || !Array.isArray(parsed['shots']) || !Array.isArray(parsed['characters']) || typeof parsed['source'] !== 'object') {
          throw new Error('不是墨舟分镜 JSON（缺 id/shots/characters/source）')
        }
        if (doc !== null && dirty && !window.confirm('当前有未保存修改——导入将替换工作区内容。继续？')) return
        setDoc(parsed as unknown as StoryboardDocument)
        setDocIsSaved(false) // 导入内容须显式重新保存（服务端会完整校验归属与结构）
        resetEditTicks()
        setDirty(true)
        setNotice({ kind: 'ok', text: 'JSON 已导入工作区——保存时服务端会重新校验结构与书归属。' })
      } catch (cause) {
        setNotice({ kind: 'err', text: `导入失败：${(cause as Error).message}` })
      }
    }
    reader.onerror = (): void => {
      setNotice({ kind: 'err', text: `导入失败：无法读取文件${reader.error !== null ? `（${reader.error.message}）` : ''}` })
    }
    reader.readAsText(file)
  }

  /* ---- 镜头编辑（错误不清空用户文本：只在成功路径 setDoc；R2：编辑计入 touch） ---- */
  const updateShot = (shotId: string, patch: Partial<Shot>): void => {
    setDoc((prev) => (prev === null ? prev : { ...prev, shots: prev.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)) }))
    touch()
  }
  const updateDialogue = (shotId: string, lines: readonly ShotDialogueLine[]): void => {
    updateShot(shotId, { dialogue: lines })
  }
  const charName = (id: string): string => doc?.characters.find((c) => c.id === id)?.name ?? id

  const sourceStaleNow = useMemo(() => {
    if (doc === null) return false
    return savedList.find((it) => it.id === doc.id)?.sourceStale ?? false
  }, [doc, savedList])

  /* ---- 空态 ---- */
  if (book === null) {
    return (
      <div className="sb-root" data-testid="storyboard-root">
        <div className="sb-head"><h1>漫剧分镜</h1></div>
        <div className="sb-empty" data-testid="storyboard-empty">
          尚未选择作品——选择已有作品，或新建一本，即可把已保存章节转换为分镜。
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            {onGoToShelf !== undefined && (
              <button type="button" className="sb-btn primary" onClick={onGoToShelf} data-testid="sb-empty-shelf">选择已有作品</button>
            )}
            {onCreateBook !== undefined && (
              <button type="button" className="sb-btn ghost" onClick={onCreateBook} data-testid="sb-empty-create">新建作品</button>
            )}
            {onGoToShelf === undefined && onCreateBook === undefined && (
              <span className="sb-note">先在工作台建书后回到本页。</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sb-root" data-testid="storyboard-root">
      <div className="sb-head">
        <h1>漫剧分镜</h1>
        <span className="sb-note">{book.title} · 改编为独立衍生作品，不改原文</span>
        {dirty && <span className="sb-badge stale">● 未保存修改</span>}
        {!dirty && doc !== null && docIsSaved && <span className="sb-badge ok">已保存 r{doc.revision}</span>}
        {sourceStaleNow && <span className="sb-badge stale">源章节已变更（stale）</span>}
      </div>

      {/* 源与设置 */}
      <section className="sb-panel">
        <b>源章节与转换设置</b>
        <div className="sb-formrow">
          <label className="sb-field">章节
            <select
              value={chapterIndex}
              onChange={(e) => { handleSelectChapter(Number(e.target.value)) }}
              data-testid="sb-chapter-select"
            >
              {(chapters ?? []).map((ch) => (
                <option key={ch.chapterIndex} value={ch.chapterIndex}>
                  第 {ch.chapterIndex} 章 · {ch.title}（{ch.phase === 'committed' ? '已提交' : '草稿'} r{ch.revision}）
                </option>
              ))}
              {(chapters ?? []).length === 0 && <option value={chapterIndex}>第 {chapterIndex} 章</option>}
            </select>
          </label>
          <label className="sb-field">画幅
            <select value={options.aspectRatio} onChange={(e) => setOptions({ ...options, aspectRatio: e.target.value as AdaptationOptions['aspectRatio'] })}>
              {ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="sb-field">目标总时长（秒，估计）
            <input
              type="number" min={1} max={3600} value={options.targetDurationSeconds}
              onChange={(e) => setOptions({ ...options, targetDurationSeconds: Math.max(1, Math.min(3600, Number(e.target.value) || 1)) })}
            />
          </label>
          <label className="sb-field" style={{ flex: '1 1 200px' }}>视觉风格
            <input value={options.visualStyle} onChange={(e) => setOptions({ ...options, visualStyle: e.target.value })} />
          </label>
          <button
            type="button"
            className="sb-btn primary"
            disabled={generating || chapterIndex < 1 || providerAvailable === false}
            title={providerAvailable === false ? '模型未配置——到 系统状态 → 模型接入 添加 Key 后可用' : undefined}
            onClick={() => { void handleGenerate() }}
            data-testid="sb-generate"
          >
            {generating ? '生成中…（最长 60s）' : '生成分镜候选'}
          </button>
        </div>
        {source !== null && (
          <div className="sb-note" style={{ marginTop: 8 }} data-testid="sb-source-info">
            源：<b>{source.title}</b> · {source.characterCount} 字 · {source.source.phase} r{source.source.revision}
            {'　'}<span data-testid="sb-scope-note">将发送本章全文（{source.characterCount} 字 · 上限 12000，超出明确拒绝）</span>
            {'　'}预览：{source.excerpt.slice(0, 60)}…
          </div>
        )}
        <div className="sb-note" style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            className={'sb-badge' + (providerAvailable === true ? ' ok' : providerAvailable === false ? ' stale' : '')}
            data-testid="sb-provider-chip"
          >
            {providerAvailable === null ? '探测模型中…' : providerAvailable ? '● 模型已连接' : '● 模型未配置'}
          </span>
          <span>
            {providerAvailable === false
              ? '模型未配置——到「系统状态 → 模型接入」添加 Key 后可用；不会生成假分镜。'
              : '生成候选不写盘，检查后显式保存；本章超 12000 字会被拒绝（不静默截断）；镜头时长均为估计值。'}
          </span>
        </div>
      </section>

      {/* 提示/错误（错误不清空工作区） */}
      {notice !== null && (
        <div className={`sb-notice ${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'} data-testid="sb-notice">
          {notice.text}
        </div>
      )}
      {conflict !== null && (
        <div className="sb-notice" role="alert" data-testid="sb-conflict">
          <b>版本冲突</b>：服务器为 r{conflict.storedRevision}，你编辑的是 r{doc?.revision ?? '?'}。你的修改完整保留。
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="sb-btn"
              disabled={!Number.isInteger(conflict.storedRevision) || conflict.storedRevision < 1}
              onClick={() => { void retrySaveWithServerRevision() }}
              data-testid="sb-conflict-retry"
            >
              以我的版本覆盖服务器（基线 r{conflict.storedRevision}）
            </button>
            <button type="button" className="sb-btn ghost" onClick={() => { setConflict(null); setNotice(null) }}>
              先不动，我继续本地编辑
            </button>
          </div>
        </div>
      )}

      {/* 工作区动作（U07：id/hash 收进详情；U04：工作/卡片视图切换） */}
      {doc !== null && (
        <section className="sb-panel">
          <div className="sb-head">
            <b>工作区：{doc.title}</b>
            <span className="sb-note">r{doc.revision} · {doc.shots.length} 镜 · 估计总时长 {totalDuration}s</span>
            <details className="sb-details">
              <summary>文档详情</summary>
              <div className="sb-note sb-mono">id: {doc.id} · 源 sha256: {doc.source.sha256} · 源 r{doc.source.revision}（{doc.source.phase}）</div>
            </details>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="sb-badge" role="group" aria-label="视图切换">
                <button type="button" className="sb-mini-btn" aria-pressed={viewMode === 'work'} onClick={() => setViewMode('work')} data-testid="sb-view-work">工作视图</button>
                <button type="button" className="sb-mini-btn" aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')} data-testid="sb-view-cards">卡片视图</button>
              </span>
              <button type="button" className="sb-btn" disabled={saving} onClick={() => { void handleSave() }} data-testid="sb-save">
                {saving ? '保存中…' : docIsSaved ? `保存（基线 r${doc.revision}）` : '保存为新版本'}
              </button>
              <button type="button" className="sb-btn ghost" onClick={handleExportJson} data-testid="sb-export-json">导出 JSON</button>
              <button type="button" className="sb-btn ghost" onClick={handleExportMarkdown} data-testid="sb-export-md">导出 Markdown</button>
              <label className="sb-btn ghost" style={{ cursor: 'pointer' }}>
                导入 JSON
                <input type="file" accept="application/json" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f !== undefined) handleImportJson(f); e.target.value = '' }} />
              </label>
              <button type="button" className="sb-btn ghost" onClick={() => { setDoc((prev) => (prev === null ? prev : { ...prev, shots: [...prev.shots, emptyShot(prev.shots.length + 1)] })); touch() }} data-testid="sb-add-shot">
                ＋ 新增镜头
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 镜头区：工作视图（U04 默认：场景分组序列 + 单镜主区编辑）/ 卡片视图（收藏式，保留） */}
      {doc !== null && doc.shots.length > 0 && viewMode === 'work' && currentShot !== null && (() => {
        const currentIdx = doc.shots.findIndex((s) => s.id === currentShot.id)
        return (
          <div className="sb-work" data-testid="sb-shots">
            <aside className="sb-panel sb-list" aria-label="镜头序列">
              {sceneGroups.map((g) => (
                <div key={g.sceneId}>
                  <div className="sb-scene-head">
                    <b>{g.sceneId}</b>
                    <span className="sb-mono">{g.shots.length} 镜 · {Math.round(g.subtotal * 10) / 10}s</span>
                  </div>
                  {g.shots.map(({ shot, index }) => (
                    <button
                      key={shot.id}
                      type="button"
                      className={'sb-shot-row' + (currentShot.id === shot.id ? ' current' : '')}
                      onClick={() => selectShot(shot.id)}
                      aria-current={currentShot.id === shot.id}
                      data-testid={`sb-seq-${index + 1}`}
                    >
                      <span className="sb-shot-no">{String(index + 1).padStart(2, '0')}</span>
                      <span className="sb-shot-gist">{shot.visual !== '' ? shot.visual : '（未填动作）'}</span>
                      {shot.origin === 'adaptation'
                        ? <span className="sb-mod-dot" title="改编新增" />
                        : <span className="sb-shot-dur">{shot.estimatedDurationSeconds}s</span>}
                    </button>
                  ))}
                </div>
              ))}
            </aside>

            <section className="sb-panel sb-editorpane" aria-label="镜头编辑">
              <div className="sb-shot-head">
                <span className="sb-shot-no">{String(currentIdx + 1).padStart(2, '0')}</span>
                <span className="sb-shot-title">{currentShot.location || '未填地点'} · {currentShot.timeOfDay} · <FramingLabel framing={currentShot.framing} /></span>
                <span className="sb-badge">{currentShot.origin === 'source' ? '原文' : '改编'} · 约{currentShot.estimatedDurationSeconds}s</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="sb-mini-btn" onClick={() => stepShot(-1)} data-testid="sb-prev-shot">‹ 上一镜</button>
                <button type="button" className="sb-mini-btn" onClick={() => stepShot(1)} data-testid="sb-next-shot">下一镜 ›</button>
              </div>

              <div className="sb-shotframe">
                <div className="sb-visual">
                  <b>无画面</b>
                  <span>点按选择配图——未配图不假造</span>
                </div>
                <div className="sb-fields">
                  <div className="sb-fieldline"><label>动作摘要</label>
                    <input className="sb-input" value={currentShot.visual} onChange={(e) => updateShot(currentShot.id, { visual: e.target.value })} data-testid="sb-f-visual" />
                  </div>
                  <div className="sb-fieldline"><label>对白</label>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {currentShot.dialogue.map((line, li) => (
                        <div className="sb-line" key={`${currentShot.id}-d${li}`}>
                          <select className="sb-input" value={line.speakerId} aria-label="说话人" onChange={(e) => updateDialogue(currentShot.id, currentShot.dialogue.map((l, i) => (i === li ? { ...l, speakerId: e.target.value } : l)))}>
                            {doc.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <input className="sb-input" value={line.text} aria-label="台词" onChange={(e) => updateDialogue(currentShot.id, currentShot.dialogue.map((l, i) => (i === li ? { ...l, text: e.target.value } : l)))} />
                          <button type="button" className="sb-mini-btn" title="删除该句" onClick={() => updateDialogue(currentShot.id, currentShot.dialogue.filter((_, i) => i !== li))}>✕</button>
                        </div>
                      ))}
                      <button type="button" className="sb-mini-btn" style={{ justifySelf: 'start' }} disabled={doc.characters.length === 0}
                        onClick={() => updateDialogue(currentShot.id, [...currentShot.dialogue, { speakerId: doc.characters[0]?.id ?? '', text: '' }])}>
                        ＋ 对白句
                      </button>
                    </div>
                  </div>
                  <div className="sb-fieldline"><label>旁白</label>
                    <input className="sb-input" value={currentShot.narration} onChange={(e) => updateShot(currentShot.id, { narration: e.target.value })} />
                  </div>
                  <div className="sb-fieldline"><label>估计时长</label>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input className="sb-input" style={{ maxWidth: 110, fontFamily: 'var(--sf-mono, monospace)' }} inputMode="decimal"
                        value={currentShot.estimatedDurationSeconds}
                        onChange={(e) => updateShot(currentShot.id, { estimatedDurationSeconds: Math.max(0.5, Math.min(600, Number(e.target.value) || 0.5)) })} />
                      <span className="sb-note">秒 · 估计值（至此累计 <b className="sb-mono">{currentShotElapsed}s</b> / 全片约 {totalDuration}s）</span>
                    </div>
                  </div>
                  <div className="sb-fieldline"><label>音效</label>
                    <input className="sb-input" value={currentShot.sound} onChange={(e) => updateShot(currentShot.id, { sound: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="sb-tabs" role="tablist" aria-label="镜头详情">
                {([['source', '原文对照'], ['prompt', '提示词'], ['adapt', '改编说明']] as const).map(([key, label]) => (
                  <button key={key} type="button" className="sb-tab" role="tab" aria-selected={detailTab === key} onClick={() => setDetailTab(key)} data-testid={`sb-tab-${key}`}>
                    {label}
                  </button>
                ))}
              </div>
              {detailTab === 'source' && (
                <div className="sb-tabpanel" role="tabpanel" data-testid="sb-panel-source">
                  {/* U04：原文|编辑并排（sb3-duo 形态）——≥1100px 双栏，窄屏纵向堆叠 */}
                  <div className="sb-duo">
                    <div>
                      <div className="sb-note" style={{ marginBottom: 6 }}>原文（只读 · 磁盘快照）</div>
                      {currentShot.origin === 'source'
                        ? <div className="sb-quote">原文锚（逐字锚定，只读）：{currentShot.sourceQuote}</div>
                        : <div className="sb-quote missing">改编新增镜头——无原文锚</div>}
                    </div>
                    <div>
                      <div className="sb-note" style={{ marginBottom: 6 }}>你的编辑（改编说明，保存时一起提交）</div>
                      <textarea
                        className="sb-edit-input"
                        rows={3}
                        value={currentShot.adaptationNote}
                        aria-label="改编说明（并排编辑）"
                        onChange={(e) => updateShot(currentShot.id, { adaptationNote: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="sb-note" style={{ marginTop: 8 }}>原文在磁盘上只读；本页编辑不回写正文。</div>
                </div>
              )}
              {detailTab === 'prompt' && (
                <div className="sb-tabpanel" role="tabpanel" data-testid="sb-panel-prompt">
                  <div className="sb-note" style={{ marginBottom: 4 }}>图像提示词</div>
                  <textarea className="sb-edit-input" rows={2} value={currentShot.imagePrompt} onChange={(e) => updateShot(currentShot.id, { imagePrompt: e.target.value })} />
                  <div className="sb-note" style={{ margin: '8px 0 4px' }}>视频提示词</div>
                  <textarea className="sb-edit-input" rows={2} value={currentShot.videoPrompt} onChange={(e) => updateShot(currentShot.id, { videoPrompt: e.target.value })} />
                  <div className="sb-note" style={{ margin: '8px 0 4px' }}>负面提示词</div>
                  <input className="sb-input" value={currentShot.negativePrompt} onChange={(e) => updateShot(currentShot.id, { negativePrompt: e.target.value })} />
                </div>
              )}
              {detailTab === 'adapt' && (
                <div className="sb-tabpanel" role="tabpanel" data-testid="sb-panel-adapt">
                  <div className="sb-note" style={{ marginBottom: 4 }}>镜头来源：{currentShot.origin === 'source' ? '原文（引文已逐字锚定）' : '改编新增'}</div>
                  <input className="sb-input" value={currentShot.adaptationNote} aria-label="改编说明" onChange={(e) => updateShot(currentShot.id, { adaptationNote: e.target.value })} />
                </div>
              )}

              <div className="sb-work-toolbar" data-testid="sb-work-toolbar">
                <button type="button" className="sb-btn ghost" onClick={() => stepShot(-1)}>‹ 上一镜</button>
                <button type="button" className="sb-btn primary" disabled={saving} onClick={() => { void handleSave() }}>{saving ? '保存中…' : '保存'}</button>
                <button type="button" className="sb-btn ghost" onClick={() => stepShot(1)}>下一镜 ›</button>
              </div>
            </section>
          </div>
        )
      })()}
      {doc !== null && doc.shots.length > 0 && viewMode === 'cards' && (
        <div className="sb-shots" data-testid="sb-cards">
          {doc.shots.map((shot, index) => {
            const isBack = flipped.has(shot.id)
            const isEditing = editingId === shot.id
            // R4：材质不编码语义——镜头卡统一银白材质；改编/原文只由徽标文字区分（brief.visual.meaning）。
            return (
              <article key={shot.id} className="sb-shot">
                <div className="sb-shot-head">
                  <span className="sb-shot-no">{String(index + 1).padStart(2, '0')}</span>
                  <span className="sb-shot-title">{shot.location || '未填地点'} · {shot.timeOfDay} · <FramingLabel framing={shot.framing} /></span>
                  <span className="sb-badge">{shot.origin === 'source' ? '原文' : '改编'} · 约{shot.estimatedDurationSeconds}s</span>
                  <button
                    type="button"
                    className="sb-mini-btn"
                    aria-pressed={isBack}
                    onClick={() => setFlipped((prev) => { const next = new Set(prev); if (next.has(shot.id)) next.delete(shot.id); else next.add(shot.id); return next })}
                    title="翻面查看提示词/原文锚/改编说明"
                  >
                    {isBack ? '正面' : '背面'}
                  </button>
                  <button type="button" className="sb-mini-btn" aria-pressed={isEditing} onClick={() => setEditingId(isEditing ? null : shot.id)}>
                    {isEditing ? '收起' : '编辑'}
                  </button>
                </div>
                <div className="sb-shot-body">
                  {!isBack && (
                    <>
                      <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
                        <div className="sb-kv"><dt>画面</dt><dd>{shot.visual || '（未填）'}</dd></div>
                        {shot.dialogue.map((line, li) => (
                          <div className="sb-kv" key={`${shot.id}-d${li}`}>
                            <dt>对白{li + 1}</dt>
                            <dd className="dialogue"><span className="sb-speaker">{charName(line.speakerId)}</span>「{line.text}」</dd>
                          </div>
                        ))}
                        {shot.narration !== '' && <div className="sb-kv"><dt>旁白</dt><dd>{shot.narration}</dd></div>}
                        {shot.sound !== '' && <div className="sb-kv"><dt>音效</dt><dd>{shot.sound}</dd></div>}
                      </dl>
                      {shot.origin === 'source'
                        ? <div className="sb-quote">原文锚：{shot.sourceQuote}</div>
                        : <div className="sb-quote missing">改编新增镜头</div>}
                      <div className="sb-quote">改编说明：{shot.adaptationNote !== '' ? shot.adaptationNote : (shot.origin === 'source' ? '直取原文，无改动' : '（未填）')}</div>
                    </>
                  )}
                  {isBack && (
                    <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
                      <div className="sb-kv"><dt>图提示</dt><dd className="prompt">{shot.imagePrompt || '—'}</dd></div>
                      <div className="sb-kv"><dt>视频提示</dt><dd className="prompt">{shot.videoPrompt || '—'}</dd></div>
                      <div className="sb-kv"><dt>负面</dt><dd className="prompt">{shot.negativePrompt || '—'}</dd></div>
                      <div className="sb-kv"><dt>运镜</dt><dd>{shot.cameraMovement}</dd></div>
                      <div className="sb-kv"><dt>场景</dt><dd className="sb-mono">{shot.sceneId}</dd></div>
                    </dl>
                  )}

                  {isEditing && (
                    <div className="sb-edit" data-testid={`sb-edit-${shot.id}`}>
                      <label>地点 <input value={shot.location} onChange={(e) => updateShot(shot.id, { location: e.target.value })} /></label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label>时间 <input value={shot.timeOfDay} onChange={(e) => updateShot(shot.id, { timeOfDay: e.target.value })} /></label>
                        <label>景别
                          <select value={shot.framing} onChange={(e) => updateShot(shot.id, { framing: e.target.value as Shot['framing'] })}>
                            {FRAMINGS.map((f) => <option key={f} value={f}>{FRAMING_LABELS[f]}</option>)}
                          </select>
                        </label>
                      </div>
                      <label>画面（可拍摄动作） <textarea value={shot.visual} onChange={(e) => updateShot(shot.id, { visual: e.target.value })} /></label>
                      {shot.dialogue.map((line, li) => (
                        <div className="sb-line" key={`edit-${shot.id}-d${li}`}>
                          <label>说话人
                            <select value={line.speakerId} onChange={(e) => updateDialogue(shot.id, shot.dialogue.map((l, i) => (i === li ? { ...l, speakerId: e.target.value } : l)))}>
                              {doc.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </label>
                          <label>台词 <input value={line.text} onChange={(e) => updateDialogue(shot.id, shot.dialogue.map((l, i) => (i === li ? { ...l, text: e.target.value } : l)))} /></label>
                          <button type="button" className="sb-mini-btn sb-del" title="删除该句" onClick={() => updateDialogue(shot.id, shot.dialogue.filter((_, i) => i !== li))}>✕</button>
                        </div>
                      ))}
                      <button type="button" className="sb-mini-btn" style={{ justifySelf: 'start' }} disabled={doc.characters.length === 0}
                        onClick={() => updateDialogue(shot.id, [...shot.dialogue, { speakerId: doc.characters[0]?.id ?? '', text: '' }])}>
                        ＋ 对白句
                      </button>
                      <label>旁白 <textarea value={shot.narration} onChange={(e) => updateShot(shot.id, { narration: e.target.value })} /></label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label>音效 <input value={shot.sound} onChange={(e) => updateShot(shot.id, { sound: e.target.value })} /></label>
                        <label>估计时长（秒）
                          <input type="number" min={0.5} max={600} step={0.5} value={shot.estimatedDurationSeconds}
                            onChange={(e) => updateShot(shot.id, { estimatedDurationSeconds: Math.max(0.5, Math.min(600, Number(e.target.value) || 0.5)) })} />
                        </label>
                      </div>
                      <label>图像提示词 <textarea value={shot.imagePrompt} onChange={(e) => updateShot(shot.id, { imagePrompt: e.target.value })} /></label>
                      <label>视频提示词 <textarea value={shot.videoPrompt} onChange={(e) => updateShot(shot.id, { videoPrompt: e.target.value })} /></label>
                      <label>负面提示词 <input value={shot.negativePrompt} onChange={(e) => updateShot(shot.id, { negativePrompt: e.target.value })} /></label>
                      <label>改编说明 <input value={shot.adaptationNote} onChange={(e) => updateShot(shot.id, { adaptationNote: e.target.value })} /></label>
                      <button type="button" className="sb-btn danger-ghost" style={{ justifySelf: 'start' }}
                        onClick={() => {
                          if (!window.confirm(`删除镜头 ${index + 1}？`)) return
                          setDoc((prev) => (prev === null ? prev : { ...prev, shots: prev.shots.filter((s) => s.id !== shot.id) }))
                          touch()
                          setEditingId(null)
                        }}>
                        删除此镜头
                      </button>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {doc === null && (
        <div className="sb-empty" data-testid="sb-workspace-empty">
          选择章节 → 生成分镜候选（或从下方打开已保存版本）。改编为独立衍生作品：原文不被修改。
        </div>
      )}

      {/* 已保存版本 */}
      <section className="sb-panel">
        <b>已保存版本（{savedList.length}）</b>
        {savedList.length === 0 && <div className="sb-note" style={{ marginTop: 6 }}>本书还没有保存过的分镜。</div>}
        {savedList.map((item) => (
          <div className="sb-list-row" key={item.id}>
            <span className="sb-grow">{item.title}</span>
            {item.sourceStale && <span className="sb-badge stale">源已变更</span>}
            <span className="sb-note sb-mono">r{item.revision}</span>
            <button type="button" className="sb-mini-btn" onClick={() => { void handleOpenSaved(item.id) }}>打开</button>
          </div>
        ))}
      </section>
    </div>
  )
}
