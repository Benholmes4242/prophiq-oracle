import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ensureAnonymousSession } from "../lib/auth";
import { reclaimLegacyAskedHistory } from "../lib/migrateLocalStorageHistory";
import { Toaster } from "@/components/ui/sonner";
import { AppHeader } from "@/components/site/AppHeader";
import { Drawer } from "@/components/site/Drawer";
import { TrialBanner } from "@/components/site/TrialBanner";
import { PostCheckoutHandler } from "@/components/checkout/PostCheckoutHandler";
import { PaywallModalContainer } from "@/components/paywall/PaywallModal";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    try {
      await ensureAnonymousSession();
      // fire-and-forget; never block route load on history reclaim
      reclaimLegacyAskedHistory().catch(() => {});
    } catch (err) {
      console.error("[root] auth bootstrap failed:", err);
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "prophiq." },
      {
        name: "description",
        content:
          "Built for one job: calibrated probabilistic forecasting across sport, politics, markets, and entertainment. An ensemble of frontier AI models, grounded in live research and our own resolved-forecast record.",
      },
      { name: "author", content: "prophiq" },
      { name: "theme-color", content: "#F4731A" },
      { property: "og:site_name", content: "prophiq" },
      { property: "og:title", content: "prophiq." },
      {
        property: "og:description",
        content:
          "Built for one job: calibrated probabilistic forecasting across sport, politics, markets, and entertainment. An ensemble of frontier AI models, grounded in live research and our own resolved-forecast record.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/api/og/home" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "prophiq." },
      { name: "description", content: "Built for one job: calibrated probabilistic forecasting across sport, politics, markets, and entertainment. An ensemble of frontier AI models, grounded in live research and our own resolved-forecast record." },
      { property: "og:description", content: "Built for one job: calibrated probabilistic forecasting across sport, politics, markets, and entertainment. An ensemble of frontier AI models, grounded in live research and our own resolved-forecast record." },
      { name: "twitter:description", content: "Built for one job: calibrated probabilistic forecasting across sport, politics, markets, and entertainment. An ensemble of frontier AI models, grounded in live research and our own resolved-forecast record." },
      { name: "twitter:image", content: "/api/og/home" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32-amber.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/favicon-192-amber.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hideChrome = pathname.startsWith("/admin");

  // Fallback anonymous sign-in trigger. The primary trigger is in beforeLoad
  // above, but observation shows beforeLoad doesn't always fire reliably on
  // the deployed bundle. This useEffect catches the gap - if a session already
  // exists (from beforeLoad), ensureAnonymousSession short-circuits as a no-op.
  useEffect(() => {
    console.log("[root] mount fallback: ensuring anonymous session");
    ensureAnonymousSession().catch((err) => {
      console.error("[root] mount fallback anonymous sign-in failed:", err);
    });
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="flex h-[100dvh] flex-col"
        style={{ background: "var(--bg)", color: "var(--ink)" }}
      >
        {!hideChrome && (
          <>
            <AppHeader onMenuClick={() => setDrawerOpen(true)} />
            <TrialBanner />
            <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
          </>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      <PostCheckoutHandler />
      <PaywallModalContainer />
      <Toaster />
    </QueryClientProvider>
  );
}
