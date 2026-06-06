import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { PhiMark } from "@/components/brand/PhiMark";
import { TierBadge } from "@/components/site/TierBadge";
import { LoginModal } from "@/components/auth/LoginModal";
import { useUsageQuota } from "@/hooks/useUsageQuota";
import { useIsAdmin } from "@/lib/admin/useIsAdmin";
import { supabase } from "@/lib/supabase";

interface AppHeaderProps {
  onMenuClick: () => void;
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setOpen(false);
    navigate({ to: "/" });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus:outline-none"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <TierBadge />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-44 rounded-xl border py-1.5 shadow-lg"
          style={{
            background: "var(--bg)",
            borderColor: "var(--line)",
          }}
          role="menu"
        >
          {isAdmin && (
            <Link
              to="/admin/users"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
              style={{ color: "var(--ink)" }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Admin
            </Link>
          )}
          <Link
            to="/account"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
            style={{ color: "var(--ink)" }}
          >
            Account
          </Link>
          <Link
            to="/pricing"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
            style={{ color: "var(--ink)" }}
          >
            Pricing
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="block w-full px-4 py-2 text-left text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
            style={{ color: "var(--ink)" }}
            role="menuitem"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  const isSearchPage = useRouterState({
    select: (s) => s.location.pathname === "/search",
  });
  const { usage } = useUsageQuota();
  const showPricingLink = !usage || usage.tier === "free";

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | undefined>(undefined);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      setIsAuthenticated(!!user && !user.is_anonymous);
    }
    refresh();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "USER_UPDATED" ||
        event === "TOKEN_REFRESHED"
      ) {
        refresh();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Listen for cross-component login-open requests (e.g. from Drawer or /pricing)
  useEffect(() => {
    function onOpenLogin(e: Event) {
      const detail = (e as CustomEvent<{ message?: string; mode?: "signin" | "signup" }>).detail;
      setLoginMessage(detail?.message);
      setLoginMode(detail?.mode ?? "signin");
      setLoginOpen(true);
    }
    window.addEventListener("prophiq:open-login", onOpenLogin);
    return () => window.removeEventListener("prophiq:open-login", onOpenLogin);
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
        {isAuthenticated ? (
          <UserMenu />
        ) : (
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            className="text-sm font-medium hover:opacity-70"
            style={{ color: "var(--ink)" }}
          >
            Log in
          </button>
        )}
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

      <LoginModal open={loginOpen} onClose={() => { setLoginOpen(false); setLoginMessage(undefined); }} message={loginMessage} />
    </header>
  );
}
