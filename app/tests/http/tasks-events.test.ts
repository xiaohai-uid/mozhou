// 任务事件补发端点测试（票 05）：游标续传 / client_key 幂等 / 越权 404
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { enqueueJob, appendEvent } from "@/lib/tasks/service";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `tasks-events-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

interface TestUser { cookie: string; id: number; }
async function registerUser(email: string): Promise<TestUser> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie")!;
  const token = setCookie.match(/mozhou_session=([^;]+)/)![1];
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { cookie: `mozhou_session=${token}`, id: row!.id };
}

let me: TestUser;
let other: TestUser;
let jobId: string;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-events-%"));
  me = await registerUser(EMAIL);
  other = await registerUser(`tasks-events-other-${RUN}@example.com`);
  const { job } = await enqueueJob({
    userId: me.id, novelId: null, operation: "chapter_generation",
    idempotencyKey: `ev-${RUN}`, inputHash: "h",
  });
  jobId = job.jobId;
  await appendEvent({ jobId, eventType: "phase", payload: { kind: "planning" }, clientKey: "ck-1" });
  await appendEvent({ jobId, eventType: "phase", payload: { kind: "writing" }, clientKey: "ck-2" });
  await appendEvent({ jobId, eventType: "done", payload: { kind: "ok" }, clientKey: "ck-3" });
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-events-%"));
});

describe("GET /api/v1/runtime/jobs/[jobId]/events", () => {
  it("未登录 → 401", async () => {
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/${jobId}/events`);
    expect(res.status).toBe(401);
  });

  it("afterSeq=0 → 全部事件（seq 1..3）", async () => {
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/${jobId}/events?afterSeq=0`, { headers: { cookie: me.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3]);
    expect(body.events[2]!.eventType).toBe("done");
  });

  it("afterSeq=1 → 只补缺失事件 2..3（游标续传）", async () => {
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/${jobId}/events?afterSeq=1`, { headers: { cookie: me.cookie } });
    const body = await res.json();
    expect(body.events.map((e: { seq: number }) => e.seq)).toEqual([2, 3]);
  });

  it("越权访问 → 统一 404", async () => {
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/${jobId}/events`, { headers: { cookie: other.cookie } });
    expect(res.status).toBe(404);
  });

  it("不存在 job → 404", async () => {
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/no-such-job/events`, { headers: { cookie: me.cookie } });
    expect(res.status).toBe(404);
  });

  it("非法 afterSeq → 400", async () => {
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/${jobId}/events?afterSeq=-1`, { headers: { cookie: me.cookie } });
    expect(res.status).toBe(400);
  });
});
