import { useNavigate } from "@tanstack/react-router";
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
        display: "grid",
        gridTemplateRows: "auto auto auto auto",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          minWidth: 0,
        }}
      >
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.22em",
            color: "var(--amber-2)",
            textTransform: "uppercase",
          }}
        >
          FEATURED · {pick.domain.toUpperCase()}
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

      <div
        className="font-body"
        style={{
          fontSize: 17,
          fontWeight: 600,
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {pick.title}
      </div>

      <div
        className="font-body"
        style={{
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {pick.top_pick_label ?? "—"}
      </div>

      {pct != null && (
        <div
          style={{
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
