import { describe, expect, it } from "vitest";
import {
  DECONSTRUCTION_TOTAL_DEADLINE_MS,
  deconstructionRequestDeadline,
} from "@/app/api/v1/deconstruct/analyze/route";

describe("deconstruction Cloud Run time budget", () => {
  it("finishes provider work with a 30-second response/persistence reserve before Cloud Run's 300-second limit", () => {
    expect(DECONSTRUCTION_TOTAL_DEADLINE_MS).toBe(270_000);
    expect(DECONSTRUCTION_TOTAL_DEADLINE_MS).toBeLessThan(300_000);
    expect(deconstructionRequestDeadline(1_000)).toBe(271_000);
  });
});
