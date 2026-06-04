import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useUsageQuota } from "../../hooks/useUsageQuota";

const SESSION_DISMISS_KEY = "trial-banner-dismissed-at";

export function TrialBanner() {
  const { usage } = useUsageQuota();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const dismissedAt = sessionStorage.getItem(SESSION_DISMISS_KEY);
    if (dismissedAt) setDismissed(true);
  }, []);

  if (!usage?.isTrialing || !usage.trialEnd || dismissed) return null;

  const daysLeft = Math.max(
    0,
    Math.ceil((usage.trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  function handleDismiss() {
    sessionStorage.setItem(SESSION_DISMISS_KEY, new Date().toISOString());
    setDismissed(true);
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-sm"
      style={{
        background: "rgba(247, 147, 30, 0.1)",
        borderBottom: "1px solid var(--line)",
        color: "var(--ink)",
      }}
    >
      <div className="flex-1">
        <strong>
          {daysLeft} {daysLeft === 1 ? "day" : "days"} left in your Pro trial.
        </strong>{" "}
        Cancel anytime, no charge during trial.
      </div>
      <div className="flex items-center gap-3">
        <Link
          to="/account"
          className="text-sm font-medium underline hover:opacity-80"
          style={{ color: "var(--ink)" }}
        >
          Manage
        </Link>
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
