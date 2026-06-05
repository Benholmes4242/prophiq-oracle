import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { MfaBanner } from "@/components/admin/MfaBanner";
import { MfaChallengeScreen } from "@/components/admin/MfaChallengeScreen";
import { getMfaEnforcementStart, listFactors, getCurrentAal, getMfaVerifiedAt } from "@/lib/admin/mfa";
import type { AdminRole } from "@/lib/admin/queries";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const MFA_REQUIRED_ROLES: AdminRole[] = ["super_admin", "admin"];

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      throw redirect({ to: "/", search: { reason: "admin_required" } as never });
    }
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (!isAdmin) {
      throw redirect({ to: "/", search: { reason: "admin_required" } as never });
    }
    const { data: role } = await supabase.rpc("get_admin_role");
    return { adminRole: (role as AdminRole | null) ?? null };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { adminRole } = Route.useRouteContext();
  const [email, setEmail] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (mounted) setEmail(user?.email ?? null);
    });
    return () => { mounted = false; };
  }, []);

  const mfaRequired = !!adminRole && MFA_REQUIRED_ROLES.includes(adminRole);

  const { data: mfa, refetch: refetchMfa, isError: mfaError } = useQuery({
    queryKey: ["admin", "mfa-state"],
    queryFn: async () => {
      const [start, factors, aal, verifiedAt] = await Promise.all([
        getMfaEnforcementStart(),
        listFactors(),
        getCurrentAal(),
        getMfaVerifiedAt(),
      ]);
      return {
        enforcementStart: start,
        hasFactor: factors.totpVerified,
        factorId: factors.factorId,
        aalCurrent: aal.current,
        lastVerifiedAt: verifiedAt,
      };
    },
    enabled: mfaRequired,
  });

  const past = mfa?.enforcementStart
    ? new Date() >= new Date(mfa.enforcementStart)
    : false;
  const needsBanner = mfaRequired && mfa && !mfa.hasFactor;
  const hardBlock = needsBanner && past;

  // Fail-closed: if the mfa-state query errored while mfaRequired, treat as
  // needs-challenge (admin can always recover via the recovery code path).
  const staleVerify = mfa?.lastVerifiedAt
    ? Date.now() - new Date(mfa.lastVerifiedAt).getTime() > TWELVE_HOURS_MS
    : true;
  const needsChallenge =
    mfaRequired &&
    !hardBlock &&
    (
      (mfa && mfa.hasFactor && (mfa.aalCurrent !== "aal2" || staleVerify)) ||
      (mfaError && !mfa)
    );

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <AdminHeader email={email} onToggleSidebar={() => setCollapsed((v) => !v)} />
      {needsBanner && (
        <MfaBanner
          enforcementStart={mfa?.enforcementStart ?? null}
          enforced={!!past}
          onEnrolled={() => void refetchMfa()}
        />
      )}
      {hardBlock ? (
        <main className="grid flex-1 place-items-center px-6 py-10">
          <div className="max-w-md text-center">
            <h2 className="font-display text-[20px]" style={{ fontWeight: 600 }}>
              MFA required
            </h2>
            <p className="mt-2 font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>
              Your admin role requires multi-factor authentication. Use the
              banner above to enroll before continuing.
            </p>
          </div>
        </main>
      ) : needsChallenge ? (
        <MfaChallengeScreen
          factorId={mfa?.factorId ?? null}
          onVerified={() => void refetchMfa()}
        />
      ) : (
        <div className="flex flex-1">
          <AdminSidebar role={adminRole} collapsed={collapsed} />
          <main className="min-w-0 flex-1 overflow-x-auto px-6 py-5">
            <Outlet />
          </main>
        </div>
      )}
    </div>
  );
}
