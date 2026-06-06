// POST /functions/v1/google-rtdn-webhook
//
// Reserved name. Real-time developer notifications handler arrives with
// the 6b-google brief once the Play Console account exists.
//
// TODO 6b-google: RTDN Pub/Sub envelope parsing + subscription lifecycle mapping.

import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  return jsonResponse({ error: "Google billing not yet wired (6b-google)" }, { status: 501 });
});
