import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

interface AdminEvent {
  id: string;
  title: string;
  slug: string;
  domain: string;
  starts_at: string;
  status: string;
  is_marquee: boolean;
}

function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState("");

  return (
    <div style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <Header />
      <main className="mx-auto max-w-2xl px-5 pb-12 pt-9">
        {!authed ? (
          <div
            className="rounded-2xl px-5 py-6"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <h1
              className="font-display tracking-[-0.03em]"
              style={{ fontWeight: 700, fontSize: 32 }}
            >
              Admin<span style={{ color: "var(--amber)" }}>.</span>
            </h1>
            <p
              className="mt-2 font-body text-[13px]"
              style={{ color: "var(--ink-soft)" }}
            >
              Enter the shared password to continue.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="font-body mt-4 w-full rounded-lg px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-[var(--amber)]/30"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border-strong)",
              }}
            />
            {error && (
              <p
                className="mt-2 font-body text-[12px]"
                style={{ color: "var(--amber)" }}
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (!password) {
                  setError("Enter password");
                  return;
                }
                setError("");
                setAuthed(true);
              }}
              className="font-body mt-3 w-full rounded-lg px-4 py-3 text-[15px] font-semibold text-white"
              style={{ background: "var(--ink)" }}
            >
              Enter
            </button>
          </div>
        ) : (
          <AdminEventList password={password} />
        )}
      </main>
      <Footer />
    </div>
  );
}

function AdminEventList({ password }: { password: string }) {
  const qc = useQueryClient();
  const { data: events = [], isLoading } = useQuery<AdminEvent[]>({
    queryKey: ["admin-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, slug, domain, starts_at, status, is_marquee")
        .eq("status", "scheduled")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdminEvent[];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase.rpc("admin_set_marquee", {
        _event_id: id,
        _value: value,
        _password: password,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-events"] }),
  });

  return (
    <div>
      <div className="mb-6">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          ADMIN
        </p>
        <h1
          className="font-display tracking-[-0.03em]"
          style={{ fontWeight: 700, fontSize: 40, lineHeight: 1 }}
        >
          Marquee<span style={{ color: "var(--amber)" }}>.</span>
        </h1>
        <p
          className="mt-2 font-body text-[13px]"
          style={{ color: "var(--ink-soft)" }}
        >
          One marquee event at a time. Tap to toggle.
        </p>
      </div>

      {isLoading && (
        <p className="font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>
          Loading…
        </p>
      )}

      <ul className="space-y-2">
        {events.map((e) => (
          <li
            key={e.id}
            className="flex items-start justify-between gap-4 rounded-xl px-4 py-3"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <div className="min-w-0">
              <p
                className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{ color: "var(--ink-faint)" }}
              >
                {e.domain.toUpperCase()} ·{" "}
                {new Date(e.starts_at).toLocaleDateString()}
              </p>
              <p
                className="mt-0.5 font-body text-[14px]"
                style={{ color: "var(--ink)" }}
              >
                {e.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggle.mutate({ id: e.id, value: !e.is_marquee })}
              disabled={toggle.isPending}
              className="font-body shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium"
              style={{
                background: e.is_marquee ? "var(--amber)" : "transparent",
                color: e.is_marquee ? "white" : "var(--ink-soft)",
                border: e.is_marquee
                  ? "none"
                  : "1px solid var(--border-strong)",
              }}
            >
              {e.is_marquee ? "★ Marquee" : "Set marquee"}
            </button>
          </li>
        ))}
      </ul>

      {toggle.isError && (
        <p
          className="mt-3 font-body text-[12.5px]"
          style={{ color: "var(--amber)" }}
        >
          {(toggle.error as Error).message}
        </p>
      )}
    </div>
  );
}
