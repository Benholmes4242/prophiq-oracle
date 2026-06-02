import type { CSSProperties } from "react";

interface WordmarkProps {
  size?: number;
  inverted?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Wordmark({
  size = 20,
  inverted = false,
  className,
  style,
}: WordmarkProps) {
  const letterColor = inverted ? "#fff" : "var(--ink)";
  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "-0.03em",
        color: letterColor,
        lineHeight: 1,
        whiteSpace: "nowrap",
        display: "inline-block",
        ...style,
      }}
    >
      prophiq<span style={{ color: "var(--amber)" }}>.</span>
    </span>
  );
}
