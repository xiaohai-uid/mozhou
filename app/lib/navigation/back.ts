export type BackNavigationInput = {
  historyLength: number;
  fallback: string;
};

/**
 * 浏览器 history 只有在确实存在上一级时才使用 back；
 * 直接打开工作台时回到产品内的稳定入口，避免把用户送出应用。
 */
export function getBackNavigationMode({ historyLength, fallback }: BackNavigationInput): "history" | "fallback" {
  return historyLength > 1 && fallback.length > 0 ? "history" : "fallback";
}
