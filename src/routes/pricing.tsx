import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useActiveSubscription } from "../hooks/useActiveSubscription";
import { TierCard } from "../components/pricing/TierCard";
import { AnnualToggle } from "../components/pricing/AnnualToggle";
import { Wordmark } from "../components/brand/Wordmark";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing - prophiq." },
      {
        name: "description",
        content:
          "Free for browsing. Paid for serious forecasting. Standard at GBP 9.99/month, Pro at GBP 29.99/month, with a 7-day free trial on every plan.",
      },
    ],
  }),
});

interface PriceRow {
  stripe_price_id: string;
  tier: string;
  cadence: "monthly" | "annual";
  amount_minor_units: number;
  currency: string;
  display_name: string;
  daily_forecast_cap: number;
}

function PricingPage() {
  const [cadence, setCadence] = useState<"monthly" | "annual">("monthly");
  const { data: subscription } = useActiveSubscription();
  const currentTier = subscription?.tier ?? "free";

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      setIsAuthenticated(!!user);
    }
    refresh();
    const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(() => refresh());
    return () => {
      mounted = false;
      sub.unsubscribe();
    };
  }, []);

  function handleTrialCta(priceId: string) {
    sessionStorage.setItem("pendingCheckoutPriceId", priceId);
    window.dispatchEvent(
      new CustomEvent("prophiq:open-login", {
        detail: { mode: "signup" },
      }),
    );
  }

  const { data: prices = [] } = useQuery({
    queryKey: ["prophiq-prices"],
    queryFn: async (): Promise<PriceRow[]> => {
      const { data, error } = await supabase
        .from("prophiq_prices")
        .select("*")
        .eq("is_active", true)
        .order("amount_minor_units", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PriceRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div
      className="min-h-screen px-4 py-8 sm:py-12 overflow-x-hidden"
      style={{ background: "var(--bg)", color: "var(--ink)" }}
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="text-center mb-12">
          <Wordmark className="mx-auto mb-6 h-10" />
          <h1
            className="text-3xl sm:text-4xl font-bold mb-3"
            style={{ fontFamily: "Geist, sans-serif", letterSpacing: "-0.02em" }}
          >
            Pricing.
          </h1>
          <p className="text-base text-[var(--ink)]/70 max-w-md mx-auto">
            Free for browsing. Paid for serious forecasting. All paid plans
            start with a 7-day free trial. Cancel anytime, no charge.
          </p>
        </div>


        <div className="flex justify-center mb-10">
          <AnnualToggle value={cadence} onChange={setCadence} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TierCard
            tier="free"
            displayName="Free"
            priceCopy="GBP 0"
            cadenceCopy="forever"
            features={[
              "3 forecasts per day",
              "Full multi-model consensus",
              "Unlimited browsing of resolved forecasts",
            ]}
            ctaLabel={currentTier === "free" ? "Current plan" : "Downgrade"}
            ctaDisabled={currentTier === "free"}
            onCta={() => {}}
          />

          {(["standard", "pro"] as const).map((tier) => {
            const row = prices.find((p) => p.tier === tier && p.cadence === cadence);
            if (!row) return null;
            return (
              <TierCard
                key={row.stripe_price_id}
                tier={row.tier}
                displayName={row.display_name.replace(/ (Monthly|Annual)$/, "")}
                priceCopy={`GBP ${(row.amount_minor_units / 100).toFixed(2)}`}
                cadenceCopy={cadence === "monthly" ? "per month" : "per year"}
                savingsCopy={cadence === "annual" ? "1 month free" : undefined}
                features={getTierFeatures(tier, row.daily_forecast_cap)}
                ctaLabel={currentTier === tier ? "Current plan" : "Start 7-day free trial"}
                ctaDisabled={currentTier === tier}
                isPopular={tier === "pro"}
                priceId={row.stripe_price_id}
                onCta={isAuthenticated ? undefined : () => handleTrialCta(row.stripe_price_id)}
              />
            );
          })}
        </div>

        <div className="mt-16 text-center text-sm text-[var(--ink)]/60 max-w-2xl mx-auto space-y-2">
          <p>
            All plans include the full multi-model consensus engine. Difference is daily volume.
          </p>
          <p>VAT included where applicable. Billed in GBP via Stripe.</p>
        </div>
      </div>
    </div>
  );
}

function getTierFeatures(tier: string, dailyCap: number): string[] {
  if (tier === "standard") {
    return [
      `${dailyCap} forecasts per day`,
      "Full multi-model consensus",
      "Unlimited browsing of resolved forecasts",
      "Email support",
    ];
  }
  if (tier === "pro") {
    return [
      `${dailyCap} forecasts per day`,
      "Full multi-model consensus",
      "Unlimited browsing of resolved forecasts",
      "API access (coming soon)",
      "Priority compute (lower latency)",
      "Priority email support",
    ];
  }
  return [];
}
