// GET/POST /api/v1/shelf — 书架：列表 / 导入（08 工单）
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { shelfBooks } from "@/lib/schema";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rows = await db
    .select()
    .from(shelfBooks)
    .where(eq(shelfBooks.userId, user.id))
    .orderBy(desc(shelfBooks.importedAt));
  return NextResponse.json({
    books: rows.map((b) => ({
      id: b.id,
      name: b.name,
      source: b.source,
      author: b.author ?? "",
      site: b.site ?? "",
      status: b.status ?? "",
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    source?: unknown;
    author?: unknown;
    site?: unknown;
    status?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "书名不能为空" }, { status: 400 });
  }
  const [row] = await db
    .insert(shelfBooks)
    .values({
      userId: user.id,
      name,
      source: typeof body?.source === "string" ? body.source : "未知书源",
      author: typeof body?.author === "string" ? body.author : null,
      site: typeof body?.site === "string" ? body.site : null,
      status: typeof body?.status === "string" ? body.status : null,
    })
    .returning({ id: shelfBooks.id, name: shelfBooks.name });
  return NextResponse.json({ book: row }, { status: 201 });
}
