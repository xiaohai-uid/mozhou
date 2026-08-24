import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "password123";

function uniqueEmail(): string {
  return `e2e-workbench-sidebar-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function register(page: Page) {
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.getByLabel("邮箱").fill(uniqueEmail());
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

async function createNovel(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/novels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "侧栏服务失败回归作品",
        requestKey: `e2e-workbench-sidebar-${Date.now()}-${Math.random()}`,
      }),
    });
    if (!response.ok) throw new Error(`Novel setup failed: ${response.status}`);
    const payload = (await response.json()) as { novel?: { id?: number } };
    const novelId = payload.novel?.id;
    if (typeof novelId !== "number" || !Number.isInteger(novelId)) throw new Error("Novel setup did not return an id");
    window.localStorage.setItem("mozhou:current-novel-id", String(novelId));
    return novelId;
  });
}

test("workbench sidebar makes a failed novel request visible and retryable", async ({ page }) => {
  await register(page);

  let allowSuccess = false;
  await page.route(/\/api\/v1\/novels(?:\?.*)?$/, async (route) => {
    if (allowSuccess) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ novels: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "作品服务暂不可用" }),
    });
  });

  await page.goto("/deconstruct?surface=workbench", { waitUntil: "networkidle" });

  const sidebar = page.locator("[data-workbench-sidebar]");
  await expect(sidebar.getByRole("alert")).toContainText("作品加载失败");
  await expect(sidebar.getByRole("button", { name: "重试加载作品" })).toBeVisible();
  await expect(sidebar.getByText("还没有作品", { exact: true })).toHaveCount(0);

  allowSuccess = true;
  await sidebar.getByRole("button", { name: "重试加载作品" }).click();
  await expect(sidebar.getByRole("alert")).toHaveCount(0);
  await expect(sidebar.getByText("还没有作品", { exact: true })).toBeVisible();
});

test("workspace sidebar makes a failed novel request visible and retryable", async ({ page }) => {
  await register(page);

  let allowSuccess = false;
  await page.route(/\/api\/v1\/novels(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: allowSuccess ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(allowSuccess ? { novels: [] } : { error: "作品服务暂不可用" }),
    });
  });

  await page.reload({ waitUntil: "networkidle" });

  const sidebar = page.locator("[data-workbench-sidebar]");
  await expect(sidebar.getByRole("alert")).toContainText("作品加载失败");
  await expect(sidebar.getByRole("button", { name: "重试加载作品" })).toBeVisible();
  await expect(sidebar.getByText("还没有作品", { exact: true })).toHaveCount(0);

  allowSuccess = true;
  await sidebar.getByRole("button", { name: "重试加载作品" }).click();
  await expect(sidebar.getByRole("alert")).toHaveCount(0);
  await expect(sidebar.getByText("还没有作品", { exact: true })).toBeVisible();
});

for (const [label, suffix] of [
  ["作品详情", ""],
  ["市场简报", "/briefings"],
  ["参考方法包", "/benchmark-packs"],
] as const) {
  test(`workspace sidebar surfaces ${label} service failures for the selected novel`, async ({ page }) => {
    await register(page);
    const novelId = await createNovel(page);

    let allowSuccess = false;
    await page.route(`**/api/v1/novels/${novelId}${suffix}`, async (route) => {
      if (allowSuccess) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: `${label}服务暂不可用` }),
      });
    });

    await page.reload({ waitUntil: "networkidle" });

    const sidebar = page.locator("[data-workbench-sidebar]");
    await expect(sidebar.getByRole("alert")).toContainText("作品加载失败");
    await expect(sidebar.getByRole("button", { name: "重试加载作品" })).toBeVisible();
    await expect(sidebar.getByText("还没有作品", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "当前作品" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "自由回答，告诉墨舟你想让这一章发生什么…" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "发送" })).toHaveCount(0);

    allowSuccess = true;
    await sidebar.getByRole("button", { name: "重试加载作品" }).click();
    await expect(sidebar.getByRole("alert")).toHaveCount(0);
    await expect(sidebar.getByText("侧栏服务失败回归作品", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "自由回答，告诉墨舟你想让这一章发生什么…" })).toBeVisible();
  });
}

for (const [label, suffix] of [
  ["作品详情", ""],
  ["市场简报", "/briefings"],
  ["参考方法包", "/benchmark-packs"],
] as const) {
  test(`workbench sidebar surfaces ${label} service failures for the selected novel`, async ({ page }) => {
    await register(page);
    const novelId = await createNovel(page);

    await page.route(`**/api/v1/novels/${novelId}${suffix}`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: `${label}服务暂不可用` }),
      });
    });

    await page.goto("/deconstruct?surface=workbench", { waitUntil: "networkidle" });

    const sidebar = page.locator("[data-workbench-sidebar]");
    await expect(sidebar.getByRole("alert")).toContainText("作品加载失败");
    await expect(sidebar.getByText("还没有作品", { exact: true })).toHaveCount(0);
  });
}

test("workbench tool page exposes one main landmark", async ({ page }) => {
  await register(page);
  await page.goto("/rankings?surface=workbench", { waitUntil: "networkidle" });

  await expect(page.locator('[data-shell="workbench-tool"] main')).toHaveCount(1);
});
