import { test, expect } from "@playwright/test";

// 回归：章节编辑器加载竞态（2026-08-21 晚场 GUI 体检发现，[MEDIUM] 数据丢失）。
// 缺陷史：正文 GET 返回前 textarea 可输入，随后到达的加载结果经 bodyHist.reset
// 静默覆盖用户输入；顶栏徽标初始即「已保存」，假反馈掩盖数据丢失。
// 修复语义（本用例固化）：
//   1) 正文加载完成前编辑器禁用、顶栏不显示「已保存」；
//   2) 加载完成后编辑器展示服务端正文；
//   3) 加载完成后输入照常防抖持久化（安全路径）。

const PASSWORD = "password123";
const SEED_TEXT = "雪落在长街的第三节车厢顶上。";
const APPEND_TEXT = "她把灯拧暗了一格。";

function uniqueEmail(): string {
  return `e2e-race-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

const chaptersUrl = /\/api\/v1\/novels\/\d+\/chapters\?chapterId=/;

test("正文加载完成前编辑器禁用且无假「已保存」；完成后可编辑并持久化", async ({ page }) => {
  test.setTimeout(240_000);

  // 前置：注册新账号 → 创建作品 → 落在第一章（此阶段不拦截，快速加载）
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(uniqueEmail());
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);

  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("书名").fill(`E2E竞态-${Date.now()}`);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);

  const editor = page.getByLabel("章节正文编辑器");
  await expect(editor).toBeEnabled({ timeout: 30_000 });

  // 预置已持久化正文：填入 → 防抖自动保存（PATCH）→ 徽标回到「已保存」
  const firstPatch = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && chaptersUrl.test(res.url()),
  );
  await editor.fill(SEED_TEXT);
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();
  await firstPatch;
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();

  // 拦截正文 GET：延迟放行制造慢加载窗口，刷新页面进入窗口期
  await page.route(chaptersUrl, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({ response });
  });
  await page.reload();

  // 窗口期内：编辑器必须禁用；顶栏不得出现「已保存」假反馈
  await expect(editor).toBeDisabled();
  await expect(page.getByText("已保存", { exact: true })).toHaveCount(0);

  // 加载完成：恢复可用，并展示服务端正文（用户输入不再被覆盖的前提是窗口期根本不可写）
  await expect(editor).toBeEnabled({ timeout: 30_000 });
  await expect(editor).toHaveValue(SEED_TEXT);

  // 安全路径回归：加载完成后输入照常走防抖自动保存并跨刷新持久化
  const secondPatch = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && chaptersUrl.test(res.url()),
  );
  await editor.fill(`${SEED_TEXT}${APPEND_TEXT}`);
  await secondPatch;
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();

  await page.unroute(chaptersUrl);
  await page.reload();
  await expect(editor).toBeEnabled({ timeout: 30_000 });
  await expect(editor).toHaveValue(`${SEED_TEXT}${APPEND_TEXT}`);
});
