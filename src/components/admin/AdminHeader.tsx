import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PhiMark } from "@/components/brand/PhiMark";
import { Wordmark } from "@/components/brand/Wordmark";
import { supabase } from "@/lib/supabase";
import {
  adminListNotifications,
  adminMarkNotificationsRead,
  type AdminNotification,
} from "@/lib/admin/notifications";

function severityDot(sev: AdminNotification["severity"]): string {
  if (sev === "critical") return "#B91C1C";
  if (sev === "warning") return "var(--amber-strong)";
  return "var(--ink-soft)";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

interface AdminHeaderProps {
  email: string | null;
  onToggleSidebar?: () => void;
}

export function AdminHeader({ email, onToggleSidebar }: AdminHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["admin", "notifications"],
    queryFn: () => adminListNotifications(30, false),
    refetchInterval: 60_000,
  });

  const unreadCount = notifications[0]?.unread_count ?? 0;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    if (menuOpen || bellOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen, bellOpen]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  async function markAllRead() {
    await adminMarkNotificationsRead();
    await queryClient.invalidateQueries({ queryKey: ["admin", "notifications"] });
  }

  async function markOneRead(id: string) {
    await adminMarkNotificationsRead(id);
    await queryClient.invalidateQueries({ queryKey: ["admin", "notifications"] });
  }

  return (
    <header
      className="flex h-12 items-center justify-between border-b px-4"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
    >
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={onToggleSidebar}
            className="grid h-8 w-8 place-items-center rounded-md transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
            style={{ color: "var(--ink)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        )}
        <Link to="/admin" className="flex items-center gap-2">
          <PhiMark size={22} strokeWidth={11} />
          <Wordmark size={18} />
          <span
            className="ml-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em]"
            style={{ borderColor: "var(--border-strong)", color: "var(--ink-soft)" }}
          >
            Admin
          </span>
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <div ref={bellRef} className="relative">
          <button
            type="button"
            aria-label={unreadCount > 0 ? `Notifications: ${unreadCount} unread` : "Notifications"}
            onClick={() => setBellOpen((v) => !v)}
            className="relative grid h-8 w-8 place-items-center rounded-full transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
            style={{ color: "var(--ink)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2zm-6 6a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z" />
            </svg>
            {unreadCount > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full px-1 font-mono text-[10px] font-semibold leading-none"
                style={{ height: 16, background: "var(--amber-strong)", color: "white" }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
          {bellOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-[360px] overflow-hidden rounded-xl border shadow-lg"
              style={{ background: "var(--bg)", borderColor: "var(--line)" }}
            >
              <div
                className="flex items-center justify-between border-b px-4 py-2"
                style={{ borderColor: "var(--border-soft)" }}
              >
                <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
                  Notifications
                </span>
                <button
                  type="button"
                  onClick={markAllRead}
                  className="font-mono text-[11px] hover:underline"
                  style={{ color: "var(--ink)" }}
                >
                  Mark all read
                </button>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-soft)" }}>
                    No notifications
                  </div>
                ) : (
                  notifications.map((n) => {
                    const rowContent = (
                      <div className="flex gap-2.5 px-4 py-2.5">
                        <span
                          aria-hidden
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: severityDot(n.severity) }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <div
                              className="truncate text-sm"
                              style={{ color: "var(--ink)", fontWeight: n.is_read ? 400 : 600 }}
                            >
                              {n.title}
                            </div>
                            <div
                              className="shrink-0 font-mono text-[10px]"
                              style={{ color: "var(--ink-soft)" }}
                            >
                              {relativeTime(n.created_at)}
                            </div>
                          </div>
                          {n.body && (
                            <div className="mt-0.5 line-clamp-2 text-xs" style={{ color: "var(--ink-soft)" }}>
                              {n.body}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                    const className =
                      "block w-full text-left transition-ios-colors hover:bg-[rgba(11,18,32,0.04)]";
                    if (n.target_url) {
                      return (
                        <Link
                          key={n.id}
                          to={n.target_url}
                          onClick={() => { setBellOpen(false); void markOneRead(n.id); }}
                          className={className}
                        >
                          {rowContent}
                        </Link>
                      );
                    }
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => { void markOneRead(n.id); }}
                        className={className}
                      >
                        {rowContent}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full border px-3 py-1 font-mono text-[11px]"
            style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}
          >
            {email ?? "admin"}
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border py-1.5 shadow-lg"
              style={{ background: "var(--bg)", borderColor: "var(--line)" }}
            >
              <Link
                to="/"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2 text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
                style={{ color: "var(--ink)" }}
              >
                Back to app
              </Link>
              <Link
                to="/account"
                onClick={() => setMenuOpen(false)}
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
