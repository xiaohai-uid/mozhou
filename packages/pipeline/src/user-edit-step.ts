/**
 * User Edit 步（T17 · #41；chapter-pipeline-spec §1 表第 5 行 / S4）。
 *
 * UserEditRecorded 捕获**结构化编辑操作块**（非字符 diff）：块 = 行号区间 +
 * 操作语义（insert/delete/replace），payload 原样落账供飞轮与回放消费。
 * 纪律：
 *   - M16 五级动作位 V1 只实现光标（cursor）+ 选区（selection）两级；面板/
 *     向导归 Phase 6，越级请求显式拒绝而非静默降级；
 *   - 保护位校验（I1）：assistant 通道的编辑落在 protectedUserContent 工件上
 *     即拒（kernel ProtectedContentViolationError 同源错误面）；**author 通道
 *     （作者亲笔，含人手外部编辑后的继续加工）不受 I1 禁令**——dual-plane Q10
 *     先例，草稿是共写区；
 *   - 编辑即时落正文文件（S8 Review/Edit 中行：编辑缓冲即时落盘），phase 保持
 *     draft；revision +1（离散编辑是可审计的版本步进，区别于 Draft 流式落盘
 *     的连续持久）；frontmatter 其余字段（含 protected 位）原样保留；
 *   - 写后刷新 hash 基线（同 draft-step 的编排方契约：长持句柄在步边界重开）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProtectedContentViolationError } from '@mozhou/kernel';
import type { DomainEvent } from '@mozhou/kernel';
import type { PublishBus } from '@mozhou/runtime';
import {
  atomicReplace,
  emitFrontmatter,
  parseFrontmatter,
  proseChapterPath,
  readManifest,
  readProseChapter,
  refreshManifestEntries,
  writeManifest,
} from '@mozhou/data-plane';
import type { FrontmatterFieldValue } from '@mozhou/data-plane';

/** M16 五级动作位的 V1 实现集：只做光标+选区两级（面板/向导/广场归后续 Phase）。 */
export const EDIT_ACTION_LEVELS_V1 = ['cursor', 'selection'] as const;

export type EditActionLevel = (typeof EDIT_ACTION_LEVELS_V1)[number];

/** 越级动作位：V1 未实现的级别显式拒绝（不静默降级）。 */
export class EditActionLevelError extends Error {
  override readonly name = 'EditActionLevelError';
  constructor(level: string) {
    super(
      `EDIT_ACTION_LEVEL_NOT_IMPLEMENTED: ${level} 不在 M16 五级的 V1 实现集 [${EDIT_ACTION_LEVELS_V1.join(', ')}] 内——面板/向导归 Phase 6`,
    );
  }
}

/** 操作块形状违例：宁败不猜（坏块不产生任何盘面副作用）。 */
export class EditBlockShapeError extends Error {
  override readonly name = 'EditBlockShapeError';
  constructor(detail: string) {
    super(`EDIT_BLOCK_SHAPE_INVALID: ${detail}`);
  }
}

/**
 * 结构化编辑操作块：以行为块的定位单元（1 起行号，闭区间），非字符 diff。
 *   - insert：单点插入，start===end===插入点行号（N = 在第 N 行前插入，
 *     N = 末行+1 即文末追加）；必带 replacementText；
 *   - delete：删除 [start,end] 行；不得携带 replacementText；
 *   - replace：[start,end] 行整体替换为 replacementText（可多行）。
 */
export interface EditOperationBlock {
  readonly op: 'insert' | 'delete' | 'replace';
  readonly paragraphStart: number;
  readonly paragraphEnd: number;
  /** insert/replace 必带；delete 不得携带。 */
  readonly replacementText?: string;
}

function validateBlock(block: EditOperationBlock, index: number): void {
  const label = `block #${index} (${block.op})`;
  if (!Number.isSafeInteger(block.paragraphStart) || block.paragraphStart < 1) {
    throw new EditBlockShapeError(`${label}: paragraphStart 必须为 >=1 的整数`);
  }
  if (!Number.isSafeInteger(block.paragraphEnd) || block.paragraphEnd < block.paragraphStart) {
    throw new EditBlockShapeError(`${label}: paragraphEnd 必须 >= paragraphStart`);
  }
  if (block.op === 'insert') {
    if (block.paragraphStart !== block.paragraphEnd) {
      throw new EditBlockShapeError(`${label}: insert 是单点操作，start 必须 === end`);
    }
    if (typeof block.replacementText !== 'string') {
      throw new EditBlockShapeError(`${label}: insert 必带 replacementText`);
    }
    return;
  }
  if (block.op === 'delete') {
    if (block.replacementText !== undefined) {
      throw new EditBlockShapeError(`${label}: delete 不得携带 replacementText`);
    }
    return;
  }
  // replace
  if (typeof block.replacementText !== 'string') {
    throw new EditBlockShapeError(`${label}: replace 必带 replacementText`);
  }
}

function replacementLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

/** 正文区 → 可寻址行数组（剥掉尾换行产生的一个空元素；空正文得空数组）。 */
function toAddressableLines(body: string): string[] {
  const lines = body.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

/**
 * 把操作块依序应用到一个行数组（原地修改）。纯内存计算，IO 归调用方。
 * 区间越界即抛 EditBlockShapeError（宁败不猜，零部分应用）。
 */
function applyBlockToLines(lines: string[], block: EditOperationBlock, index: number): void {
  const lastLine = lines.length;
  switch (block.op) {
    case 'insert': {
      if (block.paragraphStart > lastLine + 1) {
        throw new EditBlockShapeError(`block #${index}: 插入点 ${block.paragraphStart} 越界（当前 ${lastLine} 行）`);
      }
      lines.splice(block.paragraphStart - 1, 0, ...replacementLines(block.replacementText ?? ''));
      return;
    }
    case 'delete': {
      if (block.paragraphEnd > lastLine) {
        throw new EditBlockShapeError(`block #${index}: 区间 [${block.paragraphStart},${block.paragraphEnd}] 越界（当前 ${lastLine} 行）`);
      }
      lines.splice(block.paragraphStart - 1, block.paragraphEnd - block.paragraphStart + 1);
      return;
    }
    case 'replace': {
      if (block.paragraphEnd > lastLine) {
        throw new EditBlockShapeError(`block #${index}: 区间 [${block.paragraphStart},${block.paragraphEnd}] 越界（当前 ${lastLine} 行）`);
      }
      lines.splice(block.paragraphStart - 1, block.paragraphEnd - block.paragraphStart + 1, ...replacementLines(block.replacementText ?? ''));
      return;
    }
  }
}

/** 纯函数：对草稿正文应用一组结构化操作块（校验+应用一体；坏块整批拒绝）。 */
export function applyEditBlocks(body: string, blocks: readonly EditOperationBlock[]): string {
  if (blocks.length === 0) {
    throw new EditBlockShapeError('blocks 不得为空——编辑动作必须至少携带一个操作块');
  }
  blocks.forEach(validateBlock);
  const lines = toAddressableLines(body);
  blocks.forEach((block, index) => applyBlockToLines(lines, block, index));
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/* ---------------------------------------------------------------------------
 * 步执行：校验 → 应用 → 落盘 → UserEditRecorded
 * ------------------------------------------------------------------------- */

export interface RecordUserEditRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  /** 会话窗口任务引用（编排方从 ChapterProductionSession.taskRef 取）。 */
  readonly taskRef: string;
  readonly chapterIndex: number;
  readonly level: EditActionLevel;
  /**
   * 编辑通道：'author' = 作者亲笔（含人手在外部编辑器改完后的继续加工，
   * 不受 I1 禁令）；'assistant' = AI 产物回写（受保护位约束）。
   */
  readonly source: 'author' | 'assistant';
  readonly blocks: readonly EditOperationBlock[];
}

export interface UserEditOutcome {
  readonly proseRelPath: string;
  /** 应用全部操作块后的草稿全文（已落盘）。 */
  readonly body: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
}

/**
 * User Edit 步执行：结构化操作块 → 校验（动作位/形状/保护位）→ 应用 →
 * 即时落盘 → UserEditRecorded 落账。任何校验失败都零盘面副作用（宁败不脏）。
 */
export function recordUserEdit(request: RecordUserEditRequest): UserEditOutcome {
  if (!(EDIT_ACTION_LEVELS_V1 as readonly string[]).includes(request.level)) {
    throw new EditActionLevelError(String(request.level));
  }

  const relPath = proseChapterPath(request.chapterIndex);
  const scan = readProseChapter(request.bookRoot, relPath);
  if (scan.phase !== 'draft') {
    throw new Error(`user edit requires phase=draft, got ${scan.phase} (chapter ${request.chapterIndex})`);
  }

  // 保护位校验：读盘上 frontmatter 的 protected 位（外部编辑器可能翻转它）
  const absolutePath = join(request.bookRoot, relPath);
  const document = parseFrontmatter(readFileSync(absolutePath, 'utf8'));
  const protectedBit = document.data['protected'] === true;
  if (protectedBit && request.source === 'assistant') {
    throw new ProtectedContentViolationError('prose', scan.mozhouId, 'assistant-channel edit on protectedUserContent artifact is forbidden (I1)');
  }

  const nextBody = applyEditBlocks(scan.body, request.blocks);

  // frontmatter 字段原样保留（含 protected 位），只步进 revision——保护位声明
  // 不因编辑而丢失；phase 恒为 draft（相位翻转唯一入口是 commitChapter）
  const revisedFields: Record<string, FrontmatterFieldValue> = { ...document.data };
  revisedFields['revision'] = scan.revision + 1;
  revisedFields['chapterIndex'] = scan.chapterIndex;
  revisedFields['phase'] = 'draft';
  atomicReplace(request.bookRoot, relPath, `${emitFrontmatter(revisedFields)}${nextBody}`);

  writeManifest(
    request.bookRoot,
    refreshManifestEntries(readManifest(request.bookRoot), request.bookRoot, [relPath]),
  );

  const event: DomainEvent = {
    type: 'UserEditRecorded',
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    payload: {
      action: 'edit_blocks',
      level: request.level,
      source: request.source,
      blocks: request.blocks,
      revision: scan.revision + 1,
    },
  };
  request.bus.publish({ root: request.bookRoot }, event);

  return {
    proseRelPath: relPath,
    body: nextBody,
    revisionBefore: scan.revision,
    revisionAfter: scan.revision + 1,
  };
}
