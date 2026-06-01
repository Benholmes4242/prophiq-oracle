import { Link } from "@tanstack/react-router";
import { ConfidenceLabel } from "./ConfidenceLabel";
import type { HomepagePick } from "@/lib/queries";

export function AlsoTodayList({ picks }: { picks: HomepagePick[] }) {
  if (picks.length === 0) {
    return (
      <p
        className="rounded-xl px-4 py-6 text-center font-body text-[13px]"
        style={{
          background: "var(--bg-card)",
          border: "1px dashed var(--border-soft)",
          color: "var(--ink-soft)",
        }}
      >
        More picks generating — check back shortly.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {picks.map((p) => {
        const pct = p.top_pick_pct != null ? Math.round(p.top_pick_pct) : null;
        return (
          <Link
            key={p.event_id}
            to="/$domain/events/$slug"
            params={{ domain: p.domain, slug: p.slug }}
            className="flex items-center gap-3 rounded-xl px-4 py-3.5 transition-colors hover:bg-[var(--bg-tint)]/40"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <div className="min-w-0 flex-1">
              <div
                className="mb-1 font-mono text-[9px] tracking-[0.2em]"
                style={{ color: "var(--amber-strong)", fontWeight: 600 }}
              >
                {p.domain.toUpperCase()}
              </div>
              <div
                className="truncate font-display text-[15px] leading-snug"
                style={{ fontWeight: 600 }}
              >
                {p.title}
              </div>
              <div
                className="mt-0.5 truncate font-body text-[12.5px]"
                style={{ color: "var(--ink-soft)" }}
              >
                {p.top_pick_label ?? "—"}
              </div>
            </div>
            <div className="shrink-0 text-right">
              {pct != null && (
                <div
                  className="font-mono text-[24px] leading-none tracking-tight"
                  style={{ color: "var(--amber)", fontWeight: 600 }}
                >
                  {pct}
                  <span className="text-[14px]">%</span>
                </div>
              )}
              <div className="mt-1.5 flex justify-end">
                <ConfidenceLabel tier={p.confidence} compact />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
