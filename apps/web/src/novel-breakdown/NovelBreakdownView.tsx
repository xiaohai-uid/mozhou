/**
 * 小说拆解（NovelBreakdownView）视图（实现票 T51）：
 * 故事核、黄金三章节奏点、人物弧光与情绪高潮曲线的深度拆解看板。
 * 支持对当前作品架构透视或输入外部样章进行结构化剖析。
 *
 * 数据面（/api/novel-breakdown 中间件）：
 * - POST /api/novel-breakdown {root?, sampleText?} → NovelBreakdownResponse
 */
import { useCallback, useEffect, useState } from 'react'
import type { NovelBreakdownResponse, NovelBreakdownResult } from '../../server/api'
import { post } from '../lib/post'

const SAMPLE_BREAKDOWNS = [
  '《凡人修仙传》：韩立平民出身，金手指为掌天瓶（催熟灵药），核心冲突为修仙界弱肉强食与资源匮乏。黄金三章：采药遇险、掌天瓶认主、秘密制药反杀野狼帮。',
  '《诡秘之主》：克莱恩穿越异界，金手指为源堡与占卜家序列，核心冲突为非凡失控、真实造物主阴谋与序列晋升。黄金三章：手枪自杀疑云、红月献祭初临源堡、塔罗会初创。',
]

export function NovelBreakdownView({
  root,
}: {
  /** 当前书根（可选）。 */
  root: string | null
}): JSX.Element {
  const [data, setData] = useState<NovelBreakdownResult | null>(null)
  const [sampleText, setSampleText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await post<NovelBreakdownResponse>('/api/novel-breakdown', { root: root ?? undefined })
      setData(res.result)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  const handleAnalyzeSample = async (text: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await post<NovelBreakdownResponse>('/api/novel-breakdown', { sampleText: text, root: root ?? undefined })
      setData(res.result)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="center solo" aria-label="novel-breakdown-view">
      <div className="chapterbar">
        <h1>小说拆解</h1>
        <span className="meta">故事核 · 黄金三章 · 人物弧光 · 情绪曲线</span>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="breakdown-error">
            错误：{error}
          </p>
        )}

        {/* 外部样章快速分析输入 */}
        <section className="wb-section" data-testid="breakdown-input">
          <h2>样本文本拆解</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>输入对标小说片段或设定</b>
                <span className="mono muted">深度节奏剖析</span>
              </div>
              <textarea
                className="control"
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                placeholder="粘贴一段样章（如前三章梗概或精彩高潮片段）…"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
                aria-label="样章拆解输入"
              />
              <div className="actions" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="mono muted">填入样例：</span>
                  {SAMPLE_BREAKDOWNS.map((s, idx) => (
                    <button
                      key={idx}
                      className="btn"
                      style={{ fontSize: 9, padding: '3px 6px' }}
                      onClick={() => {
                        setSampleText(s)
                        void handleAnalyzeSample(s)
                      }}
                    >
                      样例 {idx + 1}
                    </button>
                  ))}
                </div>
                <button
                  className="btn-primary"
                  onClick={() => { void handleAnalyzeSample(sampleText) }}
                  disabled={busy}
                >
                  {busy ? '拆解中…' : '分析拆解'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {data !== null && (
          <>
            {/* 1. 故事核 */}
            <section className="wb-section" data-testid="breakdown-story-core">
              <h2>核心故事核（Story Core）</h2>
              <div className="card-shell">
                <div className="card">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    <div>
                      <div className="mono muted">主角角色</div>
                      <b style={{ fontSize: 13 }}>{data.storyCore.protagonist}</b>
                    </div>
                    <div>
                      <div className="mono muted">终极欲望/主线</div>
                      <b style={{ fontSize: 13, color: 'var(--accent-strong)' }}>{data.storyCore.mainGoal}</b>
                    </div>
                    <div>
                      <div className="mono muted">核心金手指</div>
                      <b style={{ fontSize: 13, color: 'var(--success)' }}>{data.storyCore.goldenFinger}</b>
                    </div>
                    <div>
                      <div className="mono muted">主对立矛盾</div>
                      <b style={{ fontSize: 13, color: 'var(--danger)' }}>{data.storyCore.mainConflict}</b>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. 黄金三章节奏点 */}
            <section className="wb-section" data-testid="breakdown-pacing">
              <h2>黄金三章节奏点（Golden 3 Chapters）</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.chapterPacing.map((p) => (
                  <div className="card-shell" key={p.chapter} style={{ marginBottom: 0 }}>
                    <div className="card">
                      <div className="card-title">
                        <b>{p.title}</b>
                        <span className="cap-badge native">节奏评级: {p.pacingGrade}</span>
                      </div>
                      <div className="finding">
                        <b>🎯 开篇钩子：</b>
                        <span style={{ fontSize: 11, marginLeft: 4 }}>{p.hook}</span>
                      </div>
                      <div className="finding">
                        <b>⚡ 爽点兑现：</b>
                        <span style={{ fontSize: 11, marginLeft: 4 }}>{p.payOff}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. 人物弧光 */}
            <section className="wb-section" data-testid="breakdown-characters">
              <h2>主要人物弧光设定</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {data.characterArcs.map((c) => (
                  <div className="card-shell" key={c.name} style={{ marginBottom: 0 }}>
                    <div className="card">
                      <div className="card-title">
                        <b>{c.name}</b>
                        <span className="tag">{c.role}</span>
                      </div>
                      <div className="mono muted" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        <div>欲望：{c.desire}</div>
                        <div>缺陷：{c.flaw}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 4. 情绪节拍曲线 */}
            <section className="wb-section" data-testid="breakdown-beats">
              <h2>情绪节拍点分布</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                {data.emotionalBeats.map((beat) => (
                  <div className="card-shell" key={beat.label} style={{ marginBottom: 0 }}>
                    <div className="card">
                      <div className="card-title">
                        <b>{beat.label}</b>
                        <span
                          className={
                            'cap-badge ' + (beat.type === 'climax' ? 'native' : beat.type === 'twist' ? 'pending' : 'refused')
                          }
                        >
                          {beat.type}
                        </span>
                      </div>
                      <p className="muted" style={{ margin: 0, fontSize: 10 }}>
                        {beat.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  )
}
