import { useState } from "react";
import { createCheckoutSession } from "../../lib/billing";

interface TierCardProps {
  tier: string;
  displayName: string;
  priceCopy: string;
  cadenceCopy: string;
  savingsCopy?: string;
  features: string[];
  ctaLabel: string;
  ctaDisabled?: boolean;
  isPopular?: boolean;
  priceId?: string;
  onCta?: () => void;
}

export function TierCard({
  displayName,
  priceCopy,
  cadenceCopy,
  savingsCopy,
  features,
  ctaLabel,
  ctaDisabled,
  isPopular,
  priceId,
  onCta,
}: TierCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCta() {
    if (onCta) {
      onCta();
      return;
    }
    if (!priceId || loading || ctaDisabled) return;
    setLoading(true);
    setError(null);
    try {
      const url = await createCheckoutSession(priceId);
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message || "Failed to start checkout");
      setLoading(false);
    }
  }

  return (
    <div
      className={`relative rounded-2xl border p-6 flex flex-col ${
        isPopular ? "ring-2 ring-[var(--ink)]" : ""
      }`}
      style={{
        background: "var(--bg)",
        borderColor: "var(--line)",
      }}
    >
      {isPopular && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
          style={{
            background: "var(--bg)",
            color: "var(--ink)",
            border: "1px solid var(--line)",
            letterSpacing: "0.04em",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--amber)" }}
            aria-hidden="true"
          />
          MOST POPULAR
        </span>
      )}

      <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--ink)" }}>
        {displayName}
      </h3>

      <div className="mb-4">
        <span className="text-3xl font-bold" style={{ color: "var(--ink)" }}>
          {priceCopy}
        </span>
        <span className="ml-1 text-sm text-[var(--ink)]/60">{cadenceCopy}</span>
      </div>

      {savingsCopy && (
        <p className="text-xs font-medium mb-4" style={{ color: "var(--green, #16a34a)" }}>
          {savingsCopy}
        </p>
      )}

      <ul className="space-y-2 mb-6 flex-grow">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5" style={{ color: "var(--green, #16a34a)" }}>{"\u2713"}</span>
            <span style={{ color: "var(--ink)" }}>{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={handleCta}
        disabled={ctaDisabled || loading}
        className="w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-opacity disabled:opacity-50"
        style={{
          background: "var(--ink)",
          color: "white",
        }}
      >
        {loading ? "Loading..." : ctaLabel}
      </button>

      {error && (
        <p className="mt-2 text-xs text-red-600 text-center">{error}</p>
      )}
    </div>
  );
}
