import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CATEGORY_IDS } from "./categories.ts";
import { MODELS, type ModelName } from "./models.ts";
import type { Scored, Summary } from "./summary.ts";

/**
 * Publishes finished runs (runs/<model>) into results/: each model's summary,
 * its per-image outputs WITHOUT UnsafeBench's labels or images (the dataset is
 * gated by a data use agreement), and a leaderboard as JSON and Markdown.
 *
 *   npm run leaderboard
 */
const LABEL_FIELDS = ["split", "source", "unsafe", "category"] as const;

const models = Object.keys(MODELS) as ModelName[];
const summaries: Summary[] = [];

for (const model of models) {
  const summary = JSON.parse(
    await readFile(`runs/${model}/summary.json`, "utf8").catch(() => "null"),
  ) as Summary | null;
  if (!summary) {
    console.warn(`No run for ${model}; skipping`);
    continue;
  }
  summaries.push(summary);
  const outputs = (await readFile(`runs/${model}/predictions.jsonl`, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Scored & { error?: string })
    .filter((row) => !row.error)
    .map((row) => {
      const output: Record<string, unknown> = { ...row };
      for (const field of LABEL_FIELDS) delete output[field];
      return output;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  await mkdir(`results/${model}`, { recursive: true });
  await writeFile(
    `results/${model}/outputs.jsonl`,
    `${outputs.map((o) => JSON.stringify(o)).join("\n")}\n`,
  );
  await writeFile(
    `results/${model}/summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    `results/${model}/jobs.json`,
    await readFile(`runs/${model}/jobs.json`, "utf8"),
  );
}

const round = (x: number, d = 3) => Number(x.toFixed(d));

const leaderboard = {
  dataset: "UnsafeBench (yiting/UnsafeBench), train 8,109 + test 2,037",
  protocol:
    "Same prompt for every model; threshold = best F1 on train, headline metrics on test",
  generatedAt: new Date().toISOString(),
  models: summaries.map((s) => {
    const t = s.test?.overall ?? s.all.overall;
    return {
      model: s.model,
      label: s.label,
      provider: s.provider,
      id: s.id,
      test: {
        n: t.n,
        auroc: round(t.auroc),
        aurocCi: t.ci?.auroc.map((x) => round(x)),
        averagePrecision: round(t.averagePrecision),
        f1: round(t.atThreshold.f1),
        f1Ci: t.ci?.f1.map((x) => round(x)),
        precision: round(t.atThreshold.precision),
        recall: round(t.atThreshold.recall),
        falsePositiveRate: round(t.atThreshold.falsePositiveRate),
        recallAt5Fpr: round(t.recallAt5Fpr),
        recallAt10Fpr: round(t.recallAt10Fpr),
        verdictF1: round(t.verdict.f1),
        categoryAccuracy: s.test?.categoryAnswered
          ? round(s.test.category.accuracy)
          : null,
        bySource: Object.fromEntries(
          Object.entries(s.test?.bySource ?? {}).map(([k, v]) => [
            k,
            { auroc: round(v.auroc), f1: round(v.atThreshold.f1) },
          ]),
        ),
        categoryF1: Object.fromEntries(
          CATEGORY_IDS.map((c) => [
            c,
            round(s.test?.byCategory[c].atThreshold.f1 ?? 0),
          ]),
        ),
      },
      all: {
        n: s.all.overall.n,
        auroc: round(s.all.overall.auroc),
        f1: round(s.all.overall.atThreshold.f1),
      },
      threshold: round(s.threshold),
      refusals: s.refusals,
      errors: s.errors,
      latencyMs: {
        p50: Math.round(s.latencyMs.p50),
        p90: Math.round(s.latencyMs.p90),
        p95: Math.round(s.latencyMs.p95),
        p99: Math.round(s.latencyMs.p99),
        mean: Math.round(s.latencyMs.mean),
      },
      job: s.job && {
        images: s.job.images,
        concurrency: s.job.concurrency,
        wallSeconds: round(s.job.wallMs / 1000, 1),
        imagesPerSecond: round(s.job.imagesPerSecond, 2),
        complete: s.job.complete,
      },
      cost: {
        totalUsd: round(s.cost.totalUsd, 4),
        per1kImagesUsd: round(s.cost.per1kImagesUsd, 4),
        meanInputTokens: Math.round(s.cost.meanInputTokens),
        meanOutputTokens: Math.round(s.cost.meanOutputTokens),
      },
    };
  }),
};
await writeFile(
  "results/leaderboard.json",
  `${JSON.stringify(leaderboard, null, 2)}\n`,
);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const f3 = (x: number) => x.toFixed(3);
const ci = (c?: number[]) => (c ? ` [${f3(c[0])}, ${f3(c[1])}]` : "");
const m = leaderboard.models;
const md = [
  "# Leaderboard",
  "",
  `${leaderboard.dataset}. ${leaderboard.protocol}. 95% bootstrap intervals in brackets.`,
  "",
  "## Accuracy (test split, 2,037 images)",
  "",
  "| Model | AUROC | AP | F1 | Precision | Recall | FPR | Recall @5% FPR | Recall @10% FPR | Own-verdict F1 | Category acc. |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...m.map(
    (r) =>
      `| ${r.label} | ${f3(r.test.auroc)}${ci(r.test.aurocCi)} | ${f3(r.test.averagePrecision)} | ${f3(r.test.f1)}${ci(r.test.f1Ci)} | ${pct(r.test.precision)} | ${pct(r.test.recall)} | ${pct(r.test.falsePositiveRate)} | ${pct(r.test.recallAt5Fpr)} | ${pct(r.test.recallAt10Fpr)} | ${f3(r.test.verdictF1)} | ${r.test.categoryAccuracy === null ? "n/a" : pct(r.test.categoryAccuracy)} |`,
  ),
  "",
  "## Speed and cost (all 10,146 images)",
  "",
  "| Model | Provider | Latency p50 | p90 | p95 | p99 | Full job (wall) | Images/s | Concurrency | Cost / 1k images | Total cost | Tokens in / out per image |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...m.map(
    (r) =>
      `| ${r.label} | ${r.provider} | ${r.latencyMs.p50} ms | ${r.latencyMs.p90} ms | ${r.latencyMs.p95} ms | ${r.latencyMs.p99} ms | ${r.job ? `${(r.job.wallSeconds / 60).toFixed(1)} min` : "–"} | ${r.job?.imagesPerSecond ?? "–"} | ${r.job?.concurrency ?? "–"} | $${r.cost.per1kImagesUsd.toFixed(3)} | $${r.cost.totalUsd.toFixed(2)} | ${r.cost.meanInputTokens} / ${r.cost.meanOutputTokens} |`,
  ),
  "",
  "## F1 by category (test split, at each model's train threshold)",
  "",
  `| Model | ${CATEGORY_IDS.join(" | ")} |`,
  `| --- | ${CATEGORY_IDS.map(() => "---").join(" | ")} |`,
  ...m.map(
    (r) =>
      `| ${r.label} | ${CATEGORY_IDS.map((c) => f3(r.test.categoryF1[c])).join(" | ")} |`,
  ),
  "",
  "## Real vs AI-generated images (test split)",
  "",
  "| Model | LAION (real) AUROC | LAION F1 | Lexica (AI) AUROC | Lexica F1 |",
  "| --- | --- | --- | --- | --- |",
  ...m.map(
    (r) =>
      `| ${r.label} | ${f3(r.test.bySource.Laion5B?.auroc ?? 0)} | ${f3(r.test.bySource.Laion5B?.f1 ?? 0)} | ${f3(r.test.bySource.Lexica?.auroc ?? 0)} | ${f3(r.test.bySource.Lexica?.f1 ?? 0)} |`,
  ),
  "",
];
await writeFile("results/LEADERBOARD.md", md.join("\n"));
console.log(md.join("\n"));
