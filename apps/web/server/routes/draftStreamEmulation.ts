/**
 * 草稿流的**仿真**源（MOZHOU_DRAFT_PROVIDER=mock / mock-empty）。
 *
 * 单独成模块的理由：这两条流与路由分派毫无关系，是「provider 接缝的另一侧」——
 * 过去它们和 16 个 if (path === ...) 分支挤在同一文件里，读路由的人得先跳过
 * 它们才知道路由在做什么；而它们真正的风险（分块边界）根本没有测试。
 */

/** 空流：`mock-empty` 回归缝——零帧即终帧，绝不产出任何正文。 */
export function emptyDraftStream(): AsyncIterable<string> {
  return (async function* () {
    await Promise.resolve()
  })()
}

/**
 * mock 流：把作者指令按固定窗口切块逐步吐出，模拟真实 provider 的分帧节奏。
 *
 * 分块纪律：每块是 `base` 上一个**不重叠**的切片，空块由下面的 length 检查丢弃。
 * 曾经的写法是 `base.slice(8, 18) === '' ? base : base.slice(8, 18)`——短提示词
 * （不足 8 字）时中间块回退成整段 base，于是首块与中间块都是全文，mock 生成的
 * 正文被原样吐了两遍。这类错误在 mock 下没人看正文，所以一直没被发现。
 */
export function mockDraftStream(prompt: string, onDelta?: (text: string) => void): AsyncIterable<string> {
  const base = prompt.trim().length > 0 ? prompt.trim() : '夜雨敲窗，灯焰摇了三摇。'
  const chunks = [base.slice(0, 8), base.slice(8, 18), base.slice(18)]
  return (async function* () {
    for (const chunk of chunks) {
      await Promise.resolve()
      if (chunk.length > 0) {
        onDelta?.(chunk)
        yield chunk
      }
    }
  })()
}

/**
 * 行内编辑流的 mock 源（CHG-20261006-02 /api/prose.edit.stream）。
 * 纪律与 mockDraftStream 一致：非重叠切片、空块丢弃；内容回吐**选区原文**——
 * mock 语义是演示流节奏与帧协议，不伪造改写（Accept 后正文不变，诚实）。
 */
export function mockProseEditStream(selectedText: string, onDelta?: (text: string) => void): AsyncIterable<string> {
  const base = selectedText.trim().length > 0 ? selectedText.trim() : '　　他望着窗外的雨，没有说话。'
  const chunks = [base.slice(0, 8), base.slice(8, 18), base.slice(18)]
  return (async function* () {
    for (const chunk of chunks) {
      await Promise.resolve()
      if (chunk.length > 0) {
        onDelta?.(chunk)
        yield chunk
      }
    }
  })()
}
