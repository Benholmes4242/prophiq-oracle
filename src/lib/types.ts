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
  label: string;
  rank: number;
  probability?: number;
  fit_score?: number;
  reasons?: string[];
}

export interface PredictionRow {
  id: string;
  event_id: string;
  mode: "prediction" | "odds";
  ranked_outcomes: RankedOutcome[];
  alternates: RankedOutcome[] | null;
  consensus_method: "weighted_borda_count" | "single_model_fallback";
  consensus_score: number | null;
  agreement_score: number | null;
  model_results: unknown[];
  prompt_version: string;
  is_current: boolean;
  generated_at: string;
}

export interface EventWithPrediction {
  event: EventRow;
  prediction: PredictionRow | null;
}
