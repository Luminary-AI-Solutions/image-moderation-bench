import { readFile } from "node:fs/promises";
import { ensureSplit, loadSamples, type Sample } from "./dataset.ts";
import { MODELS, type ModelName } from "./models.ts";
import { type Scored, type Summary, summarize } from "./summary.ts";

/**
 * Recomputes every published metric from results/<model>/outputs.jsonl and
 * your own copy of UnsafeBench, without calling any model. Use it to check
 * the leaderboard: the numbers it prints should match results/.
 *
 *   npm run rescore
 */
const hfToken = process.env.HF_TOKEN;
if (!hfToken) throw new Error("Set HF_TOKEN (see .env.example).");

const labels = new Map<string, Sample>();
for (const split of ["train", "test"] as const) {
  const path = await ensureSplit(split, ".cache/unsafebench", hfToken);
  for (const s of (await loadSamples(path, split)).samples) labels.set(s.id, s);
}

let mismatches = 0;
for (const model of Object.keys(MODELS) as ModelName[]) {
  const published = JSON.parse(
    await readFile(`results/${model}/summary.json`, "utf8").catch(() => "null"),
  ) as Summary | null;
  if (!published) continue;
  const rows: Scored[] = (
    await readFile(`results/${model}/outputs.jsonl`, "utf8")
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const output = JSON.parse(line);
      const s = labels.get(output.id);
      if (!s) throw new Error(`${output.id} is not in your UnsafeBench copy`);
      return {
        ...output,
        split: s.split,
        source: s.source,
        unsafe: s.unsafe,
        category: s.category,
      };
    });
  const jobs = JSON.parse(await readFile(`results/${model}/jobs.json`, "utf8"));
  const ours = summarize(model, rows, jobs, published.errors);
  const pairs = [
    ["test AUROC", ours.test?.overall.auroc, published.test?.overall.auroc],
    [
      "test F1",
      ours.test?.overall.atThreshold.f1,
      published.test?.overall.atThreshold.f1,
    ],
    ["threshold", ours.threshold, published.threshold],
    ["all AUROC", ours.all.overall.auroc, published.all.overall.auroc],
  ] as const;
  for (const [name, a, b] of pairs) {
    const ok = a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9;
    if (!ok) mismatches++;
    console.log(
      `${MODELS[model].label.padEnd(22)} ${name.padEnd(11)} ${a?.toFixed(4)} vs published ${b?.toFixed(4)} ${ok ? "ok" : "MISMATCH"}`,
    );
  }
}
if (mismatches) process.exitCode = 1;
