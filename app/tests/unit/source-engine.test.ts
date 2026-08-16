import { afterEach, describe, expect, it, vi } from "vitest";
import { searchSources } from "@/lib/source/engine";

function response(body: string, status = 200, token?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: { get: (name: string) => name.toLowerCase() === "x-ms-token" ? token ?? null : null },
  } as unknown as Response;
}

describe("书源引擎", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("并行返回起点、番茄、七猫、晋江的真实元数据", async () => {
    vi.stubEnv("SOURCE_PROVIDER", "live");
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("m.qidian.com/search")) {
        return response(`<a data-bid="1209977"><h2>起点书</h2><p class="_searchBookAuthor">起点作者</p><div class="_tags"><p>玄幻</p><p>连载</p></div></a>`);
      }
      if (url.includes("fanqienovel.com/api/author/search")) {
        return response(JSON.stringify({ code: 0, data: { search_book_data_list: [{ book_id: "f1", book_name: "番茄书", author: "番茄作者", category: "都市" }] } }));
      }
      if (url.includes("fanqienovel.com/")) return response("", 200, "token");
      if (url.includes("qimao.com/api/search/result")) {
        return response(JSON.stringify({ data: { search_list: [{ book_id: "m1", title: "七猫书", author: "七猫作者", category2_name: "言情", is_over_txt: "完结" }] } }));
      }
      if (url.includes("jjwxc.net/search/search_ajax")) {
        return response(JSON.stringify({ status: 200, data: [{ novelid: "j1", novelname: "晋江书", authorname: "晋江作者" }] }));
      }
      return response("", 404);
    }));

    const out = await searchSources("测试书");

    expect(out.degraded).toBe(false);
    expect(out.results.map((book) => book.source)).toEqual(["qidian", "fanqie", "qimao", "jjwxc"]);
    expect(out.results.map((book) => book.bookId)).toEqual(["1209977", "f1", "m1", "j1"]);
  });

  it("部分源失败时保留可用结果并标记 degraded", async () => {
    vi.stubEnv("SOURCE_PROVIDER", "live");
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("m.qidian.com/search")) return response("", 503);
      if (url.includes("fanqienovel.com/api/author/search")) {
        return response(JSON.stringify({ code: 0, data: { search_book_data_list: [{ book_id: "f1", book_name: "番茄书", author: "番茄作者" }] } }));
      }
      if (url.includes("fanqienovel.com/")) return response("", 200, "token");
      return response(JSON.stringify({ data: { search_list: [] } }));
    }));

    const out = await searchSources("测试书");

    expect(out.degraded).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.source).toBe("fanqie");
  });
});
