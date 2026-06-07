// Auth gate for user-initiated AI paths (ask box + chat).
// If no session, stash the intended action in sessionStorage and open the
// signup modal. After SIGNED_IN, the originating component pulls its pending
// payload and re-runs the action.

import { supabase } from "./supabase";

const PENDING_QUESTION_KEY = "prophiq:pendingQuestion";
const PENDING_CHAT_KEY = "prophiq:pendingChat";

export interface PendingQuestion {
  question: string;
  topic?: string; // "any" | DomainId
  scope: "home" | "domain";
  domain?: string;
}

export interface PendingChat {
  eventId: string;
  message: string;
}

export async function hasSession(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

export function openSignupModal(message?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("prophiq:open-login", {
      detail: {
        mode: "signup",
        message:
          message ??
          "Create a free account to get your forecast — 3 free a day, no card required.",
      },
    }),
  );
}

export function setPendingQuestion(p: PendingQuestion) {
  try {
    sessionStorage.setItem(PENDING_QUESTION_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function consumePendingQuestion(
  predicate?: (p: PendingQuestion) => boolean,
): PendingQuestion | null {
  try {
    const raw = sessionStorage.getItem(PENDING_QUESTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingQuestion;
    if (predicate && !predicate(parsed)) return null;
    sessionStorage.removeItem(PENDING_QUESTION_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function setPendingChat(p: PendingChat) {
  try {
    sessionStorage.setItem(PENDING_CHAT_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function consumePendingChat(eventId: string): PendingChat | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CHAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChat;
    if (parsed.eventId !== eventId) return null;
    sessionStorage.removeItem(PENDING_CHAT_KEY);
    return parsed;
  } catch {
    return null;
  }
}
