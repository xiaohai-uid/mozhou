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
 *   - 写后刷新 hash 基线（同 draft-step 的编排方契约：长持句柄在步边界重开）；
 *   - T21 编辑 delta（#54 · t52:B2）：payload 增 deltaStats 五字段（口径钉死恒有）；
 *     delete/replace 块由步内盖 removedText——应用前从行数组截取、全文无截断上限
 *     （与无上限的 replacementText 保持 diff 对称性），仅及发布侧克隆块；
 *     validateBlock 镜像守卫拒调用方传入该键（宁败不猜，杜绝伪造删除侧文本）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProtectedContentViolationError } from '@mozhou/kernel';
import type { DomainEvent } from '@mozhou/kernel';
import type { PublishBus } from '@mozhou/runtime';
import { hashProse, parseFailurePatterns, serializeFailurePatterns, updateFailurePatterns } from '@mozhou/quality-engine';
import type { CorrectionReason } from '@mozhou/quality-engine';
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

/** M16 五级动作位的 V1 实现集：只做光标+选区两级（面板/向导归后续 Phase）。 */
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
  /**
   * 删除侧原文（T21 · t52:B2）：**步内产出、仅及发布侧克隆块**——recordUserEdit
   * 在应用前从行数组截取后盖章，全文无截断上限（与无上限的 replacementText 保持
   * diff 对称性）；validateBlock 镜像守卫拒调用方传入。
   */
  readonly removedText?: string;
}

/** 编辑 delta 统计（T21 · t52:B2 五字段口径钉死）：随 UserEditRecorded.payload 恒有。 */
export interface EditDeltaStats {
  readonly opsInsert: number;
  readonly opsDelete: number;
  readonly opsReplace: number;
  /** Σ replacementText.length over insert+replace 块。 */
  readonly insertedChars: number;
  /** Σ 被 remove 行以 '\n' join 后的长度 over delete+replace 块。 */
  readonly removedChars: number;
}

function validateBlock(block: EditOperationBlock, index: number): void {
  const label = `block #${index} (${block.op})`;
  // T21 镜像守卫：删除侧文本由本步发布侧产出，调用方一律不得携带（镜像 delete
  // 不得携带 replacementText 的既有守卫；宁败不猜，杜绝伪造删除侧文本）
  if (block.removedText !== undefined) {
    throw new EditBlockShapeError(`${label}: removedText 由本步发布侧产出，调用方不得携带`);
  }
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
 * 把操作块依序应用到一个行数组（原地修改），返回该块移除的原文（'\n' join；
 * insert 无移除得 undefined）——T21 发布侧 removedText 盖章的数据源。纯内存
 * 计算，IO 归调用方。区间越界即抛 EditBlockShapeError（宁败不猜，零部分应用）。
 */
function applyBlockToLines(lines: string[], block: EditOperationBlock, index: number): string | undefined {
  const lastLine = lines.length;
  switch (block.op) {
    case 'insert': {
      if (block.paragraphStart > lastLine + 1) {
        throw new EditBlockShapeError(`block #${index}: 插入点 ${block.paragraphStart} 越界（当前 ${lastLine} 行）`);
      }
      lines.splice(block.paragraphStart - 1, 0, ...replacementLines(block.replacementText ?? ''));
      return undefined;
    }
    case 'delete': {
      if (block.paragraphEnd > lastLine) {
        throw new EditBlockShapeError(`block #${index}: 区间 [${block.paragraphStart},${block.paragraphEnd}] 越界（当前 ${lastLine} 行）`);
      }
      // 应用前从行数组截取（t52:B2 定案值）：被删行以 '\n' join 全文保留
      const removed = lines.slice(block.paragraphStart - 1, block.paragraphEnd).join('\n');
      lines.splice(block.paragraphStart - 1, block.paragraphEnd - block.paragraphStart + 1);
      return removed;
    }
    case 'replace': {
      if (block.paragraphEnd > lastLine) {
        throw new EditBlockShapeError(`block #${index}: 区间 [${block.paragraphStart},${block.paragraphEnd}] 越界（当前 ${lastLine} 行）`);
      }
      const removed = lines.slice(block.paragraphStart - 1, block.paragraphEnd).join('\n');
      lines.splice(block.paragraphStart - 1, block.paragraphEnd - block.paragraphStart + 1, ...replacementLines(block.replacementText ?? ''));
      return removed;
    }
  }
}

/**
 * 步内单遍应用：校验 → 依序应用到正文行数组 → 捕获各块移除的原文
 * （发布侧克隆块 removedText 盖章与 deltaStats 口径的同源数据）。
 */
function applyBlocksValidated(body: string, blocks: readonly EditOperationBlock[]): {
  readonly nextBody: string;
  readonly removedTexts: readonly (string | undefined)[];
} {
  if (blocks.length === 0) {
    throw new EditBlockShapeError('blocks 不得为空——编辑动作必须至少携带一个操作块');
  }
  blocks.forEach(validateBlock);
  const lines = toAddressableLines(body);
  const removedTexts = blocks.map((block, index) => applyBlockToLines(lines, block, index));
  return { nextBody: lines.length > 0 ? lines.join('\n') + '\n' : '', removedTexts };
}

/** 纯函数：对草稿正文应用一组结构化操作块（校验+应用一体；坏块整批拒绝）。 */
export function applyEditBlocks(body: string, blocks: readonly EditOperationBlock[]): string {
  return applyBlocksValidated(body, blocks).nextBody;
}

/** 五字段口径（t52:B2 精度修正钉死）：ops* 即块数；两字符量从克隆块汇总。 */
function computeDeltaStats(blocks: readonly EditOperationBlock[]): EditDeltaStats {
  let opsInsert = 0;
  let opsDelete = 0;
  let opsReplace = 0;
  let insertedChars = 0;
  let removedChars = 0;
  for (const block of blocks) {
    if (block.op === 'insert') opsInsert += 1;
    else if (block.op === 'delete') opsDelete += 1;
    else opsReplace += 1;
    if (block.replacementText !== undefined) insertedChars += block.replacementText.length;
    if (block.removedText !== undefined) removedChars += block.removedText.length;
  }
  return { opsInsert, opsDelete, opsReplace, insertedChars, removedChars };
}

/* -------------------------------------------------------------------------
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
  /**
   * ADR-0025（质量门集成 · 计划 Task 5）：结构化纠错元数据——作者承认本次
   * 编辑属于哪类文学失误。可选项：不提供 = 纯编辑（不产生纠错事件/记忆，
   * 字符 diff 语义零变化）；提供非空数组 = 记录 AuthorCorrectionRecorded
   * 并折叠进书侧失败记忆（质量/quality 记忆文件，质量先验非 Canon）。
   */
  readonly correctionReasons?: readonly CorrectionReason[];
  /** 纠错附注原文：只落书侧记忆文件（P1）；事件/遥测仅携带 SHA-256 摘要。 */
  readonly correctionNote?: string;
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

  // 单遍校验+应用：removedTexts 与 blocks 同序（delete/replace 为移除原文全文）
  const { nextBody, removedTexts } = applyBlocksValidated(scan.body, request.blocks);

  // T21（t52:B2）：发布侧克隆块盖 removedText——请求侧原数组零触碰，payload.blocks
  // 不再与 request.blocks 同一性（无消费者依赖此同一性，t52 复核在案）
  const publishedBlocks: readonly EditOperationBlock[] = request.blocks.map((block, index) => {
    const removed = removedTexts[index];
    return removed === undefined ? { ...block } : { ...block, removedText: removed };
  });

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
      blocks: publishedBlocks,
      revision: scan.revision + 1,
      deltaStats: computeDeltaStats(publishedBlocks),
    },
  };
  request.bus.publish({ root: request.bookRoot }, event);

  // ADR-0025（Task 5）：结构化纠错——仅当作者给出非空 reasons 时发声。
  // 事件携带摘要不携带附注原文（P0/P1 隐私分层）；失败记忆折叠进书侧
  // jsonl（append-only 行容读），是质量先验、不是 Canon 事实。
  const reasons = request.correctionReasons ?? [];
  if (reasons.length > 0) {
    recordAuthorCorrection({
      bus: request.bus,
      bookRoot: request.bookRoot,
      taskRef: request.taskRef,
      chapterIndex: request.chapterIndex,
      reasons,
      ...(request.correctionNote !== undefined ? { note: request.correctionNote } : {}),
    });
  }

  return {
    proseRelPath: relPath,
    body: nextBody,
    revisionBefore: scan.revision,
    revisionAfter: scan.revision + 1,
  };
}

/* -------------------------------------------------------------------------
 * 结构化纠错独立入口（ADR-0025 · Task 9 web 面）：纯纠错记录，零正文副作用
 * ------------------------------------------------------------------------- */

export interface RecordAuthorCorrectionRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  /** 归属会话窗口 taskRef（无活动会话时调用方自铸一次性引用）。 */
  readonly taskRef: string;
  readonly chapterIndex: number;
  readonly reasons: readonly CorrectionReason[];
  readonly note?: string;
}

export interface AuthorCorrectionOutcome {
  readonly reportId: string;
  readonly revision: number;
  readonly noteDigest: string | null;
}

/**
 * 纯纠错记录：AuthorCorrectionRecorded 落账 + 失败记忆折叠。不触碰正文文件、
 * 不步进 revision——纠错是元数据动作，编辑走 recordUserEdit。web 端
 * /api/chapter.corrections 与 recordUserEdit 共用本函数（单一事实源）。
 */
export function recordAuthorCorrection(request: RecordAuthorCorrectionRequest): AuthorCorrectionOutcome {
  if (request.reasons.length === 0) {
    return { reportId: '', revision: 0, noteDigest: null };
  }
  const noteDigest = request.note !== undefined ? hashProse(request.note) : null;
  const correctionEvent: DomainEvent = {
    type: 'AuthorCorrectionRecorded',
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    payload: {
      reasons: [...request.reasons],
      ...(request.note !== undefined ? { noteDigest } : {}),
    },
  };
  request.bus.publish({ root: request.bookRoot }, correctionEvent);

  const memoryDir = join(request.bookRoot, '质量');
  const memoryPath = join(memoryDir, 'failure-memory.jsonl');
  const existing = existsSync(memoryPath)
    ? parseFailurePatterns(readFileSync(memoryPath, 'utf8'))
    : [];
  const updated = updateFailurePatterns(
    existing,
    request.chapterIndex,
    request.reasons,
    request.note,
  );
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(memoryPath, serializeFailurePatterns(updated), 'utf8');

  return {
    reportId: `corr_${request.taskRef}_${request.chapterIndex}`,
    revision: 0,
    noteDigest,
  };
}