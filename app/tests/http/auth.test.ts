// 认证 API 契约测试（真实 HTTP，next dev server 由 global-setup 拉起）
// 测试哲学：只测外部行为（HTTP 契约 + 重定向行为），真库（mozhou-postgres:5433）真 bcrypt。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { SESSION_COOKIE } from "@/lib/auth/session";

// 与 tests/http/global-setup.ts 的 PORT（3100）保持一致；vitest.config.ts env 也注入同一值
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-test-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";
const PASSWORD_WRONG = "wrong-password-1";
const EMAIL_OTHER = `mozhou-test-other-${RUN}@example.com`;

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
    setCookie: res.headers.get("set-cookie"),
  };
}

beforeAll(async () => {
  // 清理上次残留的测试用户，保证契约确定性
  await db.delete(users).where(like(users.email, "mozhou-test-%"));
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-test-%"));
});

describe("POST /api/v1/auth/register", () => {
  it("注册成功：201 + 会话 cookie（httpOnly）+ 密码哈希落库", async () => {
    const { status, json, setCookie } = await postJson("/api/v1/auth/register", {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(status).toBe(201);
    expect(json?.user).toMatchObject({ email: EMAIL, tier: "free" });
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, EMAIL));
    // 落库的是 bcrypt 哈希，不是明文
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row?.passwordHash).not.toContain(PASSWORD);
  });

  it("重复邮箱：409", async () => {
    const { status, json } = await postJson("/api/v1/auth/register", {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(status).toBe(409);
    expect(json?.error).toBe("该邮箱已注册，请直接登录");
  });

  it("非法入参：400（坏邮箱 / 短密码）", async () => {
    const bad = await postJson("/api/v1/auth/register", {
      email: "not-an-email",
      password: PASSWORD,
    });
    expect(bad.status).toBe(400);
    expect(bad.json?.error).toContain("邮箱");

    const short = await postJson("/api/v1/auth/register", {
      email: EMAIL_OTHER,
      password: "1234567",
    });
    expect(short.status).toBe(400);
    expect(short.json?.error).toContain("8 位");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("正确凭据：200 + 会话 cookie", async () => {
    const { status, json, setCookie } = await postJson("/api/v1/auth/login", {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(status).toBe(200);
    expect(json?.user).toMatchObject({ email: EMAIL, tier: "free" });
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
  });

  it("错误密码 / 未注册邮箱：统一 401 文案", async () => {
    const wrong = await postJson("/api/v1/auth/login", {
      email: EMAIL,
      password: PASSWORD_WRONG,
    });
    expect(wrong.status).toBe(401);
    expect(wrong.json?.error).toBe("邮箱或密码错误");

    const unknown = await postJson("/api/v1/auth/login", {
      email: `nobody-${RUN}@example.com`,
      password: PASSWORD,
    });
    expect(unknown.status).toBe(401);
    expect(unknown.json?.error).toBe("邮箱或密码错误");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("登出：200 + 清除 cookie", async () => {
    const { status, setCookie } = await postJson("/api/v1/auth/logout", {});
    expect(status).toBe(200);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
  });
});

describe("GET /api/v1/auth/logout", () => {
  it("会话失效回跳：303 + 相对 /login，不依赖代理内部 origin", async () => {
    const res = await fetch(`${BASE}/api/v1/auth/logout`, {
      redirect: "manual",
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0|Expires=/i);
  });
});

describe("受保护路由（proxy 守卫，真实 HTTP）", () => {
  async function get(path: string, cookie?: string) {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual", // 不跟随，直接断言 307
      headers: cookie ? { cookie } : {},
    });
    return { status: res.status, location: res.headers.get("location") };
  }

  it("未登录访问 /workspace → 307 到 /login?next=…", async () => {
    const { status, location } = await get("/workspace");
    expect(status).toBe(307);
    expect(location).toContain("/login?next=");
    expect(location).toContain(encodeURIComponent("/workspace"));
  });

  it("伪造 cookie → 视为未登录（307）", async () => {
    const { status, location } = await get("/workspace", "mozhou_session=forged.token.value");
    expect(status).toBe(307);
    expect(location).toContain("/login");
  });

  it("注册后携带会话 cookie 访问 /workspace → 200", async () => {
    const { setCookie } = await postJson("/api/v1/auth/register", {
      email: `mozhou-test-ws-${RUN}@example.com`,
      password: PASSWORD,
    });
    const token = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    expect(token).toBeTruthy();

    const { status } = await get("/workspace", `${SESSION_COOKIE}=${token}`);
    expect(status).toBe(200);
  });

  it("已登录访问 /login → 307 到 /workspace", async () => {
    const { setCookie } = await postJson("/api/v1/auth/login", {
      email: EMAIL,
      password: PASSWORD,
    });
    const token = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    expect(token).toBeTruthy();

    const { status, location } = await get("/login", `${SESSION_COOKIE}=${token}`);
    expect(status).toBe(307);
    expect(location).toContain("/workspace");
  });

  it("用户被删后携带旧 cookie 访问 /workspace → 收敛到 /login（无死循环）", async () => {
    // 注册一个用户并删除，模拟会话失效
    const { setCookie } = await postJson("/api/v1/auth/register", {
      email: `mozhou-test-stale-${RUN}@example.com`,
      password: PASSWORD,
    });
    const token = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    expect(token).toBeTruthy();
    await db
      .delete(users)
      .where(eq(users.email, `mozhou-test-stale-${RUN}@example.com`));

    // /workspace → 307 logout → 303 /login（cookie 已被清）
    const hop1 = await fetch(`${BASE}/workspace`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect([307, 308]).toContain(hop1.status);
    const hop2 = await fetch(new URL(hop1.headers.get("location")!, BASE), {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(hop2.status).toBe(303);
    expect(hop2.headers.get("location")).toBe("/login");
    expect(hop2.headers.get("set-cookie")).toMatch(/Max-Age=0|Expires=/i);
  });
});
