/**
 * LocalDataPlane——双平面数据面的测试接缝（Testing Decisions 三接缝之一）：
 * 打开书（投影版本守卫）/ 基线核对 / 全量吸收重建 / 章节相位机（T3）。
 * EXTERNAL_MODIFIED 五态协议的完整接线归 T5 对账票。
 */
import { existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BookRecord, KnowledgeState, TemporalFact } from '@mozhou/kernel'
import Database from 'better-sqlite3'
import {
  commitChapter,
  createChapterDraft,
  recoverPendingCommit,
  reopenChapter,
  splitByReconciliationSurface,
  type ChapterCommitResult,
  type ChapterDraftPaths,
  type ChapterReopenResult,
  type CommitChapterRequest,
  type CreateChapterDraftRequest,
  type PlaneContext,
} from './chapter.js'
import { readCanonState, readBookRecord } from './canon-read.js'
import { assertProjectionVersion, openDatabase } from './database.js'
import {
  isCanonRelPath,
  RUNTIME_DB_PATH,
} from './layout.js'
import { buildManifest, listAllFiles, readManifest, writeManifest, type HashManifest } from './manifest.js'
import { queryActiveFacts as queryActiveFactsFromRoot, queryInvalidatedKnowledgeStates as queryInvalidatedFromRoot } from './narrative-state.js'
import type { QueryActiveFactsRequest } from '@mozhou/kernel'
import { initProjection, populateProjection } from './projection.js'
import { sha256FileHex } from './sha256.js'
import {
  ReconciliationService,
  type BaselineReport,
  type ReconciliationOptions,
} from './reconciliation.js'
export type { BaselineReport } from './reconciliation.js'
import {
  propagateStaleMarkers as propagateStaleMarkersIntoCanon,
  type StalePropagationRequest,
  type StalePropagationResult,
} from './stale.js'

export class ProjectionMissingError extends Error {
  override readonly name = 'ProjectionMissingError'

  constructor(readonly dbPath: string) {
    super(`projection database missing: ${dbPath} — run rebuildProjectionFromCanon()`)
  }
}

function removeProjectionFiles(root: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${join(root, RUNTIME_DB_PATH)}${suffix}`, { force: true })
  }
}

export class LocalDataPlane {
  private constructor(
    readonly root: string,
    private readonly _db: Database.Database,
    private readonly _book: BookRecord,
    /** 相位机操作经此原地刷新基线，getter 恒读到最新值。 */
    private readonly _ctx: PlaneContext,
  ) {}

  /**
   * 打开一本书：先做 pending-commit 崩溃恢复（无日志零开销），manifest 基线必须
   * 就位，投影打开即过 assertProjectionVersion（不符即抛
   * ProjectionVersionMismatchError，由上层触发全量重建）；
   * 投影文件缺失抛 ProjectionMissingError。
   */
  static open(root: string): LocalDataPlane {
    recoverPendingCommit(root)
    const manifest = readManifest(root)
    const dbPath = join(root, RUNTIME_DB_PATH)
    if (!existsSync(dbPath)) {
      throw new ProjectionMissingError(dbPath)
    }
    const db = openDatabase({ path: dbPath })
    try {
      assertProjectionVersion(db)
      return new LocalDataPlane(root, db, readBookRecord(root), { root, db, manifest })
    } catch (error) {
      db.close()
      throw error
    }
  }

  get book(): BookRecord {
    return this._book
  }

  get db(): Database.Database {
    return this._db
  }

  get manifest(): HashManifest {
    return this._ctx.manifest
  }

  /**
   * 启动必检的确定性内核（watcher/对账接线归 T5）：盘上现状 vs 基线，
   * 并按 S2 给出对账面分面——只有 phase=committed 的正文章修改触发对账。
   */
  verifyBaseline(): BaselineReport {
    const modified: string[] = []
    const missing: string[] = []
    for (const [rel, entry] of Object.entries(this._ctx.manifest.files)) {
      const absolutePath = join(this.root, rel)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(absolutePath)
      } catch {
        missing.push(rel)
        continue
      }
      if (stat.size !== entry.bytes || sha256FileHex(absolutePath) !== entry.sha256) {
        modified.push(rel)
      }
    }

    const untracked = listAllFiles(this.root).filter((rel) => isCanonRelPath(rel) && !(rel in this._ctx.manifest.files))

    // S2：草稿自由改不入面；缺失文件无法读相位，保守全入面
    const split = splitByReconciliationSurface(this.root, modified)
    return {
      modified: modified.sort(),
      missing: missing.sort(),
      untracked,
      reconcileSurface: [...split.reconcile, ...missing.sort()].sort(),
      draftFreeEdits: [...split.freeDraftEdits].sort(),
    }
  }

  /** T3：建章草稿（章大纲节点 + draft 正文两件落盘 + 登记基线）。 */
  createChapterDraft(request: CreateChapterDraftRequest): ChapterDraftPaths {
    return createChapterDraft(this._ctx, request)
  }

  /** T3：原子提交三件套——正文相位翻转（线性化点）+ 追踪流增量 + 事件行。 */
  commitChapter(request: CommitChapterRequest): ChapterCommitResult {
    return commitChapter(this._ctx, request)
  }

  /** T3：应用内重编辑已提交章节 ⇒ 移回 draft，旧 commit 痕迹永不改写（I5）。 */
  reopenChapter(chapterIndex: number): ChapterReopenResult {
    return reopenChapter(this._ctx, chapterIndex)
  }

  /**
   * T4：结构化查询芯（#7 冻结形态 `queryActiveFacts(chapter, entityIds, pov)`）——
   * 第 chapter 章时点上、对 pov 视角可见的活跃事实。秘密门禁零泄漏：
   * 未授权视角的结果集与「秘密不存在」不可区分。
   */
  queryActiveFacts(request: QueryActiveFactsRequest): TemporalFact[] {
    return queryActiveFactsFromRoot(this.root, request)
  }

  /**
   * T6 / I3：知识状态级联失效查询——引用 status=rejected 事实的认知行
   * （按 id 确定序）。UI 重验清单与影响报告的直接输入。
   */
  queryInvalidatedKnowledgeStates(): KnowledgeState[] {
    return queryInvalidatedFromRoot(this.root)
  }

  /**
   * T6 / I2：上游变更 → 下游 stale 传播——命中章的章大纲节点获得
   * StaleMarker{reason, upstreamRefs, markedAt}，正文零触碰（验收②）。
   * 这是保护位工件唯一的合法自动写入通道（附加元数据，不改内容）。
   */
  propagateStaleMarkers(request: StalePropagationRequest): StalePropagationResult {
    return propagateStaleMarkersIntoCanon(this._ctx, request)
  }

  /** 对账终态后由 ReconciliationService 调用：从盘上重载基线（S4 吸收后保持 getter 一致）。 */
  reloadManifest(): void {
    this._ctx.manifest = readManifest(this.root)
  }

  /**
   * T5：外部修改五态对账服务（本平面单例；options 仅首次生效）。
   * 应用壳在 open 后先 scanExternalModifications('startupScan')，再按需 startWatcher。
   */
  reconciliation(options: ReconciliationOptions = {}): ReconciliationService {
    if (this._reconciliation === null) {
      this._reconciliation = new ReconciliationService(this, options)
    }
    return this._reconciliation
  }
  private _reconciliation: ReconciliationService | null = null

  close(): void {
    this._reconciliation?.stopWatcher()
    this._db.close()
  }
}

/**
 * Full-Absorption Rebuild（Q14 恢复三权分立之一）：
 * 纯确定性扫描 MD/JSONL → 从零重造投影 → 重立 hash 基线。
 * 零 LLM、零触碰 canon 文件；结构违例宁败不脏（readCanonState 抛错）。
 */
export function rebuildProjectionFromCanon(root: string): void {
  const state = readCanonState(root)

  removeProjectionFiles(root)
  const db = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
  try {
    initProjection(db)
    populateProjection(db, state)
  } finally {
    db.close()
  }

  // 重立基线（S4：基线只记应用自己的写入；canon 未变则与旧基线逐字节相同）
  writeManifest(root, buildManifest(root, state.book.id))
}
