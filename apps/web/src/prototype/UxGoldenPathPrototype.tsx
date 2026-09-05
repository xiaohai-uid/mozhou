import { FormEvent, useEffect, useMemo, useState } from 'react'
import './ux-golden-path-prototype.css'

/**
 * THROWAWAY UX PROTOTYPE.
 * Question: which information architecture best supports the core writing path?
 * Three variants, switchable with ?prototype=ux-golden-path&variant=A|B|C.
 */
type Variant = 'A' | 'B' | 'C'

type Snapshot = {
  title: string
  direction: string
  text: string
}

const STORAGE_KEY = 'mozhou.prototype.ux-golden-path.v1'
const VARIANTS: readonly Variant[] = ['A', 'B', 'C']
const SAMPLE_OPENING = '　　潮汐钟在凌晨两点十三分停了。\n　　林岚醒来时，桌上多了一张没有乘客姓名的末班船票。'
const SAMPLE_CANDIDATE = '　　窗外的潮声忽然低了下去，像有什么东西贴着整座城屏住呼吸。林岚翻过船票，背面原本空白的位置慢慢浮出一行湿漉漉的字：别让他们想起我。'

function readSnapshot(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const value = JSON.parse(raw) as Partial<Snapshot>
    if (typeof value.title !== 'string' || typeof value.direction !== 'string' || typeof value.text !== 'string') return null
    return { title: value.title, direction: value.direction, text: value.text }
  } catch {
    return null
  }
}

function currentVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get('variant')
  return value === 'B' || value === 'C' ? value : 'A'
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
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
    setSavedAt(null)
    record()
  }

  const generateCandidate = (): void => {
    if (prompt.trim().length === 0) return
    setCandidate(SAMPLE_CANDIDATE)
    record()
  }

  const acceptCandidate = (): void => {
    if (candidate === null) return
    setText((current) => `${current}\n${candidate}`)
    setCandidate(null)
    record()
  }

  const rejectCandidate = (): void => {
    setCandidate(null)
    record()
  }

  const save = (): void => {
    const snapshot: Snapshot = {
      title: title.trim() || '未命名之书',
      direction: direction.trim(),
      text,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    setSavedAt(`已保存 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    record()
  }

  const reset = (): void => {
    window.localStorage.removeItem(STORAGE_KEY)
    setTitle('')
    setDirection('')
    setBookReady(false)
    setText(SAMPLE_OPENING)
    setCandidate(null)
    setSavedAt(null)
    setActionCount(0)
  }

  const shared = {
    title,
    direction,
    text,
    prompt,
    candidate,
    savedAt,
    detailsOpen,
    chaptersOpen,
    setText,
    setPrompt,
    generateCandidate,
    acceptCandidate,
    rejectCandidate,
    save,
    toggleDetails: () => { setDetailsOpen((open) => !open); record() },
    toggleChapters: () => { setChaptersOpen((open) => !open); record() },
  }

  return (
    <main className="uxp" lang="zh-CN" data-variant={variant} data-prototype-action-count={actionCount}>
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
      ) : (
        <FocusFirst {...shared} />
      )}

      <VariantSwitcher variant={variant} actions={actionCount} onChange={switchVariant} />
    </main>
  )
}

function StartBook({
  title,
  direction,
  setTitle,
  setDirection,
  onSubmit,
}: {
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
      <h1>先开始写，设定可以边写边补。</h1>
      <p className="uxp-lead">这里只问两件现在就有用的事。世界观、大纲和角色资料进入写作后再按需补充。</p>
      <form onSubmit={onSubmit} className="uxp-start-form">
        <label>
          <span>作品名</span>
          <input aria-label="作品名" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：潮汐钟之后" autoFocus />
        </label>
        <label>
          <span>我想写什么 <i>可跳过</i></span>
          <textarea aria-label="作品方向" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="例如：一座城市会逐渐忘记被潮汐钟点名的人，主角必须找回一个所有人都不记得的朋友。" />
        </label>
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
  savedAt: string | null
  detailsOpen: boolean
  chaptersOpen: boolean
  setText: (value: string) => void
  setPrompt: (value: string) => void
  generateCandidate: () => void
  acceptCandidate: () => void
  rejectCandidate: () => void
  save: () => void
  toggleDetails: () => void
  toggleChapters: () => void
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
          <article className="uxp-message assistant">
            <span>舟</span>
            <div><b>继续第一章？</b><p>告诉我下一段想发生什么，我会先给候选，不直接改正文。</p></div>
          </article>
          {props.candidate !== null && (
            <article className="uxp-message assistant candidate-message">
              <span>舟</span>
              <div><b>候选续写</b><p>{props.candidate}</p><div className="uxp-candidate-actions"><button className="uxp-primary" onClick={props.acceptCandidate}>写入正文</button><button onClick={props.rejectCandidate}>不要这版</button></div></div>
            </article>
          )}
        </div>
        <AiDock prompt={props.prompt} setPrompt={props.setPrompt} onGenerate={props.generateCandidate} label="发送给墨舟" />
      </section>
      <section className="uxp-manuscript-preview">
        <div className="uxp-preview-head"><b>正文</b><span>第一章</span></div>
        <textarea aria-label="正文" value={props.text} onChange={(event) => props.setText(event.target.value)} />
        <button className="uxp-link" type="button" onClick={props.toggleDetails}>{props.detailsOpen ? '隐藏上下文详情' : '这次 AI 读了什么？'}</button>
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
      {props.chaptersOpen && (
        <nav className="uxp-chapter-pop" aria-label="章节列表">
          <b>章节</b><button className="active">第一章 · 开场</button><button>＋ 新章节</button>
        </nav>
      )}
      <section className="uxp-focus-paper">
        <textarea className="uxp-prose" aria-label="正文" value={props.text} onChange={(event) => props.setText(event.target.value)} />
        <Candidate candidate={props.candidate} onAccept={props.acceptCandidate} onReject={props.rejectCandidate} />
      </section>
      <section className="uxp-focus-ai">
        <div className="uxp-focus-ai-head"><b>AI</b><button type="button" onClick={props.toggleDetails}>上下文</button></div>
        {props.detailsOpen && <ContextDetails direction={props.direction} />}
        <AiDock prompt={props.prompt} setPrompt={props.setPrompt} onGenerate={props.generateCandidate} label="生成候选" />
      </section>
    </div>
  )
}

function BookRail({ title }: { title: string }): JSX.Element {
  return (
    <aside className="uxp-rail">
      <div className="uxp-rail-brand"><span>墨</span><b>墨舟</b></div>
      <div className="uxp-book"><small>当前作品</small><b>《{title}》</b></div>
      <nav aria-label="章节">
        <small>章节</small>
        <button className="active">01　第一章 · 开场</button>
        <button>＋　新章节</button>
      </nav>
      <nav className="uxp-rail-secondary" aria-label="作品资料">
        <small>作品</small>
        <button>设定</button>
        <button>人物</button>
        <button>历史版本</button>
      </nav>
    </aside>
  )
}

function WorkspaceHeader({ title, savedAt, onSave, compact = false }: { title: string; savedAt: string | null; onSave: () => void; compact?: boolean }): JSX.Element {
  return (
    <header className={`uxp-work-head${compact ? ' compact' : ''}`}>
      <div><small>{compact ? '写作对话' : '第一章'}</small><b>{compact ? `《${title}》` : '开场'}</b></div>
      <button className="uxp-primary" type="button" onClick={onSave}>{savedAt ?? '保存'}</button>
    </header>
  )
}

function AiDock({ prompt, setPrompt, onGenerate, label = '生成候选' }: { prompt: string; setPrompt: (value: string) => void; onGenerate: () => void; label?: string }): JSX.Element {
  return (
    <div className="uxp-ai-dock">
      <textarea aria-label="AI 写作要求" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述下一段想发生什么，或选中文本后告诉墨舟怎么改" />
      <div><span>自动读取作品上下文 · 不会直接覆盖正文</span><button className="uxp-primary" type="button" onClick={onGenerate} disabled={prompt.trim().length === 0}>{label}</button></div>
    </div>
  )
}

function Candidate({ candidate, onAccept, onReject }: { candidate: string | null; onAccept: () => void; onReject: () => void }): JSX.Element | null {
  if (candidate === null) return null
  return (
    <section className="uxp-candidate" aria-label="AI 候选">
      <div><b>AI 候选</b><span>尚未写入正文</span></div>
      <p>{candidate}</p>
      <div className="uxp-candidate-actions"><button className="uxp-primary" type="button" onClick={onAccept}>接受并写入</button><button type="button" onClick={onReject}>拒绝</button></div>
    </section>
  )
}

function ContextDetails({ direction }: { direction: string }): JSX.Element {
  return (
    <div className="uxp-details">
      <span>原型样例</span>
      <b>本次自动上下文</b>
      <ul>
        <li>作品方向：{direction.trim() || '未填写'}</li>
        <li>最近正文：当前章可见内容</li>
        <li>人物与世界观：有资料时自动加入</li>
      </ul>
      <p>正式产品可在这里继续展开 Context Receipt、Quality Gate 等高级证据。</p>
    </div>
  )
}

function VariantSwitcher({ variant, actions, onChange }: { variant: Variant; actions: number; onChange: (variant: Variant) => void }): JSX.Element {
  const names: Record<Variant, string> = { A: '正文优先', B: '对话优先', C: '专注模式' }
  const move = (delta: number): void => {
    const index = VARIANTS.indexOf(variant)
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
    if (next !== undefined) onChange(next)
  }
  return (
    <div className="uxp-switcher" aria-label="UX 原型版本切换">
      <button aria-label="上一个版本" type="button" onClick={() => move(-1)}>←</button>
      <div><b>{variant} · {names[variant]}</b><span>原型操作 {actions}</span></div>
      <button aria-label="下一个版本" type="button" onClick={() => move(1)}>→</button>
    </div>
  )
}
