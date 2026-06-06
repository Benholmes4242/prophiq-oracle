import { createFileRoute } from "@tanstack/react-router";
import { renderOgPng, transparentPngFallback } from "@/lib/og";

export const Route = createFileRoute("/api/og/home")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const png = await renderOgPng({
            eyebrow: "Calibrated forecasts",
            title: "Forecast what happens next",
            topPickLabel: "Ask anything",
          });
          return new Response(png as unknown as BodyInit, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control":
                "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
            },
          });
        } catch (err) {
          console.error("OG home render failed:", err);
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
