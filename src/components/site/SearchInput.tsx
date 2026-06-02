import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

export function SearchInput() {
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  function submit() {
    const v = q.trim();
    if (!v) return;
    void navigate({ to: "/search", search: { q: v } as never });
    setExpanded(false);
    setQ("");
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Search"
        className="grid h-8 w-8 place-items-center rounded-full transition-ios-colors hover:bg-[var(--bg-card)]"
        style={{ color: "var(--ink-soft)" }}
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
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") setExpanded(false);
      }}
      onBlur={() => {
        if (!q) setExpanded(false);
      }}
      placeholder="Search events…"
      maxLength={120}
      className="font-body w-44 rounded-full px-3.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--amber)]/30 sm:w-56"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-strong)",
        color: "var(--ink)",
      }}
      aria-label="Search events"
    />
  );
}
