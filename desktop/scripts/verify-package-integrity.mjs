#!/usr/bin/env node
/**
 * desktop/scripts/verify-package-integrity.mjs
 *
 * 自动化打包校验脚本：对构建完成的 Electron 桌面打包产物进行结构完整性与运行时健康核检。
 *
 * 验证项目：
 *   1. 产物清单与文件结构（MoZhou.exe, resources/app.asar, resources/runtime/node.exe, resources/desktop-server.mjs）；
 *   2. 服务端独立部署树（resources/app/{dist, dist-server, package.json} 与物化依赖包）；
 *   3. 随包官方 Node 与 原生 SQLite (better-sqlite3) ABI 兼容性实测；
 *   4. 桌面壳主程序无沙箱与静默停机指令（--no-sandbox --headless --stop）进程启动与优雅退出；
 *   5. 源码戳与脏状态采集，证据收据落盘。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSourceStamp } from '../../scripts/release/lib/source-stamp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, '..')
const repoRoot = resolve(desktopDir, '..')
const artifactsDir = join(repoRoot, 'release-artifacts')

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const evidenceDir = join(repoRoot, 'evidence', 'desktop-package-integrity', RUN_ID)
mkdirSync(evidenceDir, { recursive: true })

const checks = []
function recordCheck(name, passed, detail = '') {
  checks.push({ name, passed: Boolean(passed), detail: String(detail) })
  const tag = passed ? 'PASS' : 'FAIL'
  console.log(`${tag}  ${name}${detail ? `  [${detail}]` : ''}`)
}

console.log('[verify-package-integrity] 开始执行桌面安装包自动化校验...')

const currentStamp = readSourceStamp(repoRoot)

// 1. 寻找最近的 Electron 构建产物目录或打包结果记录
let targetBundle = process.env.MOZHOU_BUNDLE_PATH
const resultFile = join(artifactsDir, 'windows-electron-build-result.json')
const dirResultFile = join(artifactsDir, 'windows-desktop-dir-result.json')

if (!targetBundle) {
  if (existsSync(dirResultFile)) {
    try {
      const data = JSON.parse(readFileSync(dirResultFile, 'utf8'))
      if (data.bundle && existsSync(data.bundle)) {
        if (data.sourceCommitSha === currentStamp.sourceCommitSha) {
          targetBundle = data.bundle
        } else {
          console.warn(`[verify-package-integrity] 既有目录构建记录对应旧提交 (${data.sourceCommitSha} != 当前 ${currentStamp.sourceCommitSha})，触发重新构建...`)
        }
      }
    } catch {}
  } else if (existsSync(resultFile)) {
    try {
      const data = JSON.parse(readFileSync(resultFile, 'utf8'))
      if (data.bundle && existsSync(data.bundle)) {
        if (data.sourceCommitSha === currentStamp.sourceCommitSha) {
          targetBundle = data.bundle
        } else {
          console.warn(`[verify-package-integrity] 既有安装包构建记录对应旧提交 (${data.sourceCommitSha} != 当前 ${currentStamp.sourceCommitSha})，触发重新构建...`)
        }
      }
    } catch {}
  }
}

if (!targetBundle || !existsSync(targetBundle)) {
  console.warn('[verify-package-integrity] 未指定或未找到匹配当前提交的 bundle 产物，执行快速目录打包生成验证目标...')
  const packageArgs = [join(here, 'package-windows-electron.mjs'), '--dir-only']
  if (process.argv.includes('--strict') || process.env.MOZHOU_STRICT_PACKAGE === 'true') {
    packageArgs.push('--strict')
  }
  execFileSync('node', packageArgs, {
    cwd: desktopDir,
    stdio: 'inherit',
  })
  if (existsSync(dirResultFile)) {
    targetBundle = JSON.parse(readFileSync(dirResultFile, 'utf8')).bundle
  }
}

recordCheck('V1 找到有效的桌面打包产物目录', Boolean(targetBundle && existsSync(targetBundle)), targetBundle)

if (!targetBundle || !existsSync(targetBundle)) {
  console.error('FATAL: 无法获取有效的桌面构建产物目录')
  process.exit(1)
}

// 2. 检查主程序与核心目录
const mozExe = join(targetBundle, 'MoZhou.exe')
recordCheck('V2 主执行文件 MoZhou.exe 存在且具有可执行体量', existsSync(mozExe) && statSync(mozExe).size > 1_000_000, `size=${statSync(mozExe).size}`)

const resourcesDir = join(targetBundle, 'resources')
const appAsar = join(resourcesDir, 'app.asar')
recordCheck('V3 桌面壳 resources/app.asar 存在且非空', existsSync(appAsar) && statSync(appAsar).size > 10_000, `size=${statSync(appAsar).size}`)

const nodeExe = join(resourcesDir, 'runtime', 'node.exe')
recordCheck('V4 随包官方 Node (resources/runtime/node.exe) 存在', existsSync(nodeExe) && statSync(nodeExe).size > 1_000_000, `size=${statSync(nodeExe).size}`)

const serverBridge = join(resourcesDir, 'desktop-server.mjs')
recordCheck('V5 独立服务引导脚本 desktop-server.mjs 存在', existsSync(serverBridge), serverBridge)

// 3. 检查服务端 app 目录结构
const appDir = join(resourcesDir, 'app')
const webIndex = join(appDir, 'dist', 'index.html')
const serverProd = join(appDir, 'dist-server', 'productionServer.js')
const bs3Pkg = join(appDir, 'node_modules', '@mozhou', 'data-plane', 'package.json')

recordCheck('V6 服务端前端编译产物 dist/index.html 存在', existsSync(webIndex), webIndex)
recordCheck('V7 服务端核心编译产物 dist-server/productionServer.js 存在', existsSync(serverProd), serverProd)
recordCheck('V8 生产依赖树已物化（@mozhou/data-plane 存在）', existsSync(bs3Pkg), bs3Pkg)

// 4. 运行随包 Node 测试 SQLite ABI
let sqliteOk = false
let sqliteOutput = ''
try {
  sqliteOutput = execFileSync(
    nodeExe,
    [
      '--input-type=module',
      '-e',
      `import {createRequire} from 'node:module'; const r=createRequire(process.cwd()+'/app/node_modules/@mozhou/data-plane/package.json'); const Database=r('better-sqlite3'); const db=new Database(':memory:'); db.exec('CREATE TABLE verify (id INT)'); db.close(); console.log('ABI_VERIFIED');`,
    ],
    { cwd: resourcesDir, encoding: 'utf8' }
  )
  sqliteOk = sqliteOutput.includes('ABI_VERIFIED')
} catch (e) {
  sqliteOutput = String(e.message || e)
}
recordCheck('V9 随包 Node 与 better-sqlite3 原生 ABI 兼容通过', sqliteOk, sqliteOutput.trim())

// 5. 运行 MoZhou.exe 启动与停止指令验证
let shellStopOk = false
let shellStopOutput = ''
const scratchTestRoot = mkdtempSync(join(artifactsDir, 'verify-stop-'))
try {
  shellStopOutput = execFileSync(
    mozExe,
    ['--no-sandbox', '--headless', '--stop', '--data-dir', scratchTestRoot],
    { encoding: 'utf8' }
  )
  shellStopOk = true
} catch (e) {
  shellStopOutput = String(e.message || e)
} finally {
  try {
    rmSync(scratchTestRoot, { recursive: true, force: true })
  } catch {}
}
recordCheck('V10 桌面主程序 MoZhou.exe --headless --stop 正常响应并安全退出', shellStopOk, shellStopOutput.trim())

// 6. 检查构建产物与当前源码提交的一致性
let bundleCommitSha = 'unknown'
const buildStampFile = join(targetBundle, 'BUILD_STAMP.json')
if (existsSync(buildStampFile)) {
  try {
    bundleCommitSha = JSON.parse(readFileSync(buildStampFile, 'utf8')).sourceCommitSha
  } catch {}
} else if (existsSync(dirResultFile)) {
  try {
    const d = JSON.parse(readFileSync(dirResultFile, 'utf8'))
    if (d.bundle === targetBundle) {
      bundleCommitSha = d.sourceCommitSha
    }
  } catch {}
}

const strict = process.argv.includes('--strict') || process.env.MOZHOU_STRICT_PACKAGE === 'true'
const commitMatches = Boolean(bundleCommitSha && bundleCommitSha === currentStamp.sourceCommitSha)
const cleanMatch = strict ? (commitMatches && !currentStamp.dirty) : commitMatches
recordCheck(
  'V11 桌面打包产物源码提交哈希与当前仓库 HEAD 严格一致',
  cleanMatch,
  `bundleCommit=${bundleCommitSha}, repoHead=${currentStamp.sourceCommitSha}${currentStamp.dirty ? ' (dirty)' : ''}`
)

// 7. 证据收据落盘
let sourceStamp = { sourceCommit: 'unknown', dirty: false }
try {
  sourceStamp = readSourceStamp(repoRoot)
} catch (e) {
  console.warn(`获取源码戳警告: ${e.message}`)
}

const allPassed = checks.length > 0 && checks.every((c) => c.passed)
const status = allPassed ? 'VERIFIED' : 'FAILED'

const summary = {
  runId: RUN_ID,
  timestamp: new Date().toISOString(),
  targetBundle,
  status,
  sourceCommit: sourceStamp.sourceCommit,
  dirty: sourceStamp.dirty,
  passedCount: checks.filter((c) => c.passed).length,
  failedCount: checks.filter((c) => !c.passed).length,
  totalCount: checks.length,
  checks,
}

const summaryJsonPath = join(evidenceDir, 'summary.json')
writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8')

console.log('----------------------------------------------------------------------')
console.log(`打包校验结果汇总: ${status} (${summary.passedCount}/${summary.totalCount} 项通过)`)
console.log(`收据已落盘至: ${summaryJsonPath}`)
console.log('----------------------------------------------------------------------')

process.exit(allPassed ? 0 : 1)
