/**
 * 记忆锚（ADR-0025 / 计划 Task 6）：场景/金句/动作/物件/关系/主题六类锚的
 * 生命周期管理面。纪律：
 * - **Kernel 外**：MemoryAnchor 不是 TemporalFact；埋设/回响/退役状态是
 *   作者规划面的可版本控制诊断数据。
 * - 书侧持久化 `质量/memory-anchors.jsonl`（append-only 行容读，撕裂行跳过）；
 *   持久化由调用方执行，本模块只提供纯函数。
 * - 进入写作上下文时只取**有界相关集**（selectRelevantAnchors：≤8 个，
 *   退役锚永不入上下文），在既有结构段预算内竞争。
 */

export type AnchorType = 'scene' | 'line' | 'action' | 'object' | 'relationship' | 'theme';
export type AnchorStatus = 'planted' | 'echoed' | 'retired';

export interface MemoryAnchor {
  readonly anchorId: string;
  readonly type: AnchorType;
  readonly description: string;
  readonly plantedChapter: number;
  /** 最近一次回响章号；从未回响 ⇒ null。 */
  readonly lastEchoChapter: number | null;
  readonly status: AnchorStatus;
}

/** 回响一次：status 推进 planted→echoed（retired 不回退），lastEchoChapter 取 max。 */
export function recordAnchorEcho(
  anchors: readonly MemoryAnchor[],
  anchorId: string,
  chapterIndex: number,
): MemoryAnchor[] {
  return anchors.map((anchor) => {
    if (anchor.anchorId !== anchorId) return anchor;
    if (anchor.status === 'retired') return anchor;
    return {
      ...anchor,
      status: 'echoed',
      lastEchoChapter: Math.max(anchor.lastEchoChapter ?? -Infinity, chapterIndex),
    };
  });
}

/** 退役一次：status=retired（终态；不可回退——退役锚不再入上下文）。 */
export function retireAnchor(anchors: readonly MemoryAnchor[], anchorId: string): MemoryAnchor[] {
  return anchors.map((anchor) =>
    anchor.anchorId === anchorId ? { ...anchor, status: 'retired' } : anchor,
  );
}

function lastTouchChapter(anchor: MemoryAnchor): number {
  return anchor.lastEchoChapter ?? anchor.plantedChapter;
}

/**
 * 有界相关集选择：退役锚排除；活跃锚按最近触达（回响/埋设）降序，取 ≤limit
 * （缺省 8）。无新增无限 prompt 频道——条目在既有结构段预算内竞争。
 */
export function selectRelevantAnchors(
  anchors: readonly MemoryAnchor[],
  options: { readonly limit?: number } = {},
): MemoryAnchor[] {
  const limit = options.limit ?? 8;
  return anchors
    .filter((anchor) => anchor.status !== 'retired')
    .sort((a, b) => lastTouchChapter(b) - lastTouchChapter(a))
    .slice(0, limit);
}

export function parseMemoryAnchors(jsonl: string): MemoryAnchor[] {
  const out: MemoryAnchor[] = [];
  const TYPES: readonly string[] = ['scene', 'line', 'action', 'object', 'relationship', 'theme'];
  const STATUSES: readonly string[] = ['planted', 'echoed', 'retired'];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // 撕裂行跳过
    }
    if (parsed === null || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;
    const anchorId = record['anchorId'];
    const type = record['type'];
    const description = record['description'];
    const plantedChapter = record['plantedChapter'];
    const lastEchoChapter = record['lastEchoChapter'];
    const status = record['status'];
    if (typeof anchorId !== 'string' || typeof type !== 'string' || !TYPES.includes(type)) continue;
    if (typeof description !== 'string' || typeof plantedChapter !== 'number') continue;
    if (typeof status !== 'string' || !STATUSES.includes(status)) continue;
    if (lastEchoChapter !== null && typeof lastEchoChapter !== 'number') continue;
    out.push({
      anchorId,
      type: type as AnchorType,
      description,
      plantedChapter,
      lastEchoChapter,
      status: status as AnchorStatus,
    });
  }
  return out;
}

export function serializeMemoryAnchors(anchors: readonly MemoryAnchor[]): string {
  if (anchors.length === 0) return '';
  return anchors.map((anchor) => JSON.stringify(anchor)).join('\n') + '\n';
}
