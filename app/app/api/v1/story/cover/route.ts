// POST /api/v1/story/cover — 封面能力边界。
// 当前生产环境没有图片 Provider；明确返回配置要求，不把文本抽卡结果伪装成图片。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(
    {
      error: "封面图片 Provider 尚未配置",
      code: "CONFIGURATION_REQUIRED",
      capability: "story-cover",
    },
    { status: 503 },
  );
}
