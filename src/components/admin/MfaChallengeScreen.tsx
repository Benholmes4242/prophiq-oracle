import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { verifyTotp, stampMfaVerified } from "@/lib/admin/mfa";

interface Props {
  factorId: string | null;
  onVerified: () => void;
}

async function logFailure() {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    await Promise.all([
      supabase.rpc("raise_admin_notification", {
        p_severity: "warning",
        p_kind: "security",
        p_title: "Admin MFA challenge failed",
        p_detail: "An admin failed a TOTP verification challenge.",
        p_source: "auth",
        p_link: "/admin/audit",
        p_dedup_key: `security:mfa_fail:${uid}`,
        p_metadata: {},
      }),
      supabase.rpc("log_admin_action", {
        p_action: "admin.mfa_challenge_failed",
        p_target_type: "admin",
        p_target_id: uid,
        p_before_state: null,
        p_after_state: null,
        p_metadata: {},
      }),
    ]);
  } catch {
    // best effort
  }
}

export function MfaChallengeScreen({ factorId, onVerified }: Props) {
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);

  async function doVerify() {
    if (!factorId) { setErr("No TOTP factor available. Use a recovery code."); return; }
    setBusy(true); setErr(null);
    try {
      await verifyTotp(factorId, code);
      await stampMfaVerified();
      onVerified();
    } catch (e) {
      setErr((e as Error).message || "Invalid code");
      void logFailure();
    } finally {
      setBusy(false);
    }
  }

  async function doRecovery() {
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.functions.invoke("admin-mfa-recovery", {
        body: { action: "consume", code: recovery },
      });
      if (error) throw new Error(error.message);
      setRecoveryDone(true);
    } catch (e) {
      setErr((e as Error).message || "Recovery code rejected");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid flex-1 place-items-center px-6 py-10">
      <div
        className="w-full max-w-md rounded-xl border p-6"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-soft)" }}
      >
        <h2 className="font-display text-[20px]" style={{ fontWeight: 600 }}>
          Verify it's you
        </h2>
        <p className="mt-1 font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>
          {mode === "totp"
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter one of your single-use recovery codes."}
        </p>

        {recoveryDone ? (
          <div className="mt-5 space-y-3">
            <p className="font-body text-[13px]">
              Recovery code accepted. Your TOTP factor has been cleared. Reload
              and re-enroll MFA to continue.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-md px-3 py-1.5 font-body text-[13px]"
              style={{ background: "var(--ink)", color: "white" }}
            >Reload</button>
          </div>
        ) : mode === "totp" ? (
          <div className="mt-5 space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-md px-2 py-2 text-center font-mono text-[18px] tracking-[0.4em]"
              style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
            />
            {err && <p className="font-body text-[12px]" style={{ color: "#B91C1C" }}>{err}</p>}
            <button
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => void doVerify()}
              className="w-full rounded-md px-3 py-1.5 font-body text-[13px] disabled:opacity-40"
              style={{ background: "var(--ink)", color: "white" }}
            >{busy ? "Verifying…" : "Verify"}</button>
            <button
              type="button"
              onClick={() => { setErr(null); setMode("recovery"); }}
              className="w-full text-center font-body text-[12px]"
              style={{ color: "var(--ink-soft)" }}
            >Use a recovery code instead</button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <input
              type="text"
              autoFocus
              value={recovery}
              onChange={(e) => setRecovery(e.target.value.trim())}
              placeholder="recovery code"
              className="w-full rounded-md px-2 py-2 text-center font-mono text-[14px]"
              style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
            />
            {err && <p className="font-body text-[12px]" style={{ color: "#B91C1C" }}>{err}</p>}
            <button
              type="button"
              disabled={busy || recovery.length < 6}
              onClick={() => void doRecovery()}
              className="w-full rounded-md px-3 py-1.5 font-body text-[13px] disabled:opacity-40"
              style={{ background: "var(--ink)", color: "white" }}
            >{busy ? "Submitting…" : "Use recovery code"}</button>
            <button
              type="button"
              onClick={() => { setErr(null); setMode("totp"); }}
              className="w-full text-center font-body text-[12px]"
              style={{ color: "var(--ink-soft)" }}
            >Back to authenticator code</button>
          </div>
        )}
      </div>
    </main>
  );
}
