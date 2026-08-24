// /api/v1/novels — 作品列表 / 创建（05 工单）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listNovels, quickStartNovel } from "@/lib/novels/service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ novels: await listNovels(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    description?: string;
    requestKey?: string;
  } | null;
  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "书名不能为空" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "书名过长（上限 100 字）" }, { status: 400 });
  }
  const requestKey = body?.requestKey?.trim();
  if (!requestKey || requestKey.length > 120) {
    return NextResponse.json({ error: "缺少有效的首写请求键" }, { status: 400 });
  }
  try {
    const result = await quickStartNovel(user.id, name, requestKey, body?.description);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "首写准备失败" },
      { status: 500 },
    );
  }
}
