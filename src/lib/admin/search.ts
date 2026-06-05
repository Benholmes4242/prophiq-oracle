import { supabase } from "@/lib/supabase";

export interface TopQueryRow {
  question_normalized: string;
  sample_question: string;
  hits: number;
  matched: number;
  generated: number;
  rejected: number;
  failed: number;
  domains: string[];
}

export interface CoverageGapRow {
  question_normalized: string;
  sample_question: string;
  hits: number;
  last_seen: string;
}

export interface SearchSummary {
  total: number;
  by_result: Record<string, number>;
  by_domain: Record<string, number>;
  conversion_rate: number;
}

export async function adminSearchTopQueries(days: number, limit = 100): Promise<TopQueryRow[]> {
  const { data, error } = await supabase.rpc("admin_search_top_queries", {
    p_days: days,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TopQueryRow[];
}

export async function adminSearchCoverageGaps(days: number, limit = 50): Promise<CoverageGapRow[]> {
  const { data, error } = await supabase.rpc("admin_search_coverage_gaps", {
    p_days: days,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CoverageGapRow[];
}

export async function adminSearchSummary(days: number): Promise<SearchSummary> {
  const { data, error } = await supabase.rpc("admin_search_summary", { p_days: days });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as Partial<SearchSummary>;
  return {
    total: Number(raw.total ?? 0),
    by_result: (raw.by_result ?? {}) as Record<string, number>,
    by_domain: (raw.by_domain ?? {}) as Record<string, number>,
    conversion_rate: Number(raw.conversion_rate ?? 0),
  };
}
