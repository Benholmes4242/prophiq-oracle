// Shared daily quota anchored on the authenticated Supabase user.
// Reads public.get_user_quota_today() RPC (Brief CC). Returns null when no
// session — callers should treat that as "sign up required" rather than
// implying a free allowance.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface UsageQuota {
  // Backward-compatible fields (existing components keep working)
  used: number;
  total: number;
  remaining: number;

  // Brief CC additions
  dailyCap: number;
  tier: "free" | "standard" | "pro" | "enterprise";
  isTrialing: boolean;
  trialEnd: Date | null;
  subscriptionStatus: string;
}

const FREE_DAILY_CAP = 3;

export function useUsageQuota() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["user-quota-today"],
    queryFn: async (): Promise<UsageQuota | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      // Logged out: no quota. Don't fake "3 remaining" — Option C gates
      // forecasting on a free account.
      if (!user) return null;

      const { data, error } = await supabase
        .rpc("get_user_quota_today", { p_user_id: user.id });

      if (error) {
        console.error("[useUsageQuota] RPC failed:", error.message);
        return null;
      }



      const row = (Array.isArray(data) ? data[0] : data) as {
        used_today: number;
        daily_cap: number;
        remaining: number;
        tier: UsageQuota["tier"];
        is_trialing: boolean;
        trial_end: string | null;
        subscription_status: string;
      } | null;
      if (!row) return freeFallback();

      return {
        used: Number(row.used_today ?? 0),
        total: Number(row.daily_cap ?? FREE_DAILY_CAP),
        remaining: Number(row.remaining ?? 0),
        dailyCap: Number(row.daily_cap ?? FREE_DAILY_CAP),
        tier: row.tier,
        isTrialing: !!row.is_trialing,
        trialEnd: row.trial_end ? new Date(row.trial_end) : null,
        subscriptionStatus: row.subscription_status,
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    usage: query.data ?? null,
    isLoading: query.isLoading,
    refetch: () => queryClient.invalidateQueries({ queryKey: ["user-quota-today"] }),
  };
}
