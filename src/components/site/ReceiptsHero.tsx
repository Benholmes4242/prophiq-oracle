interface Stat {
  label: string;
  value: string | number;
  highlight?: boolean;
}

interface ReceiptsHeroProps {
  eventsScored: number;
  topPickHitRate: number;
  topThreeHitRate: number;
}

function StatCard({ stat, big = false }: { stat: Stat; big?: boolean }) {
  return (
    <div
      className="flex flex-col justify-between rounded-2xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1.5px solid var(--border-strong)",
        minHeight: big ? 168 : 80,
      }}
    >
      <div
        className="font-display tracking-[-0.03em]"
        style={{
          fontWeight: 600,
          color: stat.highlight ? "var(--amber)" : "var(--ink)",
          fontSize: big ? 52 : 32,
          lineHeight: 1,
        }}
      >
        {stat.value}
      </div>
      <div
        className="mt-3 font-mono text-[10px] tracking-[0.2em]"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        {stat.label}
      </div>
    </div>
  );
}

export function ReceiptsHero({
  eventsScored,
  topPickHitRate,
  topThreeHitRate,
}: ReceiptsHeroProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-3 sm:col-span-2">
        <StatCard
          big
          stat={{ label: "EVENTS SCORED", value: eventsScored }}
        />
      </div>
      <div className="col-span-3 grid grid-cols-2 gap-3 sm:col-span-1 sm:grid-cols-1">
        <StatCard
          stat={{
            label: "TOP PICK HIT RATE",
            value: `${topPickHitRate}%`,
            highlight: topPickHitRate >= 60,
          }}
        />
        <StatCard
          stat={{
            label: "TOP-3 HIT RATE",
            value: `${topThreeHitRate}%`,
            highlight: topThreeHitRate >= 60,
          }}
        />
      </div>
    </div>
  );
}
