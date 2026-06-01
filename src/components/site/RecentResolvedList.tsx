import { Link } from "@tanstack/react-router";
import type { RecentResolved } from "@/lib/queries";

export function RecentResolvedList({ calls }: { calls: RecentResolved[] }) {
  if (calls.length === 0) {
    return (
      <p
        className="rounded-xl px-4 py-6 text-center font-body text-[13px]"
        style={{
          background: "var(--bg-card)",
          border: "1px dashed var(--border-soft)",
          color: "var(--ink-soft)",
        }}
      >
        No resolved events yet — check back soon.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {calls.map((c, i) => {
        const pct = c.top_pick_pct != null ? Math.round(Number(c.top_pick_pct)) : null;
        return (
          <Link
            key={c.event_id}
            to="/$domain/events/$slug"
            params={{ domain: c.domain, slug: c.slug }}
            className="flex items-start gap-3 py-3"
            style={{
              borderBottom:
                i < calls.length - 1 ? "1px solid var(--border-soft)" : "none",
            }}
          >
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white"
              style={{
                background: c.correct ? "var(--green)" : "var(--amber-strong)",
              }}
              aria-label={c.correct ? "Correct" : "Incorrect"}
            >
              {c.correct ? "✓" : "✗"}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className="truncate font-display text-[14px] leading-snug"
                style={{ fontWeight: 600 }}
              >
                {c.title}
              </div>
              <div
                className="mt-0.5 truncate font-body text-[12px]"
                style={{ color: "var(--ink-soft)" }}
              >
                Prophiq said:{" "}
                <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                  {c.top_pick_label ?? "—"}
                </span>
                {pct != null && ` (${pct}%)`}
              </div>
              <div
                className="truncate font-body text-[12px]"
                style={{ color: "var(--ink-soft)" }}
              >
                Actual:{" "}
                <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                  {c.actual_outcome ?? "—"}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
