import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DomainId } from "@/lib/types";

const DOMAINS: { key: DomainId; label: string; Icon: () => JSX.Element }[] = [
  { key: "sport", label: "Sport", Icon: TrophyIcon },
  { key: "politics", label: "Politics", Icon: LandmarkIcon },
  { key: "markets", label: "Markets", Icon: ChartIcon },
  { key: "entertainment", label: "Entertainment", Icon: FilmIcon },
];

export function DomainBrowseGrid() {
  const { data: counts = {} } = useQuery<Record<string, number>>({
    queryKey: ["domain-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("domain")
        .eq("status", "scheduled")
        .eq("moderation_status", "approved");
      if (error) throw error;
      const result: Record<string, number> = {};
      (data ?? []).forEach((r: { domain: string }) => {
        result[r.domain] = (result[r.domain] ?? 0) + 1;
      });
      return result;
    },
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <div className="section-row">
        <span className="section-eyebrow muted">Browse by Domain</span>
      </div>
      <div className="domain-chips">
        {DOMAINS.map(({ key, label, Icon }) => (
          <Link key={key} to="/$domain" params={{ domain: key }} className="domain-chip">
            <div className="domain-icon">
              <Icon />
            </div>
            <div className="domain-chip-text">
              <div className="domain-label">{label}</div>
              <div className="domain-count">{counts[key] ?? 0} EVENTS</div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function TrophyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function LandmarkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="17" x2="22" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
    </svg>
  );
}
