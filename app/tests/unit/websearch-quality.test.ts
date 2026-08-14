import { describe, it, expect } from "vitest";
import { hasCjk, isPassable, isBatchRelevant } from "@/lib/websearch/quality";

describe("联网搜索质量门", () => {
  it("hasCjk 识别中文，拒绝纯阿拉伯语/英文", () => {
    expect(hasCjk("明朝 驿站 制度")).toBe(true);
    expect(hasCjk("كيفية تثبيت تطبيق")).toBe(false);
    expect(hasCjk("Install Google Play on PC")).toBe(false);
    expect(hasCjk("驿站 制度")).toBe(true);
  });

  it("isPassable：title/snippet 任一含 CJK 即通过", () => {
    expect(isPassable({ title: "明朝驿站的运作", snippet: "..." })).toBe(true);
    expect(isPassable({ title: "كيفية تثبيت", snippet: "..." })).toBe(false);
    expect(isPassable({ title: "Install", snippet: "来自 www.bing.com 的检索结果" })).toBe(true);
  });

  it("isBatchRelevant：全部 passable 且与 query 有 2-gram 重叠", () => {
    expect(isBatchRelevant([{ title: "明朝驿站制度考", snippet: "驿站 制度" }], "明朝 驿站 制度")).toBe(true);
  });

  it("isBatchRelevant：整批无 CJK → false（降级）", () => {
    expect(isBatchRelevant([{ title: "كيفية تثبيت", snippet: "تطبيق" }], "明朝 驿站 制度")).toBe(false);
  });

  it("isBatchRelevant：CJK 但与 query 零重叠 → false（降级）", () => {
    expect(isBatchRelevant([{ title: "如何在电脑上安装 Google Play 应用", snippet: "安装说明" }], "明朝 驿站 制度")).toBe(false);
  });

  it("isBatchRelevant：空列表 → false", () => {
    expect(isBatchRelevant([], "明朝 驿站 制度")).toBe(false);
  });
});
