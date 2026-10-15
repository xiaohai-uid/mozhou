/**
 * 托盘图标：运行时生成，不落二进制资产。
 *
 * 为什么要自己编码 PNG：`Tray` 需要非空 `nativeImage`，而把一张 32×32 PNG 提交进版本库
 * 会多一个无法用文本评审的二进制文件；图标又只是「一个可辨认的墨色印记」，没有设计资源
 * 需要复用。故用最小编码器（IHDR/IDAT/IEND + CRC32）在内存里画出来，输出确定、可测试。
 */
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

const INK = [26, 30, 36, 255]
const PAPER = [233, 227, 214, 255]

/**
 * 32×32 RGBA：墨色圆角方印 + 纸色「十」字笔触。
 * 返回完整 PNG 字节，可直接 `nativeImage.createFromBuffer`。
 */
export function createTrayIconPng(size = 32) {
  const raw = Buffer.alloc(size * (1 + size * 4)) // 每行前置 filter byte 0
  const inkSpan = Math.round(size * 0.0625) // 2px @32
  const edge = size - inkSpan * 2 - 1
  const radius = Math.round(size * 0.25)
  const barHalf = Math.max(1, Math.round(size * 0.06))

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4) + 1
    for (let x = 0; x < size; x += 1) {
      let px = null
      if (inRoundedRect(x, y, inkSpan, inkSpan, edge, edge, radius)) px = INK
      const crossH = Math.abs(y - Math.floor(size / 2)) <= barHalf && x >= inkSpan + radius * 0.5 && x <= edge - radius * 0.5
      const crossV = Math.abs(x - Math.floor(size / 2)) <= barHalf && y >= inkSpan + radius * 0.5 && y <= edge - radius * 0.5
      if (px !== null && (crossH || crossV)) px = PAPER
      if (px === null) continue
      const off = rowStart + x * 4
      raw[off] = px[0]
      raw[off + 1] = px[1]
      raw[off + 2] = px[2]
      raw[off + 3] = px[3]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
