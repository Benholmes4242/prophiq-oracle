// Top-of-page regulatory disclaimers. Used on /markets, /politics and their
// event detail pages. Sport and entertainment intentionally do not render one.

import type { DomainId } from "@/lib/types";

export function DomainDisclaimer({ domain }: { domain: DomainId }) {
  if (domain === "markets") {
    return (
      <Banner tone="info">
        <strong>Informational only.</strong> Markets coverage is not financial advice. Do
        your own research before making any investment decisions.
      </Banner>
    );
  }
  if (domain === "politics") {
    return (
      <Banner tone="neutral">
        <strong>Non-partisan.</strong> Prophiq publishes neutral, model-generated forecasts.
        We do not endorse any candidate, party, or political outcome.
      </Banner>
    );
  }
  return null;
}

function Banner({
  tone,
  children,
}: {
  tone: "info" | "neutral";
  children: React.ReactNode;
}) {
  const cls =
    tone === "info"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-100 text-slate-800";
  return (
    <div className={`border-b ${cls}`}>
      <div className="mx-auto max-w-6xl px-4 py-2.5 text-xs sm:px-6 sm:text-sm">{children}</div>
    </div>
  );
}
