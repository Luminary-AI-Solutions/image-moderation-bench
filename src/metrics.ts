export interface BinaryPoint {
  probability: number;
  unsafe: boolean;
}

export interface ThresholdStats {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  /** Share of safe images flagged: the cost guests feel. */
  falsePositiveRate: number;
  accuracy: number;
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function atThreshold(
  points: BinaryPoint[],
  threshold: number,
): ThresholdStats {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const { probability, unsafe } of points) {
    const flagged = probability >= threshold;
    if (flagged && unsafe) tp++;
    else if (flagged) fp++;
    else if (unsafe) fn++;
    else tn++;
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    threshold,
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    falsePositiveRate: ratio(fp, fp + tn),
    accuracy: ratio(tp + tn, points.length),
  };
}

/** Threshold that maximises F1, searched over every distinct probability. */
export function bestF1(points: BinaryPoint[]): ThresholdStats {
  const thresholds = [...new Set(points.map((p) => p.probability))];
  return thresholds
    .map((t) => atThreshold(points, t))
    .reduce((best, s) => (s.f1 > best.f1 ? s : best), atThreshold(points, 0.5));
}

/** Area under the ROC curve via the rank-sum statistic; ties count half. */
export function auroc(points: BinaryPoint[]): number {
  const sorted = [...points].sort((a, b) => a.probability - b.probability);
  let rankSum = 0;
  let positives = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].probability === sorted[i].probability)
      j++;
    const averageRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      if (sorted[k].unsafe) {
        rankSum += averageRank;
        positives++;
      }
    }
    i = j;
  }
  const negatives = points.length - positives;
  return ratio(
    rankSum - (positives * (positives + 1)) / 2,
    positives * negatives,
  );
}

/** Average precision (area under the precision-recall curve, step-wise). */
export function averagePrecision(points: BinaryPoint[]): number {
  const sorted = [...points].sort((a, b) => b.probability - a.probability);
  const positives = sorted.filter((p) => p.unsafe).length;
  let tp = 0;
  let sum = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    let groupPositives = 0;
    while (
      j < sorted.length &&
      sorted[j].probability === sorted[i].probability
    ) {
      if (sorted[j].unsafe) groupPositives++;
      j++;
    }
    tp += groupPositives;
    sum += groupPositives * ratio(tp, j);
    i = j;
  }
  return ratio(sum, positives);
}

export function brier(points: BinaryPoint[]): number {
  return ratio(
    points.reduce(
      (sum, p) => sum + (p.probability - (p.unsafe ? 1 : 0)) ** 2,
      0,
    ),
    points.length,
  );
}

/** Expected calibration error over equal-width bins. */
export function expectedCalibrationError(
  points: BinaryPoint[],
  bins = 10,
): number {
  const buckets = Array.from({ length: bins }, () => ({
    n: 0,
    confidence: 0,
    positives: 0,
  }));
  for (const p of points) {
    const bucket =
      buckets[Math.min(bins - 1, Math.floor(p.probability * bins))];
    bucket.n++;
    bucket.confidence += p.probability;
    if (p.unsafe) bucket.positives++;
  }
  return buckets.reduce(
    (sum, b) =>
      sum +
      (b.n === 0
        ? 0
        : (b.n / points.length) *
          Math.abs(b.confidence / b.n - b.positives / b.n)),
    0,
  );
}

export interface CategoryReport<C extends string> {
  accuracy: number;
  macroF1: number;
  perClass: Record<
    C,
    { precision: number; recall: number; f1: number; support: number }
  >;
  /** confusion[actual][predicted] */
  confusion: Record<C, Record<C, number>>;
}

export function categoryReport<C extends string>(
  classes: readonly C[],
  pairs: Array<{ actual: C; predicted: C }>,
): CategoryReport<C> {
  const confusion = Object.fromEntries(
    classes.map((a) => [a, Object.fromEntries(classes.map((p) => [p, 0]))]),
  ) as Record<C, Record<C, number>>;
  for (const { actual, predicted } of pairs) confusion[actual][predicted]++;

  const perClass = {} as CategoryReport<C>["perClass"];
  for (const c of classes) {
    const tp = confusion[c][c];
    const support = classes.reduce((n, p) => n + confusion[c][p], 0);
    const predictedCount = classes.reduce((n, a) => n + confusion[a][c], 0);
    const precision = ratio(tp, predictedCount);
    const recall = ratio(tp, support);
    perClass[c] = {
      precision,
      recall,
      f1: ratio(2 * precision * recall, precision + recall),
      support,
    };
  }
  const present = classes.filter((c) => perClass[c].support > 0);
  return {
    accuracy: ratio(
      pairs.filter((p) => p.actual === p.predicted).length,
      pairs.length,
    ),
    macroF1: ratio(
      present.reduce((sum, c) => sum + perClass[c].f1, 0),
      present.length,
    ),
    perClass,
    confusion,
  };
}

/** Nearest-rank percentile, `q` in [0, 100]. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((q / 100) * sorted.length) - 1),
    )
  ];
}

/** mulberry32: small and seedable, enough for sampling and bootstrap. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The operating point with the highest recall whose false-positive rate stays
 * at or under `maxFpr`. Compares models whose scores mean different things
 * (P(unsafe), a 0-100 confidence) at the same cost to safe images.
 */
export function recallAtFpr(
  points: BinaryPoint[],
  maxFpr: number,
): ThresholdStats {
  const thresholds = [...new Set(points.map((p) => p.probability))].sort(
    (a, b) => b - a,
  );
  let best = atThreshold(points, Number.POSITIVE_INFINITY);
  for (const t of thresholds) {
    const stats = atThreshold(points, t);
    if (stats.falsePositiveRate > maxFpr) break;
    best = stats;
  }
  return best;
}

/** 95% percentile-bootstrap interval for `metric` over `points`. */
export function bootstrap(
  points: BinaryPoint[],
  metric: (points: BinaryPoint[]) => number,
  { resamples = 1000, seed = 1 } = {},
): [number, number] {
  const random = seededRandom(seed);
  const values = Array.from({ length: resamples }, () =>
    metric(
      Array.from(
        { length: points.length },
        () => points[Math.floor(random() * points.length)],
      ),
    ),
  );
  return [percentile(values, 2.5), percentile(values, 97.5)];
}
