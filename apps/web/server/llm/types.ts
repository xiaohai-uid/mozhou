/**
 * apps/web/server/llm · 大模型基础类型定义 (LLM Base Types · T07)。
 * 下沉共享接口，杜绝跨模块循环引用。
 */

export interface OpenAiStreamChunk {
  readonly delta: string
  readonly finishReason?: string | undefined
}

/** 从 provider 解析出的真实上游端点。 */
export interface ResolvedEndpoint {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly allowPrivateNetwork?: boolean | undefined
}
