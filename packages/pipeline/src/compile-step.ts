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
 */
import type {
  BookId,
  ContextReceipt,
  ContextReceiptId,
  NarrativeStateSnapshot,
  StaleMarker,
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
  LorebookScanEntry,
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
  /** 世界书条目：关键词命中 draftText 即注入 world_rule 层（SillyTavern World Info 对应物）。 */
  readonly lorebook?: readonly LorebookScanEntry[];
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
    ...(request.lorebook === undefined ? {} : { lorebook: request.lorebook }),
    ...(request.receiptId === undefined ? {} : { receiptId: request.receiptId }),
    ...(request.nowIso === undefined ? {} : { nowIso: request.nowIso }),
  });

  return {
    packet: result.packet,
    receipt: result.receipt,
    location: result.location,
    staleWarnings: warnings,
  };
}

/** Compile 后恢复：按 receiptId 从盘上取回凭证（INV-R1/R2；不重编译）。 */
export function loadReceiptForResume(bookRoot: string, receiptId: ContextReceiptId): ContextReceipt {
  return loadReceipt(bookRoot, receiptId);
}
