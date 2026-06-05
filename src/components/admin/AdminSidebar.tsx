import { Link, useLocation } from "@tanstack/react-router";
import type { AdminRole } from "@/lib/admin/queries";

interface NavItem {
  label: string;
  to?: string;
  comingSoon?: boolean;
  superAdminOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/admin" },
  { label: "Users", to: "/admin/users" },
  { label: "Analytics", comingSoon: true },
  { label: "Revenue", to: "/admin/revenue" },
  { label: "System health", to: "/admin/health" },
  { label: "Jobs", comingSoon: true },
  { label: "Calibration", to: "/admin/calibration" },
  { label: "Events", comingSoon: true },
  { label: "Marquee", to: "/admin/marquee" },
  { label: "Audit", to: "/admin/audit" },
  { label: "Admins", comingSoon: true, superAdminOnly: true },
];

function glyph(label: string): string {
  return label.charAt(0).toUpperCase();
}

interface AdminSidebarProps {
  role: AdminRole | null;
  collapsed: boolean;
}

export function AdminSidebar({ role, collapsed }: AdminSidebarProps) {
  const { pathname } = useLocation();
  const items = ITEMS.filter((i) => !i.superAdminOnly || role === "super_admin");

  return (
    <nav
      className={`flex shrink-0 flex-col gap-0.5 border-r py-4 transition-[width] duration-150 ${collapsed ? "w-14 px-1.5" : "w-56 px-3"}`}
      style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
    >
      {items.map((item) => {
        const active =
          item.to &&
          (pathname === item.to ||
            (item.to !== "/admin" && pathname.startsWith(item.to + "/")));

        if (collapsed) {
          const dot = (
            <span
              key={item.label}
              title={item.comingSoon ? `${item.label} (coming soon)` : item.label}
              className="grid h-9 w-9 place-items-center rounded-md font-mono text-[12px]"
              style={{
                color: item.comingSoon ? "var(--ink-soft)" : active ? "var(--amber-strong)" : "var(--ink)",
                opacity: item.comingSoon ? 0.4 : 1,
                background: active ? "rgba(245, 158, 11, 0.08)" : "transparent",
              }}
            >
              {glyph(item.label)}
            </span>
          );
          if (item.comingSoon || !item.to) {
            return <div key={item.label} className="flex justify-center">{dot}</div>;
          }
          return (
            <Link key={item.label} to={item.to} className="flex justify-center">
              {dot}
            </Link>
          );
        }

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
