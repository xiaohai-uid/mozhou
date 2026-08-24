import { test, expect, type Page } from "@playwright/test";

// P0-C browser regression: AI failure must surface actionable copy, leave the
// chapter body untouched, and offer a one-click retry that creates a new request.

const PASSWORD = "password123";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndOpenEmptyChapter(page: Page) {
  const email = uniqueEmail("e2e-ai-retry");
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);

  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByLabel("书名").fill(`E2E AI 重试-${Date.now()}`);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);
  // Let the initial chapter/messages fetch settle before sending, otherwise a
  // slow history response can overwrite locally added chat messages.
  await page.waitForResponse((res) => res.url().includes("/chapters/messages") && res.status() === 200);
  await page.waitForTimeout(300);
}

test("AI failure shows actionable error and retry creates a new successful request", async ({ page }) => {
  await registerAndOpenEmptyChapter(page);

  const bodyEditor = page.getByLabel("章节正文编辑器");
  const chatInput = page.getByPlaceholder(/让 AI 起笔这一章|和 AI 对话，继续写这一章/);
  const sendButton = page.getByRole("button", { name: "发送" });

  const chatUrl = /\/api\/v1\/novels\/\d+\/chapters\/chat(?:\?|$)/;
  let chatRequests = 0;
  await page.route(chatUrl, async (route) => {
    chatRequests += 1;
    if (chatRequests === 1) {
      // 让请求真正到达后端（创建原始 user/assistant 行），再把响应改写成客户端可见错误。
      const response = await route.fetch();
      await route.fulfill({
        response,
        contentType: "text/event-stream",
        body: 'data: {"type":"error","code":"AiNetworkError","message":"network down"}\n\n',
      });
    } else {
      await route.continue();
    }
  });

  await chatInput.fill("让 AI 起笔这一章");
  await sendButton.click();

  // Specific user-facing copy, not the generic fallback.
  await expect(page.getByText(/网络连接失败 · 请检查网络后重试/)).toBeVisible();
  await expect(page.getByText("操作没有成功")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新尝试" })).toBeVisible();
  await expect(bodyEditor).toHaveValue("");

  // Retry must create a new request and succeed with the mock provider.
  await page.getByRole("button", { name: "重新尝试" }).click();
  await expect(page.getByText(/你好，我是墨舟/)).toBeVisible();
  await expect(chatRequests).toBe(2);
  await expect(bodyEditor).toHaveValue("");
});

test("FREE_UNAVAILABLE surfaces specific copy without touching the body", async ({ page }) => {
  await registerAndOpenEmptyChapter(page);

  const bodyEditor = page.getByLabel("章节正文编辑器");
  const chatInput = page.getByPlaceholder(/让 AI 起笔这一章|和 AI 对话，继续写这一章/);
  const sendButton = page.getByRole("button", { name: "发送" });

  const chatUrl = /\/api\/v1\/novels\/\d+\/chapters\/chat(?:\?|$)/;
  await page.route(chatUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"error","code":"FREE_UNAVAILABLE","message":"当前免费 AI 暂时不可用"}\n\n',
    }),
  );

  await chatInput.fill("让 AI 起笔这一章");
  await sendButton.click();

  await expect(page.getByText(/当前免费 AI 暂时不可用/)).toBeVisible();
  await expect(page.getByText("操作没有成功")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新尝试" })).toBeVisible();
  await expect(bodyEditor).toHaveValue("");
});
