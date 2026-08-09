// 管线驱动循环：LLM 调用 → reducer 组合（校验失败自动修复重试）→ 直至 ok/failed/aborted
// provider 抽象留 04 对接真实 one-api；本模块只依赖 LlmProvider 接口（mock 可注入）
import { reducer, initialState, type PipelineState, type Usage } from "./reducer";
import type { OutputSchema } from "./validate";

export interface LlmProvider {
  /** 一次 LLM 调用。lastError 为上次校验失败原因（修复重试语义），attempt 从 0 计 */
  call(input: {
    nodeType: string;
    attempt: number;
    lastError: string | null;
  }): Promise<{ text: string; usage: Usage }>;
}

/** 流式 LLM 提供者（SSE 对话场景）：逐 delta 输出，流结束可带 usage */
export interface StreamProvider {
  stream(): AsyncIterable<StreamDelta>;
}

export interface StreamDelta {
  text?: string;
  usage?: Usage;
}

export interface NodeConfig {
  nodeType: string;
  schema: OutputSchema;
  provider: LlmProvider;
  maxRetries?: number;
  budget?: number;
}

/**
 * 执行一个节点到终态。循环自然收敛：
 * - 校验失败且未达上限 → 携带 lastError 再调 provider（自动修复）
 * - 校验失败达上限 → failed（等人工）
 * - 预算超限 / 手动中止 → aborted
 */
export async function runNode(
  initial: PipelineState,
  cfg: NodeConfig,
): Promise<PipelineState> {
  let state = reducer(initial, {
    type: "start",
    nodeType: cfg.nodeType,
    maxRetries: cfg.maxRetries,
    budget: cfg.budget,
  });

  while (state.task?.status === "running") {
    const { text, usage } = await cfg.provider.call({
      nodeType: cfg.nodeType,
      attempt: state.task.attempts,
      lastError: state.task.lastError,
    });
    state = reducer(state, { type: "llmResult", text, usage, schema: cfg.schema });
  }

  return state;
}

/**
 * 流式节点（写作对话）：逐 delta 回调转发，流结束一次性记账完成。
 * 自由文本不做 JSON 校验（对话语义）；provider 抛错 → failed（无修复重试语义）。
 */
export async function runNodeStream(
  initial: PipelineState,
  cfg: StreamNodeConfig,
  onDelta: (text: string) => void,
): Promise<PipelineState> {
  const state = reducer(initial, {
    type: "start",
    nodeType: cfg.nodeType,
    budget: cfg.budget,
  });
  if (state.task?.status !== "running") return state;

  let text = "";
  let usage: Usage = { prompt: 0, completion: 0 };
  try {
    for await (const delta of cfg.provider.stream()) {
      if (delta.text) {
        text += delta.text;
        onDelta(delta.text);
      }
      if (delta.usage) usage = delta.usage;
    }
  } catch (err) {
    return reducer(state, {
      type: "fail",
      reason: `调用失败：${(err as Error).message}`,
    });
  }

  return reducer(state, { type: "llmTextResult", text, usage });
}

export interface StreamNodeConfig {
  nodeType: string;
  provider: StreamProvider;
  budget?: number;
}

export { initialState };
