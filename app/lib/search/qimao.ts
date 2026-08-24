import { fetchText, responseNote } from "./provider-utils";

export interface QimaoSearchBook {
  bookId: string;
  name: string;
  author: string | null;
  category: string | null;
  status: string | null;
  url: string;
}

export interface QimaoSearchOutcome {
  books: QimaoSearchBook[];
  ok: boolean;
  degraded: boolean;
  note?: string;
}

const SEARCH_URL = "https://www.qimao.com/api/search/result?keyword=";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36";

export async function searchQimao(query: string): Promise<QimaoSearchOutcome> {
  const q = query.trim();
  if (!q) return { books: [], ok: true, degraded: false };
  const response = await fetchText(
    `${SEARCH_URL}${encodeURIComponent(q)}&page=1&page_size=15`,
    { "user-agent": UA, accept: "application/json", referer: "https://www.qimao.com/search/index/" },
  );
  if (!response.ok) {
    return { books: [], ok: false, degraded: true, note: responseNote("七猫", response.status, response.error) };
  }
  try {
    const json = JSON.parse(response.body) as {
      data?: {
        search_list?: Array<{
          book_id?: string | number;
          title?: string;
          author?: string;
          category2_name?: string;
          is_over_txt?: string;
          read_url?: string;
        }>;
      };
    };
    const books = (json.data?.search_list ?? []).map((book) => {
      const bookId = String(book.book_id ?? "");
      return {
        bookId,
        name: book.title?.trim() ?? "",
        author: book.author?.trim() || null,
        category: book.category2_name?.trim() || null,
        status: book.is_over_txt?.trim() || null,
        url: book.read_url?.trim() || `https://www.qimao.com/shuku/${bookId}/`,
      } satisfies QimaoSearchBook;
    }).filter((book) => book.bookId && book.name && book.author);
    return { books, ok: true, degraded: false };
  } catch (error) {
    return { books: [], ok: false, degraded: true, note: error instanceof Error ? error.message : String(error) };
  }
}
