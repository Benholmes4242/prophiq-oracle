import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { renderOgPng, transparentPngFallback } from "@/lib/og";

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
            const png = await renderOgPng({
              eyebrow: "prophiq",
              title: "Event not found",
            });
            return new Response(png as unknown as BodyInit, {
              status: 200,
              headers: {
                "Content-Type": "image/png",
                "Cache-Control": "public, max-age=300",
              },
            });
          }

          const ev = event as { id: string; title: string; domain: string };

          const { data: pred } = await sb
            .from("v_predictions_public")
            .select("ranked_outcomes")
            .eq("event_id", ev.id)
            .eq("is_current", true)
            .eq("mode", "prediction")
            .maybeSingle();

          const top =
            (
              pred as {
                ranked_outcomes?: Array<{
                  outcome_label?: string;
                  label?: string;
                  probability?: number;
                }>;
              } | null
            )?.ranked_outcomes?.[0] ?? null;

          const png = await renderOgPng({
            eyebrow: `${ev.domain.toUpperCase()} · CALL`,
            title: ev.title,
            topPickLabel: top?.outcome_label ?? top?.label ?? null,
            topPickPct: top?.probability ?? null,
          });

          return new Response(png as unknown as BodyInit, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control":
                "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
            },
          });
        } catch (err) {
          console.error("OG event render failed:", err);
          return new Response(transparentPngFallback() as unknown as BodyInit, {
            status: 503,
            headers: {
              "Content-Type": "image/png",
              "X-Og-Error": String((err as Error).message ?? err).slice(0, 120),
            },
          });
        }
      },
    },
  },
});
