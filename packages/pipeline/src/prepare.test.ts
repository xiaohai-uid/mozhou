/**
 * T16 验收测试（#40）：Prepare 结果集纯度——纯函数查询组合不落盘。
 * 全树字节快照前后对照 + 双次调用结果逐字段相等（确定性）。
 * 零时钟零外部服务；书目录落在 hermetic 临时目录。
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBook,
  createChapterDraft,
  emitFrontmatter,
  openDatabase,
  parseFrontmatter,
  readManifest,
  type PlaneContext,
} from '@mozhou/data-plane';
import { prepareChapterInputs } from './index.js';

let roots: string[] = [];
function makeBook(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t16-prepare-'));
  roots.push(root);
  createBook({ dir: root, title: '墨舟测试' });
  return root;
}
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function planeCtx(root: string): PlaneContext {
  const db = openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') });
  return { root, db, manifest: readManifest(root) };
}

/** 全树字节指纹：相对路径 → sha256。目录结构变化也会反映在键集上。 */
function snapshotTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel))) {
      const childRel = rel === '' ? name : `${rel}/${name}`;
      if (!statSync(join(root, childRel)).isDirectory()) {
        files.set(childRel, createHash('sha256').update(readFileSync(join(root, childRel))).digest('hex'));
      } else {
        walk(childRel);
      }
    }
  };
  walk('');
  return files;
}

describe('prepareChapterInputs 纯度与五族聚合', () => {
  it('结果集聚合章大纲节点/scenes/AuthorIntent/活跃承诺/stale，且零落盘', () => {
    const root = makeBook();
    const ctx = planeCtx(root);
    try {
      createChapterDraft(ctx, { chapterIndex: 3, title: '夜探藏经阁' });

      // scenes 数组挂章大纲 frontmatter（Scene 一等实体的规划态落点）
      const outlineRel = '大纲/章节/第0003章.md';
      const document = parseFrontmatter(readFileSync(join(root, outlineRel), 'utf8'));
      writeFileSync(
        join(root, outlineRel),
        emitFrontmatter({
          ...document.data,
          scenes: [
            { sceneId: 'scene_a', summary: '林枫潜入藏经阁', povEntity: 'protagonist' },
            { sceneId: 'scene_b', summary: '守阁老人现身', povEntity: 'protagonist' },
          ],
        }) + document.body,
      );

      // 伏笔流：一条活跃、一条已了结、一条未来章引入、一条逾期仍活跃
      const promiseStream = join(root, '追踪/伏笔.jsonl');
      writeFileSync(
        promiseStream,
        [
          JSON.stringify({ id: 'prom_01', type: 'foreshadowing', description: '断剑的来历', introducedChapter: 1, targetChapter: null, status: 'introduced' }),
          JSON.stringify({ id: 'prom_02', type: 'quest', description: '宗门大比夺魁', introducedChapter: 1, targetChapter: 5, status: 'paid_off' }),
          JSON.stringify({ id: 'prom_03', type: 'secret', description: '长老的身份', introducedChapter: 9, targetChapter: null, status: 'introduced' }),
          JSON.stringify({ id: 'prom_04', type: 'countdown', description: '封印将破', introducedChapter: 2, targetChapter: 8, status: 'overdue' }),
        ].join('\n') + '\n',
      );

      const before = snapshotTree(root);
      const first = prepareChapterInputs(root, 3);
      const second = prepareChapterInputs(root, 3);
      const after = snapshotTree(root);

      // 纯度：双次调用间全树字节不变（不落盘），结果逐字段相等（确定性）
      expect(before).toEqual(after);
      expect(second).toEqual(first);

      // 章大纲节点面
      expect(first.outlineNode.nodeId).toMatch(/^chapter_/);
      expect(first.outlineNode.title).toBe('夜探藏经阁');
      expect(first.outlineNode.status).toBe('drafted');
      expect(first.outlineNode.relPath).toBe(outlineRel);

      // scenes 原样透传
      expect(first.scenes).toHaveLength(2);
      expect(first.scenes[0]!.fields['sceneId']).toBe('scene_a');

      // AuthorIntent 宪法层面
      expect(first.authorIntent.intentId).toMatch(/^aint_/);
      expect(first.authorIntent.body).toContain('作者意图');

      // 活跃承诺：已了结出局、未来章出局、id 升序确定序
      expect(first.activePromises.map((promise) => promise.promiseId)).toEqual(['prom_01', 'prom_04']);

      // 无标记 ⇒ stale 为 null
      expect(first.staleMarker).toBeNull();
    } finally {
      ctx.db.close();
    }
  });

  it('目标章大纲节点带 stale 三字段时读回 StaleMarker（警告继续的数据面）', () => {
    const root = makeBook();
    const ctx = planeCtx(root);
    try {
      createChapterDraft(ctx, { chapterIndex: 1, title: '开局' });
      const outlineRel = '大纲/章节/第0001章.md';
      const document = parseFrontmatter(readFileSync(join(root, outlineRel), 'utf8'));
      writeFileSync(
        join(root, outlineRel),
        emitFrontmatter({
          ...document.data,
          staleReason: 'upstream_canon_changed',
          staleMarkedAt: '2026-08-24T00:00:00.000Z',
          staleUpstreamRefs: [{ kind: 'temporalFact', id: 'fact_' + '0'.repeat(26), revision: 3 }],
        }) + document.body,
      );

      const before = snapshotTree(root);
      const prepared = prepareChapterInputs(root, 1);
      const after = snapshotTree(root);

      expect(before).toEqual(after); // 读路径依旧零写入
      expect(prepared.staleMarker).not.toBeNull();
      expect(prepared.staleMarker!.reason).toBe('upstream_canon_changed');
      expect(prepared.staleMarker!.markedAt).toBe('2026-08-24T00:00:00.000Z');
      expect(prepared.staleMarker!.upstreamRefs).toHaveLength(1);
    } finally {
      ctx.db.close();
    }
  });
});
