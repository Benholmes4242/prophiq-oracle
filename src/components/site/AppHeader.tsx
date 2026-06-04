import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { PhiMark } from "@/components/brand/PhiMark";
import { TierBadge } from "@/components/site/TierBadge";
import { LoginModal } from "@/components/auth/LoginModal";
import { useUsageQuota } from "@/hooks/useUsageQuota";
import { supabase } from "@/lib/supabase";

interface AppHeaderProps {
  onMenuClick: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  const isSearchPage = useRouterState({
    select: (s) => s.location.pathname === "/search",
  });
  const { usage } = useUsageQuota();
  const showPricingLink = !usage || usage.tier === "free";

  const [loginOpen, setLoginOpen] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      setIsAnonymous(user?.is_anonymous ?? true);
    }
    check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAnonymous(session?.user?.is_anonymous ?? true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <header
      className="flex items-center justify-between px-4 pb-1 pt-2.5"
      style={{ background: "var(--bg)", paddingTop: "max(env(safe-area-inset-top), 10px)" }}
    >
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="grid h-11 w-11 place-items-center rounded-full transition-ios-colors hover:bg-[rgba(11,18,32,0.05)] active:bg-[rgba(11,18,32,0.1)]"
        style={{ color: "var(--ink)" }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <Link
        to="/"
        aria-label="Prophiq home"
        className="grid h-[38px] w-[38px] place-items-center"
      >
        <PhiMark size={32} strokeWidth={11} ariaLabel="Prophiq home" />
      </Link>

      <div className="flex items-center gap-2">
        {showPricingLink && (
          <Link
            to="/pricing"
            className="hidden sm:inline-block text-sm font-medium hover:opacity-70"
            style={{ color: "var(--ink)" }}
          >
            Pricing
          </Link>
        )}
        {isAnonymous && (
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            className="text-sm font-medium hover:opacity-70"
            style={{ color: "var(--ink)" }}
          >
            Log in
          </button>
        )}
        <TierBadge />
        <Link
          to="/search"
          aria-label="Search"
          aria-current={isSearchPage ? "page" : undefined}
          className="grid h-11 w-11 place-items-center rounded-full transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
          style={{ color: isSearchPage ? "var(--amber-2)" : "var(--ink)" }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" strokeLinecap="round" />
          </svg>
        </Link>
      </div>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </header>
  );
}
