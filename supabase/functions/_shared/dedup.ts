import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * Returns true if `email` belongs to an auth.users row whose id is NOT
 * the given `currentUserId`. Used by get-checkout-session-info to detect
 * whether a user is trying to upgrade to an email already owned by
 * another account.
 *
 * Requires service_role to read auth.users.
 *
 * V1: pages through admin.listUsers up to a small cap. For Brief DD volume
 * this is acceptable; can be swapped for a precise SQL RPC if perf or
 * accuracy concerns emerge.
 */
export async function checkEmailCollision(
  supabase: SupabaseClient,
  email: string,
  currentUserId: string,
): Promise<boolean> {
  const lower = email.toLowerCase();
  const MAX_PAGES = 20;
  const PER_PAGE = 200;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      console.warn(`[checkEmailCollision] listUsers page ${page} failed: ${error.message}`);
      return false; // fail open
    }
    const match = data.users.some(
      (u) => u.email?.toLowerCase() === lower && u.id !== currentUserId,
    );
    if (match) return true;
    if (data.users.length < PER_PAGE) return false;
  }
  return false;
}
