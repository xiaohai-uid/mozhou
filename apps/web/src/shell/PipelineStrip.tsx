/**
 * 顶部八步管线条（实现票 T40 · Ink Realm 六态升级，ADR-0028）：
 * prepare→commit，阶段词表 = 管线八步（spec #84：非 legacy chat 七相位）。
 * 六个诚实状态（规格 §11）：selected（点击）/ running（真实执行中）/
 * done / blocked / failed / unavailable——被点击 ≠ 执行成功。
 * 真实会话阶段绑定随后续实现票接入；当前为壳级可点击状态。
 */
export const PIPELINE_STAGES = [
  { id: 'prepare', label: '准备' },
  { id: 'compile', label: '装配' },
  { id: 'draft', label: '草稿' },
  { id: 'review', label: '审查' },
  { id: 'extract', label: '提取' },
  { id: 'continuity', label: '连续性' },
  { id: 'proposal', label: '提案' },
  { id: 'commit', label: '提交' },
] as const

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]['id']
/** 会话绑定接入后的逐阶段真实状态（缺省回退 selected/done 推导）。 */
export type PipelineStageState = 'done' | 'running' | 'blocked' | 'failed' | 'unavailable'

export function PipelineStrip({
  activeStage,
  onSelect,
  stageStates,
}: {
  activeStage: number
  onSelect: (stageIndex: number) => void
  /** 每阶段覆盖态（如 blocked=前提缺失）。仅为视觉语义，不代表执行成功。 */
  stageStates?: Partial<Record<PipelineStageId, PipelineStageState>>
}): JSX.Element {
  return (
    <section className="pipeline" aria-label="章节生产管线">
      {PIPELINE_STAGES.map((stage, index) => {
        // 状态只来自真实证据（stageStates 覆盖）；选中（点击焦点）正交表达。
        // 无证据的阶段不标记——「点到了第 4 步，前面三个自动 done」的旧推导已废除。
        const override = stageStates?.[stage.id]
        const stateClass = override !== undefined ? ` ${override}` : ''
        const selectedClass = index === activeStage ? ' active' : ''
        return (
          <button
            key={stage.id}
            className={'step' + stateClass + selectedClass}
            data-stage={stage.id}
            aria-current={index === activeStage ? 'step' : undefined}
            onClick={() => onSelect(index)}
          >
            <b>{stage.id}</b>
            <span>{stage.label}</span>
          </button>
        )
      })}
    </section>
  )
}
