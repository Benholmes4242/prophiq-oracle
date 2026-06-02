import { useNavigate } from "@tanstack/react-router";
import { ConfidenceLabel } from "@/components/site/ConfidenceLabel";
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
        minHeight: 130,
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        boxShadow: "var(--shadow-sm)",
        padding: "13px 14px",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: 0,
            flex: 1,
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.2em",
              color: "var(--amber-2)",
              textTransform: "uppercase",
            }}
          >
            {pick.domain.toUpperCase()}
          </div>
          <ConfidenceLabel tier={pick.confidence} />
        </div>
        {pct != null && (
          <div
            className="font-mono shrink-0"
            style={{
              fontSize: 22,
              fontWeight: 600,
              lineHeight: 0.95,
              letterSpacing: "-0.03em",
              color: "var(--amber)",
              fontFeatureSettings: "'tnum'",
            }}
          >
            {pct}
            <span style={{ fontSize: 11 }}>%</span>
          </div>
        )}
      </div>

      <div
        className="font-body"
        style={{
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
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
          fontSize: 12.5,
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
    </button>
  );
}

function EmptyTile({ stagger }: { stagger: number }) {
  return (
    <div
      className="entry-animate"
      data-stagger={stagger}
      style={{
        minHeight: 130,
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
