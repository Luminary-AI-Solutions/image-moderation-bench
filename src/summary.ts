import { CATEGORY_IDS, type Category } from "./categories.ts";
import type { Split } from "./dataset.ts";
import {
  atThreshold,
  auroc,
  averagePrecision,
  type BinaryPoint,
  bestF1,
  bootstrap,
  categoryReport,
  expectedCalibrationError,
  percentile,
  recallAtFpr,
} from "./metrics.ts";
import { MODELS, type ModelName } from "./models.ts";

/** One scored image: dataset labels joined with the model's answer. */
export interface Scored {
  id: string;
  split: Split;
  source: string;
  unsafe: boolean;
  category: Category;
  predictedCategory?: Category;
  unsafeProbability: number;
  verdict?: "safe" | "unsafe";
  refused?: boolean;
  topLabel?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface Job {
  startedAt: string;
  wallMs: number;
  images: number;
  concurrency: number;
}

const points = (rows: Scored[]): BinaryPoint[] =>
  rows.map((r) => ({ probability: r.unsafeProbability, unsafe: r.unsafe }));

function binary(rows: Scored[], threshold: number, withCi: boolean) {
  const p = points(rows);
  const at = atThreshold(p, threshold);
  // The model's own safe/unsafe call, with no threshold at all.
  const verdict = atThreshold(
    rows.map((r) => ({
      probability: r.verdict === "unsafe" ? 1 : 0,
      unsafe: r.unsafe,
    })),
    0.5,
  );
  return {
    n: rows.length,
    auroc: auroc(p),
    averagePrecision: averagePrecision(p),
    ece: expectedCalibrationError(p),
    recallAt5Fpr: recallAtFpr(p, 0.05).recall,
    recallAt10Fpr: recallAtFpr(p, 0.1).recall,
    atThreshold: at,
    verdict,
    ci: withCi
      ? {
          auroc: bootstrap(p, auroc),
          f1: bootstrap(p, (s) => atThreshold(s, threshold).f1),
        }
      : undefined,
  };
}

function slices(rows: Scored[], threshold: number) {
  const sources = [...new Set(rows.map((r) => r.source))].sort();
  return {
    overall: binary(rows, threshold, true),
    bySource: Object.fromEntries(
      sources.map((s) => [
        s,
        binary(
          rows.filter((r) => r.source === s),
          threshold,
          true,
        ),
      ]),
    ),
    byCategory: Object.fromEntries(
      CATEGORY_IDS.map((c) => [
        c,
        binary(
          rows.filter((r) => r.category === c),
          threshold,
          false,
        ),
      ]),
    ) as Record<Category, ReturnType<typeof binary>>,
    /** Images with a category answer (none for Rekognition). */
    categoryAnswered: rows.filter((r) => r.predictedCategory).length,
    category: categoryReport(
      CATEGORY_IDS,
      rows
        .filter((r) => r.predictedCategory)
        .map((r) => ({
          actual: r.category,
          predicted: r.predictedCategory as Category,
        })),
    ),
  };
}

/**
 * The threshold is the best-F1 point on the train split; headline numbers
 * are on the test split, which never influenced it. `all` covers both
 * splits, as the UnsafeBench paper reports.
 */
export function summarize(
  model: ModelName,
  rows: Scored[],
  jobs: Job[],
  errors: number,
) {
  const train = rows.filter((r) => r.split === "train");
  const test = rows.filter((r) => r.split === "test");
  const threshold = train.length ? bestF1(points(train)).threshold : 0.5;
  const latencies = rows.map((r) => r.latencyMs);
  const cost = rows.reduce((sum, r) => sum + r.costUsd, 0);
  // The main pass is the largest; later passes only retry failed images.
  const job = jobs.reduce<Job | undefined>(
    (main, j) => (j.images > (main?.images ?? 0) ? j : main),
    undefined,
  );
  const retried = jobs
    .filter((j) => j !== job)
    .reduce((sum, j) => sum + j.images, 0);
  return {
    model,
    ...MODELS[model],
    scored: rows.length,
    errors,
    refusals: rows.filter((r) => r.refused).length,
    threshold,
    thresholdFrom: train.length ? "train split best F1" : "default 0.5",
    test: test.length ? slices(test, threshold) : undefined,
    all: slices(rows, threshold),
    latencyMs: {
      mean: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    job: job && {
      ...job,
      imagesPerSecond: job.images / (job.wallMs / 1000),
      /** Images re-run in later passes after an error. */
      retried,
      complete: job.images + retried >= rows.length,
    },
    cost: {
      totalUsd: cost,
      per1kImagesUsd: (cost / (rows.length || 1)) * 1000,
      meanInputTokens:
        rows.reduce((s, r) => s + r.inputTokens, 0) / (rows.length || 1),
      meanOutputTokens:
        rows.reduce((s, r) => s + r.outputTokens, 0) / (rows.length || 1),
    },
  };
}

export type Summary = ReturnType<typeof summarize>;
