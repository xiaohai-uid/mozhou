import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { STORY_CAPABILITIES } from "@/lib/story/capabilities";

/** GET /api/v1/story/capabilities — 返回 oh-story 能力及其真实适配器状态。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ source: "oh-story-claudecode", capabilities: STORY_CAPABILITIES });
}
