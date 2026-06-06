import type { CSSProperties } from "react";
import { Wordmark } from "./Wordmark";

interface Props {
  wordmarkSize?: number;
  align?: "left" | "center";
  className?: string;
  style?: CSSProperties;
  hideWordmark?: boolean;
}

/**
 * Wordmark + brand tagline. Tagline is italic Geist at 15px, muted ink.
 * Per brand brief: "Prophecy × IQ. The intelligent way to forecast what's next."
 */
export function WordmarkTagline({
  wordmarkSize = 28,
  align = "left",
  className,
  style,
  hideWordmark = false,
}: Props) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 8,
        ...style,
      }}
    >
      {!hideWordmark && <Wordmark size={wordmarkSize} />}
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontStyle: "italic",
          fontSize: 15,
          lineHeight: 1.35,
          color: "#64748B",
          margin: 0,
          textAlign: align === "center" ? "center" : "left",
          letterSpacing: "-0.005em",
        }}
      >
        Prophecy × IQ. The intelligent way to forecast what&apos;s next.
      </p>
    </div>
  );
}
