#!/usr/bin/env node
/**
 * verify-desktop-instance-identity.mjs —— E03 实例身份判定的真实验收。
 *
 * 判据：只有「健康端点明确应答 + 数据根一致 + pid 存活 + 实例锁存在且持有者一致」才算
 * `authenticated`；缺锁 / 锁损坏 / 锁不可读 / 持有者不一致一律 `unverified`——调用方
 * 据此拒绝复用、拒绝停止，且**不杀**未知进程。旧实现写成「有锁才核对」，无锁时只剩可
 * 伪造的健康 JSON，一个任意 HTTP 服务就能被判成墨舟实例。
 *
 * 另验：fallback 端口上的实例能被有界窗口扫描找到（旧版启动器会逐个 +1），
 * 非墨舟占用不被误报。
 *
 * 只用合成 HTTP 服务与隔离合成数据根，不触真实服务、真实数据根或真实配置。
 * 退出码：0 通过；1 有场景失败；2 环境错误。
 */
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = `file:///${here.replace(/\\/g, '/')}/`
const { deriveBasePort, findInstanceInRange, identifyMozhouService, readLockHolder } = await import(
  new URL('../desktop/lib/port.mjs', base).href
)

const tmp = mkdtempSync(join(tmpdir(), 'mozhou-e03-'))
const failures = []
function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

function newRoot(name) {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeLock(root, pid) {
  writeFileSync(join(root, '.mozhou_instance.lock'), JSON.stringify({ pid, startedAt: '2026-10-12T00:00:00.000Z', version: 2 }), 'utf8')
}

/** 起一个合成健康服务；返回 { port, close }。 */
function startHealthService({ dataRoot, pid = process.pid, ok = true, hostedMode = false }) {
  const server = createServer((req, res) => {
    if (req.url !== '/api/health') {
      res.writeHead(404).end('nope')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(ok ? { ok: true, dataRoot, pid, hostedMode } : { ok: false }))
  })
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      resolvePromise({ port: server.address().port, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

/**
 * 在 [basePort+from, basePort+to] 内绑第一个可用端口。
 * 每次尝试都用**新的** server 实例：同一个实例 listen 失败后再 listen 会处于坏状态。
 */
async function bindInWindow(makeServer, basePort, from, to) {
  for (let offset = from; offset <= to; offset += 1) {
    const port = basePort + offset
    const server = makeServer()
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise)
        server.listen(port, '127.0.0.1', resolvePromise)
      })
      return { server, port }
    } catch (error) {
      server.removeAllListeners()
      try {
        server.close()
      } catch {
        // 从未成功监听
      }
      if (error?.code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`窗口 [${basePort + from}, ${basePort + to}] 内没有可用端口`)
}

/** 派生端口可能与临时端口相撞：在多个合成根名之间找窗口可用的那个。 */
async function bindAcrossRoots(prefix, makeServerFor, from, to) {
  for (let i = 0; i < 25; i += 1) {
    const root = newRoot(`${prefix}-${i}`)
    const basePort = deriveBasePort(root)
    try {
      const { server, port } = await bindInWindow(() => makeServerFor(root), basePort, from, to)
      return { root, basePort, server, port }
    } catch {
      // 该根的窗口不可用：换根名继续
    }
  }
  throw new Error('找不到窗口可用的合成根')
}

try {
  // ── 1. 伪造服务（健康 JSON 齐全，但数据根没有锁）→ unverified ───────────────
  {
    const root = newRoot('forged')
    const svc = await startHealthService({ dataRoot: root })
    const r = await identifyMozhouService(svc.port, root)
    await svc.close()
    report('E03-1 无锁的伪造服务 → unverified（不复用）', r.kind === 'unverified' && r.reason.includes('缺少实例锁'), `kind=${r.kind}`)
  }

  // ── 2. 锁持有者与健康 pid 一致 → authenticated ────────────────────────────
  {
    const root = newRoot('consistent')
    writeLock(root, process.pid)
    const svc = await startHealthService({ dataRoot: root })
    const r = await identifyMozhouService(svc.port, root)
    await svc.close()
    report('E03-2 锁一致 → authenticated', r.kind === 'authenticated' && r.pid === process.pid, `kind=${r.kind}`)
  }

  // ── 3. 锁持有者与健康 pid 不一致 → unverified ─────────────────────────────
  {
    const root = newRoot('mismatch')
    writeLock(root, 999_999_999)
    const svc = await startHealthService({ dataRoot: root })
    const r = await identifyMozhouService(svc.port, root)
    await svc.close()
    report('E03-3 锁持有者不一致 → unverified', r.kind === 'unverified' && r.reason.includes('不一致'), `kind=${r.kind}`)
  }

  // ── 4. 锁损坏（非 JSON）→ unverified ─────────────────────────────────────
  {
    const root = newRoot('corrupt')
    writeFileSync(join(root, '.mozhou_instance.lock'), 'not-json{', 'utf8')
    const svc = await startHealthService({ dataRoot: root })
    const r = await identifyMozhouService(svc.port, root)
    await svc.close()
    report('E03-4 锁损坏 → unverified', r.kind === 'unverified' && r.reason.includes('损坏'), `kind=${r.kind}`)
  }

  // ── 5. 锁不可读（路径被目录占位）→ unverified ─────────────────────────────
  {
    const root = newRoot('unreadable')
    mkdirSync(join(root, '.mozhou_instance.lock'))
    const svc = await startHealthService({ dataRoot: root })
    const r = await identifyMozhouService(svc.port, root)
    await svc.close()
    report('E03-5 锁不可读 → unverified', r.kind === 'unverified' && r.reason.includes('不可读'), `kind=${r.kind}`)
  }

  // ── 6/7. 数据根不符 / 健康未确认 → none（连 unverified 都不是）─────────────
  {
    const root = newRoot('other-root')
    const svc = await startHealthService({ dataRoot: 'C:\\somewhere\\else' })
    const r1 = await identifyMozhouService(svc.port, root)
    await svc.close()
    const root2 = newRoot('not-ok')
    const svc2 = await startHealthService({ dataRoot: root2, ok: false })
    const r2 = await identifyMozhouService(svc2.port, root2)
    await svc2.close()
    report('E03-6/7 数据根不符与健康未确认 → none', r1.kind === 'none' && r2.kind === 'none', `${r1.kind}/${r2.kind}`)
  }

  // ── 8. fallback 端口上的实例能被窗口扫描找到 ──────────────────────────────
  {
    const healthHandler = (root) => (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, dataRoot: root, pid: process.pid, hostedMode: false }))
    }
    const bound = await bindAcrossRoots('fallback', (root) => createServer(healthHandler(root)), 1, 9)
    writeLock(bound.root, process.pid)
    const found = await findInstanceInRange(bound.root, bound.basePort)
    await new Promise((r) => bound.server.close(r))
    report(
      'E03-8 fallback 端口实例被窗口扫描找到',
      found !== null && found.port === bound.port && found.result.kind === 'authenticated',
      `found=${found === null ? 'null' : `${found.port}/${found.result.kind}`} 期望 ${bound.port}`,
    )
  }

  // ── 9. 非墨舟进程占用基准端口 → 不误报（返回 null）────────────────────────
  {
    const foreignHandler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, dataRoot: 'C:\\nope', pid: process.pid }))
    }
    const bound = await bindAcrossRoots('foreign-occupier', () => createServer(foreignHandler), 0, 0)
    const found = await findInstanceInRange(bound.root, bound.basePort)
    await new Promise((r) => bound.server.close(r))
    report(
      'E03-9 外来占用不误报',
      found === null,
      `bound=${bound.port} found=${found === null ? 'null' : `${found.port}/${found.result.kind}`}`,
    )
  }

  // ── 10. 锁状态三态可分辨（缺失/损坏/不可读不是同一个值）────────────────────
  {
    const absent = readLockHolder(newRoot('lock-absent'))
    const corruptRoot = newRoot('lock-corrupt')
    writeFileSync(join(corruptRoot, '.mozhou_instance.lock'), '{', 'utf8')
    const corrupt = readLockHolder(corruptRoot)
    const unreadableRoot = newRoot('lock-unreadable')
    mkdirSync(join(unreadableRoot, '.mozhou_instance.lock'))
    const unreadable = readLockHolder(unreadableRoot)
    report(
      'E03-10 锁状态三态可分辨',
      absent.state === 'absent' && corrupt.state === 'corrupt' && unreadable.state === 'unreadable',
      `${absent.state}/${corrupt.state}/${unreadable.state}`,
    )
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
console.log('\nPASS E03 实例身份 10 个场景全部通过（合成服务 + 隔离合成根）')
console.log('  · 未覆盖：旧版命名 Mutex/Event 无法从 Node 读取（Win32 内核对象无 Node API）。本实现以「有界端口窗口 + 实例锁 + 健康端点」作为检测面，并在失败信息里给出「先停旧版」的迁移动作。')
process.exit(0)
