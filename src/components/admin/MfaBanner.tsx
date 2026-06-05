import { useState } from "react";
import { MfaEnrollModal } from "./MfaEnrollModal";

interface Props {
  enforcementStart: string | null;
  enforced: boolean;
  onEnrolled: () => void;
}

export function MfaBanner({ enforcementStart, enforced, onEnrolled }: Props) {
  const [open, setOpen] = useState(false);
  const color = enforced ? "#B91C1C" : "var(--amber-strong)";
  const label = enforced
    ? "MFA is required. Enroll now to continue."
    : `MFA enrollment required by ${enforcementStart ?? "soon"}.`;

  return (
    <>
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm"
        style={{ borderColor: "var(--border-soft)", background: `${color}10`, color }}
      >
        <span className="font-body">⚠ {label}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md px-3 py-1 font-mono text-[11px]"
          style={{ border: `1px solid ${color}66`, color }}
        >
          Enroll MFA
        </button>
      </div>
      {open && (
        <MfaEnrollModal
          onClose={() => setOpen(false)}
          onComplete={() => { setOpen(false); onEnrolled(); }}
        />
      )}
    </>
  );
}
