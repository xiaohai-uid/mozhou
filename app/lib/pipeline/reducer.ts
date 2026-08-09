// 管线引擎核心 · 纯函数 reducer（lift 自 prototype/pipeline-engine.prototype.html，保留 verdict 语义）
// 状态机：idle(task=null) → running → ok | failed | aborted
// 组合顺序固定为 validate( meter( llmRaw(state) ) )，每一层都检查 running 态；
// 非 running 态的数据动作（meter/llmRaw/validate*）原样返回 state（状态/账本/文案三不污染）。
import { validateOutput, type OutputSchema } from "./validate";

export type TaskStatus = "running" | "ok" | "failed" | "aborted";

export interface Task {
  nodeType: string;
  status: TaskStatus;
  attempts: number;
  maxRetries: number;
  lastError: string | null;
  outputs: string[];
  lastOutput?: unknown; // 校验通过的 JSON
}

export interface PipelineState {
  task: Task | null; // null = idle
  ledger: { prompt: number; completion: number; total: number };
  budget: number;
  lastAction: string;
}

export interface Usage {
  prompt: number;
  completion: number;
}

export type PipelineAction =
  | { type: "start"; nodeType: string; maxRetries?: number; budget?: number }
  | { type: "llmRaw"; text: string }
  | { type: "llmResult"; text: string; usage: Usage; schema: OutputSchema }
  | { type: "validateOk"; output: unknown }
  | { type: "validateFail"; reason: string }
  | { type: "meter"; usage: Usage }
  | { type: "manualRetry" }
  | { type: "abort" }
  | { type: "reset" };

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BUDGET = 4000;

export function initialState(budget: number = DEFAULT_BUDGET): PipelineState {
  return {
    task: null,
    ledger: { prompt: 0, completion: 0, total: 0 },
    budget,
    lastAction: "",
  };
}

function isRunning(s: PipelineState): boolean {
  return s.task?.status === "running";
}

function start(state: PipelineState, action: Extract<PipelineAction, { type: "start" }>): PipelineState {
  if (isRunning(state)) {
    return { ...state, lastAction: "已有任务在运行，不能重复开始" };
  }
  return {
    ...state,
    task: {
      nodeType: action.nodeType,
      status: "running",
      attempts: 0,
      maxRetries: action.maxRetries ?? DEFAULT_MAX_RETRIES,
      lastError: null,
      outputs: [],
    },
    budget: action.budget ?? state.budget,
    lastAction: `开始「${action.nodeType}」任务`,
  };
}

function meter(state: PipelineState, usage: Usage): PipelineState {
  if (!isRunning(state)) return state; // 非运行中不记账（防账本污染）
  const nextLedger = {
    prompt: state.ledger.prompt + usage.prompt,
    completion: state.ledger.completion + usage.completion,
    total: state.ledger.total + usage.prompt + usage.completion,
  };
  if (nextLedger.total > state.budget) {
    return {
      ...state,
      ledger: nextLedger,
      task: state.task
        ? { ...state.task, status: "aborted", lastError: "Token 预算超限，已中止" }
        : null,
      lastAction: `本次消耗 ${usage.prompt + usage.completion} Token，累计超出预算 → 引擎中止任务`,
    };
  }
  return {
    ...state,
    ledger: nextLedger,
    lastAction: `已记账：+${usage.prompt} 输入 / +${usage.completion} 输出（本次 ${usage.prompt + usage.completion} Token）`,
  };
}

function llmRaw(state: PipelineState, text: string): PipelineState {
  // 完全忽略（含 lastAction）：与原型「输出被忽略」提示的有意分歧——
  // verdict 要求文案三不污染，完成态再塞输出不应覆盖「校验通过」提示
  if (!isRunning(state)) return state;
  const attempts = state.task!.attempts + 1;
  return {
    ...state,
    task: { ...state.task!, attempts, outputs: [...state.task!.outputs, text], lastError: null },
    lastAction: `AI 第 ${attempts} 次返回（${text.length} 字符）`,
  };
}

function validateOk(state: PipelineState, output: unknown): PipelineState {
  if (!isRunning(state)) return state;
  return {
    ...state,
    task: { ...state.task!, status: "ok", lastOutput: output },
    lastAction: "校验通过 → 节点完成 ✓",
  };
}

function validateFail(state: PipelineState, reason: string): PipelineState {
  if (!isRunning(state)) return state;
  const task = state.task!;
  const exhausted = task.attempts >= task.maxRetries;
  return {
    ...state,
    task: {
      ...task,
      status: exhausted ? "failed" : "running",
      lastError: reason + (exhausted ? "（已达重试上限）" : " → 自动进入修复重试"),
    },
    lastAction: exhausted
      ? `校验失败：${reason}。已达 ${task.maxRetries} 次上限 → 任务失败，等待人工处理`
      : `校验失败：${reason}。引擎自动把错误附给 AI 请求修复（第 ${task.attempts}/${task.maxRetries} 次）`,
  };
}

function manualRetry(state: PipelineState): PipelineState {
  if (state.task?.status !== "failed") {
    return { ...state, lastAction: "只有失败的任务可以人工重试" };
  }
  return {
    ...state,
    task: { ...state.task, status: "running", attempts: 0, lastError: null },
    lastAction: "人工重试：尝试次数清零，重新开始",
  };
}

function abort(state: PipelineState): PipelineState {
  if (!isRunning(state)) {
    return { ...state, lastAction: "没有运行中的任务可中止" };
  }
  return {
    ...state,
    task: { ...state.task!, status: "aborted", lastError: "被手动中止" },
    lastAction: "任务已中止",
  };
}

/** 组合动作：meter 先行 → llmRaw → 校验（顺序固定，verdict 语义） */
function llmResult(state: PipelineState, action: Extract<PipelineAction, { type: "llmResult" }>): PipelineState {
  const metered = meter(state, action.usage);
  const raw = llmRaw(metered, action.text);
  const verdict = validateOutput(action.text, action.schema);
  return verdict.ok ? validateOk(raw, verdict.json) : validateFail(raw, verdict.reason);
}

export function reducer(state: PipelineState, action: PipelineAction): PipelineState {
  switch (action.type) {
    case "start":
      return start(state, action);
    case "meter":
      return meter(state, action.usage);
    case "llmRaw":
      return llmRaw(state, action.text);
    case "llmResult":
      return llmResult(state, action);
    case "validateOk":
      return validateOk(state, action.output);
    case "validateFail":
      return validateFail(state, action.reason);
    case "manualRetry":
      return manualRetry(state);
    case "abort":
      return abort(state);
    case "reset":
      return initialState(state.budget); // 保留当前节点预算（原型重置为默认值，此处有意收紧）
    default:
      return state;
  }
}
