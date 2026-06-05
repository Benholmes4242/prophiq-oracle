import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { adminListUsers, type AdminUserRow } from "@/lib/admin/queries";

type SearchParams = {
  search?: string;
  plan?: string;
  status?: string;
  page?: number;
};

export const Route = createFileRoute("/admin/users/")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === "string" ? s.search : undefined,
    plan: typeof s.plan === "string" ? s.plan : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
    page: typeof s.page === "number" ? s.page : s.page ? Number(s.page) : undefined,
  }),
  component: UsersListPage,
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

function PlanBadge({ tier }: { tier: string }) {
  if (tier === "pro") return badge("#7c3aed", "#7c3aed14", "Pro");
  if (tier === "standard") return badge("#0f172a", "#0f172a0d", "Standard");
  if (tier === "enterprise") return badge("#0d9488", "#0d948814", "Enterprise");
  return badge("#64748b", "#64748b14", "Free");
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    active: ["#059669", "#05966914"],
    trialing: ["#d97706", "#d9770614"],
    past_due: ["#dc2626", "#dc262614"],
    canceled: ["#64748b", "#64748b14"],
    free: ["#94a3b8", "#94a3b814"],
    unpaid: ["#dc2626", "#dc262614"],
    paused: ["#64748b", "#64748b14"],
  };
  const [c, b] = map[status] ?? ["#64748b", "#64748b14"];
  return badge(c, b, status);
}

function fmt(d: string | null) {
  if (!d) return "—";
  const date = new Date(d);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function UsersListPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/users" });
  const [searchInput, setSearchInput] = useState(search.search ?? "");

  // Debounce search input → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchInput || "") !== (search.search || "")) {
        navigate({
          search: (prev) => ({ ...prev, search: searchInput || undefined, page: 1 }),
        });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const page = search.page ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users", search.search, search.plan, search.status, page],
    queryFn: () =>
      adminListUsers({
        search: search.search,
        plan: search.plan,
        status: search.status,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (prev) => prev,
  });

  const rows: AdminUserRow[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters = useMemo(
    () => Boolean(search.search || search.plan || search.status),
    [search],
  );

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            ADMIN
          </p>
          <h1
            className="font-display tracking-[-0.03em]"
            style={{ fontWeight: 700, fontSize: 28, lineHeight: 1 }}
          >
            Users<span style={{ color: "var(--amber)" }}>.</span>
          </h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
            {isLoading
              ? "Loading…"
              : `Showing ${showingFrom}–${showingTo} of ${total.toLocaleString()}`}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search email…"
          className="font-body w-64 rounded-md px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--amber)]/30"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        />
        <select
          value={search.plan ?? ""}
          onChange={(e) =>
            navigate({
              search: (prev) => ({ ...prev, plan: e.target.value || undefined, page: 1 }),
            })
          }
          className="font-body rounded-md px-2 py-1.5 text-[13px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        >
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="standard">Standard</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select
          value={search.status ?? ""}
          onChange={(e) =>
            navigate({
              search: (prev) => ({ ...prev, status: e.target.value || undefined, page: 1 }),
            })
          }
          className="font-body rounded-md px-2 py-1.5 text-[13px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        >
          <option value="">All statuses</option>
          <option value="trialing">Trialing</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
          <option value="free">Free</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              navigate({ search: {} as SearchParams });
            }}
            className="font-body rounded-md px-2 py-1.5 text-[12px]"
            style={{ color: "var(--ink-soft)" }}
          >
            Reset
          </button>
        )}
        <div className="ml-auto">
          <button
            type="button"
            disabled
            title="Coming in Phase II.D"
            className="font-body rounded-md px-3 py-1.5 text-[12px] opacity-40"
            style={{ border: "1px solid var(--border-strong)" }}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div
        className="overflow-x-auto rounded-lg border"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      >
        <table className="w-full border-collapse text-left font-body text-[13px]">
          <thead>
            <tr
              className="font-mono text-[10px] uppercase tracking-[0.1em]"
              style={{ color: "var(--ink-faint)" }}
            >
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Signup</th>
              <th className="px-3 py-2 font-semibold">Last active</th>
              <th className="px-3 py-2 text-right font-semibold">Q lifetime</th>
              <th className="px-3 py-2 text-right font-semibold">Q this month</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center" style={{ color: "var(--amber)" }}>
                  {(error as Error).message}
                </td>
              </tr>
            )}
            {!error && !isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center" style={{ color: "var(--ink-soft)" }}>
                  No users match your filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.user_id}
                className="border-t transition-ios-colors hover:bg-[rgba(11,18,32,0.04)]"
                style={{ borderColor: "var(--border-soft)" }}
              >
                <td className="px-3 py-2">
                  <Link
                    to="/admin/users/$id"
                    params={{ id: r.user_id }}
                    className="hover:underline"
                    style={{ color: "var(--ink)" }}
                  >
                    {r.email}
                  </Link>
                </td>
                <td className="px-3 py-2"><PlanBadge tier={r.plan_tier} /></td>
                <td className="px-3 py-2"><StatusBadge status={r.subscription_status} /></td>
                <td className="px-3 py-2" style={{ color: "var(--ink-soft)" }}>
                  {fmt(r.signup_date)}
                </td>
                <td className="px-3 py-2" style={{ color: "var(--ink-soft)" }}>
                  {fmt(r.last_active_at)}
                </td>
                <td className="px-3 py-2 text-right font-mono">{r.lifetime_questions}</td>
                <td className="px-3 py-2 text-right font-mono">{r.questions_this_month}</td>
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
            onClick={() => navigate({ search: (p) => ({ ...p, page: page - 1 }) })}
            className="rounded-md border px-3 py-1 disabled:opacity-30"
            style={{ borderColor: "var(--border-strong)" }}
          >
            Prev
          </button>
          <span style={{ color: "var(--ink-soft)" }}>
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => navigate({ search: (p) => ({ ...p, page: page + 1 }) })}
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
