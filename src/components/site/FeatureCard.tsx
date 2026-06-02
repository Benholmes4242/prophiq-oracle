import { useNavigate } from "@tanstack/react-router";
import { ConfidenceLabel } from "@/components/site/ConfidenceLabel";
import type { HomepagePick } from "@/lib/queries";

interface Props {
  pick: HomepagePick;
  stagger?: number;
}

export function FeatureCard({ pick, stagger = 1 }: Props) {
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
      className="pressable entry-animate w-full text-left"
      data-stagger={stagger}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        boxShadow: "var(--shadow-card)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className="truncate font-mono text-[10px] font-bold uppercase"
          style={{ letterSpacing: "0.2em", color: "var(--amber-2)" }}
        >
          FEATURED · {pick.domain.toUpperCase()}
        </div>
        <ConfidenceLabel tier={pick.confidence} compact />
      </div>

      <div
        className="font-body"
        style={{
          fontSize: 17,
          fontWeight: 600,
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
          margin: "8px 0 12px",
        }}
      >
        {pick.title}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div
          className="min-w-0 font-body"
          style={{
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
          }}
        >
          {pick.top_pick_label ?? "—"}
        </div>
        {pct != null && (
          <div
            className="font-mono shrink-0"
            style={{
              fontSize: 32,
              fontWeight: 600,
              lineHeight: 0.95,
              letterSpacing: "-0.04em",
              color: "var(--amber)",
              fontFeatureSettings: "'tnum'",
            }}
          >
            {pct}
            <span style={{ fontSize: 15 }}>%</span>
          </div>
        )}
      </div>

      {pct != null && (
        <div
          style={{
            marginTop: 10,
            height: 3,
            background: "var(--line)",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, var(--amber), var(--amber-2))",
              borderRadius: 999,
              transition: "width 600ms var(--ease-ios)",
            }}
          />
        </div>
      )}
    </button>
  );
}
