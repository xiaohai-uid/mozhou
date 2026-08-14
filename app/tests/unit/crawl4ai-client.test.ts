import { describe, it, expect, vi, afterEach } from "vitest";
import { crawlUrl } from "@/lib/crawl4ai/client";

describe("T7 crawl4ai 客户端", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("成功路径：解析 fit_markdown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, results: [{ url: "https://x", markdown: { fit_markdown: "内容" } }] }),
    })));
    const out = await crawlUrl("https://x");
    expect(out.ok).toBe(true);
    expect(out.results[0].markdown).toBe("内容");
  });

  it("HTTP 失败 → ok=false + error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    const out = await crawlUrl("https://x");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("500");
  });

  it("wait_for 传入结构正确", async () => {
    const fn = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, results: [] }) }));
    vi.stubGlobal("fetch", fn);
    await crawlUrl("https://x", { type: "js", query: "return 1" });
    const [, init] = fn.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.wait_for.query).toBe("return 1");
    expect(body.wait_for.type).toBe("js");
  });
});
