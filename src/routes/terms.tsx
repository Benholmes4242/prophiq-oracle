import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms — Prophiq" },
      {
        name: "description",
        content:
          "The rules of the road. By using Prophiq, you agree to them.",
      },
      { property: "og:title", content: "Terms — Prophiq" },
      {
        property: "og:description",
        content: "The rules of the road. By using Prophiq, you agree to them.",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://prophiq-opinion-nexus.lovable.app/terms",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      accent="."
      subtitle="The rules of the road. By using Prophiq, you agree to them."
    >
      <h2>Acceptance of terms</h2>
      <p>
        By accessing or using Prophiq, you agree to these terms. If you do not
        agree, do not use the service.
      </p>

      <h2>What Prophiq is</h2>
      <p>
        Prophiq is an AI-generated forecasts platform. Probabilities shown are
        calibrated estimates produced by an automated engine — they are not
        advice, predictions of certainty, or guarantees.
      </p>

      <h2>What Prophiq is not</h2>
      <p>
        Prophiq is not financial advice, not legal advice, not a gambling
        guarantee, and not a political endorsement. Coverage of markets,
        politics, sport and entertainment is informational only.
      </p>

      <h2>Age requirement</h2>
      <p>
        You must be 18 or older to use any markets-related content. Some
        jurisdictions impose additional restrictions on sports-related
        forecasting; it is your responsibility to comply with local law.
      </p>

      <h2>User-submitted content</h2>
      <p>
        Questions submitted via the Ask feature may be published on the
        Prophiq site. Do not submit personally identifying information or
        anything you would not want made public.
      </p>

      <h2>Acceptable use</h2>
      <p>
        No spam, no abuse of rate limits, no scraping the public surface for
        resale, no attempts to interfere with operation of the service.
      </p>

      <h2>Disclaimers</h2>
      <p>
        Markets coverage is not financial advice. Politics coverage is
        non-partisan and not an endorsement of any candidate or party. Sport
        coverage is for entertainment only and is not a betting tip.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        Prophiq is provided “as is.” To the maximum extent permitted by law,
        we exclude all liability for losses arising from use of the service.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of England and Wales. Disputes
        are subject to the exclusive jurisdiction of the courts of London.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href="mailto:legal@prophiq.io">legal@prophiq.io</a>.
      </p>
    </LegalPage>
  );
}
