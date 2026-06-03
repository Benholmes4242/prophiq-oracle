// Shared daily quota anchored on the Supabase user_id (anonymous or email).
// Reads public.get_usage_today_for_user() RPC, which counts events submitted
// by the user in the current UTC day.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface UsageQuota {
  used: number;
  total: number;
  remaining: number;
}

const FREE_DAILY_CAP = 3;

export function useUsageQuota() {
  const query = useQuery({
    queryKey: ["usage-today"],
    queryFn: async (): Promise<UsageQuota | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { used: 0, total: FREE_DAILY_CAP, remaining: FREE_DAILY_CAP };
      }
      const { data, error } = await supabase
        .rpc("get_usage_today_for_user", { p_user_id: user.id })
        .single();
      if (error) {
        console.error("[useUsageQuota] RPC failed:", error.message);
        return { used: 0, total: FREE_DAILY_CAP, remaining: FREE_DAILY_CAP };
      }
      const row = data as { questions_submitted_today?: number } | null;
      const used = Number(row?.questions_submitted_today ?? 0);
      return {
        used,
        total: FREE_DAILY_CAP,
        remaining: Math.max(FREE_DAILY_CAP - used, 0),
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    usage: query.data ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
