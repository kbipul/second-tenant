import type { UsageRecord } from './types';

/**
 * Deterministic sample datasets. Everything is synthetic and generated from a
 * fixed seed, so the demo shows the same thing to every visitor and the tests
 * can assert on exact verdicts. No real usage data is shipped in this repo.
 */

export interface Fixture {
  id: string;
  name: string;
  blurb: string;
  /** What an honest tool should say about it. */
  expectation: string;
  build: () => UsageRecord[];
}

/** mulberry32 - tiny, fast, fully deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = Date.UTC(2026, 7, 24, 0, 0, 0); // Mon 24 Aug 2026, UTC
const DAYS = 21;
const DAY = 86_400_000;
const HOUR = 3_600_000;

function isWeekend(dayIndex: number): boolean {
  const dow = new Date(START + dayIndex * DAY).getUTCDay();
  return dow === 0 || dow === 6;
}

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length) % xs.length];
}

function jitter(r: () => number, base: number, spread: number): number {
  return Math.max(1, Math.round(base * (1 + (r() - 0.5) * 2 * spread)));
}

/**
 * A human team: bursty, clustered in the working day, quiet at weekends,
 * request sizes spread over a wide range.
 */
function humanTeam(seed: number, perDay: number): UsageRecord[] {
  const r = rng(seed);
  const out: UsageRecord[] = [];
  const models = ['gpt-4o-mini', 'gpt-4o-mini', 'gpt-4o-mini', 'gpt-4o'];
  for (let d = 0; d < DAYS; d++) {
    const weekend = isWeekend(d);
    const n = weekend ? Math.round(perDay * 0.08) : jitter(r, perDay, 0.35);
    for (let i = 0; i < n; i++) {
      // Working day centred on 13:00 UTC, tails into morning and evening.
      const hour = 9 + (r() + r() + r()) / 3 * 9; // 9..18, bell-ish
      const ts = START + d * DAY + hour * HOUR + r() * 45 * 60_000;
      // Bursty: many small chat turns, occasional big document paste.
      const big = r() < 0.18;
      const inTok = big ? jitter(r, 5200, 0.5) : jitter(r, 780, 0.7);
      const outTok = jitter(r, 430, 0.8);
      out.push({ ts, model: pick(r, models), inputTokens: inTok, outputTokens: outTok });
    }
  }
  return out;
}

/**
 * A squatter on a stolen key: another timezone, scheduled rather than
 * hand-driven, doesn't stop at the weekend, and generating far more than it
 * reads - the shape of bulk content production, not of a team asking questions.
 */
function squatter(seed: number): UsageRecord[] {
  const r = rng(seed);
  const out: UsageRecord[] = [];
  const models = ['gpt-4o', 'o4-mini', 'o4-mini'];
  for (let d = 0; d < DAYS; d++) {
    // Runs 19:00-03:00 UTC, near-constant rate, weekends included.
    const n = jitter(r, 34, 0.12);
    for (let i = 0; i < n; i++) {
      const slot = (i / n) * 8; // spread evenly across an 8h window
      const hour = 19 + slot;
      const ts =
        START + d * DAY + hour * HOUR + (r() - 0.5) * 90_000; // +/- 45s of metronome
      out.push({
        ts,
        model: pick(r, models),
        inputTokens: jitter(r, 150, 0.18),
        outputTokens: jitter(r, 1850, 0.16),
      });
    }
  }
  return out;
}

/**
 * The team's OWN scheduled job: same key, same models, same kind of content,
 * but it runs at 02:00 and it runs every night. Circadian and cadence both
 * fire. Shape and model mix do not. This is the case a naive detector calls
 * a breach.
 */
function nightlyBatch(seed: number): UsageRecord[] {
  const r = rng(seed);
  const out: UsageRecord[] = [];
  const models = ['gpt-4o-mini', 'gpt-4o-mini', 'gpt-4o-mini', 'gpt-4o'];
  for (let d = 0; d < DAYS; d++) {
    const n = jitter(r, 26, 0.1);
    for (let i = 0; i < n; i++) {
      const ts = START + d * DAY + 2 * HOUR + i * 70_000 + (r() - 0.5) * 20_000;
      // Same corpus, same prompts, same models as the team - only the clock differs.
      const big = r() < 0.18;
      out.push({
        ts,
        model: pick(r, models),
        inputTokens: big ? jitter(r, 5200, 0.5) : jitter(r, 780, 0.7),
        outputTokens: jitter(r, 430, 0.8),
      });
    }
  }
  return out;
}

function sorted(rs: UsageRecord[]): UsageRecord[] {
  return [...rs].sort((a, b) => a.ts - b.ts);
}

export const FIXTURES: Fixture[] = [
  {
    id: 'clean',
    name: 'Healthy key',
    blurb: 'One product team, one timezone, three weeks of traffic.',
    expectation: 'Should read as a single workload.',
    build: () => sorted(humanTeam(11, 46)),
  },
  {
    id: 'compromised',
    name: 'Leaked key',
    blurb:
      'The same team, plus someone else running a scheduled job on the key from another timezone.',
    expectation: 'Should read as two distinct workloads.',
    build: () => sorted([...humanTeam(11, 46), ...squatter(97)]),
  },
  {
    id: 'batch',
    name: 'Your own nightly job',
    blurb:
      'The same team, plus their own 02:00 batch summariser. Off-hours and metronomic — but theirs.',
    expectation:
      'Should find a second workload but decline to call it foreign: the rhythm is odd, the fingerprint is not.',
    build: () => sorted([...humanTeam(11, 46), ...nightlyBatch(53)]),
  },
];

export function fixtureById(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}
