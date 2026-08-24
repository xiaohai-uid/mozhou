import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-first-chapter-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

async function register(): Promise<string> {
  const response = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(response.status).toBe(201);
  const token = response.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  return `mozhou_session=${token}`;
}

async function createFirstChapter(label: string): Promise<{ novelId: number; chapterId: number }> {
  const response = await fetch(`${BASE}/api/v1/novels/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: `第一章纵切片 ${label}`, requestKey: `vertical-${RUN}-${label}` }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { novel: { id: number }; chapter: { id: number; ch: string } };
  expect(body.chapter.ch).toBe("001");
  return { novelId: body.novel.id, chapterId: body.chapter.id };
}

async function generateCandidate(novelId: number, chapterId: number, content: string, generationKey: string) {
  const response = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ content, generationKey }),
  });
  expect(response.status).toBe(200);
  const events = (await response.text())
    .split("\n\n")
    .filter((event) => event.startsWith("data:"))
    .map((event) => JSON.parse(event.slice(5).trim())) as Array<{
      type: string;
      messageId?: number;
      [key: string]: unknown;
    }>;
  const done = events.find((event) => event.type === "done");
  expect(done?.messageId).toBeTruthy();
  return done!.messageId!;
}

async function getChapter(novelId: number, chapterId: number) {
  const response = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    chapter: { content: string; revision: number; ch: string; title: string };
  };
}

async function applyCandidate(
  novelId: number,
  chapterId: number,
  messageId: number,
  body: Record<string, unknown>,
) {
  return fetch(`${BASE}/api/v1/novels/${novelId}/chapters/messages/${messageId}/insert?chapterId=${chapterId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-first-chapter-%"));
  cookie = await register();
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-first-chapter-%"));
});

describe("Gate 1：第一章生产纵向切片", () => {
  it("create → intent → Candidate → 原始/编辑 apply → 刷新 → canonical export", async () => {
    const { novelId, chapterId } = await createFirstChapter("main");
    const initial = await getChapter(novelId, chapterId);
    expect(initial.chapter).toMatchObject({ ch: "001", title: "第一章", content: "", revision: 0 });

    const originalCandidateId = await generateCandidate(
      novelId,
      chapterId,
      "请生成第一章开场",
      `main-original-${RUN}`,
    );
    const originalApply = await applyCandidate(novelId, chapterId, originalCandidateId, {
      mode: "original",
      target: { mode: "insert" },
    });
    expect(originalApply.status).toBe(200);
    const afterOriginal = await getChapter(novelId, chapterId);
    expect(afterOriginal.chapter.revision).toBe(1);
    expect(afterOriginal.chapter.content.trim()).not.toBe("");

    const editedCandidateId = await generateCandidate(
      novelId,
      chapterId,
      "请继续第一章并允许人工编辑确认",
      `main-edited-${RUN}`,
    );
    const editedApply = await applyCandidate(novelId, chapterId, editedCandidateId, {
      mode: "edited",
      editedContent: "人工编辑后的第一章段落",
      target: { mode: "insert", expectedContent: afterOriginal.chapter.content },
    });
    expect(editedApply.status).toBe(200);

    const refreshed = await getChapter(novelId, chapterId);
    expect(refreshed.chapter.revision).toBe(2);
    expect(refreshed.chapter.content).toContain("人工编辑后的第一章段落");

    const exported = await fetch(`${BASE}/api/v1/books/${novelId}/export?format=json`, {
      headers: { cookie },
    });
    expect(exported.status).toBe(200);
    const body = (await exported.json()) as {
      schemaVersion: string;
      chapters: Array<{ ch: string; content: string; revision: number }>;
    };
    expect(body.schemaVersion).toBe("mozhou.novel.export.v1");
    expect(body.chapters).toHaveLength(1);
    expect(body.chapters[0]).toMatchObject({
      ch: "001",
      content: refreshed.chapter.content,
      revision: refreshed.chapter.revision,
    });
  });

  it("discard 不改正文；候选过期按 expectedContent 冲突语义处理（DELTA-003）", async () => {
    const { novelId, chapterId } = await createFirstChapter("discard-conflict");
    const discardedId = await generateCandidate(novelId, chapterId, "生成后丢弃", `discard-${RUN}`);
    const discard = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages/${discardedId}/discard?chapterId=${chapterId}`,
      { method: "POST", headers: { cookie } },
    );
    expect(discard.status).toBe(200);
    expect((await getChapter(novelId, chapterId)).chapter.content).toBe("");
    const discardedApply = await applyCandidate(novelId, chapterId, discardedId, {
      mode: "original",
      target: { mode: "insert" },
    });
    expect(discardedApply.status).toBe(400);

    const conflictId = await generateCandidate(novelId, chapterId, "生成后正文变化", `conflict-${RUN}`);
    const changed = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "用户在候选期间保存的正文" }),
    });
    expect(changed.status).toBe(200);
    // DELTA-003：基线过期不再拒绝；expectedContent 与服务端当前正文不一致 → 仍 409（不静默覆盖）
    const staleExpected = await applyCandidate(novelId, chapterId, conflictId, {
      mode: "original",
      target: { mode: "insert", expectedContent: "" },
    });
    expect(staleExpected.status).toBe(409);
    const conflictApply = await applyCandidate(novelId, chapterId, conflictId, {
      mode: "original",
      target: { mode: "insert" },
    });
    expect(conflictApply.status).toBe(200);
  });

  it("同一 Candidate 重复确认只允许第一次改变正文", async () => {
    const { novelId, chapterId } = await createFirstChapter("duplicate");
    const candidateId = await generateCandidate(novelId, chapterId, "生成后确认两次", `duplicate-${RUN}`);
    const first = await applyCandidate(novelId, chapterId, candidateId, {
      mode: "original",
      target: { mode: "insert" },
    });
    expect(first.status).toBe(200);
    const afterFirst = await getChapter(novelId, chapterId);
    const second = await applyCandidate(novelId, chapterId, candidateId, {
      mode: "original",
      target: { mode: "insert" },
    });
    expect(second.status).toBe(400);
    const afterSecond = await getChapter(novelId, chapterId);
    expect(afterSecond.chapter).toMatchObject({
      content: afterFirst.chapter.content,
      revision: afterFirst.chapter.revision,
    });
  });
});
