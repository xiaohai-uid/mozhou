// @vitest-environment node
/**
 * zip-util C5 资源门与结构门测试。
 *
 * 重点覆盖「声明字段可被伪造」的攻击面：中央目录里的 uncompSize 是攻击者可控的
 * 声明值，不能作为内存分配依据；解压必须由真实输出上限兜底。
 */
import { describe, expect, it } from 'vitest'
import { assertZipStructureIntact, packZip, unpackZip } from './zip-util.js'

/** 改写中央目录中指定条目的 uncompSize（模拟头部谎报），返回副本。 */
function patchCentralUncompSize(zip: Buffer, targetPath: string, newSize: number): Buffer {
  const out = Buffer.from(zip)
  let eocd = -1
  for (let i = out.length - 22; i >= 0; i -= 1) {
    if (out.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('test setup: EOCD not found')
  const total = out.readUInt16LE(eocd + 10)
  let pos = out.readUInt32LE(eocd + 16)
  for (let i = 0; i < total; i += 1) {
    const nameLen = out.readUInt16LE(pos + 28)
    const extraLen = out.readUInt16LE(pos + 30)
    const commentLen = out.readUInt16LE(pos + 32)
    const name = out.toString('utf8', pos + 46, pos + 46 + nameLen)
    if (name === targetPath) {
      out.writeUInt32LE(newSize, pos + 24)
      return out
    }
    pos += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`test setup: entry ${targetPath} not found`)
}

describe('zip-util · C5 资源门', () => {
  it('解压炸弹：谎报 uncompSize 为 0 的高压缩比条目仍按真实输出上限拒绝', () => {
    // 1 MiB 全 'a' → deflate 后约 1 KiB；声明 0 字节可绕过声明值检查。
    // 上限刻意设成「总量足够大、只有单文件上限能兜住」：若解压时不带 maxOutputLength，
    // 1 MiB 输出会顺利分配出来并通过总量检查（1 MiB < 1 GiB），本用例就会失败。
    // 这一条守的是「分配本身有界」，与下一条守的「按真实字节核总量」是两件事。
    const payload = Buffer.alloc(1024 * 1024, 0x61)
    const honest = packZip([{ path: 'bomb.bin', data: payload }])
    const lied = patchCentralUncompSize(honest, 'bomb.bin', 0)

    expect(() =>
      unpackZip(lied, { maxFiles: 10, maxTotalBytes: 1024 * 1024 * 1024, maxSingleFileBytes: 64 * 1024 }),
    ).toThrow(/C5_LIMIT_EXCEEDED/)
  })

  it('解压炸弹：多个谎报条目按实际解压字节核总上限', () => {
    const payload = Buffer.alloc(256 * 1024, 0x62)
    const zipped = packZip([
      { path: 'a.bin', data: payload },
      { path: 'b.bin', data: payload },
    ])
    const lied = patchCentralUncompSize(patchCentralUncompSize(zipped, 'a.bin', 0), 'b.bin', 0)

    // 单条 256 KiB < 单文件上限，但两条累计 512 KiB > 总上限 300 KiB
    expect(() =>
      unpackZip(lied, { maxFiles: 10, maxTotalBytes: 300 * 1024, maxSingleFileBytes: 1024 * 1024 }),
    ).toThrow(/C5_LIMIT_EXCEEDED/)
  })

  it('诚实归档仍在既有上限内正常解包', () => {
    const zipped = packZip([
      { path: 'manifest.json', data: '{"schemaVersion":1}' },
      { path: 'chapter.txt', data: '正文' },
    ])
    const files = unpackZip(zipped)
    expect(files.map((f) => f.path).sort()).toEqual(['chapter.txt', 'manifest.json'])
  })
})

describe('zip-util · 结构完整性门', () => {
  it('完整归档通过结构检查', () => {
    const zipped = packZip([{ path: 'a.txt', data: 'hello world' }])
    expect(() => assertZipStructureIntact(zipped)).not.toThrow()
  })

  it('截断归档（丢失 EOCD）被拒', () => {
    const zipped = packZip([{ path: 'a.txt', data: 'hello world' }])
    const truncated = zipped.subarray(0, zipped.length - 8)
    expect(() => assertZipStructureIntact(truncated)).toThrow(/INVALID_ZIP/)
  })
})
