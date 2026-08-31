/**
 * 风格蒸馏（StyleDistillView）视图（实现票 T50）：
 * 读当前作品的四场景 StyleProfile 画像，支持输入文风范本文本
 * 提取对白占比、句长节奏、感官描写密度与动作张力指标。
 *
 * 数据面（/api/style 与 /api/style.distill 中间件）：
 * - POST /api/style {root} → StyleDistillResponse
 * - POST /api/style.distill {text, root?} → StyleDistillResponse
 */
import { useCallback, useEffect, useState } from 'react'
import type { StyleDistillResponse } from '../../server/api'
import { post } from '../lib/post'

const SAMPLE_TEXTS = [
  {
    title: '冷冽武侠·短句动作',
    text: '刀光落。风止。他没有回头，只是按住了刀柄。雨水顺着剑脊滴落，在青石板上砸出微响。三丈外，黑衣人倒下，呼吸断了。',
  },
  {
    title: '细腻仙侠·感官氛围',
    text: '薄暮冥冥，远山如黛。灵舟破开层层云霭，微凉的晚风卷着草木清香扑面而来。少女凭栏而立，眼中倒映着漫天霞光，轻声叹道：“这便是云海尽头么？”',
  },
  {
    title: '悬疑密闭·对白交锋',
    text: '“你昨夜戌时在何处？”他盯着烛火问道。\n“在房中温书。”林舟面不改色。\n“温书？可更夫说，在西街的破庙外见到了你的佩玉。”\n“更夫看错了。”',
  },
]

export function StyleDistillView({
  root,
}: {
  /** 当前书根（可选）。 */
  root: string | null
}): JSX.Element {
  const [data, setData] = useState<StyleDistillResponse | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (root === null) return
    try {
      const res = await post<StyleDistillResponse>('/api/style', { root })
      setData(res)
    } catch {
      // 容错处理
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  const handleDistill = async (sample: string): Promise<void> => {
    const clean = sample.trim()
    if (clean.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await post<StyleDistillResponse>('/api/style.distill', { text: clean, root: root ?? undefined })
      setData(res)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="center solo" aria-label="style-distill-view">
      <div className="chapterbar">
        <h1>风格蒸馏</h1>
        <span className="meta">文风画像与范本分面蒸馏</span>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="style-error">
            错误：{error}
          </p>
        )}

        {/* 样本输入与蒸馏 */}
        <section className="wb-section" data-testid="style-sample-input">
          <h2>范本文风蒸馏</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>输入参考范本（正文或段落）</b>
                <span className="mono muted">句法节奏 · 对白占比 · 感官密度</span>
              </div>
              <textarea
                className="control"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="粘贴一段您希望作品参考的文字样本（几百字即可）…"
                rows={4}
                style={{ width: '100%', resize: 'vertical' }}
                aria-label="文风范本输入"
              />
              <div className="actions" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="mono muted">填入样例：</span>
                  {SAMPLE_TEXTS.map((s) => (
                    <button
                      key={s.title}
                      className="btn"
                      style={{ fontSize: 9, padding: '3px 6px' }}
                      onClick={() => {
                        setText(s.text)
                        void handleDistill(s.text)
                      }}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
                <button
                  className="btn-primary"
                  onClick={() => { void handleDistill(text) }}
                  disabled={busy || text.trim().length === 0}
                >
                  {busy ? '蒸馏中…' : '提取文风指标'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 样本提取结果 */}
        {data?.sampleMetrics && (
          <section className="wb-section" data-testid="style-metrics-result">
            <h2>范本蒸馏指标</h2>
            <div className="card-shell">
              <div className="card">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div>
                    <div className="mono muted">字数 / 均句长</div>
                    <b style={{ fontSize: 15 }}>{data.sampleMetrics.charCount} 字 / {data.sampleMetrics.avgSentenceLength} 字符</b>
                  </div>
                  <div>
                    <div className="mono muted">对白占比</div>
                    <b style={{ fontSize: 15, color: 'var(--accent-strong)' }}>
                      {Math.round(data.sampleMetrics.dialogueRatio * 100)}%
                    </b>
                  </div>
                  <div>
                    <div className="mono muted">短句比例</div>
                    <b style={{ fontSize: 15 }}>
                      {Math.round(data.sampleMetrics.shortSentenceRatio * 100)}%
                    </b>
                  </div>
                  <div>
                    <div className="mono muted">感官描写密度</div>
                    <b style={{ fontSize: 15, color: 'var(--success)' }}>
                      {Math.round(data.sampleMetrics.sensoryDensity * 100)}%
                    </b>
                  </div>
                  <div>
                    <div className="mono muted">动作张力节奏</div>
                    <b style={{ fontSize: 15, color: 'var(--warning)' }}>
                      {Math.round(data.sampleMetrics.actionPacing * 100)}%
                    </b>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 当前作品 StyleProfile 四场景画像 */}
        <section className="wb-section" data-testid="style-profiles-list">
          <h2>当前作品四场景文风画像</h2>
          {data?.currentProfiles ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {Object.entries(data.currentProfiles).map(([scenario, prof]) => (
                <div className="card-shell" key={scenario} style={{ marginBottom: 0 }}>
                  <div className="card">
                    <div className="card-title">
                      <b>{scenario}</b>
                      <span className="tag">r{prof.revision}</span>
                    </div>
                    <div className="mono muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div>对白占比: {Math.round(prof.dialogueRatio * 100)}%</div>
                      <div>感官密度: {Math.round(prof.sensoryDensity * 100)}%</div>
                      <div>动作节奏: {Math.round(prof.actionPacing * 100)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-shell">
              <div className="card">
                <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                  未检测到当前书的文风画像或尚未建书。在工作台建书后，系统将自动初始化四场景 StyleProfile 种子并在写作流中演化。
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
