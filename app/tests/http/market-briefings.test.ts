// MarketBrief 版本化与绑定 API（工单 05，Delta 5）：创建/绑定/列表 + 归属边界
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { rankingSnapshots, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-mkt-http-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-mkt-http-o-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let otherCookie = "";
let otherNovelId = 0;
let briefingId = "";

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

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-mkt-http-%"));
  cookie = await register(EMAIL);
  otherCookie = await register(OTHER_EMAIL);
  // 种子快照（http-test-board 前缀，afterAll 清理）
  const captured = new Date();
  await db.insert(rankingSnapshots).values([
    { boardId: "http-test-board", bookId: "h1", name: "灰烬纪元", author: "A", category: "科幻末世", rank: 1, capturedAt: captured },
    { boardId: "http-test-board", bookId: "h2", name: "都市夜行", author: "B", category: "都市", rank: 2, capturedAt: captured },
  ]);
});

afterAll(async () => {
  await db.delete(rankingSnapshots).where(eq(rankingSnapshots.boardId, "http-test-board"));
  await db.delete(users).where(like(users.email, "mozhou-mkt-http-%"));
});

describe("MarketBrief 版本化与绑定 API（工单 05）", () => {
  it("POST /api/v1/market/briefings：从快照生成版本化简报（201 + vN）", async () => {
    const res = await fetch(`${BASE}/api/v1/market/briefings`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(201);
    const { briefing } = (await res.json()) as { briefing: { artifactId: string; version: string } };
    expect(briefing.artifactId).toBeTruthy();
    expect(briefing.version).toMatch(/^v\d+$/);
    briefingId = briefing.artifactId;
  });

  it("绑定到作品 → 列表可见；重复绑定幂等", async () => {
    const novel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "简报绑定测试", requestKey: `mkt-${RUN}` }),
    });
    const { novel: n } = (await novel.json()) as { novel: { id: number } };
    const bind = await fetch(`${BASE}/api/v1/market/briefings/${briefingId}/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ novelId: n.id }),
    });
    expect(bind.status).toBe(200);
    // 幂等重绑
    await fetch(`${BASE}/api/v1/market/briefings/${briefingId}/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ novelId: n.id }),
    });
    const list = await fetch(`${BASE}/api/v1/novels/${n.id}/briefings`, { headers: { cookie } });
    expect(list.status).toBe(200);
    const { briefings } = (await list.json()) as { briefings: Array<{ artifactId: string; version: string; provenance: { source: string } }> };
    expect(briefings.length).toBe(1);
    expect(briefings[0]!.artifactId).toBe(briefingId);
    expect(briefings[0]!.provenance.source).toBe("ranking-snapshot");
  });

  it("归属边界：跨用户读他人作品列表 → 404；不存在的简报绑定 → 404", async () => {
    const otherNovel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({ name: "他人作品", requestKey: `mkt-other-${RUN}` }),
    });
    const { novel: on } = (await otherNovel.json()) as { novel: { id: number } };
    otherNovelId = on.id;
    const crossBind = await fetch(`${BASE}/api/v1/market/briefings/${briefingId}/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({ novelId: on.id }),
    });
    expect(crossBind.status).toBe(200); // 他人作品+自己可用简报 → 合法
    const crossRead = await fetch(`${BASE}/api/v1/novels/${on.id}/briefings`, { headers: { cookie } });
    expect(crossRead.status).toBe(404); // me 读他人作品列表 → 404
    const badBind = await fetch(`${BASE}/api/v1/market/briefings/no-such-briefing/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ novelId: otherNovelId }),
    });
    expect(badBind.status).toBe(404);
  });

  it("未登录 → 401", async () => {
    const res = await fetch(`${BASE}/api/v1/market/briefings`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
