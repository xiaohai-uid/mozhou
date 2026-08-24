import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCanonicalNovelExport } from "@/lib/novels/service";

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 100) || "作品";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const format = new URL(request.url).searchParams.get("format");
  if (format !== "json") {
    return NextResponse.json({ error: "仅支持 format=json" }, { status: 400 });
  }

  const bookId = Number((await params).bookId);
  if (!Number.isInteger(bookId) || bookId <= 0) {
    return NextResponse.json({ error: "作品编号无效" }, { status: 400 });
  }

  const payload = await getCanonicalNovelExport(user.id, bookId);
  if (!payload) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  const filename = `${safeFilename(payload.novel.name)}.json`;
  const asciiFilename = `mozhou-export-${bookId}.json`;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
