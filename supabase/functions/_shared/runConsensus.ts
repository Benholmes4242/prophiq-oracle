// Fan out a per-domain prompt to Claude/GPT/Gemini in parallel and run them
// through the consensus engine. This is the single integration point every
// edge function uses so weights/timeouts stay consistent.

import { computeConsensus, type ConsensusResult, type ModelRanking } from "./consensusEngine.ts";
import { ALL_LLM_CALLERS, type LlmCaller } from "./llm.ts";
import type { ResearchContext } from "./domain.ts";
import type { PriorContext } from "./priorContext.ts";
import type { MarketSignal } from "./marketSignals.ts";

export interface RunConsensusInput {
  prompt: string;
  outcomes: Array<{ id: string; label: string }>;
  /** Override the caller list (used in tests). */
  callers?: LlmCaller[];
  /** Per-call timeout in ms. Default 45s. */
  timeoutMs?: number;
  /** Research context that was woven into the prompt. For lineage only. */
  research?: ResearchContext | null;
  /** Priors that were woven into the prompt. For lineage threading only. */
  priors?: PriorContext[] | null;
  /** Market signals that were woven into the prompt. For lineage only. */
  marketSignals?: MarketSignal[] | null;
}

export interface RunConsensusOutput {
  consensus: ConsensusResult;
  model_results: ModelRanking[];
}

export async function runConsensus(input: RunConsensusInput): Promise<RunConsensusOutput> {
  const callers = input.callers ?? ALL_LLM_CALLERS;
  const timeoutMs = input.timeoutMs ?? 45000;

  const results = await Promise.all(callers.map((fn) => withTimeout(fn({
    prompt: input.prompt,
    outcomes: input.outcomes,
  }), timeoutMs)));

  const ids = input.outcomes.map((o) => o.id);
  const consensus = computeConsensus(results, ids);
  return { consensus, model_results: results };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
