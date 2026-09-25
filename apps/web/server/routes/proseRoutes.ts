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
 *   - 无候选可路由时不落空提案（空 CanonProposalCreated 只会污染悬挂扫描）。
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
 */
import type { RouteHandler } from '../router.js'
import { assertSafeBookRoot } from '../security.js'
import {
  ChapterExistsError,
  ChapterPhaseError,
  LocalDataPlane,
  PreWriteHashMismatchError,
  ProseRevisionConflictError,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane'
import {
  ProposalPort,
  confirmedAppendsForCommit,
  createCanonProposal,
  loadCanonProposal,
  readPendingDependencyManifest,
  runContinuityGate,
} from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'
import { extractChapterDelta } from '../analysis/deltaExtractor.js'
import {
  canonProposalView,
  openProposalForTask,
  openProposalsOfChapter,
  pendingItemViewsOf,
} from '../proposals.js'

const CHAPTER_MISSING = 'CHAPTER_MISSING'

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export const proseRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

  if (path === '/api/chapter.prose') {
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (rawRoot === null || chapterIndex === null || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        const chapter = plane.getProseChapter(chapterIndex)
        json(200, {
          ok: true,
          exists: true,
          chapterIndex: chapter.chapterIndex,
          revision: chapter.revision,
          phase: chapter.phase,
          commitId: chapter.commitId,
          body: chapter.body,
        })
      } finally {
        plane.close()
      }
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
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
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
    if (rawRoot === null || chapterIndex === null || rawBody === null || rawBody.trim() === '' || expectedRevision === undefined) {
      json(400, { ok: false, error: 'root, chapterIndex, non-empty body and expectedRevision (integer >= 0 or null) required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        const result = plane.saveProseDraft({ chapterIndex, body: rawBody, expectedRevision, title, confirmExternalOverwrite })
        json(200, {
          ok: true,
          chapterIndex: result.chapterIndex,
          revision: result.revision,
          phase: result.phase,
          created: result.created,
        })
      } finally {
        plane.close()
      }
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        // committed 章拒绝普通保存；带出 commitId 供界面呈现定稿身份
        const plane = LocalDataPlane.openOrRebuild(assertSafeBookRoot(rawRoot))
        try {
          const chapter = plane.getProseChapter(chapterIndex)
          json(409, { ok: false, code: 'CHAPTER_COMMITTED', commitId: chapter.commitId, error: (cause as Error).message })
        } catch {
          json(409, { ok: false, code: 'CHAPTER_COMMITTED', commitId: null, error: (cause as Error).message })
        } finally {
          plane.close()
        }
        return true
      }
      if (cause instanceof ProseRevisionConflictError) {
        json(409, {
          ok: false,
          code: 'PROSE_REVISION_CONFLICT',
          expectedRevision: cause.expectedRevision,
          currentRevision: cause.currentRevision,
          error: (cause as Error).message,
        })
        return true
      }
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: 'PROSE_EXTERNAL_CHANGE', error: '磁盘内容已被外部修改（或与基线不一致）——拒绝静默覆盖，请先读取最新内容' })
        return true
      }
      if (cause instanceof ChapterExistsError) {
        json(409, { ok: false, code: 'CHAPTER_EXISTS', error: '章节已存在（并发新建？）——请先读取后按更新语义保存' })
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
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (rawRoot === null || chapterIndex === null || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        const result = plane.reopenChapter(chapterIndex)
        json(200, {
          ok: true,
          chapterIndex: result.chapterIndex,
          reopenedFromCommitId: result.reopenedFromCommitId,
          proseRelPath: result.proseRelPath,
        })
      } finally {
        plane.close()
      }
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        json(409, { ok: false, code: 'CHAPTER_NOT_COMMITTED', error: '章节不是 committed 态——无定稿可重开' })
        return true
      }
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: 'PROSE_EXTERNAL_CHANGE', error: '定稿文件已被外部修改——拒绝重开，请先人工核对外部改动' })
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
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const summary = typeof body['summary'] === 'string' && body['summary'].trim().length > 0
      ? body['summary'].trim()
      : `第 ${chapterIndex} 章定稿`

    if (rawRoot === null || chapterIndex === null || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }

    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        const proseFile = readProseChapter(root, proseChapterPath(chapterIndex))
        const prose = proseFile.body
        // D06 依赖钉版消费侧：本章生成时编译入包的实体钉版随 ChapterCommitted 行落账，
        // 上游重算据此圈定受影响章。无暂存 = 本章未经编译（手写/结构层降级）⇒ 不带清单，
        // 如实声明「本章不钉任何上游版本」；暂存存在但形状非法则由回读显式抛错（绝不静默丢钉版）。
        const pendingManifest = readPendingDependencyManifest(root, chapterIndex)
        const dependencyManifestFields = pendingManifest === null ? {} : { dependencyManifest: pendingManifest }
        // 步 8 提案与正文 revision 绑定：同一 revision 的提交重试续接同一提案
        // （否则每次重试都重跑提取、再落一份同内容提案，且新提案的行 id 与作者
        // 已确认的行对不上——「只写已确认集」就无从谈起）。
        const taskRef = 'web_commit_ch' + chapterIndex + '_rev' + proseFile.revision
        const port = new ProposalPort({ root })

        let record = openProposalForTask(root, taskRef)
        let deltaExtraction: Record<string, unknown> | null = null

        if (record === null) {
          const stale = openProposalsOfChapter(root, chapterIndex)
          if (stale.length > 0) {
            // 正文已改（revision 变）：盘上未决提案描述的是旧正文。既不能拿旧行写正典，
            // 也不能静默丢弃作者的逐条决策——显式拒绝并给出收口入口。
            json(409, {
              ok: false,
              code: 'CANON_PROPOSAL_STALE',
              chapterIndex,
              proposalId: stale[0]!.proposalId,
              error:
                `第 ${chapterIndex} 章存在描述旧正文的未决提案（正文 revision 已变）——` +
                '请先 /api/proposal.discard 收口旧提案，再提交本章；本章正典零写入',
              staleProposals: stale.map(canonProposalView),
            })
            return true
          }

          // 步 6 Final Extract 接线：终稿 → 五族叙事状态增量。
          // 提取失败不阻塞提交（作者的正文必须能定稿），但必须在响应里如实报出，
          // 否则「提交后叙事层零增长」会被误读为「一切正常」。
          const delta = await extractChapterDelta(root, plane.book.id, chapterIndex, prose)
          deltaExtraction = {
            extractor: delta.extractor,
            counts: delta.counts,
            dropped: delta.dropped,
            ...(delta.reason === undefined ? {} : { reason: delta.reason }),
          }

          if (Object.keys(delta.appends).length === 0) {
            // 无候选可路由：步 8 不落空提案（无内容的 CanonProposalCreated 只会污染
            // 悬挂扫描），直接提交——叙事层零增长由 deltaExtraction 如实报出。
            const result = plane.commitChapter({ chapterIndex, summary, ...dependencyManifestFields })
            json(200, {
              ok: true,
              commitId: result.commitId,
              chapterIndex: result.chapterIndex,
              contentSha256: result.contentSha256,
              phase: 'committed',
              continuityGate: { verdict: 'pass' },
              canonProposal: null,
              deltaExtraction,
            })
            return true
          }

          // 步 7 Continuity Gate：候选 delta 写正典前过机械核检。冲突 = 硬门禁，
          // 提案不落盘、commitChapter 一步不调（正典零写入），冲突清单经 Result 顶层
          // hardConflicts[] 回给作者——回炉重提取是唯一出路，不许静默放行。
          const gate = runContinuityGate({ bookRoot: root, chapterIndex, delta: delta.appends, prose })
          if (gate.verdict === 'hard_conflict') {
            json(409, {
              ok: false,
              code: 'CONTINUITY_HARD_CONFLICT',
              chapterIndex,
              error: `连续性门禁未通过：${gate.hardConflicts.length} 项硬冲突——本章正典零写入`,
              hardConflicts: gate.hardConflicts,
              deltaExtraction,
            })
            return true
          }

          // 步 8 Canon Proposal：riskClass 三档分流（low 入场即 confirmed，medium/high 挂起）。
          const created = createCanonProposal({
            bus: new PublishBus(),
            bookRoot: root,
            taskRef,
            chapterIndex,
            delta: delta.appends,
          })
          record = loadCanonProposal(root, created.proposalId)
          if (record === null) {
            // 刚落盘即读不回 = 盘面故障：绝不降级为「无提案直接提交」把未确认行写进正典
            throw new Error('canon proposal ' + created.proposalId + ' unreadable right after persist')
          }
        }

        // 待决 = 挂起（S6）：medium 等队列确认、high 等显式确认——本章正典零写入、
        // 相位不翻转；提案记录已落盘，跨重启保持待决。
        const pending = pendingItemViewsOf(record)
        if (pending.length > 0) {
          json(409, {
            ok: false,
            code: 'CANON_PROPOSAL_PENDING',
            chapterIndex,
            proposalId: record.proposalId,
            error:
              `正典提案待确认：${pending.length} 项未决（high 必须显式确认，medium 等队列确认）` +
              '——本章正典零写入',
            proposal: canonProposalView(record),
            pendingItems: pending,
            ...(deltaExtraction === null ? {} : { deltaExtraction }),
          })
          return true
        }

        // Commit 只写已确认集（S6）：confirmed + edit_accepted（含 patch 后载荷），
        // rejected 排除在外。ProposalPort 在仍有未决条目时拒读（上方已拦）。
        const appends = confirmedAppendsForCommit(root, record.proposalId)

        // 写前门禁：续接路径的载荷可能经作者 editAccept 改动，写正典前必须重过核检
        // （Gate 是确定性纯核检，幂等重算；此处不通过则提案保持未收口，正典零写入）。
        const confirmedGate = runContinuityGate({ bookRoot: root, chapterIndex, delta: appends, prose })
        if (confirmedGate.verdict === 'hard_conflict') {
          json(409, {
            ok: false,
            code: 'CONTINUITY_HARD_CONFLICT',
            chapterIndex,
            proposalId: record.proposalId,
            error: `连续性门禁未通过：${confirmedGate.hardConflicts.length} 项硬冲突——本章正典零写入`,
            hardConflicts: confirmedGate.hardConflicts,
            ...(deltaExtraction === null ? {} : { deltaExtraction }),
          })
          return true
        }

        const hasAppends = Object.keys(appends).length > 0
        const result = plane.commitChapter({
          chapterIndex,
          summary,
          ...(hasAppends ? { appends } : {}),
          ...dependencyManifestFields,
        })

        // 提案收口：commitChapter 成功之后才翻 consumed——提交失败时作者的逐条决策
        // 必须留在提案记录里供重试，收口过早等于丢弃作者劳动。
        port.markConsumed({ port: 'pipeline', proposalId: record.proposalId })

        json(200, {
          ok: true,
          commitId: result.commitId,
          chapterIndex: result.chapterIndex,
          contentSha256: result.contentSha256,
          phase: 'committed',
          continuityGate: { verdict: 'pass' },
          canonProposal: canonProposalView(loadCanonProposal(root, record.proposalId) ?? record),
          ...(deltaExtraction === null ? {} : { deltaExtraction }),
        })
      } finally {
        plane.close()
      }
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        json(409, { ok: false, code: 'CHAPTER_ALREADY_COMMITTED', error: (cause as Error).message })
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
