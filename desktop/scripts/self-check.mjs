#!/usr/bin/env node
/**
 * Electron 桌面壳自检（真实启动，非 mock）。
 *
 * 用 Playwright 的 Electron 支持拉起 `desktop/main.mjs`，在**真实进程**上断言：
 *   场景 A（正常路径）
 *     1. 窗口打开，URL 是 `http://127.0.0.1:<派生端口>`（**不是** file://）；
 *     2. 工作台可达：标题、React 挂载点、同源 `/api/health` 与页面内 fetch 都通过；
 *     3. 安全配置符合合同：nodeIntegration=false / contextIsolation=true / sandbox=true；
 *     4. 服务端是**独立进程**（健康 pid ≠ 壳主进程 pid），且壳启动的是配置里的官方 Node；
 *     5. 干净退出：退出码 0，走的是「排空」而非 Kill，端口随后释放。
 *   场景 B（端口被外来进程占用）
 *     6. 明确失败（非零退出）+ 日志给出冲突原因，**不静默换端口**。
 *
 * 任一断言失败即非零退出。
 *
 * 环境变量：
 *   MOZHOU_SELFCHECK_ELECTRON_ARGS  追加给 Electron 的开关（空格分隔）。
 *     受限环境（无权限初始化 Chromium OS 沙箱）下需要 `--no-sandbox`；默认不加，
 *     因为默认关掉沙箱会掩盖真实发布配置。
 *   MOZHOU_SELFCHECK_HEADLESS=1     不建托盘（无交互桌面时用）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import { deriveBasePort, isPortFree } from '../lib/port.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, '..')
const repoRoot = resolve(desktopDir, '..')

// 自检的临时数据根默认放在桌面壳目录下的 `.self-check/`（已 gitignore）。
// 刻意不用 os.tmpdir()：本仓库的开发机上有按「可执行文件位置」生效的写盘策略，
// 只放行工作区与少数受信任安装位置，Electron 进程写 %TEMP% / %LOCALAPPDATA% 会被
// 拒（EPERM）。把临时根放进工作区，自检在任何一台机器上都能真实跑起来。
const scratchBase = process.env.MOZHOU_SELFCHECK_ROOT
  ? resolve(process.env.MOZHOU_SELFCHECK_ROOT)
  : join(desktopDir, '.self-check')

const EXIT_PORT_TAKEN = 3

const extraArgs = (process.env.MOZHOU_SELFCHECK_ELECTRON_ARGS ?? '').split(/\s+/).filter(Boolean)
const headless = process.env.MOZHOU_SELFCHECK_HEADLESS === '1'

const results = []
// 悲观默认：只有 main() 正常跑完才会把退出码置为 0。这样任何「事件循环提前耗尽」
// （例如某个 close 回调不再触发）都会以非零退出，而不是把未跑完伪装成通过。
process.exitCode = 1

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}\n`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function childEnv(dataRoot, profileRoot) {
  const env = {
    ...process.env,
    MOZHOU_DATA_ROOT: dataRoot,
    MOZHOU_DESKTOP_PROFILE_ROOT: profileRoot,
    MOZHOU_DESKTOP_CHANNEL: 'test',
    MOZHOU_APP_DIR: join(repoRoot, 'apps', 'web'),
    MOZHOU_DESKTOP_SERVER_ENTRY: join(repoRoot, 'scripts', 'release', 'windows', 'desktop-server.mjs'),
    // 自检自身跑在官方 Node 上，把它钉给壳，避免 PATH 上另有 Node 时歧义
    MOZHOU_NODE_EXE: process.execPath,
  }
  // 父进程若从宿主 IDE 继承了这些变量，会污染被测 Electron
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_FORCE_RENDERER_ACCESSIBILITY
  delete env.CHROME_CRASHPAD_PIPE_NAME
  return env
}

function shellArgs(dataRoot, { headless: useHeadless }) {
  const args = [desktopDir, '--data-dir', dataRoot]
  if (useHeadless) args.push('--headless')
  args.push(...extraArgs)
  return args
}

async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await isPortFree(port)) return true
    if (Date.now() > deadline) return false
    await sleep(250)
  }
}

async function listenOn(server, port) {
  await new Promise((res, rej) => {
    server.once('error', rej)
    server.once('listening', res)
    server.listen(port, '127.0.0.1')
  })
}

/**
 * 选一个「派生端口真的可绑定」的临时数据根。
 *
 * 为什么需要挑：端口由数据根派生，而本机（以及装了 Hyper-V/WSL/Docker 的机器）常有
 * 大段端口被系统保留——绑定报 EADDRINUSE，但 netstat 里查不到任何监听者。实测本机
 * 43000–43999 里只有 254 个可绑定。这是**测试准备**，不是让壳换端口：壳本身仍然严格
 * 使用数据根派生的那一个端口，占用即明确失败（这正是场景 B 要验的行为）。
 */
async function pickDataRoot(kind) {
  mkdirSync(scratchBase, { recursive: true })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const root = mkdtempSync(join(scratchBase, `${kind}-`))
    const dataRoot = resolve(root, 'data')
    if (await isPortFree(deriveBasePort(dataRoot))) {
      return { root, dataRoot, profileRoot: resolve(root, 'profile') }
    }
    rmSync(root, { recursive: true, force: true })
  }
  throw new Error('60 次尝试都没找到可绑定的派生端口；本机 43000-43999 可能被大面积保留。')
}

async function scenarioA() {
  const { root, dataRoot, profileRoot } = await pickDataRoot('a')
  const port = deriveBasePort(dataRoot)
  let app = null
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: shellArgs(dataRoot, { headless }),
      env: childEnv(dataRoot, profileRoot),
      timeout: 90_000,
    })

    const win = await app.firstWindow({ timeout: 90_000 })
    let navigated = true
    try {
      await win.waitForURL((u) => u.href.startsWith(`http://127.0.0.1:${port}`), { timeout: 90_000 })
    } catch {
      navigated = false
    }
    const url = win.url()
    check('A1 窗口打开且 URL 为回环 http（非 file://）', navigated && url.startsWith(`http://127.0.0.1:${port}`), url)

    await win.waitForLoadState('domcontentloaded').catch(() => {})
    const title = await win.title().catch(() => '')
    check('A2 工作台页面已加载（标题含「墨舟」）', title.includes('墨舟'), title)

    const rootChildren = await win.evaluate(() => document.getElementById('root')?.childElementCount ?? 0).catch(() => -1)
    check('A3 React 已挂载到 #root', rootChildren > 0, String(rootChildren))

    const health = await win
      .evaluate(async () => {
        const res = await fetch('/api/health')
        return { status: res.status, body: await res.json() }
      })
      .catch((e) => ({ status: 0, body: { error: String(e) } }))
    check(
      'A4 工作台同源 /api/health 可达且 ok',
      health.status === 200 && health.body?.ok === true,
      `status=${health.status}`,
    )
    check(
      'A5 健康端点报告同一数据根',
      typeof health.body?.dataRoot === 'string' && resolve(health.body.dataRoot) === dataRoot,
      String(health.body?.dataRoot),
    )

    const prefs = await app
      .evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        const p = typeof w?.webContents?.getLastWebPreferences === 'function' ? w.webContents.getLastWebPreferences() : null
        return p ? { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox, webviewTag: p.webviewTag } : null
      })
      .catch(() => null)
    check('A6 nodeIntegration=false', prefs?.nodeIntegration === false, String(prefs?.nodeIntegration))
    check('A7 contextIsolation=true', prefs?.contextIsolation === true, String(prefs?.contextIsolation))
    check('A8 sandbox=true（渲染器沙箱）', prefs?.sandbox === true, String(prefs?.sandbox))
    check('A9 webviewTag=false', prefs?.webviewTag === false, String(prefs?.webviewTag))

    const shellPid = app.process().pid
    check('A10 服务端为独立进程（非壳主进程）', health.body?.pid !== shellPid, `server=${health.body?.pid} shell=${shellPid}`)

    const logPath = join(dataRoot, 'desktop.log')
    const logAfterStart = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    check(
      'A11 壳启动的是配置的官方 Node（非 Electron 自带 Node）',
      logAfterStart.includes(`node=${resolve(process.execPath)}`),
      resolve(process.execPath),
    )

    const proc = app.process()
    const exitPromise = new Promise((res) => proc.once('exit', (code) => res(code)))

    // 场景 C：单实例。同一数据根再启一次，应立刻退出 0 且不影响首实例。
    const second = spawn(electronPath, shellArgs(dataRoot, { headless: true }), {
      env: childEnv(dataRoot, profileRoot),
      stdio: 'ignore',
    })
    const secondCode = await Promise.race([
      new Promise((res) => second.once('exit', (c) => res(c))),
      sleep(30_000).then(() => 'timeout'),
    ])
    check('C1 同数据根第二实例立即退出 0（单实例锁生效）', secondCode === 0, String(secondCode))
    check('C2 首实例未受影响，仍在运行', app.process().exitCode === null, String(app.process().exitCode))

    await app.evaluate(({ app: a }) => a.quit()).catch(() => {})
    const code = await Promise.race([exitPromise, sleep(30_000).then(() => 'timeout')])
    check('A12 干净退出（退出码 0）', code === 0, String(code))

    const logAfterExit = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    check(
      'A13 退出走排空路径（非 Kill）',
      /服务端停机结果 drained=true/.test(logAfterExit),
      (logAfterExit.match(/服务端停机结果[^\n]*/) ?? ['(无停机日志)'])[0],
    )

    const released = await waitForPortFree(port, 20_000)
    check('A14 停机后派生端口已释放', released, String(port))
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}

async function scenarioB() {
  const { root, dataRoot, profileRoot } = await pickDataRoot('b')
  const port = deriveBasePort(dataRoot)
  // 记录并最终销毁被接受的连接：壳会对该端口做一次 /api/health 探测，探测留下的
  // 套接字若仍打开，server.close() 的回调永不触发，整个脚本会在事件循环耗尽时
  // 「静默退出」——那会把失败伪装成通过。
  const sockets = new Set()
  const blocker = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  let child = null
  try {
    await listenOn(blocker, port)
    child = spawn(electronPath, shellArgs(dataRoot, { headless: true }), {
      env: childEnv(dataRoot, profileRoot),
      stdio: 'ignore',
    })
    const code = await Promise.race([
      new Promise((res) => child.once('exit', (c) => res(c))),
      sleep(90_000).then(() => 'timeout'),
    ])
    check('B1 端口被外来进程占用时明确失败（退出码 3）', code === EXIT_PORT_TAKEN, String(code))

    const logPath = join(dataRoot, 'desktop.log')
    const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    check('B2 日志给出明确冲突原因', text.includes('已被占用'), text.includes('已被占用') ? '已记录' : '(缺失)')
    check('B3 未静默换端口（错误信息指明不再尝试其它端口）', text.includes('不会自动改用其它端口'))
  } finally {
    if (child && child.exitCode === null) child.kill()
    for (const socket of sockets) socket.destroy()
    await new Promise((res) => {
      const done = setTimeout(res, 3000)
      blocker.close(() => {
        clearTimeout(done)
        res()
      })
    })
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * 场景 D：`--stop`。拉起一个宿主，确认服务起来后，用 `--stop` 停它：
 * 应退出 0、宿主优雅退出、端口释放。这是 §3.2「跨代停止」里本代可验证的那一半。
 */
async function scenarioD() {
  const { root, dataRoot, profileRoot } = await pickDataRoot('d')
  const port = deriveBasePort(dataRoot)
  let host = null
  try {
    host = spawn(electronPath, shellArgs(dataRoot, { headless: true }), {
      env: childEnv(dataRoot, profileRoot),
      stdio: 'ignore',
    })

    let up = false
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`)
        if (res.ok && (await res.json()).ok === true) {
          up = true
          break
        }
      } catch {
        // 还没起来
      }
      await sleep(300)
    }
    check('D1 宿主服务已就绪（--stop 前）', up, String(port))
    if (!up) return

    const hostExit = new Promise((res) => host.once('exit', (c) => res(c)))
    const stopper = spawn(electronPath, shellArgs(dataRoot, { headless: true }).concat('--stop'), {
      env: childEnv(dataRoot, profileRoot),
      stdio: 'ignore',
    })
    const stopCode = await Promise.race([
      new Promise((res) => stopper.once('exit', (c) => res(c))),
      sleep(60_000).then(() => 'timeout'),
    ])
    check('D2 --stop 退出码 0', stopCode === 0, String(stopCode))

    const hostCode = await Promise.race([hostExit, sleep(30_000).then(() => 'timeout')])
    check('D3 宿主已被停止', hostCode !== 'timeout', String(hostCode))
    check('D4 停止后端口已释放', await waitForPortFree(port, 20_000), String(port))
  } finally {
    if (host && host.exitCode === null) host.kill()
    rmSync(root, { recursive: true, force: true })
  }
}

async function main() {
  process.stdout.write(`桌面壳自检：electron=${electronPath}\n`)
  process.stdout.write(`附加 Electron 开关：[${extraArgs.join(' ') || '(无)'}]\n\n`)

  await scenarioA()
  process.stdout.write('\n')
  await scenarioB()
  process.stdout.write('\n')
  await scenarioD()

  const failed = results.filter((r) => !r.ok)
  process.stdout.write(`\n自检结果：${results.length - failed.length}/${results.length} 通过\n`)
  if (failed.length > 0) {
    process.stdout.write(`失败项：\n${failed.map((f) => `  - ${f.name}`).join('\n')}\n`)
  }
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  process.stderr.write(`自检异常终止：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
