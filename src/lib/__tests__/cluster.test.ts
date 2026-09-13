import { describe, it, expect } from 'vitest';
import { busiestHourOf, cluster2, gaps, medianTokens, silhouette } from '../cluster';
import type { UsageRecord } from '../types';

const H = 3_600_000;
const BASE = Date.UTC(2026, 7, 24, 0, 0, 0);

function rec(hourOffset: number, inTok: number, outTok: number, model = 'm'): UsageRecord {
  return { ts: BASE + hourOffset * H, model, inputTokens: inTok, outputTokens: outTok };
}

describe('busiestHourOf', () => {
  it('finds the modal hour', () => {
    const rs = [rec(9, 1, 1), rec(9, 1, 1), rec(9, 1, 1), rec(14, 1, 1)];
    expect(busiestHourOf(rs)).toBe(9);
  });
});

describe('cluster2', () => {
  it('is deterministic across repeated runs', () => {
    const rs = Array.from({ length: 60 }, (_, i) => rec(i % 24, 100 + i * 7, 50 + i * 3));
    const a = cluster2(rs).labelled.map((r) => r.cluster);
    const b = cluster2(rs).labelled.map((r) => r.cluster);
    expect(a).toEqual(b);
  });

  it('is independent of input ordering', () => {
    const rs = Array.from({ length: 50 }, (_, i) => rec(i % 24, 200 + i * 11, 90 + i * 5));
    const forward = cluster2(rs);
    const reversed = cluster2([...rs].reverse());
    expect(forward.silhouette).toBeCloseTo(reversed.silhouette, 9);
  });

  it('labels the larger group as cluster 0', () => {
    const big = Array.from({ length: 40 }, () => rec(10, 500, 200));
    const small = Array.from({ length: 6 }, () => rec(23, 90, 3000));
    const { labelled } = cluster2([...big, ...small]);
    const n0 = labelled.filter((r) => r.cluster === 0).length;
    expect(n0).toBeGreaterThanOrEqual(labelled.length - n0);
  });

  it('separates two genuinely different workloads', () => {
    const team = Array.from({ length: 40 }, (_, i) => rec(10 + (i % 4), 900 + i * 5, 400));
    const bot = Array.from({ length: 40 }, (_, i) => rec(23 + (i % 2), 120, 1900 + i));
    const { labelled, silhouette: s } = cluster2([...team, ...bot]);
    expect(s).toBeGreaterThan(0.4);
    const teamClusters = new Set(labelled.slice(0, 40).map((r) => r.cluster));
    const botClusters = new Set(labelled.slice(40).map((r) => r.cluster));
    expect(teamClusters.size).toBe(1);
    expect(botClusters.size).toBe(1);
    expect([...teamClusters][0]).not.toBe([...botClusters][0]);
  });

  it('reports weak separation when there is only one real workload', () => {
    // A single smooth cloud: one busy period, token sizes drawn from one
    // continuous spread. Any split here is the clusterer inventing a boundary.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const rs = Array.from({ length: 120 }, () =>
      rec(9 + next() * 9, 400 + next() * 1600, 200 + next() * 600),
    );
    const single = cluster2(rs).silhouette;

    // The same number of points, but drawn from two genuinely separate modes.
    const twoModes = Array.from({ length: 120 }, (_, i) =>
      i % 2 === 0
        ? rec(10 + next() * 2, 900 + next() * 200, 400 + next() * 100)
        : rec(23 + next(), 120 + next() * 30, 1900 + next() * 200),
    );

    expect(cluster2(twoModes).silhouette).toBeGreaterThan(single + 0.15);
  });

  it('degrades safely on tiny inputs', () => {
    expect(cluster2([]).labelled).toHaveLength(0);
    expect(cluster2([rec(1, 1, 1)]).labelled[0].cluster).toBe(0);
  });
});

describe('silhouette', () => {
  it('is zero when one side is empty', () => {
    expect(silhouette([[0], [1]], [0, 0])).toBe(0);
  });

  it('is high for well-separated points', () => {
    const pts = [[0], [0.01], [0.02], [1], [1.01], [1.02]];
    expect(silhouette(pts, [0, 0, 0, 1, 1, 1])).toBeGreaterThan(0.9);
  });
});

describe('gaps and medianTokens', () => {
  it('computes inter-arrival gaps in seconds, in time order', () => {
    const rs = [rec(2, 1, 1), rec(0, 1, 1), rec(1, 1, 1)];
    expect(gaps(rs)).toEqual([3600, 3600]);
  });

  it('returns no gaps for a single record', () => {
    expect(gaps([rec(0, 1, 1)])).toEqual([]);
  });

  it('takes medians of both token columns', () => {
    const rs = [rec(0, 10, 100), rec(1, 20, 200), rec(2, 30, 300)];
    expect(medianTokens(rs)).toEqual({ input: 20, output: 200 });
  });
});
