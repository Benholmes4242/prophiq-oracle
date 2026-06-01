import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask Prophiq" },
      { name: "description", content: "Submit a question and watch the consensus pipeline run live." },
    ],
  }),
  component: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--brand-ink)]">Ask Prophiq</h1>
        <p className="mt-3 text-sm text-slate-600">SSE-driven submit form lands in step 7.</p>
      </div>
    </SiteShell>
  ),
});
