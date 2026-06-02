import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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

function SearchPage() {
  const { q } = Route.useSearch();

  const { data: results = [], isLoading } = useQuery<SearchRow[]>({
    queryKey: ["search", q],
    queryFn: async () => {
      if (!q) return [];
      const { data, error } = await supabase.rpc("search_events", {
        _q: q,
        _limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as SearchRow[];
    },
    enabled: !!q,
  });

  return (
    <div style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <Header />
      <main className="mx-auto max-w-2xl px-5 pb-12 pt-9">
        <div className="mb-6">
          <p
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            SEARCH
          </p>
          <h1
            className="font-display tracking-[-0.03em]"
            style={{ fontWeight: 700, fontSize: 36, lineHeight: 1 }}
          >
            {q ? (
              <>
                Results for{" "}
                <span style={{ color: "var(--amber)" }}>"{q}"</span>
              </>
            ) : (
              "Search Prophiq."
            )}
          </h1>
          {q && !isLoading && (
            <p
              className="mt-2 font-body text-[13px]"
              style={{ color: "var(--ink-soft)" }}
            >
              {results.length} event{results.length === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        {isLoading && (
          <p
            className="font-body text-[13px]"
            style={{ color: "var(--ink-soft)" }}
          >
            Searching…
          </p>
        )}

        {!isLoading && q && results.length === 0 && (
          <div
            className="rounded-xl px-4 py-6 text-center"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <p
              className="font-body text-[14px]"
              style={{ color: "var(--ink-soft)" }}
            >
              Nothing matches "{q}" yet.
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.event_id}>
              <Link
                to="/$domain/events/$slug"
                params={{ domain: r.domain, slug: r.slug }}
                className="block rounded-xl px-4 py-3 transition-colors hover:bg-[var(--bg-card)]"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-soft)",
                }}
              >
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--ink-faint)" }}
                >
                  {r.domain.toUpperCase()} ·{" "}
                  {r.status === "resolved" ? "SCORED" : "UPCOMING"}
                </p>
                <p
                  className="mt-1 font-body text-[14px]"
                  style={{ color: "var(--ink)" }}
                >
                  {r.title}
                </p>
                {r.top_pick_label && r.top_pick_pct != null && (
                  <p
                    className="mt-1 font-body text-[12.5px]"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    {r.top_pick_label} · {Math.round(r.top_pick_pct)}%
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </div>
  );
}
