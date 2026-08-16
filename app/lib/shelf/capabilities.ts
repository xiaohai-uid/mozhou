export function getShelfCapabilities() {
  return {
    canRead: false,
    label: "仅收录书目",
    description: "章节阅读与正文导入尚未开放",
  } as const;
}
