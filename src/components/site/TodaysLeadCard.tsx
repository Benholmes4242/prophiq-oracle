import { Link } from "@tanstack/react-router";
import { ConfidenceLabel } from "./ConfidenceLabel";
import type { HomepagePick } from "@/lib/queries";
import { DOMAIN_LABEL } from "@/lib/types";

export function TodaysLeadCard({ pick }: { pick: HomepagePick }) {
  const pct = pick.top_pick_pct != null ? Math.round(pick.top_pick_pct) : null;
  const label = DOMAIN_LABEL[pick.domain] ?? pick.domain.toUpperCase();
  const eyebrow = pick.is_marquee ? "TODAY'S LEAD" : "TOP OF THE FEED";
  const reasoning = pick.reasoning_excerpt?.split(/(?<=\.)\s/)[0] ?? null;

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--bg-card)",
        border: "1.5px solid var(--border-strong)",
      }}
    >
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <span
          className="font-mono text-[10px] tracking-[0.2em]"
          style={{ color: "var(--amber-strong)", fontWeight: 600 }}
        >
          {eyebrow} · {label.toUpperCase()}
        </span>
        <ConfidenceLabel tier={pick.confidence} />
      </div>

      <div className="px-5 pt-2">
        <h2
          className="font-display text-[22px] leading-[1.12] tracking-[-0.02em] sm:text-[24px]"
          style={{ fontWeight: 600 }}
        >
          {pick.question || pick.title}
        </h2>
      </div>

      <div className="flex items-end justify-between gap-4 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <div
            className="mb-1 font-mono text-[10px] tracking-[0.18em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            TOP PICK
          </div>
          <div
            className="font-display text-[20px] leading-tight"
            style={{ fontWeight: 600 }}
          >
            {pick.top_pick_label ?? "—"}
          </div>
        </div>
        {pct != null && (
          <div
            className="font-mono leading-none tracking-[-0.03em]"
            style={{ color: "var(--amber)", fontWeight: 600, fontSize: 44 }}
          >
            {pct}
            <span className="text-[24px]">%</span>
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
          className="font-body text-[13px] leading-snug"
          style={{ color: "var(--ink-soft)" }}
        >
          {reasoning ?? "Reasoning loading…"}
        </p>
        <Link
          to="/$domain/events/$slug"
          params={{ domain: pick.domain, slug: pick.slug }}
          className="shrink-0 font-body text-[13px]"
          style={{ color: "var(--amber-strong)", fontWeight: 600 }}
        >
          See why →
        </Link>
      </div>
    </div>
  );
}
