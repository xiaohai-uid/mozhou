/**
 * 项目级失败记忆（ADR-0025 / 计划 Task 5）：作者结构化纠错 → FailurePattern
 * 投影。纪律：
 * - **事件派生投影语义**：模式由 AuthorCorrectionRecorded 事件流折叠而来，
 *   折叠幂等；本模块只提供纯函数（更新/编解码），持久化由调用方执行——
 *   书侧文件 `质量/failure-memory.jsonl`（append-only 行格式，撕裂行跳过，
 *   与 Ledger 双行容读同纪律）。
 * - 失败记忆是**质量先验**，不是 Canon 事实：不得进 TemporalFact 五族，
 *   不参与真伪折叠；仅供语义审查者显式检验复发（Task 5 Step 4）。
 * - 隐私红线：authorNote 原文只留在书侧 jsonl（P1）；任何遥测/飞轮行只允许
 *   摘要与计数（event payload 携带 noteDigest，不携带原文）。
 */
import type { CorrectionReason, FailurePattern } from './types.js';

/**
 * 把一次纠错折叠进既有模式集（纯函数，不改输入）：
 * - 已有同 code 模式：occurrences +1，lastSeenChapter = max（append-only 语义），
 *   firstSeenChapter = min；authorNote 仅在本次显式提供时覆盖；
 * - 新 code：追加模式（occurrences=1，active=true）；
 * - 未涉及的模式原样保留，输出顺序 = 既有顺序 + 新增顺序（稳定）。
 */
export function updateFailurePatterns(
  existing: readonly FailurePattern[],
  chapterIndex: number,
  reasons: readonly CorrectionReason[],
  authorNote?: string,
): FailurePattern[] {
  const out = existing.map((pattern) => ({ ...pattern }));
  for (const code of reasons) {
    const found = out.find((pattern) => pattern.code === code);
    if (found === undefined) {
      out.push({
        code,
        firstSeenChapter: chapterIndex,
        lastSeenChapter: chapterIndex,
        occurrences: 1,
        active: true,
        ...(authorNote !== undefined ? { authorNote } : {}),
      });
      continue;
    }
    found.occurrences += 1;
    found.firstSeenChapter = Math.min(found.firstSeenChapter, chapterIndex);
    found.lastSeenChapter = Math.max(found.lastSeenChapter, chapterIndex);
    if (authorNote !== undefined) found.authorNote = authorNote;
  }
  return out;
}

/**
 * JSONL 行格式容读：空行与撕裂行跳过（Ledger 双行容读同纪律）；
 * 行内 JSON 解析失败不抛——部分损坏不报废整册记忆。
 */
export function parseFailurePatterns(jsonl: string): FailurePattern[] {
  const patterns: FailurePattern[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // 撕裂行跳过
    }
    if (parsed !== null && typeof parsed === 'object' && typeof (parsed as FailurePattern).code === 'string') {
      patterns.push(parsed as FailurePattern);
    }
  }
  return patterns;
}

/** 序列化为 JSONL（每行一条 + 尾随换行；空集 ⇒ 空串）。 */
export function serializeFailurePatterns(patterns: readonly FailurePattern[]): string {
  if (patterns.length === 0) return '';
  return patterns.map((pattern) => JSON.stringify(pattern)).join('\n') + '\n';
}
