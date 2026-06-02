import { useNavigate } from "@tanstack/react-router";
import { ConfidenceLabel } from "@/components/site/ConfidenceLabel";
import type { HomepagePick } from "@/lib/queries";
import type { DomainId } from "@/lib/types";

export const TILE_DOMAINS: DomainId[] = [
  "sport",
  "politics",
  "markets",
  "entertainment",
];

const DOMAIN_LABEL: Record<string, string> = {
  sport: "SPORT",
  politics: "POLITICS",
  markets: "MARKETS",
  entertainment: "ENTERTAINMENT",
};

interface Props {
  byDomain: Record<string, HomepagePick | null>;
  baseStagger?: number;
}

export function DomainTilesGrid({ byDomain, baseStagger = 6 }: Props) {
  return (
    <section>
      <div
        className="entry-animate mb-2 flex items-center gap-2.5 px-4"
        data-stagger={baseStagger - 1}
      >
        <div
          className="font-mono text-[10px] font-semibold uppercase"
          style={{ letterSpacing: "0.22em", color: "var(--amber-2)" }}
        >
          Across Domains
        </div>
        <div className="h-px flex-1" style={{ background: "var(--line)" }} />
      </div>
      <div className="grid grid-cols-2 gap-2 px-4">
        {TILE_DOMAINS.map((d, i) => {
          const pick = byDomain[d];
          const stagger = Math.min(baseStagger + i, 9);
          return pick ? (
            <DomainTile key={d} pick={pick} stagger={stagger} />
          ) : (
            <DomainTileEmpty key={d} domain={d} stagger={stagger} />
          );
        })}
      </div>
    </section>
  );
}

function DomainTile({ pick, stagger }: { pick: HomepagePick; stagger: number }) {
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
      className="e-tile pressable entry-animate text-left"
      data-stagger={stagger}
      style={{
        minHeight: 118,
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        boxShadow: "var(--shadow-card)",
        padding: "13px 14px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div
          className="truncate font-mono text-[9px] font-bold uppercase"
          style={{ letterSpacing: "0.2em", color: "var(--amber-2)" }}
        >
          {DOMAIN_LABEL[pick.domain] ?? pick.domain.toUpperCase()}
        </div>
        <ConfidenceLabel tier={pick.confidence} compact />
      </div>
      <div
        className="font-body line-clamp-2"
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.22,
          color: "var(--ink)",
        }}
      >
        {pick.title}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        <div
          className="min-w-0 truncate font-body"
          style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink)" }}
        >
          {pick.top_pick_label ?? "—"}
        </div>
        {pct != null && (
          <div
            className="font-mono"
            style={{
              fontSize: 21,
              fontWeight: 600,
              lineHeight: 1,
              color: "var(--amber)",
              fontFeatureSettings: "'tnum'",
              letterSpacing: "-0.03em",
            }}
          >
            {pct}
            <span style={{ fontSize: 11 }}>%</span>
          </div>
        )}
      </div>
    </button>
  );
}

function DomainTileEmpty({
  domain,
  stagger,
}: {
  domain: DomainId;
  stagger: number;
}) {
  const navigate = useNavigate();
  const label = DOMAIN_LABEL[domain] ?? domain.toUpperCase();
  const niceName =
    domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase();
  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/$domain", params: { domain } })}
      className="e-tile pressable entry-animate text-left"
      data-stagger={stagger}
      style={{
        minHeight: 118,
        background: "var(--bg-card)",
        border: "1px dashed var(--line-2)",
        borderRadius: 16,
        padding: "13px 14px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        className="font-mono text-[9px] font-bold uppercase"
        style={{ letterSpacing: "0.2em", color: "var(--ink-3)" }}
      >
        {label}
      </div>
      <div
        className="font-body text-center"
        style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}
      >
        No high-confidence forecast today
      </div>
      <div
        className="font-body text-right"
        style={{ fontSize: 11.5, fontWeight: 600, color: "var(--amber-2)" }}
      >
        Browse {niceName.toLowerCase()} →
      </div>
    </button>
  );
}
