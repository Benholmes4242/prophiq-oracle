import { createFileRoute } from "@tanstack/react-router";
import { DomainPage } from "@/components/site/DomainPage";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Markets — Prophiq" },
      { name: "description", content: "Informational forecasts for upcoming earnings, central bank decisions, and macro prints." },
      { property: "og:title", content: "Markets — Prophiq" },
      { property: "og:description", content: "Informational forecasts for upcoming earnings, central bank decisions, and macro prints." },
    ],
  }),
  component: () => <DomainPage domain="markets" />,
});
