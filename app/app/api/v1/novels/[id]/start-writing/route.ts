// POST /api/v1/novels/[id]/start-writing — 历史空作品的可恢复首写入口。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { startWriting } from "@/lib/novels/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const result = await startWriting(user.id, Number(id));
  if (!result) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json(result);
}
