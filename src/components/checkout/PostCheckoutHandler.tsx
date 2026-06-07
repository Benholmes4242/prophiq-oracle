import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getCheckoutSessionInfo } from "../../lib/billing";
import { useInvalidateSubscriptionState } from "../../hooks/useActiveSubscription";
import { MergeAccountPrompt } from "./MergeAccountPrompt";
import { OTPInput } from "../auth/OTPInput";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "enter-code"; email: string; cooldownUntil: number | null }
  | { kind: "verifying"; email: string }
  | { kind: "success"; email: string }
  | { kind: "collision"; email: string }
  | { kind: "confirm-skip"; email: string }
  | { kind: "error"; message: string };

export function PostCheckoutHandler() {
  const invalidate = useInvalidateSubscriptionState();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const subscribed = url.searchParams.get("subscribed");
    const sessionId = url.searchParams.get("session_id");

    if (subscribed !== "true" || !sessionId) return;

    url.searchParams.delete("subscribed");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url.toString());

    void handlePostCheckout(sessionId);

    async function handlePostCheckout(sid: string) {
      setState({ kind: "loading" });
      try {
        await invalidate();

        const info = await getCheckoutSessionInfo(sid);

        if (info.has_email_collision && info.email) {
          setState({ kind: "collision", email: info.email });
          return;
        }

        if (!info.email) {
          setState({ kind: "error", message: "Checkout didn't capture an email." });
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setState({ kind: "error", message: "Lost your session somewhere. Please log in." });
          return;
        }

        setState({ kind: "success", email: user.email ?? info.email });
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    }
  }, [invalidate]);

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

  // (Anon→email upgrade listener removed — signup is the normal flow now.)


  async function handleCodeSubmit(codeValue: string) {
    if (state.kind !== "enter-code") return;
    const targetEmail = state.email;
    setState({ kind: "verifying", email: targetEmail });
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: targetEmail,
        token: codeValue,
        type: "email_change",
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
      await invalidate();
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
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        email: state.email,
      });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setState({
        kind: "enter-code",
        email: state.email,
        cooldownUntil: Date.now() + 30_000,
      });
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleAttemptDismiss() {
    if (state.kind === "enter-code") {
      setState({ kind: "confirm-skip", email: state.email });
    } else {
      setState({ kind: "idle" });
      setCode("");
      setError(null);
    }
  }

  function handleConfirmSkip() {
    setState({ kind: "idle" });
    setCode("");
    setError(null);
  }

  function handleCancelSkip() {
    if (state.kind === "confirm-skip") {
      setState({
        kind: "enter-code",
        email: state.email,
        cooldownUntil: null,
      });
    }
  }

  if (state.kind === "idle") return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{ background: "var(--bg)" }}
      >
        {state.kind === "loading" && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Setting up your subscription...
            </h2>
            <p className="text-sm text-[var(--ink)]/70">One moment.</p>
          </>
        )}

        {(state.kind === "enter-code" || state.kind === "verifying") && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Welcome to Prophiq.
            </h2>
            <p className="text-sm mb-2" style={{ color: "var(--ink)" }}>
              We sent a 6-digit code to <strong>{state.email}</strong>.
            </p>
            <p className="text-sm text-[var(--ink)]/70 mb-6">
              Enter it to confirm your email and enable login from any device.
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
            <div className="flex flex-col items-center gap-2 mt-2">
              <button
                onClick={handleResend}
                disabled={cooldownSeconds > 0 || state.kind === "verifying"}
                className="text-sm text-[var(--ink)]/70 hover:text-[var(--ink)] disabled:opacity-50"
              >
                {cooldownSeconds > 0
                  ? `Didn't get it? Resend in ${cooldownSeconds}s`
                  : "Didn't get it? Send a new code"}
              </button>
              <button
                onClick={handleAttemptDismiss}
                disabled={state.kind === "verifying"}
                className="text-xs text-[var(--ink)]/60 hover:text-[var(--ink)] underline"
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {state.kind === "confirm-skip" && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Skip verification?
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>
              Without verifying <strong>{state.email}</strong>, you won't be able to log in from
              another device. Your subscription is active in this session, but you'd lose access
              if your browser data is cleared.
            </p>
            <p className="text-xs text-[var(--ink)]/60 mb-6">
              You can verify later via "Log in". Your code is valid for 1 hour.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleCancelSkip}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium text-sm"
                style={{ background: "var(--ink)", color: "white" }}
              >
                Verify now
              </button>
              <button
                onClick={handleConfirmSkip}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium text-sm border"
                style={{ background: "var(--bg)", color: "var(--ink)", borderColor: "var(--line)" }}
              >
                Skip
              </button>
            </div>
          </>
        )}

        {state.kind === "success" && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              You're in.
            </h2>
            <p className="text-sm text-[var(--ink)] mb-4">
              Welcome to your 7-day Pro trial.{" "}
              {state.email && (
                <>
                  We've linked <strong>{state.email}</strong> to your account so you can log in
                  from any device.
                </>
              )}
            </p>
            <button
              onClick={() => setState({ kind: "idle" })}
              className="w-full py-2.5 px-4 rounded-lg font-medium text-sm"
              style={{ background: "var(--ink)", color: "white" }}
            >
              Continue
            </button>
          </>
        )}

        {state.kind === "collision" && (
          <MergeAccountPrompt
            email={state.email}
            onDismiss={() => setState({ kind: "idle" })}
          />
        )}

        {state.kind === "error" && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Something went sideways
            </h2>
            <p className="text-sm text-[var(--ink)] mb-4">{state.message}</p>
            <p className="text-xs text-[var(--ink)]/60 mb-4">
              Your subscription is still active. Email{" "}
              <a
                href="mailto:support@prophiq.io"
                className="underline"
                style={{ color: "var(--ink)" }}
              >
                support@prophiq.io
              </a>{" "}
              if anything looks off.
            </p>
            <button
              onClick={() => setState({ kind: "idle" })}
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
