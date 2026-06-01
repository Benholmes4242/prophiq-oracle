import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Prophiq" },
      { name: "description", content: "Reach the team behind Prophiq." },
      { property: "og:title", content: "Contact — Prophiq" },
      {
        property: "og:description",
        content: "Reach the team behind Prophiq.",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://prophiq-opinion-nexus.lovable.app/contact",
      },
    ],
  }),
  component: ContactPage,
});

const PATHS = [
  { label: "General", email: "hello@prophiq.io" },
  { label: "Privacy / data", email: "privacy@prophiq.io" },
  { label: "Legal", email: "legal@prophiq.io" },
  { label: "Press", email: "press@prophiq.io" },
];

function ContactPage() {
  return (
    <LegalPage
      title="Contact"
      accent="."
      subtitle="Reach the team behind Prophiq."
    >
      <ul className="not-prose mt-4 space-y-3">
        {PATHS.map((p) => (
          <li
            key={p.email}
            className="flex flex-col gap-1 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <span
              className="font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: "var(--ink-faint)" }}
            >
              {p.label}
            </span>
            <a
              href={`mailto:${p.email}`}
              className="font-body text-[15px]"
              style={{ color: "var(--ink)" }}
            >
              {p.email}
            </a>
          </li>
        ))}
      </ul>
    </LegalPage>
  );
}
