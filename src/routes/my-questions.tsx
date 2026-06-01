import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import {
  clearHistory,
  getHistory,
  type QuestionHistoryEntry,
} from "@/lib/questionHistory";

export const Route = createFileRoute("/my-questions")({
  head: () => ({
    meta: [
      { title: "Your questions — Prophiq" },
      {
        name: "description",
        content: "Your recent Prophiq questions, stored on this device only.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyQuestionsPage,
});

function MyQuestionsPage() {
  const [history, setHistory] = useState<QuestionHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setHistory(getHistory());
    setMounted(true);
  }, []);

  return (
    <div style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <Header />
      <main className="mx-auto max-w-2xl px-5 pb-12 pt-9">
        <div className="mb-6">
          <p
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "var(--ink-faint)", fontWeight: 600 }}
          >
            YOUR QUESTIONS
          </p>
          <h1
            className="font-display tracking-[-0.03em]"
            style={{ fontWeight: 700, fontSize: 44, lineHeight: 0.98 }}
          >
            Your questions.
            <br />
            <span style={{ color: "var(--amber)" }}>This device.</span>
          </h1>
          <p
            className="mt-3 max-w-[40ch] font-body text-[14px] leading-relaxed"
            style={{ color: "var(--ink-soft)" }}
          >
            We don't store your questions on our servers. This list lives only
            in your browser.
          </p>
        </div>

        {mounted && history.length === 0 ? (
          <div
            className="rounded-xl px-4 py-6 text-center"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <p
              className="font-body text-[14px]"
              style={{ color: "var(--ink-soft)" }}
            >
              You haven't asked anything yet.
            </p>
            <Link
              to="/"
              className="mt-3 inline-block font-body text-[13.5px] font-semibold underline"
              style={{ color: "var(--ink)" }}
            >
              Ask something →
            </Link>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-soft)",
                  }}
                >
                  <p
                    className="font-mono text-[10px] uppercase tracking-[0.18em]"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {new Date(entry.submittedAt).toLocaleString()}
                  </p>
                  <p
                    className="mt-1 font-body text-[14px]"
                    style={{ color: "var(--ink)" }}
                  >
                    {entry.question}
                  </p>
                  {entry.eventSlug && entry.eventDomain && (
                    <Link
                      to="/$domain/events/$slug"
                      params={{
                        domain: entry.eventDomain,
                        slug: entry.eventSlug,
                      }}
                      className="mt-2 inline-block font-body text-[12.5px] underline"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      View Prophiq's call →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  window.confirm("Clear your question history?")
                ) {
                  clearHistory();
                  setHistory([]);
                }
              }}
              className="font-body mt-6 text-[12.5px] underline"
              style={{ color: "var(--ink-soft)" }}
            >
              Clear history
            </button>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
