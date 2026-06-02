import { Link } from "@tanstack/react-router";
import type { HomepagePick } from "@/lib/queries";
import { DOMAIN_LABEL } from "@/lib/types";

export function TodaysLeadCard({ pick }: { pick: HomepagePick }) {
  const pct = pick.top_pick_pct != null ? Math.round(pick.top_pick_pct) : null;
  const label = DOMAIN_LABEL[pick.domain] ?? pick.domain;
  const eyebrow = pick.is_marquee ? "Today's lead" : "Top of the feed";
  const reasoning = pick.reasoning_excerpt?.split(/(?<=\.)\s/)[0] ?? null;

  return (
    <Link
      to="/$domain/events/$slug"
      params={{ domain: pick.domain, slug: pick.slug }}
      className="lead-card-hover block overflow-hidden rounded-2xl"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        transition: "border-color 180ms var(--ease-ios)",
      }}
    >
      <div className="px-5 pt-4">
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            fontWeight: 600,
          }}
        >
          {eyebrow} · {label}
        </span>
      </div>

      <div className="px-5 pt-2">
        <h2
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            fontSize: 22,
            lineHeight: 1.18,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
          }}
        >
          {pick.question || pick.title}
        </h2>
      </div>

      <div className="flex items-end justify-between gap-4 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <div
            className="mb-1 font-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
              fontWeight: 600,
            }}
          >
            Top pick
          </div>
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              fontSize: 19,
              lineHeight: 1.2,
              color: "var(--ink)",
            }}
          >
            {pick.top_pick_label ?? "—"}
          </div>
        </div>
        {pct != null && (
          <div
            className="font-mono leading-none"
            style={{
              color: "var(--amber)",
              fontWeight: 600,
              fontSize: 44,
              letterSpacing: "-0.03em",
            }}
          >
            {pct}
            <span style={{ fontSize: 24 }}>%</span>
          </div>
        )}
      </div>

      <div className="px-5 pb-3">
        <div className="prob-bar">
          <span style={{ width: `${pct ?? 0}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-1">
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--ink-soft)",
          }}
        >
          {reasoning ?? "Reasoning loading…"}
        </p>
        <span
          className="shrink-0"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--amber-strong)",
          }}
        >
          See why →
        </span>
      </div>
    </Link>
  );
}
