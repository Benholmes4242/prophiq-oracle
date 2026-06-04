import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getCheckoutSessionInfo } from "../../lib/billing";
import { useInvalidateSubscriptionState } from "../../hooks/useActiveSubscription";
import { MergeAccountPrompt } from "./MergeAccountPrompt";

type HandlerState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; email: string }
  | { kind: "collision"; email: string }
  | { kind: "error"; message: string };

export function PostCheckoutHandler() {
  const invalidate = useInvalidateSubscriptionState();
  const [state, setState] = useState<HandlerState>({ kind: "idle" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const subscribed = url.searchParams.get("subscribed");
    const sessionId = url.searchParams.get("session_id");

    if (subscribed !== "true" || !sessionId) return;

    // Strip params so refresh doesn't reprocess.
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

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setState({ kind: "error", message: "Lost your session somewhere. Please log in." });
          return;
        }

        const isAnonymous = (user as { is_anonymous?: boolean }).is_anonymous ?? false;

        if (isAnonymous && info.email) {
          const { error } = await supabase.auth.updateUser({ email: info.email });
          if (error) {
            setState({ kind: "error", message: `Could not link your email: ${error.message}` });
            return;
          }
          setState({ kind: "success", email: info.email });
        } else {
          setState({ kind: "success", email: user.email ?? info.email ?? "" });
        }
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    }
  }, [invalidate]);

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
            <h2 className="text-xl font-bold mb-2">Setting up your subscription...</h2>
            <p className="text-sm text-[var(--ink)]/70">One moment.</p>
          </>
        )}

        {state.kind === "success" && (
          <>
            <h2 className="text-xl font-bold mb-2">You're in.</h2>
            <p className="text-sm text-[var(--ink)] mb-4">
              Welcome to your 7-day Pro trial.
              {state.email
                ? <> Check your email at <strong>{state.email}</strong> to verify your account so you can log in later from any device.</>
                : null}
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
            <h2 className="text-xl font-bold mb-2">Something went sideways</h2>
            <p className="text-sm text-[var(--ink)] mb-4">{state.message}</p>
            <p className="text-xs text-[var(--ink)]/60 mb-4">
              Your subscription is still active. Email{" "}
              <a
                href="mailto:support@prophiq.io"
                className="underline"
                style={{ color: "var(--amber)" }}
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
