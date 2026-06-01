import type { DomainId } from "@/lib/types";
import { DOMAIN_LABEL } from "@/lib/types";

export function DomainBadge({ domain }: { domain: DomainId }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-700">
      {DOMAIN_LABEL[domain]}
    </span>
  );
}
