import { createFileRoute } from "@tanstack/react-router";
import { renderOgSvg } from "@/lib/og";

export const Route = createFileRoute("/api/og/home")({
  server: {
    handlers: {
      GET: async () => {
        const svg = renderOgSvg({
          eyebrow: "Calibrated forecasts",
          title: "What happens next?",
          topPickLabel: "Ask anything",
        });
        return new Response(svg, {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400, s-maxage=604800",
          },
        });
      },
    },
  },
});
