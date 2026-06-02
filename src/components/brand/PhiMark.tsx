import type { CSSProperties } from "react";

interface PhiMarkProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export function PhiMark({
  size = 32,
  strokeWidth = 11,
  className,
  style,
  ariaLabel = "Prophiq",
}: PhiMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ color: "var(--amber)", ...style }}
      role="img"
      aria-label={ariaLabel}
    >
      <circle
        cx="100"
        cy="100"
        r="54"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <line
        x1="100"
        y1="18"
        x2="100"
        y2="182"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
