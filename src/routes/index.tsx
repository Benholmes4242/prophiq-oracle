import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AskInput } from "@/components/site/AskInput";
import { AskInlinePanel } from "@/components/site/AskInlinePanel";
import { HighestConfidenceStream } from "@/components/site/HighestConfidenceStream";
import { DomainTilesGrid, TILE_DOMAINS } from "@/components/site/DomainTilesGrid";
import { TrackRecord } from "@/components/site/TrackRecord";
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

  const all = picks.data ?? [];
  const streamPicks = all.slice(0, 6);

  const byDomain: Record<string, HomepagePick | null> = {};
  for (const d of TILE_DOMAINS) {
    byDomain[d] = all.find((p) => p.domain === d) ?? null;
  }

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
          <div className="pt-3">
            <HighestConfidenceStream picks={streamPicks} />
          </div>

          <div className="space-y-3">
            <DomainTilesGrid byDomain={byDomain} baseStagger={6} />
            <TrackRecord stagger={10} />
            <a
              href="/predictions"
              className="entry-animate block px-4 py-1 text-center font-body text-[13px] font-semibold"
              data-stagger="11"
              style={{ color: "var(--amber-2)" }}
            >
              See all picks →
            </a>
          </div>

          <div className="entry-animate" data-stagger="12">
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
