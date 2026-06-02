// ChatSheet — modal bottom sheet with scrim, drag handle (visual only),
// usage indicator, message bubbles, refined composer pill. Replaces the old
// ChatPanel.tsx (no responsive sidebar — modal on all viewports).

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat } from "@/hooks/useChat";
import { useUsageQuota } from "@/hooks/useUsageQuota";

interface ChatSheetProps {
  eventId: string | undefined;
  onClose: () => void;
}

function sanitize(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

export function ChatSheet({ eventId, onClose }: ChatSheetProps) {
  const { messages, sendMessage, sending, error } = useChat(eventId);
  const { usage, refetch: refetchUsage } = useUsageQuota();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!error) return;
    if (error === "rate_limited") {
      toast.error("You've used today's question allocation. Come back tomorrow.");
    } else {
      toast.error(error);
    }
  }, [error]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sending]);

  const remaining = usage ? usage.remaining : null;
  const total = usage ? usage.total : 3;
  const quotaExhausted = remaining === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || quotaExhausted) return;
    setDraft("");
    await sendMessage(text);
    refetchUsage();
  }

  const hasDraft = draft.trim().length > 0;
  const sendDisabled = !eventId || sending || quotaExhausted || !hasDraft;

  return (
    <>
      <div className="chat-scrim" onClick={onClose} />
      <div className="chat-sheet" role="dialog" aria-modal="true" aria-label="Chat about this prediction">
        <div className="sheet-handle-area">
          <span className="sheet-handle" aria-hidden />
        </div>
        <div className="sheet-header">
          <div className="sheet-header-text">
            <div className="sheet-title">Chat about this prediction</div>
            {usage && (
              <div className="sheet-usage">
                <span className="strong">{remaining}</span> of {total} questions remaining today
              </div>
            )}
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div ref={scrollRef} className="sheet-thread">
          {messages.length === 0 && !sending && (
            <p className="sheet-empty">Ask why this pick won out, or what would change it.</p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={"msg " + (m.role === "user" ? "msg-user" : "msg-assistant")}
            >
              {sanitize(m.content)}
            </div>
          ))}
          {sending && <div className="msg msg-assistant msg-thinking">Thinking…</div>}
        </div>

        <form onSubmit={handleSubmit} className="sheet-composer">
          <div className="composer-pill">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={quotaExhausted ? "No questions left today" : "Ask a question…"}
              maxLength={1000}
              disabled={!eventId || sending || quotaExhausted}
            />
            <button
              type="submit"
              disabled={sendDisabled}
              className={"composer-send" + (hasDraft && !quotaExhausted ? " active" : "")}
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
