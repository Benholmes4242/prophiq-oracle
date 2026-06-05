import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import type { AdminRole } from "@/lib/admin/queries";

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
  // Default collapsed below md (768px). Component state only (not persisted) -
  // per brief, persistence is intentionally out of scope.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (mounted) setEmail(user?.email ?? null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <AdminHeader email={email} onToggleSidebar={() => setCollapsed((v) => !v)} />
      <div className="flex flex-1">
        <AdminSidebar role={adminRole} collapsed={collapsed} />
        <main className="min-w-0 flex-1 overflow-x-auto px-6 py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
