import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useInvalidateSubscriptionState } from "../../hooks/useActiveSubscription";
import { createCheckoutSession } from "../../lib/billing";
import { OTPInput } from "./OTPInput";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  message?: string;
}

type State =
  | { kind: "enter-email" }
  | { kind: "enter-code"; email: string; cooldownUntil: number | null }
  | { kind: "verifying"; email: string }
  | { kind: "success"; email: string };

export function LoginModal({ open, onClose }: LoginModalProps) {
  const [state, setState] = useState<State>({ kind: "enter-email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const invalidate = useInvalidateSubscriptionState();

  useEffect(() => {
    if (!open) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" && session?.user && !session.user.is_anonymous) {
          await invalidate();
          onClose();
        }
      },
    );
    return () => subscription.unsubscribe();
  }, [open, onClose, invalidate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setState({ kind: "enter-email" });
      setEmail("");
      setCode("");
      setError(null);
      setSending(false);
      setCooldownSeconds(0);
    }
  }, [open]);

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

  async function sendCode(targetEmail: string) {
    setSending(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: { shouldCreateUser: false },
      });
      if (authError) {
        const msg = authError.message.toLowerCase();
        if (
          msg.includes("user not found") ||
          msg.includes("does not exist") ||
          msg.includes("not allowed")
        ) {
          setError(
            "We couldn't find an account with that email. Double-check the address or subscribe via /pricing.",
          );
        } else {
          setError(authError.message);
        }
        return false;
      }
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || sending) return;
    const ok = await sendCode(email);
    if (ok) {
      setState({
        kind: "enter-code",
        email,
        cooldownUntil: Date.now() + 30_000,
      });
      setCode("");
    }
  }

  async function handleCodeSubmit(codeValue: string) {
    if (state.kind !== "enter-code") return;
    const targetEmail = state.email;
    setState({ kind: "verifying", email: targetEmail });
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: targetEmail,
        token: codeValue,
        type: "email",
      });
      if (verifyError) {
        setError(
          verifyError.message.toLowerCase().includes("invalid")
            ? "That code didn't work. Check your email and try again."
            : verifyError.message,
        );
        setState({
          kind: "enter-code",
          email: targetEmail,
          cooldownUntil: null,
        });
        setCode("");
        return;
      }
      await supabase.auth.refreshSession();
      setState({ kind: "success", email: targetEmail });
    } catch (err) {
      setError((err as Error).message);
      setState({
        kind: "enter-code",
        email: targetEmail,
        cooldownUntil: null,
      });
      setCode("");
    }
  }

  async function handleResend() {
    if (state.kind !== "enter-code" || cooldownSeconds > 0) return;
    const ok = await sendCode(state.email);
    if (ok) {
      setState({
        kind: "enter-code",
        email: state.email,
        cooldownUntil: Date.now() + 30_000,
      });
      setCode("");
    }
  }

  function handleGoBack() {
    setState({ kind: "enter-email" });
    setCode("");
    setError(null);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{ background: "var(--bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-black/5"
          aria-label="Close"
          style={{ color: "var(--ink)" }}
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

        {state.kind === "enter-email" && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Log in
            </h2>
            <p className="text-sm text-[var(--ink)]/70 mb-6">
              Enter the email you used to sign up. We'll send you a 6-digit code.
            </p>
            <form onSubmit={handleEmailSubmit}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                required
                className="w-full px-4 py-2.5 rounded-lg border text-sm mb-4"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--line)",
                  color: "var(--ink)",
                }}
              />
              <button
                type="submit"
                disabled={sending || !email}
                className="w-full py-2.5 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
                style={{ background: "var(--ink)", color: "white" }}
              >
                {sending ? "Sending..." : "Send code"}
              </button>
            </form>
            {error && (
              <p className="mt-3 text-xs text-red-600 text-center">{error}</p>
            )}
            <p className="mt-4 text-xs text-[var(--ink)]/60 text-center">
              Don't have an account?{" "}
              <a
                href="/pricing"
                className="underline"
                style={{ color: "var(--ink)" }}
              >
                View pricing
              </a>
            </p>
          </>
        )}

        {(state.kind === "enter-code" || state.kind === "verifying") && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Check your email
            </h2>
            <p className="text-sm mb-6" style={{ color: "var(--ink)" }}>
              We sent a 6-digit code to <strong>{state.email}</strong>. Enter it below.
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
              <p className="text-xs text-[var(--ink)]/60 text-center mb-3">
                Verifying...
              </p>
            )}
            {error && (
              <p className="mb-3 text-xs text-red-600 text-center">{error}</p>
            )}
            <div className="flex flex-col items-center gap-3 mt-2">
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
                onClick={handleGoBack}
                disabled={state.kind === "verifying"}
                className="text-xs text-[var(--ink)]/60 hover:text-[var(--ink)] underline"
              >
                Wrong email? Go back
              </button>
            </div>
          </>
        )}

        {state.kind === "success" && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              You're in.
            </h2>
            <p className="text-sm text-[var(--ink)]/70">Loading your account...</p>
          </>
        )}
      </div>
    </div>
  );
}
