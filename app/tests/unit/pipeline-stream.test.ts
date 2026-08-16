// 流式对话管线测试：runNodeStream（流式驱动）+ llmTextResult（自由文本记账）
import { describe, it, expect } from "vitest";
import { initialState, reducer, type Usage } from "@/lib/pipeline/reducer";
import { runNodeStream, type StreamProvider } from "@/lib/pipeline/engine";

const USAGE: Usage = { prompt: 100, completion: 50 };

/** mock 流式 provider：按序列输出 delta（可含 usage），或抛错 */
function mockStream(
  chunks: Array<{ text?: string; usage?: Usage }>,
  failAt?: number,
): StreamProvider {
  let i = 0;
  return {
    async *stream() {
      for (const c of chunks) {
        if (failAt !== undefined && i === failAt) {
          throw new Error("上游调用失败");
        }
        i += 1;
        yield c;
      }
    },
  };
}
async function collect(
  provider: StreamProvider,
  budget?: number,
): Promise<{ state: ReturnType<typeof initialState>; deltas: string[] }> {
  const deltas: string[] = [];
  const state = await runNodeStream(
    initialState(),
    { nodeType: "写作对话", provider, budget },
    (t) => deltas.push(t),
  );
  return { state, deltas };
}

describe("runNodeStream 流式驱动", () => {
  it("流式成功：onDelta 逐块输出，终态 ok，账本按 usage 记账", async () => {
    const { state, deltas } = await collect(
      mockStream([{ text: "你好" }, { text: "，墨舟" }, { usage: USAGE }]),
    );
    expect(deltas).toEqual(["你好", "，墨舟"]);
    expect(state.task?.status).toBe("ok");
    expect(state.task?.outputs).toEqual(["你好，墨舟"]);
    expect(state.ledger).toEqual({ prompt: 100, completion: 50, total: 150 });
  });

  it("流结束才记账：usage 超预算 → aborted（delta 已发但终态中止）", async () => {
    const { state, deltas } = await collect(
      mockStream([
        { text: "大段输出" },
        { usage: { prompt: 3000, completion: 2000 } },
      ]),
      1000,
    );
    expect(deltas).toEqual(["大段输出"]);
    expect(state.task?.status).toBe("aborted");
    expect(state.task?.lastError).toContain("预算超限");
    expect(state.ledger.total).toBe(5000); // 已记账（防失控账单）
  });

  it("provider 抛错 → failed，reason 带调用失败信息", async () => {
    const { state, deltas } = await collect(
      mockStream([{ text: "部分输出" }, { text: "更多" }], 1),
    );
    expect(deltas).toEqual(["部分输出"]);
    expect(state.task?.status).toBe("failed");
    expect(state.task?.lastError).toContain("调用失败");
    expect(state.task?.lastError).toContain("上游调用失败");
  });

  it("空流（无 delta 无 usage）→ ok 且记账为零", async () => {
    const { state } = await collect(mockStream([]));
    expect(state.task?.status).toBe("ok");
    expect(state.ledger.total).toBe(0);
  });

  it("请求中止：保留已发 delta，但不把未完成流标记为成功", async () => {
    const controller = new AbortController();
    const deltas: string[] = [];
    const provider: StreamProvider = {
      async *stream() {
        yield { text: "已生成" };
        controller.abort();
        yield { text: "不应继续消费" };
      },
    };

    const state = await runNodeStream(
      initialState(),
      { nodeType: "写作对话", provider },
      (text) => deltas.push(text),
      controller.signal,
    );

    expect(deltas).toEqual(["已生成"]);
    expect(state.task?.status).toBe("aborted");
    expect(state.task?.outputs).toEqual([]);
  });
});

describe("llmTextResult 组合语义", () => {
  it("meter 先行：超预算时文本被忽略（outputs 不追加）", () => {
    const s1 = reducer(initialState(100), { type: "start", nodeType: "写作对话" });
    const s2 = reducer(s1, {
      type: "llmTextResult",
      text: "不会入库的文本",
      usage: { prompt: 60, completion: 60 },
    });
    expect(s2.task?.status).toBe("aborted");
    expect(s2.task?.outputs).toEqual([]);
    expect(s2.ledger.total).toBe(120);
  });

  it("非 running 态 llmTextResult 原样返回（三不污染）", () => {
    const s1 = reducer(initialState(), { type: "start", nodeType: "写作对话" });
    const done = reducer(s1, {
      type: "llmTextResult",
      text: "完成",
      usage: { prompt: 1, completion: 1 },
    });
    expect(done.task?.status).toBe("ok");
    const after = reducer(done, {
      type: "llmTextResult",
      text: "非法输入",
      usage: { prompt: 999, completion: 999 },
    });
    expect(after).toBe(done);
  });

  it("正常路径：meter → llmRaw → ok，文本入 outputs 并记账", () => {
    const s1 = reducer(initialState(), { type: "start", nodeType: "写作对话" });
    const s2 = reducer(s1, { type: "llmTextResult", text: "回复内容", usage: USAGE });
    expect(s2.task?.status).toBe("ok");
    expect(s2.task?.outputs).toEqual(["回复内容"]);
    expect(s2.ledger.total).toBe(150);
  });
});
