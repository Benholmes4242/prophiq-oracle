import { Link, createFileRoute } from "@tanstack/react-router";
import { getPublicBaseUrl } from "@/lib/publicUrl";
import { Footer } from "@/components/site/Footer";
import { ReceiptsHero } from "@/components/site/ReceiptsHero";
import { AccuracyChart } from "@/components/site/AccuracyChart";
import { NotableCallCard } from "@/components/site/NotableCallCard";
import { RecentResolvedList } from "@/components/site/RecentResolvedList";
import {
  ScoredYesterday,
  ScoredYesterdayHeader,
} from "@/components/site/ScoredYesterday";
import {
  useReceiptsStats,
  useRecentResolved,
  useNotableCalls,
  useScoredYesterday,
} from "@/hooks/useEvents";
import type { RecentResolved, NotableCall } from "@/lib/queries";

export const Route = createFileRoute("/receipts")({
  head: () => ({
    meta: [
      { title: "Receipts — Prophiq" },
      {
        name: "description",
        content:
          "Every Prophiq forecast scored against reality. Hit rates, recent calls, and the upsets we got right (and wrong).",
      },
      { property: "og:title", content: "Receipts — Prophiq" },
      {
        property: "og:description",
        content: "Calibrated forecasts, honestly scored. The running tally.",
      },
      {
        property: "og:url",
        content: `${getPublicBaseUrl()}/receipts`,
      },
    ],
    links: [
      {
        rel: "canonical",
        href: `${getPublicBaseUrl()}/receipts`,
      },
    ],
  }),
  component: ReceiptsPage,
});

function SectionHeader({
  label,
  trailing,
}: {
  label: string;
  trailing?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 pb-2 pt-2">
      <span
        className="font-mono text-[10px] tracking-[0.2em]"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        {label}
      </span>
      <span
        className="h-px flex-1"
        style={{ background: "var(--border-soft)" }}
      />
      {trailing && (
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--ink-faint)" }}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

function ReceiptsPage() {
  const stats = useReceiptsStats();
  const recent = useRecentResolved(10);
  const notable = useNotableCalls();
  const scored = useScoredYesterday(6);

  return (
    <>
      <main className="mx-auto max-w-2xl">
        {/* Hero */}
        <section className="px-5 pb-7 pt-9">
          <p
            className="font-mono text-[10px] tracking-[0.22em]"
            style={{ color: "var(--amber-strong)", fontWeight: 600 }}
          >
            RECEIPTS
          </p>
          <h1
            className="mt-3 font-display tracking-[-0.03em]"
            style={{
              fontWeight: 700,
              lineHeight: 0.94,
              fontSize: "clamp(40px, 11vw, 56px)",
            }}
          >
            Our calls,
            <br />
            <span style={{ color: "var(--amber)" }}>scored.</span>
          </h1>
          <p
            className="mt-5 max-w-[34ch] font-body text-[16px] leading-[1.45]"
            style={{ color: "var(--ink-soft)" }}
          >
            Every Prophiq forecast is scored against reality. Here's the
            running tally.
          </p>
        </section>

        {/* Hero stats */}
        <section className="px-5 pb-8">
          {stats.isLoading || !stats.data ? (
            <div
              className="h-44 animate-pulse rounded-2xl"
              style={{ background: "var(--bg-card)" }}
            />
          ) : (
            <ReceiptsHero
              eventsScored={stats.data.events_scored}
              topPickHitRate={stats.data.top_pick_hit_rate}
              topThreeHitRate={stats.data.top_three_hit_rate}
            />
          )}
        </section>

        {/* Accuracy chart */}
        <SectionHeader label="ACCURACY · LAST 30 DAYS" />
        <section className="px-5 pb-8 pt-3">
          <AccuracyChart points={stats.data?.last_30d_accuracy ?? []} />
        </section>

        {/* Recent calls */}
        <SectionHeader
          label="RECENT CALLS"
          trailing={
            recent.data
              ? `${recent.data.filter((r: RecentResolved) => r.correct).length}/${recent.data.length} correct`
              : undefined
          }
        />
        <section className="px-5 pb-8 pt-3">
          <RecentResolvedList calls={recent.data ?? []} />
        </section>

        {/* Notable */}
        <SectionHeader label="NOTABLE" />
        <section className="space-y-3 px-5 pb-10 pt-3">
          {(notable.data ?? []).map((c: NotableCall) => (
            <NotableCallCard key={c.event_id} call={c} />
          ))}
          {notable.data && notable.data.length === 0 && (
            <p
              className="rounded-xl px-4 py-6 text-center font-body text-[13px]"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-soft)",
                color: "var(--ink-soft)",
              }}
            >
              Notable calls will appear here as more events resolve.
            </p>
          )}
        </section>

        {/* Methodology */}
        <section className="px-5 pb-12">
          <Link
            to="/about"
            className="inline-flex items-center gap-2 font-body text-[14px]"
            style={{ color: "var(--amber-strong)", fontWeight: 600 }}
          >
            See how we make our picks → How it works
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
