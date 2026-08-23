import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** SHA-256 十六进制摘要（ADR-0010 外部对账基准的算法位）。 */
export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export function sha256FileHex(absolutePath: string): string {
  return sha256Hex(readFileSync(absolutePath))
}
