// 注册/登录入参校验（zod，中文文案）
import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email("请输入有效的邮箱地址"),
  // 上限 72：bcrypt 输入截断阈值，超长密码须拒绝而非静默截断
  password: z.string().min(8, "密码至少 8 位").max(72, "密码最长 72 位"),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** 解析请求体并校验凭据；失败时返回 400 文案 */
export function parseCredentials(
  body: unknown,
): { ok: true; data: Credentials } | { ok: false; error: string } {
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "参数校验失败",
    };
  }
  return { ok: true, data: parsed.data };
}
