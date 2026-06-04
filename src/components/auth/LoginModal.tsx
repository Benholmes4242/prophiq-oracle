import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useInvalidateSubscriptionState } from "../../hooks/useActiveSubscription";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

export function LoginModal({ open, onClose }: LoginModalProps) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setEmail("");
      setSent(false);
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || sending) return;

    setSending(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes("user not found") || msg.includes("does not exist") || msg.includes("signups not allowed")) {
          setError(
            "We couldn't find an account with that email. Double-check the address or sign up via /pricing.",
          );
        } else {
          setError(authError.message);
        }
      } else {
        setSent(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
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

        {sent ? (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Check your email
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>
              We sent a login link to <strong>{email}</strong>. Click it to log into your account.
            </p>
            <p className="text-xs text-[var(--ink)]/60 mb-4">
              The link will expire in 1 hour. If you don't see the email, check your spam folder.
            </p>
            <button
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-lg font-medium text-sm"
              style={{ background: "var(--ink)", color: "white" }}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--ink)" }}>
              Log in
            </h2>
            <p className="text-sm text-[var(--ink)]/70 mb-6">
              Enter the email you used to sign up. We'll send you a magic link.
            </p>
            <form onSubmit={handleSubmit}>
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
                {sending ? "Sending..." : "Send login link"}
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
      </div>
    </div>
  );
}
