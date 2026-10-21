import { describe, expect, it } from "vitest";
import type { Category } from "./categories.ts";
import type { Split } from "./dataset.ts";
import { type Scored, summarize } from "./summary.ts";

const row = (
  split: Split,
  unsafeProbability: number,
  unsafe: boolean,
  category: Category = "violence",
): Scored => ({
  id: `${split}-${Math.random()}`,
  split,
  source: "Laion5B",
  unsafe,
  category,
  predictedCategory: category,
  unsafeProbability,
  verdict: unsafeProbability >= 0.5 ? "unsafe" : "safe",
  inputTokens: 1000,
  outputTokens: 10,
  costUsd: 0.001,
  latencyMs: 100,
});

describe("summarize", () => {
  it("picks the threshold on train and never looks at test", () => {
    const train = [row("train", 0.3, true), row("train", 0.2, false)];
    const withTest = (p: number) =>
      summarize("clef-flash", [...train, row("test", p, true)], [], 0);
    // Train separates at 0.3 regardless of what the test row scores.
    expect(withTest(0.1).threshold).toBe(0.3);
    expect(withTest(0.9).threshold).toBe(0.3);
  });

  it("reports test metrics at the train threshold", () => {
    const rows = [
      row("train", 0.3, true),
      row("train", 0.2, false),
      row("test", 0.35, true),
      row("test", 0.25, false),
      row("test", 0.1, true),
    ];
    const test = summarize("clef-flash", rows, [], 0).test?.overall;
    expect(test?.atThreshold).toMatchObject({ tp: 1, fp: 0, fn: 1, tn: 1 });
  });

  it("adds up cost and job throughput", () => {
    const rows = [row("test", 0.9, true), row("test", 0.1, false)];
    const s = summarize(
      "jev",
      rows,
      [{ startedAt: "", wallMs: 4000, images: 2, concurrency: 8 }],
      0,
    );
    expect(s.cost.totalUsd).toBeCloseTo(0.002);
    expect(s.cost.per1kImagesUsd).toBeCloseTo(1);
    expect(s.job).toMatchObject({ imagesPerSecond: 0.5, complete: true });
  });
});

describe("job timing", () => {
  it("reports the main pass, not a later retry pass", () => {
    const rows = [row("test", 0.9, true), row("test", 0.1, false)];
    const s = summarize(
      "jev",
      rows,
      [
        { startedAt: "a", wallMs: 4000, images: 2, concurrency: 8 },
        { startedAt: "b", wallMs: 50, images: 1, concurrency: 8 },
      ],
      0,
    );
    expect(s.job).toMatchObject({ startedAt: "a", wallMs: 4000, retried: 1 });
  });
});
