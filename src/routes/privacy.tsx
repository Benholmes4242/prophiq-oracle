import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — Prophiq" },
      {
        name: "description",
        content:
          "What Prophiq collects, what we don't, and how to ask us to delete it.",
      },
      { property: "og:title", content: "Privacy — Prophiq" },
      {
        property: "og:description",
        content: "What we collect, what we don't, and how to delete it.",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://prophiq-opinion-nexus.lovable.app/privacy",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      accent="."
      subtitle="What we collect, what we don't, and how to ask us to delete it."
    >
      <h2>What we collect</h2>
      <p>
        Hashed IP addresses (for rate limiting), the questions you submit via
        the Ask box, and standard browser metadata for security. We do not
        collect your name, email, or phone number unless you explicitly provide
        them — for example, by signing up for a future email digest.
      </p>

      <h2>Why we collect it</h2>
      <p>
        To run the service, prevent abuse, enforce rate limits, and measure
        aggregate usage so we can improve coverage and accuracy.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Submitted questions and the resulting predictions are retained
        indefinitely — they are the product. IP hashes are kept for 30 days.
        Aggregate analytics are kept for 24 months.
      </p>

      <h2>Who we share it with</h2>
      <p>
        Third-party model providers receive the question text and research
        context required to generate a forecast. We do not send personally
        identifying information to any third party.
      </p>

      <h2>Your rights</h2>
      <p>
        Under GDPR and similar regimes, you can request deletion of any data
        tied to you. Write to{" "}
        <a href="mailto:privacy@prophiq.io">privacy@prophiq.io</a> and we will
        respond within 30 days.
      </p>

      <h2>Cookies</h2>
      <p>
        Minimal session cookies only. No tracking pixels in this release. If we
        add analytics in future, this page will be updated and a consent banner
        will be shown before any tracking begins.
      </p>
    </LegalPage>
  );
}
