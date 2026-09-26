/**
 * L1 确定性生命周期台架（ADR-0016 初版，实现票 #27）。
 *
 * 合成多章生命周期——空间移动 / 受伤 / 秘密揭示 / 规则突变 / 承诺回收——
 * 驱动三接缝黑盒跑通：LocalDataPlane（相位机 + 查询芯 + stale 传播）、
 * ContextCompiler.compile()、rebuildProjectionFromCanon（删库重建幂等）。
 * 全程 hermetic：一次性临时目录，零外部服务、零 LLM、零真实时钟；
 * 台架自身不做断言——只采集三接缝外部面的观测值，由测试文件对照。
 *
 * L1 规格锚（spec-mozhou-novel-os-2.0.md §Testing Decisions 2）：50 章合成
 * 生命周期（Ch.01–Ch.50：空间移动 / 受伤 / 秘密揭示 / 规则突变 / 伏笔兑现 /
 * 删库重建）全程 <5s 跑完。章事件编排集中在 buildChapterScripts：
 * 第一幕（1–6）保持初版语义不变，第二幕（7–50）把六类母题拉伸到 50 章规模，
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
  TemporalFact,
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
/** 第二幕新增场景位（50 章弧的空间移动终点之一）。 */
const MOYUAN = 'location:mo-yuan' as EntityRef

/** 手工铸造 26 位 Crockford base32 数字段（数字合法）——跨运行确定且过 ULID 校验。 */
const slot = (n: number): string => String(n).padStart(26, '0')
const ruleFactId = factId(102)
/** 第 5 章开启、第 30 章闭合的「灵气复苏」版规则（第二次突变的上游 id）。 */
const revivedRuleFactId = factId(107)

/** 三条伏笔的冻结身份（引入章 / 目标兑现章）——50 章弧上跨幕回收。 */
const PROMISE_NIGHT_SONG: PromiseSpec = { description: '听雨剑夜鸣之谜', introducedChapter: 1, targetChapter: 6 }
const PROMISE_SWORD_ORIGIN: PromiseSpec = { description: '听雨剑来历之谜', introducedChapter: 10, targetChapter: 40 }
const PROMISE_RULE_COLLAPSE: PromiseSpec = { description: '天规崩解之谜', introducedChapter: 30, targetChapter: 50 }

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

/** 伏笔的冻结身份（50 章弧上三条伏笔各自引入章 / 目标兑现章）。 */
interface PromiseSpec {
  readonly description: string
  readonly introducedChapter: number
  readonly targetChapter: number
}

function promiseRow(
  bookId: BookId,
  n: number,
  spec: PromiseSpec,
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
    description: spec.description,
    introducedChapter: spec.introducedChapter,
    targetChapter: spec.targetChapter,
    status,
    payoffNotes,
  }
}

/* ----------------------------------------------------------------------------
 * 章脚本：第一幕（1–6）冻结骨架 + 第二幕（7–50）扩模
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

/** 完整 50 章编排：第一幕 1–6（初版语义原样）+ 第二幕 7–50。 */
function buildChapterScripts(bookId: BookId): ChapterScript[] {
  return [...firstActScripts(bookId), ...secondActScripts(bookId)]
}

/** 第一幕（1–6）：初版六幕生命周期，逐行冻结不随扩模改动。 */
function firstActScripts(bookId: BookId): ChapterScript[] {
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
        narrativePromise: [promiseRow(bookId, 301, PROMISE_NIGHT_SONG, 'introduced', null)],
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
          promiseRow(bookId, 301, PROMISE_NIGHT_SONG, 'paid_off', '第6章 剑鸣引出魔渊入口，伏笔兑现'),
        ],
      },
    },
  ]
}

/* ----------------------------------------------------------------------------
 * 第二幕（7–50）：把六类母题拉伸到 50 章规模
 *
 * 每章至少一条时间线行（worldTimeOrder = 章序，天然严格递增且 > 第一幕末序 3），
 * 于是「50 章」不是空洞填充：每章都真实穿过 commitChapter 的提交期语义门禁
 *（行形状 / 引用完整性 / M2 时间线单调）。章内事实按弧设计分布：
 * 空间移动八段区间、伤情三起三落、第二秘密（揭密前零泄漏）、第二次规则突变、
 * 第二/第三条伏笔、道具易主与归主。
 * -------------------------------------------------------------------------- */

interface ArcKnowledge {
  readonly id: number
  readonly fact: FactId
  readonly holder: KnowledgeHolder
  readonly knownSinceChapter: number
}

interface ArcPromiseRow {
  readonly id: number
  readonly spec: PromiseSpec
  readonly status: 'introduced' | 'paid_off'
  readonly notes: string | null
}

/** 弧上单章声明（声明面 → ChapterScript 的机械装配见 secondActScripts）。 */
interface ArcChapter {
  readonly index: number
  readonly title: string
  readonly summary: string
  readonly participants: readonly EntityRef[]
  readonly locationRef?: EntityRef
  /** 本章事实增量（含区间闭合行：同 id + revision+1，末行胜出折叠）。 */
  readonly facts: readonly FactSpec[]
  /** 本章授予的认知行（秘密门禁的授权侧）。 */
  readonly knowledge?: readonly ArcKnowledge[]
  /** 本章落盘的伏笔行。 */
  readonly promises?: readonly ArcPromiseRow[]
  /** 本章编译时读到的上游版本钉版（第二幕只钉世界规则）。 */
  readonly pins?: readonly Pin[]
}

function secondActScripts(bookId: BookId): ChapterScript[] {
  // 第一幕既有事实 id（第二幕的区间闭合行要引用它们）
  const fShan4 = factId(106)
  const fRuleRevived = revivedRuleFactId
  // 第二幕新增事实 id
  const fSeclusion = factId(108)
  const fOwnerLin = factId(109)
  const fYuan1 = factId(110)
  const fJian3 = factId(111)
  const fShan5 = factId(112)
  const fYuan2 = factId(113)
  const fShan6 = factId(114)
  const fRuleCollapsed = factId(115)
  const fSecretHeiyi = factId(116)
  const fInjury2 = factId(117)
  const fHealed2 = factId(118)
  const fInjury3 = factId(119)
  const fHealed3 = factId(120)
  const fOwnerShen = factId(121)
  const fOwnerLin2 = factId(122)

  // 第 7–29 章编译时读到的是「灵气复苏」版规则（rev 0）：第二次规则突变后应被标记。
  const pinRevived: readonly Pin[] = [{ kind: 'temporalFact', id: fRuleRevived, revision: 0 }]
  // 第 30 章起读到的是「天规崩解」版规则（rev 0）：第二次规则突变对其豁免（钉新版）。
  const pinCollapsed: readonly Pin[] = [{ kind: 'temporalFact', id: fRuleCollapsed, revision: 0 }]

  const chapters: readonly ArcChapter[] = [
    /* ── 幕二·出关与启程（7–14）：灵气复苏后的世界 ── */
    {
      index: 7,
      title: '出关',
      summary: '林枫闭关三日而出，听雨剑归鞘',
      participants: [LIN],
      locationRef: SHAN,
      pins: pinRevived,
      facts: [
        { id: fSeclusion, chapterIndex: 7, subject: LIN, predicate: '状态', value: '闭关', validFrom: 7 },
        { id: fOwnerLin, chapterIndex: 7, subject: SWORD, predicate: '持有者', value: LIN, validFrom: 7 },
      ],
    },
    {
      index: 8,
      title: '夜渡魔渊',
      summary: '林枫循剑鸣夜渡魔渊入口',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinRevived,
      facts: [
        // 区间闭合：第 7 章末离开青云山
        { id: fShan4, chapterIndex: 8, subject: LIN, predicate: '位置', value: SHAN, validFrom: 4, validUntil: 7, revision: 1 },
        { id: fYuan1, chapterIndex: 8, subject: LIN, predicate: '位置', value: MOYUAN, validFrom: 8 },
      ],
    },
    {
      index: 9,
      title: '渊底余响',
      summary: '魔渊深处余响不绝，灵气紊乱',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 10,
      title: '魔渊旧部',
      summary: '黑衣人旧部现身魔渊，其身世成谜',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinRevived,
      facts: [
        { id: fSecretHeiyi, chapterIndex: 10, subject: HEIYI, predicate: 'secret.origin', value: '魔渊旧部', validFrom: 10 },
      ],
      promises: [{ id: 302, spec: PROMISE_SWORD_ORIGIN, status: 'introduced', notes: null }],
    },
    {
      index: 11,
      title: '残卷',
      summary: '渊壁残卷记着封门旧事',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 12,
      title: '剑冢',
      summary: '渊底剑冢森然，听雨剑与之共鸣',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 13,
      title: '出渊',
      summary: '林枫携残卷出渊',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 14,
      title: '涧畔待旦',
      summary: '涧畔待旦，天规余威未散',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinRevived,
      facts: [],
    },

    /* ── 幕三·落雁涧再战（15–24）：伤情第二起落 + 道具易主 ── */
    {
      index: 15,
      title: '重返落雁涧',
      summary: '林枫重返落雁涧查探旧痕',
      participants: [LIN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [
        { id: fYuan1, chapterIndex: 15, subject: LIN, predicate: '位置', value: MOYUAN, validFrom: 8, validUntil: 14, revision: 1 },
        { id: fJian3, chapterIndex: 15, subject: LIN, predicate: '位置', value: JIAN, validFrom: 15 },
      ],
    },
    {
      index: 16,
      title: '涧底旧痕',
      summary: '涧底旧痕犹在，剑鸣再起',
      participants: [LIN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 17,
      title: '夜袭',
      summary: '魔渊余党夜袭涧底',
      participants: [LIN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 18,
      title: '再负重伤',
      summary: '林枫夜战再负重伤',
      participants: [LIN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [
        { id: fSeclusion, chapterIndex: 18, subject: LIN, predicate: '状态', value: '闭关', validFrom: 7, validUntil: 17, revision: 1 },
        { id: fInjury2, chapterIndex: 18, subject: LIN, predicate: '状态', value: '重伤', validFrom: 18 },
      ],
    },
    {
      index: 19,
      title: '血战涧底',
      summary: '沈巍驰援，血战涧底',
      participants: [LIN, SHEN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 20,
      title: '听雨易主',
      summary: '林枫托听雨剑于沈巍',
      participants: [LIN, SHEN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [
        { id: fOwnerLin, chapterIndex: 20, subject: SWORD, predicate: '持有者', value: LIN, validFrom: 7, validUntil: 19, revision: 1 },
        { id: fOwnerShen, chapterIndex: 20, subject: SWORD, predicate: '持有者', value: SHEN, validFrom: 20 },
      ],
    },
    {
      index: 21,
      title: '托剑',
      summary: '托剑之后，林枫空手疗伤',
      participants: [LIN, SHEN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 22,
      title: '旧伤渐愈',
      summary: '涧底旧伤渐愈',
      participants: [LIN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [
        { id: fInjury2, chapterIndex: 22, subject: LIN, predicate: '状态', value: '重伤', validFrom: 18, validUntil: 22, revision: 1 },
      ],
    },
    {
      index: 23,
      title: '沈巍传信',
      summary: '沈巍传信，山门重开在即',
      participants: [LIN, SHEN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [
        { id: fHealed2, chapterIndex: 23, subject: LIN, predicate: '状态', value: '痊愈', validFrom: 23 },
      ],
    },
    {
      index: 24,
      title: '归途',
      summary: '二人启程归山',
      participants: [LIN],
      locationRef: JIAN,
      pins: pinRevived,
      facts: [],
    },

    /* ── 幕四·青云议事与天规崩解（25–34）：第二秘密揭晓 + 第二次规则突变 ── */
    {
      index: 25,
      title: '山门重开',
      summary: '林枫回到青云山，得知黑衣人真实来历',
      participants: [LIN],
      locationRef: SHAN,
      pins: pinRevived,
      facts: [
        { id: fJian3, chapterIndex: 25, subject: LIN, predicate: '位置', value: JIAN, validFrom: 15, validUntil: 24, revision: 1 },
        { id: fShan5, chapterIndex: 25, subject: LIN, predicate: '位置', value: SHAN, validFrom: 25 },
      ],
      knowledge: [{ id: 402, fact: fSecretHeiyi, holder: 'protagonist', knownSinceChapter: 25 }],
    },
    {
      index: 26,
      title: '师兄叙旧',
      summary: '师兄弟叙旧，谈及剑冢残卷',
      participants: [LIN, SHEN],
      locationRef: SHAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 27,
      title: '青云议事',
      summary: '青云宗议事，正道诸事待定',
      participants: [LIN, SHEN, SECT],
      locationRef: SHAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 28,
      title: '密议',
      summary: '掌门与林枫密议封门之策',
      participants: [LIN, SECT],
      locationRef: SHAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 29,
      title: '山雨欲来',
      summary: '灵气再度紊乱，山雨欲来',
      participants: [LIN],
      locationRef: SHAN,
      pins: pinRevived,
      facts: [],
    },
    {
      index: 30,
      title: '天规崩解',
      summary: '天地规则二次异变，复苏灵气崩解为乱流',
      participants: [LIN, MOYAN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [
        { id: fRuleRevived, chapterIndex: 30, subject: TIANGUI, predicate: '规则', value: '灵气复苏', validFrom: 5, validUntil: 29, riskClass: 'high', revision: 1 },
        { id: fRuleCollapsed, chapterIndex: 30, subject: TIANGUI, predicate: '规则', value: '天规崩解', validFrom: 30, riskClass: 'high' },
      ],
      promises: [{ id: 303, spec: PROMISE_RULE_COLLAPSE, status: 'introduced', notes: null }],
    },
    {
      index: 31,
      title: '秩序崩坏',
      summary: '崩解之下，修行秩序崩坏',
      participants: [LIN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 32,
      title: '宗门应变',
      summary: '青云宗结阵自保',
      participants: [LIN, SECT],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 33,
      title: '魔潮',
      summary: '魔渊乱流外溢成潮',
      participants: [LIN, MOYAN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 34,
      title: '断后',
      summary: '林枫断后，决意再入魔渊',
      participants: [LIN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },

    /* ── 幕五·再入魔渊与收束（35–50）：伏笔回收 + 闭环 ── */
    {
      index: 35,
      title: '再入魔渊',
      summary: '林枫再入魔渊封门',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [
        { id: fShan5, chapterIndex: 35, subject: LIN, predicate: '位置', value: SHAN, validFrom: 25, validUntil: 34, revision: 1 },
        { id: fYuan2, chapterIndex: 35, subject: LIN, predicate: '位置', value: MOYUAN, validFrom: 35 },
      ],
    },
    {
      index: 36,
      title: '渊底恶战',
      summary: '渊底恶战，林枫第三次重伤',
      participants: [LIN, MOYAN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [
        { id: fHealed2, chapterIndex: 36, subject: LIN, predicate: '状态', value: '痊愈', validFrom: 23, validUntil: 35, revision: 1 },
        { id: fInjury3, chapterIndex: 36, subject: LIN, predicate: '状态', value: '重伤', validFrom: 36 },
      ],
    },
    {
      index: 37,
      title: '魔女归位',
      summary: '魔焰归位，以魔渊之力护住林枫',
      participants: [LIN, MOYAN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 38,
      title: '旧部现身',
      summary: '黑衣人旧部现身渊口',
      participants: [LIN, HEIYI],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 39,
      title: '封门之议',
      summary: '封门之议既定，只待剑鸣',
      participants: [LIN, MOYAN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 40,
      title: '剑鸣来历',
      summary: '听雨剑鸣引出剑冢来历，伏笔兑现',
      participants: [LIN, SHEN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [],
      promises: [{ id: 302, spec: PROMISE_SWORD_ORIGIN, status: 'paid_off', notes: '第40章 剑鸣来历揭晓，伏笔兑现' }],
    },
    {
      index: 41,
      title: '渊口血战',
      summary: '渊口血战，魔潮被阻',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 42,
      title: '伤愈',
      summary: '第三次重伤渐愈',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [
        { id: fInjury3, chapterIndex: 42, subject: LIN, predicate: '状态', value: '重伤', validFrom: 36, validUntil: 42, revision: 1 },
      ],
    },
    {
      index: 43,
      title: '元婴初成',
      summary: '崩解乱流中林枫元婴初成',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [
        { id: fHealed3, chapterIndex: 43, subject: LIN, predicate: '状态', value: '元婴初成', validFrom: 43 },
      ],
    },
    {
      index: 44,
      title: '出渊',
      summary: '林枫功成出渊',
      participants: [LIN],
      locationRef: MOYUAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 45,
      title: '剑归其主',
      summary: '沈巍归还听雨剑，二人同返青云',
      participants: [LIN, SHEN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [
        { id: fYuan2, chapterIndex: 45, subject: LIN, predicate: '位置', value: MOYUAN, validFrom: 35, validUntil: 44, revision: 1 },
        { id: fShan6, chapterIndex: 45, subject: LIN, predicate: '位置', value: SHAN, validFrom: 45 },
        { id: fOwnerShen, chapterIndex: 45, subject: SWORD, predicate: '持有者', value: SHEN, validFrom: 20, validUntil: 44, revision: 1 },
        { id: fOwnerLin2, chapterIndex: 45, subject: SWORD, predicate: '持有者', value: LIN, validFrom: 45 },
      ],
    },
    {
      index: 46,
      title: '山门灯火',
      summary: '山门灯火重明',
      participants: [LIN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 47,
      title: '重整旗鼓',
      summary: '青云宗重整旗鼓',
      participants: [LIN, SECT],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 48,
      title: '魔渊回响',
      summary: '崩解余波自魔渊回响',
      participants: [LIN, MOYAN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 49,
      title: '封门之战',
      summary: '封门之战在即',
      participants: [LIN, MOYAN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
    },
    {
      index: 50,
      title: '闭环',
      summary: '魔渊封门，天规崩解之谜收束，弧闭环',
      participants: [LIN, MOYAN, SHEN],
      locationRef: SHAN,
      pins: pinCollapsed,
      facts: [],
      promises: [{ id: 303, spec: PROMISE_RULE_COLLAPSE, status: 'paid_off', notes: '第50章 魔渊封门，天规崩解之谜收束' }],
    },
  ]

  return chapters.map((chapter) => {
    const appends: Partial<Record<TrackingKind, readonly unknown[]>> = {
      timelineEvent: [
        timelineRow(
          bookId,
          200 + chapter.index,
          chapter.index,
          chapter.index,
          chapter.title,
          chapter.participants,
          chapter.facts.map((spec) => spec.id),
          chapter.locationRef,
        ),
      ],
    }
    if (chapter.facts.length > 0) {
      appends.temporalFact = chapter.facts.map((spec) => factRow(bookId, spec))
    }
    if (chapter.knowledge !== undefined) {
      appends.knowledgeState = chapter.knowledge.map((entry) =>
        knowledgeRow(bookId, entry.id, entry.fact, entry.holder, entry.knownSinceChapter),
      )
    }
    if (chapter.promises !== undefined) {
      appends.narrativePromise = chapter.promises.map((entry) =>
        promiseRow(bookId, entry.id, entry.spec, entry.status, entry.notes),
      )
    }
    return {
      index: chapter.index,
      title: chapter.title,
      summary: chapter.summary,
      appends,
      ...(chapter.pins === undefined ? {} : { pins: chapter.pins }),
    }
  })
}

/* ----------------------------------------------------------------------------
 * 观测面：全部来自三接缝的外部返回值
 * -------------------------------------------------------------------------- */

export interface LifecycleBenchReport {
  readonly durationMs: number
  readonly chaptersCommitted: readonly number[]
  /** 每章经 commitChapter 追加的行数合计（「无空洞章」不变量的观测面）。 */
  readonly appendsPerChapter: Readonly<Record<number, number>>
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
  /** 50 章弧的锚点探针（第二幕扩模后才存在；第一幕探针保持原样）。 */
  readonly arc: {
    /** 空间移动锚点（含区间闭合端点）→ 主体位置值。 */
    readonly locationByAnchor: Readonly<Record<number, string>>
    /** 主角「状态」事实在全弧 ch1..50 的可见章。 */
    readonly statusVisibleChapters: readonly number[]
    /** 两次规则突变前后的世界规则值（含末章稳态）。 */
    readonly ruleValueByAnchor: Readonly<Record<number, string>>
    /** 道具持有者锚点（20 章易主、45 章归主）。 */
    readonly swordOwnerByAnchor: Readonly<Record<number, string>>
    /** 第二秘密：揭密前零泄漏 + 揭密首章 + 未授权视角全程零泄漏。 */
    readonly secondSecret: {
      readonly leakedBeforeReveal: readonly number[]
      readonly firstVisibleChapter: number
      readonly visibleAtFinalChapter: boolean
      readonly shenWeiEverSees: boolean
    }
    /** 未授权视角在 ch1..50 任一章看到任何 secret.* 的章集合（零泄漏硬断言面）。 */
    readonly unauthorizedLeakChapters: readonly number[]
  }
  /** 伏笔流经 getCanonState 的读面（承诺状态机归其实现票，此处只观测行）。 */
  readonly promiseStream: {
    readonly rows: number
    readonly introducedRows: number
    readonly paidOffRows: number
    /** 兑现行的目标章（弧锚：6 / 40 / 50）。 */
    readonly paidOffTargets: readonly number[]
  }
  readonly stalePropagation: {
    readonly markedChapters: readonly number[]
    readonly untouchedChapters: readonly number[]
    /** 传播自吸收后启动必检必须干净（自己的标记不是外部修改）。 */
    readonly baselineCleanAfter: boolean
    /** 第二次规则突变（灵气复苏 → 天规崩解）的传播面。 */
    readonly secondMutation: {
      readonly markedChapters: readonly number[]
      readonly untouchedChapters: readonly number[]
      readonly baselineCleanAfter: boolean
    }
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
  /** 50 章累积状态上的第二次编译（第 51 章；累积规模是 L1 的真实考点）。 */
  readonly compileAtFifty: {
    readonly receiptOnDiskMatches: boolean
    readonly receiptChapterIndex: number
    readonly structuralSections: readonly string[]
    readonly settingIdentifiers: readonly string[]
    readonly neverCardPresent: boolean
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
    createEntityCard(ctx, MOYUAN, { name: '魔渊', aiContext: 'detected', brief: '渊底封着旧日魔气' })
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

  // ── 50 章生命周期：全部行为只经 LocalDataPlane 接缝 ──
  let plane = LocalDataPlane.open(root)
  const chaptersCommitted: number[] = []
  const appendedTotals: Record<string, number> = {}
  const appendsPerChapter: Record<number, number> = {}
  for (const script of buildChapterScripts(bookId)) {
    plane.createChapterDraft({ chapterIndex: script.index, title: script.title })
    const result = plane.commitChapter({
      chapterIndex: script.index,
      summary: script.summary,
      appends: script.appends,
      dependencyManifest: { entries: script.pins ?? [] },
    })
    chaptersCommitted.push(result.chapterIndex)
    let appendedHere = 0
    for (const [kind, count] of Object.entries(result.appendedCounts)) {
      appendedTotals[kind] = (appendedTotals[kind] ?? 0) + (count ?? 0)
      appendedHere += count ?? 0
    }
    appendsPerChapter[result.chapterIndex] = appendedHere
  }

  // ── 幕间行为观测：结构化查询芯（POV / 秘密零泄漏在返回值上判定）──
  const ALL_CHAPTERS: readonly number[] = Array.from({ length: 50 }, (_, i) => i + 1)
  const probeFacts = (chapter: number, pov: PovEntity, subject: EntityRef): TemporalFact[] =>
    plane.queryActiveFacts({ chapter, pov, entityIds: [subject] })

  const behaviorProbes = (): string[] => [
    locationValueAt(2),
    locationValueAt(4),
    locationValueAt(25),
    locationValueAt(45),
    injuryVisibleChapters.join(','),
    ruleValueAt(4),
    ruleValueAt(5),
    ruleValueAt(30),
    ruleValueAt(50),
    swordOwnerAt(20),
    swordOwnerAt(45),
    secretVisibleChapters('protagonist').join(','),
    secondSecretVisibleChapters.join(','),
    unauthorizedLeakChapters.join(','),
    statusVisibleChapters.join(','),
    JSON.stringify(plane.queryActiveFacts({ chapter: 6, pov: 'protagonist' }).map((fact) => fact.id)),
    JSON.stringify(plane.queryActiveFacts({ chapter: 50, pov: 'protagonist' }).map((fact) => fact.id)),
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

  function swordOwnerAt(chapter: number): string {
    return probeFacts(chapter, 'protagonist', SWORD)
      .filter((fact) => fact.predicate === '持有者')
      .map((fact) => String(fact.value))
      .sort()
      .join('|')
  }

  const secretVisible = (chapter: number, pov: PovEntity): boolean =>
    plane
      .queryActiveFacts({ chapter, pov, entityIds: [MOYAN] })
      .some((fact) => fact.predicate.startsWith('secret.'))
  function secretVisibleChapters(pov: PovEntity): number[] {
    return [3, 4, 5, 6].filter((chapter) => secretVisible(chapter, pov))
  }
  const protagonistSeesAtChapters = secretVisibleChapters('protagonist')
  const shenWeiEverSees = secretVisibleChapters(SHEN as PovEntity).length > 0

  // ── 50 章弧探针：第二秘密（黑衣人）+ 空间移动锚点 + 道具易主/归主 ──
  const secretHeiyiVisible = (chapter: number, pov: PovEntity): boolean =>
    plane
      .queryActiveFacts({ chapter, pov, entityIds: [HEIYI] })
      .some((fact) => fact.predicate.startsWith('secret.'))

  /** 第二秘密对主角的可见章（主角是唯一被授权视角；揭密章之前必须为空集）。 */
  const secondSecretVisibleChapters = ALL_CHAPTERS.filter((chapter) => secretHeiyiVisible(chapter, 'protagonist'))

  /** 未授权视角（沈巍）跨两个秘密、全 50 章的泄漏面：零泄漏硬断言面。 */
  const unauthorizedLeakChapters = ALL_CHAPTERS.filter(
    (chapter) => secretVisible(chapter, SHEN as PovEntity) || secretHeiyiVisible(chapter, SHEN as PovEntity),
  )

  const statusVisibleChapters = ALL_CHAPTERS.filter((chapter) =>
    probeFacts(chapter, 'protagonist', LIN).some((fact) => fact.predicate === '状态'),
  )

  const locationByAnchor: Record<number, string> = {}
  for (const chapter of [7, 8, 14, 15, 24, 25, 34, 35, 44, 45, 50]) {
    locationByAnchor[chapter] = locationValueAt(chapter)
  }
  const ruleValueByAnchor: Record<number, string> = {
    29: ruleValueAt(29),
    30: ruleValueAt(30),
    50: ruleValueAt(50),
  }
  const swordOwnerByAnchor: Record<number, string> = {}
  for (const chapter of [7, 19, 20, 44, 45, 50]) {
    swordOwnerByAnchor[chapter] = swordOwnerAt(chapter)
  }

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

  // ── 第二次规则突变（第 5 章开启的「灵气复苏」在第 30 章被闭合为 rev 1）：
  //    第 7–29 章编译时钉的是 rev 0 ⇒ 应被标记；第 30 章起钉的是「天规崩解」
  //    （另一 id）⇒ 必须豁免。50 章规模下的「命中精确到版」不变量。 ──
  const secondPropagation = plane.propagateStaleMarkers({
    reason: 'upstream_canon_changed',
    upstreamChanges: [{ kind: 'temporalFact', id: revivedRuleFactId, revision: 1 }],
    markedAt: NOW,
  })
  const baselineAfterSecondPropagation = plane.verifyBaseline()
  const baselineCleanAfterSecondMutation =
    baselineAfterSecondPropagation.modified.length === 0 &&
    baselineAfterSecondPropagation.missing.length === 0 &&
    baselineAfterSecondPropagation.untracked.length === 0

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

  // ── 第三接缝 · 50 章规模复测：第 51 章在整弧累积正典上的召回与装配 ──
  const receiptIdAtFifty = `rcpt_${slot(778)}` as ContextReceiptId
  const compiledAtFifty = await compile({
    task: { type: 'chapter_writing', chapterIndex: 51 },
    bookRoot: root,
    bookId,
    draftText: '林枫自魔渊归来，重返落雁涧，涧底天规崩解余波未平，听雨剑归鞘后再度轻鸣。',
    cards: scanEntityCards(root),
    snapshot: readNarrativeSnapshot(root),
    scope: { chapterIndex: 51, pov: 'protagonist' },
    structural: {
      sections: [{ section: 'author_intent', content: '写一部修仙长卷：空间移动、旧伤、秘密与承诺都要有回响。' }],
    },
    storyText: ['第五十章末尾切片：魔渊封门，山门灯火重明。'],
    modelProfile: { id: 'l1-deterministic-mock', contextWindow: 100000 },
    tokenizer: charTok,
    receiptId: receiptIdAtFifty,
    nowIso: NOW,
  })

  // ── 伏笔流读面（承诺状态机归其实现票；此处只观测行，判定零泄漏/回收的机械事实）──
  const promiseRows = plane
    .getCanonState()
    .trackingLines.narrativePromise.map((line) => JSON.parse(line.payload) as { status?: unknown; targetChapter?: unknown })
  plane.close()

  const { packet, receipt } = compiled
  const structuralSections = packet.structural.map((piece) => piece.section)
  const settingIdentifiers = packet.settings.map((entry) => entry.identifier).sort()
  const persisted = loadReceipt(root, receipt.id)

  const packetAtFifty = compiledAtFifty.packet
  const receiptAtFifty = compiledAtFifty.receipt
  const settingIdentifiersAtFifty = packetAtFifty.settings.map((entry) => entry.identifier).sort()

  return {
    chaptersCommitted,
    appendsPerChapter,
    appendedTotals,
    locationByChapter,
    injuryVisibleChapters,
    ruleValueByChapter,
    secret: { protagonistSeesAtChapters, shenWeiEverSees },
    arc: {
      locationByAnchor,
      statusVisibleChapters,
      ruleValueByAnchor,
      swordOwnerByAnchor,
      secondSecret: {
        leakedBeforeReveal: secondSecretVisibleChapters.filter((chapter) => chapter < 25),
        firstVisibleChapter: secondSecretVisibleChapters[0] ?? 0,
        visibleAtFinalChapter: secretHeiyiVisible(50, 'protagonist'),
        shenWeiEverSees: ALL_CHAPTERS.some((chapter) => secretHeiyiVisible(chapter, SHEN as PovEntity)),
      },
      unauthorizedLeakChapters,
    },
    promiseStream: {
      rows: promiseRows.length,
      introducedRows: promiseRows.filter((row) => row.status === 'introduced').length,
      paidOffRows: promiseRows.filter((row) => row.status === 'paid_off').length,
      paidOffTargets: promiseRows
        .filter((row) => row.status === 'paid_off')
        .map((row) => (typeof row.targetChapter === 'number' ? row.targetChapter : 0))
        .sort((a, b) => a - b),
    },
    stalePropagation: {
      markedChapters: [...propagation.markedChapters],
      untouchedChapters: [...propagation.untouchedChapters],
      baselineCleanAfter,
      secondMutation: {
        markedChapters: [...secondPropagation.markedChapters],
        untouchedChapters: [...secondPropagation.untouchedChapters],
        baselineCleanAfter: baselineCleanAfterSecondMutation,
      },
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
    compileAtFifty: {
      receiptOnDiskMatches: canonicalJson(loadReceipt(root, receiptAtFifty.id)) === canonicalJson(receiptAtFifty),
      receiptChapterIndex: receiptAtFifty.chapterIndex ?? 0,
      structuralSections: packetAtFifty.structural.map((piece) => piece.section),
      settingIdentifiers: settingIdentifiersAtFifty,
      neverCardPresent:
        settingIdentifiersAtFifty.includes(HEIYI) ||
        packetAtFifty.text.includes('神秘人') ||
        packetAtFifty.text.includes('来历成谜'),
      detectedOffAliasActivated: settingIdentifiersAtFifty.includes(SWORD),
      parseFailureCount: receiptAtFifty.parseFailures.length,
      totalTokens: receiptAtFifty.totalTokens,
    },
  }
}
