/**
 * Context Receipt 锚点的唯一解析处（D10：没有编译凭证就没有「评估哪版编译」可声明）。
 *
 * 为什么必须收口：评估锚点此前有两套互不相同的答案——
 *   - semanticSettled 扫账本平铺 ContextCompiled 行，缺凭证就跳过并留痕；
 *   - chapter.review 路由读 session 投影，取不到就**编一个** rcpt_web_<n> 落进报告。
 * 后者让报告「看起来有锚点、实际不可复算」，比诚实地说「没有」更难发现。
 *
 * 唯一诚实的失败答案是 null。签名里没有伪造的余地：想要锚点就得真有。
 */
import { readPipelineLedger } from '@mozhou/pipeline'
import type { PipelineLedgerRow } from '@mozhou/pipeline'
import type { ContextReceiptId } from '@mozhou/kernel'

/**
 * 该章最新编译凭证指针：扫账本**平铺** ContextCompiled 行（CHAPTER_DRAFTING + 同章号），
 * 后到者胜（行序即权威时序，沿 ledger.ts 头注）。
 *
 * 为什么不用 projectSession(rows, chapterIndex).lastReceiptId：那条路只认「会话窗口内」
 * 的指针——projection.ts 要求该章存在 TaskStarted（openedAtPosition !== null）
 * 且未 finished/committed，而 TaskStarted 在全仓非测试代码里的唯一发射点是
 * ChapterProductionSession.start，其生产调用方只有 /api/session.open；真实作者旅程
 * （apps/web/src 内无任何 session 路由调用）走 /api/draft.stream → buildDraftContext
 * → runCompileStep，只落平铺 ContextCompiled 行而不开窗口 ⇒ 用投影取锚点会恒被短路
 * （零报告、零上游调用）。平铺行自带 chapterIndex（receipt-file.ts），
 * 其自身归属即权威，不需要窗口做中介。
 */
export function latestCompiledReceiptIdForChapter(
  rows: readonly PipelineLedgerRow[],
  chapterIndex: number,
): ContextReceiptId | null {
  let found: ContextReceiptId | null = null
  for (const row of rows) {
    if (row.kind !== 'domain') continue
    if (row.row['type'] !== 'ContextCompiled') continue
    if (row.row['taskType'] !== 'CHAPTER_DRAFTING') continue
    if (row.row['chapterIndex'] !== chapterIndex) continue
    const receiptId = row.row['receiptId']
    // 形状守卫后再断言：`rcpt_` 前缀即 ContextReceiptId 的类型契约（kernel-schema.ts），
    // 不盲 cast——坏行宁可当「无凭证」跳过并留痕。
    if (typeof receiptId === 'string' && receiptId.startsWith('rcpt_')) found = receiptId as ContextReceiptId
  }
  return found
}

export interface CompiledAnchor {
  readonly receiptId: ContextReceiptId
}

/**
 * 读盘解析该章的编译锚点；该章从未编译过则返回 null。
 * 绝不返回占位 id——见本模块头注的 D10。
 */
export function resolveCompiledAnchor(root: string, chapterIndex: number): CompiledAnchor | null {
  const receiptId = latestCompiledReceiptIdForChapter(readPipelineLedger(root), chapterIndex)
  return receiptId === null ? null : { receiptId }
}
