// Shared types mirroring the Prophiq Supabase schema. Kept narrow — only
// the columns the public frontend actually reads.

export type DomainId = "sport" | "politics" | "markets" | "entertainment";
export const DOMAINS: DomainId[] = ["sport", "politics", "markets", "entertainment"];

export const DOMAIN_LABEL: Record<DomainId, string> = {
  sport: "Sport",
  politics: "Politics",
  markets: "Markets",
  entertainment: "Entertainment",
};

export const DOMAIN_TAGLINE: Record<DomainId, string> = {
  sport: "Fixtures, finals, and head-to-head calls",
  politics: "Elections, votes, and leadership contests",
  markets: "Earnings, central banks, and macro prints",
  entertainment: "Awards, releases, and finales",
};

export type EventStatus = "scheduled" | "live" | "resolved" | "cancelled";
export type EventMode = "prediction" | "odds" | "both";
export type EventSource = "discovered" | "user_submitted";

export interface EventRow {
  id: string;
  domain: DomainId;
  slug: string;
  title: string;
  description: string | null;
  question: string;
  starts_at: string;
  resolves_at: string;
  status: EventStatus;
  mode: EventMode;
  source: EventSource;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface EventOutcomeRow {
  id: string;
  event_id: string;
  label: string;
  metadata: Record<string, unknown> | null;
}

export interface RankedOutcome {
  outcome_id?: string;
  /** Human-readable outcome label, enriched at persist time from event_outcomes. */
  outcome_label?: string;
  rank: number;
  /** Probability on a 0-100 scale (NOT 0-1). See normaliseProbability in _shared/llm.ts. */
  probability?: number;
  fit_score?: number;
  reasons?: string[];
  is_dark_horse?: boolean;
}

export type ConfidenceTier = "high" | "medium" | "mixed";

/**
 * Public prediction shape — what clients receive. No raw scoring fields,
 * model count, or aggregation method. The server maps internal scores to
 * the {@link ConfidenceTier} enum via the `v_predictions_public` view.
 */
export interface PredictionPublic {
  id: string;
  event_id: string;
  mode: "prediction" | "odds";
  ranked_outcomes: RankedOutcome[];
  alternates: RankedOutcome[] | null;
  confidence: ConfidenceTier;
  prompt_version: string;
  is_current: boolean;
  generated_at: string;
}

/** Back-compat alias. Public shape only — do not add internal fields here. */
export type PredictionRow = PredictionPublic;

export interface EventWithPrediction {
  event: EventRow;
  prediction: PredictionRow | null;
}
