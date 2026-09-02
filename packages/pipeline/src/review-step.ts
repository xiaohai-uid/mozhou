/**
 * Review 步消费入口（T17 · #41；chapter-pipeline-spec §1 表第 4 行 / S5；
 * ADR-0025 升级：契约从「装载 draft 供核检」扩展为「产出版本绑定的
 * QualityReviewReport」——step id `review` 保留）。
 *
 * 边界纪律：
 * - 本模块只做装载、哈希、装配与报告落盘；裁决全部在 quality-engine 与
 *   Gate（机械）——编排者拿到 outcome 后经 session.recordQualityReview 落账，
 *   blocking_fail 走 session.requestQualityRework 显式回炉（上限 2 次）；
 * - 报告哈希覆盖**精确待审正文**（readProseChapter 原文的 SHA-256，UTF-8）——
 *   不哈希截断包或摘要（ADR-0025 决策 3：正文变化即 stale，fail closed）；
 * - 报告持久化于 `.mozhou/quality-reviews/chapter_<N>/report_<ULID>.json`，
 *   属运行期审计证据，不进 Canon、不参与真伪折叠。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { newUlid } from '@mozhou/kernel';
import {
  defaultPlatformRules,
  evaluateMechanicalGates,
  hashProse,
  mergeQualityPolicies,
  qualityRuleSetDigest,
  runQualityReview,
} from '@mozhou/quality-engine';
import type {
  FailurePattern,
  MechanicalGateReport,
  QualityPolicy,
  QualityReviewReport,
  ReviewerBinding,
  SemanticQualityEvaluator,
} from '@mozhou/quality-engine';
import type { ChapterPhase } from '@mozhou/data-plane';
import {
  ChapterPhaseError,
  absorbReviewCounterexamples,
  harvestQuotesFromProse,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import type { ChapterProductionSession } from './session.js';


/** 机械核检入口的输入记录：T18 门禁消费的冻结面。 */
export interface MechanicalReviewInput {
  readonly chapterIndex: number;
  readonly proseRelPath: string;
  /** 章节点身份（与章大纲同 id，章一体两面）。 */
  readonly mozhouId: string;
  readonly revision: number;
  readonly phase: Extract<ChapterPhase, 'draft'>;
  /** 草稿全文（frontmatter 之后的正文区）。 */
  readonly body: string;
  readonly charCount: number;
}

export interface RunReviewStepRequest {
  readonly bookRoot: string;
  readonly chapterIndex: number;
  /** 本窗 Compile 的 ContextReceipt id（报告锚定六元组之一）。 */
  readonly receiptId: string;
  readonly reviewer: ReviewerBinding;
  /** 已合并（平台+项目）的质量策略；缺省 = 平台默认规则集。 */
  readonly policy?: QualityPolicy;
  readonly failurePatterns?: readonly FailurePattern[];
  readonly semanticEvaluator?: SemanticQualityEvaluator;
  /** 调用方标记的动作拍点段落（PARA-001 豁免），透传 quality-engine。 */
  readonly actionBeatParagraphs?: ReadonlySet<number>;
}

export interface ReviewStepOutcome {
  readonly input: MechanicalReviewInput;
  readonly report: QualityReviewReport;
  /** 报告落盘相对路径（.mozhou/quality-reviews/…）。 */
  readonly reportRelPath: string;
}

function defaultPolicyFor(bookRoot: string): QualityPolicy {
  return mergeQualityPolicies(
    { schemaVersion: 1, projectId: 'platform', rules: defaultPlatformRules(), maxAutomaticReworks: 2 },
    { schemaVersion: 1, projectId: basename(bookRoot), rules: [], maxAutomaticReworks: 2 },
  );
}

/**
 * Review 步入口：读指定章的 draft 产物为机械核检输入。
 * 章不存在/结构违例 → data-plane 原生错误穿透；已提交相位的章不是本步输入
 * （ChapterPhaseError 宁败不猜——回炉走 reopen 后重进管线）。
 */
export function loadDraftForReview(bookRoot: string, chapterIndex: number): MechanicalReviewInput {
  const relPath = proseChapterPath(chapterIndex);
  const scan = readProseChapter(bookRoot, relPath);
  if (scan.phase !== 'draft') {
    throw new ChapterPhaseError(
      chapterIndex,
      'review consumes phase=draft products, got ' + scan.phase + ' — reopen before re-review',
    );
  }
  return {
    chapterIndex: scan.chapterIndex,
    proseRelPath: scan.relPath,
    mozhouId: scan.mozhouId,
    revision: scan.revision,
    phase: 'draft',
    body: scan.body,
    charCount: scan.body.length,
  };
}

/**
 * Review 步执行（ADR-0025）：装载精确 draft → SHA-256 → runQualityReview →
 * 报告落 `.mozhou/quality-reviews/`。本函数无会话副作用——事件落账与回炉
 * 决策由编排者经 session 显式驱动。
 */
export async function runReviewStep(request: RunReviewStepRequest): Promise<ReviewStepOutcome> {
  const input = loadDraftForReview(request.bookRoot, request.chapterIndex);
  const policy = request.policy ?? defaultPolicyFor(request.bookRoot);
  const proseContentHash = hashProse(input.body);
  // exactOptionalPropertyTypes：可选缝（semanticEvaluator/actionBeatParagraphs）
  // 只在提供时进入请求对象，不允许显式 undefined。
  const reviewRequest: {
    readonly prose: string;
    readonly policy: QualityPolicy;
    readonly anchor: {
      readonly chapterIndex: number;
      readonly draftRevision: number;
      readonly draftContentHash: string;
      readonly receiptId: string;
      readonly ruleSetDigest: string;
    };
    readonly reviewer: ReviewerBinding;
    readonly failurePatterns: readonly FailurePattern[];
    semanticEvaluator?: SemanticQualityEvaluator;
    actionBeatParagraphs?: ReadonlySet<number>;
  } = {
    prose: input.body,
    policy,
    anchor: {
      chapterIndex: input.chapterIndex,
      draftRevision: input.revision,
      draftContentHash: proseContentHash,
      receiptId: request.receiptId,
      ruleSetDigest: qualityRuleSetDigest(policy),
    },
    reviewer: request.reviewer,
    failurePatterns: request.failurePatterns ?? [],
  };
  if (request.semanticEvaluator !== undefined) {
    reviewRequest.semanticEvaluator = request.semanticEvaluator;
  }
  if (request.actionBeatParagraphs !== undefined) {
    reviewRequest.actionBeatParagraphs = request.actionBeatParagraphs;
  }
  const report = await runQualityReview(reviewRequest);

  const reportRelPath = join(
    '.mozhou',
    'quality-reviews',
    `chapter_${input.chapterIndex}`,
    `report_${newUlid()}.json`,
  );
  const absolute = join(request.bookRoot, reportRelPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(report, null, 2) + '\n', 'utf8');

  return { input, report, reportRelPath };
}

/** 深度章节审查统一执行请求 */
export interface ExecuteChapterReviewRequest {
  readonly bookRoot: string;
  readonly chapterIndex: number;
  /** 可选关联的 ChapterProductionSession；传入时自动记录 review 结果进账本 */
  readonly session?: ChapterProductionSession | null | undefined;
  /** 本窗 Compile 的 ContextReceipt id（缺省自动从 session 获取或使用 rcpt_rev_<N>） */
  readonly receiptId?: string | undefined;
  readonly reviewer?: ReviewerBinding | undefined;
  /** 质量策略，缺省平台默认 */
  readonly policy?: QualityPolicy | undefined;
  readonly failurePatterns?: readonly FailurePattern[] | undefined;
  readonly semanticEvaluator?: SemanticQualityEvaluator | undefined;
  readonly actionBeatParagraphs?: ReadonlySet<number> | undefined;
  /** 机械门禁校验选项（例如自定义字数窗口或红线规则） */
  readonly mechanicalOptions?: {
    readonly minWords?: number | undefined;
    readonly maxWords?: number | undefined;
    readonly customRedlines?: readonly string[] | undefined;
  } | undefined;
  /** 是否自动从正文收割独立短金句（<=25字），缺省 true */
  readonly autoHarvestQuotes?: boolean | undefined;
  /** 是否自动将 AI 味违规项沉淀至反例库，缺省 true */
  readonly autoAbsorbCounterexamples?: boolean | undefined;
}

/** 深度章节审查统一执行产物（集结语义审查、11项机械门禁、金句收割与反例库沉淀） */
export interface ExecuteChapterReviewOutcome extends ReviewStepOutcome {
  readonly mechanicalGate: MechanicalGateReport;
  readonly harvestedQuotesCount: number;
  readonly absorbedCounterexamplesCount: number;
}

/**
 * 章节审查深模块统一入口（Candidate 1 · 架构深化）。
 *
 * 聚合执行：
 * 1. 语义质量审查与报告落盘（runReviewStep）
 * 2. 11 项机械门禁算术机检（evaluateMechanicalGates）
 * 3. 独立短金句自动收割（harvestQuotesFromProse）
 * 4. AI 味违规反例自动吸收沉淀（absorbReviewCounterexamples）
 * 5. 会话账本登记与步进推进（session.recordQualityReview）
 */
export async function executeChapterReview(
  request: ExecuteChapterReviewRequest,
): Promise<ExecuteChapterReviewOutcome> {
  const receiptId =
    request.receiptId ??
    request.session?.project().lastReceiptId ??
    `rcpt_rev_${String(request.chapterIndex)}`;
  const reviewer: ReviewerBinding = request.reviewer ?? {
    providerId: 'pipeline',
    model: 'pipeline-direct',
    recipeVersion: '1.0.0',
  };

  const reviewOutcome = await runReviewStep({
    bookRoot: request.bookRoot,
    chapterIndex: request.chapterIndex,
    receiptId,
    reviewer,
    ...(request.policy !== undefined ? { policy: request.policy } : {}),
    ...(request.failurePatterns !== undefined ? { failurePatterns: request.failurePatterns } : {}),
    ...(request.semanticEvaluator !== undefined ? { semanticEvaluator: request.semanticEvaluator } : {}),
    ...(request.actionBeatParagraphs !== undefined
      ? { actionBeatParagraphs: request.actionBeatParagraphs }
      : {}),
  });

  // 1. 运行 11 项机械门禁算术机检
  const mechanicalGate = evaluateMechanicalGates(
    reviewOutcome.input.body,
    request.mechanicalOptions !== undefined
      ? {
          ...(request.mechanicalOptions.minWords !== undefined
            ? { minWords: request.mechanicalOptions.minWords }
            : {}),
          ...(request.mechanicalOptions.maxWords !== undefined
            ? { maxWords: request.mechanicalOptions.maxWords }
            : {}),
          ...(request.mechanicalOptions.customRedlines !== undefined
            ? { customRedlines: request.mechanicalOptions.customRedlines }
            : {}),
        }
      : undefined,
  );


  // 2. 自动金句收割
  let harvestedQuotesCount = 0;
  if (request.autoHarvestQuotes !== false) {
    try {
      const quotes = harvestQuotesFromProse(
        request.bookRoot,
        request.chapterIndex,
        reviewOutcome.input.body,
      );
      harvestedQuotesCount = Array.isArray(quotes) ? quotes.length : 0;
    } catch {
      // 容错不阻断核心审查产物
    }
  }


  // 3. 自动反例吸收
  let absorbedCounterexamplesCount = 0;
  if (request.autoAbsorbCounterexamples !== false) {
    try {
      const failed = reviewOutcome.report.evaluations.filter((e) => e.verdict === 'fail');
      const aiFlavorIssues = failed
        .filter((f) => f.ruleId.includes('ai') || f.ruleId.includes('flavor'))
        .map((f) => {
          const excerpt = f.evidence?.[0]?.excerpt;
          return {
            category: 'ai_flavor',
            severity: f.severity === 'blocking' ? ('critical' as const) : ('high' as const),
            ...(excerpt !== undefined ? { evidence: excerpt } : {}),
          };
        });
      if (aiFlavorIssues.length > 0) {
        absorbedCounterexamplesCount = absorbReviewCounterexamples(
          request.bookRoot,
          aiFlavorIssues,
        );
      }
    } catch {
      // 容错不阻断核心审查产物
    }
  }

  // 4. 若传入 session，自动记录进账本并推进状态
  if (request.session) {
    if (request.session.currentStep === 'draft') {
      request.session.advance('review');
    }
    if (request.session.currentStep === 'review') {
      request.session.recordQualityReview({
        reportId: reviewOutcome.report.reportId,
        verdict: reviewOutcome.report.verdict,
        reportPath: reviewOutcome.reportRelPath,
        draftRevision: reviewOutcome.input.revision,
        draftContentHash: reviewOutcome.report.anchor.draftContentHash,
        receiptId,
      });
    }
  }


  return {
    ...reviewOutcome,
    mechanicalGate,
    harvestedQuotesCount,
    absorbedCounterexamplesCount,
  };
}

