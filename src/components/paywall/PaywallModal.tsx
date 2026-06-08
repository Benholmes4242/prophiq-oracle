import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { createCheckoutSession } from "../../lib/billing";

export interface PaywallQuotaInfo {
  daily_cap: number;
  used_today: number;
  tier: "free" | "standard" | "pro" | "enterprise";
  is_trialing: boolean;
  trial_end: string | null;
}

// Hardcoded constants mirror prophiq_prices seeds.
// TODO(ben): replace with the NEW live-mode Stripe price IDs created for the
// GBP 9.99 / 29.99 pricing update (Part A). Until swapped, paywall upgrade
// CTAs will target the grandfathered GBP 6 / 24 prices.
const STANDARD_MONTHLY_PRICE_ID = "price_NEW_STANDARD_MONTHLY_9_99";
const PRO_MONTHLY_PRICE_ID = "price_NEW_PRO_MONTHLY_29_99";

interface PaywallModalProps {
  open: boolean;
  onClose: () => void;
  quotaInfo: PaywallQuotaInfo | null;
}

export function PaywallModal({ open, onClose, quotaInfo }: PaywallModalProps) {
  const [loadingPriceId, setLoadingPriceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !quotaInfo) return null;

  const { daily_cap, used_today, tier, is_trialing } = quotaInfo;

  async function handleUpgrade(priceId: string) {
    setLoadingPriceId(priceId);
    setError(null);
    try {
      const url = await createCheckoutSession(priceId);
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message || "Failed to start checkout");
      setLoadingPriceId(null);
    }
  }

  const headline = is_trialing
    ? "Daily limit reached"
    : tier === "free"
      ? "You've used your daily forecasts"
      : `You've used your ${tier === "standard" ? "Standard" : "Pro"} forecasts today`;

  const subhead = is_trialing
    ? "You're on a Pro trial with 100 forecasts/day. Resets at midnight UTC."
    : tier === "free"
      ? `That's your free tier of ${daily_cap}/day. Upgrade for more headroom.`
      : tier === "standard"
        ? `That's your Standard tier of ${daily_cap}/day. Upgrade to Pro for 100/day.`
        : `That's your Pro tier of ${daily_cap}/day. Limit resets at midnight UTC.`;

  const showUpgradeCtas = tier !== "pro" && !is_trialing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{ background: "var(--bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-black/5"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
          {headline}
        </h2>
        <p className="text-sm mb-1" style={{ color: "var(--ink)" }}>
          You've used <strong>{used_today}</strong> of <strong>{daily_cap}</strong>
        </p>
        <p className="text-sm text-[var(--ink)]/70 mb-6">{subhead}</p>

        {showUpgradeCtas && (
          <div className="space-y-3">
            {tier === "free" && (
              <button
                onClick={() => handleUpgrade(STANDARD_MONTHLY_PRICE_ID)}
                disabled={loadingPriceId !== null}
                className="w-full py-3 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
                style={{ background: "var(--ink)", color: "white" }}
              >
                {loadingPriceId === STANDARD_MONTHLY_PRICE_ID
                  ? "Loading..."
                  : "Start 7-day Pro trial, then Standard at GBP 6/mo"}
              </button>
            )}
            <button
              onClick={() => handleUpgrade(PRO_MONTHLY_PRICE_ID)}
              disabled={loadingPriceId !== null}
              className="w-full py-3 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
              style={{ background: "var(--ink)", color: "white" }}
            >
              {loadingPriceId === PRO_MONTHLY_PRICE_ID
                ? "Loading..."
                : "Start 7-day Pro trial, then Pro at GBP 24/mo"}
            </button>
            <Link
              to="/pricing"
              onClick={onClose}
              className="block w-full text-center py-2 text-sm text-[var(--ink)]/70 hover:text-[var(--ink)]"
            >
              {"View all plans \u2192"}
            </Link>
          </div>
        )}

        {!showUpgradeCtas && (
          <button
            onClick={onClose}
            className="w-full py-3 px-4 rounded-lg font-medium text-sm"
            style={{ background: "var(--ink)", color: "white" }}
          >
            Got it
          </button>
        )}

        {error && <p className="mt-3 text-xs text-red-600 text-center">{error}</p>}
      </div>
    </div>
  );
}

// ============================================================
// Global event bus + container so any submit site can trigger
// the paywall without prop drilling.
// ============================================================

const PAYWALL_EVENT = "prophiq:paywall:show";

export function showPaywall(info: PaywallQuotaInfo) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PAYWALL_EVENT, { detail: info }));
}

export function PaywallModalContainer() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<PaywallQuotaInfo | null>(null);

  useEffect(() => {
    function onShow(e: Event) {
      const detail = (e as CustomEvent<PaywallQuotaInfo>).detail;
      setInfo(detail);
      setOpen(true);
    }
    window.addEventListener(PAYWALL_EVENT, onShow);
    return () => window.removeEventListener(PAYWALL_EVENT, onShow);
  }, []);

  return <PaywallModal open={open} onClose={() => setOpen(false)} quotaInfo={info} />;
}
