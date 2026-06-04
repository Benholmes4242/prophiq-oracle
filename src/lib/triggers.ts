// On-demand prediction triggering. HH brief Phase B.
//
// Called from the event detail route loader when a parent event has no
// current prediction. Invokes the generate-prediction edge function and
// awaits completion (typically ~20-40s). The route then re-fetches the
// family so the page renders fully populated.

import { supabase } from "./supabase";

export type PredictionMode = "prediction" | "odds";

export interface TriggerResult {
  ok: boolean;
  error?: string;
}

/**
 * Trigger an on-demand prediction generation for an event. Resolves once
 * the edge function returns (prediction row is written and `is_current`
 * is true by the time this returns). Safe to call from SSR loaders.
 */
export async function triggerOnDemandPrediction(
  eventId: string,
  mode: PredictionMode = "prediction",
): Promise<TriggerResult> {
  try {
    const { error } = await supabase.functions.invoke("generate-prediction", {
      body: { event_id: eventId, mode },
    });
    if (error) {
      console.error("[triggerOnDemandPrediction] invoke failed", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[triggerOnDemandPrediction] threw", message);
    return { ok: false, error: message };
  }
}
