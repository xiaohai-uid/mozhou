// 本地书目检索（T5）：在扫榜积累的书目库内做书名/作者模糊匹配。
// 纯函数，无数据库依赖；输入为去重书目数组。

export interface BookEntry {
  bookId: string;
  name: string;
  author: string | null;
  category: string | null;
}

export interface BookMatch {
  book: BookEntry;
  score: number; // 命中度：书名前缀=3，书名包含=2，作者包含=1
}

/** 归一化：去空白、全角转半角、转小写（英文场景） */
export function normalize(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, "")
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

export function matchBooks(books: BookEntry[], query: string, limit = 20): BookMatch[] {
  const q = normalize(query);
  if (!q) return [];
  const hits: BookMatch[] = [];
  for (const book of books) {
    const name = normalize(book.name);
    const author = normalize(book.author ?? "");
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else if (author.includes(q)) score = 1;
    if (score > 0) hits.push({ book, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.book.name.localeCompare(b.book.name)).slice(0, limit);
}
