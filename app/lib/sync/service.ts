// 云同步文件级推送（工单 20，V1.1 Journey ④）：WebDAV 单向备份（备份语义）。
// 目录结构：mozhou/<作品名>/<章节号>-<标题>.md（正文；空正文章节跳过）。
// 方向：本地→远端，PUT 覆盖（坚果云自带历史版本兜底）；无拉取/双向。
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, novels, syncConfigs } from "@/lib/schema";

const TIMEOUT_MS = 10000;

export interface SyncPushResult {
  pushed: number;
  at: string;
}

/** 文件名清洗：WebDAV 路径非法字符 → 下划线 */
function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名";
}

interface PushItem {
  path: string;
  content: string;
}

/** 收集用户全部章节正文（空正文跳过） */
async function collectChapters(userId: number): Promise<PushItem[]> {
  const novelRows = await db
    .select({ id: novels.id, name: novels.name })
    .from(novels)
    .where(eq(novels.userId, userId));
  const items: PushItem[] = [];
  for (const n of novelRows) {
    const chRows = await db
      .select({ ch: chapters.ch, title: chapters.title, content: chapters.content })
      .from(chapters)
      .where(eq(chapters.novelId, n.id));
    for (const c of chRows) {
      if (!c.content.trim()) continue;
      items.push({
        path: `mozhou/${sanitize(n.name)}/${c.ch}-${sanitize(c.title)}.md`,
        content: c.content,
      });
    }
  }
  return items;
}

/** MKCOL 建目录（已存在 405/301 视为成功） */
async function mkcol(url: string, auth: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "MKCOL",
      signal: ctrl.signal,
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok && res.status !== 405 && res.status !== 301 && res.status !== 302) {
      throw new Error(`建目录失败（${res.status}）`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 推送全部章节到 WebDAV（单向备份）。
 * SYNC_PROVIDER=mock（测试）：返回确定性成功，不发起网络。
 */
export async function pushToWebDAV(userId: number): Promise<SyncPushResult | { error: string }> {
  const [config] = await db
    .select()
    .from(syncConfigs)
    .where(eq(syncConfigs.userId, userId));
  if (!config) return { error: "尚未配置同步，请先保存 WebDAV 配置" };

  const items = await collectChapters(userId);
  if (items.length === 0) {
    return { pushed: 0, at: new Date().toISOString() };
  }
  if (process.env.SYNC_PROVIDER === "mock") {
    return { pushed: items.length, at: new Date().toISOString() };
  }

  const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  const base = config.url.replace(/\/+$/, "");
  try {
    await mkcol(`${base}/mozhou`, auth);
    const dirs = new Set(items.map((i) => i.path.split("/").slice(0, -1).join("/")));
    for (const dir of dirs) await mkcol(`${base}/${dir}`, auth);
    for (const item of items) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${base}/${item.path}`, {
          method: "PUT",
          signal: ctrl.signal,
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "text/markdown; charset=utf-8",
          },
          body: item.content,
        });
        if (!res.ok && res.status !== 201 && res.status !== 204) {
          throw new Error(`推送 ${item.path} 失败（${res.status}）`);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return { pushed: items.length, at: new Date().toISOString() };
  } catch (err) {
    return { error: `同步失败：${(err as Error).message}` };
  }
}

/** autoSync 触发（正文保存后调用）：配置 autoSync=true 时后台推送（fire-and-forget，失败静默） */
export async function maybeAutoSync(userId: number): Promise<void> {
  try {
    const [config] = await db
      .select({ autoSync: syncConfigs.autoSync })
      .from(syncConfigs)
      .where(eq(syncConfigs.userId, userId));
    if (!config?.autoSync) return;
    await pushToWebDAV(userId);
  } catch {
    // 后台备份失败不打扰保存路径
  }
}
