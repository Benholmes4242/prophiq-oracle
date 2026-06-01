import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { DomainLanding } from "@/components/site/DomainLanding";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Markets predictions — Prophiq" },
      { name: "description", content: "Informational forecasts for upcoming earnings, central bank decisions, and macro events." },
    ],
  }),
  component: () => (
    <SiteShell>
      <DomainLanding domain="markets" />
    </SiteShell>
  ),
});
