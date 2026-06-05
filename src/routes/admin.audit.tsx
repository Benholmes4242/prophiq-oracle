import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  adminListAudit,
  adminDistinctAuditActions,
  auditRowsToCsv,
  type AuditRow,
} from "@/lib/admin/audit";

type Search = {
  action?: string;
  target_type?: string;
  target_id?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
};

export const Route = createFileRoute("/admin/audit")({
  head: () => ({
    meta: [
      { title: "Admin audit — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    action: typeof s.action === "string" ? s.action : undefined,
    target_type: typeof s.target_type === "string" ? s.target_type : undefined,
    target_id: typeof s.target_id === "string" ? s.target_id : undefined,
    search: typeof s.search === "string" ? s.search : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
    page: typeof s.page === "number" ? s.page : s.page ? Number(s.page) : undefined,
  }),
  component: AuditPage,
});

const PAGE_SIZE = 50;
const EXPORT_CAP = 5000;

function fmt(d: string) {
  return new Date(d).toLocaleString();
}

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/audit" });
  const [searchInput, setSearchInput] = useState(search.search ?? "");
  const [drawerRow, setDrawerRow] = useState<AuditRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchInput || "") !== (search.search || "")) {
        navigate({ search: (p: Search) => ({ ...p, search: searchInput || undefined, page: 1 }) });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const page = search.page ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  const { data: actions = [] } = useQuery({
    queryKey: ["admin", "audit", "actions"],
    queryFn: adminDistinctAuditActions,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "audit", search, page],
    queryFn: () =>
      adminListAudit({
        action: search.action,
        targetType: search.target_type,
        targetId: search.target_id,
        search: search.search,
        from: search.from,
        to: search.to,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (prev) => prev,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function exportCsv() {
    const { rows: all } = await adminListAudit({
      action: search.action,
      targetType: search.target_type,
      targetId: search.target_id,
      search: search.search,
      from: search.from,
      to: search.to,
      limit: EXPORT_CAP,
      offset: 0,
    });
    const csv = auditRowsToCsv(all);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontWeight: 600 }}>
            ADMIN
          </p>
          <h1 className="font-display tracking-[-0.03em]" style={{ fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
            Audit log<span style={{ color: "var(--amber)" }}>.</span>
          </h1>
        </div>
        <p className="font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
          {isLoading ? "Loading…" : `${total.toLocaleString()} entries`}
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search email or target id…"
          className="font-body w-72 rounded-md px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--amber)]/30"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        />
        <select
          value={search.action ?? ""}
          onChange={(e) => navigate({ search: (p: Search) => ({ ...p, action: e.target.value || undefined, page: 1 }) })}
          className="font-body rounded-md px-2 py-1.5 text-[13px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={search.target_type ?? ""}
          onChange={(e) => navigate({ search: (p: Search) => ({ ...p, target_type: e.target.value || undefined, page: 1 }) })}
          className="font-body rounded-md px-2 py-1.5 text-[13px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        >
          <option value="">All types</option>
          <option value="user">user</option>
          <option value="event">event</option>
          <option value="subscription">subscription</option>
          <option value="health_check">health_check</option>
        </select>
        <input
          type="date"
          value={search.from ?? ""}
          onChange={(e) => navigate({ search: (p: Search) => ({ ...p, from: e.target.value || undefined, page: 1 }) })}
          className="font-body rounded-md px-2 py-1.5 text-[13px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        />
        <input
          type="date"
          value={search.to ?? ""}
          onChange={(e) => navigate({ search: (p: Search) => ({ ...p, to: e.target.value || undefined, page: 1 }) })}
          className="font-body rounded-md px-2 py-1.5 text-[13px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        />
        {(search.action || search.target_type || search.target_id || search.search || search.from || search.to) && (
          <button
            type="button"
            onClick={() => { setSearchInput(""); navigate({ search: {} as Search }); }}
            className="font-body rounded-md px-2 py-1.5 text-[12px]"
            style={{ color: "var(--ink-soft)" }}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={() => void exportCsv()}
          className="ml-auto font-body rounded-md px-3 py-1.5 text-[12px]"
          style={{ border: "1px solid var(--border-strong)" }}
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <table className="w-full border-collapse text-left font-body text-[13px]">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-faint)" }}>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Admin</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Target</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr><td colSpan={4} className="px-3 py-6 text-center" style={{ color: "var(--amber)" }}>{(error as Error).message}</td></tr>
            )}
            {!error && !isLoading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-10 text-center" style={{ color: "var(--ink-soft)" }}>No audit entries match your filters.</td></tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t transition-ios-colors hover:bg-[rgba(11,18,32,0.04)]"
                style={{ borderColor: "var(--border-soft)" }}
                onClick={() => setDrawerRow(r)}
              >
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>{fmt(r.created_at)}</td>
                <td className="px-3 py-2">{r.admin_email}</td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.action}</td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  {r.target_type}{r.target_id ? ` · ${r.target_id.slice(0, 8)}…` : ""}
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
            onClick={() => navigate({ search: (p: Search) => ({ ...p, page: page - 1 }) })}
            className="rounded-md border px-3 py-1 disabled:opacity-30"
            style={{ borderColor: "var(--border-strong)" }}
          >Prev</button>
          <span style={{ color: "var(--ink-soft)" }}>Page {page} / {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => navigate({ search: (p: Search) => ({ ...p, page: page + 1 }) })}
            className="rounded-md border px-3 py-1 disabled:opacity-30"
            style={{ borderColor: "var(--border-strong)" }}
          >Next</button>
        </div>
      )}

      {drawerRow && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setDrawerRow(null)}
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto border-l p-5"
            style={{ background: "var(--bg)", borderColor: "var(--border-soft)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-faint)" }}>
                  Audit entry
                </p>
                <h2 className="font-mono text-[14px]" style={{ color: "var(--ink)" }}>{drawerRow.action}</h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerRow(null)}
                className="rounded-md px-2 py-1 text-sm"
                style={{ color: "var(--ink-soft)" }}
              >Close</button>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-y-2 font-body text-[12px]">
              <dt style={{ color: "var(--ink-soft)" }}>When</dt>
              <dd className="col-span-2 font-mono text-[11px]">{fmt(drawerRow.created_at)}</dd>
              <dt style={{ color: "var(--ink-soft)" }}>Admin</dt>
              <dd className="col-span-2">{drawerRow.admin_email} ({drawerRow.admin_role})</dd>
              <dt style={{ color: "var(--ink-soft)" }}>Target</dt>
              <dd className="col-span-2 font-mono text-[11px]">{drawerRow.target_type} {drawerRow.target_id ?? ""}</dd>
            </dl>
            {drawerRow.before_state && (
              <details className="mt-4" open>
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
                  Before
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md border p-3 text-[11px]" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
                  {JSON.stringify(drawerRow.before_state, null, 2)}
                </pre>
              </details>
            )}
            {drawerRow.after_state && (
              <details className="mt-3" open>
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
                  After
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md border p-3 text-[11px]" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
                  {JSON.stringify(drawerRow.after_state, null, 2)}
                </pre>
              </details>
            )}
            {drawerRow.metadata && (
              <details className="mt-3">
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
                  Metadata
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md border p-3 text-[11px]" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
                  {JSON.stringify(drawerRow.metadata, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
