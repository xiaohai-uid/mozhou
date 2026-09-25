/**
 * Compile 步衔接（T16 · #40；chapter-pipeline-spec S3）。
 *
 * 复用 compile() 缝签名不变（A 芯纪律）：管线只做输入组合——
 *   - task 恒为 {type:'CHAPTER_DRAFTING', chapterIndex}（#8 tier 表受控增补档）；
 *   - Prepare 结果集携带 StaleMarker ⇒ 追加确定性 stale_warning 结构层段：
 *     警告继续、留痕进 Receipt（packet.structural + entries + replayInputs
 *     摘要全链可见）——对账软门禁先例，绝不因此阻塞或改写装配语义；
 *   - 其余编译输入（目录卡/快照/模型面）由组合根供给，本模块不重复扫描。
 *
 * Compile 后恢复按 receiptId 续（INV-R1/R2 既有）：指针事件存在即凭证必在盘上，
 * 恢复方经 projection.lastReceiptId + loadReceipt 取回产物，不重编译。
 *
 * 依赖钉版产出（D06 · ADR-0003 §2.1）：编译成功即把「本次真正入包的版本化实体」
 * 落成 DependencyManifest 暂存（.mozhou/dependency-manifests/，运行时区非 canon），
 * 提交方按章回读钉进 ChapterCommitted 行——依赖图因此有生产侧数据源。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDependencyManifest } from '@mozhou/kernel';
import type {
  BookId,
  ContextReceipt,
  ContextReceiptId,
  DependencyManifest,
  DependencyManifestEntry,
  FactId,
  KnowledgeStateId,
  NarrativeStateSnapshot,
  RelationshipStateId,
  StaleMarker,
  TimelineEventId,
} from '@mozhou/kernel';
import {
  compile,
  loadReceipt,
} from '@mozhou/context-compiler';
import type {
  AssemblyModelProfile,
  BudgetAssemblyConfig,
  CompileCard,
  ContextPacket,
  ExactTokenizer,
  GraphRecallScope,
  KhopRecallConfig,
  LocalEmbeddingProvider,
  PersistedReceiptLocation,
  StructuralSection,
} from '@mozhou/context-compiler';

export interface CompileStepRequest {
  /** 书根：Receipt 一证一文件的落盘锚点。 */
  readonly bookRoot: string;
  readonly bookId: BookId;
  /** 草稿/场景原文（keyword 与 embedding 通道共同输入；Draft 步前的占位语义归 T17）。 */
  readonly draftText: string;
  readonly cards: readonly CompileCard[];
  readonly snapshot: NarrativeStateSnapshot;
  readonly scope: GraphRecallScope;
  /** 基础结构层段（Author Intent / 任务框架等）；stale_warning 段追加其后。 */
  readonly structuralSections?: readonly StructuralSection[];
  readonly storyText?: readonly string[];
  readonly modelProfile: AssemblyModelProfile;
  readonly tokenizer?: ExactTokenizer;
  readonly embedding?: LocalEmbeddingProvider;
  readonly config?: BudgetAssemblyConfig;
  readonly recallConfig?: KhopRecallConfig;
  /** 测试确定性注入：缺省铸新 ULID / 取当前时钟。 */
  readonly receiptId?: ContextReceiptId;
  readonly nowIso?: string;
}

export interface CompileStepOutcome {
  readonly packet: ContextPacket;
  readonly receipt: ContextReceipt;
  readonly location: PersistedReceiptLocation;
  /** 本次编译留痕进 Receipt 的 stale 警告（S2 软门禁；空数组 = 无标记）。 */
  readonly staleWarnings: readonly StaleMarker[];
  /** 本次编译真正入包的版本化实体钉版（D06；空清单 = 未消费任何版本化实体）。 */
  readonly dependencyManifest: DependencyManifest;
}

/** stale 留痕段的 section 标识（Receipt diff 按 identifier 对齐）。 */
export const STALE_WARNING_SECTION = 'stale_warning';

/** 由 StaleMarker 合成确定性警告文本：字段拼接 + 上游引用升序，同标记必同文。 */
export function renderStaleWarningContent(marker: StaleMarker): string {
  const refs = [...marker.upstreamRefs]
    .map((entry) => `${entry.kind}:${entry.id}:r${entry.revision}`)
    .sort();
  return ['reason=' + marker.reason, 'markedAt=' + marker.markedAt, ...refs].join('\n');
}

function staleWarningSections(markers: readonly (StaleMarker | null)[]): {
  sections: StructuralSection[];
  warnings: StaleMarker[];
} {
  const sections: StructuralSection[] = [];
  const warnings: StaleMarker[] = [];
  for (const marker of markers) {
    if (marker === null) {
      continue;
    }
    warnings.push(marker);
    sections.push({ section: STALE_WARNING_SECTION, content: renderStaleWarningContent(marker) });
  }
  return { sections, warnings };
}

/* ---------------------------------------------------------------------------
 * 依赖钉版：组装（Receipt × 编译时快照）+ 提交前暂存
 * ------------------------------------------------------------------------- */

/** 钉版暂存目录（运行时区，非 canon、不参与对账；镜像候选区落点先例）。 */
export const PENDING_DEPENDENCY_MANIFEST_DIR = '.mozhou/dependency-manifests';

/** 暂存文件相对路径；chapterIndex 先校验，杜绝路径穿越。 */
export function pendingDependencyManifestPath(chapterIndex: number): string {
  if (!Number.isInteger(chapterIndex) || chapterIndex < 1) {
    throw new Error(`chapterIndex must be a positive integer, got ${chapterIndex}`);
  }
  return `${PENDING_DEPENDENCY_MANIFEST_DIR}/ch${chapterIndex}.json`;
}

/**
 * 单条候选 id → 版本化实体（Q14 的 {kind, id, revision} 三字段）。
 * 按 id 反查编译时快照（不做前缀嗅探）：目录卡 EntityRef 与快照外的 id
 * （如承诺）不是内核版本化实体 ⇒ null（清单形状只认 EntityKind）。
 */
function versionedEntryOf(snapshot: NarrativeStateSnapshot, id: string): DependencyManifestEntry | null {
  const fact = snapshot.facts.get(id as FactId);
  if (fact !== undefined) return { kind: 'temporalFact', id, revision: fact.revision };
  const knowledge = snapshot.knowledgeStates.get(id as KnowledgeStateId);
  if (knowledge !== undefined) return { kind: 'knowledgeState', id, revision: knowledge.revision };
  const relationship = snapshot.relationships.get(id as RelationshipStateId);
  if (relationship !== undefined) return { kind: 'relationshipState', id, revision: relationship.revision };
  const event = snapshot.timelineEvents.get(id as TimelineEventId);
  if (event !== undefined) return { kind: 'timelineEvent', id, revision: event.revision };
  return null;
}

/**
 * 依赖钉版组装（D06 / ADR-0003 §2.1）：清单 = 本次编译**真正入包**的实体。
 * - 入包判据：Receipt 条目 included=true 且来自装配阶段（reserve/converge）——
 *   被预算淘汰者（converge 出局、recall_filter 透传）没进 prompt，不算「编译时读到」；
 * - 版本面取自**编译时快照**（此刻的 revision 才是钉版语义），非提交时回读；
 * - 同 id 多条目收敛一条，保持 Receipt 条目序（同输入必得同清单）。
 */
export function buildDependencyManifest(
  receipt: ContextReceipt,
  snapshot: NarrativeStateSnapshot,
): DependencyManifest {
  const pinned = new Map<string, DependencyManifestEntry>();
  for (const entry of receipt.entries) {
    if (!entry.included || (entry.stage !== 'reserve' && entry.stage !== 'converge')) continue;
    const versioned = versionedEntryOf(snapshot, entry.identifier);
    if (versioned === null) continue;
    const key = `${versioned.kind}:${versioned.id}`;
    if (!pinned.has(key)) pinned.set(key, versioned);
  }
  return { entries: [...pinned.values()] };
}

/**
 * 钉版暂存：编译成功即写盘——提交时点已无编译时快照，Receipt 本身不载 revision，
 * 暂存是钉版跨「生成→提交」两请求的唯一载体。写失败原样抛出（宁败不脏）。
 */
export function persistPendingDependencyManifest(
  bookRoot: string,
  chapterIndex: number,
  manifest: DependencyManifest,
): void {
  mkdirSync(join(bookRoot, PENDING_DEPENDENCY_MANIFEST_DIR), { recursive: true });
  writeFileSync(join(bookRoot, pendingDependencyManifestPath(chapterIndex)), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * 钉版回读：无暂存 = 本章未经编译（手写章 / 结构层降级）⇒ null，提交方按「无钉版」提交。
 * 有暂存但形状非法 ⇒ 抛 DependencyManifestError（静默丢弃钉版 = 影响分析静默失明）。
 */
export function readPendingDependencyManifest(bookRoot: string, chapterIndex: number): DependencyManifest | null {
  const path = join(bookRoot, pendingDependencyManifestPath(chapterIndex));
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { entries?: unknown } | null;
  return parseDependencyManifest(parsed?.entries);
}

/**
 * Compile 步执行：Prepare 结果集 + 组合根输入 → compile() → Receipt 一证一文件。
 * compile() 缝签名不变——失败路径（EmptyRecallError/ConvergenceError/配置错误）
 * 原样穿透，绝不降级静默。
 */
export async function runCompileStep(
  prepared: {
    readonly chapterIndex: number;
    /** 目标章大纲节点的 stale 标记（Prepare 结果集携带）。 */
    readonly staleMarker: StaleMarker | null;
  },
  request: CompileStepRequest,
): Promise<CompileStepOutcome> {
  const { sections: warningSections, warnings } = staleWarningSections([prepared.staleMarker]);

  const result = await compile({
    task: { type: 'CHAPTER_DRAFTING', chapterIndex: prepared.chapterIndex },
    bookRoot: request.bookRoot,
    bookId: request.bookId,
    draftText: request.draftText,
    cards: request.cards,
    snapshot: request.snapshot,
    scope: request.scope,
    structural: { sections: [...(request.structuralSections ?? []), ...warningSections] },
    ...(request.storyText === undefined ? {} : { storyText: request.storyText }),
    modelProfile: request.modelProfile,
    ...(request.tokenizer === undefined ? {} : { tokenizer: request.tokenizer }),
    ...(request.embedding === undefined ? {} : { embedding: request.embedding }),
    ...(request.config === undefined ? {} : { config: request.config }),
    ...(request.recallConfig === undefined ? {} : { recallConfig: request.recallConfig }),
    ...(request.receiptId === undefined ? {} : { receiptId: request.receiptId }),
    ...(request.nowIso === undefined ? {} : { nowIso: request.nowIso }),
  });

  // 钉版取「入包条目 × 编译时快照」，随即暂存——提交路径据此钉 ChapterCommitted 行。
  const dependencyManifest = buildDependencyManifest(result.receipt, request.snapshot);
  persistPendingDependencyManifest(request.bookRoot, prepared.chapterIndex, dependencyManifest);

  return {
    packet: result.packet,
    receipt: result.receipt,
    location: result.location,
    staleWarnings: warnings,
    dependencyManifest,
  };
}

/** Compile 后恢复：按 receiptId 从盘上取回凭证（INV-R1/R2；不重编译）。 */
export function loadReceiptForResume(bookRoot: string, receiptId: ContextReceiptId): ContextReceipt {
  return loadReceipt(bookRoot, receiptId);
}
