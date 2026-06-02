import { useEffect, useState } from "react";

const TICKS = [
  "Pulled the latest available data",
  "Reviewed historical patterns",
  "Considered current form",
  "Cross-referenced market signals",
  "Weighed expert consensus",
  "Checked recent outcomes",
];

export function EvidenceTicks() {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible((v) => Math.min(v + 1, TICKS.length));
    }, 900);
    return () => clearInterval(id);
  }, []);

  if (visible === 0) return null;

  return (
    <ul className="evidence-ticks">
      {TICKS.slice(0, visible).map((tick) => (
        <li key={tick} className="evidence-tick">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{tick}</span>
        </li>
      ))}
    </ul>
  );
}
