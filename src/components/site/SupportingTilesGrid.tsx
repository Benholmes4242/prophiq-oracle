import { useNavigate } from "@tanstack/react-router";
import type { HomepagePick } from "@/lib/queries";

interface Props {
  picks: HomepagePick[];
  baseStagger?: number;
}

export function SupportingTilesGrid({ picks, baseStagger = 2 }: Props) {
  const slots: (HomepagePick | null)[] = [...picks];
  while (slots.length < 4) slots.push(null);

  return (
    <div className="grid grid-cols-2 gap-2 px-4">
      {slots.slice(0, 4).map((p, i) => {
        const staggerMap = [2, 3, 4, 5];
        const stagger = staggerMap[i] ?? baseStagger + i;
        return p ? (
          <SupportingTile key={p.event_id} pick={p} stagger={stagger} />
        ) : (
          <EmptyTile key={`empty-${i}`} stagger={stagger} />
        );
      })}
    </div>
  );
}

function SupportingTile({
  pick,
  stagger,
}: {
  pick: HomepagePick;
  stagger: number;
}) {
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
      className="pressable entry-animate text-left"
      data-stagger={stagger}
      style={{
        minHeight: 100,
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        boxShadow: "var(--shadow-sm)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div
          className="truncate font-mono text-[8.5px] font-bold uppercase"
          style={{ letterSpacing: "0.2em", color: "var(--amber-2)" }}
        >
          {pick.domain.toUpperCase()}
        </div>
      </div>
      <div
        className="font-body line-clamp-2"
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.22,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
          marginBottom: 8,
          flex: 1,
        }}
      >
        {pick.title}
      </div>
      <div className="flex items-end justify-between gap-1.5">
        <div
          className="min-w-0 truncate font-body"
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            maxWidth: 90,
          }}
        >
          {pick.top_pick_label ?? "—"}
        </div>
        {pct != null && (
          <div
            className="font-mono shrink-0"
            style={{
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 0.95,
              letterSpacing: "-0.03em",
              color: "var(--amber)",
              fontFeatureSettings: "'tnum'",
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

function EmptyTile({ stagger }: { stagger: number }) {
  return (
    <div
      className="entry-animate"
      data-stagger={stagger}
      style={{
        minHeight: 100,
        border: "1px dashed var(--line-2)",
        borderRadius: 14,
        display: "grid",
        placeItems: "center",
        color: "var(--ink-3)",
        fontSize: 18,
      }}
    >
      —
    </div>
  );
}
