import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "password123";
const CURRENT_NOVEL_KEY = "mozhou:current-novel-id";

interface Novel {
  id: number;
  name: string;
}

interface Session {
  id: number;
  novelId: number | null;
}

function uniqueEmail(): string {
  return `e2e-workbench-context-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
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
  }, { name, requestKey: `e2e-workbench-context-${Date.now()}-${Math.random()}` });
}

async function createBoundSession(page: Page, novelId: number): Promise<Session> {
  return page.evaluate(async (novelId) => {
    const response = await fetch("/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ novelId }),
    });
    const data = (await response.json()) as { session?: Session; error?: string };
    if (!response.ok || !data.session) throw new Error(data.error ?? "创建会话失败");
    return data.session;
  }, novelId);
}

async function nameSession(page: Page, sessionId: number, content: string) {
  await page.evaluate(async ({ sessionId, content }) => {
    const response = await fetch("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, content }),
    });
    if (!response.ok) throw new Error(`命名会话失败（${response.status}）`);
    await response.text();
  }, { sessionId, content });
}

async function listSessions(page: Page): Promise<Session[]> {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/sessions");
    if (!response.ok) throw new Error(`读取会话失败（${response.status}）`);
    const data = (await response.json()) as { sessions: Session[] };
    return data.sessions;
  });
}

async function listSessionMessages(page: Page, sessionId: number): Promise<Array<{ content: string }>> {
  return page.evaluate(async (sessionId) => {
    const response = await fetch(`/api/v1/sessions/${sessionId}/messages`);
    if (!response.ok) throw new Error(`读取会话消息失败（${response.status}）`);
    const data = (await response.json()) as { messages: Array<{ content: string }> };
    return data.messages;
  }, sessionId);
}

async function finishDeconstruction(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "上传文本" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "workbench-context.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("这是用于工作台上下文回归的正文。".repeat(24)),
  });
  await expect(page.getByRole("button", { name: "开始拆解" })).toBeEnabled();
  const response = page.waitForResponse(
    (candidate) => candidate.url().includes("/api/v1/deconstruct/analyze") && candidate.status() === 200,
  );
  await page.getByRole("button", { name: "开始拆解" }).click();
  await response;
  await expect(page.getByRole("button", { name: "发送到写作对话" })).toBeVisible();
}

test("workbench chat binds the persisted current novel while existing sessions retain their own novel", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  const currentNovel = await createNovel(page, "工作台当前作品");
  const existingNovel = await createNovel(page, "已有会话作品");
  const existingSession = await createBoundSession(page, existingNovel.id);
  await nameSession(page, existingSession.id, "已有会话的作品上下文");
  await page.evaluate(
    ({ key, novelId }) => window.localStorage.setItem(key, String(novelId)),
    { key: CURRENT_NOVEL_KEY, novelId: currentNovel.id },
  );

  await page.goto("/chat?surface=workbench", { waitUntil: "networkidle" });
  const novelSelect = page.locator("label").filter({ hasText: /^作品/ }).locator("select");
  await expect(novelSelect).toHaveValue(String(currentNovel.id));

  await page.getByRole("button", { name: "新会话" }).click();
  await expect.poll(async () => {
    const sessions = await listSessions(page);
    return sessions.some((session) => session.id !== existingSession.id && session.novelId === currentNovel.id);
  }).toBe(true);

  const messagesLoaded = page.waitForResponse(
    (response) => response.url().includes(`/api/v1/sessions/${existingSession.id}/messages`) && response.status() === 200,
  );
  await page.getByRole("button", { name: "已有会话的作品上下文" }).click();
  await messagesLoaded;
  await expect(novelSelect).toHaveValue(String(existingNovel.id));
});

test("workbench chat validates the persisted novel before allowing a new session", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  const currentNovel = await createNovel(page, "即时新会话作品");
  await page.evaluate(
    ({ key, novelId }) => window.localStorage.setItem(key, String(novelId)),
    { key: CURRENT_NOVEL_KEY, novelId: currentNovel.id },
  );

  let releaseNovelList: () => void;
  const novelListReleased = new Promise<void>((resolve) => {
    releaseNovelList = resolve;
  });
  let markNovelListRequested: () => void;
  const novelListRequested = new Promise<void>((resolve) => {
    markNovelListRequested = resolve;
  });
  const novelListMatcher = "**/api/v1/novels";
  await page.route(novelListMatcher, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    markNovelListRequested();
    await novelListReleased;
    await route.continue();
  });

  try {
    await page.goto("/chat?surface=workbench", { waitUntil: "domcontentloaded" });
    await novelListRequested;
    const newSessionButton = page.getByRole("button", { name: "新会话" });
    await expect(newSessionButton).toBeDisabled();
    releaseNovelList!();
    const novelSelect = page.locator("label").filter({ hasText: /^作品/ }).locator("select");
    await expect(novelSelect).toHaveValue(String(currentNovel.id));
    await expect(newSessionButton).toBeEnabled();
    const sessionCreated = page.waitForResponse(
      (response) => response.url().includes("/api/v1/sessions") && response.request().method() === "POST" && response.status() === 201,
    );
    await newSessionButton.click();
    await sessionCreated;
  } finally {
    releaseNovelList!();
  }

  await expect.poll(async () => {
    const sessions = await listSessions(page);
    return sessions.some((session) => session.novelId === currentNovel.id);
  }).toBe(true);
});

test("switching works detaches the loaded session before sending", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  const novelA = await createNovel(page, "会话作品 A");
  const novelB = await createNovel(page, "目标作品 B");
  const sessionA = await createBoundSession(page, novelA.id);
  await nameSession(page, sessionA.id, "作品 A 的已有会话");
  await page.evaluate(
    ({ key, novelId }) => window.localStorage.setItem(key, String(novelId)),
    { key: CURRENT_NOVEL_KEY, novelId: novelA.id },
  );

  await page.goto("/chat?surface=workbench", { waitUntil: "networkidle" });
  const messagesLoaded = page.waitForResponse(
    (response) => response.url().includes(`/api/v1/sessions/${sessionA.id}/messages`) && response.status() === 200,
  );
  await page.getByRole("button", { name: "作品 A 的已有会话" }).click();
  await messagesLoaded;

  const novelSelect = page.locator("label").filter({ hasText: /^作品/ }).locator("select");
  await novelSelect.selectOption(String(novelB.id));
  await expect.poll(async () =>
    page.evaluate((key) => window.localStorage.getItem(key), CURRENT_NOVEL_KEY),
  ).toBe(String(novelB.id));
  const content = "切换作品后必须进入 B 会话";
  await page.getByPlaceholder("输入消息，Enter 发送，Shift+Enter 换行").fill(content);
  await page.getByRole("button", { name: "发送" }).click();

  await expect.poll(async () => {
    const sessions = await listSessions(page);
    return sessions.some((session) => session.id !== sessionA.id && session.novelId === novelB.id);
  }).toBe(true);
  await expect.poll(async () => {
    const messages = await listSessionMessages(page, sessionA.id);
    return messages.some((message) => message.content === content);
  }).toBe(false);

  await page.reload({ waitUntil: "networkidle" });
  await expect(novelSelect).toHaveValue(String(novelB.id));
  await expect(page.locator("[data-workbench-sidebar]")).toContainText("目标作品 B");
});

test("a failed session load leaves the previous session context intact", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  const novelA = await createNovel(page, "稳定作品 A");
  const novelB = await createNovel(page, "失败加载作品 B");
  const sessionA = await createBoundSession(page, novelA.id);
  const sessionB = await createBoundSession(page, novelB.id);
  await nameSession(page, sessionA.id, "稳定会话 A");
  await nameSession(page, sessionB.id, "失败会话 B");
  await page.evaluate(
    ({ key, novelId }) => window.localStorage.setItem(key, String(novelId)),
    { key: CURRENT_NOVEL_KEY, novelId: novelA.id },
  );

  await page.goto("/chat?surface=workbench", { waitUntil: "networkidle" });
  const loadedA = page.waitForResponse(
    (response) => response.url().includes(`/api/v1/sessions/${sessionA.id}/messages`) && response.status() === 200,
  );
  await page.getByRole("button", { name: "稳定会话 A" }).click();
  await loadedA;

  await page.route(`**/api/v1/sessions/${sessionB.id}/messages`, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "暂不可用" }) });
  });
  const failedB = page.waitForResponse(
    (response) => response.url().includes(`/api/v1/sessions/${sessionB.id}/messages`) && response.status() === 503,
  );
  await page.getByRole("button", { name: "失败会话 B" }).click();
  await failedB;

  const novelSelect = page.locator("label").filter({ hasText: /^作品/ }).locator("select");
  await expect(novelSelect).toHaveValue(String(novelA.id));
  await expect(page.locator("[data-chat-error]")).toContainText("会话加载失败，请重试");
});

test("the latest session selection wins when an older load resolves late", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  const novelB = await createNovel(page, "延迟会话作品 B");
  const novelC = await createNovel(page, "最新会话作品 C");
  const sessionB = await createBoundSession(page, novelB.id);
  const sessionC = await createBoundSession(page, novelC.id);
  await nameSession(page, sessionB.id, "延迟会话 B");
  await nameSession(page, sessionC.id, "最新会话 C");
  await page.evaluate(
    ({ key, novelId }) => window.localStorage.setItem(key, String(novelId)),
    { key: CURRENT_NOVEL_KEY, novelId: novelB.id },
  );

  let releaseB: () => void;
  const bReleased = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  let markBRequested: () => void;
  const bRequested = new Promise<void>((resolve) => {
    markBRequested = resolve;
  });
  await page.route(`**/api/v1/sessions/${sessionB.id}/messages`, async (route) => {
    markBRequested();
    await bReleased;
    await route.continue();
  });

  try {
    await page.goto("/chat?surface=workbench", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "延迟会话 B" }).click();
    await bRequested;
    const loadedC = page.waitForResponse(
      (response) => response.url().includes(`/api/v1/sessions/${sessionC.id}/messages`) && response.status() === 200,
    );
    await page.getByRole("button", { name: "最新会话 C" }).click();
    await loadedC;
    const novelSelect = page.locator("label").filter({ hasText: /^作品/ }).locator("select");
    const chatSurface = page.locator("section").first();
    await expect(novelSelect).toHaveValue(String(novelC.id));
    await expect(chatSurface.getByText("最新会话 C", { exact: true })).toBeVisible();
    const loadedB = page.waitForResponse(
      (response) => response.url().includes(`/api/v1/sessions/${sessionB.id}/messages`) && response.status() === 200,
    );
    releaseB!();
    await loadedB;
    await page.waitForTimeout(500);
    await expect(novelSelect).toHaveValue(String(novelC.id));
    await expect(chatSurface.getByText("延迟会话 B", { exact: true })).toHaveCount(0);
  } finally {
    releaseB!();
  }
});

test("a session list outage is explicit, blocks actions, and can be retried", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  let failSessionList = true;
  await page.route("**/api/v1/sessions", async (route) => {
    if (route.request().method() === "GET" && failSessionList) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "暂不可用" }) });
      return;
    }
    await route.continue();
  });

  await page.goto("/chat", { waitUntil: "networkidle" });
  await expect(page.locator("[data-chat-error]")).toContainText("会话加载失败，请重试");
  await page.getByPlaceholder("输入消息，Enter 发送，Shift+Enter 换行").fill("服务不可用时不能发送");
  await expect(page.getByRole("button", { name: "新会话" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();

  failSessionList = false;
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator("[data-chat-error]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新会话" })).toBeEnabled();
});

test("a novel list outage is explicit, blocks actions, and can be retried", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  let failNovelList = true;
  await page.route("**/api/v1/novels", async (route) => {
    if (route.request().method() === "GET" && failNovelList) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "暂不可用" }) });
      return;
    }
    await route.continue();
  });

  await page.goto("/chat", { waitUntil: "networkidle" });
  await expect(page.locator("[data-chat-error]")).toContainText("作品加载失败，请重试");
  await expect(page.getByRole("button", { name: "新会话" })).toBeDisabled();
  const novelSelect = page.locator("label").filter({ hasText: /^作品/ }).locator("select");
  await expect(novelSelect).toBeDisabled();

  failNovelList = false;
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator("[data-chat-error]")).toHaveCount(0);
  await expect(novelSelect).toBeEnabled();
});

test("deconstruction returns to workbench chat when opened from the workbench", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  await finishDeconstruction(page, "/deconstruct?surface=workbench");

  await page.getByRole("button", { name: "发送到写作对话" }).click();
  await expect(page).toHaveURL(/\/chat\?surface=workbench$/);
  await expect(page.locator('[data-shell="workbench-tool"]')).toBeVisible();
});

test("deconstruction keeps the ordinary chat route outside the workbench", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page);
  await finishDeconstruction(page, "/deconstruct");

  await page.getByRole("button", { name: "发送到写作对话" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('[data-shell="workbench-tool"]')).toHaveCount(0);
});
