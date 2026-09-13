import type { UsageRecord, Verdict, SignalResult, SignalId } from './types';
import { cluster2 } from './cluster';
import {
  cadenceSignal,
  circadianSignal,
  modelMixSignal,
  shapeSignal,
  spanDays,
  summarise,
  weekendSignal,
} from './signals';

/** Below this many requests, or this many days, no verdict is offered. */
export const MIN_RECORDS = 40;
export const MIN_SPAN_DAYS = 3;

/**
 * The central distinction this tool makes.
 *
 * SEPARATION signals are about *rhythm* - when traffic arrives and how evenly.
 * They establish that two workloads exist. They do not say whose.
 *
 * FINGERPRINT signals are about *identity* - what the requests are made of.
 * A workload that runs at a strange hour but sends your shape of request, to
 * your models, is almost certainly your own scheduled job. A workload whose
 * requests look nothing like yours is the one worth an incident ticket.
 *
 * Collapsing these into a single score is how a detector ends up accusing a
 * nightly batch summariser of being an intruder.
 */
const SEPARATION_WEIGHTS: Partial<Record<SignalId, number>> = {
  circadian: 0.4,
  cadence: 0.35,
  weekend: 0.25,
};

const FINGERPRINT_WEIGHTS: Partial<Record<SignalId, number>> = {
  shape: 0.65,
  modelMix: 0.35,
};

/** Below this, the two groups are one workload that 2-means cut in half. */
const SEPARATION_FLOOR = 0.35;
/** Below this, the second workload carries your own fingerprint. */
const FOREIGN_FLOOR = 0.4;
/** Silhouette at which the clustering is trusted completely. */
const TRUSTED_SILHOUETTE = 0.45;

function weigh(signals: SignalResult[], weights: Partial<Record<SignalId, number>>): number {
  let total = 0;
  for (const s of signals) {
    const w = weights[s.id];
    if (w !== undefined) total += s.score * w;
  }
  return total;
}

export function analyse(records: UsageRecord[]): Verdict {
  const span = spanDays(records.map((r) => ({ ...r, cluster: 0 })));

  if (records.length < MIN_RECORDS || span < MIN_SPAN_DAYS) {
    return {
      level: 'single',
      headline: 'Not enough data to judge',
      confidence: 0,
      signals: [],
      clusters: [],
      insufficient: true,
      separation: 0,
    };
  }

  const { labelled, silhouette } = cluster2(records);
  const ra = labelled.filter((r) => r.cluster === 0);
  const rb = labelled.filter((r) => r.cluster === 1);

  // A split where one side is a handful of outliers is not a second workload.
  const minorityShare = Math.min(ra.length, rb.length) / labelled.length;
  if (minorityShare < 0.05 || rb.length === 0) {
    return {
      level: 'single',
      headline: 'One workload',
      confidence: 0,
      signals: [],
      clusters: [summarise(labelled, 0, labelled.length)],
      insufficient: false,
      separation: Math.max(0, silhouette),
    };
  }

  const a = summarise(ra, 0, labelled.length);
  const b = summarise(rb, 1, labelled.length);

  const signals: SignalResult[] = [
    circadianSignal(a, b),
    cadenceSignal(a, b),
    shapeSignal(a, b),
    weekendSignal(a, b),
    modelMixSignal(ra, rb),
  ];

  // Geometric separation gates the rhythm evidence: strong per-signal scores
  // across a split the clusterer had to invent are not evidence of anything.
  const geometric = Math.max(0, silhouette);
  const gate = Math.min(1, geometric / TRUSTED_SILHOUETTE);
  const separationScore = weigh(signals, SEPARATION_WEIGHTS) * gate;
  const foreignScore = weigh(signals, FINGERPRINT_WEIGHTS);

  let level: Verdict['level'];
  let headline: string;
  if (separationScore < SEPARATION_FLOOR) {
    level = 'single';
    headline = 'One workload';
  } else if (foreignScore < FOREIGN_FLOOR) {
    level = 'possible';
    headline = 'A second workload — but it looks like yours';
  } else {
    level = 'two';
    headline = 'Two distinct workloads on this key';
  }

  const confidence =
    level === 'single'
      ? Math.round(separationScore * 100)
      : Math.round(separationScore * (0.45 + 0.55 * foreignScore) * 100);

  return {
    level,
    headline,
    confidence,
    signals: signals.sort((x, y) => y.score - x.score),
    clusters: [a, b],
    insufficient: false,
    separation: geometric,
  };
}

/** Exposed for the UI so it can label the two evidence families. */
export function signalFamily(id: SignalId): 'separation' | 'fingerprint' {
  return SEPARATION_WEIGHTS[id] !== undefined ? 'separation' : 'fingerprint';
}
