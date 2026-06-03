// Per-domain disclaimers, rendered as a card at the BOTTOM of pages (above
// the universal footer disclaimer). Markets and Sport render a card; Politics
// and Entertainment render nothing.

import type { DomainId } from "@/lib/types";

export function DomainDisclaimer({ domain }: { domain: DomainId }) {
  if (domain === "markets") {
    return (
      <DisclaimerCard>
        <strong>Informational only.</strong> Markets coverage is not financial
        advice. Do your own research before making investment decisions.
      </DisclaimerCard>
    );
  }
  if (domain === "sport") {
    return (
      <DisclaimerCard>
        <strong>Informational only.</strong> Sport coverage is not betting
        advice. Check your local laws before placing any wagers. 18+ where
        applicable.
      </DisclaimerCard>
    );
  }
  return null;
}

function DisclaimerCard({ children }: { children: React.ReactNode }) {
  return <div className="disclaimer-card">{children}</div>;
}
