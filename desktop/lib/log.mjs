/**
 * 桌面壳日志：落点与格式沿用旧 C# 启动器（`<数据根>\desktop.log`，
 * 每行「UTC ISO8601 + 空格 + 文本」），这样既有排障习惯与既有证据引用不失效。
 *
 * 同时回显到 stderr：以 `electron .` 直接跑壳时能立刻看到，不必先找日志文件。
 */
import { appendFileSync } from 'node:fs'

let logPath = null

export function setLogPath(path) {
  logPath = path
}

export function logLine(text) {
  const line = `${new Date().toISOString()} ${text}`
  try {
    process.stderr.write(`${line}\n`)
  } catch {
    // stderr 被关闭（打包后以 GUI 方式启动）时不应影响主流程
  }
  if (logPath === null) return
  try {
    appendFileSync(logPath, `${line}\n`, 'utf8')
  } catch {
    // 日志不可写不是致命错误：数据根只读会由服务端锁与健康端点显式暴露
  }
}
