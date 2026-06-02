import type { QuestionHistoryEntry } from "@/lib/questionHistory";

export type DayGroup = {
  label: string;
  entries: QuestionHistoryEntry[];
};

function startOfDay(x: Date): number {
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

/** Returns the time label shown on an individual ask card.
 *  Today/yesterday/this-week → time only (the day group label gives context)
 *  Earlier → short date, e.g. "30 May" */
export function itemTimeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);

  if (diffDays <= 6) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Groups history entries into Today / Yesterday / This week / Earlier. */
export function groupByDay(entries: QuestionHistoryEntry[]): DayGroup[] {
  const now = new Date();
  const todayStart = startOfDay(now);

  const buckets: Record<string, QuestionHistoryEntry[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    Earlier: [],
  };

  for (const entry of entries) {
    const d = new Date(entry.submittedAt);
    const diffDays = Math.floor((todayStart - startOfDay(d)) / 86400000);
    if (diffDays <= 0) buckets.Today.push(entry);
    else if (diffDays === 1) buckets.Yesterday.push(entry);
    else if (diffDays <= 6) buckets["This week"].push(entry);
    else buckets.Earlier.push(entry);
  }

  return (["Today", "Yesterday", "This week", "Earlier"] as const)
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({ label, entries: buckets[label] }));
}
