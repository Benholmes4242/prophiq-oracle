import { useEffect, useState } from "react";

const TICKS = [
  "Pulled the latest data",
  "Reviewed historical patterns",
  "Considered current trends",
  "Cross-referenced public signals",
  "Weighed expert consensus",
  "Checked recent outcomes",
];

const VISIBLE_MS = 2100;
const FADE_MS = 280;

type Phase = "visible" | "leaving" | "entering";

export function RotatingTick() {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("visible");

  useEffect(() => {
    let cancelled = false;
    const timeouts: number[] = [];

    function cycle() {
      if (cancelled) return;
      const t1 = window.setTimeout(() => {
        if (cancelled) return;
        setPhase("leaving");
        const t2 = window.setTimeout(() => {
          if (cancelled) return;
          setIdx((i) => (i + 1) % TICKS.length);
          setPhase("entering");
          const t3 = window.setTimeout(() => {
            if (cancelled) return;
            setPhase("visible");
            cycle();
          }, 50);
          timeouts.push(t3);
        }, FADE_MS);
        timeouts.push(t2);
      }, VISIBLE_MS);
      timeouts.push(t1);
    }

    cycle();
    return () => {
      cancelled = true;
      timeouts.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <div className="tick-row" aria-live="polite">
      <span className={`tick-text tick-${phase}`}>{TICKS[idx]}</span>
    </div>
  );
}
