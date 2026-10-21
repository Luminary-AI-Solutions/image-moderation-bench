import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { type Category, toCategory } from "./categories.ts";
import { seededRandom } from "./metrics.ts";

const REPO = "yiting/UnsafeBench";

export type Split = "train" | "test";

export interface Sample {
  /** Stable id across runs: `${split}-${row index}`. */
  id: string;
  split: Split;
  index: number;
  image: Uint8Array;
  unsafe: boolean;
  category: Category;
  source: string;
}

/**
 * Downloads a split's parquet shard once. UnsafeBench is gated: accept its
 * DUA on Hugging Face first, then pass a read token.
 */
export async function ensureSplit(
  split: Split,
  cacheDir: string,
  hfToken: string,
): Promise<string> {
  const path = `${cacheDir}/${split}.parquet`;
  if (await stat(path).catch(() => undefined)) return path;
  const url = `https://huggingface.co/datasets/${REPO}/resolve/main/data/${split}-00000-of-00001.parquet`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${hfToken}` },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Download failed (${response.status}). Request access at https://huggingface.co/datasets/${REPO} and check HF_TOKEN.`,
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(`${path}.part`),
  );
  await rename(`${path}.part`, path);
  return path;
}

interface Row {
  image: { bytes: Uint8Array } | Uint8Array;
  safety_label: string;
  category: string;
  source: string;
}

/** Reads every labeled row. Rows whose label or category we can't map are reported, not guessed. */
export async function loadSamples(
  path: string,
  split: Split,
): Promise<{ samples: Sample[]; skipped: string[] }> {
  const rows = (await parquetReadObjects({
    file: await asyncBufferFromFile(path),
    columns: ["image", "safety_label", "category", "source"],
    // Image bytes are unannotated BYTE_ARRAY; the default would decode them as text.
    utf8: false,
  })) as Row[];
  const samples: Sample[] = [];
  const skipped: string[] = [];
  rows.forEach((row, index) => {
    const label = row.safety_label.trim().toLowerCase();
    const category = toCategory(row.category);
    if ((label !== "safe" && label !== "unsafe") || !category) {
      skipped.push(
        `row ${index}: safety_label=${row.safety_label} category=${row.category}`,
      );
      return;
    }
    const image = row.image instanceof Uint8Array ? row.image : row.image.bytes;
    if (!(image instanceof Uint8Array)) {
      throw new Error(`Row ${index}: image is ${typeof image}, expected bytes`);
    }
    samples.push({
      id: `${split}-${index}`,
      split,
      index,
      image,
      unsafe: label === "unsafe",
      category,
      source: row.source,
    });
  });
  return { samples, skipped };
}

/** Deterministic sample of `limit` rows (mulberry32 shuffle). */
export function sample<T>(items: T[], limit: number, seed: number): T[] {
  const random = seededRandom(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, limit);
}
