// POST /functions/v1/admin-revenue-sync
//
// On-demand Stripe ground-truth pull for the /admin/revenue page.
// Returns refund volume + failed-payment-recovery counts for a period.
// Display-only; no DB writes.
//
// Body: { period_start: ISO, period_end: ISO }
//
// Dual-client auth-as-caller (Phase II.C pattern): role check uses the
// caller's JWT so admin_require_role sees the right auth.uid(); Stripe
// + service reads use the service-role client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getStripeClient } from "../_shared/stripe.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";

interface Body {
  period_start?: string;
  period_end?: string;
}

function readEnv(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(name);
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }

  const startStr = body.period_start?.trim();
  const endStr = body.period_end?.trim();
  if (!startStr || !endStr) return errorResponse("period_start and period_end required");

  const startMs = Date.parse(startStr);
  const endMs = Date.parse(endStr);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return errorResponse("invalid period range");
  }
  const gte = Math.floor(startMs / 1000);
  const lte = Math.floor(endMs / 1000);

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return errorResponse("Missing Authorization", 401);

  const url = readEnv("SUPABASE_URL");
  const anonKey = readEnv("SUPABASE_ANON_KEY") ?? readEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anonKey) return errorResponse("Supabase env missing", 500);

  const callerClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { error: roleErr } = await callerClient.rpc("admin_require_role", {
    p_roles: ["super_admin", "admin"],
  });
  if (roleErr) return errorResponse(roleErr.message ?? "Forbidden", 403);

  let stripe;
  try { stripe = getStripeClient(); }
  catch (e) { return errorResponse((e as Error).message, 500); }

  try {
    // ---- Refund volume ---------------------------------------------------
    let refundTotal = 0;
    let refundCount = 0;
    let refundCurrency: string | null = null;
    let starting: string | undefined = undefined;
    for (let page = 0; page < 10; page++) {
      const r = await stripe.refunds.list({
        created: { gte, lte },
        limit: 100,
        ...(starting ? { starting_after: starting } : {}),
      });
      for (const ref of r.data) {
        refundTotal += ref.amount ?? 0;
        refundCount += 1;
        if (!refundCurrency && ref.currency) refundCurrency = ref.currency;
      }
      if (!r.has_more || r.data.length === 0) break;
      starting = r.data[r.data.length - 1].id;
    }

    // ---- Past-due / recovery snapshot -----------------------------------
    // Snapshot, not historical: count uncollectible vs recovered invoices
    // in the period. Stripe's invoice statuses give us a usable proxy.
    let openInvoices = 0;
    let paidInvoices = 0;
    let uncollectible = 0;
    let invStart: string | undefined = undefined;
    for (let page = 0; page < 10; page++) {
      const inv = await stripe.invoices.list({
        created: { gte, lte },
        limit: 100,
        ...(invStart ? { starting_after: invStart } : {}),
      });
      for (const i of inv.data) {
        if (i.status === "open") openInvoices += 1;
        if (i.status === "paid") paidInvoices += 1;
        if (i.status === "uncollectible") uncollectible += 1;
      }
      if (!inv.has_more || inv.data.length === 0) break;
      invStart = inv.data[inv.data.length - 1].id;
    }

    const totalAttempts = openInvoices + paidInvoices + uncollectible;
    const recoveryRate = totalAttempts > 0
      ? paidInvoices / totalAttempts
      : null;

    return jsonResponse({
      ok: true,
      as_of: new Date().toISOString(),
      period_start: startStr,
      period_end: endStr,
      refunds: {
        total_minor: refundTotal,
        count: refundCount,
        currency: refundCurrency,
      },
      invoices: {
        open: openInvoices,
        paid: paidInvoices,
        uncollectible,
        recovery_rate: recoveryRate,
      },
    });
  } catch (err) {
    console.error("[admin-revenue-sync] stripe error:", err);
    const msg = err instanceof Error ? err.message : "Stripe call failed";
    return errorResponse(msg, 500);
  }
});
