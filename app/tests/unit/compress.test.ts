// 上下文压缩单元测试（12 工单）：token 估算 / 阈值检测 / 压缩保留近期
import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  historyTokens,
  shouldCompress,
  KEEP_RECENT,
} from "@/lib/chat/compress";
import type { ChatMessage } from "@/lib/chat/payload";

function msg(content: string): ChatMessage {
  return { role: "user", content };
}

describe("estimateTokens / historyTokens", () => {
  it("中文约 2 字/token", () => {
    expect(estimateTokens("灰烬镇")).toBe(2); // ceil(3/2)=2
    expect(estimateTokens("ab")).toBe(1);
  });

  it("历史累计 token", () => {
    const messages = [msg("灰烬镇清晨"), msg("阿雀在门口等陆沉舟")];
    expect(historyTokens(messages)).toBe(
      estimateTokens("灰烬镇清晨") + estimateTokens("阿雀在门口等陆沉舟"),
    );
  });
});

describe("shouldCompress（70% 阈值）", () => {
  it("未超阈值 → false", () => {
    const messages = [msg("短消息".repeat(10))];
    expect(shouldCompress(messages)).toBe(false);
  });

  it("超 70%（5600 token ≈ 11200 字）→ true", () => {
    const messages = [msg("长".repeat(12000))]; // 6000 token > 5600
    expect(shouldCompress(messages)).toBe(true);
  });

  it("刚好在阈值内 → false", () => {
    const messages = [msg("长".repeat(11200))]; // 5600 token，不严格大于
    expect(shouldCompress(messages)).toBe(false);
  });
});

describe("compressHistory 保留近期（KEEP_RECENT）", () => {
  it("早期消息被摘出，保留最近 6 条原文", async () => {
    process.env.CHAT_PROVIDER = "mock"; // unit 环境无 global-setup，显式注入 mock
    const { compressHistory } = await import("@/lib/chat/compress");
    const messages = Array.from({ length: 10 }, (_, i) => msg(`消息${i}`));
    const r = await compressHistory(messages);
    // mock provider 下返回固定摘要
    expect(r.summary).toContain("历史摘要");
    expect(r.kept).toHaveLength(KEEP_RECENT);
    expect(r.kept.at(-1)?.content).toBe("消息9");
    // 早期第一条不在保留里
    expect(r.kept.some((m) => m.content === "消息0")).toBe(false);
  });

  it("消息数 <= KEEP_RECENT → 不压缩", async () => {
    process.env.CHAT_PROVIDER = "mock";
    const { compressHistory } = await import("@/lib/chat/compress");
    const messages = Array.from({ length: 4 }, (_, i) => msg(`消息${i}`));
    const r = await compressHistory(messages);
    expect(r.summary).toBe("");
    expect(r.kept).toHaveLength(4);
  });
});
