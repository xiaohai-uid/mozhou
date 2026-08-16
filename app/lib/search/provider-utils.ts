const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: ctrl.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status ?? 0, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

export function responseNote(site: string, status: number, error?: string): string {
  if (status > 0) return `${site}搜索上游 ${status}`;
  return `${site}搜索失败${error ? `：${error}` : ""}`;
}
