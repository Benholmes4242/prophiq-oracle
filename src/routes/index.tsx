import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AskInput } from "@/components/site/AskInput";
import { AskInlinePanel } from "@/components/site/AskInlinePanel";
import { ConfidenceLabel } from "@/components/site/ConfidenceLabel";
import { PicksCarousel } from "@/components/site/PicksCarousel";
import { useHomepagePicks } from "@/hooks/useEvents";
import type { HomepagePick } from "@/lib/queries";
import { getPublicBaseUrl } from "@/lib/publicUrl";

export const Route = createFileRoute("/")({
  head: () => {
    const ogImage = `${getPublicBaseUrl()}/api/og/home`;
    return {
      meta: [
        { title: "Prophiq — What happens next?" },
        {
          name: "description",
          content:
            "From the Grand National to the FOMC, Prophiq forecasts every upcoming event worth following.",
        },
        { property: "og:title", content: "Prophiq — What happens next?" },
        {
          property: "og:description",
          content: "Calibrated forecasts for every upcoming event.",
        },
        { property: "og:image", content: ogImage },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "twitter:card", content: "summary_large_image" },
        { property: "twitter:image", content: ogImage },
      ],
    };
  },
  component: HomePage,
});

const CHIPS: Array<{ label: string; question: string }> = [
  { label: "Monaco GP", question: "Who'll win the Monaco GP?" },
  { label: "Fed June", question: "Will the Fed cut in June?" },
  { label: "UK election", question: "Who wins the next UK election?" },
  { label: "Best Picture", question: "Best Picture 2027?" },
];

function HomePage() {
  const picks = useHomepagePicks();
  const [askQ, setAskQ] = useState<string | null>(null);

  const marquee =
    picks.data?.find((p) => p.is_marquee) ?? picks.data?.[0] ?? null;

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setAskQ(trimmed);
  }

  return (
    <main className="mx-auto max-w-2xl">
      <section className="px-[22px] pb-4 pt-5">
        <h1
          className="font-display tracking-[-0.03em]"
          style={{
            fontWeight: 700,
            lineHeight: 0.94,
            fontSize: "clamp(42px, 12vw, 56px)",
          }}
        >
          What happens
          <br />
          <span style={{ color: "var(--amber)" }}>next?</span>
        </h1>
        <p
          className="mt-3.5 max-w-[30ch] font-body text-[14.5px] leading-[1.5]"
          style={{ color: "var(--ink-soft)" }}
        >
          From the Grand National to the FOMC, we forecast every upcoming event
          worth following.
        </p>
      </section>

      <section className="px-4 pt-3.5">
        <AskInput
          placeholder="Who'll win the Monaco GP?"
          onSubmit={ask}
        />
      </section>

      {!askQ && (
        <section
          className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ transition: "opacity 200ms ease-out" }}
        >
          {CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => ask(c.question)}
              className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 font-body text-[12.5px] font-medium transition-colors hover:text-[var(--ink)]"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-strong)",
                color: "var(--ink-soft)",
              }}
            >
              {c.label}
            </button>
          ))}
        </section>
      )}

      {askQ && (
        <section className="px-4 pt-2">
          <AskInlinePanel
            key={askQ}
            question={askQ}
            topic="any"
            onDismiss={() => setAskQ(null)}
          />
        </section>
      )}

      {!askQ && (
        <section className="px-4 pb-8 pt-6">
          <div className="mb-3 flex items-center gap-2.5">
            <div
              className="font-mono text-[10px] font-semibold uppercase"
              style={{
                letterSpacing: "0.22em",
                color: "var(--amber-strong)",
              }}
            >
              TOP PICK TODAY
            </div>
            <div
              className="h-px flex-1"
              style={{ background: "var(--border-soft)" }}
            />
          </div>

          {picks.isLoading ? (
            <MarqueeSkeleton />
          ) : marquee ? (
            <MarqueeCard pick={marquee} />
          ) : (
            <EmptyMarquee />
          )}

          <Link
            to="/predictions"
            className="mt-3.5 block py-2 text-center font-body text-[13px] font-semibold"
            style={{ color: "var(--amber-strong)" }}
          >
            See all picks →
          </Link>
        </section>
      )}
    </main>
  );
}

function MarqueeCard({ pick }: { pick: HomepagePick }) {
  const navigate = useNavigate();
  const pct = pick.top_pick_pct != null ? Math.round(pick.top_pick_pct) : null;

  function open() {
    navigate({
      to: "/$domain/events/$slug",
      params: { domain: pick.domain, slug: pick.slug },
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
      className="cursor-pointer rounded-[14px] p-[18px] transition-all hover:-translate-y-[1px] hover:shadow-md"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div
          className="font-mono text-[10px] font-semibold uppercase"
          style={{
            letterSpacing: "0.22em",
            color: "var(--amber-strong)",
          }}
        >
          {pick.domain.toUpperCase()}
        </div>
        <ConfidenceLabel tier={pick.confidence} />
      </div>

      <div
        className="font-display mb-3 text-[19px] font-semibold leading-[1.22]"
        style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}
      >
        {pick.title}
      </div>

      {pick.top_pick_label && pct != null && (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div
                className="mb-1 font-mono text-[9px] font-semibold uppercase"
                style={{
                  letterSpacing: "0.22em",
                  color: "var(--ink-faint)",
                }}
              >
                TOP PICK
              </div>
              <div
                className="font-display text-[20px] font-bold leading-[1.1]"
                style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
              >
                {pick.top_pick_label}
              </div>
            </div>
            <div
              className="font-mono text-[40px] font-semibold leading-none"
              style={{ color: "var(--amber)", letterSpacing: "-0.03em" }}
            >
              {pct}
              <span className="text-[18px]">%</span>
            </div>
          </div>
          <div
            className="mt-3 h-1 overflow-hidden rounded-full"
            style={{ background: "var(--border-soft)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--amber)" }}
            />
          </div>
        </>
      )}

      {pick.reasoning_excerpt && (
        <div
          className="mt-3 font-body text-[12.5px] leading-[1.4]"
          style={{ color: "var(--ink-soft)" }}
        >
          {pick.reasoning_excerpt}
        </div>
      )}
    </div>
  );
}

function EmptyMarquee() {
  return (
    <div
      className="rounded-[14px] p-8 text-center"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-strong)",
      }}
    >
      <div
        className="font-body text-[14px]"
        style={{ color: "var(--ink-soft)" }}
      >
        Today's picks are calibrating. Check back shortly.
      </div>
    </div>
  );
}

function MarqueeSkeleton() {
  return (
    <div
      className="h-[220px] animate-pulse rounded-[14px]"
      style={{ background: "var(--bg-card)" }}
    />
  );
}
