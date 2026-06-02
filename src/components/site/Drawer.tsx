import { useEffect } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { PhiMark } from "@/components/brand/PhiMark";
import { Wordmark } from "@/components/brand/Wordmark";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: Array<{
  label?: string;
  items: Array<{ label: string; to: string }>;
}> = [
  {
    items: [
      { label: "Home", to: "/" },
      { label: "Search", to: "/search" },
      { label: "Asked", to: "/asked" },
    ],
  },
  {
    label: "BROWSE",
    items: [
      { label: "Sport", to: "/sport" },
      { label: "Politics", to: "/politics" },
      { label: "Markets", to: "/markets" },
      { label: "Entertainment", to: "/entertainment" },
    ],
  },
  {
    label: "EVIDENCE",
    items: [
      { label: "Receipts", to: "/receipts" },
      { label: "All predictions", to: "/predictions" },
      { label: "How it works", to: "/about" },
    ],
  },
  {
    label: "LEGAL",
    items: [
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
      { label: "Contact", to: "/contact" },
    ],
  },
];

function isActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(to + "/");
}

export function Drawer({ open, onClose }: DrawerProps) {
  const { pathname } = useLocation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <div
        className={`fixed inset-0 z-[100] ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{
          background: "rgba(11, 18, 32, 0.4)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          transition: "opacity 280ms var(--ease-ios)",
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className="fixed bottom-0 left-0 top-0 z-[110] flex flex-col overflow-y-auto"
        style={{
          width: 300,
          maxWidth: "85vw",
          background: "var(--bg)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 360ms cubic-bezier(0.32, 0.72, 0, 1)",
          boxShadow: open ? "4px 0 32px rgba(11, 18, 32, 0.1)" : "none",
        }}
        aria-label="Primary navigation"
        aria-hidden={!open}
      >
        <Link
          to="/"
          onClick={onClose}
          className="flex items-center gap-2.5 px-5 pb-6 pt-14"
          style={{ textDecoration: "none" }}
        >
          <PhiMark size={30} strokeWidth={11} />
          <Wordmark size={26} />
        </Link>

        {SECTIONS.map((section, i) => (
          <div
            key={i}
            className="border-t py-3.5"
            style={{ borderColor: "var(--border-soft)" }}
          >
            {section.label && (
              <div
                className="mb-1.5 px-5 font-mono text-[10px] font-semibold uppercase"
                style={{ letterSpacing: "0.22em", color: "var(--ink-faint)" }}
              >
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const active = isActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className="block px-5 py-2.5 font-body text-[15px] transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
                  style={{
                    color: active ? "var(--amber-strong)" : "var(--ink)",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}

        <div
          className="mt-auto border-t px-5 pb-6 pt-4 font-body text-[11.5px] leading-[1.4]"
          style={{ borderColor: "var(--border-soft)", color: "var(--ink-faint)" }}
        >
          © {new Date().getFullYear()} prophiq. Calibrated forecasts for every
          upcoming event.
        </div>
      </aside>
    </>
  );
}
