# MoZhou Product-State & UX Reliability — Review Handoff

> 用途：把本次执行的测试、改动和中间问题完整交给另一个 AI 做代码评审。
> 仓库：`C:\zcode\novel-ai`（WSL 路径 `/mnt/c/zcode/novel-ai`）
> 日期：2026-08-18
> 执行范围：`mozhou-product-state-ux-reliability-implementation-plan.md` Task 0→6
> 当前工作树：**有大量预存未提交改动，本次也没有提交任何 commit**。评审时请以工作区现状为准。

---

## 1. 本次改动文件

### 新增
- `app/lib/novels/current-novel.ts` — 当前作品解析/持久化纯函数（localStorage）
- `app/lib/chat/user-facing-error.ts` — AI 错误 → 用户文案纯映射
- `app/playwright.config.ts` — Playwright E2E 配置
- `app/tests/e2e/product-state-current-novel.spec.ts`
- `app/tests/e2e/workbench-panel-state.spec.ts`
- `app/tests/e2e/ai-error-retry.spec.ts`
- `app/tests/e2e/navigation-first-click.spec.ts`
- `app/tests/e2e/golden-journey.spec.ts`
- `app/tests/unit/current-novel.test.ts`
- `app/tests/unit/user-facing-error.test.ts`
- `docs/audit/product-state-ux-reliability-baseline-2026-08-18.md`
- `docs/audit/review-handoff-2026-08-18.md`（本文件）

### 修改
- `app/components/features/workbench-view.tsx`
  - 自动解析并加载“当前作品”
  - 切换作品时写入 localStorage
  - 章节链接补上 `novelId/novel/ch/title` query 参数（修复从工作台进章节空白的问题）
- `app/components/features/projects-view.tsx` — 创建作品成功后写入当前作品 id
- `app/components/features/chapter-editor-view.tsx`
  - 使用 `toUserFacingAiError` 统一错误文案
  - 失败消息增加「重新尝试」按钮与 `retryMessage()`
- `app/next.config.ts` — 增加 `allowedDevOrigins: ["127.0.0.1"]`
- `app/package.json` — 增加 `@playwright/test` devDependency 和 `e2e` script
- `app/package-lock.json` — 依赖锁定更新

---

## 2. 本次新增/新增执行的测试

### 2.1 单元测试

#### `app/tests/unit/current-novel.test.ts`
测试 `resolveCurrentNovelId`：
1. 新创建 id 优先
2. 无新创建 id 时使用持久化 id
3. 持久化 id 已不可用时回退到第一个可用作品
4. 无作品时返回 null

```ts
import { describe, expect, it } from "vitest";
import { resolveCurrentNovelId } from "@/lib/novels/current-novel";

describe("resolveCurrentNovelId", () => {
  it("prefers the newly created novel id when it exists in the available list", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: 12,
        persistedId: 7,
        availableNovelIds: [7, 12],
      }),
    ).toBe(12);
  });

  it("uses the persisted id when there is no newly created id", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: null,
        persistedId: 7,
        availableNovelIds: [3, 7],
      }),
    ).toBe(7);
  });

  it("ignores a persisted id that is no longer available and falls back to the first owned novel", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: null,
        persistedId: 99,
        availableNovelIds: [5, 6],
      }),
    ).toBe(5);
  });

  it("returns null when there are no owned novels", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: null,
        persistedId: null,
        availableNovelIds: [],
      }),
    ).toBeNull();
  });
});
```

#### `app/tests/unit/user-facing-error.test.ts`
测试 `toUserFacingAiError`：
1. `AiNetworkError` → network / retryable
2. `AiTimeout` → timeout / retryable
3. `FREE_UNAVAILABLE` → free_unavailable / retryable
4. `AiRateLimited` / `RATE_LIMITED` → rate_limited / retryable
5. `undefined` / 未知 code → unknown / retryable

```ts
import { describe, expect, it } from "vitest";
import { toUserFacingAiError } from "@/lib/chat/user-facing-error";

describe("toUserFacingAiError", () => {
  it("maps AiNetworkError to a retryable network message", () => {
    expect(toUserFacingAiError("AiNetworkError")).toMatchObject({
      kind: "network",
      retryable: true,
    });
  });

  it("maps AiTimeout to a retryable timeout message", () => {
    expect(toUserFacingAiError("AiTimeout")).toMatchObject({
      kind: "timeout",
      retryable: true,
    });
  });

  it("maps FREE_UNAVAILABLE without leaking provider internals", () => {
    expect(toUserFacingAiError("FREE_UNAVAILABLE")).toMatchObject({
      kind: "free_unavailable",
      retryable: true,
    });
  });

  it("maps rate-limit codes to a retryable rate_limited message", () => {
    expect(toUserFacingAiError("AiRateLimited")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
    expect(toUserFacingAiError("RATE_LIMITED")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
  });

  it("falls back to a retryable unknown message", () => {
    expect(toUserFacingAiError(undefined)).toMatchObject({
      kind: "unknown",
      retryable: true,
    });
    expect(toUserFacingAiError("MysteryCode")).toMatchObject({
      kind: "unknown",
      retryable: true,
    });
  });
});
```

---

### 2.2 E2E 测试（Playwright）

#### `app/playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    cwd: __dirname,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env as Record<string, string>,
      NODE_ENV: "test",
      CHAT_PROVIDER: "mock",
      DISTILL_PROVIDER: "mock",
      DECONSTRUCT_PROVIDER: "mock",
      DRAW_PROVIDER: "mock",
      SOURCE_PROVIDER: "mock",
      WEBSEARCH_PROVIDER: "mock",
      RANKINGS_PROVIDER: "mock",
      SYNC_PROVIDER: "mock",
      FANQIE_SEARCH_MOCK: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
```

#### `app/tests/e2e/product-state-current-novel.spec.ts`
覆盖 P0-A：
1. 新建第一个作品后，进入 Workbench 应自动成为当前作品
2. 切换作品后，离开 Workbench 再回来仍保持选择
3. 刷新后保持选择
4. 删除当前作品后，回退到剩余作品

```ts
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "password123";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function register(page: Page, email: string) {
  await page.goto("/register", { waitUntil: "networkidle" });
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
  await page.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
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

  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.getByRole("link", { name: "工作台" }).click();
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

  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/projects/);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: `删除 ${second}`, exact: true }).click();
  await expect(page.getByText(second, { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await expectCurrentNovel(page, first);
});
```

#### `app/tests/e2e/workbench-panel-state.spec.ts`
覆盖 P0-B：Workbench 子导航高亮与列表内容来自同一个 `railExpanded` 状态。

```ts
import { test, expect, type Page } from "@playwright/test";

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
  await page.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
}

test("workbench sub-navigation uses one state for highlight and list content", async ({ page }) => {
  await registerAndOpenWorkbench(page);

  const outlineButton = page.getByRole("button", { name: /章节与大纲/ });
  const charactersButton = page.getByRole("button", { name: /人物关系/ });
  const worldButton = page.getByRole("button", { name: /世界规则/ });
  const mainHeading = page.getByRole("heading", { name: "接着写，还是先聊聊？" });

  await expect(mainHeading).toBeVisible();
  await expect(page.getByText("暂无章节")).toHaveCount(0);
  await expect(page.getByText("暂无人物")).toHaveCount(0);
  await expect(page.getByText("暂无世界观")).toHaveCount(0);

  await charactersButton.click();
  await expect(charactersButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByText("暂无人物")).toBeVisible();
  await expect(page.getByText("暂无章节")).toHaveCount(0);
  await expect(page.getByText("暂无世界观")).toHaveCount(0);
  await expect(mainHeading).toBeVisible();

  await worldButton.click();
  await expect(worldButton).toHaveClass(/bg-accent\/10/);
  await expect(charactersButton).not.toHaveClass(/bg-accent\/10/);
  await expect(page.getByText("暂无世界观")).toBeVisible();
  await expect(page.getByText("暂无人物")).toHaveCount(0);
  await expect(mainHeading).toBeVisible();

  await outlineButton.click();
  await expect(outlineButton).toHaveClass(/bg-accent\/10/);
  await expect(worldButton).not.toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("link", { name: /001 · 第一章/ })).toBeVisible();
  await expect(page.getByText("暂无世界观")).toHaveCount(0);
  await expect(mainHeading).toBeVisible();
});
```

#### `app/tests/e2e/ai-error-retry.spec.ts`
覆盖 P0-C：
1. `AiNetworkError` → 显示特定网络错误文案、正文不变、出现「重新尝试」；点击重试后发起新请求并成功
2. `FREE_UNAVAILABLE` → 显示免费模型不可用文案、正文不变、可重试

```ts
import { test, expect, type Page } from "@playwright/test";

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
      await route.fulfill({
        status: 200,
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
  await expect(page.getByText("操作没有成功")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新尝试" })).toBeVisible();
  await expect(bodyEditor).toHaveValue("");

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
```

#### `app/tests/e2e/navigation-first-click.spec.ts`
覆盖 P1-D：30 轮真实导航循环（书源搜索 ↔ 书源书架），要求首次点击即生效。

```ts
import { test, expect, type Page } from "@playwright/test";

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
```

#### `app/tests/e2e/golden-journey.spec.ts`
覆盖 Task 5 黄金旅程：注册 → 创建首个作品 → 当前作品 → Workbench 面板 → 进入章节 → AI 失败/重试 → 离开/返回 → 刷新 → 资源导航首次点击。

```ts
import { test, expect, type Page } from "@playwright/test";

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

  await page.goto("/register", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并开始写作" }).click();
  await expect(page).toHaveURL(/\/workspace/);

  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByLabel("书名").fill(novelTitle);
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/chapter\//);
  await page.waitForResponse((res) => res.url().includes("/chapters/messages") && res.status() === 200);
  await page.waitForTimeout(300);

  await page.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
  await expectCurrentNovel(page, novelTitle);

  const charactersButton = page.getByRole("button", { name: /人物关系/ });
  const worldButton = page.getByRole("button", { name: /世界规则/ });
  const outlineButton = page.getByRole("button", { name: /章节与大纲/ });
  const mainHeading = page.getByRole("heading", { name: "接着写，还是先聊聊？" });

  await charactersButton.click();
  await expect(charactersButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByText("暂无人物")).toBeVisible();
  await expect(mainHeading).toBeVisible();

  await worldButton.click();
  await expect(worldButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByText("暂无世界观")).toBeVisible();
  await expect(page.getByText("暂无人物")).toHaveCount(0);
  await expect(mainHeading).toBeVisible();

  await outlineButton.click();
  await expect(outlineButton).toHaveClass(/bg-accent\/10/);
  await expect(page.getByRole("link", { name: /001 · 第一章/ })).toBeVisible();
  await expect(page.getByText("暂无世界观")).toHaveCount(0);
  await expect(mainHeading).toBeVisible();

  const messagesLoaded = page.waitForResponse((res) => res.url().includes("/chapters/messages") && res.status() === 200);
  await page.getByRole("link", { name: /001 · 第一章/ }).click();
  await expect(page).toHaveURL(/\/chapter\//);
  await messagesLoaded;
  await page.waitForTimeout(300);

  const bodyEditor = page.getByLabel("章节正文编辑器");
  const chatInput = page.getByPlaceholder(/让 AI 起笔这一章|和 AI 对话，继续写这一章/);
  const sendButton = page.getByRole("button", { name: "发送" });
  const chatUrl = /\/api\/v1\/novels\/\d+\/chapters\/chat(?:\?|$)/;
  let chatRequests = 0;
  await page.route(chatUrl, async (route) => {
    chatRequests += 1;
    if (chatRequests === 1) {
      await route.fulfill({
        status: 200,
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

  await page.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
  await expectCurrentNovel(page, novelTitle);

  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.waitForTimeout(500);
  await expectCurrentNovel(page, novelTitle);

  await page.reload();
  await expect(page).toHaveURL(/\/workspace/);
  await expectCurrentNovel(page, novelTitle);

  await removeDevOverlay(page);
  await page.getByRole("link", { name: "使用说明" }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.getByRole("link", { name: "书源搜索" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("heading", { name: "书源搜索" })).toBeVisible();
});
```

---

## 3. 验证结果

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ PASS |
| `npx vitest run tests/unit` | ✅ 60 files / 314 tests PASS |
| `npx playwright test`（全部 E2E） | ✅ 9 tests PASS |
| `npm run build` | ✅ PASS |
| `npm test`（完整 unit + http） | ⚠️ 82/83 files、484/486 tests PASS；2 个间歇失败在 `tests/http/chapter-continuation.test.ts`，单独跑均 PASS |
| `git diff --check` | ⚠️ 仓库已有大量 CRLF/trailing-whitespace 噪音（预存改动），非本次新增文件问题 |

---

## 4. 中间遇到的问题（按出现顺序）

1. **本地 PostgreSQL 未启动**
   - 现象：`npm test` 报 `ECONNREFUSED 127.0.0.1:5433`。
   - 处理：用本地已有的 `postgres:18-alpine` 镜像直接起容器映射 5433，执行 `npm run db:migrate` 后测试可跑。
   - 备注：项目 compose 的 `pgvector/pgvector:pg16` 镜像拉取因网络 TLS 超时失败；当前 schema/测试未使用 vector 类型，所以用普通 postgres 即可。

2. **npm 安装 @playwright/test 时代理指向 7890 被拒**
   - 现象：`ECONNREFUSED 127.0.0.1:7890`。
   - 处理：改用 `--proxy=http://127.0.0.1:7892 --https-proxy=http://127.0.0.1:7892`，安装成功。

3. **Next.js 16 dev server 阻止 127.0.0.1 dev 资源，React 不水合**
   - 现象：Playwright 注册页点击后 URL 变成 `/register?email=...&password=...`，像是原生 GET 提交；原因是 JS 没水合、表单 `onSubmit` 未挂上。
   - 处理：`next.config.ts` 增加 `allowedDevOrigins: ["127.0.0.1"]` 并重启 dev server。
   - 教训：Next 16 默认对 dev 资源做 origin 校验，Playwright 用 127.0.0.1 时必须显式允许。

4. **Next.js dev overlay 拦截左下角「使用说明」链接**
   - 现象：点击被 `<nextjs-portal>` 拦截，Playwright 一直重试。
   - 处理：测试 helper `removeDevOverlay()` 在点击前移除 `nextjs-portal`。
   - 备注：这只影响 headless 测试环境，不是产品 bug。

5. **受控输入 hydration 竞态：创建按钮在 fill 后仍 disabled**
   - 现象：`page.goto('/projects')` 后立刻 `fill` 书名再点创建，按钮仍 disabled。
   - 处理：所有创建流程先 `await expect(创建按钮).toBeEnabled()` 再点击。

6. **慢速初始 `/chapters/messages` 请求覆盖本地聊天消息**
   - 现象：AI retry 测试中第一次失败/重试后消息突然消失；因为初始历史请求较晚返回，`setMessages(data.messages)` 覆盖了本地临时消息。
   - 处理：发送前等待 `/chapters/messages` 响应完成。
   - 备注：这可能也暗示产品端存在一个真实竞态：用户如果很快在历史加载完成前发消息，历史响应可能覆盖当前对话。建议评审关注。

7. **Workbench 章节链接缺少 `novelId` 等 query 参数**
   - 现象：Golden Journey 从 Workbench 点击「001 · 第一章」进入 `/chapter/:id` 后，章节页拿不到 `novelId`，正文/对话都不加载。
   - 处理：`workbench-view.tsx` 的章节链接改为与 Projects 一致，携带 `novelId/novel/ch/title`。
   - 备注：这是本次黄金旅程额外发现并修复的真实 bug。

8. **Workbench 面板测试断言错误**
   - 现象：最初断言「暂无章节」，但新建作品必然已有第一章，实际应显示章节链接。
   - 处理：改为断言 `001 · 第一章` 链接可见。

9. **完整 `npm test` 的 2 个间歇失败（预存问题）**
   - `POST chat：SSE start/delta/done + 消息落库`：payload observer 找到的 observation 缺少 `chapter_reference`/`skill` sections，疑似 observer 文件跨测试竞态。
   - `断开请求（abort）→ assistant 候选精确持久化为 stopped`：`attemptStatus?.status` 为 `undefined`，期望 `cancelled`，疑似 abort 时序。
   - 两者单独运行均通过；本次改动未触碰这些服务端路径，判断为既有测试 flakiness。

10. **Turbopack dev 日志噪音**
    - 长 E2E 运行中持续出现 `FATAL: An unexpected Turbopack error occurred ... conflicting effects for the same key`。
    - 所有测试仍通过；疑似 dev-only HMR 问题，生产 build 正常。建议单独向 Next.js 反馈或后续排查。

11. **`git diff --check` 全仓报 CRLF/trailing whitespace**
    - 仓库工作区本来就有大量已修改文件（含 `.scratch`、`oh-story` vendor 等）带 CRLF 行尾，`git diff --check` 会把这些行报成 trailing whitespace。
    - 本次没有做 mass formatting；只确认新增文件无此类问题。

---

## 5. 建议评审重点

- `current-novel.ts` 的 localStorage 方案是否满足“一个 source of truth”和“UI 状态不作授权边界”。
- `workbench-view.tsx` 自动恢复当前作品的 effect 是否有重复创建 session / 竞态风险。
- `chapter-editor-view.tsx` 的 `retryMessage()` 是否应复用原 user 消息、是否会留下重复消息、是否满足“显式新 attempt”。
- E2E 中 `removeDevOverlay` 和 `waitForTimeout` 是否过度依赖时序；是否有更稳定的等待策略。
- `npm test` 的 2 个间歇失败是否值得在本次范围内处理，还是应另立 ticket。
- Turbopack `conflicting effects` 是否与 `allowedDevOrigins` 或 dev server 长时间运行有关。

---

## 6. 第二轮评审修复（回应外部最终代码评审）

### P0-B：Workbench 中央主面板真正切换（已修）
- `workbench-view.tsx` 新增 `activePanel`（`outline | characters | world | null`），左侧导航与中央主面板同源。
- 点击「人物关系」→ 中央显示 `CharactersPanel`，「接着写，还是先聊聊？」不可见。
- 点击「世界规则」→ 中央显示 `WorldPanel`。
- 点击「章节与大纲」→ 中央显示 `OutlinePanel`。
- 新增/更新测试：
  - `tests/e2e/workbench-panel-state.spec.ts` 改为断言中央面板切换。
  - `tests/e2e/golden-journey.spec.ts` 同步更新。

### P0-D：history stale response 覆盖新消息（已修）
- `chapter-editor-view.tsx` 增加 `messagesVersionRef` 与 `mutateMessages`。
- 初始 `/chapters/messages` 返回时若版本号已变化则丢弃，不再覆盖用户已发送的本地消息。
- 新增 `tests/e2e/history-race.spec.ts`：延迟 history 响应，用户先发消息，断言旧响应不覆盖。

### P0-C：Retry 语义（已修）
- 服务端 `prepareChapterCandidate` 支持 `retryOfGenerationKey`：
  - 定位原始 assistant 生成，并复用其之前的 user message，不插入第二条 user 行。
  - 用新的 `generationKey` 创建新 assistant 候选和新 attempt。
- 路由 `POST /api/v1/novels/:id/chapters/chat` 接受 `retryOfGenerationKey`。
- 客户端 `sendChat(text, skills, retryOfGenerationKey)`：
  - retry 时不再 append 第二条 user 消息。
  - `retryMessage` 用失败 assistant 的 `generationKey` 发起重试。
- 新增测试：
  - `tests/unit/chapter-retry.test.ts`：user message 数保持 1、assistant 数变 2、attempt 数 2。
  - `tests/e2e/ai-error-retry.spec.ts` / `golden-journey.spec.ts`：第一次请求改为 `route.fetch()` 真正打到后端，再改写响应为错误，保证 retry 时后端存在原始 generation。

### Full-suite 2 个 nondeterministic failures（已修）
1. **Payload observer 竞态**：
   - `chapter-continuation.test.ts` / `chat.test.ts` 由 `find()` 改为 `slice(observationsBefore)`，只读取本次请求产生的 observation。
2. **Abort attempt 时序**：
   - 测试等待 candidate 已绑定 `attemptId` 后再 abort，避免“attempt 尚未创建”的无效断言。
   - `MockLlmTransport.stream()` 增加 100ms 起始延迟，给 abort/stop 留出确定性窗口。
- 结果：`npm test` 全量 **487/487 PASS**。

### Playwright Gate 两层化（已做）
- `playwright.config.ts`：
  - 默认 `npm run dev`（开发 E2E）。
  - `E2E_PROD=1` 时 `npm run start`（production build）。
- `package.json` 增加 `e2e` / `e2e:prod`。
- 结果：
  - dev 模式：10/10 PASS。
  - prod 模式（`E2E_PROD=1`）：10/10 PASS。
  - 注意：`next start` 会提示 `output: standalone` 建议使用 standalone server，但当前命令可用；如需完全消除警告可后续切换到 `node .next/standalone/server.js`。

### 最终验证（第二轮）
- `npx tsc --noEmit` ✅
- `npm test` ✅ 84 files / 487 tests
- `npx playwright test` ✅ 10 tests
- `E2E_PROD=1 npx playwright test` ✅ 10 tests
- `npm run build` ✅

---

## 7. Gate 1 & Gate 2 结果

### Gate 1 — retryOfGenerationKey security/idempotency
- 审计结论：`prepareChapterCandidate` 的 retry lookup 已在事务内先经过 `resolveChapterOwnership`（authenticated user + owned novel + owned chapter），再按 `chapterId + userId + generationKey + role=assistant` 查找原始生成；现有代码满足安全边界，无需重构。
- 新增测试（`tests/unit/chapter-retry.test.ts`，现共 6 个）：
  - cross-user 不能 retry 他人 generation（拒绝 `章节不存在`）
  - cross-novel 不能跨章节 retry（拒绝 `原始生成不存在`）
  - invalid key 拒绝
  - 同一新 key 快速双击 retry 幂等（不新增 user/assistant 重复）
  - 不同新 key 快速两次 retry 仍只保留 1 条 user message
- `npm test` 全量：**84 files / 492 tests PASS**。

### Gate 2 — real PUBLIC_FREE smoke
- 使用现有 `app/scripts/smoke-real-llm.mjs`，未修改 Provider Boundary。
- 结果：**真实外部 smoke 失败（外部 one-api 配置未就绪）**，但失败路径被结构化记录，未伪造 PASS。
- 脱敏记录：
  - httpStatus: 200
  - eventSequence: start → phase → phase → error
  - errorCode: `AiGenerationFailed`
  - audit: `sourceClass=PUBLIC_FREE`, `provider=one-api`, `model=deepseek-v4-flash`, `credentialOwner=platform`, `billingOwner=provider`, `terminalStatus=failed`, `errorClass=provider_client_error`, `attemptCount=1`, `usageStatus=unknown`
- 失败原因：one-api 是全新实例，`.env` 中的 `ONEAPI_TOKEN` 在该实例中不存在（日志：`无效的令牌` / `record not found`）。这是外部环境配置问题，不是代码缺陷。
- 未发生正文假写入：SSE 只有 error，无 done，脚本未执行插入步骤。
- 未发生 PLATFORM_PAID fallback：审计显示 `sourceClass=PUBLIC_FREE`，未跨 source class。
- 后续若要 smoke 成功，需要在 one-api 中配置真实 PUBLIC_FREE channel，并让 `.env` 的 `ONEAPI_TOKEN` 对应有效令牌。

### Gate 2 收尾
- `npm run build`：✅ PASS
- `E2E_PROD=1 npx playwright test tests/e2e/golden-journey.spec.ts`：✅ PASS

---

## 8. Gate 2 成功态（最终，2026-08-20）

one-api 运行环境配置完成后，真实 `PUBLIC_FREE` smoke 已成功。

### one-api 配置（运行环境，非业务代码）
- Channel: SenseNova Free PUBLIC_FREE（type=OpenAI-compatible）
- Base URL: `https://token.sensenova.cn`（one-api 会自动补 `/v1/chat/completions`）
- Model: `deepseek-v4-flash`
- Token: 新创建 one-api token，并已写入 `app/.env` 的 `ONEAPI_TOKEN`
- `ModelRatio` 已为 `deepseek-v4-flash` 配置倍率
- one-api 容器改用 `--network host`，解决 bridge 网络访问 SenseNova 不稳定问题

### 成功 smoke 脱敏记录
```text
httpStatus: 200
eventSequence: start → phase → delta×23 → phase → done
firstDeltaReceived: true
terminalEvent: done
errorCode: null
audit:
  sourceClass: PUBLIC_FREE
  provider: one-api
  model: deepseek-v4-flash
  credentialOwner: platform
  billingOwner: provider
  terminalStatus: succeeded
  errorClass: null
  attemptCount: 1
  usageStatus: unknown
ledgerRecordId: 720
```

### 已验证
- ✅ 真实 delta/done
- ✅ AI 消息持久化 + 刷新后仍在
- ✅ AI 结果插入正文 + 正文真实保存（尾部与 AI 文本一致）
- ✅ 无正文假写入（仅在 done 后插入）
- ✅ 无 `PLATFORM_PAID` fallback（`sourceClass=PUBLIC_FREE`）
- ✅ 无 `USER_BYOK` / `TEST_MOCK` 混入
- ✅ 未修改 Provider Boundary

### 最终四项 Gate
| Gate | 结果 |
|---|---|
| `npm test` | ✅ 84 files / 492 tests |
| `npm run build` | ✅ |
| `E2E_PROD=1 npx playwright test tests/e2e/golden-journey.spec.ts` | ✅ |
| `npm run smoke:real-llm` | ✅ |
