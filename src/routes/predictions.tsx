import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";

export const Route = createFileRoute("/predictions")({
  head: () => ({
    meta: [
      { title: "All predictions — Prophiq" },
      { name: "description", content: "Browse every consensus prediction across sport, politics, markets, and entertainment." },
    ],
  }),
  component: () => (
    <SiteShell>
      <ComingSoon title="All predictions" body="Filterable feed lands in step 4." />
    </SiteShell>
  ),
});

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-[var(--brand-ink)]">{title}</h1>
      <p className="mt-3 text-sm text-slate-600">{body}</p>
    </div>
  );
}
