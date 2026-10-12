/**
 * 合成旧浏览器导出样本（P1-e2e fixture）。
 *
 * 覆盖迁移合同要求的所有情形：
 * - **多作品**：甲书（当前作品）+ 乙书（另一作品，键身份不同）；
 * - **同章号两书**：甲书第 1 章与乙书第 1 章同号，不得串稿；
 * - **缺身份**：乙书的键身份不属于当前作品 → 待认领区；另含旧版无归属键 `ch_9`（永不匹配）；
 * - **冲突稿**：甲书第 3 章草稿基线在导入侧与服务端现值不一致；
 * - **候选 base revision/sha256**：甲书第 1 章带候选缓存；
 * - **无基线旧缓存**：甲书第 2 章只有草稿、没有基线。
 *
 * 放在 `src/migration/__fixtures__/` 而非 `.scratch/`：`.gitignore:9` 的 `.scratch/*`
 * 已由 git check-ignore 证实被忽略，只有白名单目录可跟踪。
 */
import { syncSha256Hex } from '../../workbench/lib/sha256'
import type { BookIdentity } from '../packageFormat'
import type { StorageReader } from '../exportLocalStorage'
import {
  CANDIDATE_CACHE_PREFIX,
  DRAFT_BASELINE_PREFIX,
  DRAFT_CACHE_PREFIX,
  WORKBENCH_STATE_KEY,
} from '../exportLocalStorage'

/** 当前作品（旧页面 workbench 记录的作品）。 */
export const SYNTHETIC_CURRENT_BOOK: BookIdentity = {
  bookId: 'bk_alpha',
  root: 'C:\\tmp\\alpha',
  title: '雾港',
}

/** 另一作品（只在键身份里出现，无 workbench 记录 → 待认领）。 */
export const SYNTHETIC_OTHER_SUFFIX = 'bk_beta'

export const SYNTHETIC_DRAFTS = {
  alphaCh1: '甲书第一章草稿',
  alphaCh2: '甲书第二章（无基线旧缓存）',
  alphaCh3: '甲书第三章（冲突稿）',
  betaCh1: '乙书第一章草稿',
  legacyNoIdentity: '旧版无归属草稿',
} as const

/**
 * 甲书第 1 章的候选基线。采纳契约（`packages/pipeline/src/draft-accept.ts` 的
 * `PreWriteHashMismatchError`）要求 `base.sha256` 等于**磁盘正文哈希**；本样本里该章已保存
 * （基线 == 草稿哈希），故候选基线必须等于该草稿的哈希，否则这份候选按契约本就不能采纳。
 */
export const SYNTHETIC_CANDIDATE_BASE = {
  revision: 2,
  sha256: syncSha256Hex(SYNTHETIC_DRAFTS.alphaCh1),
} as const

/** 甲书第 3 章草稿的保存基线（导入侧会与服务端现值不同 → 冲突）。 */
export const SYNTHETIC_ALPHA_CH3_BASELINE = syncSha256Hex('甲书第三章（旧基线）')

/** 构造合成旧 localStorage 条目（键值对，顺序即插入顺序）。 */
export function syntheticBrowserEntries(): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [
    [WORKBENCH_STATE_KEY, JSON.stringify({ book: SYNTHETIC_CURRENT_BOOK, view: 'workbench' })],
    ['mozhou.wizard.done', 'done'],
    // 甲书第 1 章：草稿 + 基线 + 候选（base revision/sha256）
    [`${DRAFT_CACHE_PREFIX}ch_${SYNTHETIC_CURRENT_BOOK.bookId}_1`, SYNTHETIC_DRAFTS.alphaCh1],
    [`${DRAFT_BASELINE_PREFIX}ch_${SYNTHETIC_CURRENT_BOOK.bookId}_1`, syncSha256Hex(SYNTHETIC_DRAFTS.alphaCh1)],
    [
      `${CANDIDATE_CACHE_PREFIX}cand_${SYNTHETIC_CURRENT_BOOK.bookId}_1`,
      JSON.stringify({
        candidateId: 'cand_alpha_1',
        base: { revision: SYNTHETIC_CANDIDATE_BASE.revision, sha256: SYNTHETIC_CANDIDATE_BASE.sha256 },
        mode: 'replace',
        draftText: '甲书第一章候选正文',
        phase: 'draft_done',
      }),
    ],
    // 甲书第 2 章：无基线旧缓存
    [`${DRAFT_CACHE_PREFIX}ch_${SYNTHETIC_CURRENT_BOOK.bookId}_2`, SYNTHETIC_DRAFTS.alphaCh2],
    // 甲书第 3 章：冲突稿（基线与会话现值不一致）
    [`${DRAFT_CACHE_PREFIX}ch_${SYNTHETIC_CURRENT_BOOK.bookId}_3`, SYNTHETIC_DRAFTS.alphaCh3],
    [`${DRAFT_BASELINE_PREFIX}ch_${SYNTHETIC_CURRENT_BOOK.bookId}_3`, SYNTHETIC_ALPHA_CH3_BASELINE],
    // 乙书第 1 章：同章号、另一作品身份
    [`${DRAFT_CACHE_PREFIX}ch_${SYNTHETIC_OTHER_SUFFIX}_1`, SYNTHETIC_DRAFTS.betaCh1],
    // 旧版无归属键：永不匹配、不进包
    [`${DRAFT_CACHE_PREFIX}ch_9`, SYNTHETIC_DRAFTS.legacyNoIdentity],
    [`${DRAFT_BASELINE_PREFIX}ch_9`, 'ab'.repeat(32)],
    // 白名单外键：不进包
    ['mozhou.membership.tier', 'pro'],
  ]
  return entries
}

/** 把合成样本写入真实（jsdom）localStorage。 */
export function installSyntheticExport(storage: Storage): void {
  for (const [key, value] of syntheticBrowserEntries()) storage.setItem(key, value)
}

/** 内存只读替身（用于不触真实 localStorage 的导出测试）。 */
export function syntheticStorage(): StorageReader {
  const entries = syntheticBrowserEntries()
  const keys = entries.map(([key]) => key)
  const map = new Map(entries)
  return {
    get length() {
      return keys.length
    },
    key(index: number) {
      return keys[index] ?? null
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null
    },
  }
}
