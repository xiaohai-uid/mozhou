// 云同步文件级推送（工单 20，V1.1 Journey ④）：WebDAV 单向备份（备份语义）。
// 目录结构：mozhou/<作品名>/<章节号>-<标题>.md（正文；空正文章节跳过）。
// 方向：本地→远端，PUT 覆盖（坚果云自带历史版本兜底）；无拉取/双向。
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, novels, syncConfigs } from "@/lib/schema";
import { decryptSyncPassword } from "@/lib/sync/credentials";

const TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 3;

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

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知网络错误";
  return message.replace(/https?:\/\/\S+/gi, "远端地址").replace(/authorization|basic\s+\S+/gi, "认证信息").slice(0, 160);
}

async function requestWithRetry(input: RequestInfo | URL, init: RequestInit, ok: (status: number) => boolean): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(input, { ...init, signal: ctrl.signal });
      if (ok(res.status) || ![408, 425, 429, 500, 502, 503, 504].includes(res.status) || attempt === MAX_ATTEMPTS - 1) return res;
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(5000, retryAfter * 1000) : 300 * 2 ** attempt));
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("WebDAV 请求失败");
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
  try {
    const res = await requestWithRetry(url, {
      method: "MKCOL",
      headers: { Authorization: `Basic ${auth}` },
    }, (status) => status === 200 || status === 201 || status === 204 || status === 405 || status === 301 || status === 302);
    if (!res.ok && res.status !== 405 && res.status !== 301 && res.status !== 302) {
      throw new Error(`建目录失败（${res.status}）`);
    }
  } catch (error) {
    throw new Error(`建目录失败：${safeError(error)}`);
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

  let password: string;
  try {
    password = decryptSyncPassword(config.password);
  } catch (err) {
    return { error: (err as Error).message };
  }
  const auth = Buffer.from(`${config.username}:${password}`).toString("base64");
  const base = config.url.replace(/\/+$/, "");
  try {
    await mkcol(`${base}/mozhou`, auth);
    const dirs = new Set(items.map((i) => i.path.split("/").slice(0, -1).join("/")));
    for (const dir of dirs) await mkcol(`${base}/${dir}`, auth);
    for (const item of items) {
      const res = await requestWithRetry(`${base}/${item.path}`, {
        method: "PUT",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "text/markdown; charset=utf-8",
        },
        body: item.content,
      }, (status) => status === 200 || status === 201 || status === 204);
      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw new Error(`推送 ${item.path} 失败（${res.status}）`);
      }
    }
    return { pushed: items.length, at: new Date().toISOString() };
  } catch (err) {
    return { error: `同步失败：${safeError(err)}` };
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
