// JSON 输出校验器：语法解析 + zod schema 必填字段（按节点配置，如风格指南/章节大纲）
import { z } from "zod";

export type OutputSchema = z.ZodType;

export type ValidationVerdict =
  | { ok: true; json: unknown }
  | { ok: false; reason: string };

export function validateOutput(
  raw: string,
  schema: OutputSchema,
): ValidationVerdict {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "不是合法 JSON" };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // 必填字段缺失 = invalid_type + received undefined；其余按首个 issue 提示
    const missing = parsed.error.issues
      .filter(
        (i) =>
          i.path.length > 0 &&
          i.code === "invalid_type" &&
          "received" in i &&
          i.received === "undefined",
      )
      .map((i) => i.path.join("."));
    if (missing.length > 0) {
      return { ok: false, reason: `缺少字段：${missing.join("、")}` };
    }
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `字段 ${first.path.join(".")} ` : "";
    return { ok: false, reason: `${where}${first?.message ?? "不符合 schema"}` };
  }

  return { ok: true, json: parsed.data };
}
