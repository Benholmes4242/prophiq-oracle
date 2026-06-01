// Chat UI for event detail. Desktop: right sidebar. Mobile: bottom sheet
// that starts collapsed and expands on tap. Wraps useChat() for state +
// transport. Renders 429 rate-limit errors as a toast.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChat";

function sanitize(text: string): string {
  // Strip control chars; we render as plain text (no markdown) in v1.
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

export function ChatPanel({ eventId }: { eventId: string | undefined }) {
  const { messages, sendMessage, sending, error } = useChat(eventId);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Surface server errors as toasts (rate limit, network failure).
  useEffect(() => {
    if (!error) return;
    if (error === "rate_limited") {
      toast.error("You've hit the chat limit (20 messages/hour). Try again later.");
    } else {
      toast.error(error);
    }
  }, [error]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, expanded]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setExpanded(true);
    await sendMessage(text);
  }

  return (
    <>
      {/* Desktop: persistent right sidebar */}
      <aside className="hidden lg:flex lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:flex-col lg:rounded-xl lg:border lg:border-[var(--brand-border)] lg:bg-white lg:shadow-sm">
        <Header />
        <Thread innerRef={scrollRef} messages={messages} sending={sending} />
        <Composer
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSubmit={handleSubmit}
          disabled={!eventId}
        />
      </aside>

      {/* Mobile: bottom sheet */}
      <div className="lg:hidden">
        {/* Spacer so content isn't hidden behind the fixed sheet */}
        <div aria-hidden className={expanded ? "h-[70vh]" : "h-14"} />
        <div
          id="chat-sheet"
          className={
            "fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-[var(--brand-border)] bg-white shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.15)] transition-[height] duration-200 " +
            (expanded ? "h-[70vh]" : "h-14")
          }
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex h-14 shrink-0 items-center justify-between px-4 text-left"
            aria-expanded={expanded}
            aria-controls="chat-sheet"
            aria-label={expanded ? "Collapse chat panel" : "Expand chat panel"}
          >
            <span className="text-sm font-medium text-[var(--brand-ink)]">
              {expanded ? "Chat about this prediction" : "Ask a follow-up about this prediction…"}
            </span>
            <span aria-hidden className="text-slate-400">
              {expanded ? "▾" : "▴"}
            </span>
          </button>
          {expanded && (
            <>
              <Thread innerRef={scrollRef} messages={messages} sending={sending} />
              <Composer
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                onSubmit={handleSubmit}
                disabled={!eventId}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="border-b border-[var(--brand-border)] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ask Prophiq</p>
      <p className="mt-0.5 text-sm text-slate-600">Follow-up questions about this prediction.</p>
    </div>
  );
}

function Thread({
  messages,
  sending,
  innerRef,
}: {
  messages: ReturnType<typeof useChat>["messages"];
  sending: boolean;
  innerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={innerRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {messages.length === 0 && !sending && (
        <p className="text-sm italic text-slate-400">
          No questions yet. Ask why a model picked this outcome, or what would change it.
        </p>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          className={
            "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm " +
            (m.role === "user"
              ? "ml-auto bg-[var(--brand-ink)] text-white"
              : "bg-slate-100 text-slate-800")
          }
        >
          {sanitize(m.content)}
        </div>
      ))}
      {sending && (
        <div className="max-w-[85%] rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-500">
          Prophiq is thinking…
        </div>
      )}
    </div>
  );
}

function Composer({
  draft,
  setDraft,
  sending,
  onSubmit,
  disabled,
}: {
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex shrink-0 items-end gap-2 border-t border-[var(--brand-border)] p-3"
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e as unknown as React.FormEvent);
          }
        }}
        placeholder="Ask a question…"
        rows={1}
        maxLength={1000}
        disabled={disabled || sending}
        className="min-h-[40px] max-h-32 flex-1 resize-none rounded-lg border border-[var(--brand-border)] bg-white px-3 py-2 text-sm focus:border-[var(--brand-amber)] focus:outline-none"
      />
      <button
        type="submit"
        disabled={disabled || sending || !draft.trim()}
        className="rounded-lg bg-[var(--brand-ink)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Send
      </button>
    </form>
  );
}
