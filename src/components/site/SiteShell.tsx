import type { ReactNode } from "react";
import { Footer } from "./Footer";

// AppHeader is rendered by __root.tsx; SiteShell only wraps the page body
// + footer. No secondary Header is rendered here.
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--brand-bg)] text-[var(--brand-ink)]">
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
