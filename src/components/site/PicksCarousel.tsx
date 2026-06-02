import { Link } from "@tanstack/react-router";
import { ConfidenceLabel } from "./ConfidenceLabel";
import { classifyEvent } from "@/lib/subcategory";
import type { HomepagePick } from "@/lib/queries";
import type { DomainId } from "@/lib/types";

interface PicksCarouselProps {
  picks: HomepagePick[]; // already filtered to exclude marquee, max 4
}

export function PicksCarousel({ picks }: PicksCarouselProps) {
  if (picks.length < 2) return null;

  return (
    <section className="pb-2 pt-5">
      <div className="mb-3 flex items-center gap-2.5 px-4">
        <div
          className="font-mono text-[10px] font-semibold uppercase"
          style={{ letterSpacing: "0.22em", color: "var(--amber-strong)" }}
        >
          More forecasts
        </div>
        <div className="h-px flex-1" style={{ background: "var(--border-soft)" }} />
      </div>

      <div
        className="flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory", scrollPaddingLeft: 16 }}
      >
        {picks.map((pick) => {
          const subcategory = classifyEvent(pick.title, pick.domain as DomainId);
          const pct =
            pick.top_pick_pct != null ? Math.round(pick.top_pick_pct) : null;
          return (
            <Link
              key={pick.event_id}
              to="/$domain/events/$slug"
              params={{ domain: pick.domain, slug: pick.slug }}
              className="pick-card flex shrink-0 flex-col rounded-[14px]"
              style={{
                width: 260,
                background: "var(--bg-card)",
                border: "1px solid var(--line)",
                padding: "14px 16px",
                boxShadow: "var(--shadow-sm)",
                scrollSnapAlign: "start",
                transition: "all 220ms var(--ease-ios)",
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <div
                  className="font-mono text-[9px] font-semibold uppercase"
                  style={{
                    letterSpacing: "0.2em",
                    color: "var(--amber-2)",
                  }}
                >
                  {pick.domain.toUpperCase()} · {subcategory.toUpperCase()}
                </div>
                <ConfidenceLabel tier={pick.confidence} compact />
              </div>

              <div
                className="font-display mb-3 flex-1 font-semibold"
                style={{
                  fontSize: 14,
                  lineHeight: 1.28,
                  color: "var(--ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {pick.title}
              </div>

              {pick.top_pick_label && pct != null && (
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div
                      className="mb-0.5 font-mono uppercase"
                      style={{
                        fontSize: 8.5,
                        fontWeight: 600,
                        letterSpacing: "0.2em",
                        color: "var(--ink-3)",
                      }}
                    >
                      TOP PICK
                    </div>
                    <div
                      className="font-display truncate"
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        lineHeight: 1.1,
                        color: "var(--ink)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {pick.top_pick_label}
                    </div>
                  </div>
                  <div
                    className="shrink-0 font-mono"
                    style={{
                      fontSize: 26,
                      fontWeight: 600,
                      lineHeight: 0.95,
                      color: "var(--amber)",
                      letterSpacing: "-0.04em",
                      fontFeatureSettings: "'tnum'",
                    }}
                  >
                    {pct}
                    <span style={{ fontSize: 12 }}>%</span>
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
