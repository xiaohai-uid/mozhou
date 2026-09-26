/**
 * apps/web · 结构化日志与请求标识。
 *
 * 生产排障入口：容器与 systemd 只收 stdout/stderr，多行人类可读日志无法按字段
 * 检索，故统一为单行 JSON（ts / level / event / 附加字段），可由任意日志采集器
 * 直接解析。刻意不引第三方日志库：当前需求只是「有级别、有字段、可解析」，
 * 引入依赖会带来本票范围外的运维面（传输、缓冲、格式配置）。
 *
 * 禁止把凭据写入日志：调用方只传非敏感字段（路径、状态码、耗时、事件名）。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  // warn/error 落 stderr，其余落 stdout：便于采集器按流分流告警。
  if (level === 'warn' || level === 'error') {
    process.stderr.write(`${line}\n`)
  } else {
    process.stdout.write(`${line}\n`)
  }
}

let requestSeq = 0

/** 请求标识：进程内单调递增，够用于把一次请求的多条日志串起来。 */
export function nextRequestId(): string {
  requestSeq += 1
  return `${Date.now().toString(36)}-${requestSeq.toString(36)}`
}
