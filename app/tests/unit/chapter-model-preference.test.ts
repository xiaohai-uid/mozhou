import { describe, expect, it } from "vitest";
import {
  chapterModelPreferenceKey,
  isStoredChapterModel,
} from "@/lib/novels/chapter-model-preference";

describe("章节模型偏好 contract", () => {
  it("按作品和章节隔离偏好", () => {
    expect(chapterModelPreferenceKey(514, 524)).toBe("mozhou:chapter-model:514:524");
    expect(chapterModelPreferenceKey(514, 525)).not.toBe(chapterModelPreferenceKey(514, 524));
  });

  it("只接受当前支持的模型值", () => {
    expect(isStoredChapterModel("glm-4.5-flash")).toBe(true);
    expect(isStoredChapterModel("not-a-model")).toBe(false);
  });
});
