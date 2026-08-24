import { describe, expect, it } from "vitest";
import { resolveCurrentNovelId } from "@/lib/novels/current-novel";

describe("resolveCurrentNovelId", () => {
  it("prefers the newly created novel id when it exists in the available list", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: 12,
        persistedId: 7,
        availableNovelIds: [7, 12],
      }),
    ).toBe(12);
  });

  it("uses the persisted id when there is no newly created id", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: null,
        persistedId: 7,
        availableNovelIds: [3, 7],
      }),
    ).toBe(7);
  });

  it("ignores a persisted id that is no longer available and falls back to the first owned novel", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: null,
        persistedId: 99,
        availableNovelIds: [5, 6],
      }),
    ).toBe(5);
  });

  it("returns null when there are no owned novels", () => {
    expect(
      resolveCurrentNovelId({
        newlyCreatedId: null,
        persistedId: null,
        availableNovelIds: [],
      }),
    ).toBeNull();
  });
});
