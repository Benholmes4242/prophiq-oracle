import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { DomainLanding } from "@/components/site/DomainLanding";

export const Route = createFileRoute("/entertainment")({
  head: () => ({
    meta: [
      { title: "Entertainment predictions — Prophiq" },
      { name: "description", content: "Prophiq forecasts for upcoming awards ceremonies, release weekends, and finales." },
    ],
  }),
  component: () => (
    <SiteShell>
      <DomainLanding domain="entertainment" />
    </SiteShell>
  ),
});
