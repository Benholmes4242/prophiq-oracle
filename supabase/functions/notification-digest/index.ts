// notification-digest edge function.
//
// Sends a single brand-styled summary email to all active admin addresses
// covering unresolved warning + critical notifications since the last digest.
// Skips sending when nothing is pending (no empty emails).
//
// Invoked every 30 minutes by prophiq_notification_digest cron.

import { handleCorsPreflight, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { sendEmail } from "../_shared/email.ts";

interface PendingRow {
  id: string;
  severity: "warning" | "critical";
  category: string;
  title: string;
  body: string | null;
  source: string;
  target_url: string | null;
  created_at: string;
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function shellOpen(): string {
  return `<div style="background: #F8F4EC; padding: 32px 16px; font-family: ${FONT_STACK}; color: #0A1117;"><div style="max-width: 560px; margin: 0 auto; background: #F8F4EC; padding: 32px 24px;">`;
}
function shellClose(siteUrl: string): string {
  return `<hr style="border: none; border-top: 1px solid #EBE2D0; margin: 32px 0 16px;" /><p style="font-size: 12px; color: #999; margin: 0;">Manage admin notifications at <a href="${siteUrl}/admin" style="color: #0A1117;">${siteUrl}/admin</a>.</p></div></div>`;
}
function wordmark(): string {
  return `<div style="margin-bottom: 24px;"><span style="font-family: ${FONT_STACK}; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: #0A1117;">prophiq<span style="color: #F4731A;">.</span></span></div>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function digestSubject(criticals: number, warnings: number): string {
  const parts: string[] = [];
  if (criticals > 0) parts.push(`${criticals} critical`);
  if (warnings > 0) parts.push(`${warnings} warning`);
  return `Prophiq: ${parts.join(", ")}`;
}

function digestHtml(rows: PendingRow[], siteUrl: string): string {
  const items = rows.map((r) => {
    const sevColor = r.severity === "critical" ? "#B91C1C" : "#B45309";
    const link = r.target_url ? `${siteUrl}${r.target_url}` : `${siteUrl}/admin`;
    return `<div style="border-left: 3px solid ${sevColor}; padding: 8px 0 8px 12px; margin: 0 0 12px;">
      <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: ${sevColor}; font-weight: 600;">${r.severity}</div>
      <div style="font-size: 15px; font-weight: 600; margin: 4px 0 2px;"><a href="${link}" style="color: #0A1117; text-decoration: none;">${escapeHtml(r.title)}</a></div>
      ${r.body ? `<div style="font-size: 13px; color: #555;">${escapeHtml(r.body)}</div>` : ""}
      <div style="font-size: 11px; color: #999; margin-top: 4px;">${r.source} &middot; ${new Date(r.created_at).toUTCString()}</div>
    </div>`;
  }).join("");

  return `${shellOpen()}${wordmark()}
<h1 style="font-size: 22px; font-weight: 700; margin: 0 0 16px;">System notifications</h1>
<p style="font-size: 14px; line-height: 1.6; margin: 0 0 20px; color: #555;">The following items have not yet been included in a digest. Open the admin panel to triage, mark as read, or follow the linked surface.</p>
${items}
<a href="${siteUrl}/admin" style="display: inline-block; background: #0A1117; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 8px;">Open admin</a>
${shellClose(siteUrl)}`;
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  let body: { source?: string; manual?: boolean } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { body = {}; }
  }
  const isCronRun = body.source === "cron";
  const startedAt = Date.now();

  const sb = getServiceClient();

  const logCron = async (status: string, items: number, detail: Record<string, unknown>, err: string | null) => {
    if (!isCronRun) return;
    try {
      await sb.rpc("log_cron_run", {
        p_job_name: "prophiq_notification_digest",
        p_status: status,
        p_duration_ms: Date.now() - startedAt,
        p_items_processed: items,
        p_detail: { ...detail, manual: !!body.manual },
        p_error_message: err,
      });
    } catch (e) {
      console.warn(`[notification-digest] log_cron_run failed: ${(e as Error).message}`);
    }
  };

  // Pull unresolved warning/critical that haven't been digested yet.
  const { data: pending, error: pendErr } = await sb
    .from("admin_notifications")
    .select("id,severity,category,title,body,source,target_url,created_at")
    .in("severity", ["warning", "critical"])
    .is("digest_sent_at", null)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (pendErr) {
    await logCron("failed", 0, {}, pendErr.message);
    return jsonResponse({ error: pendErr.message }, { status: 500 });
  }

  const rows = (pending ?? []) as PendingRow[];
  if (rows.length === 0) {
    await logCron("succeeded", 0, { reason: "nothing pending" }, null);
    return jsonResponse({ sent: 0, recipients: 0, reason: "nothing pending" });
  }

  // Active admin emails.
  const { data: admins, error: aErr } = await sb
    .from("admin_users")
    .select("user_id")
    .is("revoked_at", null);
  if (aErr) return jsonResponse({ error: aErr.message }, { status: 500 });
  const adminIds = (admins ?? []).map((a: { user_id: string }) => a.user_id);
  if (adminIds.length === 0) {
    await logCron("succeeded", 0, { reason: "no active admins" }, null);
    return jsonResponse({ sent: 0, recipients: 0, reason: "no active admins" });
  }

  // Resolve admin emails via service-role auth admin API.
  const recipients: string[] = [];
  for (const id of adminIds) {
    const { data: u } = await sb.auth.admin.getUserById(id);
    const email = u?.user?.email;
    if (email) recipients.push(email);
  }
  if (recipients.length === 0) {
    await logCron("succeeded", 0, { reason: "no admin emails resolved" }, null);
    return jsonResponse({ sent: 0, recipients: 0, reason: "no admin emails resolved" });
  }

  const siteUrl = readEnv("PUBLIC_SITE_URL") ?? "https://prophiq.io";
  const criticals = rows.filter((r) => r.severity === "critical").length;
  const warnings  = rows.filter((r) => r.severity === "warning").length;
  const subject   = digestSubject(criticals, warnings);
  const html      = digestHtml(rows, siteUrl);

  // sendEmail is per-recipient; loop. Best-effort: tally successes.
  let sent = 0;
  for (const to of recipients) {
    const ok = await sendEmail({ to, subject, html });
    if (ok) sent++;
  }

  // Stamp digest_sent_at on the included rows so they aren't re-sent.
  if (sent > 0) {
    const ids = rows.map((r) => r.id);
    await sb.from("admin_notifications")
      .update({ digest_sent_at: new Date().toISOString() })
      .in("id", ids);
  }

  return jsonResponse({ sent, recipients: recipients.length, pending: rows.length, subject });
});
