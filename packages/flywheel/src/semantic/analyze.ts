/**
 * 语义分析器骨架（T28 · #69；t66 D08/D11/D13/D15/D17）。
 *
 * advisory-only 只读旁路：输入（受影响章 refs + receipt 锚点 + 变更摘要引用）→
 * 注入的 analyzer 回调 → SemanticAnalysisReport（一报一文件，零其他出口）。
 *
 * - D11 token 预算：输入 ≤ min(装配包 totalTokens×1.0, 16384)、输出 ≤512——
 *   本骨架以调用方传入的 inputStats 做硬断言；超限 → refusal(budget_exceeded)；
 * - D13 降级三级：L0 跳过（provider 不可用 → refusal 指针，不产报告文件/事件——
 *   由调用方按 refusal 语义收口）、L1 明确不做（确定性兜底禁入语义报告）、
 *   L2 退避重试 3 次（注入 retry 语义，测试注入确定性失败序列）。绝不静默 mock；
 * - D15：本模块零 ProposalPort 集成点——结构上无 Port 引用，只产出报告；
 * - MUST-NOT 字面化：analyzeSemantic 内部不触碰正文、不写 canon/提案/配置、
 *   不改路由——全部副作用收敛在『写报告文件』+『返回结果』。
 */
import type { SemanticAnalysisReport, SemanticVerdict } from './types.js';
import { writeSemanticReport } from './report-store.js';

/** D11 定案值（t66 D13 终裁）。 */
export const INPUT_TOKEN_CAP = 16_384;
export const OUTPUT_TOKEN_CAP = 512;

/** 注入的分析回调：纯函数、除报告文件外零副作用（真 LLM 由调用方适配层注入）。 */
export interface AnalyzeInput {
  readonly reportId: string;
  readonly bookRoot: string;
  readonly anchor: SemanticAnalysisReport['anchor'];
  readonly affectedRefs: SemanticAnalysisReport['affectedRefs'];
  readonly contextTokens: number;
  readonly provider: string;
}

export interface AnalyzeDeps {
  /**
   * 真分析回调（测试注入确定性假实现）。抛错/拒绝=provider 不可用。
   *
   * 返回值允许 Promise：生产适配器（apps/web/server/llm/semanticEvaluator.ts）是真实
   * 网络调用，同步返回不可能；同步假实现照旧可用（await 非 Promise 值零开销）。
   * L2 重试（D13）由本模块的循环持有，故异步拒绝同样落入 3 次退避重试。
   */
  readonly evaluate: (input: { anchor: SemanticAnalysisReport['anchor']; affectedRefs: SemanticAnalysisReport['affectedRefs'] }) =>
    | {
        readonly verdict: SemanticVerdict;
        readonly findings: SemanticAnalysisReport['findings'];
        readonly outputTokens: number;
      }
    | Promise<{
        readonly verdict: SemanticVerdict;
        readonly findings: SemanticAnalysisReport['findings'];
        readonly outputTokens: number;
      }>;
  /** L2 重试：尝试次数与退避（测试注入 0 退避确定性；缺省 3 次 1s/2s/4s）。 */
  readonly retry?: { readonly attempts: number; readonly backoffMs: (attempt: number) => number } | undefined;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface AnalyzeOutcome {
  readonly report: SemanticAnalysisReport | null;
  readonly relPath: string | null;
  readonly status: 'reported' | 'refused';
  readonly refusalCode?: 'provider_unavailable' | 'budget_exceeded';
}

function retryAttempts(deps: AnalyzeDeps): number {
  return deps.retry?.attempts ?? 3;
}

/**
 * 语义分析主入口：预算门 → L2 重试（最多 attempts 次）→ 成功产报告文件；
 * 全失败/超限 → refusal 结果（不产文件、不静默）。
 */
export async function analyzeSemantic(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AnalyzeOutcome> {
  if (input.contextTokens > INPUT_TOKEN_CAP) {
    return { report: null, relPath: null, status: 'refused', refusalCode: 'budget_exceeded' };
  }

  const sleep = deps.sleep ?? defaultSleep;
  const attempts = retryAttempts(deps);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await deps.evaluate({ anchor: input.anchor, affectedRefs: input.affectedRefs });
      if (result.outputTokens > OUTPUT_TOKEN_CAP) {
        return { report: null, relPath: null, status: 'refused', refusalCode: 'budget_exceeded' };
      }
      const report: SemanticAnalysisReport = {
        schemaVersion: 1,
        reportId: input.reportId,
        recordedAt: input.anchor.chapterIndex !== undefined ? input.anchor.receiptId.slice(0, 12) : input.anchor.receiptId.slice(0, 12),
        anchor: input.anchor,
        affectedRefs: input.affectedRefs,
        provider: input.provider,
        inputStats: { inputTokens: input.contextTokens, outputTokens: result.outputTokens, contextTokens: input.contextTokens },
        findings: result.findings,
        verdict: result.verdict,
      };
      const relPath = writeSemanticReport({ bookRoot: input.bookRoot, report });
      return { report, relPath, status: 'reported' };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(deps.retry?.backoffMs?.(attempt) ?? defaultBackoff(attempt));
      }
    }
  }
  // L0：全尝试失败 → refusal（显式，绝不静默 mock）
  void lastError;
  return { report: null, relPath: null, status: 'refused', refusalCode: 'provider_unavailable' };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultBackoff(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}
