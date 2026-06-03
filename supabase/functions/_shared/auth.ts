// Auth helpers for Edge Functions.
//
// Both helpers parse the Authorization header and verify the JWT via Supabase.
// requireAuthenticatedUser throws a Response on failure (use in user-facing
// endpoints). extractUserIfAuthenticated returns null on failure (use in
// endpoints that work with or without auth, like generate-prediction).

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface AuthedUser {
  user_id: string;
  is_anonymous: boolean;
  email: string | null;
}

/**
 * Verify the Authorization header JWT and return the authenticated user.
 * Throws a 401 Response if no valid JWT is present. Anonymous JWTs pass.
 */
export async function requireAuthenticatedUser(
  req: Request,
  supabase: SupabaseClient,
): Promise<AuthedUser> {
  const authHeader =
    req.headers.get("Authorization") ?? req.headers.get("authorization");

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new Response(
      JSON.stringify({ error: "Missing or malformed Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const jwt = authHeader.slice(7).trim();
  const { data: { user }, error } = await supabase.auth.getUser(jwt);

  if (error || !user) {
    throw new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  return {
    user_id: user.id,
    is_anonymous: (user as { is_anonymous?: boolean }).is_anonymous ?? false,
    email: user.email ?? null,
  };
}

/**
 * Non-throwing variant. Returns null if no valid JWT, otherwise the user.
 * Use for endpoints that work both with and without auth (e.g.,
 * generate-prediction, which is also invoked by cron via service-role).
 */
export async function extractUserIfAuthenticated(
  req: Request,
  supabase: SupabaseClient,
): Promise<AuthedUser | null> {
  try {
    return await requireAuthenticatedUser(req, supabase);
  } catch {
    return null;
  }
}
