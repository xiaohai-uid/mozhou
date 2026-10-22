/**
 * 零依赖 ULID（议题 #4 Q4：26 位 Crockford Base32，字典序 = 时间序；
 * 本地文件内可 grep）。内核保持零 npm 依赖——随机源用 Web Crypto 全局
 * （Node ≥19 / 浏览器均内建），不引入任何运行时依赖。
 *
 * 同毫秒内单调递增：随机段 +1，保证同进程内的排序稳定性。
 */
import type {
  AuthorIntentId,
  BookId,
  BookNodeId,
  ChapterCommitId,
  ChapterNodeId,
  FactId,
  KnowledgeStateId,
  RelationshipStateId,
  StyleProfileId,
  TimelineEventId,
  Ulid,
  VolumeNodeId,
} from './kernel-schema.js'

/** Crockford Base32：0-9 大写字母去掉 I L O U。 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' as const

const TIME_CHARS = 10 // 48 bit 毫秒时间戳
const RANDOM_CHARS = 16 // 80 bit 随机数

/** ULID 规范：时间戳是 48 bit 无符号整数，最大 2^48-1（281474976710655）。 */
const MAX_TIME_MS = 2 ** 48 - 1

const RANDOM_BITS = BigInt(RANDOM_CHARS * 5) // 80
const RANDOM_MAX = (1n << RANDOM_BITS) - 1n

let lastTime = -1
let lastRandom = 0n

/**
 * 越界时间戳会让时间段静默截断（例如负数编码成 ZZZZZZZZZZ），
 * 从而破坏「字典序 = 时间序」的契约；按规范在铸造前拒绝。
 */
function assertTimestamp(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TIME_MS) {
    throw new RangeError(
      `newUlid: now() 必须返回 [0, ${MAX_TIME_MS}] 内的整数毫秒时间戳，收到 ${String(value)}`,
    )
  }
}

function encode(value: bigint, chars: number): string {
  let out = ''
  for (let i = chars - 1; i >= 0; i--) {
    out = CROCKFORD[Number(value & 31n)]! + out
    value >>= 5n
  }
  return out
}

function random80(): bigint {
  const bytes = new Uint8Array(10)
  globalThis.crypto.getRandomValues(bytes)
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}

/**
 * 铸造一个 ULID。`now` 可注入以便测试确定性；生产调用省略。
 * 同毫秒内以上一枚的随机段 +1 续排（单调），溢出则顺延一毫秒。
 */
export function newUlid(now: () => number = Date.now): Ulid {
  const candidate = now()
  assertTimestamp(candidate)
  let time = candidate
  if (time <= lastTime) {
    time = lastTime
    lastRandom += 1n
    if (lastRandom > RANDOM_MAX) {
      time += 1
      // 进位后必须同步 lastTime：否则下一枚仍以旧 lastTime 为基准，
      // 会落回上一毫秒（实测 b=…01…0000、c=…00…0001，b<c 为 false），
      // 破坏「字典序 = 时间序」的契约。
      lastTime = time
      lastRandom = 0n
    }
  } else {
    lastTime = time
    lastRandom = random80()
  }
  const timePart = encode(BigInt(time), TIME_CHARS)
  const randomPart = encode(lastRandom, RANDOM_CHARS)
  return (timePart + randomPart) as Ulid
}

/* ----------------------------------------------------------------------------
 * 品牌化 ID 工厂（前缀 + ULID，`book_01J9X…` 形态；品牌类型见 kernel-schema.ts）。
 * T1 只落建书所需五族，其余实体随实现票逐个增补。
 * -------------------------------------------------------------------------- */

export function newBookId(): BookId {
  return `book_${newUlid()}` as BookId
}

/** BookRecord 与大纲根节点同前缀不同品牌，防止串用。 */
export function newBookNodeId(): BookNodeId {
  return `book_${newUlid()}` as BookNodeId
}

export function newVolumeNodeId(): VolumeNodeId {
  return `volume_${newUlid()}` as VolumeNodeId
}

export function newAuthorIntentId(): AuthorIntentId {
  return `aint_${newUlid()}` as AuthorIntentId
}

export function newStyleProfileId(): StyleProfileId {
  return `style_${newUlid()}` as StyleProfileId
}

/** T3（实现票 #17）：章大纲节点与正文文件共用同一章身份。 */
export function newChapterNodeId(): ChapterNodeId {
  return `chapter_${newUlid()}` as ChapterNodeId
}

export function newChapterCommitId(): ChapterCommitId {
  return `cmit_${newUlid()}` as ChapterCommitId
}

/** T4（实现票 #19）：叙事状态流四族身份。 */
export function newFactId(): FactId {
  return `fact_${newUlid()}` as FactId
}

export function newKnowledgeStateId(): KnowledgeStateId {
  return `knst_${newUlid()}` as KnowledgeStateId
}

export function newRelationshipStateId(): RelationshipStateId {
  return `rels_${newUlid()}` as RelationshipStateId
}

export function newTimelineEventId(): TimelineEventId {
  return `tle_${newUlid()}` as TimelineEventId
}
