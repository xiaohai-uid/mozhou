import { describe, expect, it } from "vitest";
import { STORY_CAPABILITIES } from "@/lib/story/capabilities";

describe("oh-story capability registry", () => {
  it("registers exactly the 13 vendor capabilities", () => {
    expect(STORY_CAPABILITIES).toHaveLength(13);
    expect(new Set(STORY_CAPABILITIES.map((capability) => capability.name)).size).toBe(13);
    expect(STORY_CAPABILITIES.every((capability) => capability.adapter && capability.evidence)).toBe(true);
  });

  it("keeps image gated while verified text and source features are native", () => {
    const gated = STORY_CAPABILITIES.filter((capability) => capability.status !== "native");
    expect(gated.map((capability) => capability.name)).toEqual(
      expect.arrayContaining([
        "story-cover",
      ]),
    );
    expect(STORY_CAPABILITIES.find((capability) => capability.name === "story-long-analyze")?.status).toBe("native");
    expect(STORY_CAPABILITIES.find((capability) => capability.name === "story-short-analyze")?.status).toBe("native");
    expect(STORY_CAPABILITIES.find((capability) => capability.name === "story-long-scan")?.status).toBe("native");
    expect(STORY_CAPABILITIES.find((capability) => capability.name === "story-short-scan")?.status).toBe("native");
    expect(STORY_CAPABILITIES.find((capability) => capability.name === "storyrepo")?.status).toBe("native");
    expect(STORY_CAPABILITIES.find((capability) => capability.name === "story-import")?.status).toBe("native");
    expect(STORY_CAPABILITIES.find((capability) => capability.name === "story-cover")?.adapter).toBe("/api/v1/story/cover");
  });
});
