import { useEffect, useRef } from 'react'

export interface TensionSparkWidgetProps {
  tensionScore?: number
  tensionDesc?: string
  currentStage?: number
  onSelectStage?: (stageIndex: number) => void
}

const STAGES = ['设定', '大纲', '草稿', '审查', '修订', '排版', '分卷', '发布']

export function TensionSparkWidget({
  tensionScore = 88,
  tensionDesc = '高潮临界 · 骗局被识破前的悬念压抑',
  currentStage = 2,
  onSelectStage,
}: TensionSparkWidgetProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      return
    }
    if (!ctx) return

    const w = (canvas.width = canvas.offsetWidth || 100)
    const h = (canvas.height = canvas.offsetHeight || 42)
    const pts = [20, 38, 30, 60, 48, 75, 68, tensionScore]
    const step = w / (pts.length - 1)

    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#9d8dff'
    ctx.lineWidth = 2
    ctx.beginPath()

    pts.forEach((v, i) => {
      const x = i * step
      const y = h - (v / 100) * (h - 12) - 6
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    const lastScore = pts[pts.length - 1] ?? tensionScore
    const lastX = (pts.length - 1) * step
    const lastY = h - (lastScore / 100) * (h - 12) - 6
    ctx.fillStyle = '#d4a359'
    ctx.beginPath()
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }, [tensionScore])

  return (
    <>
      {/* 阶段滑轨 */}
      <div className="pipeline-strip">
        {STAGES.map((s, idx) => {
          const isDone = idx < currentStage
          const isCurrent = idx === currentStage
          return (
            <button
              type="button"
              key={s}
              className={`stage-item ${isCurrent ? 'current' : isDone ? 'done' : ''}`}
              onClick={() => onSelectStage?.(idx)}
            >
              {s}
            </button>
          )
        })}
      </div>

      {/* 叙事张力卡 */}
      <div className="mobile-card">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted-mobile)' }}>
              叙事张力与情绪波峰
            </span>
            <div
              style={{
                fontFamily: 'var(--font-prose-mobile)',
                fontSize: 13.5,
                color: 'var(--fg-primary-mobile)',
              }}
            >
              {tensionDesc}
            </div>
          </div>
          <div
            style={{
              width: '100%',
              height: 42,
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: 8,
              border: '1px solid var(--hairline-subtle-mobile)',
              overflow: 'hidden',
            }}
          >
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        </div>
      </div>
    </>
  )
}
