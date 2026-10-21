import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  ensureSplit,
  loadSamples,
  type Sample,
  type Split,
  sample,
} from "./dataset.ts";
import {
  type Credentials,
  isModelName,
  MODELS,
  type ModelName,
  moderateImage,
} from "./models.ts";
import { toDataUrl } from "./prepareImage.ts";
import { type Job, type Scored, summarize } from "./summary.ts";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    split: { type: "string", default: "all" },
    limit: { type: "string" },
    seed: { type: "string", default: "1" },
    concurrency: { type: "string", default: "8" },
    out: { type: "string" },
  },
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} (see .env.example).`);
  return value;
}

if (!values.model || !isModelName(values.model)) {
  throw new Error(`--model must be one of ${Object.keys(MODELS).join(", ")}`);
}
const model: ModelName = values.model;
const splits: Split[] =
  values.split === "all" ? ["train", "test"] : [values.split as Split];
const concurrency = Number(values.concurrency);
const outDir = values.out ?? `runs/${model}`;

const credentials: Credentials = {
  "clef-flash": () => ({
    cloudflare: {
      accountId: required("CLOUDFLARE_ACCOUNT_ID"),
      apiKey: required("CLOUDFLARE_API_TOKEN"),
    },
  }),
  jev: () => ({ openRouterApiKey: required("OPENROUTER_API_KEY") }),
  "haiku-5.5": () => ({ anthropicApiKey: required("ANTHROPIC_API_KEY") }),
  rekognition: () => {
    required("AWS_ACCESS_KEY_ID");
    required("AWS_SECRET_ACCESS_KEY");
    return { awsRegion: required("AWS_REGION") };
  },
}[model]();

let samples: Sample[] = [];
for (const split of splits) {
  const path = await ensureSplit(
    split,
    ".cache/unsafebench",
    required("HF_TOKEN"),
  );
  const loaded = await loadSamples(path, split);
  if (loaded.skipped.length) {
    console.warn(`${split}: skipped ${loaded.skipped.length} unmappable rows`);
  }
  samples.push(...loaded.samples);
}
if (values.limit)
  samples = sample(samples, Number(values.limit), Number(values.seed));

// Resume: rows already in predictions.jsonl are kept; failed ones are retried.
await mkdir(outDir, { recursive: true });
const predictionsPath = `${outDir}/predictions.jsonl`;
const done = new Map<string, Scored>();
const failures = new Map<string, string>();
for (const line of (
  await readFile(predictionsPath, "utf8").catch(() => "")
).split("\n")) {
  if (!line) continue;
  const row = JSON.parse(line) as Scored & { error?: string };
  if (row.error) failures.set(row.id, row.error);
  else done.set(row.id, row);
}
const todo = samples.filter((s) => !done.has(s.id));
console.log(
  `${MODELS[model].label}: ${samples.length} images, ${done.size} already scored, ${todo.length} to run (concurrency ${concurrency}).`,
);

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Cloudflare errors read "(429)", OpenRouter's "failed: 429".
      const retryable = /(\(|: )(429|5\d\d)\b/.test(String(error));
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

async function score(
  s: Sample,
): Promise<Scored | { id: string; error: string }> {
  try {
    const dataUrl = await toDataUrl(s.image, {
      minSide: MODELS[model].minSide,
    });
    const m = await withRetry(() => moderateImage(dataUrl, credentials, model));
    return {
      id: s.id,
      split: s.split,
      source: s.source,
      unsafe: s.unsafe,
      category: s.category,
      predictedCategory: m.category,
      unsafeProbability: m.unsafeProbability,
      verdict: m.verdict,
      refused: m.refused,
      topLabel: m.topLabel,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      costUsd: m.costUsd,
      latencyMs: m.latencyMs,
    };
  } catch (error) {
    return { id: s.id, error: String(error) };
  }
}

const jobsPath = `${outDir}/jobs.json`;
const jobs: Job[] = JSON.parse(
  await readFile(jobsPath, "utf8").catch(() => "[]"),
);
if (todo.length) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  let next = 0;
  let finished = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < todo.length) {
        const row = await score(todo[next++]);
        if ("error" in row) failures.set(row.id, row.error);
        else {
          done.set(row.id, row);
          failures.delete(row.id);
        }
        await appendFile(predictionsPath, `${JSON.stringify(row)}\n`);
        if (++finished % 250 === 0 || finished === todo.length) {
          console.log(`${finished}/${todo.length}`);
        }
      }
    }),
  );
  jobs.push({
    startedAt,
    wallMs: performance.now() - started,
    images: todo.length,
    concurrency,
  });
  await writeFile(jobsPath, `${JSON.stringify(jobs, null, 2)}\n`);
}

const rows = samples
  .map((s) => done.get(s.id))
  .filter((r): r is Scored => r !== undefined);
const errors = samples.filter(
  (s) => failures.has(s.id) && !done.has(s.id),
).length;
const summary = summarize(model, rows, jobs, errors);
await writeFile(
  `${outDir}/summary.json`,
  `${JSON.stringify(summary, null, 2)}\n`,
);

const t = summary.test?.overall ?? summary.all.overall;
console.log(
  [
    `\n${summary.label}: ${summary.scored} scored, ${errors} errors, ${summary.refusals} refusals`,
    `AUROC ${t.auroc.toFixed(3)}, F1 ${t.atThreshold.f1.toFixed(3)} at ${summary.threshold.toFixed(3)} (${summary.test ? "test" : "all"})`,
    `latency p50 ${summary.latencyMs.p50.toFixed(0)} ms, p95 ${summary.latencyMs.p95.toFixed(0)} ms; cost $${summary.cost.totalUsd.toFixed(4)}`,
    `Wrote ${outDir}/summary.json`,
  ].join("\n"),
);
