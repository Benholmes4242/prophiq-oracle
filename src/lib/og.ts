// PNG OG card generator using Satori (JSX → SVG) and @resvg/resvg-wasm
// (SVG → PNG). Returns a Uint8Array containing PNG bytes.
//
// Fonts are loaded from /public/fonts at first call and cached in module
// scope for the lifetime of the instance.

import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { getPublicBaseUrl } from "./publicUrl";

let bricolage700: ArrayBuffer | null = null;
let bricolage600: ArrayBuffer | null = null;
let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

async function loadFonts(): Promise<void> {
  if (bricolage700 && bricolage600) return;
  const base = getPublicBaseUrl();
  const [b700, b600] = await Promise.all([
    fetch(`${base}/fonts/BricolageGrotesque-700.ttf`).then((r) => {
      if (!r.ok) throw new Error(`font 700 fetch: ${r.status}`);
      return r.arrayBuffer();
    }),
    fetch(`${base}/fonts/BricolageGrotesque-600.ttf`).then((r) => {
      if (!r.ok) throw new Error(`font 600 fetch: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  bricolage700 = b700;
  bricolage600 = b600;
}

async function ensureWasm(): Promise<void> {
  if (wasmInitialized) return;
  if (wasmInitPromise) return wasmInitPromise;
  wasmInitPromise = (async () => {
    const wasmUrl = new URL(
      "@resvg/resvg-wasm/index_bg.wasm",
      import.meta.url,
    ).href;
    await initWasm(fetch(wasmUrl));
    wasmInitialized = true;
  })();
  return wasmInitPromise;
}

export interface OgCardOpts {
  eyebrow: string;
  title: string;
  topPickLabel?: string | null;
  topPickPct?: number | null;
}

// 1x1 transparent PNG used when rendering fails.
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export function transparentPngFallback(): Uint8Array {
  return TRANSPARENT_PNG;
}

export async function renderOgPng(opts: OgCardOpts): Promise<Uint8Array> {
  await loadFonts();
  await ensureWasm();

  const { eyebrow, title, topPickLabel, topPickPct } = opts;
  const pct = topPickPct != null ? Math.round(topPickPct) : null;

  // Build the JSX-like tree as plain objects (satori accepts ReactElement-shaped objects).
  const children: unknown[] = [
    // top amber strip
    {
      type: "div",
      props: {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: "#D97706",
        },
      },
    },
    // brand mark
    {
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", gap: 14 },
        children: [
          {
            type: "div",
            props: {
              style: {
                width: 44,
                height: 44,
                background: "#D97706",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 24,
                fontWeight: 700,
              },
              children: "P",
            },
          },
          {
            type: "div",
            props: {
              style: { fontSize: 28, fontWeight: 700, letterSpacing: -1 },
              children: "Prophiq",
            },
          },
        ],
      },
    },
    // eyebrow
    {
      type: "div",
      props: {
        style: {
          marginTop: 60,
          fontSize: 16,
          color: "#8B95A5",
          letterSpacing: 4,
          textTransform: "uppercase",
          fontWeight: 600,
        },
        children: eyebrow,
      },
    },
    // title
    {
      type: "div",
      props: {
        style: {
          marginTop: 20,
          fontSize: 68,
          lineHeight: 1.04,
          fontWeight: 700,
          letterSpacing: -2,
          color: "#0B1220",
          maxHeight: 280,
          overflow: "hidden",
          display: "flex",
        },
        children: title,
      },
    },
  ];

  if (topPickLabel) {
    const bottomKids: unknown[] = [
      {
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "column" },
          children: [
            {
              type: "div",
              props: {
                style: {
                  fontSize: 14,
                  letterSpacing: 3,
                  color: "#8B95A5",
                  fontWeight: 600,
                },
                children: "TOP PICK",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  fontSize: 40,
                  fontWeight: 700,
                  marginTop: 4,
                  letterSpacing: -1,
                  color: "#0B1220",
                  display: "flex",
                },
                children: topPickLabel,
              },
            },
          ],
        },
      },
    ];
    if (pct != null) {
      bottomKids.push({
        type: "div",
        props: {
          style: {
            fontSize: 132,
            fontWeight: 600,
            color: "#D97706",
            lineHeight: 1,
            letterSpacing: -4,
            display: "flex",
          },
          children: `${pct}%`,
        },
      });
    }
    children.push({
      type: "div",
      props: {
        style: {
          marginTop: "auto",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
        },
        children: bottomKids,
      },
    });
  }

  const tree = {
    type: "div",
    props: {
      style: {
        width: 1200,
        height: 630,
        background: "#FAF7F2",
        padding: 80,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Bricolage Grotesque",
        color: "#0B1220",
        position: "relative",
      },
      children,
    },
  };

  // satori's type expects ReactNode; the object shape is what it actually consumes.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Bricolage Grotesque",
        data: bricolage700 as ArrayBuffer,
        weight: 700,
        style: "normal",
      },
      {
        name: "Bricolage Grotesque",
        data: bricolage600 as ArrayBuffer,
        weight: 600,
        style: "normal",
      },
    ],
  });

  const png = new Resvg(svg).render().asPng();
  return png;
}
