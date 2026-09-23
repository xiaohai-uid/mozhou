/**
 * packages/data-plane · 零外部依赖标准 ZIP 打包与解包工具 (Zip Util · C5)。
 * 基于 Node.js 原生 node:zlib 实现，严格执行 SPEC C5 资源与安全门禁：
 * - 限制单包最多 10,000 个文件；
 * - 限制单包解压最大 1 GiB；
 * - 限制单文件解压最大 100 MiB；
 * - 严格阻断目录穿越 (Path Traversal)。
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  readonly path: string
  readonly data: Buffer | string
  readonly store?: boolean | undefined // true 则使用 Store (方法 0)，epub mimetype 必备
}

export interface ZipLimits {
  readonly maxFiles: number
  readonly maxTotalBytes: number
  readonly maxSingleFileBytes: number
}

export const C5_ZIP_LIMITS: ZipLimits = Object.freeze({
  maxFiles: 10_000,
  maxTotalBytes: 1024 * 1024 * 1024, // 1 GiB
  maxSingleFileBytes: 100 * 1024 * 1024, // 100 MiB
})

/**
 * 将一组文件打包为标准 ZIP Buffer。
 */
export function packZip(files: readonly ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = []
  const centralHeaders: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.path, 'utf8')
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8')
    const crc = crc32(dataBuf)
    const uncompressedSize = dataBuf.length

    let compMethod = 8
    let compData: Buffer
    if (file.store || uncompressedSize === 0) {
      compMethod = 0
      compData = dataBuf
    } else {
      const deflated = deflateRawSync(dataBuf)
      if (deflated.length >= uncompressedSize) {
        compMethod = 0
        compData = dataBuf
      } else {
        compData = deflated
      }
    }
    const compressedSize = compData.length

    // Local file header (30 bytes)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // Version needed
    lh.writeUInt16LE(0x0800, 6) // Flags: UTF-8 filename
    lh.writeUInt16LE(compMethod, 8)
    lh.writeUInt16LE(0, 10) // Mod time
    lh.writeUInt16LE(0, 12) // Mod date
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(compressedSize, 18)
    lh.writeUInt32LE(uncompressedSize, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28) // Extra field length

    localHeaders.push(lh, nameBuf, compData)

    // Central directory header (46 bytes)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4) // Version made by
    ch.writeUInt16LE(20, 6) // Version needed
    ch.writeUInt16LE(0x0800, 8) // Flags
    ch.writeUInt16LE(compMethod, 10)
    ch.writeUInt16LE(0, 12)
    ch.writeUInt16LE(0, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(compressedSize, 20)
    ch.writeUInt32LE(uncompressedSize, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt16LE(0, 30) // Extra length
    ch.writeUInt16LE(0, 32) // Comment length
    ch.writeUInt16LE(0, 34) // Disk start
    ch.writeUInt16LE(0, 36) // Internal attrs
    ch.writeUInt32LE(0, 38) // External attrs
    ch.writeUInt32LE(offset, 42) // Local header offset

    centralHeaders.push(ch, nameBuf)
    offset += 30 + nameBuf.length + compressedSize
  }

  const centralDirOffset = offset
  const centralDirBuf = Buffer.concat(centralHeaders)
  const centralDirSize = centralDirBuf.length

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDirSize, 12)
  eocd.writeUInt32LE(centralDirOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localHeaders, centralDirBuf, eocd])
}

export interface UnpackedFile {
  readonly path: string
  readonly data: Buffer
}

/**
 * 解包 ZIP Buffer，严格执行 C5 资源约束与路径穿越安全拦截。
 */
export function unpackZip(buf: Buffer, limits: ZipLimits = C5_ZIP_LIMITS): UnpackedFile[] {
  let eocdOffset = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    throw new Error('INVALID_ZIP: end of central directory signature not found')
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10)
  if (totalEntries > limits.maxFiles) {
    throw new Error(`C5_LIMIT_EXCEEDED: archive contains ${totalEntries} files, exceeding limit of ${limits.maxFiles}`)
  }

  const cdOffset = buf.readUInt32LE(eocdOffset + 16)
  let pos = cdOffset
  let totalBytes = 0
  const result: UnpackedFile[] = []

  for (let i = 0; i < totalEntries; i += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('INVALID_ZIP: corrupted central directory header')
    }
    const compMethod = buf.readUInt16LE(pos + 10)
    const crc = buf.readUInt32LE(pos + 16)
    const compSize = buf.readUInt32LE(pos + 20)
    const uncompSize = buf.readUInt32LE(pos + 24)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)

    if (uncompSize > limits.maxSingleFileBytes) {
      throw new Error(`C5_LIMIT_EXCEEDED: file size ${uncompSize} exceeds single file limit of ${limits.maxSingleFileBytes}`)
    }
    totalBytes += uncompSize
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(`C5_LIMIT_EXCEEDED: uncompressed archive size exceeds total limit of ${limits.maxTotalBytes}`)
    }

    const fileName = buf.toString('utf8', pos + 46, pos + 46 + nameLen)
    // 严格安全守卫：阻断路径穿越 (Path Traversal) 与绝对路径
    if (fileName.includes('..') || fileName.startsWith('/') || fileName.startsWith('\\') || /^[A-Za-z]:/.test(fileName)) {
      throw new Error(`SECURITY_ERROR: zip path traversal detected in entry "${fileName}"`)
    }

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`INVALID_ZIP: corrupted local header for "${fileName}"`)
    }
    const lhNameLen = buf.readUInt16LE(localOffset + 26)
    const lhExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + lhNameLen + lhExtraLen
    const rawData = buf.subarray(dataOffset, dataOffset + compSize)

    let data: Buffer
    if (compMethod === 0) {
      data = rawData
    } else if (compMethod === 8) {
      data = inflateRawSync(rawData)
    } else {
      throw new Error(`UNSUPPORTED_ZIP: compression method ${compMethod} not supported`)
    }

    if (crc32(data) !== crc) {
      throw new Error(`CORRUPT_ZIP: CRC32 checksum mismatch for "${fileName}"`)
    }

    result.push({ path: fileName, data })
    pos += 46 + nameLen + extraLen + commentLen
  }

  return result
}
