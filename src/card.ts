import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Renders the shareable results card (assets/benchmark.html, 1600x900) from
 * results/leaderboard.json, so every number on it comes from the published
 * results. Turn it into a PNG with any Chromium:
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
    f1: number;
    recallAt10Fpr: number;
  };
  latencyMs: { p50: number };
  job?: { wallSeconds: number };
  cost: { per1kImagesUsd: number };
}

/** Brand colours per model (Candids palette 2B). */
const COLOR: Record<string, string> = {
  jev: "#30638E",
  "clef-flash": "#00798C",
  "haiku-5.5": "#B03649",
  rekognition: "#5E6672",
};

const MARK = `<svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true"><rect width="64" height="64" rx="17" fill="#D1495B"/><path d="M12.5 16.5h5.2l4.2-7.1a4 4 0 0 1 3.4-1.9h11.4a4 4 0 0 1 3.4 1.9l4.2 7.1H51.5a9 9 0 0 1 9 9v22.5a9 9 0 0 1-9 9h-39a9 9 0 0 1-9-9V25.5a9 9 0 0 1 9-9z" fill="#B53A4B"/><rect x="7.5" y="9.6" width="7.4" height="3.6" rx="1.8" fill="#B53A4B"/><circle cx="31.5" cy="35.5" r="11.6" fill="#003D5B"/><path d="M24.36 32.9A7.6 7.6 0 0 1 28.29 28.61" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="2.4" stroke-linecap="round"/><path d="M42.8 25.33A15.2 15.2 0 1 0 43.48 44.86" stroke="#FFFFFF" stroke-width="7.6" stroke-linecap="round" fill="none"/><circle cx="51.2" cy="15.8" r="3.6" fill="#EDAE49"/><path d="M46.6 9.6l-2.2-2.2M51.2 7.6V4.4M55.8 9.6l2.2-2.2" stroke="#EDAE49" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const AXIS = { min: 0.5, max: 1 };
const pos = (x: number) =>
  `${(((x - AXIS.min) / (AXIS.max - AXIS.min)) * 100).toFixed(2)}%`;

const money = (x: number) =>
  x >= 1 ? `$${x.toFixed(2)}` : `${(x * 100).toFixed(1)}¢`;
const minutes = (s?: number) =>
  s === undefined ? "–" : `${(s / 60).toFixed(1)} min`;

export function renderCard(
  rows: Row[],
  copy: { headline: string; lede: string; stamp: string },
): string {
  const ranked = [...rows].sort((a, b) => b.test.auroc - a.test.auroc);
  const bars = ranked
    .map((r) => {
      const [lo, hi] = r.test.aurocCi ?? [r.test.auroc, r.test.auroc];
      return `
      <div class="bar-row">
        <div class="who"><span class="dot" style="background:${COLOR[r.model]}"></span><span><b>${r.label}</b><small>${r.provider}</small></span></div>
        <div class="track">
          <div class="fill" style="width:${pos(r.test.auroc)};background:${COLOR[r.model]}"></div>
          <div class="ci" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})"></div>
          <div class="val" style="left:${pos(r.test.auroc)}">${r.test.auroc.toFixed(3)}</div>
        </div>
      </div>`;
    })
    .join("");
  const table = ranked
    .map(
      (r) => `
        <tr>
          <th scope="row"><span class="dot" style="background:${COLOR[r.model]}"></span>${r.label}</th>
          <td>${r.test.f1.toFixed(3)}</td>
          <td>${(r.test.recallAt10Fpr * 100).toFixed(0)}%</td>
          <td>${r.latencyMs.p50.toLocaleString("en-US")} ms</td>
          <td>${minutes(r.job?.wallSeconds)}</td>
          <td>${money(r.cost.per1kImagesUsd)}</td>
        </tr>`,
    )
    .join("");
  const tickValues = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const ticks = tickValues
    .map((t) => `<span style="left:${pos(t)}">${t.toFixed(1)}</span>`)
    .join("");
  const grid = tickValues.map((t) => `<i style="left:${pos(t)}"></i>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Image moderation benchmark</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
html,body{margin:0;background:#FBF8F6}
.card{width:1600px;height:900px;padding:44px 72px 40px;display:flex;flex-direction:column;gap:24px;background:#FBF8F6;color:#142230;font:400 15px/1.55 "Instrument Sans",system-ui,sans-serif;font-variant-numeric:tabular-nums}
.top{display:flex;align-items:center;justify-content:space-between}
.lockup{display:flex;align-items:center;gap:16px;font:700 30px/1 "Bricolage Grotesque",sans-serif;letter-spacing:-0.03em}
.stamp{font:500 14px/1 "JetBrains Mono",monospace;letter-spacing:0.08em;color:#9A5B00}
.intro{display:flex;flex-direction:column;gap:10px}
.kicker{font:600 17px/1.2 "Instrument Sans",sans-serif;color:#B03649}
h1{margin:0;font:700 46px/1.04 "Bricolage Grotesque",sans-serif;letter-spacing:-0.035em;text-wrap:balance}
.lede{margin:0;font-size:18px;line-height:1.5;color:#3A4552;max-width:1240px}
.main{display:grid;grid-template-columns:minmax(0,1fr) 640px;gap:40px;flex:1;min-height:0}
.panel{background:#FFFFFF;border:1px solid #E6DFDB;border-radius:18px;padding:26px 28px;display:flex;flex-direction:column;gap:18px}
.panel h2{margin:0;font:700 22px/1.1 "Bricolage Grotesque",sans-serif;letter-spacing:-0.02em}
.panel h2 small{display:block;margin-top:6px;font:400 14px/1.3 "Instrument Sans",sans-serif;color:#5E6672;letter-spacing:0}
.chart{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:12px}
.grid{position:absolute;top:-10px;bottom:-10px;left:246px;right:0;pointer-events:none}
.grid i{position:absolute;top:0;bottom:0;width:1px;background:#EFEAE6}
.bars{position:relative;display:flex;flex-direction:column;gap:20px}
.bar-row{display:grid;grid-template-columns:230px minmax(0,1fr);align-items:center;gap:16px}
.who{display:flex;gap:10px;align-items:flex-start}
.who b{display:block;font-weight:600;font-size:16px;line-height:1.2}
.who small{display:block;color:#5E6672;font-size:12.5px;line-height:1.3}
.dot{display:inline-block;width:12px;height:12px;border-radius:999px;flex:none;margin-top:4px}
.track{position:relative;height:30px;background:rgba(242,237,234,0.7);border-radius:8px}
.fill{position:absolute;inset:0 auto 0 0;border-radius:8px}
.ci{position:absolute;top:50%;height:2px;margin-top:-1px;background:#142230}
.ci::before,.ci::after{content:"";position:absolute;top:-6px;width:2px;height:14px;background:#142230}
.ci::before{left:0}.ci::after{right:0}
.val{position:absolute;top:-1px;margin-left:12px;padding:5px 8px;border-radius:6px;background:#FFFFFF;border:1px solid #E6DFDB;font:600 14px/1 "JetBrains Mono",monospace;color:#142230;transform:translateX(0)}
.axis{position:relative;height:18px;margin-left:246px;font:400 12px/1 "JetBrains Mono",monospace;color:#5E6672}
.axis span{position:absolute;transform:translateX(-50%)}
table{width:100%;border-collapse:collapse;font-size:15px}
thead th{font:600 12.5px/1.25 "Instrument Sans",sans-serif;color:#5E6672;text-align:right;padding:0 0 10px 10px;vertical-align:bottom}
thead th:first-child{text-align:left;padding-left:0}
tbody th{text-align:left;font-weight:600;padding:12px 0;display:flex;align-items:center;gap:10px;white-space:nowrap}
tbody th .dot{margin-top:0}
tbody td{text-align:right;padding:12px 0 12px 10px;white-space:nowrap}
tbody tr+tr th,tbody tr+tr td{border-top:1px solid #EFEAE6}
.note{margin:0;color:#5E6672;font-size:13px;line-height:1.45}
.foot{display:flex;justify-content:space-between;align-items:flex-end;gap:32px;color:#5E6672;font-size:13.5px;line-height:1.45}
.foot p{margin:0;max-width:900px}
.repo{text-decoration:none;display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;background:#003D5B;color:#F4F8FA;font:500 14px/1 "JetBrains Mono",monospace;white-space:nowrap}
</style>
</head>
<body>
<main class="card">
  <div class="top">
    <div class="lockup">${MARK}<span>candids</span></div>
    <div class="stamp">${copy.stamp}</div>
  </div>
  <div class="intro">
    <div class="kicker">Image moderation benchmark on UnsafeBench</div>
    <h1>${copy.headline}</h1>
    <p class="lede">${copy.lede}</p>
  </div>
  <div class="main">
    <section class="panel">
      <h2>How well each model ranks unsafe images above safe ones<small>AUROC on the 2,037-image test split, with 95% bootstrap intervals. 0.5 is a coin flip.</small></h2>
      <div class="chart">
        <div class="bars"><div class="grid">${grid}</div>${bars}</div>
        <div class="axis">${ticks}</div>
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
  </div>
  <div class="foot">
    <p>Every model saw the same images and the same prompt (Rekognition takes none). Thresholds come from the 8,109-image train split; the test split never influenced them. Methodology, per-image outputs and code to rerun it are in the repository.</p>
    <a class="repo" href="https://${REPO}">${REPO}</a>
  </div>
</main>
</body>
</html>
`;
}

if (import.meta.main) {
  const { models } = JSON.parse(
    await readFile("results/leaderboard.json", "utf8"),
  ) as { models: Row[] };
  const copy = JSON.parse(await readFile("assets/card-copy.json", "utf8"));
  await mkdir("assets", { recursive: true });
  await writeFile("assets/benchmark.html", renderCard(models, copy));
  console.log("Wrote assets/benchmark.html");
}
