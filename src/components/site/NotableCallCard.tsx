import { Link } from "@tanstack/react-router";
import type { NotableCall } from "@/lib/queries";

export function NotableCallCard({ call }: { call: NotableCall }) {
  const pct =
    call.top_pick_pct != null ? Math.round(Number(call.top_pick_pct)) : null;
  return (
    <Link
      to="/$domain/events/$slug"
      params={{ domain: call.domain, slug: call.slug }}
      className="block rounded-2xl p-5 transition-colors hover:bg-[var(--bg-tint)]/30"
      style={{
        background: "var(--bg-card)",
        border: "1.5px solid var(--border-strong)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-[10px] tracking-[0.2em]"
          style={{ color: "var(--amber-strong)", fontWeight: 600 }}
        >
          {call.correct ? "CALLED THE UPSET" : "GOT THIS WRONG"} · {call.domain.toUpperCase()}
        </span>
      </div>
      <h3
        className="mt-2 font-display text-[18px] leading-snug"
        style={{ fontWeight: 600 }}
      >
        {call.title}
      </h3>
      <div className="mt-4 flex items-stretch gap-3">
        <div className="flex-1 rounded-xl px-3 py-3" style={{ background: "var(--bg)" }}>
          <div
            className="font-mono text-[9px] tracking-[0.2em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            PROPHIQ SAID
          </div>
          <div
            className="mt-1 truncate font-display text-[15px]"
            style={{ fontWeight: 600 }}
          >
            {call.top_pick_label ?? "—"}
          </div>
          {pct != null && (
            <div
              className="mt-0.5 font-mono text-[13px]"
              style={{ color: "var(--amber-strong)", fontWeight: 600 }}
            >
              {pct}%
            </div>
          )}
        </div>
        <div className="flex-1 rounded-xl px-3 py-3" style={{ background: "var(--bg)" }}>
          <div
            className="font-mono text-[9px] tracking-[0.2em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            ACTUAL
          </div>
          <div
            className="mt-1 truncate font-display text-[15px]"
            style={{ fontWeight: 600 }}
          >
            {call.actual_outcome ?? "—"}
          </div>
          <div
            className="mt-0.5 font-mono text-[13px]"
            style={{
              color: call.correct ? "var(--green)" : "var(--amber-strong)",
              fontWeight: 600,
            }}
          >
            {call.correct ? "✓ Correct" : "✗ Missed"}
          </div>
        </div>
      </div>
    </Link>
  );
}
