import type { EventSource } from "@/lib/types";

export function SourceBadge({ source }: { source: EventSource }) {
  const isDiscovered = source === "discovered";
  return (
    <span
      className={
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        (isDiscovered
          ? "bg-[var(--brand-amber)]/15 text-[var(--brand-amber)]"
          : "bg-slate-200 text-slate-700")
      }
    >
      {isDiscovered ? "Discovered" : "Community"}
    </span>
  );
}
