/**
 * 章节正文存取路由（发布评审 R1/R2 修复 · 预期版本契约）：
 * POST /api/chapter.prose        {root, chapterIndex}
 *   → 章快照 {exists, revision, phase, commitId?, body}；作者实际读取内容的来源。
 * POST /api/chapter.prose.save   {root, chapterIndex, body, expectedRevision, title?}
 *   → Accept → Active Draft。expectedRevision:null=仅新建（章已存在 409）；
 *     数字=必须等于盘上 revision（不等 409 PROSE_REVISION_CONFLICT）。
 *     外部改盘由数据平面写前哈希拒绝（409 PROSE_EXTERNAL_CHANGE）；
 *     committed 章普通保存 409（CHAPTER_COMMITTED）——重开必须走显式
 *     /api/chapter.reopen（复用 reopenChapter：写前哈希 + ChapterReopened 事件 +
 *     基线刷新），本路由绝不静默降级或自动重开。冲突路径零磁盘变更。
 *   语义：phase 恒 draft；Commit 仍只经管线质量门后的 commitChapter。
 * 不触碰 Protected Author Content 以外的任何正典工件。
 *
 * 步 6-10 提交编排单一事实源（工单04 2026-09-28）：/api/chapter.commit 的编排规则已收进
 * packages/pipeline/src/commit-orchestration.ts（runChapterCommit）——本路由只保留输入解码、
 * 身份/书权限与响应契约映射；提取缝（真实模型调用）与 StyleLearner 窗口闭合钩子在此注入，
 * web_commit_* 窗口键形状冻结。以下各步接线注释描述的行为语义不变，实现归属以管线 module 为准。
 *
 * 提交幂等契约（工单05 Contract Delta 2026-09-28）：POST /api/chapter.commit 请求
 * {root, chapterIndex, summary, expectedRevision, usage?}——expectedRevision 为作者实际
 * 读取的章版本（/api/chapter.prose 读回的 revision），形状照搬 /api/chapter.prose.save
 * 冻结契约（必填整数 >= 0；缺失/非法 400）。与盘上 revision 失配 ⇒ 409
 * PROSE_REVISION_CONFLICT {expectedRevision, currentRevision}（与 prose.save 同码同形），
 * 在提取缝（真实模型调用）之前拒绝：模型调用增量 0，正文/正典/账本零写入。
 *
 * 步 9 S9 重提交接线（chapter-pipeline-spec §1 表第 9 行 / S9）：
 * 重提交**不与作者编辑用的 /api/chapter.reopen 混用**——reopen 保持它原本的语义
 * （可重复的底层重开：写前哈希 + ChapterReopened 事件 + 基线刷新，不开会话窗口），
 * S9 走独立入口 POST /api/chapter.resubmit → requestResubmit
 * （packages/pipeline/src/resubmit.ts）：
 *   1. committed 前置守卫：非 committed（草稿/从未提交）在**任何盘面副作用之前**
 *      以 ResubmitNotCommittedError 拒绝；盘上无此章仍按契约 404 CHAPTER_MISSING。
 *   2. 开新会话窗口：ChapterProductionSession.start 新 taskRef、光标 prepare，
 *      V1 十步全量重走（S9）。同章已有活动窗口 / 别章占用全局单飞 → 409
 *      RESUBMIT_SESSION_CONFLICT（守卫先于翻相位，拒绝零盘面副作用）。
 *   3. 重提交期间的真相锚：响应 truthAnchor = 最近一次 ChapterCommitted 事件行的
 *      {commitId, contentSha256, proseRelPath}（latestCommittedTruth 以事件行为锚，
 *      **不读已翻回 draft 的正文文件**）；重提交完成后真相由新 commit 前移。
 *   有相位无匹配事件行 = 账实不符：显式 500 失败（宁败不猜），绝不返回假锚。
 *   I5：旧 commit 的物理痕迹（追踪流行 + ChapterCommitted 事件行）只增不改。
 * 该会话窗口按 S9 设计由本会话第 9 步 CanonCommitted 或 TaskFinished 闭合。窗口的
 * 闭合路径自工单 03（2026-09-28）起分两种形态（详见下方步 9 收口注释）：
 *   - 完成收口：作者把会话走到 user_edit 及之后（/api/session.advance 与
 *     /api/chapter.review 驱动步 2-5），/api/chapter.commit 即沿十步驱动窗口走完
 *     步 6-10（步 7 门禁 verdict 随 TaskStepTransitioned Result 字段进账），以
 *     TaskFinished{outcome:'succeeded'} 闭合——走完的窗口不再需要 abandon；
 *   - 作废收口：未被行走的窗口（光标停在 prepare..review）在作者重新定稿后就地
 *     作废（POST /api/session.abandon 或提交出口的 resubmitWindowCleanup）。
 * 两条路径都在 findOpenSessionWindow 视角下真正关闭窗口并释放 V1 全局单飞；
 * reopen 走数据平面相位机、不查会话账本，故作者编辑旅程始终不受影响。
 *
 * 步 5 User Edit 接线（chapter-pipeline-spec §1 表第 5 行 / S4）：
 * /api/chapter.prose.save 在权威写路径（saveProseDraft：预期版本 + 写前哈希 + 定稿
 * 保护，契约不动）落定之后，把「作者这次保存改了什么」折算成结构化操作块并落
 * UserEditRecorded（recordWholeBodyAuthorEdit）——作者写作层提交的是一整篇正文，
 * 故块由行级 diff 推导（发布侧 removedText 盖章 / deltaStats 口径复用管线单一事实源）。
 *   - 窗口键与提交侧同源（webCommitWindowTaskRef = web_commit_ch<N>_rev<R>，R = 窗口闭合时的
 *     盘上 revision）。窗口键只认**恰在 R 上**落的那一条（学习器按 taskRef 精确匹配），
 *     故每次保存落的是**本窗口累计编辑链**（自上次提交/重开起的全部编辑，可依序应用到
 *     窗口基线）：作者改完再原样重存一次（revision 照常 +1）时窗口信号不会被挤出窗口键，
 *     多次小增量保存也不会各自低于学习器 Nmin=10 而判零。此前每窗口读到零条编辑。
 *     链密度守卫：本窗口最近一条编辑必须恰是本次保存的前一 revision，否则（外部改盘 /
 *     落账失败 / 跨窗口残留）退化为本次增量，绝不累积陈旧块。
 *   - 新建章基线 = ''（建章占位标题不是作者内容，不算作者删除）；
 *   - 本窗口无任何编辑可落（首次保存即无改动）不落事件（零噪声）；
 *   - 信号是派生面：落账失败不阻断保存（S12 同款降级），响应 authorEditSignal
 *     如实上报（绝不静默）；块推导无法复现正文则整条信号弃用并报错，绝不落假信号。
 *
 * 步 7 Continuity Gate 接线（chapter-pipeline-spec §1 表第 7 行 / S5）：
 * POST /api/chapter.commit 在步 6 提取出五族 delta 后、写正典前插入纯机械核检
 * （四族行形状 + dependency 引用完整性 + M2 时间线单调 + POV 秘密零泄漏）。
 *   通过 → 200，响应带 continuityGate.verdict='pass'；
 *   冲突 → 409 CONTINUITY_HARD_CONFLICT，Result 顶层 hardConflicts[] {factId,
 *   assertion, suggestion} 原样回给作者（回炉 Final Extract 重提取），正典零写入。
 * Gate 读不到存量叙事状态时同样显式失败（500），绝不降级为「跳过门禁」——
 * 跳过门禁等于把未经核检的 delta 盲写正典。
 *
 * 步 8 Canon Proposal 接线（chapter-pipeline-spec §1 表第 8 行 / S6）：
 * 通过 Gate 的 delta 不再直接进 commitChapter——先经 createCanonProposal 按
 * riskClass 三档分流（low 入场即 confirmed；medium 队列挂起；high 必须显式确认），
 * 再由 ProposalPort 逐条 confirm/reject/editAccept 收口，**Commit 只写已确认集**。
 *   - 未决条目 > 0 → 409 CANON_PROPOSAL_PENDING，本章正典零写入、相位不翻转；
 *   - 提案与正文 revision 绑定（taskRef=web_commit_ch<N>_rev<R>）：同一 revision
 *     的重试续接同一提案（不重跑提取、不重复落提案），改文后旧提案显式拒绝
 *     （409 CANON_PROPOSAL_STALE）而非静默丢弃作者的逐条决策；
 *   - 无候选可路由时不落空提案（空 CanonProposalCreated 只会污染悬挂扫描）；
 *   - 落盘时哈希基线失配（正文被外部改过）⇒ 409 PROSE_EXTERNAL_CHANGE，与
 *     /api/prose.save（:384-387）同一条件同一码——漏这条会退化成裸 500 且把英文
 *     内部消息吐给作者（工单 01）。
 * 未决提案的盘面凭据落在 .mozhou/proposals/，跨重启待决（S8 Proposal 后行）。
 *
 * D06 依赖钉版消费（change-impact-engine-spec §2 D06 / ADR-0003 §2.1）：
 * 本章生成时编译步已把「真正入包的版本化实体」暂存于 .mozhou/dependency-manifests/；
 * 本路由在 commitChapter 前按章回读并原样钉进 ChapterCommitted 事件行——
 * 上游变更据此经 findReaders 圈定受影响章（依赖图生产侧数据源）。
 * 无暂存 = 本章未经编译（手写章 / 结构层降级）⇒ 不带清单提交；暂存形状非法则
 * 显式 500 失败，绝不静默丢弃钉版让影响分析失明。
 * 成对账目：本路径**不发射 CanonCommitted**（配对尾）——配对状态活在 PublishBus
 * 单实例内存里，提案头由 createCanonProposal 在「创建它的那个请求」的实例上开，
 * 跨请求续接（作者确认后重提）时该实例已不存在，新实例发尾必抛
 * PAIRING_TAIL_WITHOUT_HEAD。故 web 路径的提交凭据 = 提案记录 state=consumed +
 * 平铺 ChapterCommitted 行；账面上 CanonProposalCreated 无配对尾即本路径真实形状
 * （session 编排路径由 ChapterProductionSession.markCommitted 闭合，不受影响；
 * 投影侧 openHeads 只计窗口内事件，无窗口的 web 路径不会污染会话投影）。
 *
 * 步 10 Flywheel Record 接线（chapter-pipeline-spec §1 表第 10 行 / S12）：
 * commitChapter 落定后（两条提交分支各自调用点）以同一 taskRef 落收尾事件
 * FlywheelRecorded 并写 usage 投影表 .mozhou/usage.jsonl——「每完成窗口恰一条
 * FlywheelRecorded」是 Phase 4 学习器的窗口锚，故空计量也必须落账（recordedCount=0）。
 *   记账失败不阻断正文（S12）：投影写失败 ⇒ 事件 payload outcome=state_degraded、
 *   正文与正典早已落定，响应 flywheelRecord 如实上报降级面（绝不静默）；
 *   usage 事实由请求体可选携带（web 侧尚无 provider 计量，缺省 = 空数组，不造数）；
 *   形状非法在动盘之前 400 拒绝——绝不把未校验载荷写进投影表。
 *   窗口闭合后触发 afterRecord 钩子（T23 · #56 触发点）：StyleLearner 自读本窗口
 *   author 编辑更新派生画像；钩子失败同样不阻断（S12 同款），但错误文本进响应。
 *
 * 步 9 S9 收口（本章补完；工单 03 起完成优先）：/api/chapter.commit 在 commitChapter
 * 落定后（两条提交分支各自调用点）按窗口形态二选一收口——
 *   - 完成收口（驱动路径）：窗口已被作者走到 user_edit 及之后 ⇒ 本次提交沿十步驱动
 *     它走完：步 6 runFinalExtract（web 提取器作注入缝，CandidateDeltaExtracted 以
 *     会话 taskRef 落账）→ 步 7 runContinuityGate（verdict/hardConflicts 随步进事件
 *     Result 字段进账，冲突悬置窗口、正典零写入）→ 步 8 提案步锚（窗口内
 *     CanonProposalCreated 配对头，payload 携带 web 提案 proposalId 作关联）→
 *     步 9 markCommitted → 步 10 finish（TaskFinished{outcome:'succeeded'}）。
 *     走完的窗口不占 abandon 路径；恢复请求发尾事件前 adoptOpenHeads 认领跨请求
 *     悬挂头（TaskStarted / CanonProposalCreated 的 head 只活在发布总线实例内存里）。
 *     响应 sessionWindow 如实呈现驱动结果。
 *   - 作废收口（未行走窗口）：光标停在 prepare..review 的窗口不能被诚实驱动
 *     （步 2-5 的编译/审查工作属其他端点，路由不伪造会话步），就地作废——发布
 *     TaskFinished{outcome:'abandoned', reason:'author_resubmitted'}，释放 V1
 *     全局单飞；**绝不发 CanonCommitted**（完成态语义不动）。
 * 两种收口都是派生面：失败不回退已落定的提交，响应如实上报（sessionWindow /
 * resubmitWindowCleanup，绝不静默）。被拒的提交零副作用（不触发收口）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RouteHandler } from '../router.js'
import {
  CANON_PROPOSAL_PENDING,
  CANON_PROPOSAL_STALE,
  CHAPTER_ALREADY_COMMITTED,
  CHAPTER_COMMITTED,
  CHAPTER_EXISTS,
  CHAPTER_MISSING,
  CHAPTER_NOT_COMMITTED,
  CONTINUITY_HARD_CONFLICT,
  INVALID_BOOK_REQUEST,
  PROSE_EXTERNAL_CHANGE,
  PROSE_REVISION_CONFLICT,
  RESUBMIT_SESSION_CONFLICT,
} from '../routeCodes.js'
import { decodeBookRequest } from '../bookRequest.js'
import {
  ChapterExistsError,
  ChapterPhaseError,
  PreWriteHashMismatchError,
  ProseRevisionConflictError,
  proseChapterPath,
  readProseChapter,
  withBook,
} from '@mozhou/data-plane'
import {
  GlobalSingleFlightError,
  ResubmitNotCommittedError,
  SessionAlreadyActiveError,
  recordWholeBodyAuthorEdit,
  requestResubmit,
  runChapterCommit,
  webCommitWindowTaskRef,
} from '@mozhou/pipeline'
import type {
  UsageFact,
} from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'
import { runStyleLearnerForWindow } from '@mozhou/flywheel'
import { extractChapterDelta } from '../analysis/deltaExtractor.js'
import { resolveGenerationTarget } from '../llm/generationTarget.js'
import {
  canonProposalView,
  pendingItemViewsOf,
} from '../proposals.js'

/**
 * web 路径的窗口键 `web_commit_ch<N>_rev<R>` 的生成器已随提交编排收口（工单04）
 * 移至 @mozhou/pipeline（webCommitWindowTaskRef）——提交路径与保存路径的编辑信号
 * 必须同源（runStyleLearnerForWindow 按 taskRef 精确匹配本窗口），键形状冻结不改。
 */

/**
 * 保存路径编辑信号在响应里的呈现面（派生面失败不阻断保存，但必须可见）。
 * 形状单一事实源在此（发射端）；UI 契约镜像见 server/api.ts 的
 * ChapterProseSaveAuthorEditSignal（跨文件 import 会与 api.ts → proseRoutes 形成
 * 文件级循环，故按既有 FlywheelRecordView 先例在两侧各自声明并互相指向）。
 */
interface AuthorEditSignalView {
  /** 本窗口没有任何编辑可落（首次保存即无改动）时为 false——零噪声不落事件。 */
  readonly published: boolean
  /** 本次落账的本窗口累计编辑块数（未落账为 0）。 */
  readonly blocks: number
  readonly errorDetail: string | null
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** usage 事实的合法键集（UsageFact 冻结形状；未知键一律拒绝，不做透传）。 */
const USAGE_FACT_KEYS: readonly string[] = [
  'kind',
  'provider',
  'model',
  'inputTokens',
  'outputTokens',
  'costMicros',
]

interface MutableUsageFact {
  kind: 'usage' | 'cost'
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costMicros?: number
}

/**
 * 请求体 usage 事实的形状校验：缺省/null = 无计量（合法）；形状非法返回 null
 * 由路由 400 拒绝。计数字段只收非负整数——投影表是成本审计面，宁可拒绝也不
 * 让负数/小数/字符串混进账。
 */
function parseUsageFacts(raw: unknown): UsageFact[] | null {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return null
  const facts: UsageFact[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    const kind = row['kind']
    if (kind !== 'usage' && kind !== 'cost') return null
    if (Object.keys(row).some((key) => !USAGE_FACT_KEYS.includes(key))) return null
    const fact: MutableUsageFact = { kind }
    for (const key of ['provider', 'model'] as const) {
      const value = row[key]
      if (value === undefined) continue
      if (typeof value !== 'string' || value.length === 0) return null
      fact[key] = value
    }
    for (const key of ['inputTokens', 'outputTokens', 'costMicros'] as const) {
      const value = row[key]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
      fact[key] = value
    }
    facts.push(fact)
  }
  return facts
}

export const proseRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot, principal }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

  if (path === '/api/chapter.prose') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    try {
      const chapter = withBook(root, (plane) => plane.getProseChapter(chapterIndex))
      json(200, {
        ok: true,
        exists: true,
        chapterIndex: chapter.chapterIndex,
        revision: chapter.revision,
        phase: chapter.phase,
        commitId: chapter.commitId,
        body: chapter.body,
      })
    } catch (cause) {
      if (isEnoent(cause)) {
        json(200, { ok: true, exists: false, chapterIndex })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/chapter.prose.save') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const rawBody = typeof body['body'] === 'string' ? body['body'] : null
    const title = typeof body['title'] === 'string' ? body['title'] : undefined
    // 契约显式：expectedRevision 必须在场（null=新建语义），杜绝旧客户端静默覆盖
    const rawExpected = body['expectedRevision']
    const expectedRevision = rawExpected === null
      ? null
      : typeof rawExpected === 'number' && Number.isInteger(rawExpected) && rawExpected >= 0
        ? rawExpected
        : undefined
    // 作者显式确认覆盖外部修改（仅在 expectedRevision 匹配 + 写前哈希失配时被数据平面采纳）
    const confirmExternalOverwrite = body['confirmExternalOverwrite'] === true ? true : undefined
    if (rawBody === null || rawBody.trim() === '' || expectedRevision === undefined) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'root, chapterIndex, non-empty body and expectedRevision (integer >= 0 or null) required' })
      return true
    }
    try {
      withBook(root, (plane) => {
        // 作者编辑信号的基线：更新语义 = 盘上当前正文（作者读取后据以改写）；
        // 新建语义 = ''（建章占位标题不是作者内容，作者实际从空白起笔）。
        // 读取失败（盘上缺章）由 saveProseDraft 同款抛 ENOENT → 外层 404，零写入。
        const beforeBody = expectedRevision === null
          ? ''
          : readProseChapter(root, proseChapterPath(chapterIndex)).body
        const result = plane.saveProseDraft({ chapterIndex, body: rawBody, expectedRevision, title, confirmExternalOverwrite })
        // 步 5 User Edit 接线：保存已由受守卫的权威写路径落定，编辑信号是派生面——
        // 落账失败不阻断保存（S12 同款降级），但必须在响应里可见（绝不静默）。
        // taskRef 与提交侧窗口锚同源（webCommitWindowTaskRef），否则 StyleLearner 读不到。
        let authorEditSignal: AuthorEditSignalView
        try {
          const outcome = recordWholeBodyAuthorEdit({
            bus: new PublishBus(),
            bookRoot: root,
            taskRef: webCommitWindowTaskRef(chapterIndex, result.revision),
            chapterIndex,
            beforeBody,
            afterBody: rawBody,
            revision: result.revision,
          })
          authorEditSignal = { published: outcome.published, blocks: outcome.blocks.length, errorDetail: null }
        } catch (cause) {
          authorEditSignal = { published: false, blocks: 0, errorDetail: (cause as Error).message }
        }
        json(200, {
          ok: true,
          chapterIndex: result.chapterIndex,
          revision: result.revision,
          phase: result.phase,
          created: result.created,
          authorEditSignal,
        })
      })
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        // committed 章拒绝普通保存；带出 commitId 供界面呈现定稿身份
        let commitId: string | null = null
        try {
          commitId = withBook(root, (plane) => plane.getProseChapter(chapterIndex).commitId ?? null)
        } catch {
          commitId = null
        }
        json(409, { ok: false, code: CHAPTER_COMMITTED, commitId, error: (cause as Error).message })
        return true
      }
      if (cause instanceof ProseRevisionConflictError) {
        json(409, {
          ok: false,
          code: PROSE_REVISION_CONFLICT,
          expectedRevision: cause.expectedRevision,
          currentRevision: cause.currentRevision,
          error: (cause as Error).message,
        })
        return true
      }
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: PROSE_EXTERNAL_CHANGE, error: '磁盘内容已被外部修改（或与基线不一致）——拒绝静默覆盖，请先读取最新内容' })
        return true
      }
      if (cause instanceof ChapterExistsError) {
        json(409, { ok: false, code: CHAPTER_EXISTS, error: '章节已存在（并发新建？）——请先读取后按更新语义保存' })
        return true
      }
      if (isEnoent(cause)) {
        json(404, { ok: false, code: CHAPTER_MISSING, error: `chapter ${chapterIndex} not found on disk` })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/chapter.reopen') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    try {
      const result = withBook(root, (plane) => plane.reopenChapter(chapterIndex))
      json(200, {
        ok: true,
        chapterIndex: result.chapterIndex,
        reopenedFromCommitId: result.reopenedFromCommitId,
        proseRelPath: result.proseRelPath,
      })
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        json(409, { ok: false, code: CHAPTER_NOT_COMMITTED, error: '章节不是 committed 态——无定稿可重开' })
        return true
      }
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: PROSE_EXTERNAL_CHANGE, error: '定稿文件已被外部修改——拒绝重开，请先人工核对外部改动' })
        return true
      }
      if (isEnoent(cause)) {
        json(404, { ok: false, code: CHAPTER_MISSING, error: `chapter ${chapterIndex} not found on disk` })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/chapter.resubmit') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    try {
      // 盘上无此章保持 CHAPTER_MISSING 404 语义——守卫的 ResubmitNotCommittedError
      // 分不出「无章」与「有章非 committed」，故先判存在性再进管线（只做错误码分层）。
      if (!existsSync(join(root, proseChapterPath(chapterIndex)))) {
        json(404, { ok: false, code: CHAPTER_MISSING, error: `chapter ${chapterIndex} not found on disk` })
        return true
      }
      const outcome = requestResubmit({ bus: new PublishBus(), root, chapterIndex })
      json(200, {
        ok: true,
        chapterIndex,
        reopenedFromCommitId: outcome.reopenedFromCommitId,
        proseRelPath: outcome.proseRelPath,
        // 重提交期间的真相锚：事件行锚（latestCommittedTruth），不读已翻回 draft 的正文文件
        truthAnchor: outcome.truthAnchor,
        // 新 taskRef 新会话窗口：光标停在 prepare，V1 十步全量重走（S9）
        resubmitSession: { taskRef: outcome.session.taskRef, currentStep: outcome.session.currentStep },
      })
    } catch (cause) {
      if (cause instanceof ResubmitNotCommittedError) {
        json(409, { ok: false, code: CHAPTER_NOT_COMMITTED, error: '章节不是 committed 态——无定稿可重提交' })
        return true
      }
      if (cause instanceof SessionAlreadyActiveError || cause instanceof GlobalSingleFlightError) {
        // 单飞双守卫在翻相位之前拒绝：正文相位与盘面零变更（S11）
        json(409, { ok: false, code: RESUBMIT_SESSION_CONFLICT, error: (cause as Error).message })
        return true
      }
      if (cause instanceof ChapterPhaseError) {
        json(409, { ok: false, code: CHAPTER_NOT_COMMITTED, error: '章节不是 committed 态——无定稿可重提交' })
        return true
      }
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: PROSE_EXTERNAL_CHANGE, error: '定稿文件已被外部修改——拒绝重提交，请先人工核对外部改动' })
        return true
      }
      if (isEnoent(cause)) {
        json(404, { ok: false, code: CHAPTER_MISSING, error: `chapter ${chapterIndex} not found on disk` })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/chapter.commit') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const summary = typeof body['summary'] === 'string' && body['summary'].trim().length > 0
      ? body['summary'].trim()
      : `第 ${chapterIndex} 章定稿`

    // 工单05 Contract Delta：expectedRevision 必须在场（作者实际读取的章版本，与
    // /api/chapter.prose.save 的冻结契约同构——commit 无新建语义，故不收 null）。
    // 缺失/非法在动盘之前 400 拒绝，杜绝旧客户端静默提交作者未读过的正文。
    const rawExpected = body['expectedRevision']
    const expectedRevision = typeof rawExpected === 'number' && Number.isInteger(rawExpected) && rawExpected >= 0
      ? rawExpected
      : null
    if (expectedRevision === null) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'expectedRevision (integer >= 0) required — the chapter revision the author last read' })
      return true
    }

    // 步 10 的 usage 事实：形状非法在动盘之前拒绝（后续分支都已提交成功，
    // 那时才发现形状非法只能吞掉或回滚——两者都不可接受）。
    const usageFacts = parseUsageFacts(body['usage'])
    if (usageFacts === null) {
      json(400, {
        ok: false,
        code: INVALID_BOOK_REQUEST,
        error:
          'usage must be an array of {kind:"usage"|"cost", provider?, model?, ' +
          'inputTokens?, outputTokens?, costMicros?} (non-negative integers, no unknown keys)',
      })
      return true
    }

    try {
      // 步 6-10 编排已收进管线边界（工单04 · packages/pipeline/src/commit-orchestration.ts）：
      // 相位守卫、依赖钉版回读、窗口键、提案续接/stale/待决规则、门禁两道、commitChapter
      // 收口、飞轮记账、会话驱动与作废收口全部是 module 侧单一实现——路由只保留输入解码、
      // 身份/书权限与响应契约映射。提取缝（真实模型调用）与 StyleLearner 窗口闭合钩子在
      // 此注入（依赖方向：pipeline 不 import web 提取器与 flywheel）；web_commit_* 窗口键
      // 形状冻结不变。
      const outcome = await runChapterCommit({
        root,
        chapterIndex,
        summary,
        expectedRevision,
        usage: usageFacts,
        extractDelta: ({ bookId, chapterIndex: extractChapter, prose }) =>
          extractChapterDelta(root, bookId, extractChapter, prose, {
            // 工单06：提取与草稿走同一个解析缝（注册表 → BYOK → 带原因 Unavailable），
            // 注册表-only 部署的提取不再回落 BYOK 或静默失败；hosted 下按 principal 隔离。
            resolveTarget: (env) =>
              resolveGenerationTarget({ taskType: 'FINAL_EXTRACT', principal: principal ?? undefined, env }),
          }),
        afterRecord: ({ taskRef }) => {
          runStyleLearnerForWindow({ bus: new PublishBus(), bookRoot: root, taskRef, chapterIndex })
        },
      })
      if (outcome.kind === 'proposal_stale') {
        const stale = outcome.staleProposals
        json(409, {
          ok: false,
          code: CANON_PROPOSAL_STALE,
          chapterIndex,
          proposalId: stale[0]!.proposalId,
          error:
            `第 ${chapterIndex} 章存在描述旧正文的未决提案（正文 revision 已变）——` +
            '请先 /api/proposal.discard 收口旧提案，再提交本章；本章正典零写入',
          staleProposals: stale.map(canonProposalView),
        })
        return true
      }
      if (outcome.kind === 'gate_conflict') {
        json(409, {
          ok: false,
          code: CONTINUITY_HARD_CONFLICT,
          chapterIndex,
          ...(outcome.proposalId === null ? {} : { proposalId: outcome.proposalId }),
          error: `连续性门禁未通过：${outcome.hardConflicts.length} 项硬冲突——本章正典零写入`,
          hardConflicts: outcome.hardConflicts,
          ...(outcome.deltaExtraction === null ? {} : { deltaExtraction: outcome.deltaExtraction }),
        })
        return true
      }
      if (outcome.kind === 'proposal_pending') {
        const pending = pendingItemViewsOf(outcome.record)
        json(409, {
          ok: false,
          code: CANON_PROPOSAL_PENDING,
          chapterIndex,
          proposalId: outcome.record.proposalId,
          error:
            `正典提案待确认：${pending.length} 项未决（high 必须显式确认，medium 等队列确认）` +
            '——本章正典零写入',
          proposal: canonProposalView(outcome.record),
          pendingItems: pending,
          ...(outcome.deltaExtraction === null ? {} : { deltaExtraction: outcome.deltaExtraction }),
        })
        return true
      }
      json(200, {
        ok: true,
        commitId: outcome.commitId,
        chapterIndex: outcome.chapterIndex,
        contentSha256: outcome.contentSha256,
        phase: 'committed',
        continuityGate: { verdict: 'pass' },
        canonProposal: outcome.canonProposal === null ? null : canonProposalView(outcome.canonProposal),
        ...(outcome.deltaExtraction === null ? {} : { deltaExtraction: outcome.deltaExtraction }),
        flywheelRecord: outcome.flywheelRecord,
        sessionWindow: outcome.sessionWindow,
        resubmitWindowCleanup: outcome.resubmitWindowCleanup,
      })
    } catch (cause) {
      // 工单 01：与 /api/prose.save（:384-387）同一物理条件、同一错误码。漏这条时作者看到的是
      // 裸 500 + 英文内部消息（无 code 字段），无法据此行动——违反 AGENTS.md 规则 15。
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: PROSE_EXTERNAL_CHANGE, error: '磁盘内容已被外部修改（或与基线不一致）——拒绝静默覆盖，请先读取最新内容' })
        return true
      }
      if (cause instanceof ChapterPhaseError) {
        json(409, { ok: false, code: CHAPTER_ALREADY_COMMITTED, error: (cause as Error).message })
        return true
      }
      // 工单05 Contract Delta：作者所读 revision 已过期（他端保存/双窗口）——与
      // /api/chapter.prose.save 同码同形（409 PROSE_REVISION_CONFLICT + 双 revision），
      // 本章正文/正典/账本零写入、提取缝零调用（编排层在提取之前比对）。
      if (cause instanceof ProseRevisionConflictError) {
        json(409, {
          ok: false,
          code: PROSE_REVISION_CONFLICT,
          expectedRevision: cause.expectedRevision,
          currentRevision: cause.currentRevision,
          error: (cause as Error).message,
        })
        return true
      }
      if (isEnoent(cause)) {
        json(404, { ok: false, code: CHAPTER_MISSING, error: `chapter ${chapterIndex} not found on disk` })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  return false
}
