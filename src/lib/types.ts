/** One row of an API usage export. */
export interface UsageRecord {
  /** Epoch milliseconds, UTC. */
  ts: number;
  /** Model / deployment name as reported by the provider. */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** A record after cluster assignment. */
export interface LabelledRecord extends UsageRecord {
  cluster: number;
}

export interface ParseIssue {
  line: number;
  reason: string;
}

export interface ParseResult {
  records: UsageRecord[];
  issues: ParseIssue[];
  /** Column names the parser mapped, for display. */
  mapping: Record<string, string>;
}

export type SignalId = 'circadian' | 'shape' | 'modelMix' | 'cadence' | 'weekend';

export interface SignalResult {
  id: SignalId;
  label: string;
  /** 0..1 - how strongly this signal indicates a second workload. */
  score: number;
  /** One-line plain-English finding. */
  finding: string;
  /** Supporting numbers, rendered as a small table. */
  detail: Array<{ k: string; v: string }>;
}

export type VerdictLevel = 'single' | 'possible' | 'two';

export interface ClusterSummary {
  id: number;
  count: number;
  share: number;
  /** Circular mean of hour-of-day, UTC. */
  peakHour: number;
  medianInput: number;
  medianOutput: number;
  topModels: Array<{ model: string; count: number }>;
  /** Quartile dispersion of inter-arrival gaps: 0 = clockwork, 1 = wildly bursty. */
  cadenceDispersion: number;
  weekendShare: number;
  hours: number[];
}

export interface Verdict {
  level: VerdictLevel;
  headline: string;
  /** 0..100 */
  confidence: number;
  signals: SignalResult[];
  clusters: ClusterSummary[];
  /** True when the data was too small or too sparse to judge. */
  insufficient: boolean;
  separation: number;
}
