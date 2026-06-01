import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { DomainLanding } from "@/components/site/DomainLanding";

export const Route = createFileRoute("/politics")({
  head: () => ({
    meta: [
      { title: "Politics predictions — Prophiq" },
      { name: "description", content: "Non-partisan consensus predictions for upcoming elections, votes, and political contests." },
    ],
  }),
  component: () => (
    <SiteShell>
      <DomainLanding domain="politics" />
    </SiteShell>
  ),
});
