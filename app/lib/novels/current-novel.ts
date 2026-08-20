// 当前作品选择（P0-A）：一个纯解析函数 + localStorage 持久化。
// UI 状态永不作授权边界；服务端路由仍按 userId 校验作品归属。

const CURRENT_NOVEL_KEY = "mozhou:current-novel-id";

export function readCurrentNovelId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CURRENT_NOVEL_KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function writeCurrentNovelId(id: number | null): void {
  if (typeof window === "undefined") return;
  if (id == null) {
    window.localStorage.removeItem(CURRENT_NOVEL_KEY);
  } else {
    window.localStorage.setItem(CURRENT_NOVEL_KEY, String(id));
  }
}

export function resolveCurrentNovelId(input: {
  newlyCreatedId?: number | null;
  persistedId?: number | null;
  availableNovelIds: number[];
}): number | null {
  if (input.newlyCreatedId != null && input.availableNovelIds.includes(input.newlyCreatedId)) {
    return input.newlyCreatedId;
  }
  if (input.persistedId != null && input.availableNovelIds.includes(input.persistedId)) {
    return input.persistedId;
  }
  return input.availableNovelIds[0] ?? null;
}
