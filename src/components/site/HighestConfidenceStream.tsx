import { useNavigate } from "@tanstack/react-router";
import type { HomepagePick } from "@/lib/queries";

interface Props {
  picks: HomepagePick[];
}

export function HighestConfidenceStream({ picks }: Props) {
  if (picks.length === 0) return null;
  return (
    <section>
      <div
        className="entry-animate mb-2 flex items-center gap-2.5 px-4"
        data-stagger="0"
      >
        <div
          className="font-mono text-[10px] font-semibold uppercase"
          style={{ letterSpacing: "0.22em", color: "var(--amber-2)" }}
        >
          Highest Confidence
        </div>
        <div className="h-px flex-1" style={{ background: "var(--line)" }} />
      </div>
      <div className="conf-stream">
        {picks.map((p, i) => (
          <StreamCard
            key={p.event_id}
            pick={p}
            stagger={Math.min(i + 1, 4)}
          />
        ))}
      </div>
    </section>
  );
}

function StreamCard({ pick, stagger }: { pick: HomepagePick; stagger: number }) {
  const navigate = useNavigate();
  const pct = pick.top_pick_pct != null ? Math.round(pick.top_pick_pct) : null;

  return (
    <button
      type="button"
      onClick={() =>
        navigate({
          to: "/$domain/events/$slug",
          params: { domain: pick.domain, slug: pick.slug },
        })
      }
      className="conf-card pressable entry-animate text-left"
      data-stagger={stagger}
      style={{
        flex: "0 0 160px",
        scrollSnapAlign: "start",
        minHeight: 108,
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        boxShadow: "var(--shadow-sm)",
        padding: "12px 13px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="mb-1.5 truncate font-mono text-[8.5px] font-bold uppercase"
        style={{ letterSpacing: "0.2em", color: "var(--amber-2)" }}
      >
        {pick.domain.toUpperCase()}
      </div>
      <div
        className="font-body line-clamp-2"
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.22,
          color: "var(--ink)",
        }}
      >
        {pick.title}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        <div
          className="min-w-0 truncate font-body"
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--ink)",
            maxWidth: 80,
          }}
        >
          {pick.top_pick_label ?? "—"}
        </div>
        {pct != null && (
          <div
            className="font-mono"
            style={{
              fontSize: 19,
              fontWeight: 600,
              lineHeight: 1,
              color: "var(--amber)",
              fontFeatureSettings: "'tnum'",
              letterSpacing: "-0.03em",
            }}
          >
            {pct}
            <span style={{ fontSize: 10 }}>%</span>
          </div>
        )}
      </div>
    </button>
  );
}
