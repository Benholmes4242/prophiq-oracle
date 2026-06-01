import { createFileRoute } from "@tanstack/react-router";
import { DomainPage } from "@/components/site/DomainPage";

export const Route = createFileRoute("/sport")({
  head: () => ({
    meta: [
      { title: "Sport — Prophiq" },
      { name: "description", content: "Prophiq forecasts for upcoming fixtures, finals, and head-to-head sporting events." },
      { property: "og:title", content: "Sport — Prophiq" },
      { property: "og:description", content: "Prophiq forecasts for upcoming fixtures, finals, and head-to-head sporting events." },
    ],
  }),
  component: () => <DomainPage domain="sport" />,
});
