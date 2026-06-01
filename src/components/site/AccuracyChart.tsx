// Dependency-free SVG sparkline: line + area fill. Renders rolling
// accuracy across a date series. Inputs already aggregated server-side.

export interface AccuracyPoint {
  date: string;
  accuracy: number;
}

interface Props {
  points: AccuracyPoint[];
}

export function AccuracyChart({ points }: Props) {
  if (points.length === 0) {
    return (
      <p
        className="rounded-xl px-4 py-10 text-center font-body text-[13px]"
        style={{
          background: "var(--bg-card)",
          border: "1px dashed var(--border-soft)",
          color: "var(--ink-soft)",
        }}
      >
        First scored events coming soon.
      </p>
    );
  }

  const W = 600;
  const H = 180;
  const PAD_X = 24;
  const PAD_Y = 16;
  const n = points.length;
  const x = (i: number) =>
    n === 1 ? W / 2 : PAD_X + (i * (W - 2 * PAD_X)) / (n - 1);
  const y = (v: number) => PAD_Y + ((100 - v) * (H - 2 * PAD_Y)) / 100;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.accuracy).toFixed(1)}`)
    .join(" ");
  const areaPath =
    `${linePath} L ${x(n - 1).toFixed(1)} ${H - PAD_Y} L ${x(0).toFixed(1)} ${H - PAD_Y} Z`;

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const labels =
    n <= 2
      ? points.map((p) => fmt(p.date))
      : [fmt(points[0].date), fmt(points[Math.floor(n / 2)].date), fmt(points[n - 1].date)];

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--bg-card)",
        border: "1.5px solid var(--border-strong)",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="180"
        preserveAspectRatio="none"
        aria-label="Accuracy over the last 30 days"
        role="img"
      >
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={y(50)}
          y2={y(50)}
          stroke="var(--border-soft)"
          strokeDasharray="3 4"
        />
        <path d={areaPath} fill="var(--amber)" opacity={0.18} />
        <path
          d={linePath}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.accuracy)}
            r={2.5}
            fill="var(--amber-strong)"
          />
        ))}
        <text
          x={PAD_X}
          y={PAD_Y - 4}
          fontSize="10"
          fontFamily="var(--font-mono)"
          fill="var(--ink-faint)"
        >
          100%
        </text>
        <text
          x={PAD_X}
          y={H - 4}
          fontSize="10"
          fontFamily="var(--font-mono)"
          fill="var(--ink-faint)"
        >
          0%
        </text>
      </svg>
      <div
        className="mt-2 flex justify-between font-mono text-[10px]"
        style={{ color: "var(--ink-faint)" }}
      >
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}
