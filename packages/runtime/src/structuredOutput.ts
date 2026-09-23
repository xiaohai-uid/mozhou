/**
 * structuredOutput 包装器（T13 · 规格 §5，Q8=A）——runtime 层编排知识。
 * 能力声明 outputSchema ⇒ 包装 ProviderBinding：校验响应 → 失败抛
 * RecoverableError(repairHint=坏字段定位) 交引擎二级定向重生 attempt；
 * 再失败 ⇒ 三级人工模板兜底 = 调用方契约（调用方据 failed_recoverable.outcome 渲染模板）。
 */
import { RecoverableError } from './engine.js';
import type { ProviderBinding } from './engine.js';

/**
 * ajv 校验器最小结构面。不直接 import ajv@8 类型：其默认导出在
 * NodeNext+verbatimModuleSyntax 下存在类/命名空间互操作歧义（tsc TS2709，
 * 见 structuredOutput.test.ts 同源注释）；结构约束注入即可，实例由调用方 new Ajv() 提供。
 */
export interface SchemaValidator {
  validate(schema: Readonly<Record<string, unknown>>, data: unknown): boolean;
  readonly errors?: readonly AjvErrorLike[] | null;
}

/** 能力结构化输出声明：能力侧零重复，只声明 schema。 */
export interface StructuredOutputCap {
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

/** 坏字段定位提示（引擎二级 attempt 的 repairHint 载体）。 */
export interface RepairHint {
  /** JSON 指针式字段路径；根级用 '$'。 */
  readonly field: string;
  /** 期望形态描述（类型名 / required / 枚举值等），取自 ajv 错误参数。 */
  readonly expected: string;
}

interface AjvErrorLike {
  readonly instancePath: string;
  readonly keyword?: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** ajv 首错 → 坏字段定位。keyword=required 时下钻到缺失属性本身。 */
function toRepairHint(err: AjvErrorLike): RepairHint {
  const params = err.params ?? {};
  if (err.keyword === 'required') {
    const missing = typeof params.missingProperty === 'string' ? params.missingProperty : '';
    return {
      field: `${err.instancePath || '$'}/${missing}`,
      expected: 'required（缺失必填字段）',
    };
  }
  const expected =
    typeof params.type === 'string'
      ? `type=${params.type}`
      : Array.isArray(params.allowedValues)
        ? `enum=[${params.allowedValues.map(String).join(',')}]`
        : typeof params.format === 'string'
          ? `format=${params.format}`
          : (err.message ?? 'schema 合规');
  return {
    field: err.instancePath === '' ? '$' : err.instancePath,
    expected,
  };
}

/**
 * 用注入的 ajv 实例校验 value against schema。
 * 失败 ⇒ RecoverableError(message 含坏字段定位与期望形态, repairHint={field,expected})。
 * 通过 ⇒ 返回原 value（不拷贝、不改写）。
 */
export function validateWithSchema(
  validator: SchemaValidator,
  schema: Readonly<Record<string, unknown>>,
  value: unknown,
): unknown {
  const ok = validator.validate(schema, value);
  if (ok === true) return value;
  // ajv.validate 返回 false 时 errors 已填充；取首错定位。
  const first = validator.errors?.[0];
  const hint: RepairHint = first
    ? toRepairHint(first)
    : { field: '$', expected: 'schema 合规' };
  throw new RecoverableError(
    `schema 校验失败：${hint.field} ${hint.expected}`,
    hint,
  );
}

/** 字符串响应 → 对象：JSON.parse 失败同样走 RecoverableError（repairHint 指向根）。 */
function coerceToObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    return value as Record<string, unknown>;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed as Record<string, unknown>;
  } catch {
    throw new RecoverableError('schema 校验失败：$ 不是合法 json 文本', {
      field: '$',
      expected: 'valid json',
    });
  }
}

/**
 * 组合器：把裸 provider binding 包成带 outputSchema 校验的 binding。
 * - cap.outputSchema 存在 ⇒ 响应（含字符串 JSON 文本）先 coerce 再校验；
 * - 无 outputSchema 的能力直接透传原 binding（V1 允许非结构化能力共存）；
 * - 二级重生由 engine.execute 既有 attempts 循环承接，本层只负责抛。
 */
export function makeStructuredBinding(
  binding: ProviderBinding,
  cap: Partial<StructuredOutputCap> | undefined,
  validator: SchemaValidator,
): ProviderBinding {
  const schema = cap?.outputSchema;
  if (!schema) return binding;
  return async (payload, snapshot) => {
    const raw = await binding(payload, snapshot);
    const obj = coerceToObject(raw);
    return validateWithSchema(validator, schema, obj);
  };
}
