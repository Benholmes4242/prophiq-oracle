// Loading screen shown while an on-demand prediction is being generated.
// HH brief Phase B. Animated Phi mark + staged copy that rotates through
// the same progress beats users see on AskSheet, so the wait feels intentional.

import { useEffect, useState } from "react";
import { PhiMark } from "@/components/brand/PhiMark";

const STAGES: { label: string; ms: number }[] = [
  { label: "Reading the event", ms: 2500 },
  { label: "Pulling real-time data", ms: 6000 },
  { label: "Consulting expert sources", ms: 6000 },
  { label: "Weighing the evidence", ms: 6000 },
  { label: "Cross-referencing forecasts", ms: 5000 },
  { label: "Calibrating confidence", ms: 99999 },
];

export function ForecastGeneratingScreen() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled || i >= STAGES.length - 1) return;
      const stage = STAGES[i];
      setTimeout(() => {
        if (cancelled) return;
        i += 1;
        setIdx(i);
        tick();
      }, stage.ms);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center"
      style={{ background: "var(--bg)" }}
      role="status"
      aria-live="polite"
    >
      <div
        className="forecast-generating-mark"
        aria-hidden
        style={{ marginBottom: "1.75rem" }}
      >
        <PhiMark size={56} strokeWidth={10} />
      </div>

      <p
        className="font-mono text-[11px] font-bold tracking-[0.22em]"
        style={{ color: "var(--amber-2)" }}
      >
        GENERATING FORECAST
      </p>

      <p
        className="mt-3 font-sans text-lg tracking-tight"
        style={{ color: "var(--ink)", fontWeight: 600, minHeight: "1.75rem" }}
      >
        {STAGES[idx].label}…
      </p>

      <p
        className="mt-4 max-w-sm font-body text-sm"
        style={{ color: "var(--ink-soft)" }}
      >
        Prophiq is running this forecast now. This usually takes about half a
        minute.
      </p>

      <style>{`
        .forecast-generating-mark {
          animation: forecast-pulse 1.6s ease-in-out infinite;
        }
        @keyframes forecast-pulse {
          0%, 100% { opacity: 0.55; transform: scale(0.96); }
          50%      { opacity: 1;    transform: scale(1.04); }
        }
        @media (prefers-reduced-motion: reduce) {
          .forecast-generating-mark { animation: none; opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}
