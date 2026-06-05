import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminListEvents, type AdminEventRow } from "@/lib/admin/events";

type SearchParams = {
  search?: string;
  domain?: string;
  status?: string;
  moderation?: string;
  source?: string;
  has_pred?: string;
  page?: number;
};

export const Route = createFileRoute("/admin/events/")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === "string" ? s.search : undefined,
    domain: typeof s.domain === "string" ? s.domain : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
    moderation: typeof s.moderation === "string" ? s.moderation : undefined,
    source: typeof s.source === "string" ? s.source : undefined,
    has_pred: typeof s.has_pred === "string" ? s.has_pred : undefined,
    page: typeof s.page === "number" ? s.page : s.page ? Number(s.page) : undefined,
  }),
  component: EventsListPage,
});

const PAGE_SIZE = 50;

function badge(color: string, bg: string, label: string) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{ background: bg, color, border: `1px solid ${color}33` }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    scheduled: ["#0ea5e9", "#0ea5e914"],
    live: ["#059669", "#05966914"],
    resolved: ["#64748b", "#64748b14"],
    cancelled: ["#dc2626", "#dc262614"],
  };
  const [c, b] = map[status] ?? ["#64748b", "#64748b14"];
  return badge(c, b, status);
}

function ModerationBadge({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    pending: ["#d97706", "#d9770614"],
    approved: ["#059669", "#05966914"],
    rejected: ["#dc2626", "#dc262614"],
  };
  const [c, b] = map[s] ?? ["#64748b", "#64748b14"];
  return badge(c, b, s);
}

function fmtRel(d: string | null) {
  if (!d) return "—";
  const date = new Date(d);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const days = Math.round(abs / 86_400_000);
  const hrs = Math.round(abs / 3_600_000);
  const ago = diff < 0;
  if (abs < 3_600_000) return ago ? `${Math.round(abs / 60_000)}m ago` : `in ${Math.round(abs / 60_000)}m`;
  if (hrs < 48) return ago ? `${hrs}h ago` : `in ${hrs}h`;
  return ago ? `${days}d ago` : `in ${days}d`;
}

function EventsListPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/events" });
  const [searchInput, setSearchInput] = useState(search.search ?? "");

  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchInput || "") !== (search.search || "")) {
        navigate({
          search: (prev: SearchParams) => ({ ...prev, search: searchInput || undefined, page: 1 }),
        });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const page = search.page ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  const hasPredFilter =
    search.has_pred === "yes" ? true : search.has_pred === "no" ? false : null;

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "admin-events",
      search.search,
      search.domain,
      search.status,
      search.moderation,
      search.source,
      search.has_pred,
      page,
    ],
    queryFn: () =>
      adminListEvents({
        search: search.search,
        domain: search.domain,
        status: search.status,
        moderation_status: search.moderation,
        source: search.source,
        has_prediction: hasPredFilter,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (prev) => prev,
  });

  const rows: AdminEventRow[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontWeight: 600 }}>
            ADMIN
          </p>
          <h1 className="font-display tracking-[-0.03em]" style={{ fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
            Events<span style={{ color: "var(--amber)" }}>.</span>
          </h1>
        </div>
        <div className="flex items-center gap-3 text-right">
          <Link
            to="/admin/events/moderation"
            className="font-mono text-[11px] underline"
            style={{ color: "var(--ink-soft)" }}
          >
            Moderation queue →
          </Link>
          <p className="font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
            {isLoading ? "Loading…" : `${total.toLocaleString()} total`}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search title…"
          className="font-body w-64 rounded-md px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--amber)]/30"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        />
        {(
          [
            ["domain", ["politics", "sport", "entertainment", "markets"], "All domains"],
            ["status", ["scheduled", "live", "resolved", "cancelled"], "All statuses"],
            ["moderation", ["pending", "approved", "rejected"], "All moderation"],
            ["source", ["discovered", "user_submitted"], "All sources"],
            ["has_pred", ["yes", "no"], "Any prediction"],
          ] as const
        ).map(([key, opts, label]) => (
          <select
            key={key}
            value={(search as Record<string, string | undefined>)[key] ?? ""}
            onChange={(e) =>
              navigate({
                search: (prev: SearchParams) => ({
                  ...prev,
                  [key]: e.target.value || undefined,
                  page: 1,
                }),
              })
            }
            className="font-body rounded-md px-2 py-1.5 text-[13px]"
            style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
          >
            <option value="">{label}</option>
            {opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ))}
      </div>

      <div
        className="overflow-x-auto rounded-lg border"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      >
        <table className="w-full border-collapse text-left font-body text-[13px]">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-faint)" }}>
              <th className="px-3 py-2 font-semibold">Title</th>
              <th className="px-3 py-2 font-semibold">Domain</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Moderation</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Starts</th>
              <th className="px-3 py-2 text-right font-semibold">Pred</th>
              <th className="px-3 py-2 text-center font-semibold">Live?</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center" style={{ color: "var(--amber)" }}>
                  {(error as Error).message}
                </td>
              </tr>
            )}
            {!error && !isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center" style={{ color: "var(--ink-soft)" }}>
                  No events match your filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t transition-ios-colors hover:bg-[rgba(11,18,32,0.04)]"
                style={{ borderColor: "var(--border-soft)" }}
              >
                <td className="px-3 py-2">
                  <Link
                    to="/admin/events/$id"
                    params={{ id: r.id }}
                    className="hover:underline"
                    style={{ color: "var(--ink)" }}
                  >
                    {r.title}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>{r.domain}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2"><ModerationBadge s={r.moderation_status} /></td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>{r.source}</td>
                <td className="px-3 py-2" style={{ color: "var(--ink-soft)" }} title={r.starts_at}>{fmtRel(r.starts_at)}</td>
                <td className="px-3 py-2 text-right font-mono">{r.prediction_count}</td>
                <td className="px-3 py-2 text-center">
                  {r.has_current_prediction ? <span style={{ color: "var(--amber-strong)" }}>●</span> : <span style={{ color: "var(--ink-faint)" }}>○</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 font-mono text-[12px]">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => navigate({ search: (p: SearchParams) => ({ ...p, page: page - 1 }) })}
            className="rounded-md border px-3 py-1 disabled:opacity-30"
            style={{ borderColor: "var(--border-strong)" }}
          >
            Prev
          </button>
          <span style={{ color: "var(--ink-soft)" }}>Page {page} / {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => navigate({ search: (p: SearchParams) => ({ ...p, page: page + 1 }) })}
            className="rounded-md border px-3 py-1 disabled:opacity-30"
            style={{ borderColor: "var(--border-strong)" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
