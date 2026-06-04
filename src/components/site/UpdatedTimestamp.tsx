// UpdatedTimestamp — small "Updated Xm ago" pill used on prediction cards.
// Auto-refreshes every minute so the relative time stays accurate without
// remounting the parent.

import { useEffect, useState } from "react";

interface Props {
  iso: string | null | undefined;
  className?: string;
  prefix?: string;
}

export function UpdatedTimestamp({ iso, className, prefix = "Updated" }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return null;
  const label = formatRelative(iso);
  return (
    <span
      className={"font-mono text-[10px] " + (className ?? "")}
      style={{ color: "var(--ink-faint)" }}
      suppressHydrationWarning
    >
      {prefix} {label}
    </span>
  );
}

export function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.floor((Date.now() - d) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
