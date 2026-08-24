// 管线引擎单元测试：覆盖原型 verdict 的 5 场景 + 语义边界
// 测试哲学：只测外部行为——reducer 状态转移与 runNode 驱动循环（mock provider 注入）
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { initialState, reducer } from "@/lib/pipeline/reducer";
import { runNode, type LlmProvider, type NodeConfig } from "@/lib/pipeline/engine";
import { validateOutput } from "@/lib/pipeline/validate";

const schema = z.object({ name: z.string(), guide: z.string() });

const GOOD = JSON.stringify({ name: "冷冽刀锋", guide: "短句、冷峻" });
const BAD_JSON = '{"name": "冷冽刀锋", guide: 短句（引号丢了）';
const MISSING_FIELD = JSON.stringify({ guide: "只有风格没有名字" });
const USAGE = { prompt: 500, completion: 300 };

/** 可编程 mock provider：按调用次序返回文本序列（超出的重复最后一个） */
function mockProvider(
  sequence: Array<{ text: string; usage?: { prompt: number; completion: number } }>,
): LlmProvider {
  let calls = 0;
  return {
    async call() {
      const step = sequence[Math.min(calls, sequence.length - 1)];
      calls += 1;
      return { text: step.text, usage: step.usage ?? USAGE };
    },
  };
}

function run(provider: LlmProvider, overrides: Partial<NodeConfig> = {}) {
  return runNode(initialState(), {
    nodeType: "风格蒸馏",
    schema,
    provider,
    ...overrides,
  });
}

describe("场景 ① 一次成功", () => {
  it("好 JSON → ok，账本只记一次，输出入列", async () => {
    const state = await run(mockProvider([{ text: GOOD }]));
    expect(state.task?.status).toBe("ok");
    expect(state.task?.attempts).toBe(1);
    expect(state.task?.outputs).toEqual([GOOD]);
    expect(state.task?.lastOutput).toEqual({ name: "冷冽刀锋", guide: "短句、冷峻" });
    expect(state.ledger).toEqual({ prompt: 500, completion: 300, total: 800 });
  });
});

describe("场景 ② 坏 JSON 自动修复", () => {
  it("先坏后好 → 自动重试一次后 ok，账本累计两次调用", async () => {
    const state = await run(
      mockProvider([
        { text: BAD_JSON, usage: { prompt: 500, completion: 60 } },
        { text: GOOD },
      ]),
    );
    expect(state.task?.status).toBe("ok");
    expect(state.task?.attempts).toBe(2);
    expect(state.ledger.total).toBe(500 + 60 + 500 + 300);
  });
});

describe("场景 ③ 反复失败 → 等人工", () => {
  it("连续 3 次坏输出 → failed（attempts=3）；人工重试清零后成功", async () => {
    const bad3 = mockProvider([{ text: BAD_JSON }, { text: BAD_JSON }, { text: BAD_JSON }]);
    const state = await run(bad3);
    expect(state.task?.status).toBe("failed");
    expect(state.task?.attempts).toBe(3);
    expect(state.task?.lastError).toContain("已达重试上限");

    // 人工重试：尝试清零、状态回 running
    const retried = reducer(state, { type: "manualRetry" });
    expect(retried.task?.status).toBe("running");
    expect(retried.task?.attempts).toBe(0);

    // 重试后再跑一次成功
    const final = await runNode(retried, {
      nodeType: "风格蒸馏",
      schema,
      provider: mockProvider([{ text: GOOD }]),
    });
    expect(final.task?.status).toBe("ok");
  });

  it("缺字段与坏 JSON 同样触发修复重试", async () => {
    const state = await run(
      mockProvider([{ text: MISSING_FIELD }, { text: GOOD }]),
    );
    expect(state.task?.status).toBe("ok");
    expect(state.task?.attempts).toBe(2);
  });
});

describe("场景 ④ Token 超预算中止", () => {
  it("累计超预算 → aborted 且账本已记账（防失控账单）", async () => {
    const state = await run(
      mockProvider([{ text: BAD_JSON }, { text: BAD_JSON }]),
      { budget: 1000 },
    );
    expect(state.task?.status).toBe("aborted");
    expect(state.task?.lastError).toContain("预算超限");
    expect(state.ledger.total).toBe(1600); // 两次 800，第二次超预算但已记账
    // meter 先行：超预算时第二次的 llmRaw 被忽略，outputs 只有第一次
    expect(state.task?.outputs).toHaveLength(1);
  });
});

describe("场景 ⑤ 完成后非法操作被完全忽略", () => {
  it("ok 之后 meter/llmRaw/validateFail 全部原样返回（状态/账本/文案三不污染）", async () => {
    const done = await run(mockProvider([{ text: GOOD }]));
    const snapshot = JSON.stringify(done);

    for (const action of [
      { type: "meter", usage: { prompt: 999, completion: 999 } },
      { type: "llmRaw", text: BAD_JSON },
      { type: "validateFail", reason: "伪造的失败" },
      { type: "validateOk", output: { hacked: true } },
    ] as const) {
      const next = reducer(done, action);
      expect(next).toBe(done); // 引用不变 = 完全忽略
    }
    expect(JSON.stringify(done)).toBe(snapshot);
  });

  it("failed/aborted 态同样忽略数据动作", async () => {
    const failed = await run(mockProvider([{ text: BAD_JSON }]));
    expect(failed.task?.status).toBe("failed");
    const after = reducer(failed, { type: "meter", usage: { prompt: 1, completion: 1 } });
    expect(after).toBe(failed);
  });
});

describe("语义边界", () => {
  it("start：已有运行中任务时拒绝重复开始", async () => {
    const s1 = reducer(initialState(), { type: "start", nodeType: "风格蒸馏" });
    expect(s1.task?.status).toBe("running");
    const s2 = reducer(s1, { type: "start", nodeType: "小说拆解" });
    expect(s2.task?.nodeType).toBe("风格蒸馏"); // 未换任务
    expect(s2.lastAction).toContain("不能重复开始");
  });

  it("abort：非 running 态被拒绝（提示但不改任务）", async () => {
    const s = await run(mockProvider([{ text: GOOD }]));
    const after = reducer(s, { type: "abort" });
    expect(after.task?.status).toBe("ok");
    expect(after.lastAction).toContain("没有运行中的任务");
  });

  it("manualRetry：仅 failed 态可用", async () => {
    const s = await run(mockProvider([{ text: GOOD }]));
    const after = reducer(s, { type: "manualRetry" });
    expect(after.task?.status).toBe("ok");
  });

  it("budget/maxRetries 每节点可配", async () => {
    const s = await run(mockProvider([{ text: BAD_JSON }]), {
      maxRetries: 1,
      budget: 500,
    });
    // 一次失败即达上限（maxRetries=1）→ failed；同时 800 > 500 预算也超——meter 先行 → aborted
    expect(s.task?.status).toBe("aborted");
  });
});

describe("validateOutput（zod 校验器）", () => {
  it("坏 JSON → 语法错误原因", () => {
    expect(validateOutput(BAD_JSON, schema)).toEqual({
      ok: false,
      reason: "不是合法 JSON",
    });
  });

  it("缺必填字段 → 列出字段名", () => {
    const verdict = validateOutput(MISSING_FIELD, schema);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("name");
  });

  it("合法 JSON → 通过并返回解析值", () => {
    expect(validateOutput(GOOD, schema)).toEqual({
      ok: true,
      json: { name: "冷冽刀锋", guide: "短句、冷峻" },
    });
  });
});
