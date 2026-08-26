/**
 * 文风.md 结构化存储（T23 · #56；t48-b §2 物理形态裁决 / §6-A）。
 *
 * body 冻结为一个 fenced-YAML 块：`profiles:` map × 四 ScenarioType，每行携带
 * 建书时一次性铸好的独立 style_<ULID> id 与五分面值。frontmatter 的单一
 * mozhouId 仍是文件身份锚（PlanningArtifactScan 不动，contentSha256 覆盖任何
 * 分面变化）；**vN = 各行 revision**（KernelEntityHead.revision 语义，按章批次 +1）。
 *
 * **I1 受控豁免契约（t51:B1 · Contract Delta）**：文风.md frontmatter 保持
 * `protected: true` 不削弱——I1 挡的是生成管线等无差别自动化通道，不禁飞轮
 * 自维护。豁免三件套缺一不可：
 *   1. 唯一合法写者 = flywheel 的 StyleProfileStore（本文件只提供纯序列化/解析，
 *      不做任何写盘）；
 *   2. 全部写路径收口到 store 的 writeStyleProfiles 单口；
 *   3. 每次写盘强制伴随 StyleProfileUpdated 审计事件（审计替代禁令，
 *      kernel/domain-events.ts 词表 T21 已入列）。作者手改仍走 EXTERNAL_MODIFIED
 *      对账且永远赢。
 *
 * YAML 纪律同 yaml-frontmatter.ts：不引第三方依赖，只处理自己发射的确定性
 * 子集；解析对一切违例抛错——宁败不脏（canon-read 同款纪律）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newStyleProfileId } from '@mozhou/kernel';
import type { ScenarioType, SentenceLengthBucket } from '@mozhou/kernel';
import { CanonStructureError } from './canon-read.js';
import { STYLE_PROFILE_PATH } from './layout.js';
import { parseFrontmatter } from './yaml-frontmatter.js';

/** 四场景型运行时词表（kernel ScenarioType 冻结联合的伴生元组；编译期锁定）。 */
export const SCENARIO_TYPES = [
  'action',
  'dialogue',
  'romance_emotion',
  'exposition_worldbuilding',
] as const satisfies readonly ScenarioType[];

/** 文风.md 内单场景型画像行（持久化形状；KernelEntityHead 的 bookId/时间戳不落盘
 *  ——单书单文件天然锚定 bookId，时间戳走 StyleProfileUpdated 审计事件）。 */
export interface StyleProfileRow {
  readonly id: string; // style_<ULID>
  readonly scenarioType: ScenarioType;
  /** vN：按章批次递增（Q14 事务性变更语义；回滚 = 重放后继续 +1）。 */
  readonly revision: number;
  readonly dialogueRatio: number; // [0,1]
  readonly sentenceLengthDistribution: readonly SentenceLengthBucket[];
  readonly tabooWords: readonly string[];
  readonly sensoryDensity: number; // [0,1]；种子空值 0 = 未标定
  readonly actionPacing: number; // [0,1]；种子空值 0 = 未标定
}

export type StyleProfilesMap = Readonly<Record<ScenarioType, StyleProfileRow>>;

/* ---------------------------------------------------------------------------
 * 发射（逐字节确定性子集）
 * ------------------------------------------------------------------------- */

/** 种子句长桶边界（建书一次性铸造；学习只动 share 永不动边界——分布可比性）。 */
const SEED_SENTENCE_BUCKETS: readonly SentenceLengthBucket[] = [
  { maxLengthChars: 10, share: 0.15 },
  { maxLengthChars: 20, share: 0.35 },
  { maxLengthChars: 35, share: 0.3 },
  { maxLengthChars: 60, share: 0.15 },
  { maxLengthChars: 120, share: 0.05 },
];

/** 建书种子表：四行独立 style_<ULID>；dialogueRatio 对齐 m₀ dlg_char_ratio=0.30；
 *  sensoryDensity/actionPacing 种子空值 0（t48-b §3：无机械算法的维度宁缺毋滥）。 */
export function seedStyleProfileRows(): StyleProfilesMap {
  const rows = {} as Record<ScenarioType, StyleProfileRow>;
  for (const scenarioType of SCENARIO_TYPES) {
    rows[scenarioType] = {
      id: newStyleProfileId(),
      scenarioType,
      revision: 0,
      dialogueRatio: 0.3,
      sentenceLengthDistribution: SEED_SENTENCE_BUCKETS,
      tabooWords: [],
      sensoryDensity: 0,
      actionPacing: 0,
    };
  }
  return rows;
}

function formatNumber(value: number): string {
  return String(value);
}

/** 词面裸文条件：中文/字母/数字构成、无 YAML 歧义字符（其余双引号 JSON 转义）。 */
function quoteWord(word: string): string {
  if (/^[\p{L}\p{N}][\p{L}\p{N}·—]*$/u.test(word)) return word;
  return JSON.stringify(word);
}

function parseWord(raw: string): string {
  const text = raw.trim();
  if (text.startsWith('"')) {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'string' || parsed.length === 0) {
      throw new Error('quoted taboo word must decode to a non-empty string');
    }
    return parsed;
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}·—]*$/u.test(text)) {
    throw new Error('taboo word must be bare word characters or double-quoted');
  }
  return text;
}

function emitRow(row: StyleProfileRow): string[] {
  const lines: string[] = [];
  lines.push(`  ${row.scenarioType}:`);
  lines.push(`    id: ${row.id}`);
  lines.push(`    revision: ${formatNumber(row.revision)}`);
  lines.push(`    dialogueRatio: ${formatNumber(row.dialogueRatio)}`);
  lines.push('    sentenceLengthDistribution:');
  for (const bucket of row.sentenceLengthDistribution) {
    lines.push(
      `      - {maxLengthChars: ${formatNumber(bucket.maxLengthChars)}, share: ${formatNumber(bucket.share)}}`,
    );
  }
  if (row.tabooWords.length === 0) {
    lines.push('    tabooWords: []');
  } else {
    lines.push('    tabooWords:');
    for (const word of row.tabooWords) {
      lines.push(`      - ${quoteWord(word)}`);
    }
  }
  lines.push(`    sensoryDensity: ${formatNumber(row.sensoryDensity)}`);
  lines.push(`    actionPacing: ${formatNumber(row.actionPacing)}`);
  return lines;
}

export const STYLE_PROFILES_FENCE_OPEN = '```yaml';
const FENCE_CLOSE = '```';

/** fenced-YAML 块文本（含围栏与尾换行）。键序 = SCENARIO_TYPES 冻结序。 */
export function emitStyleProfilesYaml(rows: StyleProfilesMap): string {
  const lines = [STYLE_PROFILES_FENCE_OPEN, 'profiles:'];
  for (const scenarioType of SCENARIO_TYPES) {
    lines.push(...emitRow(rows[scenarioType]));
  }
  lines.push(FENCE_CLOSE);
  return lines.join('\n') + '\n';
}

/* ---------------------------------------------------------------------------
 * 解析（宁败不脏：一切违例响亮失败）
 * ------------------------------------------------------------------------- */

const ULID_PATTERN = /^style_[0-9A-HJKMNP-TV-Z]{26}$/;

function fail(detail: string): never {
  throw new CanonStructureError(STYLE_PROFILE_PATH, detail);
}

/** noUncheckedIndexedAccess 取行助手：越界宁败（fail 返回 never ⇒ 收窄为 string）。 */
function lineAt(lines: readonly string[], index: number): string {
  const line = lines[index];
  if (line === undefined) fail(`行越界: ${index}`);
  return line;
}

function parseStrictNumber(raw: string, label: string): number {
  const text = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) fail(`${label} 不是有限十进制数: ${JSON.stringify(raw)}`);
  const value = Number(text);
  if (!Number.isFinite(value)) fail(`${label} 非有限数`);
  return value;
}

function parseStrictInt(raw: string, label: string): number {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) fail(`${label} 不是非负整数: ${JSON.stringify(raw)}`);
  return Number(text);
}

function parseUnitInterval(value: number, label: string): number {
  if (value < 0 || value > 1) fail(`${label} 越出 [0,1]: ${value}`);
  return value;
}

function parseRows(blockLines: readonly string[]): StyleProfilesMap {
  if (blockLines[0] !== 'profiles:') fail('fenced-YAML 必须以 profiles: 开头');
  const rows = {} as Record<ScenarioType, StyleProfileRow>;
  const seen = new Set<string>();

  let index = 1;
  while (index < blockLines.length) {
    const line = lineAt(blockLines, index);
    const scenarioMatch = /^  ([a-z_]+):$/.exec(line);
    if (scenarioMatch === null || scenarioMatch[1] === undefined) fail(`无法解析场景型行（须两空格缩进的 key:）: ${JSON.stringify(line)}`);
    const scenarioType = scenarioMatch[1];
    if (!(SCENARIO_TYPES as readonly string[]).includes(scenarioType)) {
      fail(`未知场景型: ${scenarioType}（合法集 ${SCENARIO_TYPES.join('/')}）`);
    }
    if (seen.has(scenarioType)) fail(`重复场景型: ${scenarioType}`);
    seen.add(scenarioType);

    index += 1;
    const fields = new Map<string, string>();
    const buckets: SentenceLengthBucket[] = [];
    const tabooWords: string[] = [];

    // 字段区：四空格缩进 key: value 或子表头
    while (index < blockLines.length && lineAt(blockLines, index).startsWith('    ')) {
      const fieldLine = lineAt(blockLines, index);
      const fieldMatch = /^    ([A-Za-z]+):(.*)$/.exec(fieldLine);
      if (fieldMatch === null || fieldMatch[1] === undefined || fieldMatch[2] === undefined) fail(`无法解析字段行（须四空格缩进）: ${JSON.stringify(fieldLine)}`);
      const field = fieldMatch[1];
      const rest = fieldMatch[2].trim();
      if (field === 'sentenceLengthDistribution' && rest === '') {
        index += 1;
        while (index < blockLines.length && lineAt(blockLines, index).startsWith('      - {')) {
          const bucketMatch = /^      - \{maxLengthChars: (\d+), share: (-?\d+(?:\.\d+)?)\}$/.exec(lineAt(blockLines, index));
          if (bucketMatch === null || bucketMatch[1] === undefined || bucketMatch[2] === undefined) {
            fail(`句长桶行形状违例: ${JSON.stringify(lineAt(blockLines, index))}`);
          }
          buckets.push({
            maxLengthChars: parseStrictInt(bucketMatch[1], 'maxLengthChars'),
            share: parseUnitInterval(parseStrictNumber(bucketMatch[2], 'share'), 'share'),
          });
          index += 1;
        }
        continue;
      }
      if (field === 'tabooWords' && rest === '') {
        index += 1;
        while (index < blockLines.length && lineAt(blockLines, index).startsWith('      - ')) {
          try {
            tabooWords.push(parseWord(lineAt(blockLines, index).slice(8)));
          } catch (error) {
            fail(`taboo 词条违例: ${(error as Error).message}`);
          }
          index += 1;
        }
        continue;
      }
      if (fields.has(field)) fail(`重复字段: ${field}`);
      if (rest === '') fail(`字段 ${field} 缺值（空值仅允许 sentenceLengthDistribution/tabooWords 子表或 tabooWords: []）`);
      fields.set(field, rest);
      index += 1;
    }

    if (fields.size !== 6) {
      fail(`${scenarioType} 行字段不全（须 id/revision/dialogueRatio/sentenceLengthDistribution/tabooWords/sensoryDensity/actionPacing 七项，得 ${fields.size + 1} 组）`);
    }
    const id = fields.get('id');
    if (id === undefined || !ULID_PATTERN.test(id)) fail(`${scenarioType}.id 形状违例: ${String(id)}`);
    const revision = parseStrictInt(fields.get('revision') ?? '', 'revision');

    if (buckets.length === 0) fail(`${scenarioType}.sentenceLengthDistribution 不得为空`);
    let previousEdge = 0;
    let shareSum = 0;
    for (const bucket of buckets) {
      if (bucket.maxLengthChars <= previousEdge) {
        fail(`${scenarioType} 句长桶边界必须严格递增: ${bucket.maxLengthChars} ≤ ${previousEdge}`);
      }
      previousEdge = bucket.maxLengthChars;
      shareSum += bucket.share;
    }
    if (Math.abs(shareSum - 1) > 1e-6) {
      fail(`${scenarioType} 句长桶 share 合计须 ≈1（差 |Σ−1|=${Math.abs(shareSum - 1)} 超 1e-6 容差）`);
    }

    const tabooInline = fields.get('tabooWords');
    if (tabooInline !== undefined) {
      if (tabooInline !== '[]') fail(`${scenarioType}.tabooWords 内联形态只允许 []`);
    } else if (tabooWords.length === 0) {
      fail(`${scenarioType}.tabooWords 子表不得为空块（空表请写 tabooWords: []）`);
    }
    const words = tabooInline !== undefined ? [] : tabooWords;
    if (new Set(words).size !== words.length) fail(`${scenarioType}.tabooWords 存在重复词条`);

    rows[scenarioType as ScenarioType] = {
      id,
      scenarioType: scenarioType as ScenarioType,
      revision,
      dialogueRatio: parseUnitInterval(parseStrictNumber(fields.get('dialogueRatio') ?? '', 'dialogueRatio'), 'dialogueRatio'),
      sentenceLengthDistribution: buckets,
      tabooWords: words,
      sensoryDensity: parseUnitInterval(parseStrictNumber(fields.get('sensoryDensity') ?? '', 'sensoryDensity'), 'sensoryDensity'),
      actionPacing: parseUnitInterval(parseStrictNumber(fields.get('actionPacing') ?? '', 'actionPacing'), 'actionPacing'),
    };
  }

  const missing = SCENARIO_TYPES.filter((scenarioType) => !seen.has(scenarioType));
  if (missing.length > 0) fail(`缺少场景型行: ${missing.join('/')}`);
  return rows;
}

/** 从 body 提取 fenced 块内容行（不含围栏行）；无围栏即抛（未播种的旧文件宁败）。 */
function extractFenceBody(body: string): string[] {
  const lines = body.split('\n');
  const open = lines.indexOf(STYLE_PROFILES_FENCE_OPEN);
  if (open === -1) fail('body 缺少 \`\`\`yaml 围栏块（文风.md 未按 T23 存储格式播种）');
  const close = lines.indexOf(FENCE_CLOSE, open + 1);
  if (close === -1) fail('fenced-YAML 块缺少闭合围栏');
  if (lines.some((line, i) => i > open && i < close && line.startsWith('```'))) {
    fail('fenced 块内出现嵌套围栏');
  }
  return lines.slice(open + 1, close);
}

/**
 * 结构化读文风.md 为四行画像（宁败不脏）。每次学习批量前调用方重扫盘上现值作
 * old 基线（作者手动改永远赢——EXTERNAL_MODIFIED 对账是权威通道）。
 */
export function readStyleProfiles(root: string): StyleProfilesMap {
  let raw: string;
  try {
    raw = readFileSync(join(root, STYLE_PROFILE_PATH), 'utf8');
  } catch {
    throw new CanonStructureError(STYLE_PROFILE_PATH, '文件不存在');
  }
  const document = parseFrontmatter(raw);
  return parseRows(extractFenceBody(document.body));
}

/**
 * 把四行画像序列化回既有文风.md 文本：原样保留 frontmatter 与围栏外的全部字节，
 * 只整块替换 fenced-YAML 内容（StyleProfileStore 单口专用；本函数不做 IO）。
 */
export function serializeStyleProfiles(currentRaw: string, rows: StyleProfilesMap): string {
  extractFenceBody(currentRaw); // 先校验现有文件可解析（宁败不脏）
  const lines = currentRaw.split('\n');
  const open = lines.indexOf(STYLE_PROFILES_FENCE_OPEN);
  const close = lines.indexOf(FENCE_CLOSE, open + 1);
  const replacement = emitStyleProfilesYaml(rows).split('\n');
  // emitStyleProfilesYaml 尾带一个换行 ⇒ split 产生末尾空串，正好还原为行级替换
  lines.splice(open, close - open + 1, ...replacement.slice(0, -1));
  return lines.join('\n');
}
