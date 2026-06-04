import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { OTPInput } from "../auth/OTPInput";
import { useInvalidateSubscriptionState } from "../../hooks/useActiveSubscription";

interface MergeAccountPromptProps {
  email: string;
  onDismiss: () => void;
}

type State =
  | { kind: "enter-confirm" }
  | { kind: "enter-code"; cooldownUntil: number | null }
  | { kind: "verifying" }
  | { kind: "success" };

export function MergeAccountPrompt({ email, onDismiss }: MergeAccountPromptProps) {
  const [state, setState] = useState<State>({ kind: "enter-confirm" });
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const invalidate = useInvalidateSubscriptionState();

  useEffect(() => {
    if (state.kind !== "enter-code" || !state.cooldownUntil) {
      setCooldownSeconds(0);
      return;
    }
    const until = state.cooldownUntil;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setCooldownSeconds(remaining);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [state]);

  async function sendCode() {
    setSending(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (authError) {
        setError(authError.message);
        return false;
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleSendCode() {
    const ok = await sendCode();
    if (ok) {
      setState({ kind: "enter-code", cooldownUntil: Date.now() + 30_000 });
      setCode("");
    }
  }

  async function handleResend() {
    if (state.kind !== "enter-code" || cooldownSeconds > 0) return;
    const ok = await sendCode();
    if (ok) {
      setState({ kind: "enter-code", cooldownUntil: Date.now() + 30_000 });
      setCode("");
    }
  }

  async function handleCodeSubmit(codeValue: string) {
    if (state.kind !== "enter-code") return;
    setState({ kind: "verifying" });
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: codeValue,
        type: "email",
      });
      if (verifyError) {
        setError(
          verifyError.message.toLowerCase().includes("invalid")
            ? "That code didn't work. Check your email and try again."
            : verifyError.message,
        );
        setState({ kind: "enter-code", cooldownUntil: null });
        setCode("");
        return;
      }
      await supabase.auth.refreshSession();
      await invalidate();
      setState({ kind: "success" });
    } catch (err) {
      setError((err as Error).message);
      setState({ kind: "enter-code", cooldownUntil: null });
      setCode("");
    }
  }

  if (state.kind === "success") {
    return (
      <>
        <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
          You're logged in.
        </h2>
        <p className="text-sm text-[var(--ink)] mb-4">
          Welcome back. Our team will link your new subscription to <strong>{email}</strong>{" "}
          within 24 hours.
        </p>
        <button
          onClick={onDismiss}
          className="w-full py-2.5 px-4 rounded-lg font-medium text-sm"
          style={{ background: "var(--ink)", color: "white" }}
        >
          Continue browsing
        </button>
      </>
    );
  }

  if (state.kind === "enter-code" || state.kind === "verifying") {
    return (
      <>
        <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
          Check your email
        </h2>
        <p className="text-sm mb-6" style={{ color: "var(--ink)" }}>
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to log in.
        </p>
        <div className="mb-4">
          <OTPInput
            value={code}
            onChange={setCode}
            onComplete={(v) => handleCodeSubmit(v)}
            disabled={state.kind === "verifying"}
          />
        </div>
        {state.kind === "verifying" && (
          <p className="text-xs text-[var(--ink)]/60 text-center mb-3">Verifying...</p>
        )}
        {error && <p className="mb-3 text-xs text-red-600 text-center">{error}</p>}
        <div className="flex flex-col items-center gap-2 mt-2">
          <button
            onClick={handleResend}
            disabled={cooldownSeconds > 0 || state.kind === "verifying" || sending}
            className="text-sm text-[var(--ink)]/70 hover:text-[var(--ink)] disabled:opacity-50"
          >
            {cooldownSeconds > 0
              ? `Didn't get it? Resend in ${cooldownSeconds}s`
              : "Didn't get it? Send a new code"}
          </button>
          <button
            onClick={onDismiss}
            disabled={state.kind === "verifying"}
            className="text-xs text-[var(--ink)]/60 hover:text-[var(--ink)] underline"
          >
            Skip for now
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
        Existing account found
      </h2>
      <p className="text-sm text-[var(--ink)] mb-4">
        It looks like <strong>{email}</strong> is already registered with Prophiq. Please log into
        your existing account so we can link your new subscription.
      </p>
      <button
        onClick={handleSendCode}
        disabled={sending}
        className="w-full py-2.5 px-4 rounded-lg font-medium text-sm disabled:opacity-50 mb-2"
        style={{ background: "var(--ink)", color: "white" }}
      >
        {sending ? "Sending..." : "Email me a 6-digit code"}
      </button>
      <button
        onClick={onDismiss}
        className="w-full py-2 text-sm text-[var(--ink)]/70 hover:text-[var(--ink)]"
      >
        Skip for now
      </button>
      {error && <p className="mt-2 text-xs text-red-600 text-center">{error}</p>}
      <p className="mt-4 text-xs text-[var(--ink)]/60">
        Need help?{" "}
        <a
          href="mailto:support@prophiq.io"
          className="underline"
          style={{ color: "var(--ink)" }}
        >
          support@prophiq.io
        </a>
      </p>
    </>
  );
}
