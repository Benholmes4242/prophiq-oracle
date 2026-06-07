import { useEffect, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { AskInput } from "@/components/site/AskInput";
import { AskInlinePanel, type AskPanelState } from "@/components/site/AskInlinePanel";
import type { StructuredAsk } from "@/lib/forecast";
import {
  consumePendingQuestion,
  hasSession,
  openSignupModal,
  setPendingQuestion,
} from "@/lib/authGate";
import { supabase } from "@/lib/supabase";


import { FeatureCard } from "@/components/site/FeatureCard";
import { SupportingTilesGrid } from "@/components/site/SupportingTilesGrid";
import { useHomepagePicks } from "@/hooks/useEvents";
import { getPublicBaseUrl } from "@/lib/publicUrl";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: () => {
    const ogImage = `${getPublicBaseUrl()}/api/og/home`;
    return {
      meta: [
        { title: "Prophiq — Forecast what happens next" },
        {
          name: "description",
          content:
            "From the Grand National to the FOMC, Prophiq forecasts every upcoming event worth following.",
        },
        { property: "og:title", content: "Prophiq — Forecast what happens next" },
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
  const { q: initialQ } = useSearch({ from: "/" });
  const picks = useHomepagePicks();
  const [askQ, setAskQ] = useState<string | null>(null);
  const [askStructured, setAskStructured] = useState<StructuredAsk | undefined>(undefined);
  const [askState, setAskState] = useState<AskPanelState>("loading");
  const [draft, setDraft] = useState(() => initialQ ?? "");

  const all = picks.data ?? [];
  const feature = all.find((p) => p.is_marquee) ?? all[0] ?? null;
  const supporting = all.filter((p) => p !== feature).slice(0, 4);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    if (!(await hasSession())) {
      setPendingQuestion({ question: trimmed, topic: "any", scope: "home" });
      openSignupModal();
      return;
    }
    setAskQ(trimmed);
    setAskStructured(undefined);
    setDraft("");
  }

  // Resume a pending question after sign-in (or on initial mount if one is stashed).
  useEffect(() => {
    async function tryResume() {
      if (!(await hasSession())) return;
      const pending = consumePendingQuestion((p) => p.scope === "home");
      if (pending) {
        setAskQ(pending.question);
        setDraft("");
      }
    }
    void tryResume();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_IN") void tryResume();
      },
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-between pb-4">
      {askQ ? (
        <>
          <section className="px-4 pt-2">
            <AskInlinePanel
              key={askQ}
              question={askQ}
              topic="any"
              structured={askStructured}
              onDismiss={() => { setAskQ(null); setAskStructured(undefined); }}
              onStateChange={setAskState}
              onResubmit={(q, s) => { setAskQ(q); setAskStructured(s); }}
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

          <SupportingTilesGrid picks={supporting} />

          <div className="entry-animate" data-stagger="6">
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
        className="font-display mb-2 text-center"
        style={{
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
        }}
      >
        Forecast what <span style={{ color: "var(--amber)" }}>happens</span> next
      </div>
      <p
        className="mb-3 text-center"
        style={{
          fontFamily: "var(--font-sans)",
          fontStyle: "italic",
          fontSize: 13,
          lineHeight: 1.35,
          color: "#64748B",
          letterSpacing: "-0.005em",
        }}
      >
        Prophecy × IQ. The intelligent way to forecast what&apos;s next.
      </p>

      {showChips && (
        <div className="relative -mx-4 mb-2.5">
          <div className="chips-scroll flex gap-1.5 overflow-x-auto px-4">
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
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0"
            style={{
              width: 28,
              background:
                "linear-gradient(to right, transparent, var(--bg))",
            }}
          />
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
