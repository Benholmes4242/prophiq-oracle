import { Link } from "@tanstack/react-router";
import type { DomainId } from "@/lib/types";
import { DOMAIN_LABEL, DOMAIN_TAGLINE } from "@/lib/types";

export function DomainCard({
  domain,
  upcomingCount,
}: {
  domain: DomainId;
  upcomingCount?: number;
}) {
  return (
    <Link
      to={`/${domain}` as "/sport"}
      className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--brand-border)] bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-amber)]">
            {DOMAIN_LABEL[domain]}
          </span>
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-[var(--brand-amber)] opacity-70 transition-opacity group-hover:opacity-100"
          />
        </div>
        <p className="mt-3 text-sm leading-snug text-slate-600">{DOMAIN_TAGLINE[domain]}</p>
      </div>

      <div className="mt-6 flex items-center justify-between text-xs">
        {typeof upcomingCount === "number" && upcomingCount > 0 ? (
          <span className="font-mono text-slate-500">{upcomingCount} scheduled</span>
        ) : (
          <span />
        )}
        <span className="font-medium text-[var(--brand-ink)] group-hover:underline decoration-[var(--brand-amber)] decoration-2 underline-offset-4">
          Explore →
        </span>
      </div>
    </Link>
  );
}
