import { Link } from "@tanstack/react-router";
import { useUsageQuota } from "../../hooks/useUsageQuota";

export function TierBadge() {
  const { usage } = useUsageQuota();

  const tier = usage?.tier ?? "free";
  const isTrialing = usage?.isTrialing ?? false;
  const trialEnd = usage?.trialEnd ?? null;

  let label = "FREE";
  let bgColor = "transparent";
  let textColor = "var(--ink)";
  let borderColor = "var(--line)";

  if (isTrialing && trialEnd) {
    const daysLeft = Math.max(
      0,
      Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    label = `TRIAL \u00b7 ${daysLeft}d`;
    bgColor = "var(--bg)";
    textColor = "var(--amber)";
    borderColor = "var(--amber)";
  } else if (tier === "standard") {
    label = "STANDARD";
    bgColor = "var(--ink)";
    textColor = "white";
    borderColor = "var(--ink)";
  } else if (tier === "pro") {
    label = "PRO";
    bgColor = "var(--ink)";
    textColor = "white";
    borderColor = "var(--ink)";
  }

  return (
    <Link
      to="/account"
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-80"
      style={{
        background: bgColor,
        color: textColor,
        border: `1px solid ${borderColor}`,
        letterSpacing: "0.06em",
        fontFamily: "Geist Mono, monospace",
      }}
    >
      {label}
    </Link>
  );
}
