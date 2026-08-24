import { afterEach, describe, expect, it, vi } from "vitest";
import { searchJjwxc } from "@/lib/search/jjwxc";
import { searchQidian } from "@/lib/search/qidian";
import { searchQimao } from "@/lib/search/qimao";

function response(input: { body: string; status?: number }) {
  const status = input.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => input.body,
    json: async () => JSON.parse(input.body),
  } as unknown as Response;
}

describe("多平台书源搜索适配器", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("解析起点移动端 SSR 搜索卡片", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      body: `<a data-bid="1209977" href="//m.qidian.com/chapter/1209977/0/">
        <h2><mark>斗破</mark>苍穹</h2><p class="_searchBookDesc">斗气大陆的故事</p>
        <p class="_searchBookAuthor">天蚕土豆</p><div class="_tags"><p>玄幻</p><p>完结</p><p>533.23万字</p></div>
      </a>`,
    })));

    const out = await searchQidian("斗破苍穹");

    expect(out).toMatchObject({ ok: true, degraded: false });
    expect(out.books).toEqual([
      expect.objectContaining({
        bookId: "1209977",
        name: "斗破苍穹",
        author: "天蚕土豆",
        category: "玄幻",
        status: "完结",
        url: "https://m.qidian.com/book/1209977/",
      }),
    ]);
  });

  it("解析七猫官方搜索 API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      body: JSON.stringify({
        data: {
          search_list: [{
            book_id: "1784900",
            title: "斗破苍穹",
            author: "天蚕土豆",
            category2_name: "异世大陆",
            is_over_txt: "完结",
            read_url: "https://www.qimao.com/shuku/1784900/",
          }],
        },
      }),
    })));

    const out = await searchQimao("斗破苍穹");

    expect(out.books).toEqual([
      expect.objectContaining({
        bookId: "1784900",
        name: "斗破苍穹",
        author: "天蚕土豆",
        category: "异世大陆",
        status: "完结",
        url: "https://www.qimao.com/shuku/1784900/",
      }),
    ]);
  });

  it("解析晋江官方搜索 API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      body: JSON.stringify({
        status: 200,
        data: [{ novelid: 2771073, novelname: "默读", authorname: "priest" }],
      }),
    })));

    const out = await searchJjwxc("默读");

    expect(out.books).toEqual([
      expect.objectContaining({
        bookId: "2771073",
        name: "默读",
        author: "priest",
        url: "https://www.jjwxc.net/onebook.php?novelid=2771073",
      }),
    ]);
  });

  it("上游失败时每个平台都明确降级而不是返回样例", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ body: "", status: 503 })));

    const [qidian, qimao, jjwxc] = await Promise.all([
      searchQidian("x"),
      searchQimao("x"),
      searchJjwxc("x"),
    ]);

    for (const outcome of [qidian, qimao, jjwxc]) {
      expect(outcome.ok).toBe(false);
      expect(outcome.degraded).toBe(true);
      expect(outcome.books).toEqual([]);
    }
  });
});
