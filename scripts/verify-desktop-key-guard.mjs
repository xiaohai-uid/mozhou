#!/usr/bin/env node
/**
 * verify-desktop-key-guard.mjs —— E05 密钥与密文恢复护栏的真实验收（子进程级）。
 *
 * 判据：已有受保护密文却缺 `installation.key` 时，引导必须**拒绝重铸**并明确失败；
 * 全新根正常初始化；损坏 key 明确失败；正常副本沿用同一把 key。
 *
 * 为什么用子进程而不是单元测试：被测对象是**打包入口的引导顺序**（先立密钥、再载应用），
 * 它的可观察结果是「进程退出码 + stderr + 磁盘上 key/密文的实际状态」，只有在真实进程里
 * 才成立。本脚本只新建隔离合成根，不触任何真实数据根或真实配置。
 *
 * 退出码：0 全部通过；1 有场景失败；2 环境错误。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entry = join(here, 'release', 'windows', 'desktop-server.mjs')

const failures = []
const notes = []

function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

/** 造一个只做标记的替身应用（隔离引导，不启动真实服务端）。 */
function makeStubApp(dir) {
  const appDir = join(dir, 'app')
  mkdirSync(join(appDir, 'dist-server'), { recursive: true })
  writeFileSync(join(appDir, 'dist-server', 'productionServer.js'), "console.log('STUB_APP_LOADED')\n", 'utf8')
  return appDir
}

/**
 * 以真实子进程运行引导入口。
 * 成功路径上引导会 `stdin.resume()` 常驻，故拿到标记后写 `shutdown` 并关 stdin，
 * 让它走既有的 SIGTERM 退出路径——这也顺带验证了该路径真的能结束进程。
 */
function runBootstrap({ dataRoot, appDir, timeoutMs = 20000 }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        MOZHOU_DATA_ROOT: dataRoot,
        MOZHOU_APP_URL: new URL(`file:///${appDir.replace(/\\/g, '/')}/`).href,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let shutdownSent = false
    const timer = setTimeout(() => {
      child.kill()
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (!shutdownSent && stdout.includes('STUB_APP_LOADED')) {
        shutdownSent = true
        try {
          child.stdin.write('shutdown\n')
          child.stdin.end()
        } catch {
          // 已退出
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (process.env['E05_DEBUG'] === '1') {
        console.error(`--- bootstrap exit=${code} signal=${signal}\n${stderr.slice(-1200)}`)
      }
      resolvePromise({ code, signal, stdout, stderr, timedOut: !shutdownSent && code === null })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ code: null, signal: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut: false })
    })
  })
}

const KEY_RE = /^[0-9a-f]{96}$/
/** 合成密文：与生产同格式的 `iv:tag:ciphertext`（base64 段），内容为合成值。 */
const SYNTHETIC_CIPHERTEXT = `${Buffer.alloc(12, 7).toString('base64')}:${Buffer.alloc(16, 9).toString('base64')}:${Buffer.alloc(32, 11).toString('base64')}`

const tmpBase = mkdtempSync(join(tmpdir(), 'mozhou-e05-'))

try {
  // ── 场景 1：全新合成根 → 正常初始化，落 key，应用被加载 ────────────────────
  {
    const dir = join(tmpBase, 'fresh')
    const dataRoot = join(dir, 'data')
    mkdirSync(dataRoot, { recursive: true })
    const appDir = makeStubApp(dir)
    const r = await runBootstrap({ dataRoot, appDir })
    const keyPath = join(dataRoot, 'installation.key')
    const key = existsSync(keyPath) ? readFileSync(keyPath, 'utf8').trim() : ''
    report(
      'E05-1 全新根：正常初始化',
      r.code === 0 && r.stdout.includes('STUB_APP_LOADED') && KEY_RE.test(key),
      `exit=${r.code} key格式=${KEY_RE.test(key)}`,
    )
    notes.push(`合成根 ${dataRoot}`)
  }

  // ── 场景 2：有效密文但缺 key → 拒绝重铸，不建 key，密文不变 ────────────────
  {
    const dir = join(tmpBase, 'missing-key')
    const dataRoot = join(dir, 'data')
    mkdirSync(dataRoot, { recursive: true })
    const appDir = makeStubApp(dir)
    const encPath = join(dataRoot, 'local-provider-settings.enc')
    writeFileSync(encPath, SYNTHETIC_CIPHERTEXT, 'utf8')
    const r = await runBootstrap({ dataRoot, appDir })
    const keyPath = join(dataRoot, 'installation.key')
    const encAfter = existsSync(encPath) ? readFileSync(encPath, 'utf8') : null
    report(
      'E05-2 有密文缺 key：拒绝重铸并明确失败',
      r.code !== 0 &&
        r.stderr.includes('Refusing to create a replacement key') &&
        !existsSync(keyPath) &&
        encAfter === SYNTHETIC_CIPHERTEXT &&
        !r.stdout.includes('STUB_APP_LOADED'),
      `exit=${r.code} 未建key=${!existsSync(keyPath)} 密文未变=${encAfter === SYNTHETIC_CIPHERTEXT} 未载应用=${!r.stdout.includes('STUB_APP_LOADED')}`,
    )
  }

  // ── 场景 3：key 损坏（非 96 hex）+ 密文 → 明确失败，且不改写原 key ──────────
  {
    const dir = join(tmpBase, 'damaged-key')
    const dataRoot = join(dir, 'data')
    mkdirSync(dataRoot, { recursive: true })
    const appDir = makeStubApp(dir)
    writeFileSync(join(dataRoot, 'local-provider-settings.enc'), SYNTHETIC_CIPHERTEXT, 'utf8')
    const keyPath = join(dataRoot, 'installation.key')
    writeFileSync(keyPath, 'not-a-valid-key', 'utf8')
    const r = await runBootstrap({ dataRoot, appDir })
    report(
      'E05-3 损坏 key：明确失败且不重铸',
      r.code !== 0 && r.stderr.includes('damaged') && readFileSync(keyPath, 'utf8') === 'not-a-valid-key',
      `exit=${r.code} 原key未变=${readFileSync(keyPath, 'utf8') === 'not-a-valid-key'}`,
    )
  }

  // ── 场景 4：正常副本（有效 key + 密文）→ 沿用同一把 key，正常启动 ───────────
  {
    const dir = join(tmpBase, 'normal-copy')
    const dataRoot = join(dir, 'data')
    mkdirSync(dataRoot, { recursive: true })
    const appDir = makeStubApp(dir)
    writeFileSync(join(dataRoot, 'local-provider-settings.enc'), SYNTHETIC_CIPHERTEXT, 'utf8')
    const keyPath = join(dataRoot, 'installation.key')
    const existingKey = 'ab'.repeat(48)
    writeFileSync(keyPath, existingKey, 'utf8')
    const r = await runBootstrap({ dataRoot, appDir })
    report(
      'E05-4 正常副本：沿用原 key 且正常启动',
      r.code === 0 &&
        r.stdout.includes('STUB_APP_LOADED') &&
        readFileSync(keyPath, 'utf8').trim() === existingKey &&
        readFileSync(join(dataRoot, 'local-provider-settings.enc'), 'utf8') === SYNTHETIC_CIPHERTEXT,
      `exit=${r.code} key未变=${readFileSync(keyPath, 'utf8').trim() === existingKey}`,
    )
  }

  // ── 场景 5：key 路径不可读（被目录占位）→ 明确失败，报错可读 ────────────────
  {
    const dir = join(tmpBase, 'unreadable-key')
    const dataRoot = join(dir, 'data')
    mkdirSync(dataRoot, { recursive: true })
    const appDir = makeStubApp(dir)
    mkdirSync(join(dataRoot, 'installation.key'))
    const r = await runBootstrap({ dataRoot, appDir })
    report(
      'E05-5 key 不可读：明确失败并给出可执行动作',
      r.code !== 0 && r.stderr.includes('installation.key cannot be read'),
      `exit=${r.code}`,
    )
  }
} catch (error) {
  console.error(`FAIL 验收脚本自身出错：${error instanceof Error ? error.message : String(error)}`)
  rmSync(tmpBase, { recursive: true, force: true })
  process.exit(2)
}

rmSync(tmpBase, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\nFAIL ${failures.length} 个场景未通过：${failures.join('；')}`)
  process.exit(1)
}
console.log(`\nPASS E05 密钥护栏 5 个场景全部通过（隔离合成根，未触真实配置）`)
for (const n of notes) console.log(`  · ${n}`)
process.exit(0)
