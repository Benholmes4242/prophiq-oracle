import { Link } from "@tanstack/react-router";
import { SearchInput } from "./SearchInput";
import { DomainTabs } from "./DomainTabs";
import { PhiMark } from "@/components/brand/PhiMark";
import { Wordmark } from "@/components/brand/Wordmark";

interface HeaderProps {
  showTabs?: boolean;
}

export function Header({ showTabs = true }: HeaderProps) {
  return (
    <>
      <header
        className="border-b"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-5 py-4 sm:py-5">
          <Link to="/" className="flex items-center gap-2.5">
            <PhiMark size={28} strokeWidth={11} />
            <Wordmark size={18} />
          </Link>
          <div className="flex items-center gap-3">
            <SearchInput />
            <Link
              to="/about"
              className="font-body text-[13px] transition-ios-colors hover:text-[var(--ink)]"
              style={{ color: "var(--ink-soft)", fontWeight: 500 }}
            >
              How it works
            </Link>
          </div>
        </div>
      </header>
      {showTabs && <DomainTabs />}
    </>
  );
}
