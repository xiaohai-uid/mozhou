// 密码哈希（bcryptjs 纯 JS 实现，Windows 免原生编译）
import { hash, compare } from "bcryptjs";

const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, COST);
}

export function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return compare(plain, hashed);
}
