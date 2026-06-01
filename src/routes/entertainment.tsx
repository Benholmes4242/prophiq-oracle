import { createFileRoute } from "@tanstack/react-router";
import { DomainPage } from "@/components/site/DomainPage";

export const Route = createFileRoute("/entertainment")({
  head: () => ({
    meta: [
      { title: "Entertainment — Prophiq" },
      { name: "description", content: "Prophiq forecasts for upcoming awards ceremonies, release weekends, and finales." },
      { property: "og:title", content: "Entertainment — Prophiq" },
      { property: "og:description", content: "Prophiq forecasts for upcoming awards ceremonies, release weekends, and finales." },
    ],
  }),
  component: () => <DomainPage domain="entertainment" />,
});
