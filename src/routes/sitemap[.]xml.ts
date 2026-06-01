import { createFileRoute } from "@tanstack/react-router";
import { getPublicBaseUrl } from "@/lib/publicUrl";

const ROUTES = [
  "/",
  "/about",
  
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
        const base = getPublicBaseUrl();
        const urls = ROUTES.map(
          (p) =>
            `  <url><loc>${base}${p}</loc><changefreq>${p === "/" ? "daily" : "weekly"}</changefreq><priority>${p === "/" ? "1.0" : "0.7"}</priority></url>`,
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
