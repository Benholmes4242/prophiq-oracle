import { useEffect, useState } from "react";
import { enrollTotp, verifyTotp, generateRecoveryCode } from "@/lib/admin/mfa";

interface Props {
  onComplete: () => void;
  onClose: () => void;
}

export function MfaEnrollModal({ onComplete, onClose }: Props) {
  const [step, setStep] = useState<"loading" | "scan" | "verify" | "recovery" | "done">("loading");
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [factorId, setFactorId] = useState<string>("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await enrollTotp();
        setFactorId(r.factorId); setQr(r.qr); setSecret(r.secret);
        setStep("scan");
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  async function doVerify() {
    setBusy(true); setErr(null);
    try {
      await verifyTotp(factorId, code);
      const rc = await generateRecoveryCode();
      setRecovery(rc);
      setStep("recovery");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-xl border p-5"
        style={{ background: "var(--bg)", borderColor: "var(--border-soft)" }}
      >
        <h3 className="font-display text-[20px]" style={{ fontWeight: 600 }}>Enroll MFA</h3>
        <p className="mt-1 font-body text-[12px]" style={{ color: "var(--ink-soft)" }}>
          Required for admin access.
        </p>

        {step === "loading" && <p className="mt-4 text-sm">Generating secret…</p>}

        {step === "scan" && (
          <div className="mt-4 space-y-3">
            <p className="font-body text-[13px]">Scan with your authenticator app:</p>
            {qr && <img src={qr} alt="MFA QR code" className="mx-auto h-44 w-44" />}
            <p className="break-all font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
              Or enter manually: {secret}
            </p>
            <button
              type="button"
              onClick={() => setStep("verify")}
              className="w-full rounded-md px-3 py-1.5 font-body text-[13px]"
              style={{ background: "var(--ink)", color: "white" }}
            >Continue</button>
          </div>
        )}

        {step === "verify" && (
          <div className="mt-4 space-y-3">
            <label className="block font-body text-[12px]">
              6-digit code
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-1 w-full rounded-md px-2 py-1.5 text-center font-mono text-[16px] tracking-[0.4em]"
                style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
              />
            </label>
            {err && <p className="font-body text-[12px]" style={{ color: "#B91C1C" }}>{err}</p>}
            <button
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => void doVerify()}
              className="w-full rounded-md px-3 py-1.5 font-body text-[13px] disabled:opacity-40"
              style={{ background: "var(--ink)", color: "white" }}
            >{busy ? "Verifying…" : "Verify"}</button>
          </div>
        )}

        {step === "recovery" && (
          <div className="mt-4 space-y-3">
            <p className="font-body text-[13px]">
              Store this recovery code. It is shown <strong>once</strong>:
            </p>
            <pre
              className="rounded-md border p-3 text-center font-mono text-[14px]"
              style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
            >{recovery}</pre>
            <button
              type="button"
              onClick={() => { onComplete(); }}
              className="w-full rounded-md px-3 py-1.5 font-body text-[13px]"
              style={{ background: "var(--ink)", color: "white" }}
            >I have saved it</button>
          </div>
        )}

        {err && step === "loading" && (
          <p className="mt-4 font-body text-[12px]" style={{ color: "#B91C1C" }}>{err}</p>
        )}

        {step !== "recovery" && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full text-center font-body text-[11px]"
            style={{ color: "var(--ink-soft)" }}
          >Close</button>
        )}
      </div>
    </div>
  );
}
