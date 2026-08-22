// 契约测试：GET /api/v1/health（工单 D，商用阻断项——部署探测与可观测性挂载点）
import { describe, it, expect } from "vitest";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";

describe("GET /api/v1/health", () => {
  it("200 { ok: true, db: 'up' }，含进程存活秒数", async () => {
    const res = await fetch(`${BASE}/api/v1/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; db: string; uptimeSec: number };
    expect(json.ok).toBe(true);
    expect(json.db).toBe("up");
    expect(json.uptimeSec).toBeGreaterThanOrEqual(0);
  });
});
