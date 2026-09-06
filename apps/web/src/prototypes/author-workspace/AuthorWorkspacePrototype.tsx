import { useEffect, useMemo, useState } from 'react'
import './author-workspace-prototype.css'

type VariantKey = 'A' | 'B' | 'C'
type InspectorMode = 'chapter' | 'story' | 'impact' | 'quality' | 'receipt'
type CandidateState = 'pending' | 'accepted' | 'rejected'

const TASKS = [
  { id: 'works', label: '作品', mark: '作', note: '继续写作与版本' },
  { id: 'writing', label: '写作', mark: '写', note: '正文、候选与提交' },
  { id: 'story', label: '故事', mark: '故', note: '人物、事实与关系' },
  { id: 'revision', label: '修订', mark: '修', note: '影响分析与回滚' },
  { id: 'review', label: '审稿', mark: '审', note: '质量与连续性' },
  { id: 'research', label: '研究发布', mark: '研', note: '市场、资料与交付' },
] as const

type TaskId = (typeof TASKS)[number]['id']

const SKILLS = ['续写', '悬念调度', '对白打磨', '人物一致性'] as const

const INSPECTOR_COPY: Record<InspectorMode, { eyebrow: string; title: string; body: string; rows: readonly [string, string][] }> = {
  chapter: {
    eyebrow: 'CHAPTER INTENT',
    title: '第 37 章要兑现什么',
    body: '这一章只需要完成两个动作：确认沈砚是否知道船票的来源，并让“空白姓名”第一次成为可验证事实。',
    rows: [['场景目标', '灯塔仓库内完成第一次正面核验'], ['不可越界', '沈砚尚不知道潮汐钟与母亲有关'], ['章末承诺', '船票上的姓名在雨水中重新出现']],
  },
  story: {
    eyebrow: 'STORY BRAIN',
    title: '当前选中：沈砚',
    body: '人物事实、认知边界与关系状态只在需要时出现，不占用日常写作视野。',
    rows: [['Canon', '曾在旧港务局工作 4 年'], ['Knows', '知道周既明隐瞒过一次航线记录'], ['Does not know', '不知道母亲曾进入灯塔地下层']],
  },
  impact: {
    eyebrow: 'CHANGE IMPACT',
    title: '修改旧事实前先看影响',
    body: '如果把“周既明 18 岁离港”改为 21 岁，系统先展示受影响章节，再由作者决定是否提交变更。',
    rows: [['直接受影响', '第 12、19、34 章'], ['派生风险', '2 条人物年龄计算需要重算'], ['建议动作', '先修第 19 章，再刷新后续 Context Receipt']],
  },
  quality: {
    eyebrow: 'QUALITY REVIEW',
    title: '提交前的最后一眼',
    body: '质量能力不在写作中持续打断作者，只在候选完成或准备提交时汇总。',
    rows: [['机械问题', '1 处解释性对白偏直'], ['读者体验', '悬念清晰，信息释放略快'], ['连续性', '当前无 Canon 冲突']],
  },
  receipt: {
    eyebrow: 'CONTEXT RECEIPT',
    title: 'AI 为什么知道这些',
    body: '这次生成只装配了与当前场景有关的事实。Receipt 是解释面，不是另一个需要作者维护的数据库。',
    rows: [['固定上下文', 'Author Intent / 第 37 章目标'], ['召回事实', '6 条 Canon + 2 条 Knowledge'], ['未注入', '第 4 卷尚未发生的 3 个秘密']],
  },
}

const INITIAL_BODY = `雨水顺着灯塔外墙的铆钉往下淌，像一串被人故意擦掉的字。\n\n沈砚把那张旧船票压在掌心。纸已经发软，唯独“乘客姓名”四个字下面仍是一片不合常理的空白。\n\n周既明站在仓库门边，没有催他。远处潮声一次比一次近，铁门上的锈屑随风轻轻震动。\n\n“你昨晚说，这张票不是第一次出现。”沈砚抬头。\n\n周既明没有回答，只把手里的钥匙放在木箱上。`

const CANDIDATE_TEXT = '周既明的目光在船票上停了半秒，随后移向门外。那不是惊讶，更像是在确认某件终于发生的事。'

function setUrlVariant(next: VariantKey): void {
  const url = new URL(window.location.href)
  url.searchParams.set('prototype', 'author-workspace')
  url.searchParams.set('variant', next)
  window.history.replaceState({}, '', url)
}

function useVariant(): [VariantKey, (variant: VariantKey) => void] {
  const [variant, setVariantState] = useState<VariantKey>(() => {
    const raw = new URLSearchParams(window.location.search).get('variant')
    return raw === 'B' || raw === 'C' ? raw : 'A'
  })

  const setVariant = (next: VariantKey): void => {
    setVariantState(next)
    setUrlVariant(next)
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const order: VariantKey[] = ['A', 'B', 'C']
      const index = order.indexOf(variant)
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = order[(index + delta + order.length) % order.length] ?? 'A'
      setVariant(next)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [variant])

  return [variant, setVariant]
}

function PrototypeHeader({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <header className={'awp-header' + (compact ? ' awp-header-compact' : '')}>
      <div className="awp-brand">
        <span className="awp-seal">墨</span>
        <span>
          <b>墨舟</b>
          <small>AUTHOR WORKSPACE OS · THROWAWAY SPIKE</small>
        </span>
      </div>
      <button type="button" className="awp-book-switch" aria-label="切换作品">
        <span className="awp-book-glyph">潮</span>
        <span><b>潮汐失语者</b><small>第 37 章 · 灯塔下的空白姓名</small></span>
      </button>
      <div className="awp-header-meta">
        <span className="awp-status-dot" /> 本地已保存
        <span className="awp-divider" />
        <span>1,846 字</span>
      </div>
    </header>
  )
}

function TaskRail({ active, onSelect, dense = false }: { active: TaskId; onSelect: (task: TaskId) => void; dense?: boolean }): JSX.Element {
  return (
    <nav className={'awp-task-rail' + (dense ? ' awp-task-rail-dense' : '')} aria-label="作者任务空间">
      <div className="awp-rail-label">作者任务</div>
      {TASKS.map((task) => (
        <button
          key={task.id}
          type="button"
          className={'awp-task' + (active === task.id ? ' active' : '')}
          onClick={() => onSelect(task.id)}
        >
          <span className="awp-task-mark">{task.mark}</span>
          <span className="awp-task-copy"><b>{task.label}</b>{!dense && <small>{task.note}</small>}</span>
        </button>
      ))}
      <div className="awp-rail-spacer" />
      <div className="awp-loadout">
        <span>本书 Loadout</span>
        <b>基础写作 · 悬疑</b>
        <small>4 个 Skill 已启用</small>
      </div>
    </nav>
  )
}

function ChapterRail(): JSX.Element {
  return (
    <aside className="awp-chapter-rail" aria-label="章节列表">
      <div className="awp-chapter-rail-head"><span>第三卷 · 无名航线</span><button type="button" aria-label="新增章节">＋</button></div>
      {[34, 35, 36, 37, 38, 39].map((index) => (
        <button key={index} type="button" className={'awp-chapter-item' + (index === 37 ? ' active' : '')}>
          <span>{String(index).padStart(2, '0')}</span>
          <span><b>{index === 37 ? '灯塔下的空白姓名' : ['离港记录', '潮汐钟', '雨夜船票', '地下层', '回声档案'][Math.abs(index - 34) % 5]}</b><small>{index === 37 ? '正在写作' : index < 37 ? '已提交' : '未开始'}</small></span>
        </button>
      ))}
      <div className="awp-chapter-rule" />
      <button type="button" className="awp-text-action">查看整卷结构</button>
    </aside>
  )
}

function CandidateBlock({ state, onChange }: { state: CandidateState; onChange: (state: CandidateState) => void }): JSX.Element {
  if (state === 'accepted') {
    return <div className="awp-candidate awp-candidate-done"><span>AI 候选已接受到草稿</span><button type="button" onClick={() => onChange('pending')}>撤销演示</button></div>
  }
  if (state === 'rejected') {
    return <div className="awp-candidate awp-candidate-done"><span>AI 候选已拒绝，正文未改变</span><button type="button" onClick={() => onChange('pending')}>重新查看</button></div>
  }
  return (
    <section className="awp-candidate" aria-label="AI 候选修改">
      <div className="awp-candidate-head">
        <span><i /> AI CANDIDATE</span>
        <small>悬念调度 · 对白打磨</small>
      </div>
      <p>{CANDIDATE_TEXT}</p>
      <div className="awp-candidate-actions">
        <button type="button" className="accept" onClick={() => onChange('accepted')}>接受到草稿</button>
        <button type="button">编辑后接受</button>
        <button type="button" onClick={() => onChange('rejected')}>拒绝</button>
      </div>
      <small className="awp-authority-note">Candidate 不是 Canon。只有作者提交章节后才进入正式故事状态。</small>
    </section>
  )
}

function WritingCanvas({ candidateState, onCandidateChange, quiet = false }: { candidateState: CandidateState; onCandidateChange: (state: CandidateState) => void; quiet?: boolean }): JSX.Element {
  const [body, setBody] = useState(INITIAL_BODY)
  return (
    <main className={'awp-writing' + (quiet ? ' awp-writing-quiet' : '')}>
      <div className="awp-writing-head">
        <div><span className="awp-kicker">CHAPTER 37</span><h1>灯塔下的空白姓名</h1></div>
        <div className="awp-writing-actions"><button type="button">专注</button><button type="button">版本</button><button type="button" className="primary">准备提交</button></div>
      </div>
      <div className="awp-intent-line"><span>本章目标</span><p>让沈砚第一次确认“空白姓名”不是印刷缺陷，而是被人为抹去的事实。</p></div>
      <article className="awp-manuscript">
        <textarea aria-label="原型章节正文" value={body} onChange={(event) => setBody(event.target.value)} />
        <CandidateBlock state={candidateState} onChange={onCandidateChange} />
      </article>
    </main>
  )
}

function ContextInspector({ mode, onMode }: { mode: InspectorMode; onMode: (mode: InspectorMode) => void }): JSX.Element {
  const copy = INSPECTOR_COPY[mode]
  return (
    <aside className="awp-inspector" aria-label="事件感知检视器">
      <div className="awp-inspector-tabs">
        {(['chapter', 'story', 'impact', 'quality', 'receipt'] as const).map((item) => (
          <button key={item} type="button" aria-pressed={mode === item} onClick={() => onMode(item)}>
            {{ chapter: '章', story: '故', impact: '变', quality: '审', receipt: '据' }[item]}
          </button>
        ))}
      </div>
      <div className="awp-inspector-body">
        <span className="awp-kicker">{copy.eyebrow}</span>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        <dl>
          {copy.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </div>
      <div className="awp-inspector-foot"><span className="awp-status-dot" /> 当前仅展示与写作事件相关的信息</div>
    </aside>
  )
}

function SkillComposer({ selected, onToggle, condensed = false }: { selected: readonly string[]; onToggle: (skill: string) => void; condensed?: boolean }): JSX.Element {
  const [prompt, setPrompt] = useState('')
  return (
    <section className={'awp-composer' + (condensed ? ' awp-composer-condensed' : '')}>
      <div className="awp-skill-row">
        <span>Skills</span>
        {SKILLS.map((skill) => (
          <button key={skill} type="button" aria-pressed={selected.includes(skill)} onClick={() => onToggle(skill)}>{skill}</button>
        ))}
        <button type="button" className="awp-more-skill">＋</button>
      </div>
      <div className="awp-prompt-row">
        <button type="button" className="awp-context-button">Context · 自动</button>
        <input aria-label="给墨舟的写作指令" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述下一段要发生什么，或选中文字后要求改写…" />
        <button type="button" className="awp-send" disabled={prompt.trim().length === 0}>生成候选</button>
      </div>
    </section>
  )
}

function VariantA(props: SharedVariantProps): JSX.Element {
  return (
    <div className="awp-shell awp-variant-a">
      <PrototypeHeader />
      <TaskRail active={props.activeTask} onSelect={props.onTask} />
      <div className="awp-a-center">
        <WritingCanvas candidateState={props.candidateState} onCandidateChange={props.onCandidateChange} />
        <SkillComposer selected={props.skills} onToggle={props.onToggleSkill} />
      </div>
      <ContextInspector mode={props.inspectorMode} onMode={props.onInspectorMode} />
    </div>
  )
}

function VariantB(props: SharedVariantProps): JSX.Element {
  return (
    <div className="awp-shell awp-variant-b">
      <PrototypeHeader compact />
      <div className="awp-b-taskbar">
        {TASKS.map((task) => <button key={task.id} type="button" className={props.activeTask === task.id ? 'active' : ''} onClick={() => props.onTask(task.id)}><span>{task.mark}</span>{task.label}</button>)}
      </div>
      <ChapterRail />
      <WritingCanvas candidateState={props.candidateState} onCandidateChange={props.onCandidateChange} quiet />
      <ContextInspector mode={props.inspectorMode} onMode={props.onInspectorMode} />
      <SkillComposer selected={props.skills} onToggle={props.onToggleSkill} condensed />
    </div>
  )
}

function VariantC(props: SharedVariantProps): JSX.Element {
  return (
    <div className="awp-shell awp-variant-c">
      <PrototypeHeader compact />
      <div className="awp-c-dock" aria-label="作者任务快捷入口">
        {TASKS.map((task) => <button key={task.id} type="button" className={props.activeTask === task.id ? 'active' : ''} onClick={() => props.onTask(task.id)} title={task.label}>{task.mark}</button>)}
      </div>
      <div className="awp-c-stage">
        <div className="awp-focus-breadcrumb"><span>潮汐失语者</span><i>/</i><span>第三卷</span><i>/</i><b>第 37 章</b></div>
        <WritingCanvas candidateState={props.candidateState} onCandidateChange={props.onCandidateChange} quiet />
        <SkillComposer selected={props.skills} onToggle={props.onToggleSkill} condensed />
      </div>
      <ContextInspector mode={props.inspectorMode} onMode={props.onInspectorMode} />
    </div>
  )
}

interface SharedVariantProps {
  activeTask: TaskId
  onTask: (task: TaskId) => void
  inspectorMode: InspectorMode
  onInspectorMode: (mode: InspectorMode) => void
  candidateState: CandidateState
  onCandidateChange: (state: CandidateState) => void
  skills: readonly string[]
  onToggleSkill: (skill: string) => void
}

const VARIANT_NAMES: Record<VariantKey, string> = {
  A: 'Writing-first · 任务空间 + 事件 Inspector',
  B: 'Chapter desk · 章节树 + 顶部任务切换',
  C: 'Focus canvas · 隐式任务 Dock + 最大正文',
}

function PrototypeSwitcher({ variant, onChange }: { variant: VariantKey; onChange: (variant: VariantKey) => void }): JSX.Element {
  const order: VariantKey[] = ['A', 'B', 'C']
  const index = order.indexOf(variant)
  const cycle = (delta: number): void => onChange(order[(index + delta + order.length) % order.length] ?? 'A')
  return (
    <div className="awp-switcher" role="toolbar" aria-label="UX 原型变体切换">
      <button type="button" onClick={() => cycle(-1)} aria-label="上一个变体">←</button>
      <span><b>{variant}</b><small>{VARIANT_NAMES[variant]}</small></span>
      <button type="button" onClick={() => cycle(1)} aria-label="下一个变体">→</button>
    </div>
  )
}

export function AuthorWorkspacePrototype(): JSX.Element {
  const [variant, setVariant] = useVariant()
  const [activeTask, setActiveTask] = useState<TaskId>('writing')
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('chapter')
  const [candidateState, setCandidateState] = useState<CandidateState>('pending')
  const [skills, setSkills] = useState<readonly string[]>(['续写', '悬念调度'])

  const taskToInspector = useMemo<Record<TaskId, InspectorMode>>(() => ({
    works: 'chapter',
    writing: 'chapter',
    story: 'story',
    revision: 'impact',
    review: 'quality',
    research: 'receipt',
  }), [])

  const handleTask = (task: TaskId): void => {
    setActiveTask(task)
    setInspectorMode(taskToInspector[task])
  }

  const handleToggleSkill = (skill: string): void => {
    setSkills((current) => current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill])
  }

  const shared: SharedVariantProps = {
    activeTask,
    onTask: handleTask,
    inspectorMode,
    onInspectorMode: setInspectorMode,
    candidateState,
    onCandidateChange: setCandidateState,
    skills,
    onToggleSkill: handleToggleSkill,
  }

  return (
    <div className="awp-root" data-variant={variant}>
      <div className="awp-prototype-badge">PROTOTYPE · 不进入生产</div>
      {variant === 'A' ? <VariantA {...shared} /> : variant === 'B' ? <VariantB {...shared} /> : <VariantC {...shared} />}
      <PrototypeSwitcher variant={variant} onChange={setVariant} />
    </div>
  )
}
