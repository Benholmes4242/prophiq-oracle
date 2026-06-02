import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  clearHistory,
  getHistory,
  type QuestionHistoryEntry,
} from "@/lib/questionHistory";
import { domainLabel } from "@/lib/domainLabel";
import { itemTimeLabel, groupByDay, type DayGroup } from "@/lib/relativeTime";
import { PhiMark } from "@/components/brand/PhiMark";

export const Route = createFileRoute("/asked")({
  head: () => ({
    meta: [
      { title: "Asked — prophiq." },
      {
        name: "description",
        content: "Your recent Prophiq questions. Stored only on this device.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AskedPage,
});

function AskedPage() {
  const [history, setHistory] = useState<QuestionHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setHistory(getHistory());
    setMounted(true);
  }, []);

  const groups = useMemo(() => groupByDay(history), [history]);

  function handleClear() {
    if (
      typeof window !== "undefined" &&
      window.confirm("Clear your question history?")
    ) {
      clearHistory();
      setHistory([]);
    }
  }

  const isEmpty = mounted && history.length === 0;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-9">
      <PageHeader hasItems={history.length > 0} onClear={handleClear} />
      {isEmpty ? <EmptyState /> : <DayGroups groups={groups} />}
    </main>
  );
}

function PageHeader({
  hasItems,
  onClear,
}: {
  hasItems: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mb-7">
      <div className="flex items-start justify-between gap-4">
        <h1
          className="font-body tracking-[-0.025em]"
          style={{
            fontWeight: 700,
            fontSize: 36,
            lineHeight: 1,
            color: "var(--ink)",
          }}
        >
          Asked<span style={{ color: "var(--amber)" }}>.</span>
        </h1>
        {hasItems && (
          <button
            type="button"
            onClick={onClear}
            className="font-body text-[13px] transition-ios-colors"
            style={{ color: "var(--ink-faint)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "var(--ink)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--ink-faint)")
            }
          >
            Clear
          </button>
        )}
      </div>
      <PrivacyNote />
    </div>
  );
}

function PrivacyNote() {
  return (
    <div
      className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase"
      style={{
        letterSpacing: "0.22em",
        color: "var(--ink-faint)",
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, background: "var(--amber)" }}
      />
      Stored only on this device
    </div>
  );
}

function DayGroups({ groups }: { groups: DayGroup[] }) {
  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.label}>
          <div
            className="mb-2.5 font-mono text-[10px] uppercase"
            style={{
              letterSpacing: "0.22em",
              color: "var(--ink-faint)",
              fontWeight: 600,
            }}
          >
            {group.label}
          </div>
          <div className="space-y-2">
            {group.entries.map((entry) => (
              <AskedItem key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AskedItem({ entry }: { entry: QuestionHistoryEntry }) {
  const hasEvent = !!(entry.eventSlug && entry.eventDomain);
  const label = domainLabel(entry.eventDomain);
  const time = itemTimeLabel(entry.submittedAt);

  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div
          className="font-body text-[15px] leading-[1.35]"
          style={{ color: "var(--ink)", fontWeight: 500 }}
        >
          {entry.question}
        </div>
        <div
          className="mt-2 flex items-center gap-2 font-mono text-[11px]"
          style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
        >
          <span>{time}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block rounded-full"
              style={{ width: 5, height: 5, background: "var(--amber)" }}
            />
            {label}
          </span>
        </div>
      </div>
      <span
        aria-hidden
        className="ask-chevron shrink-0 self-center font-body text-[22px] leading-none transition-ios"
        style={{ color: "var(--ink-faint)" }}
      >
        ›
      </span>
    </>
  );

  const className =
    "ask-item flex items-stretch gap-3 rounded-xl px-4 py-3.5 transition-ios";
  const style = {
    background: "var(--bg-card)",
    border: "1px solid var(--border-soft)",
    textDecoration: "none",
  } as const;

  if (hasEvent) {
    return (
      <Link
        to="/$domain/events/$slug"
        params={{ domain: entry.eventDomain!, slug: entry.eventSlug! }}
        className={className}
        style={style}
      >
        {inner}
      </Link>
    );
  }

  return (
    <Link
      to="/"
      search={{ q: entry.question }}
      className={className}
      style={style}
    >
      {inner}
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center pt-16 text-center">
      <div style={{ opacity: 0.18 }} aria-hidden>
        <PhiMark size={64} strokeWidth={9} />
      </div>
      <p
        className="mt-6 max-w-[32ch] font-body text-[15px] leading-relaxed"
        style={{ color: "var(--ink-soft)" }}
      >
        Your questions will live here once you've asked one.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center rounded-full px-5 py-2.5 font-body text-[14px] font-semibold transition-ios"
        style={{ background: "var(--amber)", color: "#fff" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.transform = "translateY(-1px)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.transform = "translateY(0)")
        }
      >
        Ask something →
      </Link>
    </div>
  );
}
