/**
 * 语义层载荷（T28 · #69；t66 D08/D09/D10/D17 终裁）。
 *
 * SemanticAnalysisReport：advisory-only 只读旁路分析器的产出——一报一文件
 * .mozhou/semantic-analysis/report_<ULID>.json。本体【不复用 Receipt】（LLM
 * 判定写入会摧毁 recomputationHash 承诺）；形态同构部分采纳（t66 R3）：
 * entries 同构槽【有】（稳定分键、自闭合 schema、生命周期剥离）、replayInputs
 * 同构槽【明确不引入】（重放是 Receipt 契约领地、锚点已指向，重复即冗余）、
 * structural 同构槽【V2 缓】。
 *
 * 锚点（D10）：receiptId+recomputationHash+changeSummaryDigest 伴随态——标定
 * 『评估哪版编译』；T5 摘要带引用不内嵌（reconciliationRef）。
 *
 * D17 输入契约：受影响章 diffs（affectedRefs 具名引用）+ 修改实体定义摘要 +
 * receipt 锚点——diffs 以引用进载荷、不内嵌全文（沿 spec:86 纪律）。
 *
 * MUST-NOT（t66 D08，字面落代码）：不裁决硬冲突、不触碰 Protected Author
 * Content、不进预算核算路径、不改路由配置、不判事实真伪、永不代作者调用
 * ProposalPort 三动词——本模块从结构上只有『产报告』一个出口。
 */
export type SemanticVerdict = 'ok' | 'attention' | 'refusal';

/** 语义判定的一条 finding（软性标定；advisory-only）。 */
export interface SemanticFinding {
  readonly severity: 'info' | 'warning';
  readonly code: string;
  readonly message: string;
}

/** 输入计量（服务端 tokenizer 精确计量在上游完成；载荷只记录值）。 */
export interface SemanticInputStats {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly contextTokens: number;
}

/** 受影响章 diffs 引用（D17：引用不内嵌）。 */
export interface AffectedRef {
  readonly chapterIndex: number;
  readonly changeSummaryDigest: string;
}

export interface SemanticAnalysisReport {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly recordedAt: string;
  readonly anchor: {
    readonly receiptId: string;
    readonly recomputationHash: string;
    readonly taskType: string;
    readonly chapterIndex?: number;
    readonly reconciliationRef?: { readonly proposalId: string; readonly changeSummaryDigest: string };
  };
  /** D17 输入面：受影响章 diffs 引用 + 修改实体定义摘要。 */
  readonly affectedRefs: readonly AffectedRef[];
  readonly provider: string;
  readonly inputStats: SemanticInputStats;
  readonly findings: readonly SemanticFinding[];
  readonly verdict: SemanticVerdict;
  /** L0 降级（provider 不可用）时的显式理由；绝不静默 mock（AGENTS 14/15）。 */
  readonly refusal?: { readonly code: 'provider_unavailable' | 'budget_exceeded'; readonly detail: string };
  /** entries 同构槽（t66 R3）：稳定分键、自闭合 schema、生命周期剥离。 */
  readonly entries?: Readonly<Record<string, unknown>>;
}
