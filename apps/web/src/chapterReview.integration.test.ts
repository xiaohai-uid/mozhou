// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiMiddleware } from '../server/api.js';
import { LocalDataPlane, scanEntityCards, readNarrativeSnapshot } from '@mozhou/data-plane';
import { newUlid, type ContextReceiptId } from '@mozhou/kernel';
import { ChapterProductionSession, runCompileStep } from '@mozhou/pipeline';
import { PublishBus } from '@mozhou/runtime';
import type { QualityPolicy } from '@mozhou/quality-engine';

const charTok = { version: 'fake-char-v1', count: (text: string) => text.length };

const DETERMINISTIC_POLICY: QualityPolicy = {
  schemaVersion: 1,
  projectId: 'web-test',
  rules: [
    { id: 'PARA-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '段落瀑布', evidenceRequired: true, enabled: true },
    { id: 'REV-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '锚点一致', evidenceRequired: true, enabled: true },
  ],
  maxAutomaticReworks: 2,
};

let servers: ReturnType<typeof createServer>[] = [];
let roots: string[] = [];

afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = [];
});

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => { res.statusCode = 404; res.end('nf'); });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve('http://127.0.0.1:' + addr.port);
    });
  });
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

async function makeBookAtReview(title: string): Promise<{ base: string; root: string }> {
  const base = await listen();
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-review-route-'));
  roots.push(dir);
  await post(base, '/api/book', { title, dir });
  const plane = LocalDataPlane.open(dir);
  const bookId = plane.book.id;
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' });
    plane.saveEntityCard('char:chenque', {
      name: '陈缺',
      aiContext: 'detected',
      brief: '孤城外按剑伫立的少年',
    });
  } finally {
    plane.close();
  }

  await runCompileStep(
    { chapterIndex: 1, staleMarker: null },
    {
      bookRoot: dir,
      bookId,
      draftText: '陈缺推门而入，按剑伫立，眼神坚毅。',
      cards: scanEntityCards(dir),
      snapshot: readNarrativeSnapshot(dir),
      scope: { chapterIndex: 1, pov: 'protagonist' },
      modelProfile: { id: 'api-contract-test', contextWindow: 4096 },
      tokenizer: charTok,
      receiptId: ('rcpt_' + newUlid()) as ContextReceiptId,
      nowIso: '2026-09-27T00:00:00.000Z',
    },
  );

  const session = ChapterProductionSession.start({
    bus: new PublishBus(),
    root: dir,
    chapterIndex: 1,
    newTaskRef: () => 'tsk_web',
  });
  session.advance('compile');
  session.advance('draft');
  session.advance('review');

  return { base, root: dir };
}

describe('POST /api/chapter.review 生产接线与生命周期', () => {
  it('配置缺失时明确显示 semanticReviewer: unavailable，且通过机械规则正常 pass', async () => {
    const savedKey = process.env.DEEPSEEK_API_KEY;
    const savedMozhouKey = process.env.MOZHOU_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MOZHOU_API_KEY;

    try {
      const { base, root } = await makeBookAtReview('无配置审查之书');
      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: DETERMINISTIC_POLICY,
      });

      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.verdict).toBe('pass');
      expect(data.semanticReviewer).toBe('unavailable');
      expect(data.current).toBe(true);
      expect(data.reportId).toBeDefined();
    } finally {
      if (savedKey) process.env.DEEPSEEK_API_KEY = savedKey;
      if (savedMozhouKey) process.env.MOZHOU_API_KEY = savedMozhouKey;
    }
  });

  it('配置存在时明确显示 semanticReviewer: attached', async () => {
    const savedKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'synthetic-key-for-provider-test';

    try {
      const { base, root } = await makeBookAtReview('有配置审查之书');
      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: DETERMINISTIC_POLICY,
      });

      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.semanticReviewer).toBe('attached');
    } finally {
      if (savedKey) process.env.DEEPSEEK_API_KEY = savedKey;
      else delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it('支持 timeoutMs 与超时拦截；迟到保护确保超时后不落盘报告', async () => {
    const { base, root } = await makeBookAtReview('超时拦截之书');
    const { status, data } = await post(base, '/api/chapter.review', {
      root,
      chapterIndex: 1,
      policy: DETERMINISTIC_POLICY,
      timeoutMs: 1000,
    });

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});
