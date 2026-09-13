import type { ClusterSummary } from '../lib/types';

/**
 * Two 24-hour histograms overlaid on the same axis. This is the single most
 * legible view of a second tenant: your traffic has a working day, theirs has
 * a different one.
 */
export function HourClock({ clusters }: { clusters: ClusterSummary[] }) {
  const W = 720;
  const H = 150;
  const padL = 34;
  const padB = 22;
  const padT = 10;
  const innerW = W - padL - 10;
  const innerH = H - padB - padT;

  const max = Math.max(1, ...clusters.flatMap((c) => c.hours));
  const barW = innerW / 24;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="clock" role="img"
      aria-label="Requests by hour of day, UTC, for each detected group">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padL} x2={W - 10} y1={padT + innerH * (1 - f)} y2={padT + innerH * (1 - f)}
          className="grid" />
      ))}
      <text x={4} y={padT + 8} className="axis">{max}</text>
      <text x={4} y={padT + innerH} className="axis">0</text>

      {clusters.map((c) =>
        c.hours.map((v, h) => {
          const bh = (v / max) * innerH;
          const inset = c.id === 0 ? 0 : barW * 0.38;
          return (
            <rect
              key={`${c.id}-${h}`}
              x={padL + h * barW + inset + 1}
              y={padT + innerH - bh}
              width={barW * 0.6 - 1}
              height={bh}
              className={`bar g${c.id}`}
            />
          );
        }),
      )}

      {[0, 4, 8, 12, 16, 20].map((h) => (
        <text key={h} x={padL + h * barW + barW / 2} y={H - 6} className="axis mid">
          {String(h).padStart(2, '0')}
        </text>
      ))}
      <text x={W - 10} y={H - 6} className="axis end">UTC</text>
    </svg>
  );
}
