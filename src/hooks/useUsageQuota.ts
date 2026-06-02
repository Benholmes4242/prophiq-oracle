// Shared daily quota for primary forecasts + chat messages. Reads
// public.get_usage_today() RPC, which counts accepted submissions across
// both endpoints in the last 24h.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getBrowserFingerprint } from "./useBrowserFingerprint";

export interface UsageQuota {
  used: number;
  total: number;
  remaining: number;
}

export function useUsageQuota() {
  const query = useQuery({
    queryKey: ["usage-today"],
    queryFn: async (): Promise<UsageQuota | null> => {
      const fp = await getBrowserFingerprint();
      if (!fp) return null;
      const { data, error } = await supabase.rpc("get_usage_today", {
        p_fingerprint: fp,
        p_ip_hash: null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { used: 0, total: 3, remaining: 3 };
      return {
        used: Number(row.used ?? 0),
        total: Number(row.total ?? 3),
        remaining: Number(row.remaining ?? 3),
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
