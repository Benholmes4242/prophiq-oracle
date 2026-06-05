import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminListAudit } from "@/lib/admin/audit";
import { adminGetAdmin } from "@/lib/admin/admins";

export const Route = createFileRoute("/admin/admins/$id/audit")({
  head: () => ({
    meta: [
      { title: "Admin audit — Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PerAdminAuditPage,
});

const PAGE_SIZE = 100;

function PerAdminAuditPage() {
  const { id } = Route.useParams();

  const adminQ = useQuery({
    queryKey: ["admin", "admins", "one", id],
    queryFn: () => adminGetAdmin(id),
  });
  const auditQ = useQuery({
    queryKey: ["admin", "admins", "audit", id],
    queryFn: () => adminListAudit({ adminUserId: id, limit: PAGE_SIZE, offset: 0 }),
  });

  const admin = adminQ.data;
  const rows = auditQ.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontWeight: 600 }}>ADMIN AUDIT</p>
          <h1 className="font-display tracking-[-0.03em]" style={{ fontWeight: 700, fontSize: 24, lineHeight: 1.1 }}>
            {admin?.email ?? "…"}
          </h1>
          {admin && (
            <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
              {admin.role}{admin.revoked_at ? ` · revoked ${new Date(admin.revoked_at).toLocaleString()}` : ""}
            </p>
          )}
        </div>
        <Link to="/admin/admins" className="font-mono text-[11px] underline" style={{ color: "var(--ink-soft)" }}>
          ← All admins
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <table className="w-full text-left text-[13px]">
          <thead className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {auditQ.isLoading && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>Loading…</td></tr>
            )}
            {!auditQ.isLoading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No actions yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top" style={{ borderColor: "var(--border-soft)" }}>
                <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap" style={{ color: "var(--ink-soft)" }}>
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink)" }}>{r.action}</td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  {r.target_type}{r.target_id ? ` · ${r.target_id.slice(0, 8)}…` : ""}
                </td>
                <td className="px-3 py-2 font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>
                  <pre className="max-w-md whitespace-pre-wrap break-all">{JSON.stringify(r.metadata ?? {}, null, 0)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
