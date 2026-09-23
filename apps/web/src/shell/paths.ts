/**
 * 路径工具（唯一出处）：书根的父目录。桌面书架与移动设置 Hub 共用。
 */
export function parentDirOf(root: string): string {
  const index = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))
  return index > 0 ? root.slice(0, index) : root
}
