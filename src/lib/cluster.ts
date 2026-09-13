import type { LabelledRecord, UsageRecord } from './types';
import { hourDistance, median } from './stats';

/**
 * Deterministic 2-means over a 3-dimensional behavioural feature space.
 *
 * Features, each scaled to roughly [0,1] so no single axis dominates:
 *   0 - hour-of-day, expressed as its distance from the busiest hour (a clock
 *       is circular, so raw hour numbers cannot be averaged)
 *   1 - log10 input tokens
 *   2 - log10 output tokens
 *
 * Initialisation is k-means++ style but seeded by *data order* rather than a
 * random generator: the first centroid is the medoid-ish first point, the
 * second is the point furthest from it. Same input always gives same output,
 * which matters because this drives a security verdict.
 */

export interface ClusterResult {
  labelled: LabelledRecord[];
  /** Mean silhouette coefficient for k=2, in [-1,1]. */
  silhouette: number;
  centroids: number[][];
}

const MAX_ITER = 50;

export function featureVector(r: UsageRecord, busiestHour: number): number[] {
  const hour = new Date(r.ts).getUTCHours() + new Date(r.ts).getUTCMinutes() / 60;
  return [
    hourDistance(hour, busiestHour) / 12,
    Math.log10(Math.max(1, r.inputTokens)) / 6,
    Math.log10(Math.max(1, r.outputTokens)) / 6,
  ];
}

export function busiestHourOf(records: UsageRecord[]): number {
  const bins = new Array(24).fill(0);
  for (const r of records) bins[new Date(r.ts).getUTCHours()]++;
  let best = 0;
  for (let i = 1; i < 24; i++) if (bins[i] > bins[best]) best = i;
  return best;
}

function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
  return s;
}

export function cluster2(records: UsageRecord[]): ClusterResult {
  if (records.length < 2) {
    return {
      labelled: records.map((r) => ({ ...r, cluster: 0 })),
      silhouette: 0,
      centroids: [],
    };
  }

  const busiest = busiestHourOf(records);
  const pts = records.map((r) => featureVector(r, busiest));

  // Deterministic seeding: centroid A = the point nearest the overall mean,
  // centroid B = the point furthest from A.
  const dim = pts[0].length;
  const centre = new Array(dim).fill(0);
  for (const p of pts) for (let i = 0; i < dim; i++) centre[i] += p[i] / pts.length;

  let ai = 0;
  for (let i = 1; i < pts.length; i++) {
    if (dist2(pts[i], centre) < dist2(pts[ai], centre)) ai = i;
  }
  let bi = 0;
  for (let i = 1; i < pts.length; i++) {
    if (dist2(pts[i], pts[ai]) > dist2(pts[bi], pts[ai])) bi = i;
  }

  let centroids = [pts[ai].slice(), pts[bi].slice()];
  let assign = new Array(pts.length).fill(0);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      const c = dist2(pts[i], centroids[0]) <= dist2(pts[i], centroids[1]) ? 0 : 1;
      if (c !== assign[i]) {
        assign[i] = c;
        moved = true;
      }
    }
    const sums = [new Array(dim).fill(0), new Array(dim).fill(0)];
    const counts = [0, 0];
    for (let i = 0; i < pts.length; i++) {
      counts[assign[i]]++;
      for (let d = 0; d < dim; d++) sums[assign[i]][d] += pts[i][d];
    }
    for (let c = 0; c < 2; c++) {
      if (counts[c] === 0) continue;
      centroids[c] = sums[c].map((s) => s / counts[c]);
    }
    if (!moved) break;
  }

  // Order clusters so cluster 0 is always the larger one - "yours" by volume.
  const n0 = assign.filter((a) => a === 0).length;
  if (n0 < pts.length - n0) {
    assign = assign.map((a) => (a === 0 ? 1 : 0));
    centroids = [centroids[1], centroids[0]];
  }

  return {
    labelled: records.map((r, i) => ({ ...r, cluster: assign[i] })),
    silhouette: silhouette(pts, assign),
    centroids,
  };
}

/**
 * Mean silhouette coefficient. Near 0 means the split is arbitrary - one
 * workload that 2-means cut in half anyway. Above ~0.5 means the two groups
 * really are separated in feature space.
 */
export function silhouette(pts: number[][], assign: number[]): number {
  const groups: number[][][] = [[], []];
  for (let i = 0; i < pts.length; i++) groups[assign[i]].push(pts[i]);
  if (groups[0].length === 0 || groups[1].length === 0) return 0;

  const scores: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const own = groups[assign[i]];
    const other = groups[1 - assign[i]];
    if (own.length < 2) continue;
    let a = 0;
    for (const p of own) a += Math.sqrt(dist2(pts[i], p));
    a /= own.length - 1;
    let b = 0;
    for (const p of other) b += Math.sqrt(dist2(pts[i], p));
    b /= other.length;
    const denom = Math.max(a, b);
    scores.push(denom === 0 ? 0 : (b - a) / denom);
  }
  if (scores.length === 0) return 0;
  return scores.reduce((x, y) => x + y, 0) / scores.length;
}

/** Inter-arrival gaps in seconds for a chronologically sorted set. */
export function gaps(records: UsageRecord[]): number[] {
  const ts = records.map((r) => r.ts).sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < ts.length; i++) out.push((ts[i] - ts[i - 1]) / 1000);
  return out;
}

export function medianTokens(records: UsageRecord[]): { input: number; output: number } {
  return {
    input: Math.round(median(records.map((r) => r.inputTokens))),
    output: Math.round(median(records.map((r) => r.outputTokens))),
  };
}
