import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { DomainLanding } from "@/components/site/DomainLanding";

export const Route = createFileRoute("/sport")({
  head: () => ({
    meta: [
      { title: "Sport predictions — Prophiq" },
      { name: "description", content: "Prophiq forecasts for upcoming fixtures, finals, and head-to-head sporting events." },
    ],
  }),
  component: () => (
    <SiteShell>
      <DomainLanding domain="sport" />
    </SiteShell>
  ),
});
