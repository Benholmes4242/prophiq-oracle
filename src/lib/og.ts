// Hand-rolled SVG OG card generator. Pure string output — no native deps,
// works in Cloudflare Worker runtime. Returns SVG (1200x630). Most social
// platforms render image/svg+xml for og:image; for a launch-grade PNG,
// swap to Satori + @resvg/resvg-wasm.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const remaining = words.slice(lines.join(" ").split(/\s+/).length).join(" ");
    if (remaining) lines[maxLines - 1] = (last + "…").slice(0, maxChars);
  }
  return lines;
}

export interface OgCardOpts {
  eyebrow: string;
  title: string;
  topPickLabel?: string | null;
  topPickPct?: number | null;
}

export function renderOgSvg(opts: OgCardOpts): string {
  const { eyebrow, title, topPickLabel, topPickPct } = opts;
  const titleLines = wrap(title, 36, 3);
  const pct = topPickPct != null ? Math.round(topPickPct) : null;
  const W = 1200, H = 630;

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="80" y="${230 + i * 84}" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-weight="700" fill="#0B1220" letter-spacing="-2">${esc(line)}</text>`,
    )
    .join("");

  const bottom = topPickLabel
    ? `
    <g>
      <text x="80" y="540" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" font-weight="600" fill="#8B95A5" letter-spacing="3">TOP PICK</text>
      <text x="80" y="580" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="34" font-weight="600" fill="#0B1220">${esc(topPickLabel)}</text>
      ${pct != null ? `<text x="1120" y="580" text-anchor="end" font-family="Georgia, serif" font-size="120" font-weight="700" fill="#D97706" letter-spacing="-4">${pct}%</text>` : ""}
    </g>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#FAF7F2"/>
  <rect x="0" y="0" width="${W}" height="6" fill="#D97706"/>
  <g transform="translate(80,90)">
    <rect width="44" height="44" rx="6" fill="#D97706"/>
    <text x="22" y="33" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="800" fill="#FFFFFF">P</text>
    <text x="60" y="32" font-family="Georgia, serif" font-size="28" font-weight="700" fill="#0B1220" letter-spacing="-1">Prophiq</text>
  </g>
  <text x="80" y="180" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" font-weight="600" fill="#8B95A5" letter-spacing="3">${esc(eyebrow.toUpperCase())}</text>
  ${titleSvg}
  ${bottom}
  <text x="1120" y="90" text-anchor="end" font-family="ui-monospace, monospace" font-size="14" fill="#8B95A5" letter-spacing="2">PROPHIQ.IO</text>
</svg>`;
}
