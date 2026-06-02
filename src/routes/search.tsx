import { useEffect, useMemo, useState } from "react";
import {
  createFileRoute,
  Link,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DOMAIN_LABEL, type DomainId } from "@/lib/types";
import { fetchHomepagePicks } from "@/lib/queries";
import { SearchResultCard } from "@/components/site/SearchResultCard";
import { DomainBrowseGrid } from "@/components/site/DomainBrowseGrid";
import { useRecentSearches } from "@/hooks/useRecentSearches";

interface SearchRow {
  event_id: string;
  domain: string;
  slug: string;
  title: string;
  status: string;
  starts_at: string | null;
  resolved_at: string | null;
  top_pick_label: string | null;
  top_pick_pct: number | null;
  confidence: string | null;
}

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === "string" ? s.q : "",
  }),
  head: () => ({
    meta: [
      { title: "Search — Prophiq" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SearchPage,
});

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function SearchPage() {
  const { q: routerQ } = Route.useSearch();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState(routerQ);

  // keep input in sync if URL changes (back/forward)
  useEffect(() => {
    setInputValue(routerQ);
  }, [routerQ]);

  const debouncedSync = useMemo(
    () =>
      debounce((v: string) => {
        void navigate({
          to: "/search",
          search: { q: v },
          replace: true,
        });
      }, 150),
    [navigate],
  );

  function handleChange(v: string) {
    setInputValue(v);
    debouncedSync(v);
  }

  const trimmed = routerQ.trim();
  const { data: results = [], isFetching } = useQuery<SearchRow[]>({
    queryKey: ["search", trimmed],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_events", {
        _q: trimmed,
        _limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as SearchRow[];
    },
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const state: "empty" | "loading" | "no-results" | "active" =
    trimmed.length === 0
      ? "empty"
      : isFetching && results.length === 0
        ? "loading"
        : results.length === 0
          ? "no-results"
          : "active";

  return (
    <div className="search-page">
      <SearchBar value={inputValue} onChange={handleChange} />
      <div className="search-scroll">
        {state === "empty" && <EmptyContent onUseRecent={handleChange} />}
        {state === "loading" && <LoadingShimmer />}
        {state === "active" && <ResultsContent results={results} query={trimmed} />}
        {state === "no-results" && <NoResultsContent query={trimmed} />}
      </div>
    </div>
  );
}

function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="search-bar-wrapper">
      <div className="search-eyebrow">Search</div>
      <div className="search-pill">
        <svg
          className="search-pill-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          autoFocus
          type="search"
          value={value}
          placeholder="Search events, picks, domains…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onChange("");
          }}
          aria-label="Search Prophiq"
        />
        <button
          className={`search-pill-clear ${value ? "visible" : ""}`}
          onClick={() => onChange("")}
          aria-label="Clear search"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function EmptyContent({ onUseRecent }: { onUseRecent: (q: string) => void }) {
  const { recents, remove, clear } = useRecentSearches();
  return (
    <>
      <RecentSearchesRow
        recents={recents}
        onUse={onUseRecent}
        onRemove={remove}
        onClear={clear}
      />
      <TrendingSection />
      <DomainBrowseGrid />
    </>
  );
}

function RecentSearchesRow({
  recents,
  onUse,
  onRemove,
  onClear,
}: {
  recents: string[];
  onUse: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}) {
  if (recents.length === 0) return null;
  return (
    <>
      <div className="section-row">
        <span className="section-eyebrow">Recent</span>
        <button className="section-action" onClick={onClear} type="button">
          Clear all
        </button>
      </div>
      <div className="recent-list">
        {recents.map((r) => (
          <div
            key={r}
            className="recent-pill"
            onClick={() => onUse(r)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onUse(r);
              }
            }}
          >
            <span className="label">{r}</span>
            <button
              className="remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(r);
              }}
              aria-label={`Remove "${r}" from recent`}
              type="button"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function TrendingSection() {
  const { data: picks = [] } = useQuery({
    queryKey: ["trending-events"],
    queryFn: fetchHomepagePicks,
    staleTime: 5 * 60_000,
  });
  if (picks.length === 0) return null;
  const top = picks.slice(0, 4);
  return (
    <>
      <div className="section-row">
        <span className="section-eyebrow">Trending</span>
      </div>
      <div className="result-list">
        {top.map((p) => (
          <div key={p.event_id} className="result-fade">
            <SearchResultCard
              event={{
                event_id: p.event_id,
                domain: p.domain,
                slug: p.slug,
                title: p.title,
                status: "scheduled",
                top_pick_label: p.top_pick_label,
                top_pick_pct: p.top_pick_pct,
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function ResultsContent({
  results,
  query,
}: {
  results: SearchRow[];
  query: string;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, SearchRow[]>();
    results.forEach((r) => {
      const arr = map.get(r.domain) ?? [];
      arr.push(r);
      map.set(r.domain, arr);
    });
    return map;
  }, [results]);

  const domainKeys = Array.from(grouped.keys());
  const multiDomain = domainKeys.length > 1;
  const { add: addRecent } = useRecentSearches();

  return (
    <>
      <div className="results-count">
        <strong>{results.length}</strong>{" "}
        {results.length === 1 ? "result" : "results"} for "{query}"
      </div>
      {multiDomain ? (
        domainKeys.map((domain) => (
          <div key={domain}>
            <div className="section-row">
              <span className="section-eyebrow muted">
                {DOMAIN_LABEL[domain as DomainId]?.toUpperCase() ??
                  domain.toUpperCase()}{" "}
                · {grouped.get(domain)!.length}
              </span>
            </div>
            <div className="result-list">
              {grouped.get(domain)!.map((r) => (
                <div
                  key={r.event_id}
                  className="result-fade"
                  onClickCapture={() => addRecent(query)}
                >
                  <SearchResultCard event={r} query={query} />
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="result-list">
          {results.map((r) => (
            <div
              key={r.event_id}
              className="result-fade"
              onClickCapture={() => addRecent(query)}
            >
              <SearchResultCard event={r} query={query} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NoResultsContent({ query }: { query: string }) {
  return (
    <>
      <div className="empty-state">
        <div className="empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <div className="empty-title">No results for "{query}"</div>
        <div className="empty-sub">
          Try a different keyword, or browse by domain below.
        </div>
      </div>
      <DomainBrowseGrid />
    </>
  );
}

function LoadingShimmer() {
  return (
    <>
      <div className="results-count">Searching…</div>
      <div className="result-list">
        <div className="shimmer-card" />
        <div className="shimmer-card" />
        <div className="shimmer-card" />
      </div>
    </>
  );
}

// Keep Link import for potential future use; satisfy linter
void Link;
