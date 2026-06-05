import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminListAdmins,
  adminInviteAdmin,
  adminRevokeAdmin,
  adminChangeRole,
  adminResetMfa,
  type AdminRow,
  type AdminRoleName,
} from "@/lib/admin/admins";
import type { AdminRole } from "@/lib/admin/queries";

export const Route = createFileRoute("/admin/admins/")({
  head: () => ({
    meta: [
      { title: "Admins — Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminsPage,
});

const ROLE_OPTIONS: AdminRoleName[] = ["super_admin", "admin", "support", "read_only"];

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString() : "—";
}

function AdminsPage() {
  const { adminRole } = (Route as unknown as { useRouteContext: () => { adminRole: AdminRole | null } })
    .useRouteContext?.() ?? { adminRole: null };
  // Layout route already provides context; fall back gracefully if shape differs.
  const isSuper = adminRole === "super_admin";

  if (!isSuper) {
    return (
      <div className="max-w-md py-12 text-center">
        <h1 className="font-display text-[20px]" style={{ fontWeight: 600 }}>Not authorized</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
          Admin management is restricted to super_admin.
        </p>
      </div>
    );
  }

  const qc = useQueryClient();
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: adminListAdmins,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokeRow, setRevokeRow] = useState<AdminRow | null>(null);
  const [roleRow, setRoleRow] = useState<AdminRow | null>(null);
  const [mfaRow, setMfaRow] = useState<AdminRow | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "admins"] });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontWeight: 600 }}>ADMIN</p>
          <h1 className="font-display tracking-[-0.03em]" style={{ fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
            Admins<span style={{ color: "var(--amber)" }}>.</span>
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            Invite, revoke, change role, or reset MFA. Last active super_admin is protected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="rounded-md px-4 py-2 font-mono text-[12px] font-medium min-h-11"
          style={{ background: "var(--amber-strong)", color: "var(--bg)" }}
        >
          + Invite admin
        </button>
      </div>

      {error && <div className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{(error as Error).message}</div>}

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <table className="w-full text-left text-[13px]">
          <thead className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">MFA</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Invited by</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No admins.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                <td className="px-3 py-2" style={{ color: "var(--ink)" }}>
                  <Link to="/admin/admins/$id/audit" params={{ id: r.id }} className="hover:underline">
                    {r.email}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase" style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}>
                    {r.role}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {r.mfa_enforced ? (
                    <span style={{ color: r.has_mfa_factor ? "var(--ink)" : "#b45309" }}>
                      {r.has_mfa_factor ? "enrolled" : "enforced · no factor"}
                    </span>
                  ) : (
                    <span style={{ color: "var(--ink-soft)" }}>optional</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>{fmt(r.created_at)}</td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>{r.created_by_email ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.revoked_at ? (
                    <span className="font-mono text-[11px]" style={{ color: "#dc2626" }}>revoked {fmt(r.revoked_at)}</span>
                  ) : (
                    <span className="font-mono text-[11px]" style={{ color: "var(--ink)" }}>active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {!r.revoked_at && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" onClick={() => setRoleRow(r)} className="rounded-md border px-2.5 py-1 text-[11px]" style={{ borderColor: "var(--border-soft)" }}>Role</button>
                      <button type="button" onClick={() => setMfaRow(r)} className="rounded-md border px-2.5 py-1 text-[11px]" style={{ borderColor: "var(--border-soft)" }}>Reset MFA</button>
                      <button type="button" onClick={() => setRevokeRow(r)} className="rounded-md border px-2.5 py-1 text-[11px]" style={{ borderColor: "#dc2626", color: "#dc2626" }}>Revoke</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onDone={refresh} />}
      {revokeRow && <RevokeModal row={revokeRow} onClose={() => setRevokeRow(null)} onDone={refresh} />}
      {roleRow && <RoleModal row={roleRow} onClose={() => setRoleRow(null)} onDone={refresh} />}
      {mfaRow && <ResetMfaModal row={mfaRow} onClose={() => setMfaRow(null)} onDone={refresh} />}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border p-5"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRoleName>("admin");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await adminInviteAdmin(email.trim(), role, notes.trim() || null);
      // Best-effort notify email is sent inside the admin flow; skipped for now
      // since no internal email-admin helper exists. Inviter can share the
      // sign-in URL directly. (Brief: minimal Resend send via sendEmail.)
      onDone();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("NO_SUCH_USER")) {
        setErr("This person must sign up at prophiq.io first, then invite again.");
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Invite admin" onClose={onClose}>
      <label className="block font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-md border px-2 py-2 text-sm min-h-11"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      />
      <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Role</label>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as AdminRoleName)}
        className="mt-1 w-full rounded-md border px-2 py-2 text-sm min-h-11"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      >
        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Notes (optional)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      />
      {err && <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm min-h-11" style={{ borderColor: "var(--border-soft)" }}>Cancel</button>
        <button type="button" disabled={busy || !email.trim()} onClick={submit} className="rounded-md px-3 py-2 text-sm font-medium min-h-11" style={{ background: "var(--amber-strong)", color: "var(--bg)" }}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </div>
    </ModalShell>
  );
}

function RevokeModal({ row, onClose, onDone }: { row: AdminRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null); setBusy(true);
    try {
      await adminRevokeAdmin(row.id, reason.trim() || "(no reason given)");
      onDone(); onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Revoke ${row.email}`} onClose={onClose}>
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        This sets <span className="font-mono">revoked_at = now()</span> on the admin row. They will no longer pass <span className="font-mono">is_admin()</span>.
      </p>
      <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Reason</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      />
      {err && <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm min-h-11" style={{ borderColor: "var(--border-soft)" }}>Cancel</button>
        <button type="button" disabled={busy} onClick={submit} className="rounded-md px-3 py-2 text-sm font-medium min-h-11" style={{ background: "#dc2626", color: "white" }}>
          {busy ? "Revoking…" : "Confirm revoke"}
        </button>
      </div>
    </ModalShell>
  );
}

function RoleModal({ row, onClose, onDone }: { row: AdminRow; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<AdminRoleName>(row.role);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null); setBusy(true);
    try {
      await adminChangeRole(row.id, role);
      onDone(); onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Change role · ${row.email}`} onClose={onClose}>
      <label className="block font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Role</label>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as AdminRoleName)}
        className="mt-1 w-full rounded-md border px-2 py-2 text-sm min-h-11"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      >
        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>
        Changing to <span className="font-mono">super_admin</span> or <span className="font-mono">admin</span> auto-enforces MFA. Lower roles relax it.
      </p>
      {err && <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm min-h-11" style={{ borderColor: "var(--border-soft)" }}>Cancel</button>
        <button type="button" disabled={busy || role === row.role} onClick={submit} className="rounded-md px-3 py-2 text-sm font-medium min-h-11" style={{ background: "var(--amber-strong)", color: "var(--bg)" }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}

function ResetMfaModal({ row, onClose, onDone }: { row: AdminRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function submit() {
    setErr(null); setBusy(true);
    try {
      const { factors_cleared } = await adminResetMfa(row.user_id);
      setDone(factors_cleared);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Reset MFA · ${row.email}`} onClose={onClose}>
      {done === null ? (
        <>
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Clears this admin's TOTP factors and stored recovery so they re-enroll on next sign-in. Use only when they've lost both device and recovery code.
          </p>
          {err && <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{err}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm min-h-11" style={{ borderColor: "var(--border-soft)" }}>Cancel</button>
            <button type="button" disabled={busy} onClick={submit} className="rounded-md px-3 py-2 text-sm font-medium min-h-11" style={{ background: "#dc2626", color: "white" }}>
              {busy ? "Resetting…" : "Confirm reset"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm" style={{ color: "var(--ink)" }}>
            Cleared {done} factor{done === 1 ? "" : "s"} and recovery. They'll be challenged to enroll on next sign-in.
          </p>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium min-h-11" style={{ background: "var(--amber-strong)", color: "var(--bg)" }}>Done</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
