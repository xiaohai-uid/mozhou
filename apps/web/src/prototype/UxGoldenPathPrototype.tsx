import { FormEvent, useEffect, useMemo, useState } from 'react'
import './ux-golden-path-prototype.css'

/**
 * THROWAWAY UX PROTOTYPE.
 * A/B/C are the first reduction experiments.
 * D preserves the original Novel OS model and tests layered disclosure instead.
 */
type Variant = 'A' | 'B' | 'C' | 'D'
type DraftState = 'draft' | 'candidate' | 'accepted' | 'committed'
type InspectorTab = 'quality' | 'story' | 'context' | 'impact'

type Snapshot = {
  title: string
  direction: string
  text: string
  status: 'draft' | 'accepted' | 'committed'
}

const STORAGE_KEY = 'mozhou.prototype.ux-golden-path.v1'
const VARIANTS: readonly Variant[] = ['A', 'B', 'C', 'D']
const SAMPLE_OPENING = '　　潮汐钟在凌晨两点十三分停了。\n　　林岚醒来时，桌上多了一张没有乘客姓名的末班船票。'
const SAMPLE_CANDIDATE = '　　窗外的潮声忽然低了下去，像有什么东西贴着整座城屏住呼吸。林岚翻过船票，背面原本空白的位置慢慢浮出一行湿漉漉的字：别让他们想起我。'

const PIPELINE = [
  ['prepare', '准备'],
  ['compile', '装配'],
  ['draft', '草稿'],
  ['review', '审查'],
  ['extract', '提取'],
  ['continuity', '连续性'],
  ['proposal', '提案'],
  ['commit', '提交'],
] as const

const CAPABILITY_GROUPS = [
  ['创作', ['工作台', '写作对话', '我的作品', '风格蒸馏', '小说拆解']],
  ['检视 · Novel OS', ['Story Brain', '装配看板', '变更矩阵', '质量门']],
  ['工作流', ['任务中心']],
  ['资源', ['书源搜索', '书源书架', '技能广场', '网文扫榜', '联网搜索', '云同步']],
  ['账户', ['会员中心']],
] as const

function readSnapshot(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const value = JSON.parse(raw) as Partial<Snapshot>
    if (typeof value.title !== 'string' || typeof value.direction !== 'string' || typeof value.text !== 'string') return null
    const status = value.status === 'accepted' || value.status === 'committed' ? value.status : 'draft'
    return { title: value.title, direction: value.direction, text: value.text, status }
  } catch {
    return null
  }
}

function currentVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get('variant')
  return value === 'B' || value === 'C' || value === 'D' ? value : 'A'
}

export function UxGoldenPathPrototype(): JSX.Element {
  const restored = useMemo(readSnapshot, [])
  const [variant, setVariant] = useState<Variant>(currentVariant)
  const [title, setTitle] = useState(restored?.title ?? '')
  const [direction, setDirection] = useState(restored?.direction ?? '')
  const [bookReady, setBookReady] = useState(restored !== null)
  const [text, setText] = useState(restored?.text ?? SAMPLE_OPENING)
  const [prompt, setPrompt] = useState('让这一段更有压迫感，但不要推进太快')
  const [candidate, setCandidate] = useState<string | null>(null)
  const [draftState, setDraftState] = useState<DraftState>(restored?.status === 'committed' ? 'committed' : restored?.status === 'accepted' ? 'accepted' : 'draft')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('quality')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(restored === null ? null : '已从上次保存恢复')
  const [actionCount, setActionCount] = useState(0)

  const record = (): void => setActionCount((count) => count + 1)

  const switchVariant = (next: Variant): void => {
    const url = new URL(window.location.href)
    url.searchParams.set('prototype', 'ux-golden-path')
    url.searchParams.set('variant', next)
    window.history.replaceState(null, '', url)
    setVariant(next)
    setDetailsOpen(false)
    setChaptersOpen(false)
    setCapabilitiesOpen(false)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const index = VARIANTS.indexOf(variant)
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
      if (next !== undefined) switchVariant(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [variant])

  const createBook = (event: FormEvent): void => {
    event.preventDefault()
    if (title.trim().length === 0) return
    setBookReady(true)
    setText(SAMPLE_OPENING)
    setCandidate(null)
    setDraftState('draft')
    setSavedAt(null)
    record()
  }

  const generateCandidate = (): void => {
    if (prompt.trim().length === 0) return
    setCandidate(SAMPLE_CANDIDATE)
    setDraftState('candidate')
    setInspectorTab('quality')
    record()
  }

  const acceptCandidate = (): void => {
    if (candidate === null) return
    setText((current) => `${current}\n${candidate}`)
    setCandidate(null)
    setDraftState('accepted')
    setInspectorTab('quality')
    record()
  }

  const rejectCandidate = (): void => {
    setCandidate(null)
    setDraftState('draft')
    record()
  }

  const writeSnapshot = (status: Snapshot['status']): void => {
    const snapshot: Snapshot = {
      title: title.trim() || '未命名之书',
      direction: direction.trim(),
      text,
      status,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  }

  const save = (): void => {
    const persistedStatus = draftState === 'committed' ? 'committed' : draftState === 'accepted' ? 'accepted' : 'draft'
    writeSnapshot(persistedStatus)
    setSavedAt(`已保存 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    record()
  }

  const commit = (): void => {
    if (draftState !== 'accepted') return
    writeSnapshot('committed')
    setDraftState('committed')
    setSavedAt('已提交 · rev.04')
    setInspectorTab('quality')
    record()
  }

  const reset = (): void => {
    window.localStorage.removeItem(STORAGE_KEY)
    setTitle('')
    setDirection('')
    setBookReady(false)
    setText(SAMPLE_OPENING)
    setCandidate(null)
    setDraftState('draft')
    setSavedAt(null)
    setInspectorTab('quality')
    setCapabilitiesOpen(false)
    setActionCount(0)
  }

  const shared: SharedProps = {
    title,
    direction,
    text,
    prompt,
    candidate,
    draftState,
    inspectorTab,
    savedAt,
    detailsOpen,
    chaptersOpen,
    setText,
    setPrompt,
    setInspectorTab,
    generateCandidate,
    acceptCandidate,
    rejectCandidate,
    save,
    commit,
    toggleDetails: () => { setDetailsOpen((open) => !open); record() },
    toggleChapters: () => { setChaptersOpen((open) => !open); record() },
    openCapabilities: () => { setCapabilitiesOpen(true); record() },
  }

  return (
    <main
      className="uxp"
      lang="zh-CN"
      data-variant={variant}
      data-prototype-phase={draftState}
      data-prototype-action-count={actionCount}
    >
      <header className="uxp-banner">
        <div><b>墨舟 UX 实验</b><span>THROWAWAY · 不接生产写入</span></div>
        <button type="button" onClick={reset}>重置实验</button>
      </header>

      {!bookReady ? (
        <StartBook title={title} direction={direction} setTitle={setTitle} setDirection={setDirection} onSubmit={createBook} />
      ) : variant === 'A' ? (
        <ManuscriptFirst {...shared} />
      ) : variant === 'B' ? (
        <ConversationFirst {...shared} />
      ) : variant === 'C' ? (
        <FocusFirst {...shared} />
      ) : (
        <LayeredNovelOs {...shared} />
      )}

      {capabilitiesOpen && <CapabilityDrawer onClose={() => setCapabilitiesOpen(false)} />}
      <VariantSwitcher variant={variant} actions={actionCount} onChange={switchVariant} />
    </main>
  )
}

function StartBook({ title, direction, setTitle, setDirection, onSubmit }: {
  title: string
  direction: string
  setTitle: (value: string) => void
  setDirection: (value: string) => void
  onSubmit: (event: FormEvent) => void
}): JSX.Element {
  return (
    <section className="uxp-start">
      <div className="uxp-seal">墨</div>
      <p className="uxp-kicker">新作品</p>
      <h1>先开始写，设定可以边写边补</h1>
      <p className="uxp-lead">这一轮只验证真实写作体验。世界观、大纲和角色资料会在写作中按需出现。</p>
      <form onSubmit={onSubmit} className="uxp-start-form">
        <label><span>作品名</span><input aria-label="作品名" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雾港失真" autoFocus /></label>
        <label><span>想写什么 <i>可跳过</i></span><textarea aria-label="作品方向" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="例如：近未来港城，一个修理师追查一张不存在的末班船票。" /></label>
        <button className="uxp-primary" type="submit" disabled={title.trim().length === 0}>开始写第一章</button>
      </form>
    </section>
  )
}

type SharedProps = {
  title: string
  direction: string
  text: string
  prompt: string
  candidate: string | null
  draftState: DraftState
  inspectorTab: InspectorTab
  savedAt: string | null
  detailsOpen: boolean
  chaptersOpen: boolean
  setText: (value: string) => void
  setPrompt: (value: string) => void
  setInspectorTab: (tab: InspectorTab) => void
  generateCandidate: () => void
  acceptCandidate: () => void
  rejectCandidate: () => void
  save: () => void
  commit: () => void
  toggleDetails: () => void
  toggleChapters: () => void
  openCapabilities: () => void
}

function ManuscriptFirst(props: SharedProps): JSX.Element {
  return (
    <div className="uxp-shell uxp-a">
      <BookRail title={props.title} />
      <section className="uxp-workspace">
        <WorkspaceHeader title={props.title} savedAt={props.savedAt} onSave={props.save} />
        <div className="uxp-editor-wrap">
          <p className="uxp-kicker">第一章 · 开场</p>
          <textarea className="uxp-prose" aria-label="正文" value={props.text} onChange={(event) => props.setText(event.target.value)} />
          <Candidate candidate={props.candidate} onAccept={props.acceptCandidate} onReject={props.rejectCandidate} />
        </div>
        <AiDock prompt={props.prompt} setPrompt={props.setPrompt} onGenerate={props.generateCandidate} />
      </section>
      <aside className="uxp-context">
        <h2>写作助手</h2>
        <p>墨舟会自动带上本书已有资料。普通写作不需要先理解管线。</p>
        <button type="button" onClick={props.toggleDetails}>{props.detailsOpen ? '收起系统详情' : '查看本次使用了什么'}</button>
        {props.detailsOpen && <ContextDetails direction={props.direction} />}
      </aside>
    </div>
  )
}

function ConversationFirst(props: SharedProps): JSX.Element {
  return (
    <div className="uxp-shell uxp-b">
      <BookRail title={props.title} />
      <section className="uxp-chat">
        <WorkspaceHeader title={props.title} savedAt={props.savedAt} onSave={props.save} compact />
        <div className="uxp-chat-stream">
          <article className="uxp-message assistant"><span>墨</span><div><b>先确认一下：</b><p>这一章最想让读者感到什么？不需要选模板，直接告诉我。</p></div></article>
          {props.candidate !== null && <article className="uxp-message assistant candidate-message"><span>墨</span><div><b>候选续写</b><p>{props.candidate}</p><div className="uxp-candidate-actions"><button className="uxp-primary" onClick={props.acceptCandidate}>写入正文</button><button onClick={props.rejectCandidate}>不要这段</button></div></div></article>}
        </div>
        <AiDock prompt={props.prompt} setPrompt={props.setPrompt} onGenerate={props.generateCandidate} label="发送给墨舟" />
      </section>
      <section className="uxp-manuscript-preview">
        <div className="uxp-preview-head"><b>正文</b><span>第一章</span></div>
        <textarea aria-label="正文" value={props.text} onChange={(event) => props.setText(event.target.value)} />
        <button className="uxp-link" type="button" onClick={props.toggleDetails}>{props.detailsOpen ? '收起生成依据' : '这次 AI 读了什么？'}</button>
        {props.detailsOpen && <ContextDetails direction={props.direction} />}
      </section>
    </div>
  )
}

function FocusFirst(props: SharedProps): JSX.Element {
  return (
    <div className="uxp-focus">
      <header className="uxp-focus-head">
        <button type="button" onClick={props.toggleChapters}>章节</button>
        <div><b>《{props.title}》</b><span>第一章 · 开场</span></div>
        <button className="uxp-primary" type="button" onClick={props.save}>{props.savedAt ?? '保存'}</button>
      </header>
      {props.chaptersOpen && <nav className="uxp-chapter-pop" aria-label="章节列表"><b>章节</b><button className="active">第一章 · 开场</button><button>＋ 新章节</button></nav>}
      <section className="uxp-focus-paper"><textarea className="uxp-prose" aria-label="正文" value={props.text} onChange={(event) => props.setText(event.target.value)} /><Candidate candidate={props.candidate} onAccept={props.acceptCandidate} onReject={props.rejectCandidate} /></section>
      <section className="uxp-focus-ai"><div className="uxp-focus-ai-head"><b>AI</b><button type="button" onClick={props.toggleDetails}>依据</button></div>{props.detailsOpen && <ContextDetails direction={props.direction} />}<AiDock prompt={props.prompt} setPrompt={props.setPrompt} onGenerate={props.generateCandidate} /></section>
    </div>
  )
}

function LayeredNovelOs(props: SharedProps): JSX.Element {
  return (
    <div className="uxp-d">
      <ProjectContextRail title={props.title} onOpenCapabilities={props.openCapabilities} />
      <LayeredPipeline state={props.draftState} />
      <section className="uxp-d-workspace" aria-label="章节写作区">
        <LayeredChapterHeader state={props.draftState} savedAt={props.savedAt} onCommit={props.commit} />
        <div className="uxp-d-scroll">
          <section className="uxp-d-intent" aria-label="本章意图">
            <span className="uxp-d-avatar">墨</span>
            <div>
              <small>墨舟先问</small>
              <p>这一章，你希望读者先感到什么？我会自动带上人物、世界规则和前文。</p>
              <em>{props.direction.trim() || '你还没有写作品方向，可以直接从这一章开始。'}</em>
            </div>
          </section>
          <div className="uxp-d-paper">
            <div className="uxp-d-paper-head"><div><small>CHAPTER 01</small><h1>第一章 · 开场</h1></div><span>正文由作者掌控</span></div>
            <textarea className="uxp-d-prose" aria-label="正文" value={props.text} onChange={(event) => props.setText(event.target.value)} />
            {props.candidate !== null && (
              <section className="uxp-d-candidate" aria-label="AI 候选">
                <header><div><small>CANDIDATE</small><b>候选 · 尚未进入正文</b></div><span>质量门已检查</span></header>
                <p>{props.candidate}</p>
                <div className="uxp-candidate-actions"><button className="uxp-primary" type="button" onClick={props.acceptCandidate}>接受到草稿</button><button type="button" onClick={props.rejectCandidate}>拒绝</button></div>
              </section>
            )}
          </div>
        </div>
        <div className="uxp-d-composer"><AiDock prompt={props.prompt} setPrompt={props.setPrompt} onGenerate={props.generateCandidate} /></div>
      </section>
      <LayeredInspector state={props.draftState} activeTab={props.inspectorTab} onTabChange={props.setInspectorTab} direction={props.direction} />
    </div>
  )
}

function ProjectContextRail({ title, onOpenCapabilities }: { title: string; onOpenCapabilities: () => void }): JSX.Element {
  return (
    <aside className="uxp-d-rail" aria-label="作品上下文">
      <div className="uxp-d-brand"><span>墨</span><div><b>墨舟</b><small>NOVEL OS</small></div></div>
      <button className="uxp-d-book"><small>当前作品</small><b>《{title}》</b><span>长篇 · 创作中</span></button>
      <nav className="uxp-d-section" aria-label="章节"><header><small>章节</small><span>18</span></header><button className="active"><span>01</span><b>第一章 · 开场</b></button><button><span>02</span><b>第二章 · 雨港</b></button><button className="quiet">＋ 新章节</button></nav>
      <nav className="uxp-d-section uxp-d-story" aria-label="故事上下文"><header><small>故事上下文</small><span>自动参与写作</span></header><button><b>人物 · 6</b><span>林岚 / 阿雀 / 陈渡…</span></button><button><b>世界观 · 4</b><span>雾港 / 潮汐钟 / 渡船规则…</span></button><button><b>大纲 · 18 章</b><span>当前：第一幕 1/6</span></button></nav>
      <div className="uxp-d-rail-foot"><button type="button" onClick={onOpenCapabilities} aria-label="全部能力"><span>⌘</span><div><b>全部能力</b><small>扫榜、拆解、技能、同步…</small></div></button></div>
    </aside>
  )
}

function LayeredPipeline({ state }: { state: DraftState }): JSX.Element {
  const activeIndex = state === 'draft' ? 2 : state === 'candidate' ? 3 : state === 'accepted' ? 6 : 7
  return (
    <nav className="uxp-d-pipeline" aria-label="章节生产阶段">
      {PIPELINE.map(([id, label], index) => {
        const active = index === activeIndex
        const done = index < activeIndex || (state === 'committed' && index === activeIndex)
        return <div key={id} data-stage={id} className={`${active ? 'active' : ''}${done ? ' done' : ''}`.trim()}><i /><span>{id}</span><b>{label}</b></div>
      })}
    </nav>
  )
}

function LayeredChapterHeader({ state, savedAt, onCommit }: { state: DraftState; savedAt: string | null; onCommit: () => void }): JSX.Element {
  const label = state === 'candidate' ? '候选待决定' : state === 'accepted' ? '已接受 · 尚未提交' : state === 'committed' ? '已提交 · rev.04' : savedAt ?? '草稿 · 未提交'
  return (
    <header className="uxp-d-chapter-head">
      <div><small>《雾港失真》 / 第一章</small><b>开场</b></div>
      <div className="uxp-d-chapter-actions"><span data-state={state}>{label}</span>{state === 'accepted' && <button className="uxp-primary" type="button" onClick={onCommit}>提交本章</button>}</div>
    </header>
  )
}

function LayeredInspector({ state, activeTab, onTabChange, direction }: { state: DraftState; activeTab: InspectorTab; onTabChange: (tab: InspectorTab) => void; direction: string }): JSX.Element {
  const tabs: Array<[InspectorTab, string]> = [['quality', '质量'], ['story', '故事'], ['context', '上下文'], ['impact', '影响']]
  return (
    <aside className="uxp-d-inspector" aria-label="情境检视">
      <div className="uxp-d-tabs" role="tablist" aria-label="检视视角">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => onTabChange(id)}>{label}</button>)}
      </div>
      <div className="uxp-d-inspector-body">
        {activeTab === 'quality' ? <QualitySummary state={state} /> : activeTab === 'story' ? <StorySummary /> : activeTab === 'context' ? <ContextSummary direction={direction} /> : <ImpactSummary />}
      </div>
    </aside>
  )
}

function QualitySummary({ state }: { state: DraftState }): JSX.Element {
  return (
    <section className="uxp-d-evidence">
      <p className="uxp-kicker">QUALITY GATE</p>
      <h2>{state === 'candidate' ? '可继续 · 1 条建议' : state === 'accepted' ? '已接受 · 等待提交' : state === 'committed' ? 'Write Verification 通过' : '等待下一次生成'}</h2>
      {state === 'candidate' ? <><div className="uxp-d-verdict pass"><b>PASS</b><span>无 blocking failure</span></div><article><small>ADVISORY · PACING-021</small><p>压迫感已经建立，但连续三个感官句可能拖慢推进。建议下一段让角色做出一个可观察动作。</p></article><footer>Continuity Gate：通过 · POV：林岚</footer></> : state === 'accepted' ? <><div className="uxp-d-verdict wait"><b>ACCEPTED</b><span>正文已变化，但尚未 durable commit</span></div><article><small>AUTHOR SOVEREIGNTY</small><p>你已经接受候选到 Active Draft。只有“提交本章”成功后，才会进入 Committed。</p></article></> : state === 'committed' ? <><div className="uxp-d-verdict pass"><b>COMMITTED</b><span>rev.04 · hash verified</span></div><article><small>WRITE VERIFICATION</small><p>正文、章节 revision 与本次提交记录一致。候选审批链已闭合。</p></article></> : <><div className="uxp-d-verdict quiet"><b>IDLE</b><span>质量门不会打扰写作</span></div><article><small>下一步</small><p>生成候选后，这里才提升为本次最相关的系统证据。</p></article></>}
    </section>
  )
}

function StorySummary(): JSX.Element {
  return <section className="uxp-d-evidence"><p className="uxp-kicker">STORY BRAIN</p><h2>故事现在是什么状态？</h2><div className="uxp-d-metric-grid"><div><small>当前 POV</small><b>林岚</b></div><div><small>开放承诺</small><b>3</b></div><div><small>Canon</small><b>18</b></div><div><small>Suspect</small><b>2</b></div></div><article><small>活跃事实</small><p>林岚不知道“末班船票”来自谁；阿雀知道潮汐钟停摆与旧港封锁有关，但尚未告诉林岚。</p></article><article><small>当前大纲节点</small><p>第一幕 / 触发事件：让船票第一次表现出“不属于现实”的证据。</p></article></section>
}

function ContextSummary({ direction }: { direction: string }): JSX.Element {
  return <section className="uxp-d-evidence"><p className="uxp-kicker">CONTEXT RECEIPT</p><h2>已读取 4 类 · 6,438 tokens</h2><div className="uxp-d-budget"><span style={{ width: '72%' }} /></div><ul className="uxp-d-receipt"><li><b>人物状态</b><span>1,420 tok · 林岚 / 阿雀</span></li><li><b>世界规则</b><span>1,108 tok · 潮汐钟 / 渡船规则</span></li><li><b>当前章节末尾</b><span>2,640 tok · rev.03</span></li><li><b>作者意图</b><span>1,270 tok · {direction.trim() || '本章临时意图'}</span></li></ul><footer>这些内容参与本次生成；需要时可继续展开完整 Receipt。</footer></section>
}

function ImpactSummary(): JSX.Element {
  return <section className="uxp-d-evidence"><p className="uxp-kicker">CHANGE IMPACT</p><h2>当前无 stale 章节</h2><div className="uxp-d-verdict pass"><b>0 章需重写</b><span>最近一次 traversal 已消解</span></div><article><small>为什么这里平时很安静？</small><p>只有人物、世界规则或正典事实发生变化并影响后文章节时，变更矩阵才会主动抬升。</p></article></section>
}

function CapabilityDrawer({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="uxp-d-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="uxp-d-drawer" role="dialog" aria-modal="true" aria-label="全部能力">
        <header><div><small>CAPABILITY INDEX</small><h2>全部能力</h2><p>这些能力都可达，但不会在你写这一章时持续占据注意力。</p></div><button type="button" aria-label="关闭全部能力" onClick={onClose}>×</button></header>
        <div className="uxp-d-cap-grid">{CAPABILITY_GROUPS.map(([group, items]) => <section key={group}><small>{group}</small>{items.map((item) => <button key={item} type="button">{item}<span>↗</span></button>)}</section>)}</div>
      </section>
    </div>
  )
}

function BookRail({ title }: { title: string }): JSX.Element {
  return <aside className="uxp-rail"><div className="uxp-rail-brand"><span>墨</span><b>墨舟</b></div><div className="uxp-book"><small>当前作品</small><b>《{title}》</b></div><nav aria-label="章节"><small>章节</small><button className="active">01　第一章 · 开场</button><button>＋　新章节</button></nav><nav className="uxp-rail-secondary" aria-label="作品资料"><small>作品</small><button>设定</button><button>人物</button><button>历史版本</button></nav></aside>
}

function WorkspaceHeader({ title, savedAt, onSave, compact = false }: { title: string; savedAt: string | null; onSave: () => void; compact?: boolean }): JSX.Element {
  return <header className={`uxp-work-head${compact ? ' compact' : ''}`}><div><small>{compact ? '写作对话' : '第一章'}</small><b>{compact ? `《${title}》` : '开场'}</b></div><button className="uxp-primary" type="button" onClick={onSave}>{savedAt ?? '保存'}</button></header>
}

function AiDock({ prompt, setPrompt, onGenerate, label = '生成候选' }: { prompt: string; setPrompt: (value: string) => void; onGenerate: () => void; label?: string }): JSX.Element {
  return <div className="uxp-ai-dock"><textarea aria-label="AI 写作要求" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述下一段想发生什么，或选中文本后告诉墨舟怎么改" /><div><span>自动读取作品上下文 · 不会直接覆盖正文</span><button className="uxp-primary" type="button" onClick={onGenerate} disabled={prompt.trim().length === 0}>{label}</button></div></div>
}

function Candidate({ candidate, onAccept, onReject }: { candidate: string | null; onAccept: () => void; onReject: () => void }): JSX.Element | null {
  if (candidate === null) return null
  return <section className="uxp-candidate" aria-label="AI 候选"><div><b>AI 候选</b><span>尚未写入正文</span></div><p>{candidate}</p><div className="uxp-candidate-actions"><button className="uxp-primary" type="button" onClick={onAccept}>接受并写入</button><button type="button" onClick={onReject}>拒绝</button></div></section>
}

function ContextDetails({ direction }: { direction: string }): JSX.Element {
  return <div className="uxp-details"><span>原则验证</span><b>系统自动处理复杂度</b><ul><li>作品方向：{direction.trim() || '未填写'}</li><li>人物 / 世界观 / 当前章可见正文</li><li>连续性与质量门在需要时自动出现</li></ul><p>正式产品可继续展开 Context Receipt、Quality Gate 等高级证据。</p></div>
}

function VariantSwitcher({ variant, actions, onChange }: { variant: Variant; actions: number; onChange: (variant: Variant) => void }): JSX.Element {
  const names: Record<Variant, string> = { A: '正文优先', B: '对话优先', C: '专注模式', D: '分层工作台' }
  const move = (delta: number): void => {
    const index = VARIANTS.indexOf(variant)
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
    if (next !== undefined) onChange(next)
  }
  return <div className="uxp-switcher" aria-label="UX 原型版本切换"><button aria-label="上一个版本" type="button" onClick={() => move(-1)}>←</button><div><b>{variant} · {names[variant]}</b><span>原型操作 {actions}</span></div><button aria-label="下一个版本" type="button" onClick={() => move(1)}>→</button></div>
}
