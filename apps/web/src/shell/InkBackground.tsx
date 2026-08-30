/**
 * 背景墨流（实现票 T40 · ADR-0027 WebGL 克制原则）。
 * 单屏全幅 fragment shader：低频墨流 + 阶段牵引光核（focus uniform，由
 * 八步管线条驱动），不覆盖正文。prefers-reduced-motion 下只绘制单帧
 * （点击牵引仍会重绘一帧——那是状态迁移，不是动画）；无 WebGL 时回落
 * 静态径向渐变。着色器与绘制逻辑自原型 codex-ui-ink-orbit.html 原样迁移。
 */
import { useEffect, useRef } from 'react'

const VERTEX_SOURCE = `
  attribute vec2 position;

  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const FRAGMENT_SOURCE = `
  precision highp float;

  uniform vec2 resolution;
  uniform float time;
  uniform float focus;

  float hash(vec2 point) {
    return fract(
      sin(dot(point, vec2(127.1, 311.7))) * 43758.5453
    );
  }

  float noise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);

    local = local * local * (3.0 - 2.0 * local);

    return mix(
      mix(
        hash(cell),
        hash(cell + vec2(1.0, 0.0)),
        local.x
      ),
      mix(
        hash(cell + vec2(0.0, 1.0)),
        hash(cell + vec2(1.0, 1.0)),
        local.x
      ),
      local.y
    );
  }

  void main() {
    vec2 uv = (
      gl_FragCoord.xy - 0.5 * resolution
    ) / resolution.y;

    float field = 0.0;
    vec2 flow = uv * 1.8;

    for (int layer = 0; layer < 5; layer++) {
      field += noise(flow + time * 0.012) *
        (0.28 / float(layer + 1));

      flow = mat2(
        1.6, -1.1,
        1.1,  1.6
      ) * flow;
    }

    vec2 focusPoint = uv - vec2(
      mix(-0.34, 0.36, focus),
      0.08
    );

    float halo = exp(
      -dot(focusPoint, focusPoint) * 4.2
    );

    float filament = pow(
      max(0.0, field - 0.38),
      2.0
    ) * 2.5;

    vec3 background = vec3(
      0.043,
      0.039,
      0.059
    );

    vec3 violet = vec3(
      0.545,
      0.471,
      1.0
    );

    vec3 color =
      background +
      violet * (
        filament * 0.24 +
        halo * 0.075
      ) +
      vec3(0.12, 0.11, 0.15) *
      field * 0.12;

    gl_FragColor = vec4(color, 1.0);
  }
`

export function InkBackground({ focus }: { focus: number }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // 绘制入口（init 后就绪）；focus 变化时单帧重绘由第二个 effect 驱动。
  const drawRef = useRef<(() => void) | null>(null)
  const focusRef = useRef(focus)
  const reducedMotionRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    })

    // jsdom / 无 WebGL 环境：回落静态渐变（原型同款降级路径）。
    if (gl === null) {
      canvas.classList.add('ink-canvas-fallback')
      return
    }

    const compileShader = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)
      if (shader === null) throw new Error('createShader failed')
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }

    const program = gl.createProgram()
    if (program === null) return
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERTEX_SOURCE))
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SOURCE))
    gl.linkProgram(program)
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    if (buffer === null) return
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const resolution = gl.getUniformLocation(program, 'resolution')
    const time = gl.getUniformLocation(program, 'time')
    const focusUniform = gl.getUniformLocation(program, 'focus')

    reducedMotionRef.current =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let rafId = 0
    let disposed = false

    const draw = (milliseconds = 0): void => {
      const density = Math.min(window.devicePixelRatio || 1, 1.5)
      const targetWidth = Math.round(window.innerWidth * density)
      const targetHeight = Math.round(window.innerHeight * density)

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
        gl.viewport(0, 0, targetWidth, targetHeight)
      }

      gl.uniform2f(resolution, canvas.width, canvas.height)
      gl.uniform1f(time, milliseconds / 1000)
      gl.uniform1f(focusUniform, focusRef.current)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (!reducedMotionRef.current && !disposed) {
        rafId = window.requestAnimationFrame(draw)
      }
    }

    drawRef.current = () => draw()
    draw()

    return () => {
      disposed = true
      drawRef.current = null
      window.cancelAnimationFrame(rafId)
      // 不调 WEBGL_lose_context：StrictMode 双挂载时 getContext 返回同一
      // 上下文，主动丢失会让第二次挂载拿到已死的上下文（背景黑屏）。
      // 停掉绘制循环即可——卸载时 canvas 节点随之销毁。
    }
  }, [])

  useEffect(() => {
    focusRef.current = focus
    // 常驻动画循环自己会消费最新 focus；只有静止单帧模式需要显式重绘。
    if (reducedMotionRef.current) drawRef.current?.()
  }, [focus])

  return <canvas ref={canvasRef} className="ink-canvas" aria-hidden="true" />
}
