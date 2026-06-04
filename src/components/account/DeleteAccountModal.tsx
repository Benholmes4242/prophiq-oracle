import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "../../lib/supabase";
import { deleteAccount } from "../../lib/billing";

interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
  userEmail: string | null;
}

type State =
  | { kind: "warning" }
  | { kind: "confirm" }
  | { kind: "deleting" }
  | { kind: "error"; message: string };

export function DeleteAccountModal({
  open,
  onClose,
  userEmail,
}: DeleteAccountModalProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "warning" });
  const [confirmText, setConfirmText] = useState("");

  if (!open) return null;

  async function handleDelete() {
    setState({ kind: "deleting" });
    try {
      await deleteAccount();
      await supabase.auth.signOut();
      try {
        localStorage.clear();
      } catch {
        /* ignore storage errors */
      }
      await navigate({ to: "/" });
      if (typeof window !== "undefined") window.location.reload();
    } catch (err) {
      setState({
        kind: "error",
        message: (err as Error).message || "Failed to delete account",
      });
    }
  }

  function handleClose() {
    setState({ kind: "warning" });
    setConfirmText("");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
      onClick={state.kind === "deleting" ? undefined : handleClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{ background: "var(--bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {state.kind !== "deleting" && (
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-1 rounded-full hover:bg-black/5"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        {state.kind === "warning" && (
          <>
            <h2 className="text-xl font-bold mb-3" style={{ color: "var(--ink)" }}>
              Delete your account?
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>
              This is permanent. We'll:
            </p>
            <ul
              className="text-sm mb-4 space-y-2 pl-5 list-disc"
              style={{ color: "var(--ink)" }}
            >
              <li>
                Cancel your subscription immediately (no refund for the unused
                portion of the current period).
              </li>
              <li>Delete your Prophiq account and all browsing history.</li>
              <li>Remove your customer record from Stripe.</li>
            </ul>
            <p className="text-sm mb-6 text-[var(--ink)]/70">
              If you just want to stop being charged, you can cancel the
              subscription via "Manage subscription" instead and keep your
              account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium text-sm"
                style={{ background: "var(--ink)", color: "white" }}
              >
                Cancel
              </button>
              <button
                onClick={() => setState({ kind: "confirm" })}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium text-sm border"
                style={{
                  background: "var(--bg)",
                  color: "#B91C1C",
                  borderColor: "#B91C1C",
                }}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {state.kind === "confirm" && (
          <>
            <h2 className="text-xl font-bold mb-3" style={{ color: "var(--ink)" }}>
              Confirm deletion
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>
              Type <strong>delete</strong> to confirm permanent deletion of{" "}
              {userEmail ? <strong>{userEmail}</strong> : "your account"}.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              autoFocus
              className="w-full px-4 py-2.5 rounded-lg border text-sm mb-4"
              style={{
                background: "var(--bg)",
                borderColor: "var(--line)",
                color: "var(--ink)",
              }}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setState({ kind: "warning" })}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium text-sm border"
                style={{
                  background: "var(--bg)",
                  color: "var(--ink)",
                  borderColor: "var(--line)",
                }}
              >
                Back
              </button>
              <button
                onClick={handleDelete}
                disabled={confirmText.trim().toLowerCase() !== "delete"}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
                style={{ background: "#B91C1C", color: "white" }}
              >
                Delete account
              </button>
            </div>
          </>
        )}

        {state.kind === "deleting" && (
          <>
            <h2 className="text-xl font-bold mb-3" style={{ color: "var(--ink)" }}>
              Deleting your account...
            </h2>
            <p className="text-sm text-[var(--ink)]/70">
              Canceling subscription, removing data. This takes a few seconds.
            </p>
          </>
        )}

        {state.kind === "error" && (
          <>
            <h2 className="text-xl font-bold mb-3" style={{ color: "var(--ink)" }}>
              Something went wrong
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>
              {state.message}
            </p>
            <p className="text-xs text-[var(--ink)]/60 mb-4">
              Email{" "}
              <a
                href="mailto:support@prophiq.io"
                className="underline"
                style={{ color: "var(--ink)" }}
              >
                support@prophiq.io
              </a>{" "}
              and we'll handle it manually.
            </p>
            <button
              onClick={handleClose}
              className="w-full py-2.5 px-4 rounded-lg font-medium text-sm"
              style={{ background: "var(--ink)", color: "white" }}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
