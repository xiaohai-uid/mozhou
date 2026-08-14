// POST /api/v1/novels/bootstrap — 快速开始：原子创建作品、第一章和首写工作流。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { quickStartNovel } from "@/lib/novels/service";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    requestKey?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const requestKey = typeof body?.requestKey === "string" ? body.requestKey.trim() : "";
  const description = typeof body?.description === "string" ? body.description : undefined;

  if (!name) return NextResponse.json({ error: "书名不能为空" }, { status: 400 });
  if (name.length > 100) return NextResponse.json({ error: "书名过长（上限 100 字）" }, { status: 400 });
  if (!requestKey || requestKey.length > 120) {
    return NextResponse.json({ error: "缺少有效的首写请求键" }, { status: 400 });
  }

  try {
    const result = await quickStartNovel(user.id, name, requestKey, description);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "首写准备失败" },
      { status: 500 },
    );
  }
}
