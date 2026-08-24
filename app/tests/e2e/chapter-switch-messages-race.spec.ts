import { test, expect } from "@playwright/test";

// 回归：重试加载后，第一次运行（run#1）迟到的对话历史响应不得覆盖第二次运行的结果。
// 可达路径：正文 GET 首次失败（500）→ 用户点「重试加载」→ run#2 快速成功；
// run#1 的 messages 响应（延迟 4s、注入标记消息）此时才落地。
// 无 cancelled 守卫时它经 setMessages 最后写入，标记消息出现在面板（跨运行串台）。
// 修复语义：effect cleanup 的 cancelled 守卫覆盖章节键控的全部请求（正文 + 对话历史）。

const PASSWORD = "password123";
const MARKER = "跨运行串台标记消息";

function uniqueEmail(): string {
  return `e2e-msgrace-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test("重试加载后，首次运行的迟到对话历史不得覆盖新结果", async ({ page }) => {
  test.setTimeout(180_000);

  // 注册 → 创建作品 → 落在章节 A
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(uniqueEmail());
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);

  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("书名").fill(`E2E消息竞态-${Date.now()}`);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);
  await page.waitForTimeout(500);

  const url = new URL(page.url());
  const chapterAId = Number(url.pathname.match(/\/chapter\/(\d+)/)?.[1]);
  const novelId = Number(url.searchParams.get("novelId"));
  expect(chapterAId).toBeTruthy();

  // 安装一次性故障注入：
  //   正文 GET 第 1、2 次 → 500（覆盖 dev StrictMode 双执行，稳定进入显式失败态）
  //   messages 第 1 次 → 延迟 4s 并注入标记消息（run#1 的迟到响应）
  //   之后全部直通；「重试加载」驱动最后一次成功运行
  let bodyCalls = 0;
  let msgCalls = 0;
  const chaptersUrl = new RegExp(`/api/v1/novels/${novelId}/chapters\\?chapterId=${chapterAId}$`);
  const messagesUrl = new RegExp(
    `/api/v1/novels/${novelId}/chapters/messages\\?chapterId=${chapterAId}$`,
  );
  await page.route(chaptersUrl, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    bodyCalls += 1;
    if (bodyCalls <= 2) return route.fulfill({ status: 500, body: JSON.stringify({}) });
    return route.continue();
  });
  await page.route(messagesUrl, async (route) => {
    msgCalls += 1;
    if (msgCalls !== 1) return route.continue();
    const response = await route.fetch();
    const json = (await response.json().catch(() => null)) as { messages?: unknown[] } | null;
    const messages = Array.isArray(json?.messages) ? [...json.messages] : [];
    messages.push({
      id: 990001,
      role: "assistant",
      content: MARKER,
      status: "done",
      skills: [],
      snapshot: "",
      inserted: false,
      confirmInsert: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return route.fulfill({ response, body: JSON.stringify({ messages }) });
  });

  // 刷新进入故障窗口：正文失败 → 显式失败态
  await page.reload();
  await expect(page.getByText("加载失败", { exact: true })).toBeVisible({ timeout: 30_000 });
  const retry = page.getByRole("button", { name: "重试加载" });
  await expect(retry).toBeVisible();

  // 用户点重试：run#2 全速成功；此刻 run#1 的标记响应仍在途
  await retry.click();
  await expect(page.getByLabel("章节正文编辑器")).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();

  // 正向检查：面板已渲染 B 的真实空历史（该空态仅在 messages.length===0 时出现），
  // 排除「面板根本未渲染导致负向断言空洞通过」
  await expect(page.getByText("空章节：让 AI 起笔，再逐轮调整")).toBeVisible();

  // 等过 run#1 迟到响应的预定落地时刻（发出后 ~4.5s），再断言标记未出现
  await page.waitForTimeout(5000);
  await expect(page.getByText(MARKER)).toHaveCount(0);
});
