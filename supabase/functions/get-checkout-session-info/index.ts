// Returns the email captured on a Stripe Checkout Session, plus whether
// that email collides with an existing (different) auth.users record.
//
// Called by the PostCheckoutHandler component (Brief DD) right after Stripe
// redirects back to the app with ?subscribed=true&session_id=...
//
// Auth: required. The session must belong to the current user (we verify
// session.metadata.user_id matches the authenticated user_id).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getStripeClient } from "../_shared/stripe.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import { checkEmailCollision } from "../_shared/dedup.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  let authedUser;
  try {
    authedUser = await requireAuthenticatedUser(req, supabase);
  } catch (response) {
    return response as Response;
  }

  let body: { session_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.session_id || typeof body.session_id !== "string") {
    return errorResponse("Missing session_id", 400);
  }

  const stripe = getStripeClient();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(body.session_id, {
      expand: ["customer", "customer_details"],
    });
  } catch (e) {
    console.warn(`[get-checkout-session-info] failed to fetch session: ${(e as Error).message}`);
    return errorResponse("Checkout session not found", 404);
  }

  const sessionUserId = session.metadata?.user_id;
  if (sessionUserId && sessionUserId !== authedUser.user_id) {
    console.warn(
      `[get-checkout-session-info] session ${body.session_id} user_id=${sessionUserId} doesn't match authed user ${authedUser.user_id}`,
    );
    return errorResponse("Session does not belong to current user", 403);
  }

  const email = session.customer_details?.email ?? null;
  if (!email) {
    return jsonResponse({ email: null, has_email_collision: false });
  }

  const has_email_collision = await checkEmailCollision(
    supabase,
    email,
    authedUser.user_id,
  );

  return jsonResponse({ email, has_email_collision });
});
