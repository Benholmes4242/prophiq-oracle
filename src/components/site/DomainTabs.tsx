import { Link, useLocation } from "@tanstack/react-router";

const TABS = [
  { id: "all", label: "All", to: "/" },
  { id: "sport", label: "Sport", to: "/sport" },
  { id: "politics", label: "Politics", to: "/politics" },
  { id: "markets", label: "Markets", to: "/markets" },
  { id: "entertainment", label: "Entertainment", to: "/entertainment" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function getActiveTabId(pathname: string): TabId {
  if (pathname === "/") return "all";
  const match = TABS.find((t) => t.id !== "all" && pathname.startsWith(t.to));
  return (match?.id as TabId) ?? "all";
}

export function DomainTabs() {
  const { pathname } = useLocation();
  const active = getActiveTabId(pathname);

  return (
    <nav
      aria-label="Domain navigation"
      className="border-b"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
    >
      <div className="mx-auto max-w-2xl px-5 py-2.5">
        <div
          className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <Link
                key={tab.id}
                to={tab.to}
                className="shrink-0 rounded-full font-body text-[13px] font-medium transition-ios-colors"
                style={{
                  padding: "6px 16px",
                  minHeight: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  background: isActive ? "var(--ink)" : "transparent",
                  color: isActive ? "white" : "var(--ink-soft)",
                  border: isActive
                    ? "1px solid var(--ink)"
                    : "1px solid var(--border-strong)",
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
