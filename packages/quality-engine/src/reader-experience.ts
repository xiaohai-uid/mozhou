/**
 * 读者体验诊断（ADR-0025 / 计划 Task 6）：压力/期待/实得/兑付/解法模式的
 * 章级诊断面。纪律：
 * - **Kernel 外**：ReaderExperienceDelta 不是 TemporalFact，不参与 Canon
 *   真伪折叠；NarrativePromise 仍是承诺正典真相（本模块只做诊断投影）。
 * - 书侧持久化 `质量/reader-experience.jsonl`（append-only 行容读，撕裂行跳过）；
 *   持久化由调用方执行，本模块只提供纯函数。
 * - 进入写作上下文时只取**有界近窗**（selectRecentDeltas：≤5 行），走既有
 *   结构段预算通道，不开新无限频道。
 */

export type PressureDelta = -2 | -1 | 0 | 1 | 2;
export type ExpectationDelta = -2 | -1 | 0 | 1 | 2;
export type TangibleGain =
  | 'none'
  | 'power'
  | 'resource'
  | 'status'
  | 'access'
  | 'relationship_leverage'
  | 'freedom';
export type PayoffProgress = 'none' | 'advanced' | 'partial' | 'paid';

export interface ReaderExperienceDelta {
  readonly chapterIndex: number;
  readonly pressureDelta: PressureDelta;
  readonly expectationDelta: ExpectationDelta;
  readonly tangibleGain: TangibleGain;
  readonly payoff: PayoffProgress;
  /** 该章过关所用的高层解法模式（自由词；PAT-002 据此判复用）。 */
  readonly solutionPattern: string;
}

/** 解析容错：字段值域校验，非法值返回 null（宁缺勿猜）。 */
function parseDelta(row: unknown): ReaderExperienceDelta | null {
  if (row === null || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const chapterIndex = record['chapterIndex'];
  const pressure = record['pressureDelta'];
  const expectation = record['expectationDelta'];
  const gain = record['tangibleGain'];
  const payoff = record['payoff'];
  const pattern = record['solutionPattern'];
  const isLevel = (value: unknown): value is PressureDelta =>
    value === -2 || value === -1 || value === 0 || value === 1 || value === 2;
  const GAINS: readonly string[] = ['none', 'power', 'resource', 'status', 'access', 'relationship_leverage', 'freedom'];
  const PAYOFFS: readonly string[] = ['none', 'advanced', 'partial', 'paid'];
  if (typeof chapterIndex !== 'number' || !isLevel(pressure) || !isLevel(expectation)) return null;
  if (typeof gain !== 'string' || !GAINS.includes(gain)) return null;
  if (typeof payoff !== 'string' || !PAYOFFS.includes(payoff)) return null;
  if (typeof pattern !== 'string') return null;
  return {
    chapterIndex,
    pressureDelta: pressure,
    expectationDelta: expectation,
    tangibleGain: gain as TangibleGain,
    payoff: payoff as PayoffProgress,
    solutionPattern: pattern,
  };
}

export function parseReaderExperienceDeltas(jsonl: string): ReaderExperienceDelta[] {
  const out: ReaderExperienceDelta[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // 撕裂行跳过
    }
    const delta = parseDelta(parsed);
    if (delta !== null) out.push(delta);
  }
  return out;
}

export function serializeReaderExperienceDeltas(deltas: readonly ReaderExperienceDelta[]): string {
  if (deltas.length === 0) return '';
  return deltas.map((delta) => JSON.stringify(delta)).join('\n') + '\n';
}

/**
 * 有界近窗选择：目标章 N 的上下文只携带 ≤limit 条（缺省 5）最近诊断行
 * （chapterIndex < N，按章号降序）。无新增无限 prompt 频道——条目在既有
 * 结构段预算内竞争（计划 Task 6 Step 3）。
 */
export function selectRecentDeltas(
  deltas: readonly ReaderExperienceDelta[],
  options: { readonly chapterIndex: number; readonly limit?: number },
): ReaderExperienceDelta[] {
  const limit = options.limit ?? 5;
  return [...deltas]
    .filter((delta) => delta.chapterIndex < options.chapterIndex)
    .sort((a, b) => b.chapterIndex - a.chapterIndex)
    .slice(0, limit);
}
