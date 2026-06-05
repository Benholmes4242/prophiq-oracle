// Auth helpers for Prophiq.

import { supabase } from "./supabase";

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
