import { test, expect, type Page } from "@playwright/test";

// P0-D regression: a slow initial /chapters/messages response must not overwrite
// messages the user already sent locally.

const PASSWORD = "password123";

function uniqueEmail(): string {
  return `e2e-history-race-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndOpenChapterWithDelayedHistory(page: Page) {
  const email = uniqueEmail();
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);

  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByLabel("书名").fill(`E2E历史竞态-${Date.now()}`);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);

  // Delay the history response so the user can send before it resolves.
  await page.route("**/chapters/messages**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });
  await page.waitForTimeout(300);
}

test("slow history response does not overwrite locally sent messages", async ({ page }) => {
  await registerAndOpenChapterWithDelayedHistory(page);

  const chatInput = page.getByPlaceholder(/让 AI 起笔这一章|和 AI 对话，继续写这一章/);
  const sendButton = page.getByRole("button", { name: "发送" });
  const userText = `用户在历史加载完成前发送-${Date.now()}`;

  await chatInput.fill(userText);
  await sendButton.click();

  // The user message and the mock assistant reply are already visible locally.
  await expect(page.getByText(userText, { exact: true })).toBeVisible();
  await expect(page.getByText(/你好，我是墨舟/)).toBeVisible();

  // Wait for the stale history response to land; it must not clear local state.
  await page.waitForTimeout(2500);
  await expect(page.getByText(userText, { exact: true })).toBeVisible();
  await expect(page.getByText(/你好，我是墨舟/)).toBeVisible();
});
