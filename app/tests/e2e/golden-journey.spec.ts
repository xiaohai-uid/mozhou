import { test, expect, type Page } from "@playwright/test";

// Task 5 Golden Journey: one fresh account, full reliability path through the
// product. Uses the mock provider for deterministic AI failure/success.

const PASSWORD = "password123";

function uniqueEmail(): string {
  return `e2e-golden-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function removeDevOverlay(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function expectCurrentNovel(page: Page, title: string) {
  await expect(page.locator("aside").getByText(title, { exact: true })).toBeVisible();
  await expect(page.locator("aside").getByText("还没有作品")).toHaveCount(0);
}

test("golden journey: create, current-novel consistency, panels, AI retry, persistence, navigation", async ({ page }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail();
  const novelTitle = `E2E黄金旅程-${Date.now()}`;

  // register
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);

  // create first novel → lands in first chapter
  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByLabel("书名").fill(novelTitle);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  const createMessagesLoaded = page.waitForResponse((res) => res.url().includes("/chapters/messages") && res.status() === 200);
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);
  await createMessagesLoaded;
  await page.waitForTimeout(300);

  // enter first chapter (already there); return to Workbench → novel is current
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
  await expectCurrentNovel(page, novelTitle);

  // Workbench panels: characters/world/chapters all render from one state
  const charactersButton = page.getByRole("button", { name: /人物关系/ });
  const worldButton = page.getByRole("button", { name: /世界规则/ });
  const outlineButton = page.getByRole("button", { name: /章节与大纲/ });
  const mainHeading = page.getByRole("heading", { name: "接着写，还是先聊聊？" });
  const charactersPanel = page.getByLabel("人物关系面板");
  const worldPanel = page.getByLabel("世界规则面板");
  const outlinePanel = page.getByLabel("章节与大纲面板");

  await charactersButton.click();
  await expect(charactersButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("heading", { name: "人物关系" })).toBeVisible();
  await expect(charactersPanel.getByText("暂无人物")).toBeVisible();
  await expect(mainHeading).toHaveCount(0);

  await worldButton.click();
  await expect(worldButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("heading", { name: "世界规则" })).toBeVisible();
  await expect(worldPanel.getByText("暂无世界观")).toBeVisible();
  await expect(charactersPanel).toHaveCount(0);
  await expect(mainHeading).toHaveCount(0);

  await outlineButton.click();
  await expect(outlineButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("heading", { name: "章节与大纲" })).toBeVisible();
  await expect(outlinePanel.getByText(/001\s*·\s*第一章|001\s*第一章/)).toBeVisible();
  await expect(worldPanel).toHaveCount(0);
  await expect(mainHeading).toHaveCount(0);

  // back into first chapter via the visible Workbench chapter link (now carries
  // the novelId query params needed by the chapter page)
  const messagesLoaded = page.waitForResponse((res) => res.url().includes("/chapters/messages") && res.status() === 200);
  await page.getByRole("link", { name: /001 · 第一章/ }).click();
  await expect(page).toHaveURL(/\/chapter\//);
  await messagesLoaded;
  await page.waitForTimeout(300);

  // controlled AI failure → actionable error → retry success
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
  await expect(page.getByText(/网络连接失败 · 请检查网络后重试/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重新尝试" })).toBeVisible();
  await expect(bodyEditor).toHaveValue("");

  await page.getByRole("button", { name: "重新尝试" }).click();
  await expect(page.getByText(/你好，我是墨舟/)).toBeVisible();
  await expect(chatRequests).toBe(2);
  await expect(bodyEditor).toHaveValue("");

  // navigate away/back: current novel remains correct
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
  await expectCurrentNovel(page, novelTitle);

  // leave via visible link and come back
  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/guide/);
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
  await expectCurrentNovel(page, novelTitle);

  // refresh keeps the persisted selection
  await page.reload();
  await expect(page).toHaveURL(/\/workspace/);
  await expectCurrentNovel(page, novelTitle);

  // resource navigation responds on first click (from an AppShell page)
  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/guide/);
  await page.getByRole("link", { name: "书源搜索" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("heading", { name: "书源搜索" })).toBeVisible();
});
