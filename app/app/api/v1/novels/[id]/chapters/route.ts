// /api/v1/novels/[id]/chapters — 新建 / 读取 / 编辑 / 删除章节（05 工单；content 正文 16 工单）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  createChapter,
  deleteChapter,
  getChapter,
  updateChapter,
} from "@/lib/novels/service";
import { maybeAutoSync } from "@/lib/sync/service";

/** GET /api/v1/novels/[id]/chapters?chapterId=X — 单章详情（含正文 content，16 工单） */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const chapterId = Number(url.searchParams.get("chapterId"));
  if (!chapterId) {
    return NextResponse.json({ error: "缺少 chapterId" }, { status: 400 });
  }
  const chapter = await getChapter(user.id, Number(id), chapterId);
  if (!chapter) return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  return NextResponse.json({ chapter });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const title = body?.title?.trim();
  if (!title) return NextResponse.json({ error: "章节标题不能为空" }, { status: 400 });
  const chapter = await createChapter(user.id, Number(id), title);
  if (!chapter) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json({ chapter }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const chapterId = Number(url.searchParams.get("chapterId"));
  if (!chapterId) {
    return NextResponse.json({ error: "缺少 chapterId" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    title?: string;
    status?: "draft" | "final";
    content?: string;
  } | null;
  const patch: { title?: string; status?: "draft" | "final"; content?: string } = {};
  if (body?.title !== undefined) patch.title = body.title.trim();
  if (body?.status !== undefined) patch.status = body.status;
  if (body?.content !== undefined) patch.content = body.content;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }
  const chapter = await updateChapter(user.id, Number(id), chapterId, patch);
  if (!chapter) return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  // 工单 20：autoSync 开启时正文保存后后台推送（fire-and-forget，失败静默）
  if (patch.content !== undefined) {
    void maybeAutoSync(user.id);
  }
  return NextResponse.json({ chapter });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const url = new URL(_request.url);
  const chapterId = Number(url.searchParams.get("chapterId"));
  if (!chapterId) {
    return NextResponse.json({ error: "缺少 chapterId" }, { status: 400 });
  }
  const result = await deleteChapter(user.id, Number(id), chapterId);
  if (result === "not_found") {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }
  if (result === "protected") {
    return NextResponse.json({ error: "第一章是首写入口，不能删除" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
