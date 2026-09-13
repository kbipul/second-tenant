/** Small deterministic statistics helpers. No dependencies, no randomness. */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Linear-interpolated quantile, q in [0,1]. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

/**
 * Coefficient of variation: stddev / mean. A perfectly metronomic series
 * scores 0; bursty human-driven traffic scores well above 1.
 */
export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return stddev(xs) / m;
}

/**
 * Circular mean of hours-of-day, returned in [0,24). Hour-of-day is an angle:
 * the naive arithmetic mean of 23:00 and 01:00 is noon, which is wrong.
 */
export function circularMeanHour(hours: number[]): number {
  if (hours.length === 0) return 0;
  let sx = 0;
  let sy = 0;
  for (const h of hours) {
    const a = (h / 24) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return 0;
  let a = Math.atan2(sy / hours.length, sx / hours.length);
  if (a < 0) a += 2 * Math.PI;
  return (a / (2 * Math.PI)) * 24;
}

/** Shortest distance between two hours on a 24h clock, in [0,12]. */
export function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return d > 12 ? 24 - d : d;
}

/**
 * Jensen-Shannon divergence between two discrete distributions, base 2,
 * so the result is in [0,1]. Used for model-mix disjointness.
 */
export function jensenShannon(p: number[], q: number[]): number {
  const n = Math.max(p.length, q.length);
  const ps = normalise(pad(p, n));
  const qs = normalise(pad(q, n));
  let d = 0;
  for (let i = 0; i < n; i++) {
    const m = (ps[i] + qs[i]) / 2;
    if (ps[i] > 0) d += 0.5 * ps[i] * Math.log2(ps[i] / m);
    if (qs[i] > 0) d += 0.5 * qs[i] * Math.log2(qs[i] / m);
  }
  return Math.min(1, Math.max(0, d));
}

function pad(xs: number[], n: number): number[] {
  const out = xs.slice();
  while (out.length < n) out.push(0);
  return out;
}

function normalise(xs: number[]): number[] {
  const t = xs.reduce((a, b) => a + b, 0);
  if (t === 0) return xs.map(() => 0);
  return xs.map((x) => x / t);
}

/** Clamp to [0,1]. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Quartile coefficient of dispersion: (Q3-Q1)/(Q3+Q1), in [0,1].
 *
 * Used instead of the coefficient of variation for inter-arrival gaps. A
 * workload that runs nightly has one enormous gap between sessions for every
 * few dozen small ones, and a stddev-based measure reads that as wild
 * irregularity - exactly backwards for a job running like clockwork. Quartiles
 * ignore the tail and describe the typical gap.
 */
export function quartileDispersion(xs: number[]): number {
  if (xs.length < 4) return 0;
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  if (q1 + q3 === 0) return 0;
  return clamp01((q3 - q1) / (q3 + q1));
}
