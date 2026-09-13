import { describe, it, expect } from 'vitest';
import { analyse, MIN_RECORDS } from '../verdict';
import { FIXTURES, fixtureById } from '../fixtures';
import type { UsageRecord } from '../types';

const H = 3_600_000;
const D = 86_400_000;
const BASE = Date.UTC(2026, 7, 24, 0, 0, 0);

function run(id: string) {
  const f = fixtureById(id);
  if (!f) throw new Error(`missing fixture ${id}`);
  return analyse(f.build());
}

describe('guard rails', () => {
  it('refuses to judge too few records', () => {
    const rs: UsageRecord[] = Array.from({ length: MIN_RECORDS - 1 }, (_, i) => ({
      ts: BASE + i * H,
      model: 'm',
      inputTokens: 100,
      outputTokens: 100,
    }));
    const v = analyse(rs);
    expect(v.insufficient).toBe(true);
    expect(v.confidence).toBe(0);
  });

  it('refuses to judge a window shorter than a few days', () => {
    const rs: UsageRecord[] = Array.from({ length: 200 }, (_, i) => ({
      ts: BASE + i * 60_000,
      model: 'm',
      inputTokens: 100,
      outputTokens: 100,
    }));
    const v = analyse(rs);
    expect(v.insufficient).toBe(true);
  });

  it('does not treat a handful of outliers as a second tenant', () => {
    const rs: UsageRecord[] = [];
    for (let d = 0; d < 14; d++) {
      for (let i = 0; i < 20; i++) {
        rs.push({
          ts: BASE + d * D + (10 + (i % 6)) * H + i * 1000,
          model: 'gpt-4o-mini',
          inputTokens: 700 + (i % 11) * 40,
          outputTokens: 380 + (i % 9) * 25,
        });
      }
    }
    rs.push({ ts: BASE + 3 * D + 2 * H, model: 'gpt-4o', inputTokens: 90, outputTokens: 4000 });
    const v = analyse(rs);
    expect(v.level).toBe('single');
  });
});

describe('fixture verdicts', () => {
  it('reads the healthy key as a single workload', () => {
    const v = run('clean');
    expect(v.insufficient).toBe(false);
    expect(v.level).toBe('single');
  });

  it('reads the leaked key as two distinct workloads', () => {
    const v = run('compromised');
    expect(v.insufficient).toBe(false);
    expect(v.level).toBe('two');
    expect(v.confidence).toBeGreaterThanOrEqual(55);
    expect(v.clusters).toHaveLength(2);
  });

  it('finds the nightly batch but declines to call it foreign', () => {
    const v = run('batch');
    expect(v.insufficient).toBe(false);
    expect(v.level).toBe('possible');
    expect(v.headline).toMatch(/looks like yours/);
  });

  it('reports matching fingerprints for the nightly batch', () => {
    const v = run('batch');
    expect(v.signals.find((s) => s.id === 'shape')!.score).toBeLessThan(0.4);
    expect(v.signals.find((s) => s.id === 'modelMix')!.score).toBeLessThan(0.4);
  });

  it('still detects the odd rhythm of the nightly batch', () => {
    const v = run('batch');
    expect(v.signals.find((s) => s.id === 'circadian')!.score).toBeGreaterThan(0.6);
  });

  it('scores the leaked key strictly higher than the nightly batch', () => {
    expect(run('compromised').confidence).toBeGreaterThan(run('batch').confidence);
  });

  it('scores the nightly batch at least as high as the healthy key', () => {
    expect(run('batch').confidence).toBeGreaterThanOrEqual(run('clean').confidence);
  });
});

describe('evidence quality on the leaked key', () => {
  const v = run('compromised');

  it('surfaces every signal, ordered strongest first', () => {
    expect(v.signals).toHaveLength(5);
    const scores = v.signals.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('keeps every signal score inside [0,1]', () => {
    for (const s of v.signals) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.finding.length).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });

  it('places the two groups far apart on the clock', () => {
    const circadian = v.signals.find((s) => s.id === 'circadian');
    expect(circadian?.score).toBeGreaterThan(0.5);
  });

  it('notices a model the first group never uses', () => {
    const mix = v.signals.find((s) => s.id === 'modelMix');
    expect(mix?.finding).toMatch(/o4-mini/);
  });

  it('splits the traffic into two substantial groups', () => {
    const [a, b] = v.clusters;
    expect(a.share + b.share).toBeCloseTo(1, 6);
    expect(Math.min(a.share, b.share)).toBeGreaterThan(0.1);
  });
});

describe('determinism', () => {
  it('gives identical verdicts for identical input', () => {
    for (const f of FIXTURES) {
      const a = analyse(f.build());
      const b = analyse(f.build());
      expect(a.confidence).toBe(b.confidence);
      expect(a.level).toBe(b.level);
    }
  });

  it('is unaffected by the order rows arrive in', () => {
    const rs = fixtureById('compromised')!.build();
    const shuffled = [...rs].reverse();
    expect(analyse(shuffled).level).toBe(analyse(rs).level);
  });
});
