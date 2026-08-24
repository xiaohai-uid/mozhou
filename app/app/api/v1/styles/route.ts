// /api/v1/styles — 风格库（工单 14）：我的风格保存/列表/删除（蒸馏产物持久化）
// chat 按 styleId 应用见工单 15；skills 表为模板（同名允许、无分页全量返回）
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { StyleGuide, styles } from "@/lib/schema";

export interface StyleRow {
  id: number;
  name: string;
  guide: StyleGuide;
  createdAt: string;
}

function isStyleGuide(g: unknown): g is StyleGuide {
  if (typeof g !== "object" || g === null) return false;
  const o = g as Record<string, unknown>;
  return (
    typeof o.narrative === "string" &&
    typeof o.sentence === "string" &&
    typeof o.imagery === "string" &&
    typeof o.rhythm === "string"
  );
}

/** GET /api/v1/styles — 我的风格库（新→旧） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rows = await db
    .select()
    .from(styles)
    .where(eq(styles.userId, user.id))
    .orderBy(desc(styles.createdAt));
  return NextResponse.json({
    styles: rows.map((r) => ({
      id: r.id,
      name: r.name,
      guide: r.guide,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

/** POST /api/v1/styles — 保存风格（名称 + 四维指南） */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    guide?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "风格名称不能为空" }, { status: 400 });
  }
  if (!isStyleGuide(body?.guide)) {
    return NextResponse.json(
      { error: "风格指南必须是四维对象（narrative/sentence/imagery/rhythm）" },
      { status: 400 },
    );
  }
  const [row] = await db
    .insert(styles)
    .values({ userId: user.id, name, guide: body.guide })
    .returning({ id: styles.id, name: styles.name });
  return NextResponse.json({ style: row }, { status: 201 });
}

/** DELETE /api/v1/styles?id= — 删除风格（写路径归属校验防 IDOR） */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "缺少风格 id" }, { status: 400 });
  const rows = await db
    .delete(styles)
    .where(and(eq(styles.id, id), eq(styles.userId, user.id)))
    .returning({ id: styles.id });
  if (rows.length === 0) {
    return NextResponse.json({ error: "风格不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
