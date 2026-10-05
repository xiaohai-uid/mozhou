#!/usr/bin/env node
// verify-cross-session-writer-lock.mjs — LOCK-01 实测：两个**独立 Node 子进程**争抢同一本书的写锁，
// 验证「同时最多一个合法写入者；另一方有明确状态」（规划 §8 验收矩阵 LOCK-01）。
//
// 实测口径（如实声明，不夸大）：
// - 两个子进程由本脚本分别 spawn，是真实独立 OS 进程（不同 PID，无任何进程内共享状态），
//   争抢由 OS 命名管道 EADDRINUSE 语义裁决——对应 LOCK-01 的「宿主/CLI/别名」维度；
// - 子进程由 CreateProcess 产生，**继承本脚本的 Windows 登录会话**。writerLock.ts 头注自述
//   `\\.\pipe\` 是会话本地命名空间、跨登录会话不保护——该维度需要第二个登录会话（独立凭据）
//   才能产生，本脚本**无法也不声称**覆盖它，其结论仍属文档陈述、未实测。
//
// 锁入口：直接 import 真实 TS 原语 apps/web/server/platform/writerLock.ts（Node ≥23.6 原生类型剥离；
// 构造器参数属性需要 --experimental-transform-types）。启动前有预检子进程验证 import 可用，
// 不可用则 BLOCKED 退出——不做静默降级。scripts/lib/book-writer-lock.mjs 镜像与 TS 侧的同一入口
// 等价性由 apps/web/server/routes/writerLockIntegration.test.ts「同一入口」用例锁定，本脚本不重复验证。
//
// 数据隔离：书根默认建在系统临时目录下的隔离数据根（规划 §8「自动化测试使用隔离书籍，禁止写真实书稿」），
// 布局与真实数据根一致：<dataRoot>/users/<userId>/books/<bookId>（bookAccess.ts 的既定布局）。
// 可用 `--data-root <dir>` 指定外部数据根（内容归调用者管，脚本不删它）。
//
// 退出码：0 = PASS；1 = FAIL（互斥被打破或阶段证据不符）；2 = BLOCKED（前置条件不满足）。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const TS_LOCK_ENTRY = resolve(REPO_ROOT, 'apps/web/server/platform/writerLock.ts')
const PHASE_TIMEOUT_MS = 30000

const args = process.argv.slice(2)
const dataRootArgIdx = args.indexOf('--data-root')
const externalDataRoot = dataRootArgIdx !== -1 ? resolve(args[dataRootArgIdx + 1] ?? '') : null

function emit(text) {
  console.log(text)
}

function childCode() {
  return `
import { writeSync } from 'node:fs'
const send = (event) => { writeSync(1, JSON.stringify(event) + '\\n') }
try {
  const lock = await import(process.env.MOZHOU_LOCK_ENTRY)
  const root = process.env.MOZHOU_BOOK_ROOT
  const role = process.env.MOZHOU_LOCK_ROLE
  const opts = { timeoutMs: 0, pollIntervalMs: 50 }
  try {
    if (role === 'holder' || role.startsWith('racer')) {
      // HOLDING 在持锁期间打印（管道已绑定、尚未释放）——「两个都 HOLDING」才是真并发双持。
      // 若在 withBookWriteLock 返回后才打印，拿到的只是「顺序获取成功」，会把无重叠当成违反。
      await lock.withBookWriteLock(root, () => new Promise((resolveHold) => {
        send({ event: 'HOLDING', pid: process.pid, role })
        process.stdin.resume()
        process.stdin.once('end', resolveHold)
      }), opts)
      send({ event: 'RELEASED', pid: process.pid, role })
    } else {
      await lock.withBookWriteLock(root, () => {}, opts)
      send({ event: 'ACQUIRED', pid: process.pid, role })
    }
    process.exit(0)
  } catch (error) {
    if (error && error.name === 'BookWriteLockError') {
      send({ event: 'REJECTED', pid: process.pid, role, code: error.code, bookKey: error.bookKey, message: error.message })
      process.exit(0)
    }
    send({ event: 'ERROR', pid: process.pid, role, message: String(error && error.stack || error) })
    process.exit(3)
  }
} catch (importError) {
  send({ event: 'ERROR', pid: process.pid, role: 'import', message: String(importError && importError.stack || importError) })
  process.exit(3)
}
`
}

function spawnLockChild(role, bookRoot, dataRoot) {
  return spawn(
    process.execPath,
    ['--experimental-transform-types', '--input-type=module', '-e', childCode()],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MOZHOU_DATA_ROOT: dataRoot,
        MOZHOU_LOCK_ENTRY: pathToFileURL(TS_LOCK_ENTRY).href,
        MOZHOU_BOOK_ROOT: bookRoot,
        MOZHOU_LOCK_ROLE: role,
      },
    },
  )
}

/**
 * 挂接一个子进程：解析 stdout JSON 事件行、逐条原样输出为证据、30s 看门狗。
 * 返回 { events, done, waitFor }：
 * - done     → Promise<exitCode|'watchdog-timeout'>，进程退出即兑现；
 * - waitFor  → Promise<event>，等某个事件出现（已出现的立即兑现），配合「A 确认持锁后再起 B」。
 */
function attachChild(child, label) {
  const events = []
  const waiters = []
  let buffer = ''
  let settled = false
  let resolveDone
  const done = new Promise((r) => { resolveDone = r })
  const finish = (exitCode) => {
    if (settled) return
    settled = true
    clearTimeout(watchdog)
    resolveDone(exitCode)
  }
  const push = (event) => {
    events.push(event)
    emit(`[LOCK-01] CHILD ${label} pid=${event.pid ?? '?'} event=${event.event}` +
      (event.code ? ` code=${event.code}` : '') +
      (event.bookKey ? ` bookKey=${event.bookKey}` : ''))
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].predicate(event) === true) {
        waiters[i].resolve(event)
        waiters.splice(i, 1)
      }
    }
  }
  const watchdog = setTimeout(() => {
    emit(`[LOCK-01] WATCHDOG ${label} 子进程 ${PHASE_TIMEOUT_MS}ms 无进展，SIGKILL（超时本身记为该阶段失败证据）`)
    child.kill('SIGKILL')
    finish('watchdog-timeout')
  }, PHASE_TIMEOUT_MS)
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let idx
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line === '') continue
      try {
        push(JSON.parse(line))
      } catch {
        emit(`[LOCK-01] CHILD ${label} 非事件输出（原样记录）：${line}`)
      }
    }
  })
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text !== '') emit(`[LOCK-01] CHILD ${label} stderr（原样记录）：${text}`)
  })
  child.once('exit', (code) => finish(code))
  const waitFor = (predicate) => new Promise((resolveWait) => {
    for (const event of events) {
      if (predicate(event) === true) {
        resolveWait(event)
        return
      }
    }
    waiters.push({ predicate, resolve: resolveWait })
  })
  return { events, done, waitFor }
}

const rejectedWith = (events, code) => events.some((e) => e.event === 'REJECTED' && e.code === code)
const acquiredCount = (events) => events.filter((e) => e.event === 'ACQUIRED').length
const errorEvents = (events) => events.filter((e) => e.event === 'ERROR')
const cleanEvents = (events) => JSON.stringify(events.filter((e) => e.event !== 'ERROR'))

/* ----------------------------- 前置检查 ----------------------------- */

if (process.platform !== 'win32') {
  emit('[LOCK-01] BLOCKED 命名管道写锁是 Windows 专用原语（writerLock.ts 设计依据 t22 实测），非 win32 平台无法实测。')
  process.exit(2)
}
if (!existsSync(TS_LOCK_ENTRY)) {
  emit(`[LOCK-01] BLOCKED 找不到 TS 锁原语：${TS_LOCK_ENTRY}`)
  process.exit(2)
}

// 隔离数据根 + 真实布局的书根
const dataRoot = externalDataRoot ?? mkdtempSync(join(tmpdir(), 'mozhou-lock01-'))
if (externalDataRoot) {
  emit(`[LOCK-01] 使用调用者提供的数据根（脚本不负责清理其内容）：${dataRoot}`)
}

const bookRoot = resolve(dataRoot, 'users', 'lock01-user', 'books', 'lock01-book')
mkdirSync(bookRoot, { recursive: true })
writeFileSync(resolve(bookRoot, 'book.json'), JSON.stringify({ title: 'LOCK-01 互斥实测书' }, null, 2) + '\n', 'utf8')
emit(`[LOCK-01] 数据根 MOZHOU_DATA_ROOT=${dataRoot}`)
emit(`[LOCK-01] 书根（同一本书，两个子进程争抢）=${bookRoot}`)
emit(`[LOCK-01] 锁入口=${TS_LOCK_ENTRY}（真实 TS 原语，经 Node 类型剥离直接执行）`)

function cleanup() {
  if (!externalDataRoot) rmSync(dataRoot, { recursive: true, force: true })
}
function exitBlocked(reason) {
  emit(`[LOCK-01] BLOCKED ${reason}`)
  cleanup()
  process.exit(2)
}
function exitFail(reason) {
  emit(`[LOCK-01] FAIL ${reason}`)
  cleanup()
  process.exit(1)
}

// 预检：TS 原语必须能被子进程真实 import（不可用 → BLOCKED，不静默降级）
emit('[LOCK-01] 预检：子进程 import TS 锁原语…')
const preflightState = attachChild(spawnLockChild('contender', bookRoot, dataRoot), 'preflight')
const preflightDone = await preflightState.done
if (errorEvents(preflightState.events).length > 0 || preflightDone !== 0) {
  exitBlocked('子进程无法 import TS 锁原语（--experimental-transform-types 不可用或模块加载失败），证据见上方 stderr/ERROR 行。')
}
emit('[LOCK-01] 预检通过：TS 原语在独立子进程中可用。')

/* ----------------------------- 阶段 1：先占后争 ----------------------------- */

emit('--- 阶段 1：进程 A 先持锁（确认 HOLDING 后），进程 B 争抢（timeoutMs=0）→ 预期 B 被 WRITER_LOCK_HELD 明确拒绝 ---')
const holderChild = spawnLockChild('holder', bookRoot, dataRoot)
const holderState = attachChild(holderChild, 'A-holder')
const holding = await holderState.waitFor((e) => e.event === 'HOLDING' || e.event === 'ERROR' || e.event === 'REJECTED')
if (holding.event !== 'HOLDING') {
  exitFail(`进程 A 未能进入持锁状态（events=${cleanEvents(holderState.events)}）——无法评估互斥。`)
}
// 此刻 A 确认持锁（管道已绑定）。起 B 争抢。
const contenderState = attachChild(spawnLockChild('contender', bookRoot, dataRoot), 'B-contender')
const contenderDone = await contenderState.done
const phase1Pass = rejectedWith(contenderState.events, 'WRITER_LOCK_HELD') && contenderDone === 0
emit(`[LOCK-01] 阶段1 ${phase1Pass ? 'PASS' : 'FAIL'}：B 的结果 = ${cleanEvents(contenderState.events)}`)
if (acquiredCount(contenderState.events) > 0) {
  emit('[LOCK-01] FAIL 关键证据：A 持锁期间 B 也拿到了锁——互斥在独立进程间被打破。')
}
// A 释放（stdin end → fn resolve → withBookWriteLock finally release）
holderChild.stdin.end()
const holderDone = await holderState.done
emit(`[LOCK-01] A-holder 已退出（exit=${holderDone}），释放证据见上方 RELEASED 行。`)

/* ----------------------------- 阶段 2：释放后可恢复 ----------------------------- */

emit('--- 阶段 2：A 释放后，新进程 C 争抢 → 预期 C 能正常拿到（证明阶段1拒绝来自活持有者而非坏状态） ---')
const afterState = attachChild(spawnLockChild('after-release', bookRoot, dataRoot), 'C-after-release')
const afterDone = await afterState.done
const phase2Pass = acquiredCount(afterState.events) === 1 && afterDone === 0
emit(`[LOCK-01] 阶段2 ${phase2Pass ? 'PASS' : 'FAIL'}：C 的结果 = ${cleanEvents(afterState.events)}`)

/* ----------------------------- 阶段 3：同时争抢 ----------------------------- */

emit('--- 阶段 3：D/E 两进程同时启动争抢（timeoutMs=0，持锁等到信号才释放）→ 预期恰好一个 HOLDING、一个 WRITER_LOCK_HELD ---')
const racerD = spawnLockChild('racer-d', bookRoot, dataRoot)
const racerE = spawnLockChild('racer-e', bookRoot, dataRoot)
const stateD = attachChild(racerD, 'D-racer')
const stateE = attachChild(racerE, 'E-racer')
// 等 D、E 各自给出终态：HOLDING（正在持锁，等信号）或 REJECTED（被拒，即刻退出）
const [outcomeD, outcomeE] = await Promise.all([
  stateD.waitFor((e) => ['HOLDING', 'REJECTED', 'ERROR'].includes(e.event)),
  stateE.waitFor((e) => ['HOLDING', 'REJECTED', 'ERROR'].includes(e.event)),
])
const heldCount = [outcomeD, outcomeE].filter((e) => e.event === 'HOLDING').length
const rejectedHeld = [outcomeD, outcomeE].some((e) => e.event === 'REJECTED' && e.code === 'WRITER_LOCK_HELD')
const phase3Pass = heldCount === 1 && rejectedHeld
emit(`[LOCK-01] 阶段3 ${phase3Pass ? 'PASS' : 'FAIL'}：D=${JSON.stringify(outcomeD)} E=${JSON.stringify(outcomeE)}（heldCount=${heldCount}）`)
if (heldCount > 1) {
  emit('[LOCK-01] FAIL 关键证据：两个子进程同时报告 HOLDING（均在持锁期间）——互斥被打破。')
}
// 收尾：给仍持锁的子进程发释放信号，等待全部退出（不留孤儿管道）
racerD.stdin.end()
racerE.stdin.end()
const [doneD, doneE] = await Promise.all([stateD.done, stateE.done])
emit(`[LOCK-01] 阶段3 子进程退出：D exit=${doneD} E exit=${doneE}`)

/* ----------------------------- 结论 ----------------------------- */

const allPass = phase1Pass && phase2Pass && phase3Pass
const errant = [
  ...errorEvents(preflightState.events),
  ...errorEvents(holderState.events),
  ...errorEvents(contenderState.events),
  ...errorEvents(afterState.events),
  ...errorEvents(stateD.events),
  ...errorEvents(stateE.events),
]
if (errant.length > 0) {
  emit(`[LOCK-01] 注意：运行中出现 ERROR 事件 ${errant.length} 条（见上方原样记录），即使阶段结论为 PASS 也请人工复核。`)
}
emit('----------------------------------------------------------------')
emit('[LOCK-01] 覆盖范围声明：')
emit('[LOCK-01]   · 已实测：同一 Windows 登录会话内，两个真实独立 Node 进程（不同 PID、无共享状态）')
emit('[LOCK-01]     对同一 MOZHOU_DATA_ROOT 下同一书根 withBookWriteLock 互斥——覆盖 LOCK-01 的宿主/CLI/别名维度。')
emit('[LOCK-01]   · 未实测：不同登录会话（跨 Windows session）维度。子进程继承本脚本登录会话，')
emit('[LOCK-01]     产生第二登录会话需要独立凭据；writerLock.ts 头注「会话本地命名空间、跨登录会话不保护」')
emit('[LOCK-01]     的说法仍属文档陈述，本脚本不为其背书。')
emit('----------------------------------------------------------------')
emit(`[LOCK-01] ${allPass ? 'PASS' : 'FAIL'} — 阶段1(先占后争)=${phase1Pass ? 'PASS' : 'FAIL'} 阶段2(释放后恢复)=${phase2Pass ? 'PASS' : 'FAIL'} 阶段3(同时争抢)=${phase3Pass ? 'PASS' : 'FAIL'}`)

cleanup()
process.exit(allPass ? 0 : 1)
