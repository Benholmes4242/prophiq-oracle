import { createFileRoute } from "@tanstack/react-router";
import { DomainPage } from "@/components/site/DomainPage";

export const Route = createFileRoute("/politics")({
  head: () => ({
    meta: [
      { title: "Politics — Prophiq" },
      { name: "description", content: "Non-partisan Prophiq forecasts for upcoming elections, leadership contests, and political moments." },
      { property: "og:title", content: "Politics — Prophiq" },
      { property: "og:description", content: "Non-partisan Prophiq forecasts for upcoming elections, leadership contests, and political moments." },
    ],
  }),
  component: () => <DomainPage domain="politics" />,
});
