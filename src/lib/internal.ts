// Server-only types. Do NOT import from client code (components, routes,
// hooks). These mirror the base `predictions` table including internal
// scoring fields that must never reach a public client.

import type { PredictionPublic } from "./types";

export interface PredictionInternal extends Omit<PredictionPublic, "confidence"> {
  consensus_method: "weighted_borda_count" | "single_model_fallback";
  consensus_score: number | null;
  /** 0-100. Server-side only — clients see the derived confidence enum. */
  agreement_score: number | null;
  model_results: unknown[];
}
