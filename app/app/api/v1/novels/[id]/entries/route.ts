// /api/v1/novels/[id]/entries — 人物库 / 世界观条目：新建 / 删除（05 工单）
// kind=character | worldview（query 参数）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createEntry, deleteEntry, type EntryKind } from "@/lib/novels/service";

const KINDS: EntryKind[] = ["character", "worldview"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as EntryKind | null;
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind 必须是 character 或 worldview" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    note?: string;
  } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  const entry = await createEntry(user.id, Number(id), kind, name, body?.note);
  if (!entry) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json({ entry }, { status: 201 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as EntryKind | null;
  const entryId = Number(url.searchParams.get("entryId"));
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind 必须是 character 或 worldview" }, { status: 400 });
  }
  if (!entryId) {
    return NextResponse.json({ error: "缺少 entryId" }, { status: 400 });
  }
  const ok = await deleteEntry(user.id, Number(id), kind, entryId);
  if (!ok) return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
