// Stripe webhook handler. Receives events from Stripe, validates the
// signature, idempotency-checks via stripe_webhook_events, and updates
// our local subscriptions table.
//
// Deploy with --no-verify-jwt because Stripe calls us, not authenticated
// users. We verify Stripe's signature manually using STRIPE_WEBHOOK_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { getStripeClient, mapStripeStatus, stripeTimestampToIso, extractSubscriptionPeriod } from "../_shared/stripe.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import { sendEmail } from "../_shared/email.ts";
import {
  welcomeEmail,
  trialEndingEmail,
  paymentFailedEmail,
  subscriptionCanceledEmail,
} from "../_shared/email-templates.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

Deno.serve(async (req: Request) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) {
    console.warn("[stripe-webhook] missing Stripe-Signature header");
    return errorResponse("Missing signature", 400);
  }

  const stripe = getStripeClient();
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      stripeWebhookSecret,
    );
  } catch (e) {
    console.warn(`[stripe-webhook] signature validation failed: ${(e as Error).message}`);
    return errorResponse("Invalid signature", 400);
  }

  // Idempotency: have we seen this event ID before?
  const { data: existing } = await supabase
    .from("stripe_webhook_events")
    .select("stripe_event_id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existing) {
    console.log(`[stripe-webhook] event ${event.id} (${event.type}) already processed - skipping`);
    return jsonResponse({ received: true, deduplicated: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(supabase, stripe, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await upsertSubscription(supabase, event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.trial_will_end":
        await handleTrialWillEnd(supabase, event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid":
        await handleInvoicePaid(supabase, event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(supabase, event.data.object as Stripe.Invoice);
        break;
      default:
        console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
    }
  } catch (e) {
    console.error(`[stripe-webhook] handler failed for ${event.type} (${event.id}): ${(e as Error).message}`);
  }

  // Always record the event (idempotency anchor), even on handler errors.
  await supabase.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });

  return jsonResponse({ received: true });
});

type SbClient = ReturnType<typeof createClient>;

// ---------- shared email context helpers ----------

function getSiteUrl(): string {
  return Deno.env.get("SITE_URL") ?? "https://prophiq.io";
}

async function getEmailForUser(
  supabase: SbClient,
  userId: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const profileEmail = (profile as { email?: string | null } | null)?.email ?? null;
  if (profileEmail) return profileEmail;
  // Fall back to auth user record (profiles.email may not be populated yet
  // for freshly-promoted anonymous accounts).
  try {
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    return user?.email ?? null;
  } catch {
    return null;
  }
}

async function getPriceContext(
  supabase: SbClient,
  stripePriceId: string,
): Promise<{ tier: "standard" | "pro" | "enterprise"; amountMinor: number; currency: string }> {
  const { data } = await supabase
    .from("prophiq_prices")
    .select("tier, amount_minor_units, currency")
    .eq("stripe_price_id", stripePriceId)
    .maybeSingle();
  const row = data as
    | { tier?: string; amount_minor_units?: number; currency?: string }
    | null;
  const tier = (row?.tier as "standard" | "pro" | "enterprise" | undefined) ?? "standard";
  return {
    tier,
    amountMinor: row?.amount_minor_units ?? 0,
    currency: row?.currency ?? "GBP",
  };
}

// ---------- handlers ----------

async function handleCheckoutCompleted(
  supabase: SbClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = session.metadata?.user_id;
  const stripeCustomerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;

  if (!userId || !stripeCustomerId) {
    console.warn(`[handleCheckoutCompleted] session ${session.id} missing user_id or customer`);
    return;
  }

  await supabase
    .from("profiles")
    .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .is("stripe_customer_id", null);

  const email = session.customer_details?.email ?? null;
  if (email) {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(userId);
      if (user && (user as { is_anonymous?: boolean }).is_anonymous) {
        await supabase.auth.admin.updateUserById(userId, {
          email,
          email_confirm: true,
          user_metadata: { promoted_from_anonymous_at: new Date().toISOString() },
        });
        console.log(`[handleCheckoutCompleted] upgraded anonymous user ${userId} -> ${email}`);
      }
    } catch (e) {
      console.warn(`[handleCheckoutCompleted] anonymous-to-email upgrade failed for ${userId}: ${(e as Error).message}`);
    }
  }

  // Welcome email (best-effort). Fetch subscription to get tier + trial end.
  if (!session.subscription) return;
  const subId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription.id;
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const stripePriceId = sub.items.data[0]?.price?.id;
    const to = email ?? (await getEmailForUser(supabase, userId));
    if (!stripePriceId || !to) return;
    const priceCtx = await getPriceContext(supabase, stripePriceId);
    const template = welcomeEmail({
      email: to,
      siteUrl: getSiteUrl(),
      tier: priceCtx.tier,
      trialEnd: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : new Date().toISOString(),
      priceAmountMinor: priceCtx.amountMinor,
      priceCurrency: priceCtx.currency,
    });
    await sendEmail({ to, subject: template.subject, html: template.html });
  } catch (e) {
    console.warn(`[handleCheckoutCompleted] welcome email failed: ${(e as Error).message}`);
  }
}

async function upsertSubscription(
  supabase: SbClient,
  sub: Stripe.Subscription,
): Promise<void> {
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (!profile) {
    console.warn(`[upsertSubscription] no profile found for stripe_customer_id=${stripeCustomerId}`);
    return;
  }

  const priceId = sub.items.data[0]?.price?.id;
  if (!priceId) {
    console.warn(`[upsertSubscription] subscription ${sub.id} has no price_id`);
    return;
  }

  const { data: priceRow } = await supabase
    .from("prophiq_prices")
    .select("stripe_price_id")
    .eq("stripe_price_id", priceId)
    .maybeSingle();
  if (!priceRow) {
    console.error(`[upsertSubscription] unknown price_id ${priceId} for subscription ${sub.id}`);
    return;
  }

  const { current_period_start, current_period_end } = extractSubscriptionPeriod(sub);

  if (current_period_start === null || current_period_end === null) {
    console.error(`[upsertSubscription] missing period dates for subscription ${sub.id}`);
    return;
  }

  const row = {
    user_id: (profile as { id: string }).id,
    stripe_subscription_id: sub.id,
    stripe_customer_id: stripeCustomerId,
    stripe_price_id: priceId,
    status: mapStripeStatus(sub.status),
    current_period_start: stripeTimestampToIso(current_period_start)!,
    current_period_end: stripeTimestampToIso(current_period_end)!,
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: stripeTimestampToIso(sub.canceled_at),
    trial_start: stripeTimestampToIso(sub.trial_start),
    trial_end: stripeTimestampToIso(sub.trial_end),
  };

  const { error } = await supabase
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });

  if (error) {
    console.error(`[upsertSubscription] upsert failed for ${sub.id}: ${error.message}`);
  }
}

async function handleTrialWillEnd(
  supabase: SbClient,
  sub: Stripe.Subscription,
): Promise<void> {
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  const userId = (profile as { id?: string } | null)?.id
    ?? (sub.metadata as Record<string, string> | null)?.user_id;
  if (!userId) {
    console.warn("[trial_will_end] no user_id resolvable for subscription");
    return;
  }
  const email = await getEmailForUser(supabase, userId);
  if (!email) return;
  const stripePriceId = sub.items.data[0]?.price?.id;
  if (!stripePriceId) return;
  const priceCtx = await getPriceContext(supabase, stripePriceId);
  const template = trialEndingEmail({
    email,
    siteUrl: getSiteUrl(),
    tier: priceCtx.tier,
    trialEnd: sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : new Date().toISOString(),
    priceAmountMinor: priceCtx.amountMinor,
    priceCurrency: priceCtx.currency,
  });
  await sendEmail({ to: email, subject: template.subject, html: template.html });
}

async function handleSubscriptionDeleted(
  supabase: SbClient,
  sub: Stripe.Subscription,
): Promise<void> {
  await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: stripeTimestampToIso(sub.canceled_at) ?? new Date().toISOString(),
    })
    .eq("stripe_subscription_id", sub.id);

  // Email (best-effort).
  try {
    const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", stripeCustomerId)
      .maybeSingle();
    const userId = (profile as { id?: string } | null)?.id
      ?? (sub.metadata as Record<string, string> | null)?.user_id;
    if (!userId) return;
    const email = await getEmailForUser(supabase, userId);
    if (!email) return;

    const cancelReason =
      (sub as unknown as { cancellation_details?: { reason?: string } })
        .cancellation_details?.reason ?? null;
    const reason: "user_canceled" | "payment_failed" | "admin" =
      cancelReason === "payment_failed"
        ? "payment_failed"
        : cancelReason === "cancellation_requested"
          ? "user_canceled"
          : "admin";

    const template = subscriptionCanceledEmail({
      email,
      siteUrl: getSiteUrl(),
      reason,
    });
    await sendEmail({ to: email, subject: template.subject, html: template.html });
  } catch (e) {
    console.warn(`[handleSubscriptionDeleted] cancel email failed: ${(e as Error).message}`);
  }
}

async function handleInvoicePaid(
  _supabase: SbClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id;
  if (subId) {
    console.log(`[invoice.paid] subscription=${subId} amount=${invoice.amount_paid} currency=${invoice.currency}`);
  }
}

async function handleInvoicePaymentFailed(
  supabase: SbClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subId) return;
  console.warn(`[invoice.payment_failed] subscription=${subId} - Stripe will retry per dunning settings`);

  try {
    const customerId = typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
    if (!customerId) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    const email = (profile as { email?: string | null } | null)?.email
      ?? invoice.customer_email
      ?? null;
    if (!email) return;
    const template = paymentFailedEmail({ email, siteUrl: getSiteUrl() });
    await sendEmail({ to: email, subject: template.subject, html: template.html });
  } catch (e) {
    console.warn(`[handleInvoicePaymentFailed] payment-failed email failed: ${(e as Error).message}`);
  }
}
