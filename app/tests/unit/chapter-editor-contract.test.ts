import { describe, expect, it } from "vitest";
import {
  CHAPTER_EDITOR_ARIA_LABEL,
  CHAPTER_EDITOR_TEST_ID,
} from "@/components/features/chapter-editor-contract";

describe("章节正文编辑器定位 contract", () => {
  it("提供不随正文内容或 placeholder 改变的稳定身份", () => {
    expect(CHAPTER_EDITOR_ARIA_LABEL).toBe("章节正文编辑器");
    expect(CHAPTER_EDITOR_TEST_ID).toBe("chapter-body-editor");
  });
});
