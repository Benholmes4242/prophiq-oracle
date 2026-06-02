// POST /functions/v1/chat-message
// Body: { event_id, thread_id?, message, fingerprint }
//
// Per-event followup chat. Rate-limited per fingerprint+IP. Appends a user
// message + assistant reply, both stored in chat_messages.

import { perplexityChat } from "../_shared/perplexity.ts";
import { check, truncateQuestion, type RateLimitChecker } from "../_shared/rateLimit.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { scoreToConfidence } from "../_shared/confidence.ts";
import {
  handleCorsPreflight, jsonResponse, errorResponse,
  getFingerprint, getClientIp, hashIp,
} from "../_shared/http.ts";

interface Body { event_id?: string; thread_id?: string; message?: string; fingerprint?: string; }

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }

  const message = (body.message ?? "").trim();
  const fingerprint = getFingerprint(body, req);
  if (!body.event_id) return errorResponse("event_id required");
  if (!message) return errorResponse("message required");
  if (!fingerprint) return errorResponse("fingerprint required");
  if (message.length > 1000) return errorResponse("message too long (max 1000 chars)");

  const ip = getClientIp(req);
  const ipHash = await hashIp(ip);
  const supabase = getServiceClient();

  // Rate limit — shared bucket with submit_question.
  const checker: RateLimitChecker = {
    async countAccepted({ fingerprint: fp, ipHash: ih, endpoints, sinceIso }) {
      let q = supabase.from("submission_rate_limits").select("id", { count: "exact", head: true })
        .in("endpoint", endpoints).eq("outcome", "accepted").gte("submitted_at", sinceIso);
      if (fp) q = q.eq("fingerprint", fp);
      if (ih) q = q.eq("ip_hash", ih);
      const { count } = await q;
      return count ?? 0;
    },
    async record() {},
  };
  const decision = await check(checker, {
    endpoint: "chat_message",
    fingerprint, ipHash, question: message,
    countEndpoints: ["submit_question", "chat_message"],
  });
  if (!decision.ok) {
    await supabase.from("submission_rate_limits").insert({
      fingerprint, ip_hash: ipHash, endpoint: "chat_message",
      question: truncateQuestion(message), outcome: "rejected_rate_limit",
    });
    return errorResponse(`Rate limit (${decision.reason})`, 429, decision);
  }

  // Load event + current prediction context
  const { data: event, error: evErr } = await supabase
    .from("events").select("id, title, question, domain, mode, starts_at").eq("id", body.event_id).single();
  if (evErr || !event) return errorResponse("event not found", 404);
  const { data: prediction } = await supabase
    .from("predictions").select("ranked_outcomes, agreement_score")
    .eq("event_id", body.event_id).eq("is_current", true).maybeSingle();

  // Get or create thread
  let threadId = body.thread_id;
  if (!threadId) {
    const { data: thread, error: tErr } = await supabase.from("chat_threads").insert({
      event_id: body.event_id, prediction_id: null, fingerprint,
    }).select("id").single();
    if (tErr || !thread) return errorResponse(`thread create failed: ${tErr?.message}`, 500);
    threadId = thread.id;
  } else {
    const { data: thread } = await supabase.from("chat_threads").select("id").eq("id", threadId).maybeSingle();
    if (!thread) return errorResponse("thread not found", 404);
  }

  // Load prior messages
  const { data: priorMsgs } = await supabase
    .from("chat_messages").select("role, content").eq("thread_id", threadId)
    .order("created_at").limit(20);

  // Insert user message
  await supabase.from("chat_messages").insert({ thread_id: threadId, role: "user", content: message });

  // Build LLM call
  const contextLines: string[] = [
    `Event: ${event.title}`,
    `Question: ${event.question}`,
    `Domain: ${event.domain}`,
  ];
  if (prediction) {
    contextLines.push(`Current top picks: ${JSON.stringify(prediction.ranked_outcomes)}`);
    contextLines.push(`Confidence: ${scoreToConfidence(prediction.agreement_score)}`);
  }

  const system = `You are a concise prediction-analysis assistant. Answer the user's follow-up about the event below. Use neutral language; if the event is in the markets domain, prepend "[Informational only — not financial advice] ". Cite sources where possible. Do not use betting/odds framing unless this is a sport event in odds mode. You must never mention "Borda", "consensus method", "multi-model", "LLM", or the specific number of models that contributed. Refer to model confidence only as "high", "medium", or "mixed".`;
  const history = (priorMsgs ?? []).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
  const userPrompt = `${contextLines.join("\n")}\n\nConversation so far:\n${history}\n\nUSER: ${message}`;

  let answer = "";
  let citations: string[] = [];
  try {
    const r = await perplexityChat([
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ], { model: "sonar", temperature: 0.3, maxTokens: 600 });
    answer = r.content.trim() || "Sorry — I could not generate a response.";
    citations = r.citations ?? [];
  } catch (e) {
    answer = `Sorry — chat service error: ${(e as Error).message}`;
  }

  await supabase.from("chat_messages").insert({
    thread_id: threadId, role: "assistant", content: answer,
    metadata: citations.length ? { citations } : null,
  });
  await supabase.from("chat_threads").update({
    message_count: (priorMsgs?.length ?? 0) + 2,
    last_message_at: new Date().toISOString(),
  }).eq("id", threadId);

  await supabase.from("submission_rate_limits").insert({
    fingerprint, ip_hash: ipHash, endpoint: "chat_message",
    question: truncateQuestion(message), outcome: "accepted",
  });

  return jsonResponse({ thread_id: threadId, reply: answer, citations });
});
