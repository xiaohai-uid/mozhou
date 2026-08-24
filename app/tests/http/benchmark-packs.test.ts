// BenchmarkPack API（工单 06）：创建绑定/列表/归属边界
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { deconstructionRuns, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-bp-http-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-bp-http-o-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let otherCookie = "";
let runId = 0;
let otherRunId = 0;

async function register(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  return `mozhou_session=${token}`;
}

const minimalResult = {
  mode: "long",
  structure: [], plot: [], rhythm: [],
  stages: [
    { stage: 0, name: "s0", status: "completed", artifact: { id: "a0", kind: "k", schemaVersion: 1, premise: "P", chapterCount: 1, chapterIndex: [] } },
    { stage: 2, name: "s2", status: "completed", artifact: { id: "a2", kind: "k", schemaVersion: 1, chapters: [] } },
    { stage: 3, name: "s3", status: "completed", artifact: { id: "a3", kind: "k", schemaVersion: 1, mainline: "M", subplots: [], units: [], foreshadowing: [], emotionCurve: [], coverage: [] } },
    { stage: 4, name: "s4", status: "completed", artifact: { id: "a4", kind: "k", schemaVersion: 1, characters: [], worldview: {}, factions: [], relationships: [] } },
    { stage: 6, name: "s6", status: "completed", artifact: { id: "a6", kind: "k", schemaVersion: 1, sentence: "S", rhythm: "R", dialogue: "D", emotion: "E", techniques: ["章尾钩子"] } },
  ],
  quality: { sourceLength: 100, chapterCount: 1, completedStages: [0, 2, 3, 4, 6], warnings: [] },
};

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-bp-http-%"));
  cookie = await register(EMAIL);
  otherCookie = await register(OTHER_EMAIL);
  const me = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL)).limit(1);
  const other = await db.select({ id: users.id }).from(users).where(eq(users.email, OTHER_EMAIL)).limit(1);
  const [run] = await db.insert(deconstructionRuns).values({
    userId: me[0]!.id, title: "HTTP 方法包源", sourceHash: "h1", sourceLength: 100,
    requestKey: `bp-http-${RUN}`, status: "completed", result: minimalResult as never,
  }).returning({ id: deconstructionRuns.id });
  runId = run!.id;
  const [otherRun] = await db.insert(deconstructionRuns).values({
    userId: other[0]!.id, title: "他人拆解", sourceHash: "h2", sourceLength: 100,
    requestKey: `bp-http-o-${RUN}`, status: "completed", result: minimalResult as never,
  }).returning({ id: deconstructionRuns.id });
  otherRunId = otherRun!.id;
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-bp-http-%"));
});

describe("BenchmarkPack API（工单 06）", () => {
  it("POST 创建并绑定 → 201 + vN；GET 列表可见", async () => {
    const novel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "方法包绑定", requestKey: `bp-novel-${RUN}` }),
    });
    const { novel: n } = (await novel.json()) as { novel: { id: number } };
    const res = await fetch(`${BASE}/api/v1/novels/${n.id}/benchmark-packs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ runId }),
    });
    expect(res.status).toBe(201);
    const { pack } = (await res.json()) as { pack: { artifactId: string; version: string } };
    expect(pack.version).toMatch(/^v\d+$/);
    const list = await fetch(`${BASE}/api/v1/novels/${n.id}/benchmark-packs`, { headers: { cookie } });
    expect(list.status).toBe(200);
    const { packs } = (await list.json()) as { packs: Array<{ artifactId: string; sourceRunId: number }> };
    expect(packs.length).toBe(1);
    expect(packs[0]!.artifactId).toBe(pack.artifactId);
    expect(packs[0]!.sourceRunId).toBe(runId);
  });

  it("归属边界：他人拆解运行 → 404；跨用户读列表 → 404", async () => {
    const novel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "方法包归属", requestKey: `bp-own-${RUN}` }),
    });
    const { novel: n } = (await novel.json()) as { novel: { id: number } };
    const res = await fetch(`${BASE}/api/v1/novels/${n.id}/benchmark-packs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ runId: otherRunId }),
    });
    expect(res.status).toBe(404);
    const crossRead = await fetch(`${BASE}/api/v1/novels/${n.id}/benchmark-packs`, { headers: { cookie: otherCookie } });
    expect(crossRead.status).toBe(404);
  });

  it("未登录 → 401；缺 runId → 400", async () => {
    const anon = await fetch(`${BASE}/api/v1/novels/1/benchmark-packs`, { method: "POST" });
    expect(anon.status).toBe(401);
    const novel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "方法包入参", requestKey: `bp-param-${RUN}` }),
    });
    const { novel: n } = (await novel.json()) as { novel: { id: number } };
    const bad = await fetch(`${BASE}/api/v1/novels/${n.id}/benchmark-packs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
  });
});
