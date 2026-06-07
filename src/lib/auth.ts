// Auth helpers for Prophiq.

import { supabase } from "./supabase";

/**
 * Returns the current user_id, or null if not authenticated.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}
