import { describe, expect, it } from "vitest";
import {
  atThreshold,
  auroc,
  averagePrecision,
  bestF1,
  bootstrap,
  brier,
  categoryReport,
  expectedCalibrationError,
  percentile,
  recallAtFpr,
} from "./metrics.ts";

const p = (probability: number, unsafe: boolean) => ({ probability, unsafe });

describe("auroc", () => {
  it("is 1 when every unsafe image outranks every safe one", () => {
    expect(
      auroc([p(0.9, true), p(0.8, true), p(0.2, false), p(0.1, false)]),
    ).toBe(1);
  });

  it("counts tied scores as half", () => {
    expect(auroc([p(0.5, true), p(0.5, false)])).toBe(0.5);
  });

  it("matches a hand-computed mixed ranking", () => {
    // Pairs (unsafe, safe): (0.8,0.6) win, (0.8,0.3) win, (0.4,0.6) loss, (0.4,0.3) win → 3/4.
    expect(
      auroc([p(0.8, true), p(0.4, true), p(0.6, false), p(0.3, false)]),
    ).toBe(0.75);
  });
});

describe("averagePrecision", () => {
  it("averages precision at each recall step", () => {
    // Ranked: U(1/1), S, U(2/3) → (1 + 2/3) / 2.
    expect(
      averagePrecision([p(0.9, true), p(0.7, false), p(0.5, true)]),
    ).toBeCloseTo(5 / 6);
  });
});

describe("atThreshold", () => {
  it("flags probabilities at or above the threshold", () => {
    const stats = atThreshold(
      [p(0.5, true), p(0.49, true), p(0.7, false), p(0.1, false)],
      0.5,
    );
    expect(stats).toMatchObject({
      tp: 1,
      fn: 1,
      fp: 1,
      tn: 1,
      precision: 0.5,
      recall: 0.5,
      falsePositiveRate: 0.5,
    });
  });
});

describe("bestF1", () => {
  it("finds the threshold that separates the classes", () => {
    expect(
      bestF1([p(0.3, true), p(0.25, true), p(0.2, false), p(0.1, false)])
        .threshold,
    ).toBe(0.25);
  });
});

describe("calibration", () => {
  it("gives zero Brier and ECE for perfect confident predictions", () => {
    const points = [p(1, true), p(0, false)];
    expect(brier(points)).toBe(0);
    expect(expectedCalibrationError(points)).toBe(0);
  });

  it("measures the gap between confidence and hit rate", () => {
    // One bin at 0.9 confidence with a 50% hit rate.
    expect(expectedCalibrationError([p(0.9, true), p(0.9, false)])).toBeCloseTo(
      0.4,
    );
  });
});

describe("categoryReport", () => {
  it("builds the confusion matrix and macro-F1 over classes present", () => {
    const report = categoryReport(["a", "b", "c"] as const, [
      { actual: "a", predicted: "a" },
      { actual: "a", predicted: "b" },
      { actual: "b", predicted: "b" },
    ]);
    expect(report.accuracy).toBeCloseTo(2 / 3);
    expect(report.confusion.a.b).toBe(1);
    expect(report.perClass.b).toMatchObject({
      precision: 0.5,
      recall: 1,
      support: 1,
    });
    // a: P=1 R=0.5 F1=2/3; b: P=0.5 R=1 F1=2/3; c has no support.
    expect(report.macroF1).toBeCloseTo(2 / 3);
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });
});

describe("recallAtFpr", () => {
  it("takes the most permissive threshold that keeps FPR under the cap", () => {
    // Safe scores 0.9, 0.2, 0.1 ...: flagging at 0.9 costs 1/10 safe images.
    const points = [
      p(0.95, true),
      p(0.9, false),
      p(0.8, true),
      p(0.3, true),
      ...Array.from({ length: 9 }, () => p(0.1, false)),
    ];
    expect(recallAtFpr(points, 0.1)).toMatchObject({
      threshold: 0.3,
      recall: 1,
    });
    expect(recallAtFpr(points, 0.05)).toMatchObject({
      threshold: 0.95,
      recall: 1 / 3,
    });
  });
});

describe("bootstrap", () => {
  it("brackets the point estimate and is deterministic for a seed", () => {
    const points = Array.from({ length: 200 }, (_, i) =>
      p((i % 10) / 10, i % 3 === 0),
    );
    const interval = bootstrap(points, auroc, { resamples: 200, seed: 3 });
    expect(interval[0]).toBeLessThanOrEqual(auroc(points));
    expect(interval[1]).toBeGreaterThanOrEqual(auroc(points));
    expect(bootstrap(points, auroc, { resamples: 200, seed: 3 })).toEqual(
      interval,
    );
  });
});
