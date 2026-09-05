/**
 * apps/web · 章节写入互斥进程锁（T03）
 * 防止同一部书同一章节出现并发流式生成或写入冲突导致正文损毁。
 */
const activeLocks = new Set<string>()

export function acquireChapterLock(key: string): boolean {
  if (activeLocks.has(key)) return false
  activeLocks.add(key)
  return true
}

export function releaseChapterLock(key: string): void {
  activeLocks.delete(key)
}
