import { describe, it, expect } from 'vitest';
import { FIXTURES, fixtureById } from '../fixtures';

describe('fixtures', () => {
  it('exposes three scenarios with unique ids', () => {
    expect(FIXTURES).toHaveLength(3);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(3);
  });

  it('is deterministic - same seed, same bytes', () => {
    for (const f of FIXTURES) {
      expect(f.build()).toEqual(f.build());
    }
  });

  it('produces enough data to be judged', () => {
    for (const f of FIXTURES) {
      const rs = f.build();
      expect(rs.length).toBeGreaterThan(200);
      const span = (rs[rs.length - 1].ts - rs[0].ts) / 86_400_000;
      expect(span).toBeGreaterThan(14);
    }
  });

  it('returns records already in chronological order', () => {
    for (const f of FIXTURES) {
      const rs = f.build();
      for (let i = 1; i < rs.length; i++) {
        expect(rs[i].ts).toBeGreaterThanOrEqual(rs[i - 1].ts);
      }
    }
  });

  it('emits only non-negative token counts', () => {
    for (const f of FIXTURES) {
      for (const r of f.build()) {
        expect(r.inputTokens).toBeGreaterThan(0);
        expect(r.outputTokens).toBeGreaterThan(0);
      }
    }
  });

  it('makes the leaked key strictly bigger than the healthy one', () => {
    const clean = fixtureById('clean')!.build().length;
    const leaked = fixtureById('compromised')!.build().length;
    expect(leaked).toBeGreaterThan(clean);
  });

  it('looks up by id and returns undefined for a stranger', () => {
    expect(fixtureById('clean')?.name).toBe('Healthy key');
    expect(fixtureById('nope')).toBeUndefined();
  });
});
