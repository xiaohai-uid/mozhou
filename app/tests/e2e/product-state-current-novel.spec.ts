import { test, expect, type Page } from "@playwright/test";

// P0-A browser regressions: current/active novel must be one source of truth
// and stay consistent across create → navigate → switch → delete.

const PASSWORD = "password123";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function register(page: Page, email: string) {
  await page.goto("/register", { waitUntil: "networkidle" });
  // Let client-side hydration attach the React submit handler before acting.
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);
}

async function createNovel(page: Page, title: string) {
  await page.goto("/projects");
  await page.getByLabel("书名").fill(title);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);
}

async function openWorkbenchFromChapter(page: Page) {
  // Chapter/project pages are wrapped in AppShell; use visible navigation.
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
  // Let the client bundle hydrate before interacting with controlled inputs.
  await page.waitForTimeout(500);
}

async function removeDevOverlay(page: Page) {
  // The Next.js dev indicator is a fixed portal that can intercept bottom-left
  // links in headless runs. Remove it so real visible navigation is clickable.
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function expectCurrentNovel(page: Page, title: string) {
  await expect(page.locator("aside").getByText(title, { exact: true })).toBeVisible();
  await expect(page.locator("aside").getByText("还没有作品")).toHaveCount(0);
}

test("newly created first novel becomes the current novel across navigation", async ({ page }) => {
  const email = uniqueEmail("e2e-first");
  const title = `E2E首作-${Date.now()}`;

  await register(page, email);
  await createNovel(page, title);
  await openWorkbenchFromChapter(page);

  await expectCurrentNovel(page, title);
});

test("switching novels persists across leaving and returning to Workbench", async ({ page }) => {
  const email = uniqueEmail("e2e-switch");
  const first = `E2E切换A-${Date.now()}`;
  const second = `E2E切换B-${Date.now()}`;

  await register(page, email);
  await createNovel(page, first);
  await createNovel(page, second);

  await openWorkbenchFromChapter(page);
  await page.locator("#workbench-novel").selectOption({ label: second });
  await expectCurrentNovel(page, second);

  // Leave Workbench via visible link, then come back.
  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/guide/);
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);

  await expectCurrentNovel(page, second);
});

test("current novel survives refresh once a selection exists", async ({ page }) => {
  const email = uniqueEmail("e2e-refresh");
  const first = `E2E刷新A-${Date.now()}`;
  const second = `E2E刷新B-${Date.now()}`;

  await register(page, email);
  await createNovel(page, first);
  await createNovel(page, second);

  await openWorkbenchFromChapter(page);
  await page.locator("#workbench-novel").selectOption({ label: second });
  await expectCurrentNovel(page, second);

  await page.reload();
  await expect(page).toHaveURL(/\/workspace/);
  await expectCurrentNovel(page, second);
});

test("deleting the active novel leaves a deterministic fallback state", async ({ page }) => {
  const email = uniqueEmail("e2e-delete");
  const first = `E2E删除A-${Date.now()}`;
  const second = `E2E删除B-${Date.now()}`;

  await register(page, email);
  await createNovel(page, first);
  await createNovel(page, second);

  await openWorkbenchFromChapter(page);
  await page.locator("#workbench-novel").selectOption({ label: second });
  await expectCurrentNovel(page, second);

  // Delete the active novel from Projects.
  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/guide/);
  await page.getByRole("link", { name: "我的作品" }).click();
  await expect(page).toHaveURL(/\/projects/);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: `删除 ${second}`, exact: true }).click();
  await expect(page.getByText(second, { exact: true })).toHaveCount(0);

  // Workbench must fall back to the remaining owned novel.
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await expectCurrentNovel(page, first);
});
