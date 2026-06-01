import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { renderOgSvg } from "@/lib/og";

export const Route = createFileRoute("/api/og/event/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const url =
            process.env.SUPABASE_URL ||
            (import.meta as { env?: Record<string, string> }).env
              ?.VITE_SUPABASE_URL;
          const key =
            process.env.SUPABASE_PUBLISHABLE_KEY ||
            process.env.SUPABASE_ANON_KEY ||
            (import.meta as { env?: Record<string, string> }).env
              ?.VITE_SUPABASE_ANON_KEY;
          if (!url || !key) throw new Error("Supabase env missing");
          const sb = createClient(url, key, { auth: { persistSession: false } });

          const { data: event } = await sb
            .from("events")
            .select("id, title, domain, slug")
            .eq("slug", params.slug)
            .maybeSingle();

          if (!event) {
            const svg = renderOgSvg({
              eyebrow: "Prophiq",
              title: "Event not found",
            });
            return new Response(svg, {
              status: 200,
              headers: {
                "Content-Type": "image/svg+xml; charset=utf-8",
                "Cache-Control": "public, max-age=300",
              },
            });
          }

          const { data: pred } = await sb
            .from("v_predictions_public")
            .select("ranked_outcomes")
            .eq("event_id", (event as { id: string }).id)
            .eq("is_current", true)
            .eq("mode", "prediction")
            .maybeSingle();

          const top =
            (
              pred as {
                ranked_outcomes?: Array<{ label?: string; probability?: number }>;
              } | null
            )?.ranked_outcomes?.[0] ?? null;

          const svg = renderOgSvg({
            eyebrow: `${(event as { domain: string }).domain} · Call`,
            title: (event as { title: string }).title,
            topPickLabel: top?.label ?? null,
            topPickPct: top?.probability ?? null,
          });

          return new Response(svg, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Cache-Control":
                "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
            },
          });
        } catch (err) {
          const svg = renderOgSvg({
            eyebrow: "Prophiq",
            title: "What happens next?",
          });
          return new Response(svg, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Cache-Control": "public, max-age=60",
              "X-Og-Error": String((err as Error).message ?? err).slice(0, 120),
            },
          });
        }
      },
    },
  },
});
