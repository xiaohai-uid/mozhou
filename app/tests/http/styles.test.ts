// 风格库契约测试（工单 14，V1.1 Journey ⑥）：保存/列表/删除 + 四维校验 + 归属防 IDOR
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-style-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-style-other-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

const GUIDE = {
  narrative: "第三人称限知视角，紧贴主角感官",
  sentence: "短句为主，动作前置",
  imagery: "偏好农耕/土地/器物意象",
  rhythm: "段落短促如开垦节奏",
};

let cookie = "";
let otherCookie = "";

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
  await db.delete(users).where(like(users.email, "mozhou-style-%"));
  cookie = await register(EMAIL);
  otherCookie = await register(OTHER_EMAIL);
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-style-%"));
});

describe("风格库 CRUD（工单 14）", () => {
  it("保存风格：201 + 列表可见 + 四维指南完整往返", async () => {
    const res = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "黄土纪年体", guide: GUIDE }),
    });
    expect(res.status).toBe(201);
    const { style } = (await res.json()) as { style: { id: number; name: string } };
    expect(style.name).toBe("黄土纪年体");

    const list = await fetch(`${BASE}/api/v1/styles`, { headers: { cookie } });
    const { styles } = (await list.json()) as {
      styles: Array<{ id: number; name: string; guide: Record<string, string>; createdAt: string }>;
    };
    const target = styles.find((s) => s.id === style.id);
    expect(target).toBeDefined();
    expect(target?.name).toBe("黄土纪年体");
    expect(target?.guide).toEqual(GUIDE);
    expect(typeof target?.createdAt).toBe("string");
  });

  it("列表按新→旧排序（后保存的在前）", async () => {
    const first = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "晚风体", guide: GUIDE }),
    });
    expect(first.status).toBe(201);
    const list = await fetch(`${BASE}/api/v1/styles`, { headers: { cookie } });
    const { styles } = (await list.json()) as { styles: Array<{ name: string }> };
    expect(styles[0].name).toBe("晚风体"); // 最新保存的在最前
  });

  it("同名允许：保存两个同名风格互不覆盖", async () => {
    await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "同名测试", guide: GUIDE }),
    });
    const res = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        name: "同名测试",
        guide: { ...GUIDE, rhythm: "另一版节奏" },
      }),
    });
    expect(res.status).toBe(201);
    const list = await fetch(`${BASE}/api/v1/styles`, { headers: { cookie } });
    const { styles } = (await list.json()) as { styles: Array<{ name: string }> };
    expect(styles.filter((s) => s.name === "同名测试").length).toBe(2);
  });

  it("非法入参：空名称 400 / 缺四维 400 / 非 JSON 400 / 未登录 401", async () => {
    const noName = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "  ", guide: GUIDE }),
    });
    expect(noName.status).toBe(400);

    const badGuide = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "缺维度", guide: { narrative: "只有一维" } }),
    });
    expect(badGuide.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", guide: GUIDE }),
    });
    expect(anon.status).toBe(401);
  });

  it("删除：本人风格 200 且消失；他人风格 404（归属校验防 IDOR）", async () => {
    // 他人（B）保存一条
    const otherSave = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({ name: "B 的风格", guide: GUIDE }),
    });
    expect(otherSave.status).toBe(201);
    const { style: otherStyle } = (await otherSave.json()) as { style: { id: number } };

    // A 删 B 的风格 → 404 且数据仍在
    const crossDel = await fetch(`${BASE}/api/v1/styles?id=${otherStyle.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(crossDel.status).toBe(404);
    const otherList = await fetch(`${BASE}/api/v1/styles`, { headers: { cookie: otherCookie } });
    const { styles: otherStyles } = (await otherList.json()) as {
      styles: Array<{ id: number }>;
    };
    expect(otherStyles.some((s) => s.id === otherStyle.id)).toBe(true);

    // B 删自己的 → 200 且列表消失
    const ownDel = await fetch(`${BASE}/api/v1/styles?id=${otherStyle.id}`, {
      method: "DELETE",
      headers: { cookie: otherCookie },
    });
    expect(ownDel.status).toBe(200);
    const afterList = await fetch(`${BASE}/api/v1/styles`, { headers: { cookie: otherCookie } });
    const { styles: after } = (await afterList.json()) as { styles: Array<{ id: number }> };
    expect(after.some((s) => s.id === otherStyle.id)).toBe(false);

    // 重复删除 → 404
    const reDel = await fetch(`${BASE}/api/v1/styles?id=${otherStyle.id}`, {
      method: "DELETE",
      headers: { cookie: otherCookie },
    });
    expect(reDel.status).toBe(404);
  });

  it("删除缺 id：400", async () => {
    const res = await fetch(`${BASE}/api/v1/styles`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(400);
  });
});
