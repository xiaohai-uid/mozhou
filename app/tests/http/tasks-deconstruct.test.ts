// 拆解接入任务运行时契约测试（票 07）：analyze 后 job/attempt/事件落账 + 幂等
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { generationEvents, generationJobs, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `tasks-decon-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let userId = 0;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-decon-%"));
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  cookie = `mozhou_session=${res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1]}`;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  userId = u!.id;
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-decon-%"));
});

const TEXT = "第1章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第2章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第3章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第4章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第5章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第6章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第7章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第8章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第9章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第10章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第11章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。\\n第12章 灰烬落在黄土坡上，老周扛着锄头往回走，村口的狗叫了一夜。";

describe("拆解 → 任务运行时落账", () => {
  it("analyze 后：job 登记 + 事件写盘 + 终态 succeeded（job_id = requestKey）", async () => {
    const key = `decon-${RUN}`;
    const res = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: TEXT, title: "灰烬有籽", requestKey: key, mode: "short" }),
    });
    expect(res.status).toBe(200);
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.jobId, key));
    expect(job).toBeTruthy();
    expect(job!.operation).toBe("deconstruction");
    expect(job!.userId).toBe(userId);
    expect(job!.status).toBe("succeeded");
    const events = await db.select().from(generationEvents).where(eq(generationEvents.jobId, key)).orderBy(generationEvents.seq);
    const kinds = events.map((e) => e.clientKey);
    expect(kinds).toContain("running");
    expect(kinds).toContain("done");
  });

  it("同 requestKey 重发：单 job（幂等）", async () => {
    const key = `decon2-${RUN}`;
    await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: TEXT, title: "幂等", requestKey: key, mode: "short" }),
    });
    await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: TEXT, title: "幂等", requestKey: key, mode: "short" }),
    });
    let jobs: typeof generationJobs.$inferSelect[] = [];
    for (let i = 0; i < 10 && jobs.length === 0; i++) {
      jobs = await db.select().from(generationJobs).where(eq(generationJobs.idempotencyKey, key));
      if (jobs.length === 0) await new Promise((r) => setTimeout(r, 300));
    }
    expect(jobs.length).toBe(1);
  });
});
