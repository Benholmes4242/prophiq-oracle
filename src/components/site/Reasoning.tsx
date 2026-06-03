// Reasoning — single editorial section replacing the amber ReasoningCard and
// the generic MethodologyCard. Eyebrow + heading + intro paragraph + ItemList
// of reason rows. Accepts either ReasonItem[] (structured) or string[]
// (backward-compat with current backend pick.reasons).

import type { ReactNode } from "react";

interface ReasonItem {
  term: string;
  detail: string;
  isCounter?: boolean;
}

interface ReasoningProps {
  pickLabel: string;
  reasons: ReasonItem[] | string[];
  intro?: string | null;
  emPhrase?: string;
}

const GENERIC_INTRO =
  "Our forecast on this question reflects the signals we can read with confidence today: historical patterns, real-time data, expert commentary, and cross-model agreement. The reasoning below describes the case for the call and the factors that pulled confidence toward where it sits.";

export function Reasoning({ pickLabel, reasons, intro, emPhrase }: ReasoningProps) {
  const items: ReasonItem[] = Array.isArray(reasons)
    ? reasons.map((r, i) =>
        typeof r === "string" ? { term: `Factor ${i + 1}`, detail: r } : r,
      )
    : [];

  const introText = intro ?? GENERIC_INTRO;

  return (
    <section className="reasoning-section">
      <div className="section-row">
        <span className="section-eyebrow">REASONING</span>
        <span className="section-rule" />
      </div>

      <h2 className="reasoning-heading">
        Why we lead with {pickLabel}.
      </h2>

      <p className="reasoning-intro">
        {emPhrase ? renderWithEmPhrase(introText, emPhrase) : introText}
      </p>

      {items.length > 0 && (
        <dl className="reasoning-items">
          {items.map((item, i) => (
            <div key={i} className="reasoning-item">
              <dt
                className={
                  item.isCounter ? "reasoning-term reasoning-term-counter" : "reasoning-term"
                }
              >
                {item.term}
              </dt>
              <dd className="reasoning-detail">{item.detail}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function renderWithEmPhrase(text: string, emPhrase: string): ReactNode {
  const idx = text.indexOf(emPhrase);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="reasoning-em">{emPhrase}</span>
      {text.slice(idx + emPhrase.length)}
    </>
  );
}
