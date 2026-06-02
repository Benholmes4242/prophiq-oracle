import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AskInput } from "@/components/site/AskInput";
import { AskInlinePanel } from "@/components/site/AskInlinePanel";
import { FeatureCard } from "@/components/site/FeatureCard";
import { SupportingTilesGrid } from "@/components/site/SupportingTilesGrid";
import { TrackRecord } from "@/components/site/TrackRecord";
import { useHomepagePicks } from "@/hooks/useEvents";
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

  const all = picks.data ?? [];
  const feature = all.find((p) => p.is_marquee) ?? all[0] ?? null;
  const supporting = all.filter((p) => p !== feature).slice(0, 4);

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setAskQ(trimmed);
    setDraft("");
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-between pb-4">
      {askQ ? (
        <>
          <section className="px-4 pt-2">
            <AskInlinePanel
              key={askQ}
              question={askQ}
              topic="any"
              onDismiss={() => setAskQ(null)}
            />
          </section>
          <div />
          <BottomCTA
            showChips={false}
            inputDisabled
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={ask}
          />
        </>
      ) : (
        <>
          <section className="px-4 pt-3">
            <div
              className="entry-animate mb-2 flex items-center gap-2.5"
              data-stagger="0"
            >
              <div
                className="font-mono text-[10px] font-semibold uppercase"
                style={{ letterSpacing: "0.22em", color: "var(--amber-2)" }}
              >
                Today's Forecasts
              </div>
              <div
                className="h-px flex-1"
                style={{ background: "var(--line)" }}
              />
            </div>
            {feature && <FeatureCard pick={feature} stagger={1} />}
          </section>

          <div className="space-y-3">
            <SupportingTilesGrid picks={supporting} />
            <TrackRecord stagger={6} />
            <a
              href="/predictions"
              className="entry-animate block px-4 py-1 text-center font-body text-[13px] font-semibold"
              data-stagger="7"
              style={{ color: "var(--amber-2)" }}
            >
              See all picks →
            </a>
          </div>

          <div className="entry-animate" data-stagger="8">
            <BottomCTA
              showChips
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={ask}
            />
          </div>
        </>
      )}
    </div>
  );
}

function BottomCTA({
  showChips,
  inputDisabled,
  draft,
  onDraftChange,
  onSubmit,
}: {
  showChips: boolean;
  inputDisabled?: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: (q: string) => void;
}) {
  return (
    <div
      className="shrink-0 px-4 pt-3"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="font-display mb-3 text-center"
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
              className="chip shrink-0 whitespace-nowrap rounded-full font-body text-[12.5px] font-medium"
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
        placeholder={
          inputDisabled ? "Working on your forecast…" : "Ask anything…"
        }
        disabled={inputDisabled}
      />
    </div>
  );
}
