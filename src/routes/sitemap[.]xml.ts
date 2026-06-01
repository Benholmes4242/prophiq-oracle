import { createFileRoute } from "@tanstack/react-router";

const BASE = "https://prophiq-opinion-nexus.lovable.app";

const ROUTES = [
  "/",
  "/about",
  "/ask",
  "/predictions",
  "/receipts",
  "/sport",
  "/politics",
  "/markets",
  "/entertainment",
  "/privacy",
  "/terms",
  "/contact",
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls = ROUTES.map(
          (p) =>
            `  <url><loc>${BASE}${p}</loc><changefreq>${p === "/" ? "daily" : "weekly"}</changefreq><priority>${p === "/" ? "1.0" : "0.7"}</priority></url>`,
        ).join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
