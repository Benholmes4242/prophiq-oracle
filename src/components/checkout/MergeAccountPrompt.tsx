import { useState } from "react";
import { supabase } from "../../lib/supabase";

interface MergeAccountPromptProps {
  email: string;
  onDismiss: () => void;
}

export function MergeAccountPrompt({ email, onDismiss }: MergeAccountPromptProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendMagicLink() {
    setSending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) {
        setError(error.message);
      } else {
        setSent(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <>
        <h2 className="text-xl font-bold mb-2">Check your email</h2>
        <p className="text-sm text-[var(--ink)] mb-4">
          We sent a login link to <strong>{email}</strong>. Click it to log into your existing
          account. Your new subscription will be linked to that account by our team within 24 hours.
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

  return (
    <>
      <h2 className="text-xl font-bold mb-2">Existing account found</h2>
      <p className="text-sm text-[var(--ink)] mb-4">
        It looks like <strong>{email}</strong> is already registered with Prophiq. Please log into
        your existing account so we can link your new subscription.
      </p>
      <button
        onClick={handleSendMagicLink}
        disabled={sending}
        className="w-full py-2.5 px-4 rounded-lg font-medium text-sm disabled:opacity-50 mb-2"
        style={{ background: "var(--ink)", color: "white" }}
      >
        {sending ? "Sending..." : "Email me a login link"}
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
          style={{ color: "var(--amber)" }}
        >
          support@prophiq.io
        </a>
      </p>
    </>
  );
}
