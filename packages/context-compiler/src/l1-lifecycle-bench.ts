/**
 * L1 确定性生命周期台架（ADR-0016 初版，实现票 #27）。
 *
 * 合成多章生命周期——空间移动 / 受伤 / 秘密揭示 / 规则突变 / 承诺回收——
 * 驱动三接缝黑盒跑通：LocalDataPlane（相位机 + 查询芯 + stale 传播）、
 * ContextCompiler.compile()、rebuildProjectionFromCanon（删库重建幂等）。
 * 全程 hermetic：一次性临时目录，零外部服务、零 LLM、零真实时钟；
 * 台架自身不做断言——只采集三接缝外部面的观测值，由测试文件对照。
 *
 * 为 L1 补齐至 50 章 <5s 打底：章事件编排集中在 buildChapterScripts，
 * 后续扩模只加幕不改骨架。确定性纪律：行 id 手工铸造（26 位 Crockford
 * base32 数字段）、时钟与凭证 id 显式注入，两次独立运行报告逐字段相等。
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type {
  BookId,
  ContextReceiptId,
  EntityRef,
  FactId,
  KnowledgeHolder,
  PovEntity,
} from '@mozhou/kernel'
import {
  createBook,
  createEntityCard,
  LocalDataPlane,
  MANIFEST_PATH,
  openDatabase,
  readManifest,
  readNarrativeSnapshot,
  rebuildProjectionFromCanon,
  RUNTIME_DB_PATH,
  scanEntityCards,
  type PlaneContext,
  type TrackingKind,
} from '@mozhou/data-plane'
import { loadReceipt } from './receipt-file.js'
import { canonicalJson } from './assemble.js'
import type { ExactTokenizer } from './assemble.js'
import { compile } from './compile.js'

/* ----------------------------------------------------------------------------
 * 冻结常量：合成书目、实体与确定性时钟
 * -------------------------------------------------------------------------- */

const NOW = '2026-08-24T18:00:00.000Z'

const LIN = 'char:lin-feng' as EntityRef
const MOYAN = 'char:mo-yan' as EntityRef
const SHEN = 'char:shen-wei' as EntityRef
const HEIYI = 'char:hei-yi' as EntityRef
const SECT = 'faction:qingyun-sect' as EntityRef
const SHAN = 'location:qingyun-shan' as EntityRef
const JIAN = 'location:luoyan-jian' as EntityRef
const TIANGUI = 'concept:tian-gui' as EntityRef
const SWORD = 'item:tingyu-jian' as EntityRef

/** 手工铸造 26 位 Crockford base32 数字段（数字合法）——跨运行确定且过 ULID 校验。 */
const slot = (n: number): string => String(n).padStart(26, '0')
const ruleFactId = factId(102)

function factId(n: number): FactId {
  return `fact_${slot(n)}` as FactId
}

/* ----------------------------------------------------------------------------
 * 行工厂：五族追踪行的最小合法形状（同 e2e 先例的确定性构造）
 * -------------------------------------------------------------------------- */

interface FactSpec {
  readonly id: FactId
  readonly chapterIndex: number
  readonly subject: EntityRef
  readonly predicate: string
  readonly value: string | number | boolean
  readonly validFrom: number
  /** 同 id 重发即折叠更新（末行胜出）；更新行必须带 revision+1。 */
  readonly validUntil?: number
  readonly revision?: number
  readonly riskClass?: 'low' | 'medium' | 'high'
}

function factRow(bookId: BookId, spec: FactSpec): Record<string, unknown> {
  const secret = spec.predicate.startsWith('secret.')
  const highRisk = secret || spec.riskClass === 'high'
  return {
    id: spec.id,
    bookId,
    revision: spec.revision ?? 0,
    createdAt: NOW,
    updatedAt: NOW,
    subject: spec.subject,
    predicate: spec.predicate,
    value: spec.value,
    // 冻结行形：validUntil 键必须存在（区间闭合一侧缺省 = null，不得缺键）
    validUntil: spec.validUntil ?? null,
    validFrom: spec.validFrom,
    importance: highRisk ? ('critical' as const) : ('notable' as const),
    riskClass: spec.riskClass ?? (secret ? ('high' as const) : ('low' as const)),
    source: { kind: 'chapter' as const, chapterIndex: spec.chapterIndex },
    status: 'confirmed' as const,
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai' as const, protectedUserContent: false },
  }
}

function knowledgeRow(
  bookId: BookId,
  n: number,
  fact: FactId,
  holder: KnowledgeHolder,
  knownSinceChapter: number,
): Record<string, unknown> {
  return {
    id: `knst_${slot(n)}`,
    bookId,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    factId: fact,
    holder,
    knownSinceChapter,
  }
}

function timelineRow(
  bookId: BookId,
  n: number,
  order: number,
  chapterIndex: number,
  label: string,
  participants: readonly EntityRef[],
  impactFactIds: readonly FactId[],
  locationRef?: EntityRef,
): Record<string, unknown> {
  return {
    id: `tle_${slot(n)}`,
    bookId,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    worldTimeLabel: label,
    worldTimeOrder: order,
    chapterIndex,
    ...(locationRef === undefined ? {} : { locationRef }),
    participants: [...participants],
    summary: label,
    impactFactIds: [...impactFactIds],
  }
}

function promiseRow(
  bookId: BookId,
  n: number,
  status: 'introduced' | 'paid_off',
  payoffNotes: string | null,
): Record<string, unknown> {
  return {
    id: `prom_${slot(n)}`,
    bookId,
    revision: status === 'paid_off' ? 1 : 0,
    createdAt: NOW,
    updatedAt: NOW,
    type: 'foreshadowing',
    description: '听雨剑夜鸣之谜',
    introducedChapter: 1,
    targetChapter: 6,
    status,
    payoffNotes,
  }
}

/* ----------------------------------------------------------------------------
 * 章脚本：六幕生命周期（扩模到 50 章 = 在此追加幕）
 * -------------------------------------------------------------------------- */

interface Pin {
  readonly kind: 'temporalFact'
  readonly id: FactId
  readonly revision: number
}

interface ChapterScript {
  readonly index: number
  readonly title: string
  readonly summary: string
  readonly appends: Partial<Record<TrackingKind, readonly unknown[]>>
  /** 编译时读到的精确版本钉版（缺省 = 本章不依赖任何上游版本）。 */
  readonly pins?: readonly Pin[]
}

function buildChapterScripts(bookId: BookId): ChapterScript[] {
  const fShan1 = factId(101)
  const fRule = ruleFactId
  const fJian2 = factId(103)
  const fInjury = factId(104)
  const fSecret = factId(105)
  const fShan4 = factId(106)
  const fRuleRevived = factId(107)

  return [
    {
      index: 1,
      title: '夜宿青云',
      summary: '林枫夜入青云山，听雨剑无故轻鸣',
      appends: {
        temporalFact: [
          factRow(bookId, { id: fShan1, chapterIndex: 1, subject: LIN, predicate: '位置', value: SHAN, validFrom: 1 }),
          factRow(bookId, {
            id: fRule,
            chapterIndex: 1,
            subject: TIANGUI,
            predicate: '规则',
            value: '灵气枯竭',
            validFrom: 1,
            riskClass: 'high',
          }),
        ],
        timelineEvent: [timelineRow(bookId, 201, 1, 1, '子夜入山门', [LIN], [fShan1], SHAN)],
        narrativePromise: [promiseRow(bookId, 301, 'introduced', null)],
      },
    },
    {
      index: 2,
      title: '涧底重伤',
      summary: '林枫坠落落雁涧身负重伤',
      // 本章编译时读到的是「灵气枯竭」版世界规则（rev 0）
      pins: [{ kind: 'temporalFact', id: fRule, revision: 0 }],
      appends: {
        temporalFact: [
          // 折叠更新：同 id 关闭区间（第 1 章末离开青云山）
          factRow(bookId, {
            id: fShan1,
            chapterIndex: 2,
            subject: LIN,
            predicate: '位置',
            value: SHAN,
            validFrom: 1,
            validUntil: 1,
            revision: 1,
          }),
          factRow(bookId, { id: fJian2, chapterIndex: 2, subject: LIN, predicate: '位置', value: JIAN, validFrom: 2 }),
          factRow(bookId, { id: fInjury, chapterIndex: 2, subject: LIN, predicate: '状态', value: '重伤', validFrom: 2 }),
        ],
      },
    },
    {
      index: 3,
      title: '魔女之谜',
      summary: '魔焰身世成谜，无人知晓其魔渊渊源',
      pins: [{ kind: 'temporalFact', id: fRule, revision: 0 }],
      appends: {
        temporalFact: [
          factRow(bookId, {
            id: fSecret,
            chapterIndex: 3,
            subject: MOYAN,
            predicate: 'secret.origin',
            value: '魔渊遗孤',
            validFrom: 3,
          }),
        ],
      },
    },
    {
      index: 4,
      title: '真相与痊愈',
      summary: '林枫得知魔焰身世，涧底旧伤渐愈，重返山门',
      pins: [{ kind: 'temporalFact', id: fRule, revision: 0 }],
      appends: {
        temporalFact: [
          factRow(bookId, {
            id: fInjury,
            chapterIndex: 4,
            subject: LIN,
            predicate: '状态',
            value: '重伤',
            validFrom: 2,
            validUntil: 4,
            revision: 1,
          }),
          factRow(bookId, {
            id: fJian2,
            chapterIndex: 4,
            subject: LIN,
            predicate: '位置',
            value: JIAN,
            validFrom: 2,
            validUntil: 3,
            revision: 1,
          }),
          factRow(bookId, { id: fShan4, chapterIndex: 4, subject: LIN, predicate: '位置', value: SHAN, validFrom: 4 }),
        ],
        knowledgeState: [knowledgeRow(bookId, 401, fSecret, 'protagonist', 4)],
      },
    },
    {
      index: 5,
      title: '天规突变',
      summary: '天地规则异变，枯竭灵气一夜复苏',
      pins: [{ kind: 'temporalFact', id: fRule, revision: 1 }],
      appends: {
        temporalFact: [
          // 规则突变：同 id 折叠更新为「末行整行替换」语义——旧规则关区间
          //（validUntil=4），新规则以新 id 自第 5 章生效；两段历史并存可查
          factRow(bookId, {
            id: fRule,
            chapterIndex: 5,
            subject: TIANGUI,
            predicate: '规则',
            value: '灵气枯竭',
            validFrom: 1,
            validUntil: 4,
            riskClass: 'high',
            revision: 1,
          }),
          factRow(bookId, {
            id: fRuleRevived,
            chapterIndex: 5,
            subject: TIANGUI,
            predicate: '规则',
            value: '灵气复苏',
            validFrom: 5,
            riskClass: 'high',
          }),
        ],
        timelineEvent: [timelineRow(bookId, 202, 2, 5, '天规异变', [LIN, MOYAN], [fRuleRevived])],
      },
    },
    {
      index: 6,
      title: '剑鸣兑现',
      summary: '剑鸣引出魔渊入口，伏笔兑现',
      appends: {
        timelineEvent: [timelineRow(bookId, 203, 3, 6, '剑鸣三声', [LIN], [])],
        narrativePromise: [
          promiseRow(bookId, 301, 'paid_off', '第6章 剑鸣引出魔渊入口，伏笔兑现'),
        ],
      },
    },
  ]
}

/* ----------------------------------------------------------------------------
 * 观测面：全部来自三接缝的外部返回值
 * -------------------------------------------------------------------------- */

export interface LifecycleBenchReport {
  readonly durationMs: number
  readonly chaptersCommitted: readonly number[]
  /** 五族追踪流经 commitChapter 的累计追加行数。 */
  readonly appendedTotals: Readonly<Record<string, number>>
  /** 主角空间移动时间线：探测章 → 断言主体位置值。 */
  readonly locationByChapter: Readonly<Record<number, string>>
  /** 受伤事实可见章区间（探测 ch1..ch6）。 */
  readonly injuryVisibleChapters: readonly number[]
  /** 天规翻转探针。 */
  readonly ruleValueByChapter: Readonly<Record<number, string>>
  readonly secret: {
    /** 主角视角可见秘密的探测章（预揭示 ch3 必不可见）。 */
    readonly protagonistSeesAtChapters: readonly number[]
    /** 未授权视角全程零泄漏（结果集与「秘密不存在」不可区分）。 */
    readonly shenWeiEverSees: boolean
  }
  readonly stalePropagation: {
    readonly markedChapters: readonly number[]
    readonly untouchedChapters: readonly number[]
    /** 传播自吸收后启动必检必须干净（自己的标记不是外部修改）。 */
    readonly baselineCleanAfter: boolean
  }
  readonly rebuild: {
    readonly canonUnchanged: boolean
    readonly manifestByteStable: boolean
    readonly projectionFingerprintStable: boolean
    readonly queriesIdenticalPostRebuild: boolean
  }
  readonly compile: {
    readonly receiptOnDiskMatches: boolean
    readonly receiptChapterIndex: number
    readonly structuralSections: readonly string[]
    readonly settingIdentifiers: readonly string[]
    /** never 档卡草稿提及亦零激活。 */
    readonly neverCardPresent: boolean
    /** detectedOff 档别名不被 keyword 消费（图通道可达性归 T8a 已验）。 */
    readonly detectedOffAliasActivated: boolean
    readonly parseFailureCount: number
    readonly totalTokens: number
  }
}

/* ----------------------------------------------------------------------------
 * 台架主入口
 * -------------------------------------------------------------------------- */

export async function runLifecycleBench(): Promise<LifecycleBenchReport> {
  const startedAt = performance.now()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-l1-bench-'))
  try {
    const report = await runScenario(root)
    return { ...report, durationMs: Math.round(performance.now() - startedAt) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

type Database = PlaneContext['db']

/**
 * 投影内容指纹：全部用户表行集合排序后哈希（重建幂等硬断言）。
 * 刻意不按 rowid 序——live 库按提交时序交错落行，重建扫描按流全量灌入，
 * 物理行序本就可差；「投影=文件投影」（S1）断言的是内容集合相等。
 */
function projectionFingerprint(db: Database): string {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string
    }[]
  ).map((row) => row.name)
  const dump = tables.map((table) =>
    JSON.stringify(
      db
        .prepare(`SELECT * FROM "${table}"`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort(),
    ),
  )
  return createHash('sha256').update(dump.join('\n')).digest('hex')
}

/** canon 快照：.mozhou/ 运行时区之外所有文件的 rel path → sha256。 */
function canonSnapshot(root: string): Map<string, string> {
  const snapshot = new Map<string, string>()
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel))) {
      const childRel = rel !== '' ? `${rel}/${name}` : name
      if (childRel === '.mozhou') {
        continue
      }
      if (statSync(join(root, childRel)).isDirectory()) {
        walk(childRel)
      } else {
        snapshot.set(childRel, createHash('sha256').update(readFileSync(join(root, childRel))).digest('hex'))
      }
    }
  }
  walk('')
  return snapshot
}

function removeProjectionFiles(root: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${join(root, RUNTIME_DB_PATH)}${suffix}`, { force: true })
  }
}

async function runScenario(root: string): Promise<Omit<LifecycleBenchReport, 'durationMs'>> {
  const { book } = createBook({ dir: root, title: '听雨剑歌（L1 合成）' })
  const bookId = book.id

  // ── 设定阶段：九张目录卡四档全覆盖，经 data-plane 公共 API 落盘 ──
  const seedDb = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
  try {
    const ctx: PlaneContext = { root, db: seedDb, manifest: readManifest(root) }
    createEntityCard(ctx, LIN, {
      name: '林枫',
      aiContext: 'detected',
      aliases: [{ text: '枫儿', kind: 'exact' }],
      brief: '青云宗外门弟子佩剑听雨',
    })
    createEntityCard(ctx, MOYAN, { name: '魔焰', aiContext: 'detected', brief: '来历成谜的黑衣魔女' })
    createEntityCard(ctx, SHEN, { name: '沈巍', aiContext: 'detected', brief: '林枫同门师兄' })
    createEntityCard(ctx, HEIYI, { name: '黑衣人', aiContext: 'never', brief: '夜袭涧底的神秘人' })
    createEntityCard(ctx, SECT, { name: '青云宗', aiContext: 'always', brief: '正道魁首立派三百年' })
    createEntityCard(ctx, SHAN, { name: '青云山', aiContext: 'detected', brief: '青云宗山门所在' })
    createEntityCard(ctx, JIAN, {
      name: '落雁涧',
      aiContext: 'detected',
      aliases: [{ text: '涧底', kind: 'exact' }],
      brief: '山后绝涧深不见底',
    })
    createEntityCard(ctx, TIANGUI, {
      name: '天规',
      aiContext: 'detected',
      aliases: [{ text: '天规', kind: 'exact' }],
      brief: '约束修士的世界规则',
    })
    createEntityCard(ctx, SWORD, {
      name: '听雨剑',
      aiContext: 'detectedOff',
      aliases: [{ text: '听雨剑', kind: 'exact' }],
      brief: '林枫佩剑偶有剑鸣',
    })
  } finally {
    seedDb.close()
  }

  // ── 六幕生命周期：全部行为只经 LocalDataPlane 接缝 ──
  let plane = LocalDataPlane.open(root)
  const chaptersCommitted: number[] = []
  const appendedTotals: Record<string, number> = {}
  for (const script of buildChapterScripts(bookId)) {
    plane.createChapterDraft({ chapterIndex: script.index, title: script.title })
    const result = plane.commitChapter({
      chapterIndex: script.index,
      summary: script.summary,
      appends: script.appends,
      dependencyManifest: { entries: script.pins ?? [] },
    })
    chaptersCommitted.push(result.chapterIndex)
    for (const [kind, count] of Object.entries(result.appendedCounts)) {
      appendedTotals[kind] = (appendedTotals[kind] ?? 0) + (count ?? 0)
    }
  }

  // ── 幕间行为观测：结构化查询芯（POV / 秘密零泄漏在返回值上判定）──
  const probeFacts = (chapter: number, pov: PovEntity, subject: EntityRef) =>
    plane.queryActiveFacts({ chapter, pov, entityIds: [subject] })

  const behaviorProbes = (): string[] => [
    locationValueAt(2),
    locationValueAt(4),
    injuryVisibleChapters.join(','),
    ruleValueAt(4),
    ruleValueAt(5),
    secretVisibleChapters('protagonist').join(','),
    JSON.stringify(plane.queryActiveFacts({ chapter: 6, pov: 'protagonist' }).map((fact) => fact.id)),
  ]

  function locationValueAt(chapter: number): string {
    const hits = probeFacts(chapter, 'protagonist', LIN).filter((fact) => fact.predicate === '位置')
    return hits.map((fact) => String(fact.value)).sort().join('|')
  }

  function injuryVisibleChaptersFn(): number[] {
    return [1, 2, 3, 4, 5, 6].filter((chapter) =>
      probeFacts(chapter, 'protagonist', LIN).some((fact) => fact.predicate === '状态'),
    )
  }
  const injuryVisibleChapters = injuryVisibleChaptersFn()

  const locationByChapter: Record<number, string> = {}
  for (const chapter of [1, 2, 3, 4, 5]) {
    locationByChapter[chapter] = locationValueAt(chapter)
  }

  function ruleValueAt(chapter: number): string {
    return probeFacts(chapter, 'protagonist', TIANGUI)
      .map((fact) => String(fact.value))
      .sort()
      .join('|')
  }
  const ruleValueByChapter: Record<number, string> = { 4: ruleValueAt(4), 5: ruleValueAt(5) }

  const secretVisible = (chapter: number, pov: PovEntity): boolean =>
    plane
      .queryActiveFacts({ chapter, pov, entityIds: [MOYAN] })
      .some((fact) => fact.predicate.startsWith('secret.'))
  function secretVisibleChapters(pov: PovEntity): number[] {
    return [3, 4, 5, 6].filter((chapter) => secretVisible(chapter, pov))
  }
  const protagonistSeesAtChapters = secretVisibleChapters('protagonist')
  const shenWeiEverSees = secretVisibleChapters(SHEN as PovEntity).length > 0

  // ── 规则突变 → 下游 stale 传播（T6 接缝）：钉了旧版的章命中，钉新版的豁免 ──
  const propagation = plane.propagateStaleMarkers({
    reason: 'upstream_canon_changed',
    upstreamChanges: [{ kind: 'temporalFact', id: ruleFactId, revision: 1 }],
    markedAt: NOW,
  })
  const baselineAfterPropagation = plane.verifyBaseline()
  const baselineCleanAfter =
    baselineAfterPropagation.modified.length === 0 &&
    baselineAfterPropagation.missing.length === 0 &&
    baselineAfterPropagation.untracked.length === 0

  // ── 删库重建 ×2：canon 零触碰 + 基线逐字节稳定 + 投影指纹复原 + 查询等值 ──
  const fingerprintBefore = projectionFingerprint(plane.db)
  const canonBefore = canonSnapshot(root)
  const manifestBefore = readFileSync(join(root, MANIFEST_PATH))
  const probesBefore = behaviorProbes()

  let rebuildCanonUnchanged = true
  let rebuildManifestStable = true
  let rebuildFingerprintStable = true
  let rebuildQueriesIdentical = true
  for (let round = 0; round < 2; round++) {
    plane.close()
    removeProjectionFiles(root)
    rebuildProjectionFromCanon(root)

    const canonNow = canonSnapshot(root)
    rebuildCanonUnchanged &&=
      canonNow.size === canonBefore.size && [...canonBefore].every(([rel, hash]) => canonNow.get(rel) === hash)
    rebuildManifestStable &&= readFileSync(join(root, MANIFEST_PATH)).equals(manifestBefore)

    plane = LocalDataPlane.open(root)
    rebuildFingerprintStable &&= projectionFingerprint(plane.db) === fingerprintBefore
    const probesAfter = behaviorProbes()
    rebuildQueriesIdentical &&= probesAfter.every((probe, i) => probe === probesBefore[i])
  }

  // ── 第三接缝：编译第 7 章（多章累积状态上的召回与装配）──
  const charTok: ExactTokenizer = { version: 'l1-char-v1', count: (text) => text.length }
  const receiptId = `rcpt_${slot(777)}` as ContextReceiptId
  const compiled = await compile({
    task: { type: 'chapter_writing', chapterIndex: 7 },
    bookRoot: root,
    bookId,
    draftText: '枫儿重返落雁涧，涧底天规异响不止，黑衣人影子一闪，听雨剑轻鸣。',
    cards: scanEntityCards(root),
    snapshot: readNarrativeSnapshot(root),
    scope: { chapterIndex: 7, pov: 'protagonist' },
    structural: {
      sections: [{ section: 'author_intent', content: '写一部修仙长卷：空间移动、旧伤、秘密与承诺都要有回响。' }],
    },
    storyText: ['第六章末尾切片：剑鸣三声，山门灯火尽灭。'],
    modelProfile: { id: 'l1-deterministic-mock', contextWindow: 100000 },
    tokenizer: charTok,
    receiptId,
    nowIso: NOW,
  })
  plane.close()

  const { packet, receipt } = compiled
  const structuralSections = packet.structural.map((piece) => piece.section)
  const settingIdentifiers = packet.settings.map((entry) => entry.identifier).sort()
  const persisted = loadReceipt(root, receipt.id)

  return {    chaptersCommitted,
    appendedTotals,
    locationByChapter,
    injuryVisibleChapters,
    ruleValueByChapter,
    secret: { protagonistSeesAtChapters, shenWeiEverSees },
    stalePropagation: {
      markedChapters: [...propagation.markedChapters],
      untouchedChapters: [...propagation.untouchedChapters],
      baselineCleanAfter,
    },
    rebuild: {
      canonUnchanged: rebuildCanonUnchanged,
      manifestByteStable: rebuildManifestStable,
      projectionFingerprintStable: rebuildFingerprintStable,
      queriesIdenticalPostRebuild: rebuildQueriesIdentical,
    },
    compile: {
      // 落盘为稳定键序美化 JSON，键序与内存对象不同——按 canonicalJson 结构等价
      receiptOnDiskMatches: canonicalJson(persisted) === canonicalJson(receipt),
      // chapter_writing 任务恒带章锚；缺省 0 会被下游断言当场击穿
      receiptChapterIndex: receipt.chapterIndex ?? 0,
      structuralSections,
      settingIdentifiers,
      neverCardPresent:
        settingIdentifiers.includes(HEIYI) || packet.text.includes('神秘人') || packet.text.includes('来历成谜'),
      detectedOffAliasActivated: settingIdentifiers.includes(SWORD),
      parseFailureCount: receipt.parseFailures.length,
      totalTokens: receipt.totalTokens,
    },
  }
}
