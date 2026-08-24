// 小说拆解 API 契约测试（09 工单）：文本 → 三段式拆解结果
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-decon-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-decon-%"));
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  cookie = `mozhou_session=${token}`;
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-decon-%"));
});

describe("POST /api/v1/deconstruct/analyze（mock provider）", () => {
  it("正常拆解：返回结构/剧情/节奏三数组", async () => {
    const text = "灰烬镇。灯童与陆沉舟立约。灰里开田，土是活的。阿雀守着火苗，火苗偏斜指向零界。".repeat(10);
    const requestKey = `deconstruct-${RUN}`;
    const res = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text, title: "灰烬有籽", requestKey, mode: "short" }),
    });
    expect(res.status).toBe(200);
    const { result, title, runId, status } = (await res.json()) as {
      result: { structure: string[]; plot: string[]; rhythm: string[]; mode: string; stages: Array<{ stage: number; artifact: { id: string; kind: string; schemaVersion: number } }> };
      title: string;
      runId: number;
      status: string;
    };
    expect(title).toBe("灰烬有籽");
    expect(runId).toBeGreaterThan(0);
    expect(status).toBe("completed");
    expect(result.structure.length).toBeGreaterThan(0);
    expect(result.plot.length).toBeGreaterThan(0);
    expect(result.rhythm.length).toBeGreaterThan(0);
    expect(result.mode).toBe("short");
    expect(result.stages.map((stage) => stage.stage)).toEqual([0, 2, 3, 4, 5, 6]);
    expect(result.stages.every((stage) => stage.artifact.id && stage.artifact.kind && stage.artifact.schemaVersion === 1)).toBe(true);
    result.structure.forEach((s) => expect(typeof s).toBe("string"));

    const retry = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text, title: "不应覆盖", requestKey }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { resumed?: boolean; runId: number; title: string };
    expect(retryBody.resumed).toBe(true);
    expect(retryBody.runId).toBe(runId);
    expect(retryBody.title).toBe("灰烬有籽");

    const runs = await fetch(`${BASE}/api/v1/deconstruct/runs`, { headers: { cookie } });
    expect(runs.status).toBe(200);
    const runsBody = (await runs.json()) as { runs: Array<{ id: number; result?: unknown }> };
    expect(runsBody.runs.some((run) => run.id === runId && run.result)).toBe(true);

    const reference = await fetch(`${BASE}/api/v1/deconstruct/runs/${runId}/reference`, { headers: { cookie } });
    expect(reference.status).toBe(200);
    const referenceBody = (await reference.json()) as { reference: { mode: string; chapterSummaries: unknown[]; style: Record<string, unknown> } };
    expect(referenceBody.reference.mode).toBe("short");
    expect(referenceBody.reference.chapterSummaries.length).toBeGreaterThan(0);
    expect(referenceBody.reference.style.sentence).toBeTruthy();
  });

  it("文本过短 → 400；未登录 → 401", async () => {
    const short = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: "太短" }),
    });
    expect(short.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "灰烬镇。".repeat(100) }),
    });
    expect(anon.status).toBe(401);
  });

  it("long 模式 mock 包含黄金三章阶段", async () => {
    const text = "灰烬镇。陆沉舟在雨夜捡到发光种子，守灯人说它不属于人间。".repeat(20);
    const res = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text, title: "长篇契约", requestKey: `long-${RUN}`, mode: "long" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { mode: string; stages: Array<{ stage: number }> } };
    expect(body.result.mode).toBe("long");
    expect(body.result.stages.map((stage) => stage.stage)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
