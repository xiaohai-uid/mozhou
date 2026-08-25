/**
 * Review 步消费入口（T17 · #41；chapter-pipeline-spec §1 表第 4 行 / S5）。
 *
 * 本票边界：只保证 draft 产物可被机械核检入口**消费**——把盘上 phase=draft
 * 的正文章读成一份确定性输入记录（身份/相位/正文/字数），供硬门禁本体
 * （M2 时间线单调 + 四族行校验 + POV 秘密零泄漏 + dependency 引用完整性）
 * 在其实现票（T18）挂接。Gate 判定逻辑一概不在本模块——S5 拍板 Gate 纯机械，
 * LLM 审查只许做旁路建议，两者都不是本票交付物。
 */
import type { ChapterPhase } from '@mozhou/data-plane';
import { ChapterPhaseError, proseChapterPath, readProseChapter } from '@mozhou/data-plane';

/** 机械核检入口的输入记录：T18 门禁消费的冻结面。 */
export interface MechanicalReviewInput {
  readonly chapterIndex: number;
  readonly proseRelPath: string;
  /** 章节点身份（与章大纲同 id，章一体两面）。 */
  readonly mozhouId: string;
  readonly revision: number;
  readonly phase: Extract<ChapterPhase, 'draft'>;
  /** 草稿全文（frontmatter 之后的正文区）。 */
  readonly body: string;
  readonly charCount: number;
}

/**
 * Review 步入口：读指定章的 draft 产物为机械核检输入。
 * 章不存在/结构违例 → data-plane 原生错误穿透；已提交相位的章不是本步输入
 * （ChapterPhaseError 宁败不猜——回炉走 reopen 后重进管线）。
 */
export function loadDraftForReview(bookRoot: string, chapterIndex: number): MechanicalReviewInput {
  const relPath = proseChapterPath(chapterIndex);
  const scan = readProseChapter(bookRoot, relPath);
  if (scan.phase !== 'draft') {
    throw new ChapterPhaseError(
      chapterIndex,
      'review consumes phase=draft products, got ' + scan.phase + ' — reopen before re-review',
    );
  }
  return {
    chapterIndex: scan.chapterIndex,
    proseRelPath: scan.relPath,
    mozhouId: scan.mozhouId,
    revision: scan.revision,
    phase: 'draft',
    body: scan.body,
    charCount: scan.body.length,
  };
}
