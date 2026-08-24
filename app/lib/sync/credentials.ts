import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 未配置，无法安全保存同步凭据");
  return createHash("sha256").update(secret, "utf8").digest();
}

/** AES-256-GCM，数据库只保存密文；AUTH_SECRET 更换后旧凭据会安全失效。 */
export function encryptSyncPassword(password: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSyncPassword(value: string): string {
  const [version, ivText, tagText, ciphertextText] = value.split(":");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("同步凭据格式无效，请重新保存 WebDAV 配置");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("同步凭据无法解密，请重新保存 WebDAV 配置");
  }
}
