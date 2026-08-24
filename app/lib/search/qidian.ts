import { decodeHtml, fetchText, responseNote } from "./provider-utils";

export interface QidianSearchBook {
  bookId: string;
  name: string;
  author: string | null;
  category: string | null;
  status: string | null;
  url: string;
}

export interface QidianSearchOutcome {
  books: QidianSearchBook[];
  ok: boolean;
  degraded: boolean;
  note?: string;
}

const SEARCH_URL = "https://m.qidian.com/search?kw=";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

function firstMatch(html: string, expression: RegExp): string {
  return decodeHtml(html.match(expression)?.[1] ?? "");
}

function parseCards(html: string): QidianSearchBook[] {
  const books: QidianSearchBook[] = [];
  const cardRe = /<a\b[^>]*data-bid=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(cardRe)) {
    const bookId = match[1] ?? "";
    const card = match[2] ?? "";
    const name = firstMatch(card, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    const author = firstMatch(card, /<p\b[^>]*class=["'][^"']*searchBookAuthor[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const tagBlock = card.match(/<div\b[^>]*class=["'][^"']*tags[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const tags = [...tagBlock.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((item) => decodeHtml(item[1] ?? ""));
    if (!bookId || !name || !author) continue;
    books.push({
      bookId,
      name,
      author,
      category: tags[0] || null,
      status: tags[1] || null,
      url: `https://m.qidian.com/book/${bookId}/`,
    });
    // The mobile endpoint currently returns ten cards; avoid accidental template duplicates.
    if (books.length >= 20) break;
  }
  return books;
}

export async function searchQidian(query: string): Promise<QidianSearchOutcome> {
  const q = query.trim();
  if (!q) return { books: [], ok: true, degraded: false };
  const response = await fetchText(
    SEARCH_URL + encodeURIComponent(q),
    { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
  );
  if (!response.ok) {
    return { books: [], ok: false, degraded: true, note: responseNote("起点", response.status, response.error) };
  }
  try {
    return { books: parseCards(response.body), ok: true, degraded: false };
  } catch (error) {
    return { books: [], ok: false, degraded: true, note: error instanceof Error ? error.message : String(error) };
  }
}
