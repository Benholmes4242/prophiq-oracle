import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PhiMark } from "@/components/brand/PhiMark";
import { Wordmark } from "@/components/brand/Wordmark";
import { supabase } from "@/lib/supabase";

export function AdminHeader({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <header
      className="flex h-12 items-center justify-between border-b px-4"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
    >
      <Link to="/admin/users" className="flex items-center gap-2">
        <PhiMark size={22} strokeWidth={11} />
        <Wordmark size={18} />
        <span
          className="ml-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em]"
          style={{ borderColor: "var(--border-strong)", color: "var(--ink-soft)" }}
        >
          Admin
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Notifications (coming soon)"
          className="grid h-8 w-8 place-items-center rounded-full opacity-40"
          style={{ color: "var(--ink)" }}
          disabled
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2zm-6 6a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z" />
          </svg>
        </button>
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border px-3 py-1 font-mono text-[11px]"
            style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}
          >
            {email ?? "admin"}
          </button>
          {open && (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border py-1.5 shadow-lg"
              style={{ background: "var(--bg)", borderColor: "var(--line)" }}
            >
              <Link
                to="/"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
                style={{ color: "var(--ink)" }}
              >
                Back to app
              </Link>
              <Link
                to="/account"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
                style={{ color: "var(--ink)" }}
              >
                Account
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="block w-full px-4 py-2 text-left text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
                style={{ color: "var(--ink)" }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
