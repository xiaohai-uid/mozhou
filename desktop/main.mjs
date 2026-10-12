/**
 * 墨舟 Electron 桌面壳（Windows x64 先行）。
 *
 * 职责边界（ADR-0037 / 迁移计划 §3.2）：窗口、托盘、单实例、稳定端口、就绪握手、
 * 优雅停机、导航与权限边界。**不**把服务端并入主进程，**不**改前端 origin/localStorage
 * 契约——窗口加载 `http://127.0.0.1:<稳定端口>`，与旧「开系统浏览器」同一 origin，
 * 故旧浏览器里「上次打开的作品」仍能被工作台读回（迁移计划 §1.5）。
 *
 * 命令行（对齐旧 C# 启动器的词汇）：
 *   --data-dir <path>  覆盖服务数据根
 *   --stop             停止本数据根上由本代壳托管的实例，并等锁/端口释放
 *   --no-open          启动后不显示窗口
 *   --headless         不建托盘、不弹对话框（自动化/自检用）
 * 未知参数一律忽略（Electron/Chromium 会注入自己的开关），不做位置相关解析。
 */
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, session as electronSession, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logLine, setLogPath } from './lib/log.mjs'
import {
  resolveAppUrl,
  resolveChannel,
  resolveDataRoot,
  resolveNodeExe,
  resolveProfileRoot,
  resolveServerEntry,
} from './lib/paths.mjs'
import {
  LEGACY_PORT_SCAN_WINDOW,
  deriveBasePort,
  findInstanceInRange,
  identifyMozhouService,
  isPortFree,
  probeHealth,
} from './lib/port.mjs'
import { startServer, stopServer } from './lib/server-process.mjs'
import { hardenSession } from './lib/security.mjs'
import { createTrayIconPng } from './lib/tray-icon.mjs'

/** 退出码：非零即「明确失败」，供安装器/自检判定，不允许静默降级。 */
export const EXIT = {
  OK: 0,
  DATA_ROOT: 6,
  PORT_TAKEN: 3,
  SERVER_FAILED: 4,
  STOP_TIMEOUT: 7,
  FOREIGN_SERVICE: 8,
  /** 停机未完成排空（崩溃 / 被信号结束 / 超时强杀）。E04：不得报成普通成功。 */
  DRAIN_FAILED: 9,
}

const APP_USER_MODEL_ID = 'MoZhou.Local.Desktop'
const STOP_WAIT_MS = 30_000

function parseArgs(argv) {
  const out = { dataDir: null, stop: false, noOpen: false, headless: false, ignored: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--data-dir' && i + 1 < argv.length) out.dataDir = argv[(i += 1)]
    else if (arg.startsWith('--data-dir=')) out.dataDir = arg.slice('--data-dir='.length)
    else if (arg === '--stop') out.stop = true
    else if (arg === '--no-open') out.noOpen = true
    else if (arg === '--headless') out.headless = true
    else out.ignored.push(arg)
  }
  return out
}

const cli = parseArgs(process.argv.slice(1))

let dataRoot
try {
  dataRoot = resolveDataRoot(cli.dataDir)
} catch (error) {
  process.stderr.write(`墨舟启动失败：${error instanceof Error ? error.message : String(error)}\n`)
  app.exit(EXIT.DATA_ROOT)
}

let window = null
let tray = null
let ownedServer = null
let isQuitting = false
let exitCode = EXIT.OK

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function showFatal(title, message) {
  logLine(`[shell] 致命错误：${title} — ${message}`)
  if (!cli.headless) {
    try {
      dialog.showErrorBox(title, message)
    } catch {
      // 无交互桌面时忽略
    }
  }
}

function focusWindow() {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return
  }
  if (currentUrl) window = createWindow(currentUrl)
}

let currentUrl = null

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: '墨舟 · 本地写作工作台',
    backgroundColor: '#f5f1e8',
    webPreferences: {
      // 安全基线（计划 §3.2）：不给渲染进程 Node、隔离开上下文、开渲染器沙箱。
      // 不设 preload：壳不暴露任何 IPC/文件桥，渲染进程只有同源 HTTP 一条路。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  })

  win.once('ready-to-show', () => {
    if (!cli.noOpen) win.show()
  })
  // 关窗口只收进托盘，不退出应用（退出统一走托盘菜单/--stop，保证服务被排空）
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })
  win.webContents.on('did-fail-load', (_e, code, desc, validatedUrl) => {
    logLine(`[shell] 页面加载失败 code=${code} desc=${desc} url=${validatedUrl}`)
  })
  // 绝不用 file://：那会丢掉现有 origin 契约与 localStorage 恢复路径
  void win.loadURL(url)
  return win
}

async function requestQuit(reason) {
  if (isQuitting) return
  isQuitting = true
  logLine(`[shell] 退出流程开始（${reason}）`)
  if (ownedServer) {
    const result = await stopServer(ownedServer)
    logLine(
      `[shell] 服务端停机结果 outcome=${result.outcome} drained=${result.drained} killed=${result.killed} ` +
        `code=${result.exitCode} signal=${result.signalCode} — ${result.detail}`,
    )
    if (!result.drained && exitCode === EXIT.OK) {
      // 崩溃、被外部信号结束、超时强杀都不是「安全退出」。E04 合同：对应异常不得继续返回普通成功。
      exitCode = EXIT.DRAIN_FAILED
      logLine('[shell] 未完成排空：退出码置为非零（DRAIN_FAILED），避免把强杀或崩溃报成安全退出。')
    }
  } else {
    logLine('[shell] 无本壳托管的服务端子进程，跳过停机。')
  }
  app.exit(exitCode)
}

app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  void requestQuit('before-quit')
})

app.on('window-all-closed', () => {
  // 托盘常驻应用：窗口全关不退出（Electron 默认会退出，这里显式拦住）
})

/** 等本数据根上的服务与锁真正释放（`--stop` 用）。 */
async function waitForRelease(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await isPortFree(port)) return true
    if (Date.now() > deadline) return false
    await sleep(250)
  }
}

/** 已持有壳单实例锁、但只想停别人的场景（本进程不是宿主）。 */
async function handleStopWithoutHost(basePort) {
  // 旧版启动器会从基准端口逐个 +1 找空闲端口（MoZhou.cs 的 FindStablePort）。只看基准端口
  // 会在「基准端口空闲」时报「没有在跑的实例」——而旧版其实还在 fallback 端口上跑着。
  const found = await findInstanceInRange(dataRoot, basePort)
  if (found === null) {
    logLine(`[shell] --stop：基准端口 ${basePort} 及其后 ${LEGACY_PORT_SCAN_WINDOW} 个端口上没有墨舟实例。`)
    app.exit(EXIT.OK)
    return
  }
  if (found.result.kind === 'authenticated') {
    showFatal(
      '墨舟',
      `端口 ${found.port} 上有一个墨舟服务（PID ${found.result.pid}）不属于本代桌面壳，无法停止。\n` +
        '请先结束旧版启动器托管的墨舟，再重试。',
    )
    app.exit(EXIT.FOREIGN_SERVICE)
    return
  }
  // 归属无法核实：不杀、也不报成功（E03 合同「未知外来进程不杀」）。
  showFatal(
    '墨舟',
    `端口 ${found.port} 上有服务声称是本数据根（${dataRoot}）的墨舟实例（PID ${found.result.pid}），但归属无法核实：\n` +
      `${found.result.reason}。\n本壳不会停止无法确认归属的进程；请自行确认并结束它，或改用其它数据根。`,
  )
  app.exit(EXIT.FOREIGN_SERVICE)
}

async function startPrimary() {
  const basePort = deriveBasePort(dataRoot)
  const free = await isPortFree(basePort)

  let serviceUrl
  let servicePid

  if (free) {
    // 基准端口空闲，但同一数据根可能已有实例落在 fallback 端口上（旧版启动器会逐个 +1）。
    // 同一个数据根出现两个写服务会造成双写，故先扫窗口再决定是否另起。
    const running = await findInstanceInRange(dataRoot, basePort)
    if (running !== null) {
      showFatal(
        '墨舟无法启动',
        `数据根 ${dataRoot} 上已有墨舟实例在端口 ${running.port} 运行（PID ${running.result.pid}；` +
          `归属：${running.result.kind === 'authenticated' ? '已核实' : `无法核实——${running.result.reason}`}）。\n` +
          '为避免同一数据根出现两个写服务，墨舟不会另起一个。请先停止该实例。',
      )
      app.exit(EXIT.FOREIGN_SERVICE)
      return
    }
    // 基准端口空闲：拉服务。绝不因为后续任何原因改端口。
    const nodeExe = resolveNodeExe()
    const serverEntry = resolveServerEntry()
    const appUrl = resolveAppUrl()
    logLine(`[shell] 启动服务：node=${nodeExe} entry=${serverEntry} port=${basePort}`)
    const { child, ready } = await startServer({
      nodeExe,
      serverEntry,
      appUrl,
      dataRoot,
      port: basePort,
      cwd: join(serverEntry, '..'),
    })
    ownedServer = child
    serviceUrl = ready.url
    servicePid = ready.pid

    // 私有 stdout 通道已证明归属；健康端点只作旁证（防「绑定成功但立刻降级」）
    const health = await probeHealth(basePort)
    if (!health || health.ok !== true || health.pid !== servicePid) {
      throw new Error(`服务端就绪后健康检查未通过（pid=${servicePid}）。`)
    }

    child.on('exit', (code, signal) => {
      if (isQuitting) return
      logLine(`[shell] 服务端意外退出 code=${code} signal=${signal}`)
      exitCode = EXIT.SERVER_FAILED
      showFatal('墨舟', '本地服务已退出。请重新打开墨舟；详情见数据目录 desktop.log。')
      void requestQuit('server-exit')
    })
  } else {
    // 基准端口被占：只接受「本数据根、且归属可核实」的实例，否则明确失败，不换端口。
    const existing = await identifyMozhouService(basePort, dataRoot)
    if (existing.kind === 'unverified') {
      // 复用等于以受信任 origin 载入一个无法确认归属的服务——这正是「外来健康服务被接受」
      // 那条缺陷的入口。归属没有证据就拒绝复用（E03 合同）。
      showFatal(
        '墨舟无法启动',
        `端口 ${basePort} 上有服务声称是本数据根（${dataRoot}）的墨舟实例（PID ${existing.pid}），` +
          `但归属无法核实：\n${existing.reason}。\n` +
          '复用它会以受信任 origin 载入一个无法确认归属的服务，故墨舟拒绝复用。\n' +
          '请释放该端口，或用一个会派生出其它端口的数据目录（--data-dir）后重试。',
      )
      app.exit(EXIT.FOREIGN_SERVICE)
      return
    }
    if (existing.kind === 'none') {
      showFatal(
        '墨舟无法启动',
        `端口 ${basePort} 已被占用，或该端口在本机被系统/其它程序保留（绑定返回 EADDRINUSE），\n` +
          `且它不是本数据根（${dataRoot}）的墨舟实例。\n` +
          '为避免静默更换 origin（会让工作台读不回上次打开的作品），墨舟不会自动改用其它端口。\n' +
          '请释放该端口，或用一个会派生出其它端口的数据目录（--data-dir）后重试。',
      )
      app.exit(EXIT.PORT_TAKEN)
      return
    }
    serviceUrl = existing.url
    servicePid = existing.pid
    logLine(`[shell] 复用已在运行的墨舟服务 PID ${servicePid}（端口 ${basePort}），不另起进程。`)
  }

  currentUrl = serviceUrl
  writeFileSync(
    join(dataRoot, 'desktop-session.json'),
    JSON.stringify({ url: serviceUrl, pid: servicePid, launcherPid: process.pid }),
    'utf8',
  )

  hardenSession({ app, session: electronSession.defaultSession, allowedOrigin: `http://127.0.0.1:${basePort}` })

  window = createWindow(serviceUrl)

  if (!cli.headless) {
    tray = new Tray(nativeImage.createFromBuffer(createTrayIconPng(32)))
    tray.setToolTip('墨舟 · 本地写作工作台')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开墨舟', click: () => focusWindow() },
        { label: '打开书稿与数据目录', click: () => void shell.openPath(dataRoot) },
        { type: 'separator' },
        { label: '退出墨舟', click: () => void requestQuit('tray') },
      ]),
    )
    tray.on('double-click', () => focusWindow())
  }

  logLine(`[shell] 就绪：${serviceUrl}`)
}

async function bootstrap() {
  const channel = resolveChannel()
  const profileRoot = resolveProfileRoot(dataRoot, channel)
  const userDataDir = join(profileRoot, 'user-data')
  const sessionDataDir = join(profileRoot, 'session-data')
  const crashDumpsDir = join(profileRoot, 'crash-dumps')
  const logsDir = join(profileRoot, 'logs')
  // 数据根必须在写第一条日志之前就存在：服务端子进程自己会 mkdir 数据根，但壳在拉起它
  // 之前就要记「用哪个 Node / 哪个入口」，若那时目录还不存在，appendFileSync 会 ENOENT
  // 而被日志模块静默吞掉——最需要的那几条启动线索恰好丢失。
  mkdirSync(dataRoot, { recursive: true })
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(sessionDataDir, { recursive: true })
  mkdirSync(crashDumpsDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })

  // 必须早于 app.ready：固定 userData/sessionData，开发/测试/正式分离。
  // crashDumps/logs 一并钉进 profile 根，避免 Electron 默认写到 %LOCALAPPDATA% 下的
  // 另一处（既污染用户目录，也让「profile 随数据根走」这条不变量破一个口子）。
  app.setPath('userData', userDataDir)
  app.setPath('sessionData', sessionDataDir)
  app.setPath('crashDumps', crashDumpsDir)
  app.setPath('logs', logsDir)
  app.setAppUserModelId(APP_USER_MODEL_ID)
  setLogPath(join(dataRoot, 'desktop.log'))

  const gotLock = app.requestSingleInstanceLock(cli.stop ? { mozhouStop: true } : { mozhouLaunch: true })
  const basePort = deriveBasePort(dataRoot)

  if (!gotLock) {
    // 已有实例：Electron 已把请求投递给主实例（含 additionalData）
    if (cli.stop) {
      const released = await waitForRelease(basePort, STOP_WAIT_MS)
      if (!released) {
        process.stderr.write(`墨舟停止超时：端口 ${basePort} 在 ${STOP_WAIT_MS}ms 内未释放。\n`)
        app.exit(EXIT.STOP_TIMEOUT)
        return
      }
    }
    app.exit(EXIT.OK)
    return
  }

  app.on('second-instance', (_event, argv, _cwd, additionalData) => {
    const wantsStop = additionalData?.mozhouStop === true || parseArgs(argv).stop
    if (wantsStop) {
      void requestQuit('stop-request')
      return
    }
    focusWindow()
  })

  await app.whenReady()

  if (cli.stop) {
    await handleStopWithoutHost(basePort)
    return
  }

  try {
    await startPrimary()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const tail = Array.isArray(error?.stderrTail) && error.stderrTail.length > 0 ? `\n\n服务端输出：\n${error.stderrTail.join('\n')}` : ''
    showFatal('墨舟启动失败', `${message}${tail}`)
    app.exit(EXIT.SERVER_FAILED)
  }
}

if (dataRoot !== undefined) {
  void bootstrap()
}
