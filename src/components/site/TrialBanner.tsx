import { useEffect, useState } from "react";
import { useUsageQuota } from "../../hooks/useUsageQuota";
import { useActiveSubscription } from "../../hooks/useActiveSubscription";

const SESSION_DISMISS_KEY = "trial-banner-dismissed-at";
const SHOW_WITHIN_MS = 48 * 60 * 60 * 1000; // final ~48h

export function TrialBanner() {
  const { usage } = useUsageQuota();
  const { data: subscription } = useActiveSubscription();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const dismissedAt = sessionStorage.getItem(SESSION_DISMISS_KEY);
    if (dismissedAt) setDismissed(true);
  }, []);

  if (!usage?.isTrialing || !usage.trialEnd || dismissed) return null;

  const msLeft = usage.trialEnd.getTime() - Date.now();
  // Only show during the final ~48h — stay quiet for the bulk of the trial.
  if (msLeft <= 0 || msLeft > SHOW_WITHIN_MS) return null;

  const hoursLeft = Math.ceil(msLeft / (1000 * 60 * 60));
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  const timeLabel =
    hoursLeft <= 24
      ? `${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"}`
      : `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;

  const planLabel = subscription?.tier
    ? subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)
    : "your paid plan";
  const endDate = usage.trialEnd.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  function handleDismiss() {
    sessionStorage.setItem(SESSION_DISMISS_KEY, new Date().toISOString());
    setDismissed(true);
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-sm"
      style={{
        background: "rgba(247, 147, 30, 0.08)",
        borderBottom: "1px solid var(--line)",
        color: "var(--ink)",
      }}
    >
      <div className="flex-1">
        Your trial ends in <strong>{timeLabel}</strong> — you'll move to{" "}
        {planLabel} on {endDate}.
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleDismiss}
          className="p-1 rounded hover:bg-black/5"
          aria-label="Dismiss trial banner"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
