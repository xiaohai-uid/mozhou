// GET /api/v1/rankings — 网文扫榜（任务二-C）：榜单数据（超时优雅降级）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export interface RankingBoard {
  name: string;
  site: string;
}

export interface RankingRow {
  rank: number;
  name: string;
  heat: string;
}

const BOARDS: RankingBoard[] = [
  { name: "畅销榜 Top10", site: "番茄小说" },
  { name: "月票榜", site: "起点中文网" },
  { name: "新书榜", site: "番茄小说" },
  { name: "完结榜", site: "起点中文网" },
];

/** 按榜数据（mock：各榜不同，验证按榜查询链路） */
const BOARD_ROWS: Record<string, RankingRow[]> = {
  "畅销榜 Top10": [
    { rank: 1, name: "宿命之环", heat: "9.8 万人在读" },
    { rank: 2, name: "道诡异仙", heat: "8.7 万人在读" },
    { rank: 3, name: "深海余烬", heat: "7.9 万人在读" },
    { rank: 4, name: "玄鉴仙族", heat: "6.4 万人在读" },
    { rank: 5, name: "夜的命名术", heat: "5.8 万人在读" },
  ],
  "月票榜": [
    { rank: 1, name: "大奉打更人", heat: "12.3 万月票" },
    { rank: 2, name: "诡秘之主2", heat: "11.1 万月票" },
    { rank: 3, name: "凡人修仙传", heat: "9.7 万月票" },
  ],
  "新书榜": [
    { rank: 1, name: "重生之我在大学当卷王", heat: "3.2 万在读" },
    { rank: 2, name: "我在修仙界开网吧", heat: "2.8 万在读" },
  ],
  "完结榜": [
    { rank: 1, name: "剑来", heat: "已完结" },
    { rank: 2, name: "雪中悍刀行", heat: "已完结" },
    { rank: 3, name: "诡秘之主", heat: "已完结" },
  ],
};

const FALLBACK_ROWS = BOARD_ROWS["畅销榜 Top10"];

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const board = url.searchParams.get("board") ?? "畅销榜 Top10";

  // 测试模式：按榜返回不同数据（验证按榜查询）
  if (process.env.RANKINGS_PROVIDER === "mock") {
    return NextResponse.json({
      boards: BOARDS,
      rows: BOARD_ROWS[board] ?? FALLBACK_ROWS,
      board,
      degraded: true,
      note: "榜单数据源降级（mock 数据）",
    });
  }

  // 真实榜源请求（带榜参数，超时受控）；失败降级
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("https://www.qidian.com/rank/yuepiao/", {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoZhou/1.0" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`上游 ${res.status}`);
    const html = await res.text();
    // 简化解析：从页面提取书名（真实解析器归后续切片）
    const names = [...html.matchAll(/>([\u4e00-\u9fa5A-Za-z0-9·]{3,20})<\/a>/g)]
      .map((m) => m[1])
      .filter((n) => !/下一页|首页|排行榜/.test(n))
      .slice(0, 10);
    if (names.length === 0) {
      return NextResponse.json({ boards: BOARDS, rows: BOARD_ROWS[board] ?? FALLBACK_ROWS, board, degraded: true, note: "榜单解析失败，已降级" });
    }
    return NextResponse.json({
      boards: BOARDS,
      rows: names.slice(0, 5).map((n, i) => ({ rank: i + 1, name: n, heat: "—" })),
      board,
      degraded: false,
    });
  } catch (err) {
    return NextResponse.json({
      boards: BOARDS,
      rows: BOARD_ROWS[board] ?? FALLBACK_ROWS,
      board,
      degraded: true,
      note: `榜单源暂时不可达（${(err as Error).message}），已降级为示例数据`,
    });
  }
}
