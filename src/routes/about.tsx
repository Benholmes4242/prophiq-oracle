import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Prophiq" },
      { name: "description", content: "How Prophiq's multi-model consensus works." },
    ],
  }),
  component: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--brand-ink)]">About Prophiq</h1>
        <p className="mt-3 text-sm text-slate-600">Detailed methodology page lands in step 8.</p>
      </div>
    </SiteShell>
  ),
});
