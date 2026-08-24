import { describe, expect, it } from "vitest";
import { getShelfCapabilities } from "@/lib/shelf/capabilities";

describe("书源书架能力边界", () => {
  it("未接入章节正文时不展示阅读动作或假章节", () => {
    expect(getShelfCapabilities()).toMatchObject({
      canRead: false,
      label: "仅收录书目",
    });
  });
});
