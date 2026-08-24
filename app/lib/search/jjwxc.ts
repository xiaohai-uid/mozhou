import { fetchText, responseNote } from "./provider-utils";

export interface JjwxcSearchBook {
  bookId: string;
  name: string;
  author: string | null;
  category: string | null;
  status: string;
  url: string;
}

export interface JjwxcSearchOutcome {
  books: JjwxcSearchBook[];
  ok: boolean;
  degraded: boolean;
  note?: string;
}

const SEARCH_URL = "https://www.jjwxc.net/search/search_ajax.php?action=search&type=1&version=1&getfull=1&keywords=";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36";

export async function searchJjwxc(query: string): Promise<JjwxcSearchOutcome> {
  const q = query.trim();
  if (!q) return { books: [], ok: true, degraded: false };
  const response = await fetchText(
    SEARCH_URL + encodeURIComponent(q),
    { "user-agent": UA, accept: "application/json", referer: "https://www.jjwxc.net/search.php" },
  );
  if (!response.ok) {
    return { books: [], ok: false, degraded: true, note: responseNote("晋江", response.status, response.error) };
  }
  try {
    const json = JSON.parse(response.body) as {
      status?: number;
      data?: Array<{ novelid?: string | number; novelname?: string; authorname?: string }>;
    };
    const books = (json.data ?? []).map((book) => {
      const bookId = String(book.novelid ?? "");
      return {
        bookId,
        name: book.novelname?.trim() ?? "",
        author: book.authorname?.trim() || null,
        category: null,
        status: "搜索结果",
        url: `https://www.jjwxc.net/onebook.php?novelid=${bookId}`,
      } satisfies JjwxcSearchBook;
    }).filter((book) => book.bookId && book.name && book.author);
    return { books, ok: json.status === undefined || json.status === 200, degraded: false };
  } catch (error) {
    return { books: [], ok: false, degraded: true, note: error instanceof Error ? error.message : String(error) };
  }
}
