import type { LabelledRecord, SignalResult, ClusterSummary } from './types';
import {
  circularMeanHour,
  clamp01,
  hourDistance,
  jensenShannon,
  quartileDispersion,
} from './stats';
import { gaps, medianTokens } from './cluster';

const DAY_MS = 86_400_000;

function hoursOf(rs: LabelledRecord[]): number[] {
  return rs.map((r) => new Date(r.ts).getUTCHours() + new Date(r.ts).getUTCMinutes() / 60);
}

function hourHistogram(rs: LabelledRecord[]): number[] {
  const bins = new Array(24).fill(0);
  for (const r of rs) bins[new Date(r.ts).getUTCHours()]++;
  return bins;
}

function weekendShare(rs: LabelledRecord[]): number {
  if (rs.length === 0) return 0;
  const w = rs.filter((r) => {
    const d = new Date(r.ts).getUTCDay();
    return d === 0 || d === 6;
  }).length;
  return w / rs.length;
}

function modelCounts(rs: LabelledRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rs) m.set(r.model, (m.get(r.model) ?? 0) + 1);
  return m;
}

export function summarise(rs: LabelledRecord[], id: number, total: number): ClusterSummary {
  const tok = medianTokens(rs);
  const counts = modelCounts(rs);
  const topModels = [...counts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
    .slice(0, 3);
  return {
    id,
    count: rs.length,
    share: total === 0 ? 0 : rs.length / total,
    peakHour: circularMeanHour(hoursOf(rs)),
    medianInput: tok.input,
    medianOutput: tok.output,
    topModels,
    cadenceDispersion: quartileDispersion(gaps(rs)),
    weekendShare: weekendShare(rs),
    hours: hourHistogram(rs),
  };
}

function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} UTC`;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

/** 1 - clock separation between the two clusters' busy hours. */
export function circadianSignal(a: ClusterSummary, b: ClusterSummary): SignalResult {
  const d = hourDistance(a.peakHour, b.peakHour);
  const score = clamp01(d / 8);
  return {
    id: 'circadian',
    label: 'Circadian split',
    score,
    finding:
      d < 2
        ? `Both groups are busiest at about the same time of day (${d.toFixed(1)}h apart).`
        : `The two groups peak ${d.toFixed(1)} hours apart on the clock — consistent with two different working days.`,
    detail: [
      { k: 'Group A busiest', v: fmtHour(a.peakHour) },
      { k: 'Group B busiest', v: fmtHour(b.peakHour) },
      { k: 'Clock separation', v: `${d.toFixed(1)} h of a possible 12` },
    ],
  };
}

/** Ratio gap between the two groups' median request shapes. */
export function shapeSignal(a: ClusterSummary, b: ClusterSummary): SignalResult {
  const ra = a.medianInput / Math.max(1, a.medianOutput);
  const rb = b.medianInput / Math.max(1, b.medianOutput);
  const fold = Math.max(ra, rb) / Math.max(0.001, Math.min(ra, rb));
  const inFold =
    Math.max(a.medianInput, b.medianInput) / Math.max(1, Math.min(a.medianInput, b.medianInput));
  const score = clamp01((Math.log2(fold) + Math.log2(inFold)) / 6);
  return {
    id: 'shape',
    label: 'Request shape',
    score,
    finding:
      score < 0.3
        ? 'Both groups send requests of a similar size and in/out balance.'
        : `Request shapes differ by ${fold.toFixed(1)}x in in/out ratio and ${inFold.toFixed(1)}x in prompt size.`,
    detail: [
      { k: 'Group A median', v: `${a.medianInput} in / ${a.medianOutput} out` },
      { k: 'Group B median', v: `${b.medianInput} in / ${b.medianOutput} out` },
      { k: 'In:out ratio gap', v: `${fold.toFixed(2)}x` },
    ],
  };
}

/** Jensen-Shannon divergence between the two groups' model mixes. */
export function modelMixSignal(
  ra: LabelledRecord[],
  rb: LabelledRecord[],
): SignalResult {
  const ca = modelCounts(ra);
  const cb = modelCounts(rb);
  const keys = [...new Set([...ca.keys(), ...cb.keys()])].sort();
  const js = jensenShannon(
    keys.map((k) => ca.get(k) ?? 0),
    keys.map((k) => cb.get(k) ?? 0),
  );
  const onlyB = keys.filter((k) => (cb.get(k) ?? 0) > 0 && (ca.get(k) ?? 0) === 0);
  return {
    id: 'modelMix',
    label: 'Model mix',
    score: clamp01(js),
    finding:
      onlyB.length > 0
        ? `Group B uses ${onlyB.length} model(s) group A never touches: ${onlyB.join(', ')}.`
        : js < 0.2
          ? 'Both groups use the same models in similar proportions.'
          : 'Both groups use the same models, but in noticeably different proportions.',
    detail: [
      { k: 'Distinct models', v: String(keys.length) },
      { k: 'Mix divergence', v: `${(js * 100).toFixed(0)} / 100` },
      { k: 'Exclusive to B', v: onlyB.length ? onlyB.join(', ') : 'none' },
    ],
  };
}

/**
 * Scripted traffic is metronomic. A low coefficient of variation on
 * inter-arrival gaps in one group but not the other is a strong tell.
 */
export function cadenceSignal(a: ClusterSummary, b: ClusterSummary): SignalResult {
  const lo = Math.min(a.cadenceDispersion, b.cadenceDispersion);
  const hi = Math.max(a.cadenceDispersion, b.cadenceDispersion);
  const machineLike = lo < 0.2 && hi > 0.45;
  const score = clamp01(machineLike ? 0.6 + (hi - lo) : (hi - lo) * 1.4);
  const which = a.cadenceDispersion < b.cadenceDispersion ? 'A' : 'B';
  return {
    id: 'cadence',
    label: 'Arrival cadence',
    score,
    finding: machineLike
      ? `Group ${which} arrives on a near-fixed interval (dispersion ${lo.toFixed(2)}) while the other is hand-driven (${hi.toFixed(2)}) \u2014 one looks scheduled, the other typed.`
      : hi - lo > 0.2
        ? `Group ${which} arrives noticeably more regularly than the other (${lo.toFixed(2)} vs ${hi.toFixed(2)}).`
        : 'Both groups arrive with similar irregularity.',
    detail: [
      { k: 'Group A gap dispersion', v: a.cadenceDispersion.toFixed(2) },
      { k: 'Group B gap dispersion', v: b.cadenceDispersion.toFixed(2) },
      { k: 'Reference', v: '0.00 = clockwork, 1.00 = wildly bursty' },
    ],
  };
}

/** One group rests at the weekend and the other does not. */
export function weekendSignal(a: ClusterSummary, b: ClusterSummary): SignalResult {
  const d = Math.abs(a.weekendShare - b.weekendShare);
  return {
    id: 'weekend',
    label: 'Weekend rhythm',
    score: clamp01(d / 0.3),
    finding:
      d < 0.08
        ? 'Both groups keep the same weekday/weekend rhythm.'
        : `Weekend share differs by ${pct(d)} — one group keeps working when the other stops.`,
    detail: [
      { k: 'Group A weekend', v: pct(a.weekendShare) },
      { k: 'Group B weekend', v: pct(b.weekendShare) },
      { k: 'Expected if one team', v: 'within a few points' },
    ],
  };
}

export function spanDays(rs: LabelledRecord[]): number {
  if (rs.length < 2) return 0;
  const ts = rs.map((r) => r.ts);
  return (Math.max(...ts) - Math.min(...ts)) / DAY_MS;
}
