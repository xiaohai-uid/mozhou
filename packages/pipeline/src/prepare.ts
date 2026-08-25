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
  };
}
