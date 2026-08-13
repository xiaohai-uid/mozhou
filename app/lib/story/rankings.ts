export type RankingMode = "long" | "short";
export type RankingAdapter = "fanqie" | "external_source";
export type RankingAvailability = "native_partial" | "external_source_required";

export interface RankingCategory {
  id: string;
  name: string;
  url: string;
}

export interface RankingBoard {
  id: string;
  name: string;
  site: string;
  url: string;
  mode: RankingMode;
  adapter: RankingAdapter;
  availability: RankingAvailability;
  categories: RankingCategory[];
}

export interface RankingRow {
  rank: number;
  name: string;
  heat: string;
  source: string;
  capturedAt: string;
  url: string;
}

export interface ResolvedRankingRows {
  rows: RankingRow[];
  degraded: boolean;
  degradationReason?: string;
}

const fanqieCategories = {
  male: [
    ["1141", "西方奇幻"], ["1140", "东方仙侠"], ["8", "科幻末世"], ["261", "都市日常"],
    ["124", "都市修真"], ["1014", "都市高武"], ["273", "历史古代"], ["27", "战神赘婿"],
    ["263", "都市种田"], ["258", "传统玄幻"], ["272", "历史脑洞"], ["539", "悬疑脑洞"],
    ["262", "都市脑洞"], ["257", "玄幻脑洞"], ["751", "悬疑灵异"], ["504", "抗战谍战"],
    ["746", "游戏体育"], ["718", "动漫衍生"], ["1016", "男频衍生"],
  ],
  female: [
    ["1139", "古风世情"], ["8", "科幻末世"], ["746", "游戏体育"], ["1015", "女频衍生"],
    ["248", "玄幻言情"], ["23", "种田"], ["79", "年代"], ["267", "现言脑洞"],
    ["246", "宫斗宅斗"], ["539", "悬疑脑洞"], ["253", "古言脑洞"], ["24", "快穿"],
    ["749", "青春甜宠"], ["745", "星光璀璨"], ["747", "女频悬疑"], ["750", "职场婚恋"],
    ["748", "豪门总裁"], ["1017", "民国言情"],
  ],
} as const;

function fanqieBoard(
  id: string,
  name: string,
  channel: "0" | "1",
  type: "1" | "2",
  categories: readonly (readonly [string, string])[],
): RankingBoard {
  const mapped = categories.map(([categoryId, categoryName]) => ({
    id: categoryId,
    name: categoryName,
    url: `https://fanqienovel.com/rank/${channel}_${type}_${categoryId}`,
  }));
  return {
    id,
    name,
    site: "番茄小说",
    url: mapped[0].url,
    mode: "long",
    adapter: "fanqie",
    availability: "native_partial",
    categories: mapped,
  };
}

function externalBoard(
  id: string,
  name: string,
  site: string,
  url: string,
  mode: RankingMode,
): RankingBoard {
  return { id, name, site, url, mode, adapter: "external_source", availability: "external_source_required", categories: [] };
}

export const FANQIE_BOARDS: RankingBoard[] = [
  fanqieBoard("fanqie-female-reading", "番茄女频阅读榜", "0", "2", fanqieCategories.female),
  fanqieBoard("fanqie-male-reading", "番茄男频阅读榜", "1", "2", fanqieCategories.male),
  fanqieBoard("fanqie-female-new", "番茄女频新书榜", "0", "1", fanqieCategories.female),
  fanqieBoard("fanqie-male-new", "番茄男频新书榜", "1", "1", fanqieCategories.male),
];

const QIDIAN_BOARDS: RankingBoard[] = [
  ["newsign", "新人签约新书榜"], ["signnewbook", "签约作者新书榜"], ["pubnewbook", "公众作者新书榜"],
  ["newauthor", "新人作者新书榜"], ["sanjiang", "三江推荐"], ["yuepiao", "月票榜"],
  ["hotsales", "畅销榜"], ["readindex", "阅读指数榜"], ["collect", "收藏榜"], ["recom", "原创推荐榜"],
].map(([id, name]) => externalBoard(`qidian-${id}`, `起点${name}`, "起点中文网", `https://www.qidian.com/${id === "sanjiang" ? "sanjiang" : `rank/${id}`}/`, "long"));

const QIMAO_BOARDS: RankingBoard[] = ["大热榜（日榜）", "大热榜（月榜）", "新书榜", "完结榜", "收藏榜", "更新榜"].map((name, index) =>
  externalBoard(`qimao-${index}`, `七猫${name}`, "七猫小说", "https://www.qimao.com/paihang", "long"));

const JINJIANG_BOARDS: RankingBoard[] = [
  ["12", "收入金榜"], ["7", "月榜"], ["8", "季度榜"], ["14", "完结金榜"], ["15", "新手金榜"], ["17", "千字金榜"],
].map(([id, name]) => externalBoard(`jjwxc-${id}`, `晋江${name}`, "晋江文学城", `https://www.jjwxc.net/topten.php?orderstr=${id}&t=0`, "long"));

const CIWEMAO_BOARDS: RankingBoard[] = ["点击榜", "收藏榜", "推荐榜", "订阅榜", "月票榜", "吐槽榜", "新书榜", "刀片榜", "更新榜"].map((name, index) =>
  externalBoard(`ciweimao-${index}`, `刺猬猫${name}`, "刺猬猫", "https://www.ciweimao.com/rank-index", "long"));

const SHORT_BOARDS: RankingBoard[] = [
  externalBoard("zhihu-yanyan", "知乎盐言故事热门榜", "知乎盐言", "https://www.zhihu.com/market/paid_column", "short"),
  externalBoard("qimao-short-hot", "七猫短篇大热榜", "七猫小说", "https://www.qimao.com/paihang", "short"),
  externalBoard("heiyan-short", "黑岩短篇书库", "黑岩", "https://manage.zhangwenpindu.cn/books/booklist", "short"),
  externalBoard("dianzhong-male", "点众男频短篇", "点众", "https://www.ishugui.com/browse", "short"),
  externalBoard("dianzhong-female", "点众女频短篇", "点众", "https://www.ishugui.com/browse/on3", "short"),
];

export const RANKING_BOARDS: RankingBoard[] = [
  ...FANQIE_BOARDS,
  ...QIDIAN_BOARDS,
  ...QIMAO_BOARDS,
  ...JINJIANG_BOARDS,
  ...CIWEMAO_BOARDS,
  ...SHORT_BOARDS,
];

const PUA_RE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

export function isValidRankingTitle(title: string): boolean {
  const normalized = decodeHtmlText(title);
  return normalized.length > 0 && normalized.length <= 120 && !PUA_RE.test(normalized);
}

export function extractFanqieBookCards(html: string): Array<{ bookId: string; listTitle: string }> {
  const cards: Array<{ bookId: string; listTitle: string }> = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']\/page\/([^?"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const bookId = match[1];
    if (!bookId || seen.has(bookId)) continue;
    seen.add(bookId);
    cards.push({ bookId, listTitle: decodeHtmlText(match[2]) });
  }
  if (cards.length > 0) return cards;

  const jsonRe = /"bookId"\s*:\s*"([^"\\]+)"[\s\S]{0,500}?"bookName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  for (const match of html.matchAll(jsonRe)) {
    const bookId = match[1];
    if (!bookId || seen.has(bookId)) continue;
    seen.add(bookId);
    cards.push({ bookId, listTitle: decodeJsonString(match[2]) });
  }
  return cards;
}

export function extractFanqieDetailTitle(html: string): string | null {
  const jsonMatch = html.match(/"bookName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  const jsonTitle = jsonMatch ? decodeJsonString(jsonMatch[1]) : "";
  if (isValidRankingTitle(jsonTitle)) return decodeHtmlText(jsonTitle);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)(?:完整版|最新章节|在线阅读|_番茄小说|-番茄小说|_番茄|-番茄)/i);
  const title = titleMatch ? decodeHtmlText(titleMatch[1]) : "";
  return isValidRankingTitle(title) ? title : null;
}

export async function resolveFanqieRankingRows(input: {
  boardUrl: string;
  capturedAt: string;
  listHtml: string;
  fetchDetail: (bookId: string) => Promise<string>;
}): Promise<ResolvedRankingRows> {
  const cards = extractFanqieBookCards(input.listHtml).slice(0, 10);
  if (cards.length === 0) return { rows: [], degraded: true, degradationReason: "榜单列表未解析出作品" };

  const details = await Promise.all(cards.map(async (card) => {
    try {
      const title = extractFanqieDetailTitle(await input.fetchDetail(card.bookId));
      return title ? { card, title } : null;
    } catch {
      return null;
    }
  }));
  const valid = details.filter((item): item is { card: { bookId: string; listTitle: string }; title: string } => item !== null);
  const rows = valid.slice(0, 5).map((item, index) => ({
    rank: index + 1,
    name: item.title,
    heat: "—",
    source: "fanqienovel.com",
    capturedAt: input.capturedAt,
    url: `https://fanqienovel.com/page/${item.card.bookId}`,
  }));
  const ratio = valid.length / cards.length;
  const degraded = ratio < 0.8;
  return {
    rows,
    degraded,
    ...(degraded ? { degradationReason: `详情页标题解析质量不足（${valid.length}/${cards.length}）` } : {}),
  };
}

export function findRankingBoard(value: string | null): RankingBoard {
  return RANKING_BOARDS.find((board) => board.id === value || board.name === value) ?? RANKING_BOARDS[0];
}
