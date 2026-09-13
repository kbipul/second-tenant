import { describe, it, expect } from 'vitest';
import {
  circularMeanHour,
  clamp01,
  coefficientOfVariation,
  hourDistance,
  jensenShannon,
  mean,
  median,
  quantile,
  quartileDispersion,
  stddev,
} from '../stats';

describe('basic statistics', () => {
  it('computes mean and stddev', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
    expect(stddev([2, 4, 6])).toBeCloseTo(2, 10);
    expect(stddev([5])).toBe(0);
  });

  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5, 10);
    expect(median([3, 1, 2])).toBe(2);
  });
});

describe('coefficientOfVariation', () => {
  it('is zero for a perfectly regular series', () => {
    expect(coefficientOfVariation([60, 60, 60, 60])).toBe(0);
  });

  it('grows with irregularity', () => {
    const regular = coefficientOfVariation([60, 61, 59, 60]);
    const bursty = coefficientOfVariation([2, 400, 5, 900, 3]);
    expect(bursty).toBeGreaterThan(regular);
    expect(bursty).toBeGreaterThan(1);
  });

  it('handles an all-zero series without dividing by zero', () => {
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });
});

describe('circularMeanHour', () => {
  it('averages across midnight correctly', () => {
    // The arithmetic mean of 23 and 1 is 12, which would be wrong.
    const m = circularMeanHour([23, 1]);
    expect(Math.min(m, 24 - m)).toBeLessThan(0.001);
  });

  it('averages a normal working day', () => {
    expect(circularMeanHour([12, 13, 14])).toBeCloseTo(13, 5);
  });

  it('stays within the clock', () => {
    const m = circularMeanHour([0, 6, 12, 18]);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThan(24);
  });
});

describe('hourDistance', () => {
  it('wraps around the clock', () => {
    expect(hourDistance(23, 1)).toBe(2);
    expect(hourDistance(1, 23)).toBe(2);
    expect(hourDistance(0, 12)).toBe(12);
    expect(hourDistance(9, 9)).toBe(0);
  });

  it('never exceeds twelve hours', () => {
    for (let a = 0; a < 24; a++) {
      for (let b = 0; b < 24; b++) {
        expect(hourDistance(a, b)).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('jensenShannon', () => {
  it('is zero for identical distributions', () => {
    expect(jensenShannon([3, 7], [3, 7])).toBeCloseTo(0, 10);
    expect(jensenShannon([3, 7], [30, 70])).toBeCloseTo(0, 10);
  });

  it('is one for disjoint distributions', () => {
    expect(jensenShannon([10, 0], [0, 10])).toBeCloseTo(1, 10);
  });

  it('stays in range for partial overlap', () => {
    const d = jensenShannon([8, 2], [2, 8]);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
});

describe('clamp01', () => {
  it('clamps and defends against NaN', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('quartileDispersion', () => {
  it('is zero for a clockwork series', () => {
    expect(quartileDispersion([70, 70, 70, 70, 70, 70])).toBe(0);
  });

  it('ignores the long gap between nightly sessions', () => {
    // 25 requests 70s apart, then a 23h wait, repeated. A stddev-based
    // measure reads this as chaos; it is in fact a cron job.
    const gaps = [...Array(25).fill(70), 82_800, ...Array(25).fill(70), 82_800];
    expect(quartileDispersion(gaps)).toBeLessThan(0.1);
    expect(coefficientOfVariation(gaps)).toBeGreaterThan(2);
  });

  it('is high for bursty hand-driven traffic', () => {
    const gaps = [3, 900, 12, 40, 2400, 8, 180, 5, 60, 1500, 30, 7];
    expect(quartileDispersion(gaps)).toBeGreaterThan(0.5);
  });

  it('degrades safely on short or empty input', () => {
    expect(quartileDispersion([])).toBe(0);
    expect(quartileDispersion([5, 5])).toBe(0);
    expect(quartileDispersion([0, 0, 0, 0])).toBe(0);
  });
});
