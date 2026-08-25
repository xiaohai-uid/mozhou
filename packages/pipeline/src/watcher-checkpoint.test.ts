/**
 * S10 测试（T19 · #43）：watcher × S3 写前校验交互——管线在步边界检查点响应
 * EXTERNAL_MODIFIED（步内不打断，避免半步状态 × 对账叠加）；对账软门禁
 * （警告不硬阻塞）适用于整条管线。零时钟零外部服务。
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDataPlane, createBook, proseChapterPath } from '@mozhou/data-plane';
import {
  CheckpointSuspendedError,
  guardedPipelineStep,
  pipelineReconciliationGate,
  stepBoundaryCheckpoint,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** 建书 + 建章草稿（phase=draft）。 */
function makeDraftBook(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  createBook({ dir, title: '对账之书' });
  LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });
  return dir;
}

/** 提交第二章（最小提交：零增量，相位翻转即正典化）。 */
function commitChapter2(dir: string): void {
  LocalDataPlane.open(dir).commitChapter({ chapterIndex: 2, summary: '第二章定稿', finalProse: '第二章定稿正文。' });
}

describe('S10 步边界检查点：EXTERNAL_MODIFIED 只在边界响应', () => {
  it('committed 章被外部改动 ⇒ 边界检查点挂起抛错，步函数未被执行', async () => {
    const dir = makeDraftBook('mozhou-t19-w1-');
    commitChapter2(dir);

    // 外部改动（绕过相位机直接写字节）
    appendFileSync(join(dir, proseChapterPath(2)), '外部编辑器追加的一行\n');

    let stepRan = false;
    await expect(
      guardedPipelineStep(dir, 2, () => {
        stepRan = true;
        return 'ok';
      }),
    ).rejects.toThrow(CheckpointSuspendedError);
    expect(stepRan).toBe(false); // 挂起发生在进入步之前——半步状态不会与对账叠加
    expect(() => stepBoundaryCheckpoint(dir, 2)).toThrow(/正文\/第一卷\/第0002章\.md/);
  });

  it('步内不打断：入界干净则步照常完成（步内外部改动不被打断），下一次入界才挂起', async () => {
    const dir = makeDraftBook('mozhou-t19-w2-');
    commitChapter2(dir);

    // 入界时基线干净 ⇒ 本步完整执行；步内发生的外部改动不打断本步
    const outcome = await guardedPipelineStep(dir, 2, () => {
      appendFileSync(join(dir, proseChapterPath(2)), '步中途到达的外部改动\n');
      return 42;
    });
    expect(outcome).toBe(42); // 步内零打断

    // 出边界 = 下一步的入边界：此刻才响应对账
    expect(() => stepBoundaryCheckpoint(dir, 2)).toThrow(CheckpointSuspendedError);
  });

  it('draft 自由改豁免（S2 分面）：草稿章外改既不挂起也不产对账警告', () => {
    const dir = makeDraftBook('mozhou-t19-w3-'); // 第二章仍是 phase=draft
    appendFileSync(join(dir, proseChapterPath(2)), '作者的草稿自由涂改\n');

    expect(() => stepBoundaryCheckpoint(dir, 2)).not.toThrow();
    const warnings = pipelineReconciliationGate(dir);
    expect(warnings).toEqual([]); // 草稿自由改不入对账面
  });
});

describe('S10 对账软门禁（整条管线）：警告不硬阻塞', () => {
  it('pass-through：面内改动只折算为警告返回，调用方照常拿到结果、永不抛', () => {
    const dir = makeDraftBook('mozhou-t19-w4-');
    commitChapter2(dir);
    appendFileSync(join(dir, proseChapterPath(2)), '外部改动\n');

    // 直接调用（不经 expect 的异常通道）——软门禁必须原样返回值
    const warnings = pipelineReconciliationGate(dir);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toMatchObject({ relPath: proseChapterPath(2), kind: 'external_modified' });

    // 与步边界检查点的分工同框可见：同一盘面，硬面挂起、软面放行
    expect(() => stepBoundaryCheckpoint(dir, 2)).toThrow(CheckpointSuspendedError);
    expect(pipelineReconciliationGate(dir).length).toBe(warnings.length);
  });
});

