import { test, expect, type Page } from "@playwright/test";

// P1-D diagnostic: 30x real-navigation loop between 书源搜索 and 书源书架.
// The plan forbids a code fix unless this loop reproduces a failure with trace evidence.

const PASSWORD = "password123";
const ITERATIONS = 30;

function uniqueEmail(): string {
  return `e2e-nav-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function register(page: Page) {
  const email = uniqueEmail();
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.goto("/search", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
}

test("resource navigation responds on first click for 30 iterations", async ({ page }) => {
  test.setTimeout(240_000);
  await register(page);

  for (let i = 0; i < ITERATIONS; i += 1) {
    await page.getByRole("link", { name: "书源搜索" }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByRole("heading", { name: "书源搜索" })).toBeVisible();

    await page.getByRole("link", { name: "书源书架" }).click();
    await expect(page).toHaveURL(/\/shelf$/);
    await expect(page.getByRole("heading", { name: "书源书架" })).toBeVisible();
  }
});

test("workbench tool links keep the workbench shell", async ({ page }) => {
  await register(page);
  await page.goto("/workspace", { waitUntil: "networkidle" });

  const tools = [
    ["扫榜简报", "/rankings"],
    ["参考拆解", "/deconstruct"],
    ["独立写作对话", "/chat"],
    ["技能广场", "/skills"],
    ["任务中心", "/tasks"],
  ] as const;

  for (const [label, path] of tools) {
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?surface=workbench$`));
    await expect(page.locator('[data-shell="workbench-tool"]')).toBeVisible();
    await expect(page.locator(".mz-app-shell")).toHaveCount(0);

    await page.getByRole("link", { name: "返回墨舟创作台" }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.locator(".mz-workbench-shell")).toBeVisible();
  }
});

test("workbench collapses to mobile layout at narrow viewports", async ({ page }) => {
  await register(page);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/workspace", { waitUntil: "networkidle" });

  // 窄屏：桌面侧栏隐藏，底部移动导航接管（写作/章节/故事/工具）。
  await expect(page.locator(".mz-workbench-shell > div > aside").first()).toBeHidden();
  await expect(page.getByRole("navigation", { name: "移动端导航" })).toBeVisible();

  await page.goto("/rankings?surface=workbench", { waitUntil: "networkidle" });
  await expect(page.locator('[data-shell="workbench-tool"]')).toBeVisible();
});

test("workbench tools reuse the full workbench sidebar", async ({ page }) => {
  await register(page);
  await page.goto("/deconstruct?surface=workbench", { waitUntil: "networkidle" });

  await expect(page.getByText("还没有作品", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /章节与大纲/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /人物关系/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /世界规则/ })).toBeVisible();
  await expect(page.locator("[data-workbench-sidebar]")).toBeVisible();
  await expect(page.locator(".mz-workspace-tool-sidebar")).toHaveCount(0);
});
