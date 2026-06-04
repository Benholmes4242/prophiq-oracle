// Inline HTML transactional email templates. Email clients strip <style>
// blocks inconsistently, so all styling is inline. Brand colors are hex
// literals (no CSS vars).

interface BaseTemplateContext {
  email: string;
  siteUrl: string;
}

export interface SubscriptionContext extends BaseTemplateContext {
  tier: "standard" | "pro" | "enterprise";
  trialEnd: string; // ISO date
  priceAmountMinor: number; // e.g. 600 for GBP 6.00
  priceCurrency: string; // e.g. "GBP"
}

export interface CanceledContext extends BaseTemplateContext {
  reason: "user_canceled" | "payment_failed" | "admin";
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function formatPrice(amountMinor: number, currency: string): string {
  const major = (amountMinor / 100).toFixed(0);
  return `${currency} ${major}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function tierDisplayName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function wordmarkHtml(): string {
  return `<div style="margin-bottom: 24px;"><span style="font-family: ${FONT_STACK}; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: #0A1117;">prophiq<span style="color: #F4731A;">.</span></span></div>`;
}

function emailShellOpen(): string {
  return `<div style="background: #F8F4EC; padding: 32px 16px; font-family: ${FONT_STACK}; color: #0A1117;"><div style="max-width: 560px; margin: 0 auto; background: #F8F4EC; padding: 32px 24px;">`;
}

function emailShellClose(siteUrl: string): string {
  return `<hr style="border: none; border-top: 1px solid #EBE2D0; margin: 32px 0 16px;" /><p style="font-size: 12px; color: #999; margin: 0;">Manage your subscription at <a href="${siteUrl}/account" style="color: #0A1117;">${siteUrl}/account</a> or reply to this email for help.</p><p style="font-size: 12px; color: #999; margin: 8px 0 0;">the Prophiq team</p></div></div>`;
}

export function welcomeEmail(ctx: SubscriptionContext) {
  const tierName = tierDisplayName(ctx.tier);
  const priceStr = formatPrice(ctx.priceAmountMinor, ctx.priceCurrency);
  const trialEndStr = formatDate(ctx.trialEnd);

  return {
    subject: "Welcome to Prophiq.",
    html: `${emailShellOpen()}
${wordmarkHtml()}
<h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px; color: #0A1117;">Welcome to Prophiq.</h1>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Your 7-day Pro trial is now active. You have 100 forecasts per day until <strong>${trialEndStr}</strong>, at which point your <strong>${tierName}</strong> plan begins at <strong>${priceStr}/month</strong>.</p>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">A few places to start:</p>
<ul style="font-size: 15px; line-height: 1.7; padding-left: 20px; margin: 0 0 24px;">
  <li>Ask a probabilistic question about any public event: elections, sports, markets, policy decisions.</li>
  <li>See how the multi-model consensus reaches its forecast, with sourcing and reasoning.</li>
  <li>Browse resolved forecasts to track how the engine's confidence has held up over time.</li>
</ul>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">Cancel before ${trialEndStr} and you won't be charged.</p>
<a href="${ctx.siteUrl}" style="display: inline-block; background: #0A1117; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Open Prophiq</a>
${emailShellClose(ctx.siteUrl)}`,
  };
}

export function trialEndingEmail(ctx: SubscriptionContext) {
  const tierName = tierDisplayName(ctx.tier);
  const priceStr = formatPrice(ctx.priceAmountMinor, ctx.priceCurrency);
  const trialEndStr = formatDate(ctx.trialEnd);

  return {
    subject: "Your Prophiq trial ends in 3 days",
    html: `${emailShellOpen()}
${wordmarkHtml()}
<h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px; color: #0A1117;">Your trial ends ${trialEndStr}</h1>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Three days from now, your Prophiq trial converts to a <strong>${tierName}</strong> plan at <strong>${priceStr}/month</strong>. We'll send a receipt when the first charge goes through.</p>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Nothing more to do if you want to continue. If you'd rather cancel, you can do so anytime before ${trialEndStr} and you won't be charged.</p>
<a href="${ctx.siteUrl}/account" style="display: inline-block; background: #0A1117; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Manage subscription</a>
${emailShellClose(ctx.siteUrl)}`,
  };
}

export function paymentFailedEmail(ctx: BaseTemplateContext) {
  return {
    subject: "We couldn't process your Prophiq payment",
    html: `${emailShellOpen()}
${wordmarkHtml()}
<h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px; color: #0A1117;">Payment didn't go through</h1>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">We tried to charge your card for your Prophiq subscription, but it didn't go through. Most often this is a card that's expired or a temporary bank decline.</p>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">You can update your payment method below. We'll retry the charge automatically over the next few days. If we still can't collect after several tries, your subscription will be paused.</p>
<a href="${ctx.siteUrl}/account" style="display: inline-block; background: #0A1117; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Update payment method</a>
<p style="font-size: 13px; color: #666; margin: 24px 0 0;">Reply to this email if you need help.</p>
${emailShellClose(ctx.siteUrl)}`,
  };
}

export function subscriptionCanceledEmail(ctx: CanceledContext) {
  const reasonCopy =
    ctx.reason === "payment_failed"
      ? "Your Prophiq subscription has been canceled because we couldn't collect payment after several tries."
      : "Your Prophiq subscription has been canceled.";

  return {
    subject: "Your Prophiq subscription has been canceled",
    html: `${emailShellOpen()}
${wordmarkHtml()}
<h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px; color: #0A1117;">Subscription canceled</h1>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">${reasonCopy}</p>
<p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">You can still browse Prophiq with the free tier (3 forecasts per day). Re-subscribe anytime to get back to higher daily limits and Pro features.</p>
<a href="${ctx.siteUrl}/pricing" style="display: inline-block; background: #0A1117; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View plans</a>
<p style="font-size: 13px; color: #666; margin: 24px 0 0;">Reply to this email if anything looks wrong.</p>
${emailShellClose(ctx.siteUrl)}`,
  };
}
