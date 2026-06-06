import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminGetUserDetail, type AdminUserDetail } from "@/lib/admin/queries";
import { UserActionsPanel } from "@/components/admin/UserActionsPanel";

export const Route = createFileRoute("/admin/users/$id")({
  component: UserDetailPage,
});

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-soft)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 font-body text-[13px]">
      <span style={{ color: "var(--ink-soft)" }}>{label}</span>
      <span className="min-w-0 truncate text-right" style={{ color: "var(--ink)" }}>
        {value}
      </span>
    </div>
  );
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function Sparkline({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="mt-2 flex h-12 items-end gap-1">
      {data.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.count}`}
          className="flex-1 rounded-sm"
          style={{
            height: `${(d.count / max) * 100}%`,
            minHeight: 2,
            background: d.count > 0 ? "var(--amber)" : "var(--border-soft)",
            opacity: d.count > 0 ? 0.8 : 1,
          }}
        />
      ))}
    </div>
  );
}

function UserDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-user-detail", id],
    queryFn: () => adminGetUserDetail(id),
  });

  if (isLoading) {
    return <p className="font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>Loading…</p>;
  }
  if (error) {
    return (
      <div>
        <Link to="/admin/users" className="font-body text-[13px] hover:underline">
          ← Back to users
        </Link>
        <p className="mt-4 font-body text-[14px]" style={{ color: "var(--amber)" }}>
          {(error as Error).message}
        </p>
      </div>
    );
  }
  if (!data) return null;

  const d: AdminUserDetail = data;
  const billingPlatform = d.subscription?.billing_platform ?? (d.subscription ? "stripe" : null);
  const stripeUrl = d.subscription?.stripe_subscription_id
    ? `https://dashboard.stripe.com/subscriptions/${d.subscription.stripe_subscription_id}`
    : null;
  const platformLabel = billingPlatform === "apple"
    ? "Apple"
    : billingPlatform === "google"
      ? "Google"
      : billingPlatform === "stripe"
        ? "Stripe"
        : null;

  return (
    <div>
      <Link to="/admin/users" className="font-body text-[13px] hover:underline">
        ← Back to users
      </Link>

      <div className="mt-3 mb-5 flex items-start justify-between gap-4">
        <div>
          <h1
            className="font-display tracking-[-0.03em]"
            style={{ fontWeight: 700, fontSize: 26, lineHeight: 1.1 }}
          >
            {d.user.email ?? "(no email)"}
          </h1>
          <p
            className="mt-1 font-mono text-[11px]"
            style={{ color: "var(--ink-soft)" }}
          >
            Signed up {fmtDate(d.user.created_at)} · ID {d.user.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.is_admin && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{ background: "#f59e0b14", color: "#b45309", border: "1px solid #f59e0b33" }}
            >
              {d.admin_role}
            </span>
          )}
          {d.subscription && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{ background: "var(--ink)", color: "white" }}
            >
              {d.subscription.plan_tier}
            </span>
          )}
        </div>
      </div>

      <div className="mb-4">
        <UserActionsPanel
          userId={d.user.id}
          userEmail={d.user.email ?? ""}
          role={d.admin_role}
          suspendedAt={d.suspension?.suspended_at ?? null}
          activeOverrideId={d.active_override?.id ?? null}
          activeOverrideTier={d.active_override?.granted_tier ?? null}
          stripeSubscriptionId={d.subscription?.stripe_subscription_id ?? null}
          onChanged={() => void refetch()}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Subscription">

          {d.subscription ? (
            <>
              <Row label="Plan" value={`${d.subscription.display_name}`} />
              <Row label="Status" value={d.subscription.status} />
              <Row label="Cadence" value={d.subscription.plan_cadence} />
              <Row
                label="Amount"
                value={money(d.subscription.amount_minor_units, d.subscription.currency)}
              />
              <Row label="Daily cap" value={d.subscription.daily_forecast_cap} />
              <Row
                label={d.subscription.status === "trialing" ? "Trial ends" : "Renews"}
                value={fmtDate(
                  d.subscription.trial_end ?? d.subscription.current_period_end,
                )}
              />
              <Row
                label="Cancel at end"
                value={d.subscription.cancel_at_period_end ? "Yes" : "No"}
              />
              {platformLabel && <Row label="Platform" value={platformLabel} />}
              {billingPlatform === "stripe" && (
                <Row
                  label="Stripe"
                  value={
                    stripeUrl ? (
                      <a
                        href={stripeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] hover:underline"
                        style={{ color: "var(--amber-strong)" }}
                      >
                        {d.subscription.stripe_subscription_id!.slice(0, 14)}…
                      </a>
                    ) : (
                      "—"
                    )
                  }
                />
              )}
              {billingPlatform === "apple" && (
                <Row
                  label="Apple txn"
                  value={
                    <span className="font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                      {d.subscription.apple_original_transaction_id_masked ?? "—"}
                    </span>
                  }
                />
              )}
            </>
          ) : (
            <p className="font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>
              No active subscription (free tier).
            </p>
          )}
        </Card>

        <Card title="Usage">
          <Row label="Today" value={d.usage_today} />
          <Row label="This month" value={d.usage_this_month} />
          <Row label="Lifetime" value={d.usage_lifetime} />
          <div className="mt-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-faint)" }}>
              Last 7 days
            </p>
            <Sparkline data={d.usage_last_7_days ?? []} />
          </div>
        </Card>

        {d.is_admin && d.admin_meta ? (
          <Card title="Admin">
            <Row label="Role" value={d.admin_role} />
            <Row label="MFA enforced" value={d.admin_meta.mfa_enforced ? "Yes" : "No"} />
            <Row label="Created" value={fmtDate(d.admin_meta.created_at)} />
            {d.admin_meta.notes && <Row label="Notes" value={d.admin_meta.notes} />}
          </Card>
        ) : (
          <Card title="Account">
            <Row label="Email confirmed" value={fmtDate(d.user.email_confirmed_at)} />
            <Row label="Last sign-in" value={fmtDate(d.user.last_sign_in_at)} />
            <Row label="Phone" value={d.user.phone ?? "—"} />
          </Card>
        )}
      </div>

      <div className="mt-6">
        <h2
          className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          Recent questions ({d.recent_questions.length})
        </h2>
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
                <th className="px-3 py-2 font-semibold">Submitted</th>
                <th className="px-3 py-2 font-semibold">Domain</th>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.recent_questions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center" style={{ color: "var(--ink-soft)" }}>
                    No questions submitted.
                  </td>
                </tr>
              )}
              {d.recent_questions.map((q) => (
                <tr
                  key={q.event_id}
                  className="border-t"
                  style={{ borderColor: "var(--border-soft)" }}
                >
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                    {fmtDate(q.submitted_at)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] uppercase">
                    {q.domain}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to="/$domain/events/$slug"
                      params={{ domain: q.domain, slug: q.slug }}
                      target="_blank"
                      className="hover:underline"
                      style={{ color: "var(--ink)" }}
                    >
                      {q.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                    {q.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            Audit trail
          </h2>
          <Link
            to="/admin/audit"
            search={{ target_id: d.user.id, target_type: "user" } as never}
            className="font-mono text-[11px] hover:underline"
            style={{ color: "var(--ink-soft)" }}
          >
            View full audit log →
          </Link>
        </div>
        <div
          className="rounded-lg border p-4 font-body text-[13px]"
          style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)", color: "var(--ink-soft)" }}
        >
          {d.recent_audit_log.length === 0 ? (
            <>No admin actions on this user yet.</>
          ) : (
            <ul className="space-y-1.5">
              {d.recent_audit_log.map((a, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    <span className="font-mono text-[11px]" style={{ color: "var(--ink)" }}>
                      {a.action}
                    </span>{" "}
                    by {a.admin_email}
                  </span>
                  <span className="font-mono text-[11px]">{fmtDate(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
