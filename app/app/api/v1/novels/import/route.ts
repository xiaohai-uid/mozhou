// POST /api/v1/novels/import — 导入用户拥有使用权的正文并进入首章。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { importNovelWithFirstChapter } from "@/lib/novels/service";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    content?: unknown;
    requestKey?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  const requestKey = typeof body?.requestKey === "string" ? body.requestKey.trim() : "";
  if (!name || name.length > 100) return NextResponse.json({ error: "请输入 1-100 字书名" }, { status: 400 });
  if (content.trim().length < 200) return NextResponse.json({ error: "正文太短，至少需要 200 个字符" }, { status: 400 });
  if (content.length > 200000) return NextResponse.json({ error: "正文过长，上限 200000 个字符" }, { status: 413 });
  if (!requestKey || requestKey.length > 120) return NextResponse.json({ error: "缺少有效的导入请求键" }, { status: 400 });
  try {
    const result = await importNovelWithFirstChapter(user.id, name, content, requestKey);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 500 });
  }
}
