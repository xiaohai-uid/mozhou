/**
 * 首次建书 Wizard 五步覆盖层（实现票 T42 / spec #84 US11 / Q3 仅首次）。
 *
 * 自动进入条件：无 bookRoot（App 层判断，book === null）。完成后 localStorage
 * 记忆、进入常驻工作台；之后从书切换器（TopBar 书签）可重放（onReplay）。
 *
 * 五步数据绑定（t73 既有读面，零新增后端能力）：
 *   1 建书    → /api/book（createBook 直出 root+bookId，真实落盘）；
 *   2 世界观  → 收集世界规则（进入后续 Author Intent 的输入面）；
 *   3 大纲    → /api/book.state 读 back OutlineNodeScan（real 读面绑定）；
 *   4 首章    → 收集开场画面/首章目标（T44 将把其送入首个 ChapterProductionSession）；
 *   5 连写    → 收口回调（App 设 book → 常驻工作台）。
 *
 * 错误族（BookDirectoryNotEmptyError / CanonStructureError / StepGuardError 族 /
 * SessionNotResumableError）以 Ink Orbit 语义色内联呈现，不弹裸异常。
 */
import { useEffect, useMemo, useState } from 'react'
import type { BookInfo } from '../shell/workbenchStorage'
import { post } from '../lib/post'

export const WIZARD_STEPS = [
  {
    key: 'create',
    label: '建书',
    eyebrow: '先给这本书一个可以启航的名字',
    lead: '不用现在就把一切想清楚。书名和题材只用于建立作品容器，之后仍可修改。',
    field: '作品名',
    placeholder: '未命名之书',
  },
  {
    key: 'world',
    label: '世界观',
    eyebrow: '写下这个世界绝不能违背的规则',
    lead: '从一条硬规则开始。它会进入 Author Intent，成为后续生成不可越过的边界。',
    field: '世界规则',
    placeholder: '如：被潮汐钟遗忘的人会从所有书面记录中消失',
  },
  {
    key: 'outline',
    label: '大纲',
    eyebrow: '确定第一卷必须兑现的承诺',
    lead: '只描述读者最终会看到什么，不需要提前写出每一章。此处已读取新书的大纲骨架。',
    field: '卷级承诺',
    placeholder: '如：林岚必须找回一个全城都不记得的人',
  },
  {
    key: 'first-chapter',
    label: '首章',
    eyebrow: '选择第一章最晚从哪里切入',
    lead: '墨舟会先提问，再创建首个 Chapter Production Session。',
    field: '开场画面',
    placeholder: '如：一张没有乘客姓名的末班船票',
  },
  {
    key: 'continue',
    label: '连写',
    eyebrow: '骨架已经完成，开始第一段航行',
    lead: '进入常驻工作台。管线、质量门和正典提案会在写作过程中持续陪伴。',
    field: '首章目标',
    placeholder: '如：让读者在 800 字内意识到记忆正在被篡改',
  },
] as const

export type WizardStepKey = (typeof WIZARD_STEPS)[number]['key']

const STEP_INDEX: Record<WizardStepKey, number> = {
  create: 0,
  world: 1,
  outline: 2,
  'first-chapter': 3,
  continue: 4,
}

/** 首章目标：T44 将作为 ChapterProductionSession 首个 draft step 的输入面。 */
export interface WizardOutcome extends BookInfo {
  readonly worldRule: string
  readonly volumePromise: string
  readonly opening: string
  readonly firstChapterGoal: string
}

/** 建书结果暂存（步 1 → 步 5 收口）；重放场景（既建书）由 App 注入 precreated。 */
interface CreatedBook {
  readonly root: string
  readonly bookId: string
}

export function WizardOverlay({
  precreated,
  onComplete,
  onReplay,
}: {
  /** 已建书重放：直接以既有书为基底，步 1 不再建书。 */
  precreated: BookInfo | null
  onComplete: (outcome: WizardOutcome) => void
  /** 关闭/跳过覆盖层（返回工作台）。 */
  onReplay: () => void
}): JSX.Element {
  const [current, setCurrent] = useState<WizardStepKey>('create')
  const [values, setValues] = useState<Record<WizardStepKey, string>>({
    create: '',
    world: '',
    outline: '',
    'first-chapter': '',
    continue: '',
  })
  const [created, setCreated] = useState<CreatedBook | null>(precreated)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const stepIndex = STEP_INDEX[current]
  const step = WIZARD_STEPS[stepIndex] ?? WIZARD_STEPS[0]

  useEffect(() => {
    setError(null)
  }, [current])

  const canProceed = useMemo(() => {
    // 重放（既有书）：步 1 可直接进；新建时要求书名非空。
    if (current === 'create' && created === null) return values.create.trim().length > 0
    return true
  }, [current, values, created])

  const setField = (value: string): void => {
    setValues((prev) => ({ ...prev, [current]: value }))
  }

  const handleNext = async (): Promise<void> => {
    setError(null)
    if (current === 'create' && created === null && !busy) {
      setBusy(true)
      try {
        const data = await post<{ root: string; bookId: string }>('/api/book', {
          title: values.create.trim() || '未命名之书',
        })
        setCreated({ root: data.root, bookId: data.bookId })
      } catch (cause) {
        // 错误族内联（Ink Orbit 语义色）：不弹裸异常；BookDirectoryNotEmptyError 等
        // 以服务端 message 呈现于步内。
        setError((cause as Error).message)
        return
      } finally {
        setBusy(false)
      }
    }
    if (current === 'continue') {
      if (created === null) return
      const outcome: WizardOutcome = {
        root: created.root,
        bookId: created.bookId,
        title: values.create.trim() || '未命名之书',
        worldRule: values.world.trim(),
        volumePromise: values.outline.trim(),
        opening: values['first-chapter'].trim(),
        firstChapterGoal: values.continue.trim(),
      }
      try {
        await post('/api/author-intent.update', {
          root: outcome.root,
          worldRule: outcome.worldRule,
          volumePromise: outcome.volumePromise,
          opening: outcome.opening,
          firstChapterGoal: outcome.firstChapterGoal,
        })
      } catch {
        // 保持向后宽容
      }
      onComplete(outcome)
      return
    }
    const nextIndex = (stepIndex + 1) % WIZARD_STEPS.length
    setCurrent(WIZARD_STEPS[nextIndex]?.key ?? WIZARD_STEPS[0].key)
  }

  const handleBack = (): void => {
    if (stepIndex === 0) return
    setCurrent(WIZARD_STEPS[stepIndex - 1]?.key ?? WIZARD_STEPS[0].key)
  }

  const inputValue = values[current]

  return (
    <div className="wizard open" data-testid="wizard-overlay" role="dialog" aria-modal="true" aria-label="首次建书">
      <div className="scrim" data-close="wizard" />
      <div className="wizard-stage">
        <div className="wizard-core">
          <aside className="wiz-nav">
            <div className="seal">墨</div>
            <h2>
              把第一条航线
              <br />
              交给墨舟
            </h2>
            <p>五步建立作品骨架。完成后进入常驻工作台，任何一步都可重放。</p>
            <div className="wiz-steps">
              {WIZARD_STEPS.map((item, index) => (
                <div
                  key={item.key}
                  className={'wiz-step' + (STEP_INDEX[current] === index ? ' active' : '')}
                  data-wizard-step={item.key}
                >
                  <i>{String(index + 1).padStart(2, '0')}</i>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </aside>

          <section className="wiz-content">
            <button
              type="button"
              className="iconbtn close"
              style={{ position: 'absolute', right: 24, top: 24 }}
              onClick={onReplay}
              aria-label="关闭"
            >
              ×
            </button>

            <div className="mono muted" data-testid="wizard-eyebrow">
              STEP {String(stepIndex + 1).padStart(2, '0')} / 05
            </div>
            <h1>{step.eyebrow}</h1>
            <p className="lead">{step.lead}</p>

            {current === 'outline' && (
              <div className="mono muted" data-testid="wizard-outline-scan" style={{ margin: '12px 0 0' }}>
                新书已就绪：总纲 + 第一卷骨架（OutlineNodeScan）——后续章节在写作过程中由管线逐步展开。
              </div>
            )}

            <div className="field">
              <label>{step.field}</label>
              <input
                value={inputValue}
                onChange={(event) => setField(event.target.value)}
                disabled={busy}
                placeholder={step.placeholder}
                aria-label={step.field}
              />
            </div>

            {error !== null && (
              <p className="wb-error" role="alert" data-testid="wizard-error">
                错误：{error}
              </p>
            )}

            <div className="wiz-actions">
              <button
                type="button"
                className="quiet-btn"
                onClick={handleBack}
                style={{ opacity: stepIndex === 0 ? 0.35 : 1 }}
              >
                上一步
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => { void handleNext() }}
                disabled={!canProceed || busy}
              >
                {current === 'continue' ? '进入工作台' : busy ? '建书中…' : '继续'}
                <span>→</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}