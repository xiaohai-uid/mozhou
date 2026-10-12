/**
 * 服务端子进程：启动、私有就绪通道、优雅停机（迁移计划 §3.2、不变量 5/6）。
 *
 * 就绪与归属证明走**子进程的 stdout**（我们亲手创建的管道）：
 * 服务端 `productionServer.ts:256-264` 在 `server.listen` 回调里打印一条结构化
 * `event: "server.listening"`，字段含 `url`/`dataRoot`/`pid`。这条线只有我们拉起的那个
 * 子进程能写，端口上任何别的进程都伪造不了；而且它只在**实际绑定成功之后**才出现。
 * 因此「stdout 就绪行 + pid/端口/数据根三重匹配」是归属证明，`/api/health` 只作旁证。
 * 单看健康 JSON 的 ok/pid 无法排除一个假健康服务（计划 §3.2 明确要求）。
 *
 * 停机：Windows 没有 POSIX SIGTERM，故沿既有协议——向 stdin 写 `shutdown`，由
 * `desktop-server.mjs:43-54` 转成 SIGTERM，服务端再走 productionServer.ts:214-254 的
 * 「关监听 → 排空在途 → 10s 超时强退」。超时才由壳 Kill，且 Kill 只在超时后发生。
 */
import { spawn } from 'node:child_process'
import { logLine } from './log.mjs'

export const READY_TIMEOUT_MS = 30_000
export const DRAIN_TIMEOUT_MS = 15_000
export const KILL_TIMEOUT_MS = 5_000

function childEnv({ dataRoot, port, appUrl }) {
  const env = { ...process.env, MOZHOU_DATA_ROOT: dataRoot, PORT: String(port) }
  if (appUrl) env.MOZHOU_APP_URL = appUrl
  // 父进程若从 IDE 继承了这些变量，会让子进程行为偏离「独立官方 Node」
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_FORCE_RENDERER_ACCESSIBILITY
  delete env.CHROME_CRASHPAD_PIPE_NAME
  return env
}

/**
 * 启动服务并等待私有就绪信号。
 * 成功 resolve `{ child, ready }`；失败 reject，错误对象带 `code`/`stderrTail` 供上层可见报错。
 */
export function startServer({ nodeExe, serverEntry, appUrl, dataRoot, port, cwd }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(nodeExe, [serverEntry], {
      cwd: cwd ?? process.cwd(),
      env: childEnv({ dataRoot, port, appUrl }),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let settled = false
    let stdoutBuf = ''
    let stderrTail = []
    let ready = null

    const expectedUrl = `http://127.0.0.1:${port}`
    const timer = setTimeout(() => {
      fail(new Error(`服务端在 ${READY_TIMEOUT_MS}ms 内未报告就绪。`))
    }, READY_TIMEOUT_MS)

    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error.stderrTail = stderrTail.slice(-20)
      try {
        child.kill()
      } catch {
        // 已退出
      }
      rejectPromise(error)
    }

    child.on('error', (error) => fail(new Error(`无法启动服务端子进程：${error.message}`)))

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk
      let index = stdoutBuf.indexOf('\n')
      while (index >= 0) {
        const line = stdoutBuf.slice(0, index)
        stdoutBuf = stdoutBuf.slice(index + 1)
        handleLine(line)
        index = stdoutBuf.indexOf('\n')
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      // 逐行进 desktop.log，同时留尾部用于失败诊断
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        logLine(`[server] ${line}`)
        stderrTail.push(line)
      }
      if (stderrTail.length > 50) stderrTail = stderrTail.slice(-50)
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      // 未就绪即退出：把退出码与 stderr 尾部一起抛出，避免「服务没起来但只报超时」
      fail(new Error(`服务端子进程在就绪前退出（code=${code} signal=${signal}）。`))
    })

    function handleLine(line) {
      const trimmed = line.trim()
      if (trimmed === '') return
      logLine(`[server] ${trimmed}`)
      if (settled) return
      let parsed
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        return
      }
      // 私有就绪通道：只认「我们拉起的这个 pid」报告的实际绑定
      if (parsed?.event !== 'server.listening') return
      if (parsed.pid !== child.pid) return
      if (parsed.url !== expectedUrl) return
      if (typeof parsed.dataRoot !== 'string' || parsed.dataRoot !== dataRoot) return

      settled = true
      clearTimeout(timer)
      ready = { url: expectedUrl, pid: child.pid, dataRoot: parsed.dataRoot }
      resolvePromise({ child, ready })
    }
  })
}

/**
 * 停机结果（E04 合同）：结果由**进程怎么退出**决定，不由哪个监听先注册决定。
 * 只有真实的排空完成证据才能标 `drained`。
 *
 * @typedef {'drained' | 'crashed' | 'killed' | 'timeout' | 'already-exited'} StopOutcome
 * @typedef {object} StopResult
 * @property {StopOutcome} outcome
 * @property {boolean} drained 只有「退出码为 0 的正常结束」才为 true；崩溃、被信号结束、强杀、未退出一律 false。
 * @property {boolean} killed 是否由本壳 Kill 结束。
 * @property {number | null} exitCode
 * @property {string | null} signalCode
 * @property {string} detail 结果说明（进日志，也用于判定「是否拿进程消失当提交成功」）。
 */

/** @returns {StopResult} */
function alreadyExitedResult(child) {
  const clean = child.exitCode === 0
  return {
    outcome: 'already-exited',
    drained: clean,
    killed: child.signalCode !== null,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    detail: `停止请求前已退出（code=${child.exitCode} signal=${child.signalCode}）`,
  }
}

/**
 * 请求子进程排空（stdin 写 `shutdown`）。
 *
 * 两处必须收口，否则会把壳进程炸掉：
 * - 已 `end()`/`destroyed` 的 stdin 不能再写（重复停止会走到这里）；
 * - 子进程已退出时写失败是**异步**的 `'error'` 事件，`try/catch` 抓不到，必须挂监听。
 */
function requestShutdown(child) {
  const stdin = child?.stdin
  if (!stdin || stdin.destroyed || stdin.writableEnded) return
  stdin.once('error', (error) => logLine(`[shell] 写入 shutdown 失败：${String(error)}`))
  try {
    stdin.write('shutdown\n')
    stdin.end()
  } catch (error) {
    logLine(`[shell] 写入 shutdown 失败：${String(error)}`)
  }
}

/**
 * 优雅停机：stdin `shutdown` → 等排空 → 超时才 Kill。
 *
 * 旧实现把 `child.once('exit', () => finish({drained:true}))` 注册在排空计时器之前，
 * 于是**任何**退出（崩溃 code=7、外部 SIGTERM、本壳超时强杀）都会被先注册的监听报成
 * `drained:true, killed:false`——「安全退出」的结论与事实无关。现在改为：先写 `shutdown`，
 * 再按退出事实（code / signal / 是否本壳所杀 / 是否超时）判定 outcome。
 *
 * 幂等：`done` 一次性收口，重复调用与重复事件都不会二次 resolve；所有定时器在收口时清理。
 */
export function stopServer(child, { drainTimeoutMs = DRAIN_TIMEOUT_MS, killTimeoutMs = KILL_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise) => {
    if (!child) {
      resolvePromise({
        outcome: 'already-exited',
        drained: false,
        killed: false,
        exitCode: null,
        signalCode: null,
        detail: '没有本壳托管的服务端子进程',
      })
      return
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise(alreadyExitedResult(child))
      return
    }

    let done = false
    let weKilled = false
    let killTimer = null
    let hardTimer = null
    const finish = (result) => {
      if (done) return
      done = true
      if (killTimer !== null) clearTimeout(killTimer)
      if (hardTimer !== null) clearTimeout(hardTimer)
      resolvePromise(result)
    }

    child.once('exit', (code, signal) => {
      if (weKilled) {
        finish({
          outcome: 'killed',
          drained: false,
          killed: true,
          exitCode: code,
          signalCode: signal,
          detail: `超过 ${drainTimeoutMs}ms 未排空，由本壳强制结束`,
        })
        return
      }
      if (signal !== null) {
        finish({
          outcome: 'killed',
          drained: false,
          killed: false,
          exitCode: code,
          signalCode: signal,
          detail: `排空期间被信号结束（${signal}），非本壳所杀`,
        })
        return
      }
      if (code === 0) {
        finish({ outcome: 'drained', drained: true, killed: false, exitCode: 0, signalCode: null, detail: '服务端排空完成' })
        return
      }
      finish({
        outcome: 'crashed',
        drained: false,
        killed: false,
        exitCode: code,
        signalCode: null,
        detail: `服务端非零退出（code=${code}），提交完整性未确认`,
      })
    })

    killTimer = setTimeout(() => {
      weKilled = true
      logLine(`[shell] 服务端超过 ${drainTimeoutMs}ms 未排空；强制结束（Kill）。`)
      try {
        child.kill()
      } catch {
        // 已退出
      }
      hardTimer = setTimeout(() => {
        finish({
          outcome: 'timeout',
          drained: false,
          killed: true,
          exitCode: null,
          signalCode: null,
          detail: `强制结束后 ${killTimeoutMs}ms 仍未退出（进程可能已僵死）`,
        })
      }, killTimeoutMs)
      hardTimer.unref?.()
    }, drainTimeoutMs)
    killTimer.unref?.()

    requestShutdown(child)
  })
}
