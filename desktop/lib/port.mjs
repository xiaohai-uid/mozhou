/**
 * 稳定端口与实例身份（迁移计划 §3.2）。
 *
 * 硬约束：**不得占用后静默换端口**。旧 C# 的 FindStablePort（MoZhou.cs:147-169）会
 * 从基准端口 +1 递增，重启又从基准端口起，造成 P→P+1→P 的可见性切换；在 localStorage
 * 仍是恢复来源期间，origin 变化会让「上次打开的作品」丢失。故本模块只算**一个**基准端口：
 *   基准端口空闲            → 用它
 *   基准端口被正确实例占用  → 聚焦/复用，不换端口
 *   基准端口被别的进程占用  → 明确失败（调用方负责可见报错），不换端口
 *
 * 就绪与身份：健康 JSON 的 ok/pid 单独不足以证明归属（端口上任何进程都能伪造一份 JSON）。
 * 因此本模块只做**探测**，真正的归属由 server-process.mjs 的私有 stdout 通道证明。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

export const PORT_BASE = 43000
export const PORT_SPAN = 1000

/**
 * 与 MoZhou.cs:153-154 同构：`43000 + ((sha256(data.ToUpperInvariant())[0] << 8 | [1]) % 1000)`。
 *
 * 已知边界：.NET 的 `ToUpperInvariant` 与 JS `toUpperCase` 对个别非 ASCII 码点
 * （如 'ß'、'ı'）的大小写映射不同。含这类字符的数据根，新旧壳会算出不同基准端口，
 * 进而丢掉旧浏览器 origin 的 localStorage。默认路径（`%LOCALAPPDATA%\MoZhou`）为纯 ASCII，
 * 不受影响；这是显式记录的已知限制，不静默兜底。
 */
export function deriveBasePort(dataRoot) {
  const digest = createHash('sha256').update(dataRoot.toUpperCase()).digest()
  return PORT_BASE + (((digest[0] << 8) | digest[1]) % PORT_SPAN)
}

/** 端口是否可绑定（回环）。绑定成功后立刻释放，不长期占用。 */
export function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const probe = createServer()
    probe.once('error', () => resolvePromise(false))
    probe.once('listening', () => {
      probe.close(() => resolvePromise(true))
    })
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * 诊断端口不可用的具体原因（区分真实进程占用 vs Windows 系统段保留）。
 * 避免开发者在遇到不可用端口时误以为有未清理的孤儿服务。
 */
export function diagnosePortUnavailability(port) {
  return new Promise((resolvePromise) => {
    const probe = createServer()
    probe.once('error', (err) => {
      const code = err.code ?? 'UNKNOWN'
      const isReserved =
        process.platform === 'win32' && (code === 'EACCES' || code === 'EADDRINUSE')
      resolvePromise({
        free: false,
        code,
        reason: isReserved
          ? `端口 ${port} 不可用（可能处于 Windows 系统保留端口段，如 Hyper-V/HNS 动态范围）`
          : `端口 ${port} 被其他活动进程占用 (${code})`,
      })
    })
    probe.once('listening', () => {
      probe.close(() => resolvePromise({ free: true, code: 'OK', reason: `端口 ${port} 可用` }))
    })
    probe.listen(port, '127.0.0.1')
  })
}

/** 读取 `/api/health`；任何失败（连不上、超时、非 JSON）都返回 null，不抛。 */
export async function probeHealth(port, timeoutMs = 800) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const body = await res.json()
    return typeof body === 'object' && body !== null ? body : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM 表示进程存在但无权限发信号——对「存活」判定仍算存在
    return error?.code === 'EPERM'
  }
}

/**
 * 读数据根锁文件里的持有者（bookAccess.ts 写的 v2 JSON 记录）。
 *
 * 返回**状态**而不是「pid 或 null」：缺失、损坏、不可读必须分开，否则调用方只能写成
 * 「有锁才核对」——无锁时静默跳过核对，任何伪造的健康 JSON 都会被当成墨舟实例。
 *
 * @returns {{ state: 'present' | 'absent' | 'corrupt' | 'unreadable', pid: number | null }}
 */
export function readLockHolder(dataRoot) {
  let raw
  try {
    raw = readFileSync(join(dataRoot, '.mozhou_instance.lock'), 'utf8')
  } catch (error) {
    // ENOENT 是「确实没有」；其余（EACCES/EBUSY/EISDIR）是「有但读不到」，两者不能混为一谈。
    return { state: error?.code === 'ENOENT' ? 'absent' : 'unreadable', pid: null }
  }
  try {
    const parsed = JSON.parse(raw)
    const pid = parsed?.pid
    if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) return { state: 'present', pid }
    return { state: 'corrupt', pid: null }
  } catch {
    return { state: 'corrupt', pid: null }
  }
}

/**
 * 判定某个端口上跑的是不是「本数据根的正确墨舟实例」。
 *
 * 判据（本机信任模型，非网络认证）：健康端点明确应答 + `dataRoot` 与本壳钉定的数据根一致
 * + 报告的 pid 存活 + **数据根实例锁存在且持有者与该 pid 一致**。
 *
 * 锁单独存在不构成强认证（能写数据根的本地进程也能伪造锁）；这里定义的是**边界**：
 * 没有归属证据的服务一律 `unverified`，调用方必须按「不是我们的」处理，不得复用、
 * 不得据其端口可绑定就报告停止成功。
 *
 * @returns {Promise<
 *   | { kind: 'none', reason: string }
 *   | { kind: 'authenticated', pid: number, url: string, hostedMode: boolean }
 *   | { kind: 'unverified', pid: number, url: string, hostedMode: boolean, reason: string }
 * >}
 */
export async function identifyMozhouService(port, dataRoot) {
  const health = await probeHealth(port)
  if (!health || health.ok !== true) {
    return { kind: 'none', reason: '端口上没有确认应答的墨舟健康端点' }
  }
  if (typeof health.dataRoot !== 'string' || resolve(health.dataRoot) !== resolve(dataRoot)) {
    return { kind: 'none', reason: '端口上的服务属于另一个数据根' }
  }
  if (!isProcessAlive(health.pid)) {
    return { kind: 'none', reason: '健康端点报告的进程已不存在' }
  }

  const url = `http://127.0.0.1:${port}`
  const hostedMode = health.hostedMode === true
  const lock = readLockHolder(dataRoot)
  const unverified = (reason) => ({ kind: 'unverified', pid: health.pid, url, hostedMode, reason })

  if (lock.state === 'absent') {
    return unverified('数据根缺少实例锁：无法证明该服务归属本数据根（旧版实例与伪造服务都可能长这样）')
  }
  if (lock.state === 'corrupt') {
    return unverified('数据根实例锁内容损坏：无法核对持有者')
  }
  if (lock.state === 'unreadable') {
    return unverified('数据根实例锁不可读（权限或被占用）：无法核对持有者')
  }
  if (lock.pid !== health.pid) {
    return unverified(`实例锁持有者（PID ${lock.pid}）与健康端点报告的 PID（${health.pid}）不一致`)
  }
  return { kind: 'authenticated', pid: health.pid, url, hostedMode }
}

/** 旧版启动器会从基准端口逐个 +1 找空闲端口（MoZhou.cs 的 FindStablePort）。扫描窗口有界。 */
export const LEGACY_PORT_SCAN_WINDOW = 10

/**
 * 在 `[基准端口, 基准端口 + window)` 内找一个**属于本数据根**的墨舟实例。
 *
 * 为什么不能只看基准端口：旧版实例可能落在 fallback 端口上。只看基准端口会让
 * `--stop` 在「基准端口空闲」时报告「没有在跑的实例」——而旧版其实还在跑。
 */
export async function findInstanceInRange(dataRoot, basePort, window = LEGACY_PORT_SCAN_WINDOW) {
  for (let offset = 0; offset < window; offset += 1) {
    const port = PORT_BASE + ((basePort - PORT_BASE + offset) % PORT_SPAN)
    if (await isPortFree(port)) continue
    const result = await identifyMozhouService(port, dataRoot)
    if (result.kind !== 'none') return { port, result }
  }
  return null
}

export { isProcessAlive }
