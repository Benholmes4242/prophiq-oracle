import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  adminGrantPro,
  adminRevokePro,
  adminAdjustQuota,
  adminSuspendUser,
  adminUnsuspendUser,
  adminForceDeleteUser,
  adminResendOtp,
  adminStripeForceCancel,
  adminStripeRefund,
} from "@/lib/admin/actions";
import type { AdminRole } from "@/lib/admin/queries";

type ActionKey =
  | "grant_pro"
  | "revoke_pro"
  | "adjust_quota"
  | "suspend"
  | "unsuspend"
  | "force_cancel"
  | "refund"
  | "resend_otp"
  | "force_delete";

const ROLE_REQUIREMENTS: Record<ActionKey, AdminRole[]> = {
  grant_pro: ["super_admin", "admin", "support"],
  revoke_pro: ["super_admin", "admin", "support"],
  adjust_quota: ["super_admin", "admin", "support"],
  suspend: ["super_admin", "admin"],
  unsuspend: ["super_admin", "admin"],
  force_cancel: ["super_admin", "admin"],
  refund: ["super_admin", "admin"],
  resend_otp: ["super_admin", "admin", "support"],
  force_delete: ["super_admin"],
};

function can(role: AdminRole | null, action: ActionKey): boolean {
  return !!role && ROLE_REQUIREMENTS[action].includes(role);
}

export interface UserActionsPanelProps {
  userId: string;
  userEmail: string;
  role: AdminRole | null;
  suspendedAt: string | null;
  activeOverrideId: string | null;
  activeOverrideTier: string | null;
  stripeSubscriptionId: string | null;
  onChanged: () => void;
}

interface ModalState {
  action: ActionKey;
  title: string;
  fields: ("reason" | "tier" | "expires" | "extra" | "confirm")[];
}

export function UserActionsPanel(props: UserActionsPanelProps) {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [reason, setReason] = useState("");
  const [tier, setTier] = useState<"standard" | "pro">("pro");
  const [expires, setExpires] = useState<string>("");
  const [extra, setExtra] = useState<number>(5);
  const [confirmText, setConfirmText] = useState("");

  function openModal(m: ModalState) {
    setReason(""); setExpires(""); setExtra(5); setConfirmText(""); setTier("pro");
    setErr(null); setModal(m);
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      switch (modal!.action) {
        case "grant_pro":
          await adminGrantPro({
            userId: props.userId, tier, reason,
            expiresAt: expires ? new Date(expires).toISOString() : null,
          });
          break;
        case "revoke_pro":
          if (!props.activeOverrideId) throw new Error("No active override");
          await adminRevokePro(props.activeOverrideId, reason);
          break;
        case "adjust_quota":
          await adminAdjustQuota({ userId: props.userId, extra, reason });
          break;
        case "suspend":
          await adminSuspendUser(props.userId, reason);
          break;
        case "unsuspend":
          await adminUnsuspendUser(props.userId);
          break;
        case "force_cancel":
          if (!props.stripeSubscriptionId) throw new Error("No Stripe subscription");
          await adminStripeForceCancel({
            userId: props.userId,
            subscriptionId: props.stripeSubscriptionId,
            reason,
          });
          break;
        case "resend_otp":
          await adminResendOtp(props.userId);
          break;
        case "force_delete":
          if (confirmText !== props.userEmail) throw new Error("Email confirmation does not match");
          await adminForceDeleteUser(props.userId, reason);
          break;
      }
      setModal(null);
      props.onChanged();
      await queryClient.invalidateQueries({ queryKey: ["admin-user-detail", props.userId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function Btn({ label, action, danger }: { label: string; action: ActionKey; danger?: boolean }) {
    const allowed = can(props.role, action);
    return (
      <button
        type="button"
        disabled={!allowed}
        title={!allowed ? `Requires ${ROLE_REQUIREMENTS[action].join(" / ")}` : undefined}
        onClick={() => openModal({
          action,
          title: label,
          fields: action === "force_delete"
            ? ["reason", "confirm"]
            : action === "unsuspend" || action === "resend_otp"
              ? []
              : action === "grant_pro"
                ? ["tier", "expires", "reason"]
                : action === "adjust_quota"
                  ? ["extra", "reason"]
                  : ["reason"],
        })}
        className="rounded-md px-3 py-1.5 font-body text-[12px] transition-ios-colors"
        style={{
          border: `1px solid ${danger ? "#B91C1C44" : "var(--border-strong)"}`,
          color: danger ? "#B91C1C" : "var(--ink)",
          opacity: allowed ? 1 : 0.35,
          background: "var(--bg)",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-soft)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3
          className="font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          Actions
        </h3>
        <div className="flex gap-1">
          {props.activeOverrideTier && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{ background: "#7c3aed14", color: "#7c3aed", border: "1px solid #7c3aed33" }}
            >
              Comp {props.activeOverrideTier}
            </span>
          )}
          {props.suspendedAt && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{ background: "#B91C1C14", color: "#B91C1C", border: "1px solid #B91C1C33" }}
            >
              Suspended
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Btn label="Grant Pro" action="grant_pro" />
        <Btn label="Revoke Pro" action="revoke_pro" />
        <Btn label="Adjust quota" action="adjust_quota" />
        <Btn label="Resend OTP" action="resend_otp" />
        {props.suspendedAt
          ? <Btn label="Unsuspend" action="unsuspend" />
          : <Btn label="Suspend" action="suspend" danger />}
        <Btn label="Force cancel sub" action="force_cancel" danger />
        <Btn label="Force delete" action="force_delete" danger />
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !busy && setModal(null)}>
          <div
            className="w-full max-w-md rounded-xl border p-5"
            style={{ background: "var(--bg)", borderColor: "var(--border-soft)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-[18px]" style={{ fontWeight: 600 }}>{modal.title}</h3>
            <p className="mt-1 font-body text-[12px]" style={{ color: "var(--ink-soft)" }}>
              {props.userEmail}
            </p>

            <div className="mt-4 space-y-3">
              {modal.fields.includes("tier") && (
                <label className="block font-body text-[12px]">
                  Tier
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value as "standard" | "pro")}
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-[13px]"
                    style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
                  >
                    <option value="standard">Standard</option>
                    <option value="pro">Pro</option>
                  </select>
                </label>
              )}
              {modal.fields.includes("expires") && (
                <label className="block font-body text-[12px]">
                  Expires (blank = no expiry)
                  <input
                    type="date"
                    value={expires}
                    onChange={(e) => setExpires(e.target.value)}
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-[13px]"
                    style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
                  />
                </label>
              )}
              {modal.fields.includes("extra") && (
                <label className="block font-body text-[12px]">
                  Extra forecasts today
                  <input
                    type="number"
                    min={1}
                    value={extra}
                    onChange={(e) => setExtra(Math.max(1, Number(e.target.value)))}
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-[13px]"
                    style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
                  />
                </label>
              )}
              {modal.fields.includes("reason") && (
                <label className="block font-body text-[12px]">
                  Reason (required, audited)
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-[13px]"
                    style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
                  />
                </label>
              )}
              {modal.fields.includes("confirm") && (
                <label className="block font-body text-[12px]">
                  Type the user's email to confirm
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={props.userEmail}
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-[13px]"
                    style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
                  />
                </label>
              )}
              {err && <p className="font-body text-[12px]" style={{ color: "#B91C1C" }}>{err}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setModal(null)}
                className="rounded-md px-3 py-1.5 font-body text-[12px]"
                style={{ color: "var(--ink-soft)" }}
              >Cancel</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="rounded-md px-3 py-1.5 font-body text-[12px]"
                style={{ background: "var(--ink)", color: "white" }}
              >
                {busy ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
