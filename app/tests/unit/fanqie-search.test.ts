import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFanqie, __resetMsTokenCacheForTests } from "@/lib/search/fanqie";

function routeFetch(routes: Record<string, { ok: boolean; text: string; headers?: Record<string, string> }>) {
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("https://fanqienovel.com/")) {
      const hit = Object.keys(routes).filter((k) => k !== "fanqienovel.com/").find((k) => url.includes(k));
      const r = hit ? routes[hit] : routes["fanqienovel.com/"];
      if (r) return { ok: r.ok, text: async () => r.text, headers: { get: (k: string) => r.headers?.[k] ?? null } } as unknown as Response;
    }
    const r = routes["__default__"] ?? { ok: true, text: "" };
    return { ok: r.ok, text: async () => r.text, headers: { get: (k: string) => r.headers?.[k] ?? null } } as unknown as Response;
  }));
}


beforeAll(() => {
  process.env.FANQIE_SEARCH_MOCK_SAVED = process.env.FANQIE_SEARCH_MOCK;
  delete process.env.FANQIE_SEARCH_MOCK; // 本组为纯解析单测（fetch 已桩），mock 短路会掩盖真实路径
});
afterAll(() => {
  const v = process.env.FANQIE_SEARCH_MOCK_SAVED;
  if (v === undefined) delete process.env.FANQIE_SEARCH_MOCK;
  else process.env.FANQIE_SEARCH_MOCK = v;
  delete process.env.FANQIE_SEARCH_MOCK_SAVED;
});

describe("T6 番茄搜索包装", () => {
  beforeEach(() => __resetMsTokenCacheForTests());
  afterEach(() => vi.unstubAllGlobals());

  const home = { ok: true, text: "", headers: { "x-ms-token": "tok123" } };

  it("成功路径：解析 code:0 的图书列表并清洗 PUA", async () => {
    routeFetch({
      "fanqienovel.com/": home,
      "search_book": { ok: true, text: JSON.stringify({ code: 0, data: { search_book_data_list: [
        { book_id: "1", book_name: "\uE49C枝", author: "空留" },
        { book_id: "2", book_name: "凡人修仙传", author: "忘语" },
      ] } }) },
      "fanqienovel.com/page/1": { ok: true, text: JSON.stringify({ bookName: "惹金枝", author: "空留", category: "古风" }) },
    });
    const out = await searchFanqie("惹金枝");
    expect(out.ok).toBe(true);
    expect(out.books.length).toBe(2);
    expect(out.books[0].bookId).toBe("1");
    expect(out.books[1].name).toBe("凡人修仙传");
  });

  it("PUA 书名触发详情页解码", async () => {
    routeFetch({
      "fanqienovel.com/": home,
      "search_book": { ok: true, text: JSON.stringify({ code: 0, data: { search_book_data_list: [{ book_id: "9", book_name: "\uE49C\uE49C枝" }] } }) },
      "fanqienovel.com/page/9": { ok: true, text: JSON.stringify({ bookName: "惹金枝", author: "空留", category: "古风" }) },
    });
    const out = await searchFanqie("x");
    expect(out.books[0].name).toBe("惹金枝");
    expect(out.books[0].author).toBe("空留");
    expect(out.books[0].category).toBe("古风");
  });

  it("空 body（风控）→ degraded", async () => {
    routeFetch({ "fanqienovel.com/": home, "search_book": { ok: true, text: "" } });
    const out = await searchFanqie("x");
    expect(out.degraded).toBe(true);
    expect(out.books).toEqual([]);
  });

  it("code!=0 → degraded", async () => {
    routeFetch({ "fanqienovel.com/": home, "search_book": { ok: true, text: JSON.stringify({ code: 2001 }) } });
    const out = await searchFanqie("x");
    expect(out.degraded).toBe(true);
    expect(out.note).toContain("2001");
  });

  it("msToken 缺失 → degraded", async () => {
    routeFetch({ "fanqienovel.com/": { ok: true, text: "", headers: {} } });
    const out = await searchFanqie("x");
    expect(out.degraded).toBe(true);
  });
});
