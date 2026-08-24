import { expect, test, type Page } from "@playwright/test";

// R4 残留补全：workbench 风格单选胶囊——默认「无」、可选用户风格、随 /api/v1/chat 携带 styleId。
const PASSWORD = "password123";
const CURRENT_NOVEL_KEY = "mozhou:current-novel-id";

interface Novel {
  id: number;
  name: string;
}

function uniqueEmail(): string {
  return `e2e-workbench-style-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function register(page: Page) {
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.getByLabel("邮箱").fill(uniqueEmail());
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

async function createNovel(page: Page, name: string): Promise<Novel> {
  return page.evaluate(async ({ name, requestKey }) => {
    const response = await fetch("/api/v1/novels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, requestKey }),
    });
    const data = (await response.json()) as { novel?: Novel; error?: string };
    if (!response.ok || !data.novel) throw new Error(data.error ?? "创建作品失败");
    return data.novel;
  }, { name, requestKey: `e2e-workbench-style-${Date.now()}-${Math.random()}` });
}

async function seedStyle(page: Page, name: string): Promise<number> {
  return page.evaluate(async (name) => {
    const response = await fetch("/api/v1/styles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        guide: {
          narrative: "第三人称限制视角，贴主角",
          sentence: "短句为主，偶用长句收束",
          imagery: "水汽、灯影、旧纸页",
          rhythm: "静缓铺陈，转折处骤紧",
        },
      }),
    });
    const data = (await response.json()) as { style?: { id: number }; error?: string };
    if (!response.ok || !data.style) throw new Error(data.error ?? "保存风格失败");
    return data.style.id;
  }, name);
}

async function sendAndWaitSettled(page: Page, content: string) {
  await page.getByPlaceholder(/自由回答，告诉墨舟你想让这一章发生什么/).fill(content);
  await page.getByRole("button", { name: "发送" }).click();
  // mock provider 下流式很快结束：等「停止生成」换回「发送」即本轮完成
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
}

test("workbench style capsule defaults to 无 and carries selected styleId on chat", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  const novel = await createNovel(page, "风格胶囊回归作品");
  const styleId = await seedStyle(page, "冷冽白描");

  await page.evaluate(
    ({ key, novelId }) => window.localStorage.setItem(key, String(novelId)),
    { key: CURRENT_NOVEL_KEY, novelId: novel.id },
  );

  // 捕获 workbench 发出的 chat 请求体（直通后端，mock provider 完成生成）
  const chatBodies: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/v1\/chat$/, async (route) => {
    const raw = route.request().postData();
    if (raw) chatBodies.push(JSON.parse(raw) as Record<string, unknown>);
    await route.continue();
  });

  // WorkbenchView 挂在 /workspace；带持久化当前作品整页加载，触发上下文装载
  await page.goto("/workspace", { waitUntil: "networkidle" });

  // 胶囊渲染：「无」默认选中；用户风格全量出现
  const noneButton = page.getByRole("button", { name: "无", exact: true });
  const styleButton = page.getByRole("button", { name: "冷冽白描" });
  await expect(noneButton).toBeVisible();
  await expect(styleButton).toBeVisible();
  await expect(noneButton).toHaveAttribute("aria-pressed", "true");
  await expect(styleButton).toHaveAttribute("aria-pressed", "false");

  // 第一发（默认「无」）：styleId 为 null
  await sendAndWaitSettled(page, "先来一段没有风格的试笔");
  await expect.poll(() => chatBodies.length).toBeGreaterThanOrEqual(1);
  expect(chatBodies[0]).toMatchObject({ novelId: novel.id, styleId: null });

  // 选中用户风格：单选互斥翻转
  await styleButton.click();
  await expect(styleButton).toHaveAttribute("aria-pressed", "true");
  await expect(noneButton).toHaveAttribute("aria-pressed", "false");

  // 第二发：请求体携带所选 styleId
  await sendAndWaitSettled(page, "再按选定文风写一段");
  await expect.poll(() => chatBodies.length).toBeGreaterThanOrEqual(2);
  expect(chatBodies[chatBodies.length - 1]).toMatchObject({ novelId: novel.id, styleId });

  // 点回「无」：选中态翻转 + 请求体恢复不注入（wire 行为回归保护）
  await noneButton.click();
  await expect(noneButton).toHaveAttribute("aria-pressed", "true");
  await expect(styleButton).toHaveAttribute("aria-pressed", "false");
  await sendAndWaitSettled(page, "最后回到无风格再写一段");
  await expect.poll(() => chatBodies.length).toBeGreaterThanOrEqual(3);
  expect(chatBodies[chatBodies.length - 1]).toMatchObject({ novelId: novel.id, styleId: null });
});
