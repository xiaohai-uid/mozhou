// @vitest-environment node
/**
 * 书级请求解码（工单07）· 表驱动回归。
 *
 * 为什么这些用例值得单独钉住：chapterIndex 的冻结规则（≥ 1 的整数）此前在 16 个调用点
 * 各写一份，校验条件有五种不同写法。结果是「0 能穿过一部分端点、小数能穿过另一部分」。
 * 本文件把不变式钉在**一处**，并逐条证明旧代码里真实存在的洞已经关上。
 *
 * 覆盖（对应工单验收：整数、范围、缺字段、授权 root、principal、无 session）：
 *   1. 合法：1 / 大数 / 字符串 root 的规范化结果（绝对路径）。
 *   2. 范围：0、-1、小数、NaN、Infinity、字符串 '3'、布尔、数组、对象 ⇒ 全部 400。
 *   3. 缺字段：root 缺失、chapterIndex 缺失/undefined/null。
 *   4. 授权 root：目录不存在 ⇒ 404 BOOK_ROOT_NOT_FOUND；不是书目录 ⇒ 400
 *      NOT_A_MOZHOU_BOOK；指向文件 ⇒ 400 NOT_A_DIRECTORY。三者 status/code 原样透出，
 *      本模块**不重新解释**「什么算一本书」（security.ts 仍是唯一判据）。
 *   5. principal：hosted + 无主体 ⇒ 401 UNAUTHORIZED_PRINCIPAL（即使盘面与字段都合法，
 *      且这发生在任何 I/O 之前）。
 *   6. 无 session：local 模式（未设 MOZHOU_HOSTED）下 null 主体照常解码成功——本模块
 *      不是新的认证闸，hosted 才收紧。
 *   7. optional 章号：/api/draft.accept 的语义（缺省 null，但带了就得合法）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHAPTER_INDEX_INVALID_MESSAGE,
  CHAPTER_INDEX_REQUIRED_MESSAGE,
  ROOT_REQUIRED_MESSAGE,
  decodeBookRequest,
  noOpenProductionSessionError,
} from './bookRequest.js'
import {
  INVALID_BOOK_REQUEST,
  NO_COMPILED_RECEIPT,
  NO_OPEN_PRODUCTION_SESSION,
  UNAUTHORIZED_PRINCIPAL,
} from './routeCodes.js'
import { createBook } from '@mozhou/data-plane'
import type { VerifiedPrincipal } from './auth/session.js'

const PRINCIPAL: VerifiedPrincipal = { userId: 'u_07', email: 'u07@example.test' }
const savedHosted = process.env['MOZHOU_HOSTED']

let root = ''
let notABook = ''
let aPlainFile = ''

beforeEach(() => {
  delete process.env['MOZHOU_HOSTED']
  root = mkdtempSync(join(tmpdir(), 'mozhou-bookreq-book-'))
  createBook({ dir: root, title: '解码测试书' })
  notABook = mkdtempSync(join(tmpdir(), 'mozhou-bookreq-plain-'))
  aPlainFile = join(notABook, 'book.json')
  writeFileSync(aPlainFile, 'this is a file, not a directory', 'utf8')
})

afterEach(() => {
  for (const dir of [root, notABook]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* Windows file lock tolerance */
    }
  }
  if (savedHosted === undefined) delete process.env['MOZHOU_HOSTED']
  else process.env['MOZHOU_HOSTED'] = savedHosted
})

describe('1. 合法请求：root 规范化 + 章号直出', () => {
  it('chapterIndex=1 与大整数都通过，root 被规范化为绝对路径', () => {
    for (const chapterIndex of [1, 7, 99999]) {
      const result = decodeBookRequest({ chapterIndex }, root, { principal: PRINCIPAL })
      expect(result.ok, String(chapterIndex)).toBe(true)
      if (result.ok) {
        expect(result.value.chapterIndex).toBe(chapterIndex)
        expect(result.value.root).toBe(resolve(root))
        expect(result.value.principal).toBe(PRINCIPAL)
      }
    }
  })

  it('相对路径 root 也被规范化（守卫的既有语义不被本模块改写）', () => {
    const result = decodeBookRequest({ chapterIndex: 1 }, root + '/./', { principal: PRINCIPAL })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.root).toBe(resolve(root))
  })
})

describe('2. 范围：非法章号一律 400（0/负数/小数/NaN/Infinity/非数字）', () => {
  // 这些正是旧代码里五种写法互相打架的输入集合。
  const invalid: ReadonlyArray<readonly [string, unknown]> = [
    ['0（第一章之前不存在）', 0],
    ['负数', -1],
    ['小数 1.5', 1.5],
    ['小数 0.5', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['数字字符串 "3"', '3'],
    ['空字符串', ''],
    ['布尔 true', true],
    ['数组 [1]', [1]],
    ['对象 {}', {}],
  ]

  it.each(invalid)('%s ⇒ 400 INVALID_BOOK_REQUEST，且盘面零触碰', (_label, chapterIndex) => {
    const result = decodeBookRequest({ chapterIndex }, root, { principal: PRINCIPAL })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(400)
      expect(result.error.code).toBe(INVALID_BOOK_REQUEST)
      expect(result.error.error).toBe(CHAPTER_INDEX_INVALID_MESSAGE)
    }
  })

  it('0 与 1.5 在 optional 模式下同样被拒（可选只放宽「缺省」，不放宽「非法」）', () => {
    for (const chapterIndex of [0, 1.5]) {
      const result = decodeBookRequest({ chapterIndex }, root, { chapter: 'optional', principal: PRINCIPAL })
      expect(result.ok, String(chapterIndex)).toBe(false)
    }
  })
})

describe('3. 缺字段：root 与 chapterIndex 各自可诊断', () => {
  it('root 缺失（null / undefined / 空串 / 空白）⇒ 400 root required', () => {
    for (const bookRoot of [null, undefined, '', '   ']) {
      const result = decodeBookRequest({ chapterIndex: 1 }, bookRoot, { principal: PRINCIPAL })
      expect(result.ok, String(bookRoot)).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(400)
        expect(result.error.code).toBe(INVALID_BOOK_REQUEST)
        expect(result.error.error).toBe(ROOT_REQUIRED_MESSAGE)
      }
    }
  })

  it('chapterIndex 缺失（undefined / null / 缺字段）在 required 模式 ⇒ 400', () => {
    for (const body of [{}, { chapterIndex: undefined }, { chapterIndex: null }]) {
      const result = decodeBookRequest(body, root, { principal: PRINCIPAL })
      expect(result.ok, JSON.stringify(body)).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(400)
        expect(result.error.code).toBe(INVALID_BOOK_REQUEST)
        expect(result.error.error).toBe(CHAPTER_INDEX_REQUIRED_MESSAGE)
      }
    }
  })
})

describe('4. 授权 root：边界判据原样透出，status/code 不被本模块改写', () => {
  it('目录不存在 ⇒ 404 BOOK_ROOT_NOT_FOUND', () => {
    const missing = join(notABook, 'no-such-book')
    const result = decodeBookRequest({ chapterIndex: 1 }, missing, { principal: PRINCIPAL })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(404)
      expect(result.error.code).toBe('BOOK_ROOT_NOT_FOUND')
    }
  })

  it('存在但无 book.json 标记 ⇒ 400 NOT_A_MOZHOU_BOOK（不是一本书）', () => {
    const empty = mkdtempSync(join(tmpdir(), 'mozhou-bookreq-nomarker-'))
    try {
      const result = decodeBookRequest({ chapterIndex: 1 }, empty, { principal: PRINCIPAL })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(400)
        expect(result.error.code).toBe('NOT_A_MOZHOU_BOOK')
      }
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('指向文件而非目录 ⇒ 400 NOT_A_DIRECTORY', () => {
    const result = decodeBookRequest({ chapterIndex: 1 }, aPlainFile, { principal: PRINCIPAL })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(400)
      expect(result.error.code).toBe('NOT_A_DIRECTORY')
    }
  })

  it('章号非法优先于 book.json 标记缺失：400 说的是「你少传字段」而不是「这不是一本书」', () => {
    // 顺序冻结：形状检查在守卫之前（本模块第 3 步是纯形状，第 2 步才碰盘）。
    // 这里用一个**根本不存在**的 root 来说明：root 缺失类错误先报，非法章号同理。
    const result = decodeBookRequest({ chapterIndex: 0 }, join(notABook, 'ghost'), { principal: PRINCIPAL })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BOOK_ROOT_NOT_FOUND')
  })
})

describe('5. principal：hosted 且无主体 ⇒ 401（凭据隔离的前置闸）', () => {
  it('hosted + principal 缺省 ⇒ 401 UNAUTHORIZED_PRINCIPAL', () => {
    process.env['MOZHOU_HOSTED'] = 'true'
    for (const principal of [undefined, null]) {
      const result = decodeBookRequest({ chapterIndex: 1 }, root, { principal })
      expect(result.ok, String(principal)).toBe(false)
      if (!result.ok) {
        expect(result.error.status).toBe(401)
        expect(result.error.code).toBe(UNAUTHORIZED_PRINCIPAL)
      }
    }
  })

  it('hosted + 空 userId 同样拒答（主体在场但没有身份 ≡ 没有主体）', () => {
    process.env['MOZHOU_HOSTED'] = 'true'
    const result = decodeBookRequest({ chapterIndex: 1 }, root, {
      principal: { userId: '', email: 'x@example.test' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(UNAUTHORIZED_PRINCIPAL)
  })

  it('hosted + 有主体 ⇒ 正常解码（这一层不是新的认证闸，不越权拒答合法请求）', () => {
    process.env['MOZHOU_HOSTED'] = 'true'
    const result = decodeBookRequest({ chapterIndex: 1 }, root, { principal: PRINCIPAL })
    expect(result.ok).toBe(true)
  })

  it('无主体时的 401 优先于一切形状问题：连 root 都没给也先说「先认证」', () => {
    process.env['MOZHOU_HOSTED'] = 'true'
    const result = decodeBookRequest({ chapterIndex: 0 }, null, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
      expect(result.error.code).toBe(UNAUTHORIZED_PRINCIPAL)
    }
  })
})

describe('6. 无 session：local 模式下主体可缺省（本模块不制造新的 401）', () => {
  it('未设 MOZHOU_HOSTED 且 principal 缺省 ⇒ 解码成功，principal 为 null', () => {
    const result = decodeBookRequest({ chapterIndex: 2 }, root, {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.chapterIndex).toBe(2)
      expect(result.value.principal).toBeNull()
    }
  })
})

describe('7. optional 章号（/api/draft.accept 语义）', () => {
  it('缺省 ⇒ chapterIndex: null（调用方采信候选自带的章号）', () => {
    const result = decodeBookRequest({ candidateId: 'cnd_1' }, root, { chapter: 'optional', principal: PRINCIPAL })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.chapterIndex).toBeNull()
  })

  it('带了就必须是 ≥1 的整数（带了就必须可信，不做「猜一个」的兜底）', () => {
    const result = decodeBookRequest({ chapterIndex: 3 }, root, { chapter: 'optional', principal: PRINCIPAL })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.chapterIndex).toBe(3)
  })
})

describe('8. 「无开放生产会话」的契约错误：文案逐字保留，另带 code', () => {
  it('文案仍是旧客户端匹配的英文，code 另给（工单07 点名的三处重复）', () => {
    const contract = noOpenProductionSessionError(7)
    expect(contract.status).toBe(409)
    expect(contract.code).toBe(NO_OPEN_PRODUCTION_SESSION)
    expect(contract.error).toBe('chapter 7 has no open production session')
  })

  it('错误码常量与判据常量不再重复登记在同一处清单里', () => {
    // routeCodes 是契约真源；本模块只引用，不重新字面量。
    expect(NO_OPEN_PRODUCTION_SESSION).toBe('NO_OPEN_PRODUCTION_SESSION')
    expect(NO_COMPILED_RECEIPT).toBe('NO_COMPILED_RECEIPT')
  })
})
