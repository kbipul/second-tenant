import type { LabelledRecord } from '../lib/types';

/**
 * Every request as a point: prompt tokens against completion tokens, both on a
 * log axis. Two tenants usually occupy two different regions of this plane,
 * and one tenant with a batch job occupies one.
 */
export function ShapeScatter({ records }: { records: LabelledRecord[] }) {
  const W = 340;
  const H = 260;
  const pad = 34;

  const lx = (v: number) => Math.log10(Math.max(1, v));
  const xs = records.map((r) => lx(r.inputTokens));
  const ys = records.map((r) => lx(r.outputTokens));
  const x0 = Math.min(...xs, 1);
  const x1 = Math.max(...xs, 2);
  const y0 = Math.min(...ys, 1);
  const y1 = Math.max(...ys, 2);

  const px = (v: number) => pad + ((lx(v) - x0) / Math.max(0.001, x1 - x0)) * (W - pad - 12);
  const py = (v: number) => H - pad - ((lx(v) - y0) / Math.max(0.001, y1 - y0)) * (H - pad - 12);

  // Thin dense fixtures so the SVG stays light without hiding either group.
  const step = Math.max(1, Math.floor(records.length / 900));
  const shown = records.filter((_, i) => i % step === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="scatter" role="img"
      aria-label="Prompt tokens against completion tokens for each request">
      <line x1={pad} y1={H - pad} x2={W - 8} y2={H - pad} className="grid" />
      <line x1={pad} y1={8} x2={pad} y2={H - pad} className="grid" />
      {shown.map((r, i) => (
        <circle key={i} cx={px(r.inputTokens)} cy={py(r.outputTokens)} r={1.7}
          className={`pt g${r.cluster}`} />
      ))}
      <text x={W / 2} y={H - 8} className="axis mid">prompt tokens →</text>
      <text x={10} y={16} className="axis">↑ completion</text>
    </svg>
  );
}
