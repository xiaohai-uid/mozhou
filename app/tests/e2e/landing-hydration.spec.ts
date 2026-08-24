import { test, expect } from "@playwright/test";

// 回归：落地页不得出现 hydration 不一致警告（2026-08-21 GUI 体检 [LOW]）。
// 当时日志显示 MiniChat 示意输入框服务端渲染了 caret-color 内联样式而客户端不一致；
// 该样式从未进入提交历史（疑为体检时 dev server 的 HMR 残影），此用例固化「落地页零
// hydration 警告」作为持续约束。

test("落地页无 hydration 不一致警告", async ({ page }) => {
  const consoleText: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") consoleText.push(msg.text());
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByLabel("写作输入框（示意）")).toBeVisible();

  // 留出双渲染/延迟告警窗口
  await page.waitForTimeout(1500);

  const hydrationIssues = consoleText.filter((t) => /hydrat/i.test(t));
  expect(hydrationIssues).toEqual([]);
});
