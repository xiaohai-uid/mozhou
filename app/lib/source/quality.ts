// 书源结果质量门：私用区字符（Unicode PUA）检测。
// 番茄等榜单页会用 PUA 字符做字体反爬（书名字符映射混淆），
// 直接透传会污染 UI 与数据库。命中即视为解析失败候选。

/** 私用区字符范围：U+E000–U+F8FF（BMP 私用区） */
const PUA_RE = /[\uE000-\uF8FF]/;

/** 是否包含私用区字符 */
export function containsPua(text: string): boolean {
  return PUA_RE.test(text);
}

/** 过滤含 PUA 的候选；全部被过滤时返回空数组（调用方应降级） */
export function filterPua<T extends { name: string }>(rows: T[]): T[] {
  return rows.filter((row) => !containsPua(row.name));
}
