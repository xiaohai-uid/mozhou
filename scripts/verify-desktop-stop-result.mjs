#!/usr/bin/env node
/**
 * verify-desktop-stop-result.mjs —— E04 停机结果语义的真实验收（子进程级）。
 *
 * 判据：`stopServer` 的结果必须由**子进程怎么退出**决定——正常退出才是 drained；
 * 非零退出、外部信号、超时强杀都不得被报成 drained；停止前已退出按实际退出码判定；
 * 重复停止幂等。旧实现把普通 `exit` 监听注册在排空计时器之前，任何退出都返回
 * `drained:true`，等于把「安全退出」的结论与事实解耦。
 *
 * 只新建合成子进程，不触任何真实数据根、真实服务或真实配置。
 * 退出码：0 通过；1 有场景失败；2 环境错误。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { stopServer } = await import(new URL('../desktop/lib/server-process.mjs', `file:///${here.replace(/\\/g, '/')}/`).href)
const { setLogPath } = await import(new URL('../desktop/lib/log.mjs', `file:///${here.replace(/\\/g, '/')}/`).href)

const tmp = mkdtempSync(join(tmpdir(), 'mozhou-e04-'))
setLogPath(join(tmp, 'stop.log'))

const failures = []
function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

/** 起一个合成子进程；`code` 是它自己的行为脚本。 */
function spawnChild(code) {
  const child = spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.resume()
  child.stderr.resume()
  return child
}

const DRAIN_EXIT_0 = "process.stdin.on('data', d => { if (String(d).includes('shutdown')) process.exit(0) }); process.stdin.resume()"
const DRAIN_EXIT_7 = "process.stdin.on('data', d => { if (String(d).includes('shutdown')) process.exit(7) }); process.stdin.resume()"
const IGNORE_SHUTDOWN = 'process.stdin.resume(); setInterval(() => {}, 1000)'
const EXIT_0_NOW = 'process.exit(0)'
const EXIT_3_NOW = 'process.exit(3)'

const SHORT = { drainTimeoutMs: 500, killTimeoutMs: 500 }

try {
  // ── 1. 正常排空 → drained ──────────────────────────────────────────────────
  {
    const child = spawnChild(DRAIN_EXIT_0)
    const r = await stopServer(child, SHORT)
    report('E04-1 正常排空 → drained', r.outcome === 'drained' && r.drained === true && r.killed === false && r.exitCode === 0, `outcome=${r.outcome} code=${r.exitCode}`)
  }

  // ── 2. 真实非零退出 → crashed（绝不 drained）───────────────────────────────
  {
    const child = spawnChild(DRAIN_EXIT_7)
    const r = await stopServer(child, SHORT)
    report('E04-2 非零退出 → crashed', r.outcome === 'crashed' && r.drained === false && r.exitCode === 7, `outcome=${r.outcome} code=${r.exitCode} drained=${r.drained}`)
  }

  // ── 3. 忽略 shutdown → 超时强杀 → killed（绝不 drained）────────────────────
  {
    const child = spawnChild(IGNORE_SHUTDOWN)
    const r = await stopServer(child, SHORT)
    report('E04-3 忽略停机被强杀 → killed', r.outcome === 'killed' && r.drained === false && r.killed === true, `outcome=${r.outcome} killed=${r.killed} drained=${r.drained}`)
  }

  // ── 4. 排空期间被**外部**信号结束 → killed 且 killed=false（非本壳所杀）────
  {
    const child = spawnChild(IGNORE_SHUTDOWN)
    const pending = stopServer(child, { drainTimeoutMs: 10_000, killTimeoutMs: 500 })
    await new Promise((r) => setTimeout(r, 250))
    child.kill()
    const r = await pending
    report('E04-4 外部信号结束 → killed 且非本壳所杀', r.outcome === 'killed' && r.drained === false && r.killed === false, `outcome=${r.outcome} killed=${r.killed}`)
  }

  // ── 5. 停止前已退出（code 0 / code 3）→ 按实际退出码判定 ───────────────────
  {
    const clean = spawnChild(EXIT_0_NOW)
    await new Promise((r) => clean.once('exit', r))
    const rc = await stopServer(clean, SHORT)
    const crashed = spawnChild(EXIT_3_NOW)
    await new Promise((r) => crashed.once('exit', r))
    const rr = await stopServer(crashed, SHORT)
    report(
      'E04-5 停止前已退出：按实际退出码判定',
      rc.outcome === 'already-exited' && rc.drained === true && rc.exitCode === 0 && rr.outcome === 'already-exited' && rr.drained === false && rr.exitCode === 3,
      `clean(drained=${rc.drained}) crashed(drained=${rr.drained} code=${rr.exitCode})`,
    )
  }

  // ── 6. 重复停止幂等：两次调用得到同一结果，不二次 resolve ──────────────────
  {
    const child = spawnChild(DRAIN_EXIT_0)
    const first = stopServer(child, SHORT)
    const second = stopServer(child, SHORT)
    const [a, b] = await Promise.all([first, second])
    report('E04-6 重复停止幂等', a.outcome === 'drained' && b.outcome === 'drained', `a=${a.outcome} b=${b.outcome}`)
  }
} catch (error) {
  console.error(`FAIL 验收脚本自身出错：${error instanceof Error ? error.message : String(error)}`)
  rmSync(tmp, { recursive: true, force: true })
  process.exit(2)
}

rmSync(tmp, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\nFAIL ${failures.length} 个场景未通过：${failures.join('；')}`)
  process.exit(1)
}
console.log('\nPASS E04 停机结果 6 个场景全部通过')
console.log('  · 未覆盖：`timeout` 分支（子进程既退不出也不响应 Kill）。Windows 上 Node 的 kill 无法被忽略，本机造不出该现场；该分支只按代码路径保留。')
process.exit(0)
