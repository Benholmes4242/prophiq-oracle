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
  const [draft, setDraft] = useState("");

  const marquee =
    picks.data?.find((p) => p.is_marquee) ?? picks.data?.[0] ?? null;
  const restPicks =
    picks.data?.filter((p) => p !== marquee).slice(0, 4) ?? [];

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setAskQ(trimmed);
    setDraft("");
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-between px-4 pb-4">
        {/* TOP: picks or ask panel */}
        {askQ ? (
          <section className="pt-2">
            <AskInlinePanel
              key={askQ}
              question={askQ}
              topic="any"
              onDismiss={() => setAskQ(null)}
            />
          </section>
        ) : (
          <div>
            <section className="pt-4">
              <SectionLabel>TOP PICK TODAY</SectionLabel>
              {picks.isLoading ? (
                <MarqueeSkeleton />
              ) : marquee ? (
                <MarqueeCard pick={marquee} />
              ) : (
                <EmptyMarquee />
              )}
            </section>

            {restPicks.length >= 2 && (
              <section className="pt-5">
                <div className="px-1">
                  <SectionLabel>MORE FORECASTS</SectionLabel>
                </div>
                <div className="-mx-4">
                  <PicksCarousel picks={restPicks} />
                </div>
                <Link
                  to="/predictions"
                  className="mt-2 block py-2 text-center font-body text-[13px] font-semibold"
                  style={{ color: "var(--amber-2)" }}
                >
                  See all picks →
                </Link>
              </section>
            )}
          </div>
        )}

        {/* BOTTOM: hero invitation + chips + input */}
        <BottomCTA
          showChips={!askQ}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={ask}
        />
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <div
        className="font-mono text-[10px] font-semibold uppercase"
        style={{ letterSpacing: "0.22em", color: "var(--amber-2)" }}
      >
        {children}
      </div>
      <div className="h-px flex-1" style={{ background: "var(--line)" }} />
    </div>
  );
}

function BottomCTA({
  showChips,
  draft,
  onDraftChange,
  onSubmit,
}: {
  showChips: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: (q: string) => void;
}) {
  return (
    <div className="pt-4" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div
        className="font-display mb-3.5 text-center"
        style={{
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
        }}
      >
        What happens <span style={{ color: "var(--amber)" }}>next?</span>
      </div>

      {showChips && (
        <div className="chips-scroll -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1">
          {CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => onSubmit(c.question)}
              className="shrink-0 whitespace-nowrap rounded-full font-body text-[12.5px] font-medium active:scale-[0.96]"
              style={{
                padding: "8px 13px",
                background: "var(--chip-bg)",
                color: "var(--ink-2)",
                border: "none",
                transition: "all 180ms var(--ease-ios)",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <AskInput
        value={draft}
        onChange={onDraftChange}
        onSubmit={onSubmit}
        placeholder="Ask anything…"
      />
    </div>
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
      className="marquee-card cursor-pointer"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: "18px 20px",
        boxShadow: "var(--shadow-card)",
        transition: "all 240ms var(--ease-ios)",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div
          className="font-mono text-[10px] font-semibold uppercase"
          style={{ letterSpacing: "0.22em", color: "var(--amber-2)" }}
        >
          {pick.domain.toUpperCase()}
        </div>
        <ConfidenceLabel tier={pick.confidence} />
      </div>

      <div
        className="font-display mb-3"
        style={{
          fontSize: 19,
          fontWeight: 600,
          lineHeight: 1.2,
          color: "var(--ink)",
          letterSpacing: "-0.02em",
        }}
      >
        {pick.title}
      </div>

      {pick.top_pick_label && pct != null && (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div
                className="mb-1 font-mono text-[9px] font-semibold uppercase"
                style={{ letterSpacing: "0.22em", color: "var(--ink-3)" }}
              >
                TOP PICK
              </div>
              <div
                className="font-display"
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: "var(--ink)",
                  letterSpacing: "-0.02em",
                }}
              >
                {pick.top_pick_label}
              </div>
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 38,
                fontWeight: 600,
                lineHeight: 0.95,
                color: "var(--amber)",
                letterSpacing: "-0.04em",
                fontFeatureSettings: "'tnum'",
              }}
            >
              {pct}
              <span style={{ fontSize: 18 }}>%</span>
            </div>
          </div>
          <div
            className="mt-3 h-1 overflow-hidden rounded-full"
            style={{ background: "var(--line)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background:
                  "linear-gradient(90deg, var(--amber), var(--amber-2))",
                transition: "width 600ms var(--ease-ios)",
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function EmptyMarquee() {
  return (
    <div
      className="rounded-[18px] p-8 text-center"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--line-2)",
      }}
    >
      <div className="font-body text-[14px]" style={{ color: "var(--ink-2)" }}>
        Today's picks are calibrating. Check back shortly.
      </div>
    </div>
  );
}

function MarqueeSkeleton() {
  return (
    <div
      className="h-[180px] animate-pulse rounded-[18px]"
      style={{ background: "var(--bg-card)" }}
    />
  );
}
