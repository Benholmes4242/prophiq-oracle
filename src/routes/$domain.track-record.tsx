import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";

export const Route = createFileRoute("/$domain/track-record")({
  head: () => ({
    meta: [
      { title: "Track record — Prophiq" },
      { name: "description", content: "Historical accuracy of Prophiq consensus predictions in this domain." },
    ],
  }),
  component: TrackRecordStub,
});

function TrackRecordStub() {
  const { domain } = Route.useParams();
  return (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-amber)]">
          {domain}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--brand-ink)]">
          Track record
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Per-domain accuracy history lands in step 8.
        </p>
      </div>
    </SiteShell>
  );
}
