// /api/v1/novels/[id] — 详情（三栏）/ 编辑 / 删除（05 工单）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteNovel, getNovel, updateNovel } from "@/lib/novels/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const detail = await getNovel(user.id, Number(id));
  if (!detail) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    description?: string;
    ragEnabled?: boolean;
  } | null;
  const name = body?.name?.trim();
  if (name !== undefined && !name) {
    return NextResponse.json({ error: "书名不能为空" }, { status: 400 });
  }
  if (name !== undefined && name.length > 100) {
    return NextResponse.json({ error: "书名过长（上限 100 字）" }, { status: 400 });
  }
  const novel = await updateNovel(user.id, Number(id), {
    ...(name !== undefined ? { name } : {}),
    ...(body?.description !== undefined ? { description: body.description } : {}),
    ...(body?.ragEnabled !== undefined ? { ragEnabled: body.ragEnabled } : {}),
  });
  if (!novel) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json({ novel });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteNovel(user.id, Number(id));
  if (!ok) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
