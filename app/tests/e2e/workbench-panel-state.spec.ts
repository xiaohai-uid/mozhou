import { test, expect, type Page } from "@playwright/test";

// P0-B browser regression: Workbench left navigation must switch BOTH the
// highlight and the central main panel. Clicking 人物关系/世界规则 must not
// leave the writing/outline main content visible.

const PASSWORD = "password123";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndOpenWorkbench(page: Page) {
  const email = uniqueEmail("e2e-panel");
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);

  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByLabel("书名").fill(`E2E面板-${Date.now()}`);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
}

test("workbench sub-navigation switches the central main panel", async ({ page }) => {
  await registerAndOpenWorkbench(page);

  const outlineButton = page.getByRole("button", { name: /章节与大纲/ });
  const charactersButton = page.getByRole("button", { name: /人物关系/ });
  const worldButton = page.getByRole("button", { name: /世界规则/ });
  const writingHeading = page.getByRole("heading", { name: "接着写，还是先聊聊？" });
  const charactersPanel = page.getByLabel("人物关系面板");
  const worldPanel = page.getByLabel("世界规则面板");
  const outlinePanel = page.getByLabel("章节与大纲面板");

  // Initial: writing panel is the main content.
  await expect(writingHeading).toBeVisible();

  // 人物关系: central panel must switch to characters; writing panel must hide.
  await charactersButton.click();
  await expect(charactersButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("heading", { name: "人物关系" })).toBeVisible();
  await expect(charactersPanel.getByText("暂无人物")).toBeVisible();
  await expect(writingHeading).toHaveCount(0);

  // 世界规则: central panel must switch to world; previous panel must hide.
  await worldButton.click();
  await expect(worldButton).toHaveClass(/bg-accent\/10/);
  await expect(charactersButton).not.toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("heading", { name: "世界规则" })).toBeVisible();
  await expect(worldPanel.getByText("暂无世界观")).toBeVisible();
  await expect(charactersPanel).toHaveCount(0);
  await expect(writingHeading).toHaveCount(0);

  // 章节与大纲: central panel must switch back to outline; world panel hides.
  await outlineButton.click();
  await expect(outlineButton).toHaveClass(/bg-accent\/10/);
  await expect(worldButton).not.toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("heading", { name: "章节与大纲" })).toBeVisible();
  // A freshly created novel already has its first chapter.
  await expect(outlinePanel.getByText(/001\s*·\s*第一章|001\s*第一章/)).toBeVisible();
  await expect(worldPanel).toHaveCount(0);
  await expect(writingHeading).toHaveCount(0);
});
