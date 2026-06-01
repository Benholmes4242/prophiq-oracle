import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { TodaysLeadCard } from "@/components/site/TodaysLeadCard";
import { AlsoTodayList } from "@/components/site/AlsoTodayList";
import { WhatWeAnalyseSection } from "@/components/site/WhatWeAnalyseSection";
import { AskInput } from "@/components/site/AskInput";
import { AskInlinePanel } from "@/components/site/AskInlinePanel";
import {
  ScoredYesterday,
  ScoredYesterdayHeader,
} from "@/components/site/ScoredYesterday";
import { useHomepagePicks, useScoredYesterday } from "@/hooks/useEvents";
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
            "From the Grand National to the FOMC, Prophiq forecasts every upcoming event worth following. Ask anything.",
        },
        { property: "og:title", content: "Prophiq — What happens next?" },
        {
          property: "og:description",
          content: "Calibrated forecasts for every upcoming event. Ask anything.",
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


const EXAMPLES = [
  "Who'll win the Monaco GP?",
  "Will the Fed cut in June?",
  "Best bets for the World Cup opener?",
  "Will Alcaraz win Roland Garros?",
  "Who wins the Armenian election?",
];

function HomePage() {
  const picks = useHomepagePicks();
  const scored = useScoredYesterday(6);
  const lead = picks.data?.[0];
  const rest = picks.data?.slice(1, 4) ?? [];

  const [askQ, setAskQ] = useState<string | null>(null);

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setAskQ(trimmed);
  }

  return (
    <div style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <Header />
      <main className="mx-auto max-w-2xl">
        <Hero onAsk={ask} askActive={askQ !== null} />

        {askQ && (
          <section className="px-5">
            <AskInlinePanel
              key={askQ}
              question={askQ}
              topic="any"
              onDismiss={() => setAskQ(null)}
            />
          </section>
        )}

        {/* Today's Lead */}
        <section className="px-5 pb-6">
          {picks.isLoading ? (
            <LeadSkeleton />
          ) : lead ? (
            <TodaysLeadCard pick={lead} />
          ) : (
            <EmptyLead />
          )}
        </section>

        {/* Also today */}
        <SectionHeader label="ALSO TODAY" trailing={`${rest.length} picks`} />
        <section className="px-5 pb-8 pt-3">
          {picks.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl"
                  style={{ background: "var(--bg-card)" }}
                />
              ))}
            </div>
          ) : (
            <AlsoTodayList picks={rest} />
          )}
        </section>

        {/* What we analyse */}
        <SectionHeader label="WHAT WE ANALYSE" />
        <section className="px-5 pb-8 pt-3">
          <WhatWeAnalyseSection />
        </section>

        {/* Scored yesterday */}
        <div className="px-5 pb-2 pt-2">
          <ScoredYesterdayHeader picks={scored.data ?? []} />
        </div>
        <section className="px-5 pb-10 pt-3">
          <ScoredYesterday picks={scored.data ?? []} />
        </section>
      </main>
      <Footer />
    </div>
  );
}

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

function Hero({
  onAsk,
  askActive,
}: {
  onAsk: (q: string) => void;
  askActive: boolean;
}) {
  return (
    <section className="px-5 pb-7 pt-9">
      <h1
        className="font-display tracking-[-0.035em]"
        style={{
          fontWeight: 700,
          lineHeight: 0.94,
          fontSize: "clamp(48px, 11vw, 72px)",
        }}
      >
        What happens
        <br />
        <span style={{ color: "var(--amber)" }}>next?</span>
      </h1>

      <p
        className="mt-5 max-w-[34ch] font-body text-[16px] leading-[1.45]"
        style={{ color: "var(--ink-soft)" }}
      >
        From the Grand National to the FOMC, we forecast every upcoming event
        worth following. Ask anything.
      </p>

      <div className="mt-7">
        <AskInput placeholders={EXAMPLES} onSubmit={onAsk} />
      </div>

      {/* Example chips — tap to ask directly. Fade out while panel is active. */}
      <div
        className="-mx-5 mt-4 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-hidden={askActive}
        style={{
          opacity: askActive ? 0 : 1,
          pointerEvents: askActive ? "none" : undefined,
          transition: "opacity 200ms ease-out",
        }}
      >
        <div className="flex w-max gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAsk(q)}
              className="whitespace-nowrap rounded-full px-3 py-1.5 font-body text-[12.5px]"
              style={{
                border: "1px solid var(--border-strong)",
                color: "var(--ink-soft)",
                background: "var(--bg-card)",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function LeadSkeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-2xl"
      style={{ background: "var(--bg-card)" }}
    />
  );
}

function EmptyLead() {
  return (
    <div
      className="rounded-2xl px-5 py-8 text-center"
      style={{
        background: "var(--bg-card)",
        border: "1px dashed var(--border-soft)",
      }}
    >
      <p
        className="font-body text-[13px]"
        style={{ color: "var(--ink-soft)" }}
      >
        No forecasts ready for today yet — check back shortly.
      </p>
    </div>
  );
}

