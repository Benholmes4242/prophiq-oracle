import type { ReactNode } from "react";
import { Footer } from "./Footer";

export function LegalPage({
  title,
  accent,
  subtitle,
  children,
}: {
  title: string;
  accent?: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <>
      <main className="mx-auto max-w-2xl">
        <section className="px-5 pb-6 pt-9">
          <h1
            className="font-display tracking-[-0.035em]"
            style={{
              fontWeight: 700,
              lineHeight: 0.98,
              fontSize: "clamp(40px, 9vw, 56px)",
            }}
          >
            {title}
            {accent && (
              <span style={{ color: "var(--amber)" }}>{accent}</span>
            )}
          </h1>
          <p
            className="mt-4 max-w-[44ch] font-body text-[16px] leading-[1.45]"
            style={{ color: "var(--ink-soft)" }}
          >
            {subtitle}
          </p>
        </section>
        <section className="legal-prose px-5 pb-12 pt-2">{children}</section>
      </main>
      <Footer />
    </>
  );
}
