/**
 * 导入决策纯函数（P1-import-plan · 迁移合同 §3.1）。
 *
 * 逐条判定（无副作用、可审阅）：
 * - `unclaimed`：身份不明 / 不属于目标作品 → 进待认领区，**不分配给任何作品**（不猜作品）。
 * - `duplicate`：幂等键（包摘要 + 目标身份 + 章号）已在已应用集合中 → 重复导入不产生副作用。
 * - `conflict`：与服务端现状或本地现状不一致 → **保留双份、不覆盖**。
 * - `matched`：可安全写回既有槽位。
 *
 * 保守条款：服务端**不可达**时不能推断「服务端为空」，一律判 `conflict`
 * （宁可留双份，也不凭读不到就覆盖）。
 *
 * E01 补强（合同 §3.1「计划绑定 / 目标槽唯一 / 候选基线语义」）：
 * - **计划绑定**：计划携带 `binding`（包摘要 + 目标身份 + origin + 视图代次）。输入包、
 *   目标作品或视图代次任一变化即失效；调用方按 `planBindingMatches` 判定，不得沿用旧计划。
 * - **目标槽唯一**：同一 `(身份, 章号)` 在包内出现多条时，首条正常处理；内容相同的后项判
 *   `duplicate`，内容不同的后项判 `conflict` 并带唯一 `slotTag` 落隔离槽——**后项不覆盖前项**。
 * - **候选基线语义**：与既有采纳契约（`packages/pipeline/src/draft-accept.ts` 的
 *   `PreWriteHashMismatchError`）一致，`base.revision` 与 `base.sha256` 都要与服务端现值比对。
 */
import { canonicalStringify } from './packageFormat'
import type {
  BookIdentity,
  EditorProjectionRecord,
  MigrationCandidate,
  MigrationChapterEntry,
  MigrationPackageV1,
  MigrationUnclaimedEntry,
} from './packageFormat'

export type ImportVerdict = 'matched' | 'unclaimed' | 'conflict' | 'duplicate'

/**
 * 目标壳内的本地现状：草稿 + 保存基线 + **AI 候选** + **编辑器投影**。
 * 后两者是迁移合同不变量 1 点名要保护的「AI 候选、编辑器结构」——只比较草稿文本
 * 会让 matched 覆盖本地既有的候选/投影。
 */
export interface LocalChapterSnapshot {
  readonly draftText: string | null
  readonly baselineSha256: string | null
  readonly candidate: MigrationCandidate | null
  readonly editorProjection: EditorProjectionRecord | null
}

/** 服务端现状快照（与 serverStateProbe 的输出同构）。 */
export interface ServerChapterSnapshot {
  readonly reachable: boolean
  readonly exists: boolean
  readonly revision: number | null
  readonly phase: string | null
  readonly bodySha256: string | null
}

export interface ImportPlanItem {
  readonly verdict: ImportVerdict
  readonly identity: BookIdentity
  readonly chapterIndex: number
  readonly chapterKey: string
  /** 幂等键：包摘要 + 目标身份 + 章号。 */
  readonly idempotencyKey: string
  readonly reason: string
  readonly entry: MigrationChapterEntry
  /**
   * 隔离槽标识（在包摘要之下唯一）。正常条目为 `<verdict>.<身份后缀>.<章号>`；
   * 同一目标槽在包内重复且内容不同时，后项追加 `.dupN`——保证两个副本各有独立槽位，
   * 后到的不会覆盖先到的（合同「保留双份」）。
   */
  readonly slotTag: string
}

export interface ImportPlan {
  readonly digest: string
  readonly targetIdentity: BookIdentity | null
  readonly targetIdentitySuffix: string | null
  readonly items: readonly ImportPlanItem[]
  readonly counts: Readonly<Record<ImportVerdict, number>>
  /** 包内待认领条目原样透出（导入侧只展示，不写任何作品槽位）。 */
  readonly unclaimed: readonly MigrationUnclaimedEntry[]
  /** 计划绑定：输入包 / 目标作品 / 视图代次。任一变化即失效，调用方不得沿用。 */
  readonly binding: PlanBinding
}

/** 计划建立时的绑定快照。用于判定「这份计划还对当前现场有效吗」。 */
export interface PlanBinding {
  readonly packageDigest: string
  readonly targetIdentitySuffix: string | null
  readonly targetRoot: string | null
  /** 包内记录的导出 origin（人工审阅用；与包摘要同变，故不单独参与失效判定）。 */
  readonly origin: string
  /** 面板视图代次：切书、改包文本或重新生成计划都会前进。 */
  readonly viewGeneration: number
}

/** 调用方当前的现场期望（与 binding 逐项比对）。 */
export interface PlanBindingExpectation {
  readonly packageDigest: string
  readonly targetIdentitySuffix: string | null
  readonly targetRoot: string | null
  readonly viewGeneration: number
}

/**
 * 计划是否仍对当前现场有效。任一绑定项不一致即失效——旧结果不能激活应用
 * （E01 合同「输入包或目标变化时失效」）。
 */
export function planBindingMatches(plan: ImportPlan, expected: PlanBindingExpectation): boolean {
  const { binding } = plan
  return (
    binding.packageDigest === expected.packageDigest &&
    binding.targetIdentitySuffix === expected.targetIdentitySuffix &&
    binding.targetRoot === expected.targetRoot &&
    binding.viewGeneration === expected.viewGeneration
  )
}

/** 身份后缀 = bookId 优先、root 兜底（与 chapterDraftKey 同源）。 */
export function identityKeyOf(identity: Pick<BookIdentity, 'bookId' | 'root'>): string {
  return identity.bookId || identity.root
}

/** 与键序无关的 JSON 等价（复用迁移包的规范化序列化）。 */
function equalJson(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b)
}

/** 幂等键：同一包摘要 + 同一目标身份 + 同一章号 → 同一键。 */
export function idempotencyKeyFor(
  digest: string,
  identity: Pick<BookIdentity, 'bookId' | 'root'>,
  chapterIndex: number,
): string {
  return `${digest}::${identityKeyOf(identity)}::${chapterIndex}`
}

export interface ImportPlanInput {
  readonly pkg: MigrationPackageV1
  /** 目标作品身份（新壳当前作品）；null 表示尚未确定 → 全部进待认领区。 */
  readonly targetIdentity: BookIdentity | null
  /** 本地现状查询器（目标壳内既有槽位）。 */
  readonly local: (identity: BookIdentity, chapterIndex: number) => LocalChapterSnapshot | null
  /** 服务端现状查询器。 */
  readonly server: (identity: BookIdentity, chapterIndex: number) => ServerChapterSnapshot | null
  /** 已应用的幂等键（来自已迁移登记表）。 */
  readonly appliedKeys: readonly string[]
  /** 面板视图代次（切书 / 改包文本会前进）。缺省 0，保持纯函数可重复。 */
  readonly viewGeneration?: number
}

/** 冲突判定前的条目（尚未做包内目标槽唯一化与隔离槽命名）。 */
interface RawPlanItem {
  readonly identity: BookIdentity
  readonly chapterIndex: number
  readonly chapterKey: string
  readonly idempotencyKey: string
  readonly entry: MigrationChapterEntry
  readonly verdict: ImportVerdict
  readonly reason: string
}

/**
 * 冲突判定（纯函数）。导出供 `applyImport` 在**应用时**用当前现场重跑——
 * 计划里的 verdict 只是预览结论，不能当作写入许可（E01 合同）。
 */
export function decideConflict(
  entry: MigrationChapterEntry,
  server: ServerChapterSnapshot | null,
  local: LocalChapterSnapshot | null,
): string | null {
  // 1) 服务端不可达：不能推断「服务端为空」→ 保守判冲突。
  if (server === null || server.reachable === false) {
    return 'server-unreachable（无法确认服务端现状，保守保留双份）'
  }
  if (server.exists) {
    const candidateRevision = entry.candidate?.base.revision ?? null
    if (candidateRevision !== null && server.revision !== null && candidateRevision !== server.revision) {
      return `candidate-base-revision-mismatch（候选基线 revision=${candidateRevision}，服务端 revision=${server.revision}）`
    }
    // 与既有采纳契约同源（draft-accept.ts 的 PreWriteHashMismatchError：磁盘正文哈希必须等于
    // base.sha256）。只比 revision 会漏判「revision 相同但正文已变」，候选落地即对错基线。
    const candidateSha = entry.candidate?.base.sha256 ?? null
    if (candidateSha !== null && server.bodySha256 !== null && candidateSha !== server.bodySha256) {
      return 'candidate-base-hash-mismatch（候选基线 sha256 与服务端正文不一致）'
    }
    const draftBaseline = entry.draft?.baselineSha256 ?? null
    if (draftBaseline !== null && server.bodySha256 !== null && draftBaseline !== server.bodySha256) {
      return 'draft-baseline-mismatch（草稿基线哈希与服务端正文不一致）'
    }
    if (server.phase === 'committed' && (entry.draft !== null || entry.candidate !== null)) {
      return 'server-committed（服务端已定稿，导入会覆盖）'
    }
  }
  // 2) 本地已有不同草稿：不覆盖。
  if (local !== null && local.draftText !== null && entry.draft !== null) {
    if (local.draftText !== entry.draft.text) {
      return 'local-draft-differs（目标壳内已有不同草稿）'
    }
    // 文本相同但保存基线不同：落地会把本地基线改写成包内基线，静默翻转「已保存/未保存」
    // 标记（文本不丢但语义变了）→ 保守判冲突（合同「校验保存基线」的本地侧）。
    if (local.baselineSha256 !== entry.draft.baselineSha256) {
      return 'local-baseline-differs（目标壳内保存基线与包内不一致）'
    }
  }
  // 3) 本地已有不同 AI 候选 / 编辑器投影：不覆盖（不变量 1 保护候选与编辑器结构）。
  if (local !== null) {
    if (local.candidate !== null && entry.candidate !== null && !equalJson(local.candidate, entry.candidate)) {
      return 'local-candidate-differs（目标壳内已有不同 AI 候选）'
    }
    if (
      local.editorProjection !== null &&
      entry.editorProjection !== null &&
      !equalJson(local.editorProjection.blocks, entry.editorProjection.blocks)
    ) {
      return 'local-projection-differs（目标壳内已有不同编辑器投影）'
    }
  }
  return null
}

/** 构建可审阅的导入计划；不产生任何副作用。 */
export function buildImportPlan(input: ImportPlanInput): ImportPlan {
  const { pkg, targetIdentity, local, server, appliedKeys, viewGeneration = 0 } = input
  const targetSuffix = targetIdentity === null ? null : identityKeyOf(targetIdentity)
  const applied = new Set(appliedKeys)
  const raw: RawPlanItem[] = []

  for (const book of pkg.books) {
    const bookSuffix = identityKeyOf(book.identity)
    for (const entry of book.chapters) {
      const idempotencyKey = idempotencyKeyFor(pkg.digest, book.identity, entry.chapterIndex)
      const base = {
        identity: book.identity,
        chapterIndex: entry.chapterIndex,
        chapterKey: entry.chapterKey,
        idempotencyKey,
        entry,
      } as const

      if (targetSuffix === null) {
        raw.push({ ...base, verdict: 'unclaimed', reason: 'no-target-book（目标作品未确定，进待认领区）' })
        continue
      }
      if (bookSuffix !== targetSuffix) {
        raw.push({
          ...base,
          verdict: 'unclaimed',
          reason: `identity-mismatch（条目身份 ${bookSuffix} 不属于目标作品 ${targetSuffix}）`,
        })
        continue
      }
      if (applied.has(idempotencyKey)) {
        raw.push({ ...base, verdict: 'duplicate', reason: 'already-applied（该包此章已迁移，幂等跳过）' })
        continue
      }
      const conflict = decideConflict(entry, server(book.identity, entry.chapterIndex), local(book.identity, entry.chapterIndex))
      if (conflict !== null) {
        raw.push({ ...base, verdict: 'conflict', reason: conflict })
        continue
      }
      raw.push({ ...base, verdict: 'matched', reason: 'clean（可安全写回既有槽位）' })
    }
  }

  // 目标槽唯一（E01 合同）：同一 `(身份, 章号)` 在包内出现多条时，只有首条按原判落地；
  // 内容相同的后项判 duplicate（幂等跳过），内容不同的后项判 conflict（落隔离槽保留双份）。
  // 否则后项会静默覆盖前项——一份自洽（摘要正确）的包也能造成内容丢失。
  const seenSlots = new Map<string, string>()
  const usedTags = new Map<string, number>()
  const items: ImportPlanItem[] = raw.map((item) => {
    const slotKey = `${identityKeyOf(item.identity)}#${item.chapterIndex}`
    const fingerprint = canonicalStringify(item.entry)
    let verdict = item.verdict
    let reason = item.reason
    const firstFingerprint = seenSlots.get(slotKey)
    if (firstFingerprint === undefined) {
      seenSlots.set(slotKey, fingerprint)
    } else if (firstFingerprint === fingerprint) {
      verdict = 'duplicate'
      reason = 'intra-package-duplicate（包内同一目标槽内容重复，幂等跳过）'
    } else {
      verdict = 'conflict'
      reason = 'target-slot-collision（包内同一目标槽有多条不同内容；保留双份，后项不覆盖前项）'
    }
    const baseTag = `${verdict}.${identityKeyOf(item.identity)}.${item.chapterIndex}`
    const used = usedTags.get(baseTag) ?? 0
    usedTags.set(baseTag, used + 1)
    const slotTag = used === 0 ? baseTag : `${baseTag}.dup${used}`
    return { ...item, verdict, reason, slotTag }
  })

  const counts: Record<ImportVerdict, number> = { matched: 0, unclaimed: 0, conflict: 0, duplicate: 0 }
  for (const item of items) counts[item.verdict] += 1

  return {
    digest: pkg.digest,
    targetIdentity,
    targetIdentitySuffix: targetSuffix,
    items,
    counts,
    unclaimed: pkg.unclaimed,
    binding: {
      packageDigest: pkg.digest,
      targetIdentitySuffix: targetSuffix,
      targetRoot: targetIdentity === null ? null : targetIdentity.root,
      origin: pkg.origin.origin,
      viewGeneration,
    },
  }
}
