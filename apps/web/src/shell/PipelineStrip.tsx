/**
 * 顶部八步管线条（实现票 T40）：prepare→commit，当前章阶段高亮，
 * 点击切换阶段并牵引背景墨迹聚焦（App 将 stage 换算为 focus uniform）。
 * 阶段词表 = 管线八步（spec #84：非 legacy chat 七相位）。
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

export function PipelineStrip({
  activeStage,
  onSelect,
}: {
  activeStage: number
  onSelect: (stageIndex: number) => void
}): JSX.Element {
  return (
    <section className="pipeline" aria-label="章节生产管线">
      {PIPELINE_STAGES.map((stage, index) => {
        const state =
          index < activeStage ? ' done' : index === activeStage ? ' active' : ''
        return (
          <button
            key={stage.id}
            className={'step' + state}
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
