// POST /api/v1/sync/push — 云同步文件级推送（工单 20，V1.1 Journey ④）
// 单向备份：作品章节 → WebDAV mozhou/<作品名>/<章节号>-<标题>.md
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { enforceSyncPushLimit } from "@/lib/http/rate-limit";
import { pushToWebDAV } from "@/lib/sync/service";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 工单 D 延伸：推送会对全部作品逐章发起外部 WebDAV 请求，鉴权后先过限流保护上游
  const limited = enforceSyncPushLimit(user.id);
  if (limited) return limited;

  const result = await pushToWebDAV(user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
