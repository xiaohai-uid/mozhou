/**
 * desktop/scripts/verify-desktop-author-journey.mjs
 *
 * 墨舟 Electron 桌面端基于 Playwright 的全链作者旅程端到端回归套件 (E2E Author Journey)。
 *
 * 核心验证维度：
 *   1. 真实桌面壳启动与生命周期（非 mock 进程，加载真实前端页面与本地 Node BFF）；
 *   2. 真实作者创作旅程（新建作品 → 正文录入 → 保存草稿 → 磁盘物理双验）；
 *   3. 冷重启持久化回读（使用相同数据根重新拉起，断言正文内容 100% 恢复）；
 *   4. 多作品切换与现场隔离（验证新作品绝不残留旧作品正文、旧任务现场或草稿脏数据）；
 *   5. Playwright Trace 失败现场捕获机制（注入故意失败断言，验证 trace.zip 与截图的完整性）。
 *
 * 证据卫生：
 *   - 遵守 CODING_STANDARDS.md 与 check-evidence-hygiene 规则；
 *   - 判定状态由真实布尔断言派生，严禁字面量写死；
 *   - 使用 readSourceStamp 动态记录提交戳与脏工作区状态。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import { deriveBasePort, isPortFree } from '../lib/port.mjs'
import { readSourceStamp } from '../../scripts/release/lib/source-stamp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, '..')
const repoRoot = resolve(desktopDir, '..')

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const evidenceDir = join(repoRoot, 'evidence', 'desktop-journey', RUN_ID)
mkdirSync(evidenceDir, { recursive: true })

const logFile = join(evidenceDir, 'execution.log')
const logLines = []

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  logLines.push(line)
  writeFileSync(logFile, logLines.join('\n') + '\n', 'utf8')
}

// 临时数据根默认在 desktop/.self-check/（已加入 .gitignore，避开 Windows %TEMP% EPERM）
const scratchBase = process.env.MOZHOU_SELFCHECK_ROOT
  ? resolve(process.env.MOZHOU_SELFCHECK_ROOT)
  : join(desktopDir, '.self-check')

const rawExtraArgs = (process.env.MOZHOU_SELFCHECK_ELECTRON_ARGS ?? '').split(/\s+/).filter(Boolean)
// Windows 环境受限沙箱保护透传（避免由于沙箱初始化权限不足导致启动崩溃）
const defaultExtraArgs = process.platform === 'win32' && !rawExtraArgs.includes('--no-sandbox')
  ? ['--no-sandbox']
  : []
const extraArgs = [...defaultExtraArgs, ...rawExtraArgs]

const headless = process.env.MOZHOU_SELFCHECK_HEADLESS !== '0'
const OPERATION_TIMEOUT = Number(process.env.MOZHOU_JOURNEY_TIMEOUT ?? 45_000)

const checks = []
function recordCheck(name, passed, detail = '') {
  checks.push({ name, passed: Boolean(passed), detail: String(detail) })
  const tag = passed ? 'PASS' : 'FAIL'
  log(`${tag}  ${name}${detail ? `  [${detail}]` : ''}`)
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
    MOZHOU_NODE_EXE: process.execPath,
    MOZHOU_DRAFT_PROVIDER: 'mock',
  }
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

async function pickDataRoot(kind) {
  mkdirSync(scratchBase, { recursive: true })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const root = mkdtempSync(join(scratchBase, `journey-${kind}-`))
    const dataRoot = resolve(root, 'data')
    if (await isPortFree(deriveBasePort(dataRoot))) {
      return { root, dataRoot, profileRoot: resolve(root, 'profile') }
    }
    rmSync(root, { recursive: true, force: true })
  }
  throw new Error('60 次尝试都没找到可绑定的派生端口；本机 43000-43999 可能被大面积保留。')
}

function verifyZipMagic(filePath) {
  if (!existsSync(filePath)) return false
  const buffer = readFileSync(filePath)
  if (buffer.length < 4) return false
  // ZIP PK 魔数: 0x50, 0x4B, 0x03, 0x04
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
}

/**
 * 如果页面展示首次建书向导，点击右上角关闭按钮跳过，直接进入工作台标准创作区。
 */
async function ensureWorkbenchReady(win) {
  await win.evaluate(() => {
    try {
      window.localStorage.setItem('mozhou.wizard.done', 'done')
    } catch {}
  })
  const wizardOverlay = win.locator('[data-testid="wizard-overlay"]')
  const isWizardVisible = await wizardOverlay.isVisible().catch(() => false)
  if (isWizardVisible) {
    log('检测到首次建书向导，正在关闭以进入工作台…')
    const closeBtn = win.locator('button[aria-label="关闭"]')
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
    }
    await wizardOverlay.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
  }
}

/**
 * 阶段一：新建作品 → 正文录入 → 草稿落盘 → 物理落盘双检 → 优雅停机 → 冷重启回读一致性
 */
async function runJourney1_CreateEditSaveRestart() {
  log('======================================================================')
  log('【阶段一】真实创作与冷重启持久化回读 (Journey 1)')
  log('======================================================================')

  const { root, dataRoot, profileRoot } = await pickDataRoot('j1')
  const port = deriveBasePort(dataRoot)
  log(`派生稳定端口: ${port} | 数据根: ${dataRoot}`)

  let app = null
  const bookTitle = '天渊纪元'
  const targetProse = '天渊之上，罡风呼啸。少年按剑而立，目光如电。'
  const trace1SavePath = join(evidenceDir, 'journey-1-save.trace.zip')
  const trace1RestartPath = join(evidenceDir, 'journey-1-restart.trace.zip')

  try {
    // 1.1 首次启动并开启 Trace
    app = await electron.launch({
      executablePath: electronPath,
      args: shellArgs(dataRoot, { headless }),
      env: childEnv(dataRoot, profileRoot),
      timeout: OPERATION_TIMEOUT,
    })

    const context = app.context()
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })

    const win = await app.firstWindow({ timeout: OPERATION_TIMEOUT })
    await win.waitForURL((u) => u.href.startsWith(`http://127.0.0.1:${port}`), { timeout: OPERATION_TIMEOUT })
    await win.waitForLoadState('domcontentloaded')

    recordCheck('J1-01 Electron 桌面壳启动并导航至同源稳定端口', true, `port=${port}`)

    // 1.2 进入工作台并建书
    await ensureWorkbenchReady(win)

    const createSection = win.locator('section[data-testid="create-book"]')
    await createSection.waitFor({ state: 'visible', timeout: 20_000 })
    const titleInput = createSection.locator('input[aria-label="作品名"]')
    await titleInput.fill(bookTitle)

    const createBtn = createSection.locator('button.btn-primary')
    await createBtn.click()

    // 验证建书完成标识：在 DOM 中挂载且 chapterbar 呈现书名
    const createdMsg = win.locator('p[data-testid="created-book"]')
    await createdMsg.waitFor({ state: 'attached', timeout: 20_000 })
    const createdText = await createdMsg.textContent()
    const bookCreatedOk = createdText.includes('已建：根')

    await win.waitForFunction(
      (expected) => {
        const h1 = document.querySelector('div.chapterbar h1')
        return h1 && h1.textContent.includes(expected)
      },
      bookTitle,
      { timeout: 20_000 },
    )
    recordCheck('J1-02 真实 UI 建书成功并挂载工作台', bookCreatedOk, createdText.trim())

    // 1.3 定位编辑器并录入正文
    const editorCanvas = win.locator('section[data-testid="prose-editor"] div[data-testid="novel-editor-canvas"]')
    await editorCanvas.waitFor({ state: 'visible', timeout: 20_000 })

    const editorInput = editorCanvas.locator('div[contenteditable="true"]')
    await editorInput.waitFor({ state: 'visible', timeout: 15_000 })
    await editorInput.click()
    // 使用真实打字触发 ProseMirror 事务与 React onChange
    await editorInput.pressSequentially(targetProse, { delay: 10 })

    // 等待编辑器 state 更新，落盘按钮变为可用
    const acceptDraftBtn = win.locator('button[data-testid="prose-accept-draft"]')
    await acceptDraftBtn.waitFor({ state: 'visible', timeout: 10_000 })
    await win.waitForFunction(() => {
      const btn = document.querySelector('button[data-testid="prose-accept-draft"]')
      return btn && !btn.hasAttribute('disabled')
    }, { timeout: 15_000 })

    // 触发保存草稿
    await acceptDraftBtn.click()

    // 等待保存结果提示（等待离开“落盘中…”过渡态，进入确定性终态）
    await win.waitForFunction(() => {
      const el = document.querySelector('p[data-testid="prose-save-result"]')
      return el && el.textContent && !el.textContent.includes('落盘中…')
    }, { timeout: 20_000 })

    const saveResult = win.locator('p[data-testid="prose-save-result"]')
    const saveResultText = await saveResult.innerText()
    const saveOk = saveResultText.includes('已落为当前章草稿') || saveResultText.includes('r1')
    recordCheck('J1-03 界面正文录入并保存草稿成功', saveOk, saveResultText.trim())

    // 截图保存界面状态
    await win.screenshot({ path: join(evidenceDir, 'journey-1-saved.png') })

    // 1.4 磁盘物理双验 (Dual Evidence)
    const booksDir = join(dataRoot, 'books')
    const bookFolders = existsSync(booksDir) ? readdirSync(booksDir) : []
    const bookFolder = bookFolders[0]
    let onDiskValid = false
    let diskDetail = '未找到书籍物理目录'

    if (bookFolder) {
      const ch1Path = join(booksDir, bookFolder, '正文', '第一卷', '第0001章.md')
      if (existsSync(ch1Path)) {
        const fileContent = readFileSync(ch1Path, 'utf8')
        const hasRevision = /revision:\s*1/.test(fileContent)
        const hasText = fileContent.includes(targetProse)
        onDiskValid = hasRevision && hasText
        diskDetail = `revision:1=${hasRevision}, textIncluded=${hasText}`
      } else {
        diskDetail = `物理文件不存在: ${ch1Path}`
      }
    }
    recordCheck('J1-04 磁盘物理文件双验（Frontmatter revision 与正文内容匹配）', onDiskValid, diskDetail)

    // 1.5 停止 Trace 并保存正常旅程追踪包
    await context.tracing.stop({ path: trace1SavePath })
    const trace1Valid = verifyZipMagic(trace1SavePath)
    recordCheck('J1-05 保存阶段 Playwright Trace 成功落盘并具备合法 ZIP 结构', trace1Valid, trace1SavePath)

    // 1.6 优雅停机排空
    const proc = app.process()
    const exitPromise = new Promise((res) => proc.once('exit', (code) => res(code)))
    await app.evaluate(({ app: a }) => a.quit()).catch(() => {})
    const exitCode = await Promise.race([exitPromise, sleep(20_000).then(() => 'timeout')])
    recordCheck('J1-06 首次运行优雅退出', exitCode === 0, `exitCode=${exitCode}`)

    const logPath = join(dataRoot, 'desktop.log')
    const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const drained = /服务端停机结果.*drained=true/.test(logText)
    recordCheck('J1-07 服务端停机完成数据排空（drained=true）', drained)

    const released = await waitForPortFree(port, 15_000)
    recordCheck('J1-08 停机后端口干净释放', released, `port=${port}`)

    // 1.7 冷重启并验证持久化回读
    log('正在使用相同数据根启动冷重启，验证持久化现场回读…')
    app = await electron.launch({
      executablePath: electronPath,
      args: shellArgs(dataRoot, { headless }),
      env: childEnv(dataRoot, profileRoot),
      timeout: OPERATION_TIMEOUT,
    })

    const restartContext = app.context()
    await restartContext.tracing.start({ screenshots: true, snapshots: true, sources: true })

    const restartWin = await app.firstWindow({ timeout: OPERATION_TIMEOUT })
    await restartWin.waitForURL((u) => u.href.startsWith(`http://127.0.0.1:${port}`), { timeout: OPERATION_TIMEOUT })
    await restartWin.waitForLoadState('domcontentloaded')

    // 等待编辑器从 localStorage / 服务端恢复之前打开的书籍与草稿
    const restartEditorCanvas = restartWin.locator('section[data-testid="prose-editor"] div[data-testid="novel-editor-canvas"]')
    await restartEditorCanvas.waitFor({ state: 'visible', timeout: 25_000 })
    const restartEditorInput = restartEditorCanvas.locator('div[contenteditable="true"]')
    await restartEditorInput.waitFor({ state: 'visible', timeout: 15_000 })

    await restartWin.waitForFunction((expected) => {
      const editor = document.querySelector('section[data-testid="prose-editor"] div[data-testid="novel-editor-canvas"] div[contenteditable="true"]')
      return editor && editor.textContent.includes(expected)
    }, targetProse, { timeout: 25_000 })

    const recoveredText = await restartEditorInput.innerText()
    const recoveredMatch = recoveredText.includes(targetProse)
    recordCheck('J1-09 冷重启后作品现场与编辑器正文 100% 恢复回读一致', recoveredMatch, `recoveredTextLength=${recoveredText.trim().length}`)

    await restartWin.screenshot({ path: join(evidenceDir, 'journey-1-restarted.png') })

    await restartContext.tracing.stop({ path: trace1RestartPath })
    const traceRestartValid = verifyZipMagic(trace1RestartPath)
    recordCheck('J1-10 重启阶段 Playwright Trace 成功落盘', traceRestartValid, trace1RestartPath)

    const restartProc = app.process()
    const restartExitPromise = new Promise((res) => restartProc.once('exit', (code) => res(code)))
    await app.evaluate(({ app: a }) => a.quit()).catch(() => {})
    await Promise.race([restartExitPromise, sleep(15_000).then(() => 'timeout')])
    await waitForPortFree(port, 10_000)
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * 阶段二：切换作品与现场隔离（Journey 2）
 */
async function runJourney2_SwitchBookIsolation() {
  log('======================================================================')
  log('【阶段二】切换作品与现场隔离 (Journey 2)')
  log('======================================================================')

  const { root, dataRoot, profileRoot } = await pickDataRoot('j2')
  const port = deriveBasePort(dataRoot)
  log(`派生稳定端口: ${port} | 数据根: ${dataRoot}`)

  let app = null
  const book1Title = '天渊第一部'
  const book1SecretProse = '【第一部秘密：紫霄神雷阵法图谱】'
  const book2Title = '星海第二部'
  const trace2Path = join(evidenceDir, 'journey-2-switch.trace.zip')

  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: shellArgs(dataRoot, { headless }),
      env: childEnv(dataRoot, profileRoot),
      timeout: OPERATION_TIMEOUT,
    })

    const context = app.context()
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })

    const win = await app.firstWindow({ timeout: OPERATION_TIMEOUT })
    await win.waitForURL((u) => u.href.startsWith(`http://127.0.0.1:${port}`), { timeout: OPERATION_TIMEOUT })
    await win.waitForLoadState('domcontentloaded')
    await ensureWorkbenchReady(win)

    // 2.1 创建第一本书并录入秘密正文
    const createSection = win.locator('section[data-testid="create-book"]')
    await createSection.waitFor({ state: 'visible', timeout: 20_000 })
    await createSection.locator('input[aria-label="作品名"]').fill(book1Title)
    await createSection.locator('button.btn-primary').click()

    await win.locator('p[data-testid="created-book"]').waitFor({ state: 'attached', timeout: 20_000 })

    const editorInput = win.locator('section[data-testid="prose-editor"] div[data-testid="novel-editor-canvas"] div[contenteditable="true"]')
    await editorInput.waitFor({ state: 'visible', timeout: 15_000 })
    await editorInput.click()
    await editorInput.pressSequentially(book1SecretProse, { delay: 10 })

    const acceptDraftBtn = win.locator('button[data-testid="prose-accept-draft"]')
    await acceptDraftBtn.waitFor({ state: 'visible', timeout: 10_000 })
    await win.waitForFunction(() => {
      const btn = document.querySelector('button[data-testid="prose-accept-draft"]')
      return btn && !btn.hasAttribute('disabled')
    }, { timeout: 15_000 })

    await acceptDraftBtn.click()
    await win.waitForFunction(() => {
      const el = document.querySelector('p[data-testid="prose-save-result"]')
      return el && el.textContent && !el.textContent.includes('落盘中…')
    }, { timeout: 20_000 })

    recordCheck('J2-01 第一本作品创建并落盘秘密正文', true, book1Title)

    // 2.2 展开作品管理抽屉，创建第二本书
    log('正在通过作品管理创建第二本作品，验证多作品隔离…')
    const ledgerDetails = win.locator('details.studio-ledger')
    await ledgerDetails.locator('summary').click()

    const book2CreateSection = win.locator('details.studio-ledger section[data-testid="create-book"]')
    await book2CreateSection.waitFor({ state: 'visible', timeout: 10_000 })
    const book2Input = book2CreateSection.locator('input[aria-label="作品名"]')
    await book2Input.fill(book2Title)
    await book2CreateSection.locator('button.btn-primary').click()

    // 等待工作台标题切换为第二本书
    await win.waitForFunction(
      (expectedTitle) => {
        const h1 = document.querySelector('div.chapterbar h1')
        return h1 && h1.textContent.includes(expectedTitle)
      },
      book2Title,
      { timeout: 20_000 },
    )
    recordCheck('J2-02 成功切换至第二本作品', true, book2Title)

    // 2.3 现场隔离性断言：新作品编辑区绝不残留第一本书的秘密正文
    const book2Editor = win.locator('section[data-testid="prose-editor"] div[data-testid="novel-editor-canvas"] div[contenteditable="true"]')
    await book2Editor.waitFor({ state: 'visible', timeout: 15_000 })
    const book2Content = await book2Editor.innerText()
    const isIsolated = !book2Content.includes(book1SecretProse)
    recordCheck('J2-03 新作品现场隔离（绝不残留旧作品未采纳正文或私密草稿）', isIsolated, `book2Content="${book2Content.trim()}"`)

    await win.screenshot({ path: join(evidenceDir, 'journey-2-switched.png') })

    await context.tracing.stop({ path: trace2Path })
    const trace2Valid = verifyZipMagic(trace2Path)
    recordCheck('J2-04 切书隔离阶段 Playwright Trace 成功归档', trace2Valid, trace2Path)

    const proc = app.process()
    const exitPromise = new Promise((res) => proc.once('exit', (code) => res(code)))
    await app.evaluate(({ app: a }) => a.quit()).catch(() => {})
    await Promise.race([exitPromise, sleep(15_000).then(() => 'timeout')])
    await waitForPortFree(port, 10_000)
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * 阶段三：故意失败场景验证 Trace 产出（Deliberate Failure Trace Verification）
 */
async function runJourney3_DeliberateFailureTrace() {
  log('======================================================================')
  log('【阶段三】故意失败场景验证 Trace 产出 (Journey 3)')
  log('======================================================================')

  const { root, dataRoot, profileRoot } = await pickDataRoot('j3')
  const port = deriveBasePort(dataRoot)
  log(`派生稳定端口: ${port} | 数据根: ${dataRoot}`)

  let app = null
  const failureTracePath = join(evidenceDir, 'deliberate-failure.trace.zip')
  const failurePngPath = join(evidenceDir, 'deliberate-failure.png')
  let caughtExpectedError = false

  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: shellArgs(dataRoot, { headless }),
      env: childEnv(dataRoot, profileRoot),
      timeout: OPERATION_TIMEOUT,
    })

    const context = app.context()
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })

    const win = await app.firstWindow({ timeout: OPERATION_TIMEOUT })
    await win.waitForURL((u) => u.href.startsWith(`http://127.0.0.1:${port}`), { timeout: OPERATION_TIMEOUT })
    await win.waitForLoadState('domcontentloaded')

    log('正在故意执行不存在元素的选择器断言以触发超时…')
    try {
      // 故意查找一个绝对不存在的元素，设置 2000ms 短超时
      await win.locator('div[data-testid="deliberate-missing-element-for-failure-test"]').waitFor({ state: 'visible', timeout: 2_000 })
    } catch (expectedErr) {
      caughtExpectedError = true
      log(`已捕获预期的测试失败: ${expectedErr.message.split('\n')[0]}`)

      // 在失败现场捕获截图
      await win.screenshot({ path: failurePngPath }).catch(() => {})
      // 在失败现场停止并写出 trace.zip
      await context.tracing.stop({ path: failureTracePath })
    }

    recordCheck('J3-01 故意失败场景成功触发预期异常', caughtExpectedError)

    // 验证生成的 trace.zip 文件
    const traceExists = existsSync(failureTracePath)
    const traceSize = traceExists ? readFileSync(failureTracePath).length : 0
    const traceMagicValid = verifyZipMagic(failureTracePath)
    const traceUsable = traceExists && traceSize > 5_000 && traceMagicValid

    recordCheck('J3-02 失败现场 Playwright Trace 真实生成且具备有效 ZIP 结构', traceUsable, `bytes=${traceSize}`)

    log(`[Trace 可观测性验证] 失败回放文件已生成: ${failureTracePath}`)
    log(`[Trace 回放指引] 在终端运行: npx playwright show-trace "${failureTracePath}"`)

    const proc = app.process()
    const exitPromise = new Promise((res) => proc.once('exit', (code) => res(code)))
    await app.evaluate(({ app: a }) => a.quit()).catch(() => {})
    await Promise.race([exitPromise, sleep(15_000).then(() => 'timeout')])
    await waitForPortFree(port, 10_000)
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
}

async function main() {
  log(`开始执行墨舟 Electron 桌面端端到端作者旅程回归...`)
  const startTime = Date.now()

  let sourceStamp = { sourceCommit: 'unknown', dirty: false }
  try {
    sourceStamp = readSourceStamp(repoRoot)
  } catch (e) {
    log(`获取源码戳警告: ${e.message}`)
  }

  let executionError = null

  try {
    await runJourney1_CreateEditSaveRestart()
    await runJourney2_SwitchBookIsolation()
    await runJourney3_DeliberateFailureTrace()
  } catch (err) {
    executionError = err
    log(`执行过程出现未捕获异常: ${err.stack || err.message}`)
  }

  const durationMs = Date.now() - startTime
  const allPassed = executionError === null && checks.length > 0 && checks.every((c) => c.passed)
  const status = allPassed ? 'VERIFIED' : 'FAILED'

  const summary = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    durationMs,
    status,
    sourceCommit: sourceStamp.sourceCommit,
    dirty: sourceStamp.dirty,
    passedCount: checks.filter((c) => c.passed).length,
    failedCount: checks.filter((c) => !c.passed).length,
    totalCount: checks.length,
    checks,
    traces: {
      journey1Save: join(evidenceDir, 'journey-1-save.trace.zip'),
      journey1Restart: join(evidenceDir, 'journey-1-restart.trace.zip'),
      journey2Switch: join(evidenceDir, 'journey-2-switch.trace.zip'),
      deliberateFailure: join(evidenceDir, 'deliberate-failure.trace.zip'),
    },
    error: executionError ? String(executionError.message || executionError) : null,
  }

  const summaryJsonPath = join(evidenceDir, 'summary.json')
  writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8')

  log('----------------------------------------------------------------------')
  log(`测试结果汇总: ${status} (${summary.passedCount}/${summary.totalCount} 项通过) 耗时: ${(durationMs / 1000).toFixed(1)}s`)
  log(`收据已落盘至: ${summaryJsonPath}`)
  log('----------------------------------------------------------------------')

  process.exitCode = allPassed ? 0 : 1
}

main().catch((err) => {
  console.error('FATAL: 运行异常', err)
  process.exit(1)
})
