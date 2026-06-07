// Chat panel hook. Posts to the chat-message edge function with the user's
// JWT (Option C: chat requires a free account). Persists thread_id per-event
// in localStorage so a refresh preserves context.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBrowserFingerprint } from "./useBrowserFingerprint";
import {
  hasSession,
  openSignupModal,
  setPendingChat,
  consumePendingChat,
} from "@/lib/authGate";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const threadKey = (eventId: string) => `prophiq:chat-thread:${eventId}`;

export function useChat(eventId: string | undefined) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore thread id from localStorage when event changes.
  useEffect(() => {
    if (!eventId || typeof window === "undefined") return;
    const stored = window.localStorage.getItem(threadKey(eventId));
    setThreadId(stored);
    setMessages([]);
  }, [eventId]);

  // Load prior messages whenever threadId is known.
  useEffect(() => {
    if (!threadId) return;
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (!active) return;
      if (e) setError(e.message);
      else setMessages((data ?? []) as ChatMessage[]);
    })();
    return () => {
      active = false;
    };
  }, [threadId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!eventId || !content.trim()) return;

      // Gate on auth (Option C).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPendingChat({ eventId, message: content });
        openSignupModal(
          "Create a free account to chat about this forecast — 3 free a day, no card required.",
        );
        return;
      }

      setSending(true);
      setError(null);
      // Optimistic user message
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const fingerprint = await getBrowserFingerprint();
        const res = await fetch(`${FUNCTIONS_BASE}/chat-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: ANON_KEY,
          },
          body: JSON.stringify({
            event_id: eventId,
            thread_id: threadId,
            message: content,
            fingerprint,
          }),
        });
        if (!res.ok) {
          if (res.status === 429) {
            const err = new Error("rate_limited");
            (err as Error & { status?: number }).status = 429;
            throw err;
          }
          throw new Error(`Chat failed (${res.status})`);
        }
        const json = (await res.json()) as {
          thread_id: string;
          assistant_message?: ChatMessage;
          reply?: string;
        };
        if (json.thread_id && json.thread_id !== threadId) {
          setThreadId(json.thread_id);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(threadKey(eventId), json.thread_id);
          }
        }
        if (json.assistant_message) {
          setMessages((prev) => [...prev, json.assistant_message!]);
        } else if (json.reply) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: json.reply!,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // Roll back optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      } finally {
        setSending(false);
      }
    },
    [eventId, threadId],
  );

  // Resume a pending chat message after sign-in.
  useEffect(() => {
    if (!eventId) return;
    async function tryResume() {
      if (!eventId) return;
      if (!(await hasSession())) return;
      const pending = consumePendingChat(eventId);
      if (pending) void sendMessage(pending.message);
    }
    void tryResume();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_IN") void tryResume();
      },
    );
    return () => subscription.unsubscribe();
  }, [eventId, sendMessage]);

  return { threadId, messages, sendMessage, sending, error };
}
