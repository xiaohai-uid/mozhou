/**
 * Prepare 步 = 纯函数查询组合（T16 · #40；chapter-pipeline-spec S2）。
 *
 * 聚合五族查询面为一份内存态结果集：章大纲节点 + scenes + AuthorIntent +
 * 活跃承诺 + stale 状态。纪律：
 *   - 不落盘——本模块零写入（测试以全树字节快照断言纯度）；
 *   - 确定性——同盘面必得同结果集（无时钟、无随机、行序即权威序）；
 *   - StaleMarker 只是建议性重验信号（I2）：命中 ⇒ 警告继续，不阻塞管线；
 *     留痕在 Compile 步以结构层段写进 Receipt（对账软门禁先例）。
 *
 * 刻意取舍：scenes 以章大纲 frontmatter `scenes` 数组原样条目透传（Scene 一等
 * 实体落盘形态归其实现票）；伏笔行只校验本查询消费的字段（行语义校验随伏笔
 * 实现票扩张，data-plane narrative-state 同款取舍）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PromiseStatus } from '@mozhou/kernel';
import {
  AUTHOR_INTENT_PATH,
  CanonStructureError,
  TRACKING_STREAMS,
  chapterOutlinePath,
} from '@mozhou/data-plane';
import { parseFrontmatter, readOutlineStaleMarker } from '@mozhou/data-plane';
import type { FrontmatterFieldValue } from '@mozhou/data-plane';
import type { StaleMarker } from '@mozhou/kernel';
import {
  parseFailurePatterns,
  parseMemoryAnchors,
  parseReaderExperienceDeltas,
  selectRecentDeltas,
  selectRelevantAnchors,
} from '@mozhou/quality-engine';
import type { FailurePattern, MemoryAnchor, ReaderExperienceDelta } from '@mozhou/quality-engine';

const PROMISE_STATUSES: readonly PromiseStatus[] = [
  'introduced',
  'reinforced',
  'due',
  'paid_off',
  'abandoned',
  'overdue',
];

/** 活跃承诺：未了结且已引入的承诺（paid_off/abandoned 出局；overdue 仍活跃）。 */
const ACTIVE_PROMISE_STATUSES: readonly PromiseStatus[] = ['introduced', 'reinforced', 'due', 'overdue'];

export interface ChapterOutlineView {
  /** 章大纲节点身份（chapter_ ULID；与正文文件同 id，章一体两面）。 */
  readonly nodeId: string;
  readonly chapterIndex: number;
  readonly title: string;
  readonly status: string;
  readonly revision: number;
  readonly relPath: string;
}

/** Scene 原样条目（frontmatter scenes 数组元素；深语义归 Scene 实现票）。 */
export interface SceneView {
  readonly fields: Readonly<Record<string, FrontmatterFieldValue>>;
}

export interface AuthorIntentView {
  readonly intentId: string;
  readonly revision: number;
  /** 宪法层正文原样携带（结构化字段化归后续票；I1 整体受保护）。 */
  readonly body: string;
}

export interface ActivePromiseView {
  readonly promiseId: string;
  readonly type: string;
  readonly description: string;
  readonly introducedChapter: number;
  readonly targetChapter: number | null;
  readonly status: PromiseStatus;
}

export interface ChapterPrepareInputs {
  readonly chapterIndex: number;
  readonly outlineNode: ChapterOutlineView;
  readonly scenes: readonly SceneView[];
  readonly authorIntent: AuthorIntentView;
  readonly activePromises: readonly ActivePromiseView[];
  /** 目标章大纲节点的 stale 标记；null = 未标记。警告继续，留痕在 Receipt。 */
  readonly staleMarker: StaleMarker | null;
  /**
   * ADR-0025（计划 Task 6）：有界质量切片——ReaderExperienceDelta 近窗 ≤5、
   * 活跃 FailurePattern、相关 MemoryAnchor ≤8。Kernel 外诊断数据（非 Canon）；
   * 书侧文件缺席 = 空切片（合法规划态）。供给既有结构段通道
   * （qualityStructuralSections），在既有预算内竞争，不开新无限频道。
   */
  readonly qualitySlice: QualityPreparationSlice;
}

export interface QualityPreparationSlice {
  readonly readerExperience: readonly ReaderExperienceDelta[];
  readonly activeFailurePatterns: readonly FailurePattern[];
  readonly memoryAnchors: readonly MemoryAnchor[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringField(
  data: Readonly<Record<string, FrontmatterFieldValue>>,
  key: string,
  relPath: string,
): string {
  const value = data[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' must be a non-empty string`);
  }
  return value;
}

function titleFromHeading(body: string, relPath: string): string {
  const match = /^#\s+(.+)\s*$/m.exec(body);
  if (match === null) {
    throw new CanonStructureError(relPath, 'missing H1 heading to carry the outline title');
  }
  return match[1]!.trim();
}

/** 伏笔行窄校验：只保证 Prepare 消费面的形状（宁败不脏）。 */
function parseActivePromiseRow(row: unknown, relPath: string, lineNo: number): ActivePromiseView {
  if (!isRecord(row)) {
    throw new CanonStructureError(relPath, `line ${lineNo} is not a JSON object`);
  }
  const id = row['id'];
  const type = row['type'];
  const description = row['description'];
  const introduced = row['introducedChapter'];
  const target = row['targetChapter'];
  const status = row['status'];
  if (typeof id !== 'string' || !id.startsWith('prom_')) {
    throw new CanonStructureError(relPath, `line ${lineNo} field 'id' must be a prom_ prefixed id`);
  }
  if (typeof type !== 'string') {
    throw new CanonStructureError(relPath, `line ${lineNo} field 'type' must be a string`);
  }
  if (typeof description !== 'string' || description.length === 0) {
    throw new CanonStructureError(relPath, `line ${lineNo} field 'description' must be a non-empty string`);
  }
  if (typeof introduced !== 'number' || !Number.isSafeInteger(introduced) || introduced < 1) {
    throw new CanonStructureError(relPath, `line ${lineNo} field 'introducedChapter' must be an integer >= 1`);
  }
  let targetChapter: number | null;
  if (target === null) {
    targetChapter = null;
  } else if (typeof target === 'number' && Number.isSafeInteger(target)) {
    targetChapter = target;
  } else {
    throw new CanonStructureError(relPath, `line ${lineNo} field 'targetChapter' must be null or an integer`);
  }
  if (typeof status !== 'string' || !(PROMISE_STATUSES as readonly string[]).includes(status)) {
    throw new CanonStructureError(relPath, `line ${lineNo} field 'status' must be one of ${PROMISE_STATUSES.join('|')}`);
  }
  return {
    promiseId: id,
    type,
    description,
    introducedChapter: introduced,
    targetChapter,
    status: status as PromiseStatus,
  };
}

function readAuthorIntent(root: string): AuthorIntentView {
  const raw = readFileSync(join(root, AUTHOR_INTENT_PATH), 'utf8');
  const document = parseFrontmatter(raw);
  const mozhouId = requireStringField(document.data, 'mozhouId', AUTHOR_INTENT_PATH);
  if (!mozhouId.startsWith('aint_')) {
    throw new CanonStructureError(AUTHOR_INTENT_PATH, `authorIntent mozhouId must start with 'aint_', got ${mozhouId}`);
  }
  const revision = document.data['revision'];
  if (typeof revision !== 'number') {
    throw new CanonStructureError(AUTHOR_INTENT_PATH, "frontmatter field 'revision' must be a number");
  }
  return { intentId: mozhouId, revision, body: document.body };
}

function readActivePromises(root: string, chapterIndex: number): ActivePromiseView[] {
  const stream = TRACKING_STREAMS.find((candidate) => candidate.kind === 'narrativePromise');
  if (stream === undefined) {
    throw new Error('unreachable: no narrativePromise tracking stream registered');
  }
  const relPath = stream.path;
  if (!existsSync(join(root, relPath))) {
    throw new CanonStructureError(relPath, 'promise stream file is missing');
  }
  const content = readFileSync(join(root, relPath), 'utf8');
  const lines = content.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }

  // 折叠：id 末行胜出（updated 语义与四族一致）
  const latest = new Map<string, ActivePromiseView>();
  lines.forEach((line, index) => {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new CanonStructureError(relPath, `line ${index + 1} is not valid JSON: ${(error as Error).message}`);
    }
    const promise = parseActivePromiseRow(row, relPath, index + 1);
    latest.set(promise.promiseId, promise);
  });

  return [...latest.values()]
    .filter(
      (promise) =>
        (ACTIVE_PROMISE_STATUSES as readonly string[]).includes(promise.status) &&
        promise.introducedChapter <= chapterIndex,
    )
    .sort((a, b) => (a.promiseId < b.promiseId ? -1 : a.promiseId > b.promiseId ? 1 : 0));
}

/**
 * Prepare 主入口：五族查询聚合成内存结果集。零写入；同盘面重复调用
 * 结果逐字段相等（纯度验收的机械含义）。
 */
/** 书侧质量诊断文件（质量/ 目录；Kernel 外、非 Canon）。 */
export const READER_EXPERIENCE_PATH = ['质量', 'reader-experience.jsonl'] as const;
export const MEMORY_ANCHORS_PATH = ['质量', 'memory-anchors.jsonl'] as const;
export const FAILURE_MEMORY_PATH = ['质量', 'failure-memory.jsonl'] as const;

function readJsonl(root: string, relParts: readonly string[]): string | null {
  const absolute = join(root, ...relParts);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

/** 有界质量切片：近窗诊断 ≤5 + 活跃失败模式 + 相关锚 ≤8（选择纯函数在 quality-engine）。 */
function readQualitySlice(root: string, chapterIndex: number): QualityPreparationSlice {
  const deltasRaw = readJsonl(root, READER_EXPERIENCE_PATH);
  const anchorsRaw = readJsonl(root, MEMORY_ANCHORS_PATH);
  const patternsRaw = readJsonl(root, FAILURE_MEMORY_PATH);
  const deltas = deltasRaw === null ? [] : parseReaderExperienceDeltas(deltasRaw);
  const anchors = anchorsRaw === null ? [] : parseMemoryAnchors(anchorsRaw);
  const patterns = patternsRaw === null ? [] : parseFailurePatterns(patternsRaw);
  return {
    readerExperience: selectRecentDeltas(deltas, { chapterIndex }),
    activeFailurePatterns: patterns.filter((pattern) => pattern.active),
    memoryAnchors: selectRelevantAnchors(anchors),
  };
}

/** 质量切片的结构段标识（Receipt entries 按 identifier 对齐）。 */
export const QUALITY_SECTION = 'quality_memory';

/** 质量切片 → 既有结构段（Receipt 按段记账；空切片不出段，零噪声）。 */
export function qualityStructuralSections(
  slice: QualityPreparationSlice,
): { readonly section: 'quality_memory'; readonly content: string }[] {
  const lines: string[] = [];
  for (const delta of slice.readerExperience) {
    lines.push(
      `delta ch${delta.chapterIndex}: pressure=${delta.pressureDelta} expectation=${delta.expectationDelta} ` +
        `gain=${delta.tangibleGain} payoff=${delta.payoff} pattern=${delta.solutionPattern}`,
    );
  }
  for (const pattern of slice.activeFailurePatterns) {
    lines.push(
      `failure ${pattern.code}: seen ${pattern.occurrences}x (ch${pattern.firstSeenChapter}-ch${pattern.lastSeenChapter})` +
        (pattern.authorNote === undefined ? '' : ` note=${pattern.authorNote}`),
    );
  }
  for (const anchor of slice.memoryAnchors) {
    lines.push(
      `anchor ${anchor.anchorId} [${anchor.type}] ${anchor.status} planted=ch${anchor.plantedChapter}` +
        `${anchor.lastEchoChapter === null ? '' : ` lastEcho=ch${anchor.lastEchoChapter}`}: ${anchor.description}`,
    );
  }
  if (lines.length === 0) return [];
  return [{ section: QUALITY_SECTION, content: lines.join('\n') }];
}

export function prepareChapterInputs(root: string, chapterIndex: number): ChapterPrepareInputs {
  if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 1) {
    throw new Error(`chapterIndex must be a positive integer, got ${chapterIndex}`);
  }
  const outlineRel = chapterOutlinePath(chapterIndex);
  const raw = readFileSync(join(root, outlineRel), 'utf8');
  const document = parseFrontmatter(raw);

  const nodeId = requireStringField(document.data, 'mozhouId', outlineRel);
  if (!nodeId.startsWith('chapter_')) {
    throw new CanonStructureError(outlineRel, `chapter outline mozhouId must start with 'chapter_', got ${nodeId}`);
  }
  const nodeType = requireStringField(document.data, 'nodeType', outlineRel);
  if (nodeType !== 'chapter') {
    throw new CanonStructureError(outlineRel, `expected chapter outline node, got nodeType '${nodeType}'`);
  }
  const status = requireStringField(document.data, 'status', outlineRel);
  const revision = document.data['revision'];
  if (typeof revision !== 'number') {
    throw new CanonStructureError(outlineRel, "frontmatter field 'revision' must be a number");
  }

  // scenes：frontmatter 数组原样透传；缺席/空数组都是合法规划态
  const rawScenes = document.data['scenes'];
  const scenes: SceneView[] = [];
  if (rawScenes !== undefined) {
    if (!Array.isArray(rawScenes)) {
      throw new CanonStructureError(outlineRel, "frontmatter field 'scenes' must be an array");
    }
    for (const entry of rawScenes) {
      if (!isRecord(entry)) {
        throw new CanonStructureError(outlineRel, "field 'scenes' entries must be mappings");
      }
      // YAML 解析面只产 FrontmatterFieldValue 值域；窄校验后按原样透传
      scenes.push({ fields: entry as Record<string, FrontmatterFieldValue> });
    }
  }

  // stale 状态：三平铺字段读回；不齐即视为无标记（宁缺勿猜）
  const staleMarker = readOutlineStaleMarker(document.data);

  return {
    chapterIndex,
    outlineNode: {
      nodeId,
      chapterIndex,
      title: titleFromHeading(document.body, outlineRel),
      status,
      revision,
      relPath: outlineRel,
    },
    scenes,
    authorIntent: readAuthorIntent(root),
    activePromises: readActivePromises(root, chapterIndex),
    staleMarker,
    qualitySlice: readQualitySlice(root, chapterIndex),
  };
}
