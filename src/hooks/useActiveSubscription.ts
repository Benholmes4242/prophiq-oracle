import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export interface ActiveSubscription {
  subscription_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  tier: "standard" | "pro" | "enterprise";
  cadence: "monthly" | "annual";
  status: string;
  daily_forecast_cap: number;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  trial_end: string | null;
}

export function useActiveSubscription() {
  return useQuery({
    queryKey: ["active-subscription"],
    queryFn: async (): Promise<ActiveSubscription | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .rpc("get_user_active_subscription", { p_user_id: user.id });

      if (error) {
        console.error("[useActiveSubscription] RPC failed:", error.message);
        return null;
      }

      const rows = data as ActiveSubscription[] | null;
      return rows && rows.length > 0 ? rows[0] : null;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Invalidates the subscription/quota/prices caches. Call after returning
 * from Stripe Checkout or Customer Portal so the entire app re-reads fresh
 * state without prop drilling.
 */
export function useInvalidateSubscriptionState() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["active-subscription"] }),
      queryClient.invalidateQueries({ queryKey: ["user-quota-today"] }),
      queryClient.invalidateQueries({ queryKey: ["prophiq-prices"] }),
    ]);
  };
}
