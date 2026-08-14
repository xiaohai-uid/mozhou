import { describe, it, expect } from "vitest";
import { matchBooks, normalize, type BookEntry } from "@/lib/search/bookIndex";

const books: BookEntry[] = [
  { bookId: "1", name: "惹金枝", author: "空留", category: "古风世情" },
  { bookId: "2", name: "笨蛋美人替嫁后被疯批王爷宠上天", author: "莫栖君", category: null },
  { bookId: "3", name: "掌上娇娇", author: "夜阑听雨", category: "古风世情" },
  { bookId: "4", name: "攀高枝", author: "青花鱼", category: null },
  { bookId: "5", name: "剑宗小魔童，三岁半超凶", author: "佚名", category: "玄幻言情" },
];

describe("T5 本地书目检索", () => {
  it("书名前缀命中优先（score 3）", () => {
    const hits = matchBooks(books, "惹金");
    expect(hits[0].book.bookId).toBe("1");
    expect(hits[0].score).toBe(3);
  });

  it("书名包含命中（score 2）", () => {
    const hits = matchBooks(books, "娇娇");
    expect(hits[0].book.bookId).toBe("3");
    expect(hits[0].score).toBe(2);
  });

  it("作者包含命中（score 1）", () => {
    const hits = matchBooks(books, "空留");
    expect(hits.some((h) => h.book.bookId === "1")).toBe(true);
    expect(hits[0].score).toBe(1);
  });

  it("无命中返回空数组", () => {
    expect(matchBooks(books, "不存在的小说")).toEqual([]);
  });

  it("空查询返回空数组", () => {
    expect(matchBooks(books, "   ")).toEqual([]);
  });

  it("归一化：全角与空白不影响匹配", () => {
    expect(normalize("剑宗小魔童，三岁半超凶")).toBe("剑宗小魔童,三岁半超凶"); // 全角转半角
    const hits = matchBooks(books, " 剑宗 小魔童 ");
    expect(hits[0].book.bookId).toBe("5");
  });

  it("limit 生效", () => {
    const many: BookEntry[] = Array.from({ length: 30 }, (_, i) => ({ bookId: String(i), name: "测试书" + i, author: null, category: null }));
    expect(matchBooks(many, "测试", 10)).toHaveLength(10);
  });
});
