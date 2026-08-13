import { describe, expect, it } from "vitest";
import { decryptSyncPassword, encryptSyncPassword } from "@/lib/sync/credentials";

describe("sync credential encryption", () => {
  it("round-trips the password without storing the plaintext", () => {
    const password = "webdav-secret-密码";
    const encrypted = encryptSyncPassword(password);

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain(password);
    expect(decryptSyncPassword(encrypted)).toBe(password);
  });

  it("rejects legacy plaintext values instead of sending them to WebDAV", () => {
    expect(() => decryptSyncPassword("legacy-plaintext")).toThrow("格式无效");
  });
});
