/**
 * Capability Recipe 加载器（T15 · #39）。
 * 管线（fail-fast，逐层拒载）：约定存放位读取 → YAML 解析 → schemaVersion 双轨预检
 * → JSON Schema 校验 → 语义校验 → retiredPaths 拒载检查 → 类型化对象。
 * - 双轨版本（R7=A）：schemaVersion 不认识即拒（R8=A 零兼容承诺：不解析、不迁移、
 *   不留兼容层）；recipeVersion 每配方独立 semver 自由演进，与 schemaVersion 无联动。
 * - retiredPaths（R7=A）：显式退役声明，配方内任何路径字段命中即拒载。
 * - quality_gate 回填接缝（M14 / #39 验收第 5 条）：解析快照可被 GenerationStarted 携带，
 *   与 packages/runtime 既有事件词表对齐（chapter-pipeline-spec §事件链对齐）。
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';
import type { SchemaValidator } from '../structuredOutput.js';
import { CAPABILITY_RECIPE_JSON_SCHEMA } from './schema.js';
import { RECIPE_SCHEMA_VERSION, RecipeLoadError } from './types.js';
import type {
  CapabilityRecipeDocument,
  RecipeErrorCode,
} from './types.js';

/**
 * ajv@8 默认导出在 NodeNext+verbatimModuleSyntax 下有互操作歧义——沿
 * structuredOutput.test.ts 的 createRequire 规避先例，惰性单例供默认校验器。
 */
let defaultValidator: SchemaValidator | undefined;
function getDefaultValidator(): SchemaValidator {
  if (!defaultValidator) {
    const require = createRequire(import.meta.url);
    const AjvCtor = require('ajv') as new (opts?: Record<string, unknown>) => SchemaValidator;
    defaultValidator = new AjvCtor({ allErrors: false });
  }
  return defaultValidator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface AjvErrorLike {
  readonly instancePath: string;
  readonly keyword?: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** ajv 首错 → 字段定位（沿 structuredOutput.toRepairHint 同款形态；required 下钻到缺失属性）。 */
function toFieldHint(err: AjvErrorLike): { field: string; expected: string } {
  const params = err.params ?? {};
  if (err.keyword === 'required') {
    const missing = typeof params.missingProperty === 'string' ? params.missingProperty : '';
    return { field: `${err.instancePath || '$'}/${missing}`, expected: 'required（缺失必填字段）' };
  }
  const expected =
    typeof params.type === 'string'
      ? `type=${params.type}`
      : Array.isArray(params.allowedValues)
        ? `enum=[${params.allowedValues.map(String).join(',')}]`
        : typeof params.pattern === 'string'
          ? `pattern=${params.pattern}`
          : (err.message ?? 'schema 合规');
  return { field: err.instancePath === '' ? '$' : err.instancePath, expected };
}

/**
 * 校验核心：raw（已解析的 YAML/JSON 值）→ 类型化文档。四步 fail-fast：
 * ① schemaVersion 双轨预检 ② JSON Schema ③ 跨字段语义 ④ retiredPaths 拒载。
 */
export function validateRecipeDocument(
  raw: unknown,
  validator: SchemaValidator = getDefaultValidator(),
): CapabilityRecipeDocument {
  // ① 双轨上游先行：schemaVersion 出现且不认识 ⇒ 直接拒（零兼容承诺，不做结构探测）
  if (isRecord(raw)) {
    const version = raw['schemaVersion'];
    if (version !== undefined && version !== RECIPE_SCHEMA_VERSION) {
      // 展示串统一走 JSON 序列化：数字得 2、字符串得 \"1\"、对象得结构化形态，
      // 规避 '[object Object]' 与 symbol 串化问题（eslint no-base-to-string）。
      const shown: string = JSON.stringify(version);
      throw new RecipeLoadError(
        'RECIPE_SCHEMA_UNSUPPORTED_VERSION',
        `$.schemaVersion=${shown} ——本加载器只认 schemaVersion ${String(
          RECIPE_SCHEMA_VERSION,
        )}（compatibilityPolicy="none"，不认识的版本直接拒，无迁移路径）`,
      );
    }
  }

  // ② JSON Schema 全量校验（首错定位，报错指向具体字段路径）
  const ok = validator.validate(CAPABILITY_RECIPE_JSON_SCHEMA, raw);
  if (!ok) {
    const first = validator.errors?.[0];
    const hint = first
      ? toFieldHint(first)
      : { field: '$', expected: 'schema 合规' };
    throw new RecipeLoadError(
      'RECIPE_SCHEMA_INVALID',
      `${hint.field} ${hint.expected}`,
    );
  }
  const doc = raw as CapabilityRecipeDocument;

  assertSemantics(doc);
  assertNoRetiredPaths(doc);
  return doc;
}

/** ③ 跨字段语义：draft-07 表达不了的 sizeBudget target<=max。 */
function assertSemantics(doc: CapabilityRecipeDocument): void {
  doc.recipe.artifacts.forEach((artifact, index) => {
    const { target, max } = artifact.sizeBudget;
    if (!(target <= max)) {
      throw new RecipeLoadError(
        'RECIPE_SEMANTIC_INVALID',
        `$.recipe.artifacts[${index}].sizeBudget target(${target}) > max(${max}) ——目标字数不得超过上限`,
      );
    }
  });
}

/**
 * ④ retiredPaths 拒载（R7=A 显式退役声明）：扫描全部路径型字段，
 * 任一命中即拒，报错同时给出命中路径与字段位置。
 */
function collectDeclaredPaths(doc: CapabilityRecipeDocument): [string, string][] {
  const found: [string, string][] = [];
  const r = doc.recipe;
  found.push(['$.recipe.entry.routerDoc', r.entry.routerDoc]);
  r.references.forEach((ref, i) => found.push([`$.recipe.references[${i}].path`, ref.path]));
  r.artifacts.forEach((a, i) => found.push([`$.recipe.artifacts[${i}].path`, a.path]));
  r.prechecks.forEach((p, i) => found.push([`$.recipe.prechecks[${i}].script`, p.script]));
  found.push(['$.recipe.trackingGate.authorityState', r.trackingGate.authorityState]);
  r.trackingGate.derivedViews.forEach(
    (view, i) => void found.push([`$.recipe.trackingGate.derivedViews[${i}].path`, view.path]),
  );
  return found;
}

function assertNoRetiredPaths(doc: CapabilityRecipeDocument): void {
  const retired = new Set<string>(doc.versioning.retiredPaths);
  if (retired.size === 0) return;
  const hits: string[] = [];
  for (const [fieldPath, declared] of collectDeclaredPaths(doc)) {
    if (retired.has(declared)) hits.push(`${fieldPath} → "${declared}"`);
  }
  if (hits.length > 0) {
    throw new RecipeLoadError(
      'RETIRED_PATH_HIT',
      `配方引用了已退役路径（versioning.retiredPaths）：${hits.join('；')}——请改走现役路径或按规格 init 归档流程处理`,
    );
  }
}

/**
 * 约定存放位：<baseDir>/<recipeId>.recipe.yaml——一配方一文件，id 即文件名。
 * baseDir 由宿主应用给定（书仓/全局能力包各自成目录），加载器不绑定进程 cwd。
 */
export const RECIPE_FILE_SUFFIX = '.recipe.yaml';

export function recipeFilePath(baseDir: string, id: string): string {
  return `${baseDir}/${id}${RECIPE_FILE_SUFFIX}`;
}

/** YAML 文本 → 类型化文档（解析失败/根非映射即拒）。 */
export function loadRecipeText(text: string): CapabilityRecipeDocument {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RecipeLoadError('RECIPE_PARSE_FAILED', `YAML 解析失败——${message}`);
  }
  if (!isRecord(parsed)) {
    throw new RecipeLoadError(
      'RECIPE_PARSE_FAILED',
      `YAML 根必须是映射（object），实际为 ${parsed === null ? 'null' : typeof parsed}`,
    );
  }
  return validateRecipeDocument(parsed);
}

/** 按路径读文件装载：IO 失败归 RECIPE_FILE_UNREADABLE（errno 随报错透出）。 */
export async function loadRecipeFile(filePath: string): Promise<CapabilityRecipeDocument> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    const code: RecipeErrorCode = 'RECIPE_FILE_UNREADABLE';
    const detail = err instanceof Error && 'code' in err ? `${String(err.code)} ${filePath}` : filePath;
    throw new RecipeLoadError(code, `无法读取配方文件——${detail}`);
  }
  return loadRecipeText(text);
}

/** 按约定存放位装载：<baseDir>/<id>.recipe.yaml。 */
export async function loadRecipeById(
  baseDir: string,
  id: string,
): Promise<CapabilityRecipeDocument> {
  return loadRecipeFile(recipeFilePath(baseDir, id));
}

/**
 * M14 回填接缝：解析快照打包为 GenerationStarted.payload 可携带的纯 JSON 记录。
 * 与 engine.execute 的 payload.snapshot（ResolutionSnapshot）同槽共存：
 * payload = { snapshot, ...toGenerationStartedPayload(recipeDoc) }。
 * 解析产物本就是纯数据（YAML→plain object），JSON 序列化往返无损，账本回放可得原快照。
 */
export function toGenerationStartedPayload(
  doc: CapabilityRecipeDocument,
): Readonly<Record<string, unknown>> {
  return { recipeSnapshot: doc };
}
