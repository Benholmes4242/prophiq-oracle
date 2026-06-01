import { useState, useMemo } from "react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { DomainHero } from "@/components/site/DomainHero";
import { FilterChips } from "@/components/site/FilterChips";
import { TodaysLeadCard } from "@/components/site/TodaysLeadCard";
import { DomainUpcomingList } from "@/components/site/DomainUpcomingList";
import { DomainResolvedStrip } from "@/components/site/DomainResolvedStrip";
import { AskInput } from "@/components/site/AskInput";
import { AskInlinePanel } from "@/components/site/AskInlinePanel";
import { useDomainEvents, useDomainResolvedEvents } from "@/hooks/useEvents";
import { getChipsForDomain, classifyEvent } from "@/lib/subcategory";
import type { DomainId, EventWithPrediction } from "@/lib/types";
import type { HomepagePick } from "@/lib/queries";

function toHomepagePick(ep: EventWithPrediction): HomepagePick | null {
  const top = ep.prediction?.ranked_outcomes?.[0];
  return {
    event_id: ep.event.id,
    domain: ep.event.domain,
    slug: ep.event.slug,
    title: ep.event.title,
    question: ep.event.question,
    starts_at: ep.event.starts_at,
    top_pick_label: top?.outcome_label ?? null,
    top_pick_pct: top?.probability ?? null,
    confidence: ep.prediction?.confidence ?? "mixed",
    reasoning_excerpt: top?.reasons?.[0] ?? null,
    is_marquee: false,
  };
}

const DOMAIN_PLACEHOLDER: Record<DomainId, string> = {
  sport: "Will Sinner win Wimbledon?",
  politics: "Who wins the next UK election?",
  markets: "Will the Fed hike in July?",
  entertainment: "Who wins Best Picture next year?",
};

export function DomainPage({ domain }: { domain: DomainId }) {
  const [chip, setChip] = useState("All");
  const chips = useMemo(() => getChipsForDomain(domain), [domain]);
  const { data: events = [], isLoading } = useDomainEvents(domain);
  const { data: resolved = [] } = useDomainResolvedEvents(domain, 5);

  const [askOpen, setAskOpen] = useState(false);
  const [askQ, setAskQ] = useState("");
  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setAskQ(trimmed);
    setAskOpen(true);
  }

  const lead = events[0] ?? null;
  const rest = lead ? events.slice(1) : events;
  const filteredCount =
    chip === "All"
      ? rest.length
      : rest.filter((e) => classifyEvent(e.event.title, domain) === chip).length;

  const leadPick = lead ? toHomepagePick(lead) : null;

  return (
    <div style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <Header />
      <main className="mx-auto max-w-2xl">
        <DomainHero domain={domain} />

        <section className="px-5 pb-5">
          <AskInput placeholder={DOMAIN_PLACEHOLDER[domain]} onSubmit={ask} />
        </section>

        <section className="px-5 pb-4">
          <FilterChips chips={chips} active={chip} onChange={setChip} />
        </section>

        {leadPick && chip === "All" && (
          <section className="px-5 pb-6">
            <TodaysLeadCard pick={leadPick} />
          </section>
        )}

        <div className="flex items-center gap-3 px-5 pb-2 pt-2">
          <span
            className="font-mono text-[10px] tracking-[0.2em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            UPCOMING
          </span>
          <span
            className="h-px flex-1"
            style={{ background: "var(--border-soft)" }}
          />
          <span
            className="font-mono text-[10px]"
            style={{ color: "var(--ink-faint)" }}
          >
            {filteredCount} {filteredCount === 1 ? "event" : "events"}
          </span>
        </div>
        <section className="px-5 pb-8 pt-3">
          {isLoading ? (
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
            <DomainUpcomingList
              events={rest}
              domain={domain}
              subcategory={chip}
            />
          )}
        </section>

        <div className="px-5 pt-2">
          {/* Scored recently header is rendered inside the strip */}
        </div>
        <section className="px-5 pb-10 pt-3">
          <DomainResolvedStrip picks={resolved} />
        </section>
      </main>
      <Footer />
      <AskSheet
        open={askOpen}
        question={askQ}
        topic={domain}
        onClose={() => setAskOpen(false)}
      />
    </div>
  );
}
