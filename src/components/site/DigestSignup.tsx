import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function DigestSignup({ source = "homepage" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const signup = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("signup_for_digest", {
        _email: email,
        _source: source,
      });
      if (error) throw new Error(error.message);
      const payload = data as { ok?: boolean; error?: string } | null;
      if (!payload?.ok) {
        throw new Error(payload?.error ?? "unknown");
      }
      return payload;
    },
    onSuccess: () => {
      setState("success");
      setErrorMsg(null);
    },
    onError: (err: Error) => {
      setState("error");
      setErrorMsg(
        err.message === "invalid_email"
          ? "That doesn't look like an email. Try again?"
          : "Couldn't sign you up. Try again?",
      );
    },
  });

  if (state === "success") {
    return (
      <div
        className="rounded-xl px-4 py-4"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <p
          className="font-display text-[15px]"
          style={{ fontWeight: 600, color: "var(--ink)" }}
        >
          You're on the list.
        </p>
        <p
          className="mt-1 font-body text-[12.5px]"
          style={{ color: "var(--ink-soft)" }}
        >
          We'll send the first digest soon.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl px-4 py-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <p
        className="font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        DAILY DIGEST
      </p>
      <p
        className="mt-1 font-body text-[13px]"
        style={{ color: "var(--ink-soft)" }}
      >
        Tomorrow&apos;s forecasts, one email a day.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="you@email.com"
          maxLength={254}
          className="font-body flex-1 rounded-full px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--amber)]/30"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border-strong)",
            color: "var(--ink)",
          }}
          aria-label="Email address"
        />
        <button
          type="button"
          onClick={() => signup.mutate()}
          disabled={signup.isPending || !email}
          className="font-body whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] font-semibold text-white"
          style={{
            background: "var(--ink)",
            opacity: signup.isPending || !email ? 0.5 : 1,
          }}
        >
          {signup.isPending ? "…" : "Sign up"}
        </button>
      </div>
      {state === "error" && errorMsg && (
        <p
          className="mt-2 font-body text-[12px]"
          style={{ color: "var(--amber)" }}
        >
          {errorMsg}
        </p>
      )}
    </div>
  );
}
