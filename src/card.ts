import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CATEGORY_IDS } from "./categories.ts";

/**
 * Renders the shareable cards (1600x900) from results/leaderboard.json, so
 * every number on them comes from the published results:
 *
 * - assets/benchmark.html: AUROC chart plus accuracy, speed and cost
 * - assets/benchmark-table.html: every metric, and F1 by category
 *
 * Turn either into a PNG with any Chromium:
 *
 *   npm run card
 *   chrome --headless --screenshot=assets/benchmark.png \
 *     --window-size=1600,900 --force-device-scale-factor=2 assets/benchmark.html
 */
export const REPO = "github.com/Luminary-AI-Solutions/image-moderation-bench";

interface Row {
  model: string;
  label: string;
  provider: string;
  test: {
    auroc: number;
    aurocCi?: number[];
    averagePrecision: number;
    f1: number;
    precision: number;
    recall: number;
    falsePositiveRate: number;
    recallAt5Fpr: number;
    recallAt10Fpr: number;
    verdictF1: number;
    categoryAccuracy: number | null;
    categoryF1: Record<string, number>;
  };
  latencyMs: { p50: number };
  job?: { wallSeconds: number };
  cost: { per1kImagesUsd: number };
}

interface Copy {
  headline: string;
  lede: string;
}

/** Brand colours per model (Candids palette 2B). */
const COLOR: Record<string, string> = {
  jev: "#30638E",
  "clef-flash": "#00798C",
  "haiku-5.5": "#B03649",
  rekognition: "#5E6672",
};

const CATEGORY_LABELS: Record<string, string> = {
  hate: "Hate",
  harassment: "Harass&shy;ment",
  violence: "Violence",
  self_harm: "Self-harm",
  sexual: "Sexual",
  shocking: "Shocking",
  illegal_activity: "Illegal activity",
  deception: "Deception",
  political: "Political",
  public_and_personal_health: "Health",
  spam: "Spam",
};

const MARK = `<svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true"><rect width="64" height="64" rx="17" fill="#D1495B"/><path d="M12.5 16.5h5.2l4.2-7.1a4 4 0 0 1 3.4-1.9h11.4a4 4 0 0 1 3.4 1.9l4.2 7.1H51.5a9 9 0 0 1 9 9v22.5a9 9 0 0 1-9 9h-39a9 9 0 0 1-9-9V25.5a9 9 0 0 1 9-9z" fill="#B53A4B"/><rect x="7.5" y="9.6" width="7.4" height="3.6" rx="1.8" fill="#B53A4B"/><circle cx="31.5" cy="35.5" r="11.6" fill="#003D5B"/><path d="M24.36 32.9A7.6 7.6 0 0 1 28.29 28.61" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="2.4" stroke-linecap="round"/><path d="M42.8 25.33A15.2 15.2 0 1 0 43.48 44.86" stroke="#FFFFFF" stroke-width="7.6" stroke-linecap="round" fill="none"/><circle cx="51.2" cy="15.8" r="3.6" fill="#EDAE49"/><path d="M46.6 9.6l-2.2-2.2M51.2 7.6V4.4M55.8 9.6l2.2-2.2" stroke="#EDAE49" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/** The frame both cards share: Candids tokens, lockup, stamp and footer. */
const BASE_CSS = `*{box-sizing:border-box}
html,body{margin:0;background:#FBF8F6}
.card{width:1600px;height:900px;padding:44px 72px 40px;display:flex;flex-direction:column;gap:24px;background:#FBF8F6;color:#142230;font:400 15px/1.55 "Instrument Sans",system-ui,sans-serif;font-variant-numeric:tabular-nums}
.top{display:flex;align-items:center;justify-content:space-between}
.lockup{display:flex;align-items:center;gap:16px;font:700 30px/1 "Bricolage Grotesque",sans-serif;letter-spacing:-0.03em}
.stamp{font:500 14px/1 "JetBrains Mono",monospace;letter-spacing:0.08em;color:#9A5B00}
.intro{display:flex;flex-direction:column;gap:10px}
.kicker{font:600 17px/1.2 "Instrument Sans",sans-serif;color:#B03649}
h1{margin:0;font:700 46px/1.04 "Bricolage Grotesque",sans-serif;letter-spacing:-0.035em;text-wrap:balance}
.lede{margin:0;font-size:18px;line-height:1.5;color:#3A4552;max-width:1280px}
.panel{background:#FFFFFF;border:1px solid #E6DFDB;border-radius:18px;padding:26px 28px;display:flex;flex-direction:column;gap:18px}
.panel h2{margin:0;font:700 22px/1.1 "Bricolage Grotesque",sans-serif;letter-spacing:-0.02em}
.panel h2 small{display:block;margin-top:6px;font:400 14px/1.3 "Instrument Sans",sans-serif;color:#5E6672;letter-spacing:0}
.dot{display:inline-block;width:12px;height:12px;border-radius:999px;flex:none}
table{width:100%;border-collapse:collapse;font-size:15px}
thead th{font:600 12.5px/1.25 "Instrument Sans",sans-serif;color:#5E6672;text-align:right;padding:0 0 10px 10px;vertical-align:bottom}
thead th:first-child{text-align:left;padding-left:0}
tbody th{text-align:left;font-weight:600;white-space:nowrap}
tbody th span.name{display:flex;align-items:center;gap:10px}
tbody td{text-align:right;white-space:nowrap}
tbody tr+tr th,tbody tr+tr td{border-top:1px solid #EFEAE6}
.note{margin:0;color:#5E6672;font-size:13px;line-height:1.45}
.foot{display:flex;justify-content:space-between;align-items:flex-end;gap:32px;color:#5E6672;font-size:13.5px;line-height:1.45}
.foot p{margin:0;max-width:900px}
.repo{text-decoration:none;display:flex;align-items:center;padding:10px 16px;border-radius:999px;background:#003D5B;color:#F4F8FA;font:500 14px/1 "JetBrains Mono",monospace;white-space:nowrap}`;

const FOOT =
  "Every model saw the same images and the same prompt (Rekognition takes none). Thresholds come from the 8,109-image train split; the test split never influenced them. Methodology, per-image outputs and code to rerun it are in the repository.";

function page(title: string, css: string, body: string, stamp: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${BASE_CSS}
${css}
</style>
</head>
<body>
<main class="card">
  <div class="top">
    <div class="lockup">${MARK}<span>candids</span></div>
    <div class="stamp">${stamp}</div>
  </div>
${body}
  <div class="foot">
    <p>${FOOT}</p>
    <a class="repo" href="https://${REPO}">${REPO}</a>
  </div>
</main>
</body>
</html>
`;
}

const intro = (kicker: string, copy: Copy) => `  <div class="intro">
    <div class="kicker">${kicker}</div>
    <h1>${copy.headline}</h1>
    <p class="lede">${copy.lede}</p>
  </div>`;

const name = (r: Row) =>
  `<span class="name"><span class="dot" style="background:${COLOR[r.model]}"></span>${r.label}</span>`;

const AXIS = { min: 0.5, max: 1 };
const pos = (x: number) =>
  `${(((x - AXIS.min) / (AXIS.max - AXIS.min)) * 100).toFixed(2)}%`;
const money = (x: number) =>
  x >= 1 ? `$${x.toFixed(2)}` : `${(x * 100).toFixed(1)}¢`;
const minutes = (s?: number) =>
  s === undefined ? "–" : `${(s / 60).toFixed(1)} min`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const f3 = (x: number) => x.toFixed(3);

const byAuroc = (rows: Row[]) =>
  [...rows].sort((a, b) => b.test.auroc - a.test.auroc);

export function renderCard(rows: Row[], copy: Copy, stamp: string): string {
  const ranked = byAuroc(rows);
  const tickValues = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const bars = ranked
    .map((r) => {
      const [lo, hi] = r.test.aurocCi ?? [r.test.auroc, r.test.auroc];
      return `
          <div class="bar-row">
            <div class="who"><span class="dot" style="background:${COLOR[r.model]}"></span><span><b>${r.label}</b><small>${r.provider}</small></span></div>
            <div class="track">
              <div class="fill" style="width:${pos(r.test.auroc)};background:${COLOR[r.model]}"></div>
              <div class="ci" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})"></div>
              <div class="val" style="left:${pos(r.test.auroc)}">${f3(r.test.auroc)}</div>
            </div>
          </div>`;
    })
    .join("");
  const table = ranked
    .map(
      (r) => `
          <tr>
            <th scope="row">${name(r)}</th>
            <td>${f3(r.test.f1)}</td>
            <td>${(r.test.recallAt10Fpr * 100).toFixed(0)}%</td>
            <td>${r.latencyMs.p50.toLocaleString("en-US")} ms</td>
            <td>${minutes(r.job?.wallSeconds)}</td>
            <td>${money(r.cost.per1kImagesUsd)}</td>
          </tr>`,
    )
    .join("");
  const css = `.main{display:grid;grid-template-columns:minmax(0,1fr) 640px;gap:40px;flex:1;min-height:0}
.chart{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:12px}
.grid{position:absolute;top:-10px;bottom:-10px;left:246px;right:0;pointer-events:none}
.grid i{position:absolute;top:0;bottom:0;width:1px;background:#EFEAE6}
.bars{position:relative;display:flex;flex-direction:column;gap:20px}
.bar-row{position:relative;display:grid;grid-template-columns:230px minmax(0,1fr);align-items:center;gap:16px}
.who{display:flex;gap:10px;align-items:flex-start}
.who .dot{margin-top:4px}
.who b{display:block;font-weight:600;font-size:16px;line-height:1.2}
.who small{display:block;color:#5E6672;font-size:12.5px;line-height:1.3}
.track{position:relative;height:30px;background:rgba(242,237,234,0.7);border-radius:8px}
.fill{position:absolute;inset:0 auto 0 0;border-radius:8px}
.ci{position:absolute;top:50%;height:2px;margin-top:-1px;background:#142230}
.ci::before,.ci::after{content:"";position:absolute;top:-6px;width:2px;height:14px;background:#142230}
.ci::before{left:0}.ci::after{right:0}
.val{position:absolute;top:-1px;margin-left:12px;padding:5px 8px;border-radius:6px;background:#FFFFFF;border:1px solid #E6DFDB;font:600 14px/1 "JetBrains Mono",monospace}
.axis{position:relative;height:18px;margin-left:246px;font:400 12px/1 "JetBrains Mono",monospace;color:#5E6672}
.axis span{position:absolute;transform:translateX(-50%)}
tbody th,tbody td{padding-top:12px;padding-bottom:12px}
tbody td{padding-left:10px}`;
  const body = `${intro("Image moderation benchmark on UnsafeBench", copy)}
  <div class="main">
    <section class="panel">
      <h2>How well each model ranks unsafe images above safe ones<small>AUROC on the 2,037-image test split, with 95% bootstrap intervals. 0.5 is a coin flip.</small></h2>
      <div class="chart">
        <div class="bars"><div class="grid">${tickValues.map((t) => `<i style="left:${pos(t)}"></i>`).join("")}</div>${bars}
        </div>
        <div class="axis">${tickValues.map((t) => `<span style="left:${pos(t)}">${t.toFixed(1)}</span>`).join("")}</div>
      </div>
    </section>
    <section class="panel">
      <h2>Accuracy, speed and cost<small>F1 at a threshold chosen on the train split. Speed and cost over all 10,146 images.</small></h2>
      <table>
        <thead><tr><th>Model</th><th>F1</th><th>Recall at<br>10% false flags</th><th>Median<br>latency</th><th>Full job<br>(8 at a time)</th><th>Per 1,000<br>images</th></tr></thead>
        <tbody>${table}</tbody>
      </table>
      <p class="note">Latency is the round trip over each provider's public API from one workstation, so it includes network time. Rekognition has no categories for political, deception, health or spam content.</p>
    </section>
  </div>`;
  return page("Image moderation benchmark", css, body, stamp);
}

/** Marks the best value in a column (highest, or lowest when `lower`). */
function best(rows: Row[], value: (r: Row) => number | null, lower = false) {
  const values = rows
    .map(value)
    .filter((v): v is number => v !== null)
    .map((v) => Number(v.toFixed(3)));
  const target = lower ? Math.min(...values) : Math.max(...values);
  return (r: Row, text: string) => {
    const v = value(r);
    return v !== null && Number(v.toFixed(3)) === target
      ? `<td class="best">${text}</td>`
      : `<td>${text}</td>`;
  };
}

export function renderTableCard(
  rows: Row[],
  copy: Copy,
  stamp: string,
): string {
  const ranked = byAuroc(rows);
  const columns: Array<{
    head: string;
    value: (r: Row) => number | null;
    text: (r: Row) => string;
    lower?: boolean;
    /** Trade-off columns (precision, recall, flag rate) are not ranked. */
    unranked?: boolean;
  }> = [
    {
      head: "AUROC",
      value: (r) => r.test.auroc,
      text: (r) => f3(r.test.auroc),
    },
    {
      head: "Average<br>precision",
      value: (r) => r.test.averagePrecision,
      text: (r) => f3(r.test.averagePrecision),
    },
    { head: "F1", value: (r) => r.test.f1, text: (r) => f3(r.test.f1) },
    {
      head: "Precision",
      unranked: true,
      value: (r) => r.test.precision,
      text: (r) => pct(r.test.precision),
    },
    {
      head: "Recall",
      unranked: true,
      value: (r) => r.test.recall,
      text: (r) => pct(r.test.recall),
    },
    {
      head: "Safe images<br>flagged",
      unranked: true,
      value: (r) => r.test.falsePositiveRate,
      text: (r) => pct(r.test.falsePositiveRate),
    },
    {
      head: "Recall at<br>5% false flags",
      value: (r) => r.test.recallAt5Fpr,
      text: (r) => pct(r.test.recallAt5Fpr),
    },
    {
      head: "Recall at<br>10% false flags",
      value: (r) => r.test.recallAt10Fpr,
      text: (r) => pct(r.test.recallAt10Fpr),
    },
    {
      head: "Own-verdict<br>F1",
      value: (r) => r.test.verdictF1,
      text: (r) => f3(r.test.verdictF1),
    },
    {
      head: "Category<br>accuracy",
      value: (r) => r.test.categoryAccuracy,
      text: (r) =>
        r.test.categoryAccuracy === null ? "n/a" : pct(r.test.categoryAccuracy),
    },
  ];
  const overall = ranked
    .map(
      (r) =>
        `<tr><th scope="row">${name(r)}</th>${columns.map((c) => (c.unranked ? `<td>${c.text(r)}</td>` : best(ranked, c.value, c.lower)(r, c.text(r)))).join("")}</tr>`,
    )
    .join("\n          ");
  const categories = ranked
    .map(
      (r) =>
        `<tr><th scope="row">${name(r)}</th>${CATEGORY_IDS.map((c) => best(ranked, (x) => x.test.categoryF1[c])(r, f3(r.test.categoryF1[c]))).join("")}</tr>`,
    )
    .join("\n          ");
  const css = `.card{gap:20px}
h1{font-size:40px}
.tables{display:flex;flex-direction:column;gap:16px;flex:1;min-height:0}
.panel{padding:18px 26px;gap:10px}
.panel h2{font-size:20px}
.panel h2 small{margin-top:4px;font-size:13px}
thead th{padding-bottom:6px}
tbody th,tbody td{padding-top:7px;padding-bottom:7px}
tbody td{padding-left:8px}
td.best{font-weight:700}
.cats thead th{width:7.4%}
.cats thead th:first-child{width:auto}`;
  const body = `${intro("Full results on the UnsafeBench test split", copy)}
  <div class="tables">
    <section class="panel">
      <h2>Overall<small>2,037 test images at each model's train-chosen threshold. Own-verdict F1 uses each model's out-of-the-box call with no threshold.</small></h2>
      <table>
        <thead><tr><th>Model</th>${columns.map((c) => `<th>${c.head}</th>`).join("")}</tr></thead>
        <tbody>
          ${overall}
        </tbody>
      </table>
    </section>
    <section class="panel">
      <h2>F1 by content category<small>Same threshold, scored within each of UnsafeBench's 11 categories (about 185 test images each).</small></h2>
      <table class="cats">
        <thead><tr><th>Model</th>${CATEGORY_IDS.map((c) => `<th>${CATEGORY_LABELS[c]}</th>`).join("")}</tr></thead>
        <tbody>
          ${categories}
        </tbody>
      </table>
    </section>
  </div>`;
  return page("Image moderation benchmark, full results", css, body, stamp);
}

if (import.meta.main) {
  const { models } = JSON.parse(
    await readFile("results/leaderboard.json", "utf8"),
  ) as { models: Row[] };
  const copy = JSON.parse(await readFile("assets/card-copy.json", "utf8")) as {
    stamp: string;
    results: Copy;
    table: Copy;
  };
  await mkdir("assets", { recursive: true });
  await writeFile(
    "assets/benchmark.html",
    renderCard(models, copy.results, copy.stamp),
  );
  await writeFile(
    "assets/benchmark-table.html",
    renderTableCard(models, copy.table, copy.stamp),
  );
  console.log("Wrote assets/benchmark.html and assets/benchmark-table.html");
}
