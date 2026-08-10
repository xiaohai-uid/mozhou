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

/** 降级数据（外部榜源不可达） */
const FALLBACK_ROWS: RankingRow[] = [
  { rank: 1, name: "宿命之环", heat: "9.8 万人在读" },
  { rank: 2, name: "道诡异仙", heat: "8.7 万人在读" },
  { rank: 3, name: "深海余烬", heat: "7.9 万人在读" },
  { rank: 4, name: "玄鉴仙族", heat: "6.4 万人在读" },
  { rank: 5, name: "夜的命名术", heat: "5.8 万人在读" },
];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 测试模式：降级数据
  if (process.env.RANKINGS_PROVIDER === "mock") {
    return NextResponse.json({
      boards: BOARDS,
      rows: FALLBACK_ROWS,
      degraded: true,
      note: "榜单数据源降级（mock 数据）",
    });
  }

  // 真实榜源请求（公开页面，超时受控）；失败降级
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
      return NextResponse.json({ boards: BOARDS, rows: FALLBACK_ROWS, degraded: true, note: "榜单解析失败，已降级" });
    }
    return NextResponse.json({
      boards: BOARDS,
      rows: names.slice(0, 5).map((n, i) => ({ rank: i + 1, name: n, heat: "—" })),
      degraded: false,
    });
  } catch (err) {
    return NextResponse.json({
      boards: BOARDS,
      rows: FALLBACK_ROWS,
      degraded: true,
      note: `榜单源暂时不可达（${(err as Error).message}），已降级为示例数据`,
    });
  }
}
