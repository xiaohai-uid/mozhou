/**
 * Review 步消费入口（T17 · #41；chapter-pipeline-spec §1 表第 4 行 / S5；
 * ADR-0025 升级：契约从「装载 draft 供核检」扩展为「产出版本绑定的
 * QualityReviewReport」——step id `review` 保留）。
 *
 * 边界纪律：
 * - 宿主职责明确：宿主负责从书根加载 draft 正文快照、核验 compiledAnchor.receiptId 编译凭证、
 *   管理生命周期、落盘报告、金句收割、反例吸收及推进 session；
 * - 能力通信契约纯净：传输数据只包含可序列化的请求与结果，绝不包含 session、书根路径、回调或凭据；
 * - 迟到保护：超时、取消或失败后，任何迟到的执行结果决不再落盘、收割金句、沉淀反例或推进会话账本；
 * - 报告持久化于 `.mozhou/quality-reviews/chapter_<N>/report_<ULID>.json`，
 *   属运行期审计证据，不进 Canon、不参与真伪折叠。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
import {
  parseReviewCapabilityRequest,
  parseReviewCapabilityResponse,
} from './reviewCapability.schema.js';
import type {
  ReviewCapabilityCompletedResponse,
  ReviewCapabilityRequest,
  ReviewCapabilityResponse,
} from './reviewCapability.schema.js';

/**
 * 评估锚点缺失：没有编译凭证就拒绝产报告（D10）。
 */
export class NoCompiledReceiptAnchorError extends Error {
  readonly code = 'NO_COMPILED_RECEIPT';
  readonly chapterIndex: number;

  constructor(chapterIndex: number) {
    super(
      '第 ' + chapterIndex + ' 章没有 Context 编译凭证，无法声明评估锚点（D10 不编造锚点）',
    );
    this.name = 'NoCompiledReceiptAnchorError';
    this.chapterIndex = chapterIndex;
  }
}

/** 章节审查超时错误。 */
export class ChapterReviewTimeoutError extends Error {
  readonly code = 'CHAPTER_REVIEW_TIMEOUT';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`章节审查超时（已超过 ${timeoutMs}ms）`);
    this.name = 'ChapterReviewTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** 章节审查已取消错误。 */
export class ChapterReviewCancelledError extends Error {
  readonly code = 'CHAPTER_REVIEW_CANCELLED';

  constructor(reason?: string) {
    super(reason ?? '章节审查已取消');
    this.name = 'ChapterReviewCancelledError';
  }
}

/** 机械核检入口的输入记录：T18 门消费的冻结面。 */
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

/** 能力执行器签名：纯净可序列化契约，接受请求返回响应 */
export type ReviewCapabilityExecutor = (
  request: ReviewCapabilityRequest,
  options?: {
    readonly signal?: AbortSignal | undefined;
    readonly semanticEvaluator?: SemanticQualityEvaluator | undefined;
  },
) => Promise<ReviewCapabilityResponse>;

/**
 * 默认进程内审查能力执行器。
 * 纯计算边界：无文件读写，无会话依赖；仅运算质量审查报告与机械门检验。
 */
export async function defaultReviewCapabilityExecutor(
  request: ReviewCapabilityRequest,
  options?: {
    readonly signal?: AbortSignal | undefined;
    readonly semanticEvaluator?: SemanticQualityEvaluator | undefined;
  },
): Promise<ReviewCapabilityResponse> {
  const signal = options?.signal;
  if (signal?.aborted) {
    return {
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'cancelled',
      reason: signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? '执行前已中止'),
    };
  }

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
    prose: request.draft.body,
    policy: request.policy,
    anchor: {
      chapterIndex: request.draft.chapterIndex,
      draftRevision: request.draft.revision,
      draftContentHash: request.draft.contentHash,
      receiptId: request.receiptId,
      ruleSetDigest: request.ruleSetDigest,
    },
    reviewer: request.reviewer,
    failurePatterns: request.failurePatterns,
  };

  if (options?.semanticEvaluator !== undefined) {
    reviewRequest.semanticEvaluator = options.semanticEvaluator;
  }
  if (request.actionBeatParagraphs !== undefined) {
    reviewRequest.actionBeatParagraphs = new Set(request.actionBeatParagraphs);
  }

  try {
    const report = await runQualityReview(reviewRequest);

    if (signal?.aborted) {
      return {
        schemaVersion: 1,
        requestId: request.requestId,
        status: 'cancelled',
        reason: signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? '执行期间已中止'),
      };
    }

    const mechanicalGate = evaluateMechanicalGates(
      request.draft.body,
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

    return {
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'completed',
      report,
      mechanicalGate,
    };
  } catch (error) {
    if (signal?.aborted) {
      return {
        schemaVersion: 1,
        requestId: request.requestId,
        status: 'cancelled',
        reason: (error as Error).message,
      };
    }
    return {
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'failed',
      error: {
        code: 'REVIEW_EXECUTION_FAILED',
        message: (error as Error).message || String(error),
      },
    };
  }
}

/** 深度章节审查统一执行请求 */
export interface ExecuteChapterReviewRequest {
  readonly bookRoot: string;
  readonly chapterIndex: number;
  /** 可选关联的 ChapterProductionSession；传入时自动记录 review 结果进账本 */
  readonly session?: ChapterProductionSession | null | undefined;
  /** 本窗 Compile 的 ContextReceipt id（缺省自动从 session 获取） */
  readonly receiptId?: string | undefined;
  readonly reviewer?: ReviewerBinding | undefined;
  /** 质量策略，缺省平台默认 */
  readonly policy?: QualityPolicy | undefined;
  readonly failurePatterns?: readonly FailurePattern[] | undefined;
  readonly semanticEvaluator?: SemanticQualityEvaluator | undefined;
  readonly actionBeatParagraphs?: ReadonlySet<number> | undefined;
  /** 机械门校验选项（例如自定义字数窗口或红线规则） */
  readonly mechanicalOptions?: {
    readonly minWords?: number | undefined;
    readonly maxWords?: number | undefined;
    readonly customRedlines?: readonly string[] | undefined;
  } | undefined;
  /** 是否自动从正文收割独立短金句（<=25字），缺省 true */
  readonly autoHarvestQuotes?: boolean | undefined;
  /** 是否自动将 AI 味违规项沉淀至反例库，缺省 true */
  readonly autoAbsorbCounterexamples?: boolean | undefined;
  /** 取消信号，用于中止正在进行的审查执行 */
  readonly signal?: AbortSignal | undefined;
  /** 超时限制（毫秒），超时将自动中止执行并激活迟到拦截 */
  readonly timeoutMs?: number | undefined;
  /** 可选的能力执行器注入（默认走进程内 defaultReviewCapabilityExecutor） */
  readonly capabilityExecutor?: ReviewCapabilityExecutor | undefined;
}

/** 深度章节审查统一执行产物（集结语义审查、5项机械门、金句收割与反例库沉淀） */
export interface ExecuteChapterReviewOutcome extends ReviewStepOutcome {
  readonly mechanicalGate: MechanicalGateReport;
  readonly harvestedQuotesCount: number;
  readonly absorbedCounterexamplesCount: number;
  readonly secondaryLifecycleWarnings?: readonly string[] | undefined;
}

/**
 * 章节审查深模块统一入口（宿主入口）。
 *
 * 宿主职责：
 * 1. 验证编译凭证锚点并读取 draft 产物快照；
 * 2. 组装纯净通信契约请求并调度能力计算（支持超时与取消）；
 * 3. 严格核验计算产物，执行迟到拦截与生命周期保护；
 * 4. 报告持久化落盘至 `.mozhou/quality-reviews/`；
 * 5. 自动收割金句与沉淀违规反例；
 * 6. 会话账本登记与状态推进。
 */
export async function executeChapterReview(
  request: ExecuteChapterReviewRequest,
): Promise<ExecuteChapterReviewOutcome> {
  // D10：没有编译凭证就没有「评估哪版编译」可声明。
  const receiptId = request.receiptId ?? request.session?.project().lastReceiptId;
  if (receiptId === undefined || receiptId === null) {
    throw new NoCompiledReceiptAnchorError(request.chapterIndex);
  }

  // 1. 生命周期控制器建立（超时与取消支持）
  const abortController = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      abortController.abort(new ChapterReviewTimeoutError(request.timeoutMs!));
    }, request.timeoutMs);
  }

  if (request.signal) {
    if (request.signal.aborted) {
      abortController.abort(request.signal.reason);
    } else {
      request.signal.addEventListener('abort', () => {
        abortController.abort(request.signal!.reason);
      }, { once: true });
    }
  }

  const checkAborted = () => {
    if (abortController.signal.aborted) {
      if (timedOut) {
        throw new ChapterReviewTimeoutError(request.timeoutMs!);
      }
      const reason: unknown = abortController.signal.reason;
      // 宿主把超时作为中止原因传入时，保留超时类型；降级成「取消」会让跨模块的错误类型与真实原因不符。
      if (reason instanceof ChapterReviewTimeoutError) throw reason;
      if (reason instanceof ChapterReviewCancelledError) throw reason;
      const message = reason instanceof Error ? reason.message : (typeof reason === 'string' ? reason : undefined);
      throw new ChapterReviewCancelledError(message);
    }
  };

  // 2. 宿主加载草稿正文快照
  checkAborted();
  const input = loadDraftForReview(request.bookRoot, request.chapterIndex);
  const policy = request.policy ?? defaultPolicyFor(request.bookRoot);
  const proseContentHash = hashProse(input.body);
  const reviewer: ReviewerBinding = request.reviewer ?? {
    providerId: 'pipeline',
    model: 'pipeline-direct',
    recipeVersion: '1.0.0',
  };

  // 3. 构建纯净能力通信契约请求（无 session、无书根路径、无回调）
  const capabilityRequest: ReviewCapabilityRequest = {
    schemaVersion: 1,
    requestId: 'req_rev_' + newUlid(),
    draft: {
      chapterIndex: input.chapterIndex,
      revision: input.revision,
      body: input.body,
      contentHash: proseContentHash,
    },
    receiptId,
    ruleSetDigest: qualityRuleSetDigest(policy),
    reviewer,
    policy: {
      schemaVersion: 1,
      projectId: policy.projectId,
      rules: policy.rules,
      maxAutomaticReworks: 2,
    },
    failurePatterns: request.failurePatterns ?? [],
    ...(request.actionBeatParagraphs !== undefined
      ? { actionBeatParagraphs: Array.from(request.actionBeatParagraphs) }
      : {}),
    ...(request.mechanicalOptions !== undefined
      ? {
          mechanicalOptions: {
            ...(request.mechanicalOptions.minWords !== undefined
              ? { minWords: request.mechanicalOptions.minWords }
              : {}),
            ...(request.mechanicalOptions.maxWords !== undefined
              ? { maxWords: request.mechanicalOptions.maxWords }
              : {}),
            ...(request.mechanicalOptions.customRedlines !== undefined
              ? { customRedlines: request.mechanicalOptions.customRedlines }
              : {}),
          },
        }
      : {}),
    ...(request.timeoutMs !== undefined && request.timeoutMs >= 1000 && request.timeoutMs <= 300000
      ? { timeoutMs: request.timeoutMs }
      : {}),
  };

  const validation = parseReviewCapabilityRequest(capabilityRequest);
  if (!validation.ok) {
    throw new Error(`能力请求契约校验失败: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }

  // 4. 调用能力执行器
  checkAborted();
  const executor = request.capabilityExecutor ?? defaultReviewCapabilityExecutor;
  let capabilityResponse: ReviewCapabilityResponse;
  try {
    capabilityResponse = await executor(validation.value, {
      signal: abortController.signal,
      semanticEvaluator: request.semanticEvaluator,
    });
  } catch (error) {
    checkAborted();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  // 5. 迟到保护：超时、取消或中止后，任何迟到的执行结果决不再落盘、收割金句、沉淀反例或推进会话账本！
  checkAborted();

  if (capabilityResponse.status === 'cancelled') {
    throw new ChapterReviewCancelledError(capabilityResponse.reason);
  }
  if (capabilityResponse.status === 'failed') {
    throw new Error(`审查能力执行失败 [${capabilityResponse.error.code}]: ${capabilityResponse.error.message}`);
  }

  const responseValidation = parseReviewCapabilityResponse(capabilityResponse, validation.value);
  if (!responseValidation.ok) {
    throw new Error(`能力响应契约校验失败: ${responseValidation.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }
  const completedResponse = responseValidation.value as ReviewCapabilityCompletedResponse;
  const report = completedResponse.report;
  const mechanicalGate = completedResponse.mechanicalGate;

  // 6. 迟到拦截校验：确保在落盘前未触发取消
  checkAborted();

  // 7. 宿主报告持久化落盘
  const reportRelPath = join(
    '.mozhou',
    'quality-reviews',
    `chapter_${input.chapterIndex}`,
    `report_${newUlid()}.json`,
  );
  const absolute = join(request.bookRoot, reportRelPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(report, null, 2) + '\n', 'utf8');

  // 再次核验迟到拦截：写盘期间到达的取消/超时不得留下孤儿报告（尽力回收后再抛出）。
  try {
    checkAborted();
  } catch (error) {
    await rm(absolute, { force: true }).catch(() => {});
    throw error;
  }

  const secondaryWarnings: string[] = [];

  // 8. 宿主金句收割
  let harvestedQuotesCount = 0;
  if (request.autoHarvestQuotes !== false) {
    try {
      checkAborted();
      const quotes = harvestQuotesFromProse(
        request.bookRoot,
        request.chapterIndex,
        input.body,
      );
      harvestedQuotesCount = Array.isArray(quotes) ? quotes.length : 0;
    } catch (error) {
      if (abortController.signal.aborted) throw error;
      secondaryWarnings.push(`金句收割跳过: ${(error as Error)?.message || String(error)}`);
    }
  }

  // 9. 宿主反例吸收
  let absorbedCounterexamplesCount = 0;
  if (request.autoAbsorbCounterexamples !== false) {
    try {
      checkAborted();
      const failed = report.evaluations.filter((e) => e.verdict === 'fail');
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
    } catch (error) {
      if (abortController.signal.aborted) throw error;
      secondaryWarnings.push(`反例库吸收跳过: ${(error as Error)?.message || String(error)}`);
    }
  }

  // 10. 宿主推进会话账本
  checkAborted();
  if (request.session) {
    if (request.session.currentStep === 'draft') {
      request.session.advance('review');
    }
    if (request.session.currentStep === 'review') {
      request.session.recordQualityReview({
        reportId: report.reportId,
        verdict: report.verdict,
        reportPath: reportRelPath,
        draftRevision: input.revision,
        draftContentHash: report.anchor.draftContentHash,
        receiptId,
      });
    }
  }

  return {
    input,
    report,
    reportRelPath,
    mechanicalGate,
    harvestedQuotesCount,
    absorbedCounterexamplesCount,
    ...(secondaryWarnings.length > 0 ? { secondaryLifecycleWarnings: secondaryWarnings } : {}),
  };
}
