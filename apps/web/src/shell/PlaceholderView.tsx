/**
 * 中栏显式占位页（实现票 T40）：未实现的功能页点名去向与落地票，
 * 不假装可用（AC：17 项功能全部可点击，未实现页显示显式占位）。
 */
import { viewLabel } from './views'
import type { ViewId } from './views'

const VIEW_NOTES: Partial<Record<ViewId, string>> = {
  'quality-gate': '质量门面板已在右侧检视塔接入——点击右侧「质量门」tab 查看。',
  'story-brain':
    'Story Brain 三区面板（实体卡 / 章大纲树 / 事实列表）随实现票 T41 迁入检视塔；实体网格切片暂置于工作台中栏。',
  'context-receipt': '装配看板（Context Receipt 列表 + 逐条装配分解）随实现票 T42 落地。',
  'change-matrix': '变更矩阵（行=遍历 / 列=受影响章）随实现票 T43 落地。',
}

export function PlaceholderView({ view }: { view: ViewId }): JSX.Element {
  const label = viewLabel(view)
  const note = VIEW_NOTES[view]
  return (
    <section className="center solo">
      <div className="chapterbar">
        <h1>{label}</h1>
      </div>
      <div className="conversation">
        <div className="card-shell">
          <div className="card" data-testid="placeholder-view">
            <div className="card-title">
              <b>{label}</b>
              {note !== undefined ? <span className="tag">已排票</span> : null}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.8 }}>
              {note ??
                '该功能页尚未实现：Ink Orbit 骨架完成后逐票立项迁移（spec #84 Out of Scope）。'}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
