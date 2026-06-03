// Anonymous-first auth helpers. Every visitor gets a Supabase anonymous
// session on first load; the same user_id later upgrades to email via the
// paywall (Brief DD).

import { supabase } from "./supabase";

/**
 * Ensures the user has a valid Supabase session. If no session exists,
 * creates a new anonymous one. Safe to call multiple times - short-circuits
 * when a session already exists.
 */
export async function ensureAnonymousSession(): Promise<void> {
  if (typeof window === "undefined") return; // SSR: no session to manage
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return;

  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("[auth] anonymous sign-in failed:", error.message);
    throw error;
  }
}

/**
 * Triggers the email-upgrade flow for the current anonymous user. Used by the
 * paywall UI (Brief DD) when the user enters their email to subscribe.
 *
 * After this completes, Supabase sends a magic link. When the user clicks it,
 * their is_anonymous flag flips to false and they're a "real" account with
 * the same user_id.
 */
export async function upgradeAnonymousToEmail(
  email: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.auth.updateUser({ email });
  return { error };
}

/**
 * Returns the current user_id, or null if not authenticated. Anonymous
 * users have a user_id too.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}
