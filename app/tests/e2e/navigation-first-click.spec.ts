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
