import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { DomainDisclaimer } from "@/components/site/DisclaimerBanner";
import type { DomainId } from "@/lib/types";
import { DOMAINS } from "@/lib/types";

export const Route = createFileRoute("/$domain/events/$slug")({
  head: () => ({
    meta: [
      { title: "Event — Prophiq" },
      { name: "description", content: "Multi-model consensus prediction for this event, with reasons and follow-up chat." },
    ],
  }),
  component: EventDetailStub,
});

function EventDetailStub() {
  const { domain, slug } = Route.useParams();
  const domainId = (DOMAINS as string[]).includes(domain) ? (domain as DomainId) : null;
  return (
    <SiteShell>
      {domainId && <DomainDisclaimer domain={domainId} />}
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-amber)]">
          {domain}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--brand-ink)]">
          Event detail
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Full event detail page (with dual-mode toggle and chat panel) lands in step 6.
        </p>
        <p className="mt-1 text-xs font-mono text-slate-400">slug: {slug}</p>
      </div>
    </SiteShell>
  );
}
