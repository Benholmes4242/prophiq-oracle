import { Link, useLocation } from "@tanstack/react-router";
import type { AdminRole } from "@/lib/admin/queries";

interface NavItem {
  label: string;
  to?: string;
  comingSoon?: boolean;
  superAdminOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { label: "Dashboard", comingSoon: true },
  { label: "Users", to: "/admin/users" },
  { label: "Analytics", comingSoon: true },
  { label: "Revenue", comingSoon: true },
  { label: "System health", comingSoon: true },
  { label: "Jobs", comingSoon: true },
  { label: "Calibration", comingSoon: true },
  { label: "Events", comingSoon: true },
  { label: "Marquee", to: "/admin/marquee" },
  { label: "Audit", comingSoon: true },
  { label: "Admins", comingSoon: true, superAdminOnly: true },
];

export function AdminSidebar({ role }: { role: AdminRole | null }) {
  const { pathname } = useLocation();
  return (
    <nav
      className="flex w-56 shrink-0 flex-col gap-0.5 border-r px-3 py-4"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
    >
      {ITEMS.filter((i) => !i.superAdminOnly || role === "super_admin").map((item) => {
        const active = item.to && (pathname === item.to || pathname.startsWith(item.to + "/"));
        if (item.comingSoon || !item.to) {
          return (
            <div
              key={item.label}
              className="rounded-md px-3 py-1.5 font-body text-[13px] opacity-40"
              style={{ color: "var(--ink-soft)" }}
              title="Coming soon"
            >
              {item.label}
            </div>
          );
        }
        return (
          <Link
            key={item.label}
            to={item.to}
            className="rounded-md px-3 py-1.5 font-body text-[13px] transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
            style={{
              color: active ? "var(--amber-strong)" : "var(--ink)",
              background: active ? "rgba(245, 158, 11, 0.08)" : "transparent",
              fontWeight: active ? 600 : 500,
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
