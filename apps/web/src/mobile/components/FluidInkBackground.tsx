import { useEffect, useRef } from 'react'

function safeRandom(): number {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const arr = new Uint32Array(1)
    globalThis.crypto.getRandomValues(arr)
    return (arr[0] ?? 0) / 4294967296
  }
  return 0.5
}

export function FluidInkBackground(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      // jsdom headless 测试环境容错
      return
    }
    if (!ctx) return

    let animationFrameId: number
    let w = (canvas.width = canvas.offsetWidth || window.innerWidth)
    let h = (canvas.height = canvas.offsetHeight || window.innerHeight)

    interface Particle {
      x: number
      y: number
      r: number
      vx: number
      vy: number
      alpha: number
    }

    let particles: Particle[] = []

    const initParticles = () => {
      particles = []
      const count = 18
      for (let i = 0; i < count; i++) {
        particles.push({
          x: safeRandom() * w,
          y: safeRandom() * h,
          r: 65 + safeRandom() * 75,
          vx: (safeRandom() - 0.5) * 0.3,
          vy: (safeRandom() - 0.5) * 0.3,
          alpha: 0.05 + safeRandom() * 0.07,
        })
      }
    }

    const handleResize = () => {
      if (!canvas) return
      w = canvas.width = canvas.offsetWidth || window.innerWidth
      h = canvas.height = canvas.offsetHeight || window.innerHeight
      initParticles()
    }

    initParticles()

    const render = () => {
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      particles.forEach((p) => {
        p.x += p.vx
        p.y += p.vy
        if (p.x < -p.r) p.x = w + p.r
        if (p.x > w + p.r) p.x = -p.r
        if (p.y < -p.r) p.y = h + p.r
        if (p.y > h + p.r) p.y = -p.r

        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r)
        g.addColorStop(0, `rgba(139, 120, 255, ${p.alpha})`)
        g.addColorStop(1, 'rgba(139, 120, 255, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      })
      animationFrameId = requestAnimationFrame(render)
    }

    render()
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="fluid-ink-canvas" aria-hidden="true" />
      <div className="film-grain" aria-hidden="true" />
    </>
  )
}
